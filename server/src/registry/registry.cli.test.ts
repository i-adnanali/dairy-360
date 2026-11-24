// Animal registry -- CLI argument handling and the refusal rules.
//
// Mostly PURE: exercises cli.ts with no database. The refusals are the point of
// this file -- decision doc §11 makes "precision is never defaulted" a BLOCKING
// rule, and a rule that is only a comment is not blocking. The calving-window
// cases at the end run the two calving commands against an :memory: handle.

import assert from 'node:assert';
import { test } from 'node:test';

import {
  CliError,
  optDate,
  optPrecision,
  optStr,
  parseFlags,
  rejectUnknownFlags,
  requireDate,
  requirePrecision,
  requireProvenance,
  requireStr,
  wantsHelp,
} from './cli';
import { USAGE as ADD_USAGE } from './add';
import { CALVE_USAGE, calveMain } from './calve';
import { CORRECT_USAGE, correctMain } from './correct';
import { recordBreedingEvent } from './breeding';
import { RECALL, addAcquired, freshDb } from './fixtures';
import { effectiveEvents } from './project';
import { eventsForAnimal } from './store';
import type { Db } from './schema';
import { USAGE as EVENT_USAGE } from './event';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test('--flag=value parses, and splits on the FIRST = only', () => {
  const f = parseFlags(['--animal=BD-0001', '--notes=weight=41kg, tag=blue']);
  assert.equal(f.get('animal'), 'BD-0001');
  assert.equal(
    f.get('notes'),
    'weight=41kg, tag=blue',
    'a value may contain = -- notes and source refs realistically do',
  );
});

test('a bare --flag parses as true (for boolean overrides)', () => {
  const f = parseFlags(['--allow-near-duplicate']);
  assert.equal(f.get('allow-near-duplicate'), true);
  assert.ok(f.has('allow-near-duplicate'));
});

test('a positional argument is rejected rather than ignored', () => {
  assert.throws(() => parseFlags(['BD-0001']), /expected a --flag=value argument/);
});

test('an unknown flag is rejected, so a typo is not silently dropped', () => {
  const f = parseFlags(['--precison=day']);
  assert.throws(
    () => rejectUnknownFlags(f, ['precision']),
    /unknown flag\(s\) --precison/,
    'a misspelled --precision must not fall through to "precision missing"',
  );
});

test('--help and -h are always allowed', () => {
  assert.ok(wantsHelp(parseFlags(['--help'])));
  assert.ok(wantsHelp(parseFlags(['-h'])));
  assert.doesNotThrow(() => rejectUnknownFlags(parseFlags(['--help']), []));
});

// ---------------------------------------------------------------------------
// The blocking rule: precision is never defaulted
// ---------------------------------------------------------------------------

test('a missing --precision is an error, NOT a default of day', () => {
  const err = (() => {
    try {
      requirePrecision(parseFlags(['--on=2024-03-14']));
      return null;
    } catch (e) {
      return e as CliError;
    }
  })();
  assert.ok(err, 'it refused');
  assert.match(err!.message, /REQUIRED and is never defaulted/);
  // The message must teach the fix, not just report the omission: this is the
  // refusal an operator hits most often.
  assert.match(err!.message, /--precision=estimated/);
  assert.match(err!.message, /fabricated/);
});

test('--precision with no value is refused too', () => {
  assert.throws(() => requirePrecision(parseFlags(['--precision'])), /never defaulted/);
  assert.throws(() => requirePrecision(parseFlags(['--precision='])), /never defaulted/);
});

test('an invalid precision names the four valid values', () => {
  assert.throws(
    () => requirePrecision(parseFlags(['--precision=exact'])),
    /is not a precision. One of: day \| month \| year \| estimated/,
  );
});

test('all four precisions are accepted', () => {
  for (const p of ['day', 'month', 'year', 'estimated']) {
    assert.equal(requirePrecision(parseFlags([`--precision=${p}`])), p);
  }
});

// ---------------------------------------------------------------------------
// Provenance is not defaulted either
// ---------------------------------------------------------------------------

test('--source-form is required, not defaulted to recall', () => {
  // Defaulting would be safe in the honesty direction but would label a
  // sheet-transcribed event as remembered -- the same dishonesty in a different
  // column.
  assert.throws(
    () => requireProvenance(parseFlags(['--recorded-by=adnan'])),
    /--source-form is required/,
  );
});

