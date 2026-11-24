// Animal registry -- the breeding backfill: check and save over an in-memory database.

import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';

import { BACKFILL_USAGE, backfillMain, parseBackfillArgs } from './breed-backfill';
import { checkBackfill, parseBackfillFile, saveBackfill } from './breeding-backfill';
import { CliError } from './cli';
import { addAcquired, freshDb } from './fixtures';
import { canonicalOrder, effectiveEvents } from './project';
import { deriveReproduction } from './reproduction';
import { eventsForAnimal } from './store';
import type { Db } from './schema';

function herd(): Db {
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2024-03-01', acquired_precision: 'month' });
  addAcquired(db, { id: 'BD-0003', sex: 'female', acquired_on: '2024-03-01', acquired_precision: 'month' });
  addAcquired(db, { id: 'BD-0002', sex: 'male', acquired_on: '2024-03-01', acquired_precision: 'month' });
  return db;
}

const breedingRows = (db: Db, id: string) => eventsForAnimal(db, id).filter((e) => e.type !== 'acquired');

const cleanCase = {
  animal_id: 'BD-0001',
  source_form: 'recall',
  events: [
    { type: 'heat_observed', occurred_on: '2026-01-19', date_precision: 'day', occurred_time: '06:30', payload: { sign: 'standing' } },
    { type: 'insemination', occurred_on: '2026-01-20', date_precision: 'day', payload: { service_type: 'ai' }, observed_by: 'karim' },
  ],
};
const noHeatService = { type: 'insemination', occurred_on: '2026-02-10', date_precision: 'day', payload: { service_type: 'ai' } };

test('a clean case would write every row and the check writes nothing', () => {
  const db = herd();
  const report = checkBackfill(db, { cases: [cleanCase] }, 'adnan');
  assert.deepEqual(report.rows.map((r) => r.outcome), ['would_write', 'would_write']);
  assert.equal(report.clean, true);
  assert.deepEqual(breedingRows(db, 'BD-0001'), []);
});

test('save writes the rows with the case provenance, and a second check finds them on record', () => {
  const db = herd();
  const saved = saveBackfill(db, { cases: [cleanCase] }, 'adnan');
  assert.equal(saved.written, true);
  assert.equal(saved.event_ids.length, 2);
  const rows = breedingRows(db, 'BD-0001');
  assert.deepEqual(rows.map((e) => e.id).sort(), [...saved.event_ids].sort());
  assert.deepEqual(rows.map((e) => [e.type, e.source_form, e.recorded_by]), [
    ['heat_observed', 'recall', 'adnan'],
    ['insemination', 'recall', 'adnan'],
  ]);
  assert.equal(rows[1].observed_by, 'karim');
  assert.deepEqual(rows[1].override_checks, []);

  const again = checkBackfill(db, { cases: [cleanCase] }, 'adnan');
  assert.deepEqual(again.rows.map((r) => r.outcome), ['already_on_record', 'already_on_record']);
  assert.equal(again.clean, true);
  // Saving the same file again writes nothing new.
  assert.deepEqual(saveBackfill(db, { cases: [cleanCase] }, 'adnan').event_ids, []);
  assert.equal(breedingRows(db, 'BD-0001').length, 2);
});

test('a service with no heat and no allow needs one, and save writes nothing at all', () => {
  const db = herd();
  const file = { cases: [cleanCase, { animal_id: 'BD-0003', source_form: 'cycle_card', events: [noHeatService] }] };
  const report = checkBackfill(db, file, 'adnan');
  assert.deepEqual(report.rows.map((r) => r.outcome), ['would_write', 'would_write', 'needs_allow']);
  const row = report.rows[2];
  assert.ok(row.outcome === 'needs_allow');
  assert.deepEqual(row.warnings.map((w) => w.check), ['no_heat_sign']);
  assert.match(row.warnings[0].message, /No heat sign is recorded for BD-0003/);
  assert.equal(report.clean, false);

  const saved = saveBackfill(db, file, 'adnan');
  assert.equal(saved.written, false);
  assert.deepEqual(saved.event_ids, []);
  // Not even the other case's clean rows.
  assert.deepEqual(breedingRows(db, 'BD-0001'), []);
  assert.deepEqual(breedingRows(db, 'BD-0003'), []);
});