test('--recorded-by is required, because the column is NOT NULL', () => {
  assert.throws(
    () => requireProvenance(parseFlags(['--source-form=recall'])),
    /--recorded-by is required/,
  );
});

test('observed_by stays null unless given -- nobody observes a purchase record', () => {
  const p = requireProvenance(parseFlags(['--source-form=import', '--recorded-by=adnan']));
  assert.equal(p.observed_by, null);
  assert.equal(p.source_ref, null);
  assert.equal(p.source_form, 'import');
});

test('an invalid source form names the five valid values', () => {
  assert.throws(
    () => requireProvenance(parseFlags(['--source-form=memory', '--recorded-by=x'])),
    /is not valid. One of: daily_herd_sheet \| cycle_card \| direct_entry \| import \| recall/,
  );
});

// ---------------------------------------------------------------------------
// Dates and strings
// ---------------------------------------------------------------------------

test('dates must be YYYY-MM-DD', () => {
  assert.equal(requireDate(parseFlags(['--on=2024-03-14']), 'on', ''), '2024-03-14');
  assert.throws(() => requireDate(parseFlags(['--on=14/03/2024']), 'on', ''), /must be YYYY-MM-DD/);
  assert.throws(() => requireDate(parseFlags(['--on=2024-3-4']), 'on', ''), /must be YYYY-MM-DD/);
  assert.equal(optDate(parseFlags([]), 'birth-on'), null);
  assert.throws(() => optDate(parseFlags(['--birth-on=nope']), 'birth-on'), /must be YYYY-MM-DD/);
});

test('a required string with no value is refused, not read as true', () => {
  assert.throws(() => requireStr(parseFlags(['--animal']), 'animal', 'hint'), /needs a value/);
  assert.throws(() => requireStr(parseFlags([]), 'animal', 'hint'), /is required \(hint\)/);
});

test('an empty optional string reads as null, not as an empty string', () => {
  assert.equal(optStr(parseFlags(['--name=']), 'name'), null);
  assert.equal(optStr(parseFlags([]), 'name'), null);
  assert.equal(optStr(parseFlags(['--name=Noor']), 'name'), 'Noor');
});

test('optPrecision validates when present and stays null when absent', () => {
  assert.equal(optPrecision(parseFlags([]), 'birth-precision'), null);
  assert.equal(optPrecision(parseFlags(['--birth-precision=year']), 'birth-precision'), 'year');
  assert.throws(
    () => optPrecision(parseFlags(['--birth-precision=exact']), 'birth-precision'),
    /is not a precision/,
  );
});

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

test('every command documents the precision requirement in its usage', () => {
  for (const [name, usage] of [
    ['registry:add', ADD_USAGE],
    ['registry:event', EVENT_USAGE],
    ['registry:calve', CALVE_USAGE],
    ['registry:correct-calving', CORRECT_USAGE],
  ] as const) {
    assert.match(usage, /--precision/, `${name} documents --precision`);
    assert.match(usage, /NEVER defaulted/, `${name} says precision is never defaulted`);
    assert.match(usage, /--recorded-by/, `${name} documents --recorded-by`);
  }
});

test('registry:add explains why it cannot create a farm-born animal', () => {
  assert.match(ADD_USAGE, /ACQUIRED/);
  assert.match(ADD_USAGE, /registry:calve/);
});

test('registry:correct-calving explains the pairing in its usage', () => {
  assert.match(CORRECT_USAGE, /BOTH halves/);
  assert.match(CORRECT_USAGE, /invariant 6/);
  assert.match(CORRECT_USAGE, /Nothing is ever UPDATEd or DELETEd/);
});

// Usage imports run in this isolated test process; guard their entire dependency graph.
test('CLI usage imports never open the live database or seed module', () => {
  const loaded = Object.keys(require.cache).filter(p => /[/\\](db|seed)\.(ts|js)$/.test(p));
  assert.deepEqual(loaded, []);
});

// ---------------------------------------------------------------------------
// The calving commands save over a calving-window warning only with its flag
// ---------------------------------------------------------------------------