test('the same row with allow no_heat_sign is written with the override recorded from the condition', () => {
  const db = herd();
  const file = {
    cases: [{
      animal_id: 'BD-0003',
      source_form: 'cycle_card',
      events: [{ ...noHeatService, allow: ['no_heat_sign', 'early_check'], override_reason: 'heat not written down' }],
    }],
  };
  assert.deepEqual(checkBackfill(db, file, 'adnan').rows.map((r) => r.outcome), ['would_write']);
  const saved = saveBackfill(db, file, 'adnan');
  assert.equal(saved.written, true);
  const [row] = breedingRows(db, 'BD-0003');
  // early_check names a warning that did not fire, so it records nothing.
  assert.deepEqual(row.override_checks, ['no_heat_sign']);
  assert.equal(row.override_reason, 'heat not written down');
  assert.equal(row.source_form, 'cycle_card');
});

test('a male is refused with the stage 1 refusal', () => {
  const db = herd();
  const report = checkBackfill(db, { cases: [{ animal_id: 'BD-0002', source_form: 'recall', events: [noHeatService] }] }, 'adnan');
  const [row] = report.rows;
  assert.ok(row.outcome === 'refused');
  assert.equal(row.code, 'not_female');
  assert.match(row.message, /BD-0002' is male/);
  assert.equal(report.clean, false);
});

test('the second service of a case is checked with the first already in place', () => {
  const db = herd();
  const file = {
    cases: [{
      animal_id: 'BD-0001',
      source_form: 'recall',
      events: [
        { ...noHeatService, occurred_on: '2026-01-20', allow: ['no_heat_sign'] },
        { ...noHeatService, occurred_on: '2026-02-01', allow: ['no_heat_sign'] },
      ],
    }],
  };
  const report = checkBackfill(db, file, 'adnan');
  assert.equal(report.rows[0].outcome, 'would_write');
  const second = report.rows[1];
  assert.ok(second.outcome === 'needs_allow');
  assert.deepEqual(second.warnings.map((w) => w.check), ['ambiguous_service']);
  assert.match(second.warnings[0].message, /1 earlier service in this case, the first on 2026-01-20/);
  assert.deepEqual(breedingRows(db, 'BD-0001'), []);

  // Allowed, both go in and the second records both conditions.
  file.cases[0].events[1].allow = ['no_heat_sign', 'ambiguous_service'];
  const saved = saveBackfill(db, file, 'adnan');
  assert.equal(saved.written, true);
  assert.deepEqual(breedingRows(db, 'BD-0001').map((e) => e.override_checks), [
    ['no_heat_sign'],
    ['ambiguous_service', 'no_heat_sign'],
  ]);
});

test('a malformed file is refused before anything is checked or written', () => {
  const db = herd();
  const bad: unknown[] = [
    null,
    { cases: [] },
    { cases: [cleanCase], extra: 1 },
    { cases: [{ ...cleanCase, events: [] }] },
    { cases: [{ ...cleanCase, source_form: 'herd_sheet' }] },
    { cases: [{ ...cleanCase, colour: 'red' }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, type: 'calving' }] }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, occurred_on: '20-01-2026' }] }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, payload: 'ai' }] }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, allow: ['everything'] }] }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, notes: 'x' }] }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, date_precision: 'sometime' }] }] },
    { cases: [{ ...cleanCase, source_form: 'direct_entry' }] },
    { cases: [{ ...cleanCase, animal_id: ' BD-0001' }] },
    { cases: [{ ...cleanCase, animal_id: 'BD-0001 ' }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, occurred_time: '24:00' }] }] },
    { cases: [{ ...cleanCase, events: [{ ...noHeatService, occurred_time: '07:60' }] }] },
  ];
  for (const file of bad) {
    assert.throws(() => parseBackfillFile(file), CliError, JSON.stringify(file));
    assert.throws(() => saveBackfill(db, file, 'adnan'), CliError);
  }
  assert.throws(() => parseBackfillFile({ cases: [{ ...cleanCase, colour: 'red' }] }), /cases\[0\]: unknown key 'colour'/);
  assert.throws(() => checkBackfill(db, { cases: [cleanCase] }, ''), CliError);
  assert.deepEqual(breedingRows(db, 'BD-0001'), []);
});