/** BD-0001, served by AI on 2025-01-10: the window opens at day 285, the extreme is day 346. */
function servedDam(): Db {
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2019-01-01', acquired_precision: 'year' });
  recordBreedingEvent(db, { animal_id: 'BD-0001', type: 'insemination', occurred_on: '2025-01-10', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_no_heat_sign: true });
  return db;
}
const lastCalvingOf = (db: Db) => effectiveEvents(eventsForAnimal(db, 'BD-0001')).filter((e) => e.type === 'calving').at(-1);
const PROV_FLAGS = ['--source-form=recall', '--recorded-by=test', '--as-of=2026-11-13'];
// Day 280 after the service: before the window.
const CALVE_ARGS = ['--dam=BD-0001', '--on=2025-10-17', '--precision=day', '--calf-sex=female', '--outcome=live', ...PROV_FLAGS];

test('registry:calve refuses a calving before the window unless --allow-calving-before-window is given', (t) => {
  t.mock.method(console, 'log', () => {});
  const db = servedDam();
  assert.throws(() => calveMain(CALVE_ARGS, db), (e: { code?: string }) => e.code === 'calving_before_window');
  assert.throws(() => calveMain([...CALVE_ARGS, '--allow-calving-before-window=false'], db), (e: { code?: string }) => e.code === 'calving_before_window');
  assert.equal(lastCalvingOf(db), undefined);
  calveMain([...CALVE_ARGS, '--allow-calving-before-window', '--override-reason=premature'], db);
  const row = lastCalvingOf(db)!;
  assert.equal(row.occurred_on, '2025-10-17');
  assert.deepEqual(row.override_checks, ['calving_before_window']);
  assert.equal(row.override_reason, 'premature');
});

test('registry:correct-calving refuses a date past the extreme unless --allow-calving-past-extreme is given', (t) => {
  t.mock.method(console, 'log', () => {});
  const db = servedDam();
  // Day 300: inside the window, written plainly.
  calveMain(['--dam=BD-0001', '--on=2025-11-06', '--precision=day', '--calf-sex=female', '--outcome=live', ...PROV_FLAGS], db);
  const original = lastCalvingOf(db)!;
  // Day 347: past the extreme.
  const fix = [`--event=${original.id}`, '--on=2025-12-23', '--precision=day', ...PROV_FLAGS];
  assert.throws(() => correctMain(fix, db), (e: { code?: string }) => e.code === 'calving_past_extreme');
  assert.equal(lastCalvingOf(db)!.id, original.id);
  correctMain([...fix, '--allow-calving-past-extreme', '--override-reason=late record'], db);
  const row = lastCalvingOf(db)!;
  assert.equal(row.occurred_on, '2025-12-23');
  assert.equal(row.supersedes_id, original.id);
  assert.deepEqual(row.override_checks, ['calving_past_extreme']);
  assert.equal(row.override_reason, 'late record');
});

test('registry:calve and registry:correct-calving read --allow-near-duplicate=false as off', (t) => {
  t.mock.method(console, 'log', () => {});
  const db = servedDam();
  const near = (e: { code?: string }) => e.code === 'near_duplicate_calving';
  // Day 300: inside the window, written plainly.
  calveMain(['--dam=BD-0001', '--on=2025-11-06', '--precision=day', '--calf-sex=female', '--outcome=live', ...PROV_FLAGS], db);
  const second = ['--dam=BD-0001', '--on=2025-11-08', '--precision=day', '--calf-sex=female', '--outcome=live', ...PROV_FLAGS];
  assert.throws(() => calveMain([...second, '--allow-near-duplicate=false'], db), near);
  // A year later (past the extreme, saved over), then corrected back to two days after the first.
  calveMain(['--dam=BD-0001', '--on=2026-11-06', '--precision=day', '--calf-sex=female', '--outcome=live', '--allow-calving-past-extreme', '--override-reason=no service on record', ...PROV_FLAGS], db);
  const later = lastCalvingOf(db)!;
  const fix = [`--event=${later.id}`, '--on=2025-11-08', '--precision=day', ...PROV_FLAGS];
  assert.throws(() => correctMain([...fix, '--allow-near-duplicate=false'], db), near);
  assert.equal(lastCalvingOf(db)!.id, later.id);
  correctMain([...fix, '--allow-near-duplicate', '--override-reason=twin entry'], db);
  assert.deepEqual(lastCalvingOf(db)!.override_checks, ['near_duplicate_calving']);
});

test('both calving commands document the window flags', () => {
  for (const usage of [CALVE_USAGE, CORRECT_USAGE]) {
    for (const flag of ['--allow-calving-before-window', '--allow-calving-past-extreme', '--override-reason']) {
      assert.ok(usage.includes(flag), flag);
    }
  }
});