test('the CLI reads --save as a switch and needs a file and a recorder', () => {
  const p = (...argv: string[]) => parseBackfillArgs(argv);
  assert.equal(p('--file=a.json', '--recorded-by=adnan').save, false);
  assert.equal(p('--file=a.json', '--recorded-by=adnan', '--save').save, true);
  assert.equal(p('--file=a.json', '--recorded-by=adnan', '--save=true').save, true);
  assert.equal(p('--file=a.json', '--recorded-by=adnan', '--save=false').save, false);
  assert.throws(() => p('--file=a.json', '--recorded-by=adnan', '--save=yes'), CliError);
  assert.throws(() => p('--recorded-by=adnan'), CliError);
  assert.throws(() => p('--file=a.json'), CliError);
  assert.throws(() => p('--file=a.json', '--recorded-by=adnan', '--force'), CliError);
  assert.match(BACKFILL_USAGE, /opens the registry database/);
  assert.match(BACKFILL_USAGE.replace(/\s+/g, ' '), /writes no rows; like every registry:\* command, opening the database applies any pending migration first/);
});

test('the CLI checks without --save, saves with it, and exits non-zero on anything held back', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'breed-backfill-'));
  const log = console.log;
  console.log = () => {};
  try {
    const good = path.join(dir, 'good.json');
    const held = path.join(dir, 'held.json');
    writeFileSync(good, JSON.stringify({ cases: [cleanCase] }));
    writeFileSync(held, JSON.stringify({ cases: [{ animal_id: 'BD-0003', source_form: 'recall', events: [noHeatService] }] }));
    const db = herd();
    assert.equal(backfillMain([`--file=${good}`, '--recorded-by=adnan'], db), 0);
    assert.deepEqual(breedingRows(db, 'BD-0001'), []);
    assert.equal(backfillMain([`--file=${good}`, '--recorded-by=adnan', '--save'], db), 0);
    assert.equal(breedingRows(db, 'BD-0001').length, 2);
    assert.equal(backfillMain([`--file=${held}`, '--recorded-by=adnan'], db), 1);
    assert.equal(backfillMain([`--file=${held}`, '--recorded-by=adnan', '--save'], db), 1);
    assert.deepEqual(breedingRows(db, 'BD-0003'), []);
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('rows of the same day keep file order even when the clock does not move', () => {
  // A frozen clock gives every row the same instant: the tie used to fall to the random id.
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-24T08:00:00.000Z') });
  try {
    for (let i = 0; i < 25; i++) {
      const db = herd();
      const file = {
        cases: [{
          animal_id: 'BD-0001',
          source_form: 'recall',
          events: [
            { type: 'heat_observed', occurred_on: '2026-01-20', date_precision: 'day', payload: { sign: 'standing' } },
            { type: 'insemination', occurred_on: '2026-01-20', date_precision: 'day', payload: { service_type: 'ai' } },
          ],
        }],
      };
      assert.equal(saveBackfill(db, file, 'adnan').written, true);
      const events = eventsForAnimal(db, 'BD-0001');
      assert.deepEqual(
        canonicalOrder(effectiveEvents(events)).filter((e) => e.type !== 'acquired').map((e) => e.type),
        ['heat_observed', 'insemination'],
      );
      assert.equal(deriveReproduction({ events, asOf: '2026-01-25', inMilk: false })?.state, 'bred');
    }
  } finally {
    mock.timers.reset();
  }
});

test('a second service on the same day at another time is written, not taken as on record', () => {
  const db = herd();
  const file = {
    cases: [{
      animal_id: 'BD-0001',
      source_form: 'recall',
      events: [
        { type: 'heat_observed', occurred_on: '2026-01-20', occurred_time: '05:30', date_precision: 'day', payload: { sign: 'standing' } },
        { type: 'insemination', occurred_on: '2026-01-20', occurred_time: '06:00', date_precision: 'day', payload: { service_type: 'ai' } },
        { type: 'insemination', occurred_on: '2026-01-20', occurred_time: '18:00', date_precision: 'day', payload: { service_type: 'ai' }, allow: ['ambiguous_service'] },
      ],
    }],
  };
  assert.deepEqual(checkBackfill(db, file, 'adnan').rows.map((r) => r.outcome), ['would_write', 'would_write', 'would_write']);
  const saved = saveBackfill(db, file, 'adnan');
  assert.equal(saved.event_ids.length, 3);
  assert.deepEqual(breedingRows(db, 'BD-0001').map((e) => e.occurred_time), ['05:30', '06:00', '18:00']);
});

test('a row repeated within one file is checked like any other row, not taken as on record', () => {
  const db = herd();
  const ai = { type: 'insemination', occurred_on: '2026-01-20', date_precision: 'day', payload: { service_type: 'ai' }, allow: ['no_heat_sign'] };
  const report = checkBackfill(db, { cases: [{ animal_id: 'BD-0001', source_form: 'recall', events: [ai, ai] }] }, 'adnan');
  assert.equal(report.rows[0].outcome, 'would_write');
  const second = report.rows[1];
  assert.ok(second.outcome === 'needs_allow');
  assert.deepEqual(second.warnings.map((w) => w.check), ['ambiguous_service']);
});

test('a file that partly overlaps the record writes only the new rows, checked against the existing ones', () => {
  const db = herd();
  saveBackfill(db, { cases: [cleanCase] }, 'adnan');
  const laterService = { type: 'insemination', occurred_on: '2026-02-01', date_precision: 'day', payload: { service_type: 'ai' }, allow: ['no_heat_sign'] };
  const check = { type: 'pregnancy_check', occurred_on: '2026-03-15', date_precision: 'day', payload: { method: 'ultrasound', result: 'positive' } };
  const file = { cases: [{ ...cleanCase, events: [...cleanCase.events, laterService, check] }] };

  const report = checkBackfill(db, file, 'adnan');
  assert.deepEqual(report.rows.map((r) => r.outcome), ['already_on_record', 'already_on_record', 'needs_allow', 'would_write']);
  const held = report.rows[2];
  assert.ok(held.outcome === 'needs_allow');
  // The earlier service is the one already on record.
  assert.match(held.warnings[0].message, /the first on 2026-01-20/);

  file.cases[0].events[2] = { ...laterService, allow: ['no_heat_sign', 'ambiguous_service'] };
  const saved = saveBackfill(db, file, 'adnan');
  assert.equal(saved.event_ids.length, 2);
  assert.equal(breedingRows(db, 'BD-0001').length, 4);
});

test('the CLI says when there is nothing new to write', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'breed-backfill-'));
  const log = console.log;
  const out: string[] = [];
  console.log = (...a: unknown[]) => { out.push(a.join(' ')); };
  try {
    const good = path.join(dir, 'good.json');
    writeFileSync(good, JSON.stringify({ cases: [cleanCase] }));
    const db = herd();
    backfillMain([`--file=${good}`, '--recorded-by=adnan', '--save'], db);
    out.length = 0;
    assert.equal(backfillMain([`--file=${good}`, '--recorded-by=adnan', '--save'], db), 0);
    assert.ok(out.some((l) => l.includes('Nothing new to write.')), out.join('\n'));
    assert.ok(!out.some((l) => l.includes('written:')), out.join('\n'));
  } finally {
    console.log = log;
    rmSync(dir, { recursive: true, force: true });
  }
});
