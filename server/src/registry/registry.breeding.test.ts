// Animal registry -- the breeding write path: four write refusals, plus three correction refusals when supersedes_id is given.

import assert from 'node:assert';
import { test } from 'node:test';

import { USAGE, buildBreedingPayload, buildSupersedesId, flagIsOn } from './breed';
import { recordBreedingEvent } from './breeding';
import { CliError, parseFlags } from './cli';
import { isRegistryError } from './errors';
import { breedingHerd } from './breeding-fixtures';
import { addAcquired, addDeparture, freshDb, RECALL } from './fixtures';
import { checkSnapshot } from './invariants';
import { deriveReproduction } from './reproduction';
import { eventsForAnimal, snapshot } from './store';
import type { Db } from './schema';

function herd(): Db {
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2024-03-01', acquired_precision: 'month' });
  addAcquired(db, { id: 'BD-0002', sex: 'male', acquired_on: '2024-03-01', acquired_precision: 'month' });
  return db;
}
// These tests are about other rules, so the no-heat-sign warning is saved over for them.
const base = { occurred_on: '2026-01-20', date_precision: 'day' as const, provenance: RECALL, allow_no_heat_sign: true };
const refuses = (db: Db, input: object, code: string, field?: string) =>
  assert.throws(
    () => recordBreedingEvent(db, input as never),
    (e: unknown) => isRegistryError(e) && e.code === code && (field === undefined || e.field === field),
  );

test('a service is written as an ordinary appended event', () => {
  const db = herd();
  const { event_id } = recordBreedingEvent(db, { ...base, animal_id: 'BD-0001', type: 'insemination', payload: { service_type: 'ai' } });
  const row = eventsForAnimal(db, 'BD-0001').find((e) => e.id === event_id)!;
  assert.deepEqual([row.type, row.payload], ['insemination', { service_type: 'ai', exposure_days: null }]);
  assert.deepEqual(row.override_checks, ['no_heat_sign']);
  assert.deepEqual(checkSnapshot(snapshot(db), '2026-11-13').filter((v) => v.invariant === 29), []);
});

test('the four refusals', () => {
  const db = herd();
  const ai = { type: 'insemination', payload: { service_type: 'ai' } };
  refuses(db, { ...base, ...ai, animal_id: 'BD-0099' }, 'unknown_animal');
  refuses(db, { ...base, ...ai, animal_id: 'BD-0002' }, 'not_female');
  refuses(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-01-01', date_precision: 'year' }, 'breeding_precision');
  refuses(db, { ...base, animal_id: 'BD-0001', type: 'pregnancy_check', payload: { method: 'ultrasound', result: 'positive' }, occurred_on: '2026-03-01', date_precision: 'month' }, 'breeding_precision');
  refuses(db, { ...base, animal_id: 'BD-0001', type: 'insemination', payload: { service_type: 'bull_exposure', exposure_days: 30 }, occurred_time: '07:30' }, 'breeding_precision');
  refuses(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2023-06-10' }, 'event_before_origin');
  addDeparture(db, { animal_id: 'BD-0001', on: '2026-06-01', precision: 'day' });
  refuses(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-07-01' }, 'animal_departed');
});

test('uncertain dates are not grounds to refuse', () => {
  const db = herd();
  // Acquired "March 2024"; a service on 15 March 2024 is not definitely before it.
  recordBreedingEvent(db, { ...base, animal_id: 'BD-0001', type: 'insemination', payload: { service_type: 'ai' }, occurred_on: '2024-03-15' });
  // A service entered out of order, dated before a later departure, is fine.
  addDeparture(db, { animal_id: 'BD-0001', on: '2026-06-01', precision: 'day' });
  recordBreedingEvent(db, { ...base, animal_id: 'BD-0001', type: 'heat_observed', payload: { sign: 'standing' }, occurred_on: '2026-05-20', occurred_time: '18:30' });
});

test('the CLI turns flags into the payload for each type, and refuses a stray flag', () => {
  const p = (type: Parameters<typeof buildBreedingPayload>[0], ...argv: string[]) =>
    buildBreedingPayload(type, parseFlags(argv));
  assert.deepEqual(p('heat_observed', '--sign=standing'), { sign: 'standing' });
  assert.deepEqual(p('insemination', '--service=ai'), { service_type: 'ai' });
  assert.deepEqual(p('insemination', '--service=bull_exposure', '--days=30'), { service_type: 'bull_exposure', exposure_days: 30 });
  assert.deepEqual(p('pregnancy_check', '--method=pag', '--result=negative'), { method: 'pag', result: 'negative' });
  assert.deepEqual(p('abortion'), {});
  assert.deepEqual(p('null_observation', '--watched-for=heat'), { watched_for: 'heat' });
  for (const bad of [
    () => p('insemination', '--service=ai', '--days=30'),
    () => p('insemination', '--service=bull_exposure'),
    () => p('heat_observed', '--sign=loud'),
    () => p('abortion', '--sign=standing'),
  ]) assert.throws(bad, CliError);
  assert.match(USAGE, /NEVER defaulted/);
  assert.match(USAGE, /--recorded-by/);
});

const ai = { type: 'insemination' as const, payload: { service_type: 'ai' } };

test('a corrected service: the original stays, the correction supersedes it, the state follows the correction', () => {
  const db = herd();
  const first = recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-01-20' }).event_id;
  const before = eventsForAnimal(db, 'BD-0001').find((e) => e.id === first)!;
  const second = recordBreedingEvent(db, {
    ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-02-20', supersedes_id: first,
  }).event_id;

  const events = eventsForAnimal(db, 'BD-0001');
  assert.equal(events.filter((e) => e.type === 'insemination').length, 2);
  assert.deepEqual(events.find((e) => e.id === first), before);
  assert.equal(events.find((e) => e.id === second)!.supersedes_id, first);

  const view = deriveReproduction({ events, asOf: '2026-11-13', inMilk: false })!;
  assert.ok(view, 'a reproduction view is derived');
  assert.equal(view.conception_earliest, '2026-02-20');
  assert.equal(view.services_in_case, 1);
  const bad = checkSnapshot(snapshot(db), '2026-11-13').filter((v) => v.invariant === 9 || v.invariant === 29);
  assert.deepEqual(bad, []);
});

test('the three correction refusals', () => {
  const db = herd();
  addAcquired(db, { id: 'BD-0003', sex: 'female', acquired_on: '2024-03-01', acquired_precision: 'month' });
  const first = recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0001' }).event_id;
  const other = recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0003' }).event_id;
  const check = { type: 'pregnancy_check', payload: { method: 'ultrasound', result: 'positive' }, occurred_on: '2026-03-01' };

  refuses(db, { ...base, ...ai, animal_id: 'BD-0001', supersedes_id: 'no-such-event' }, 'unknown_event', 'supersedes_id');
  refuses(db, { ...base, ...ai, animal_id: 'BD-0001', supersedes_id: other }, 'unknown_event', 'supersedes_id');
  refuses(db, { ...base, animal_id: 'BD-0001', ...check, supersedes_id: first }, 'supersede_type_mismatch', 'supersedes_id');

  const second = recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-02-20', supersedes_id: first }).event_id;
  assert.throws(
    () => recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-02-21', supersedes_id: first }),
    (e: unknown) => isRegistryError(e) && e.code === 'already_superseded' && e.message.includes(second) && e.field === 'supersedes_id',
  );
  // Nothing was written by the refusals.
  assert.equal(eventsForAnimal(db, 'BD-0001').filter((e) => e.type === 'insemination').length, 2);
});

test('a correction dated after the animal left is still refused', () => {
  const db = herd();
  const first = recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0001' }).event_id;
  addDeparture(db, { animal_id: 'BD-0001', on: '2026-06-01', precision: 'day' });
  refuses(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-07-01', supersedes_id: first }, 'animal_departed');
});

test('--supersedes parses to an event id, is optional, and must not be empty', () => {
  assert.equal(buildSupersedesId(parseFlags(['--supersedes=ev-123'])), 'ev-123');
  assert.equal(buildSupersedesId(parseFlags([])), null);
  assert.throws(() => buildSupersedesId(parseFlags(['--supersedes='])), CliError);
  assert.match(USAGE, /--supersedes/);
});

// ---------------------------------------------------------------------------
// Stage 2: the write path warns, and records an override from the condition.
// ---------------------------------------------------------------------------

const countEvents = (db: Db, id: string) => eventsForAnimal(db, id).length;
const heerCheck = {
  animal_id: 'BD-0007',
  type: 'pregnancy_check',
  occurred_on: '2026-11-13',
  date_precision: 'day',
  payload: { method: 'palpation', result: 'positive' },
  provenance: RECALL,
};

test('an early check is refused until the caller saves over it', () => {
  const db = breedingHerd();
  const before = countEvents(db, 'BD-0007');
  refuses(db, heerCheck, 'early_check', 'occurred_on');
  assert.equal(countEvents(db, 'BD-0007'), before);
  const { event_id } = recordBreedingEvent(db, {
    ...heerCheck,
    allow_early_check: true,
    override_reason: 'vet was here anyway',
  } as never);
  assert.equal(countEvents(db, 'BD-0007'), before + 1);
  const row = eventsForAnimal(db, 'BD-0007').find((e) => e.id === event_id)!;
  assert.deepEqual(row.override_checks, ['early_check']);
  assert.equal(row.override_reason, 'vet was here anyway');
});

test('a flag with nothing to override records nothing', () => {
  const db = breedingHerd();
  const { event_id } = recordBreedingEvent(db, {
    ...heerCheck,
    payload: { method: 'ultrasound', result: 'positive' },
    allow_ambiguous_service: true,
    allow_early_check: true,
    allow_check_without_service: true,
  } as never);
  const row = eventsForAnimal(db, 'BD-0007').find((e) => e.id === event_id)!;
  assert.deepEqual(row.override_checks, []);
  assert.equal(row.override_reason, null);
});

// A service on BD-0006 joins her case with no heat sign: two warnings, so the code is breeding_warnings,
// and `ambiguous_service` must still be among them with nothing written.
const refusesWithAmbiguous = (db: Db, input: object) => {
  const before = countEvents(db, 'BD-0006');
  assert.throws(
    () => recordBreedingEvent(db, input as never),
    (e: unknown) =>
      isRegistryError(e) && e.code === 'breeding_warnings' && (e.warnings ?? []).map((w) => w.check).includes('ambiguous_service'),
  );
  assert.equal(countEvents(db, 'BD-0006'), before);
};

test('the flag for another warning does not save over this one', () => {
  const db = breedingHerd();
  refusesWithAmbiguous(
    db,
    { animal_id: 'BD-0006', type: 'insemination', occurred_on: '2026-09-23', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_early_check: true },
  );
  // Even the other service warning's flag does not save over ambiguous_service.
  refusesWithAmbiguous(
    db,
    { animal_id: 'BD-0006', type: 'insemination', occurred_on: '2026-09-23', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL, allow_early_check: true, allow_no_heat_sign: true },
  );
});

test('a second service dated the same day as the first still warns', () => {
  const db = breedingHerd();
  refusesWithAmbiguous(
    db,
    { animal_id: 'BD-0006', type: 'insemination', occurred_on: '2026-09-02', date_precision: 'day', payload: { service_type: 'ai' }, provenance: RECALL },
  );
});

test('a refusal still wins over a warning', () => {
  const db = breedingHerd();
  refuses(db, { ...heerCheck, date_precision: 'month' }, 'breeding_precision');
});

test('USAGE names the four override flags', () => {
  for (const f of ['--allow-ambiguous-service', '--allow-early-check', '--allow-check-without-service', '--override-reason']) {
    assert.ok(USAGE.includes(f), f);
  }
});

// ---------------------------------------------------------------------------
// Stage 3: several warnings on one write, and every one recorded.
// ---------------------------------------------------------------------------

const mothService = {
  animal_id: 'BD-0006',
  type: 'insemination',
  occurred_on: '2026-09-23',
  date_precision: 'day',
  payload: { service_type: 'ai' },
  provenance: RECALL,
};

test('two warnings are refused together and write nothing', () => {
  const db = breedingHerd();
  const before = countEvents(db, 'BD-0006');
  assert.throws(
    () => recordBreedingEvent(db, mothService as never),
    (e: unknown) =>
      isRegistryError(e) &&
      e.code === 'breeding_warnings' &&
      e.field === 'occurred_on' &&
      e.warnings?.map((w) => w.check).join() === 'ambiguous_service,no_heat_sign' &&
      e.message === e.warnings.map((w) => w.message).join(' ') &&
      JSON.stringify(e.toWire().warnings) === JSON.stringify(e.warnings),
  );
  assert.equal(countEvents(db, 'BD-0006'), before);
});

test('one flag of two still refuses', () => {
  const db = breedingHerd();
  refuses(db, { ...mothService, allow_ambiguous_service: true }, 'breeding_warnings');
  refuses(db, { ...mothService, allow_no_heat_sign: true }, 'breeding_warnings');
});

test('a single warning carries its own code and a one-item warnings list', () => {
  const db = breedingHerd();
  assert.throws(
    () => recordBreedingEvent(db, { ...mothService, animal_id: 'BD-0009', occurred_on: '2026-11-13' } as never),
    (e: unknown) => isRegistryError(e) && e.code === 'no_heat_sign' && e.field === 'occurred_on' && e.warnings?.length === 1 && e.warnings[0].check === 'no_heat_sign',
  );
});

test('both flags write one event that records both checks', () => {
  const db = breedingHerd();
  const { event_id } = recordBreedingEvent(db, { ...mothService, allow_ambiguous_service: true, allow_no_heat_sign: true, override_reason: 'owner saw it' } as never);
  const row = eventsForAnimal(db, 'BD-0006').find((e) => e.id === event_id)!;
  assert.deepEqual(row.override_checks, ['ambiguous_service', 'no_heat_sign']);
  assert.equal(row.override_reason, 'owner saw it');
});

test('a heat after a positive check is refused until its flag is given', () => {
  const db = breedingHerd();
  const heat = { animal_id: 'BD-0004', type: 'heat_observed', occurred_on: '2026-10-01', date_precision: 'day', payload: { sign: 'standing' }, provenance: RECALL };
  refuses(db, heat, 'heat_after_positive', 'occurred_on');
  const { event_id } = recordBreedingEvent(db, { ...heat, allow_heat_after_positive: true } as never);
  assert.deepEqual(eventsForAnimal(db, 'BD-0004').find((e) => e.id === event_id)!.override_checks, ['heat_after_positive']);
});

test('flags with nothing fired record an empty list', () => {
  const db = breedingHerd();
  const { event_id } = recordBreedingEvent(db, { ...heerCheck, payload: { method: 'ultrasound', result: 'positive' }, allow_no_heat_sign: true, allow_heat_after_positive: true } as never);
  assert.deepEqual(eventsForAnimal(db, 'BD-0007').find((e) => e.id === event_id)!.override_checks, []);
});

test('--allow-x=false is false, and USAGE names the two new flags', () => {
  assert.equal(flagIsOn(parseFlags(['--allow-early-check=false']), 'allow-early-check'), false);
  assert.equal(flagIsOn(parseFlags(['--allow-early-check']), 'allow-early-check'), true);
  assert.equal(flagIsOn(parseFlags(['--allow-early-check=true']), 'allow-early-check'), true);
  assert.equal(flagIsOn(parseFlags([]), 'allow-early-check'), false);
  assert.throws(() => flagIsOn(parseFlags(['--allow-early-check=maybe']), 'allow-early-check'), CliError);
  for (const f of ['--allow-no-heat-sign', '--allow-heat-after-positive']) assert.ok(USAGE.includes(f), f);
});

test('a correction is warned about as the candidate, with the superseded service left out', () => {
  const db = herd();
  const first = recordBreedingEvent(db, { ...base, ...ai, animal_id: 'BD-0001', occurred_on: '2026-01-20' }).event_id;
  // Without supersedes_id the second service a day later joins the first one's case and is ambiguous.
  const flags = { ...base, allow_no_heat_sign: true, allow_ambiguous_service: false };
  refuses(db, { ...flags, ...ai, animal_id: 'BD-0001', occurred_on: '2026-01-21' }, 'breeding_warnings');
  // As a correction, the first service is not an earlier service in the case: only the heat check fires, and it is saved over.
  const second = recordBreedingEvent(db, { ...flags, ...ai, animal_id: 'BD-0001', occurred_on: '2026-01-21', supersedes_id: first }).event_id;
  assert.deepEqual(eventsForAnimal(db, 'BD-0001').find((e) => e.id === second)!.override_checks, ['no_heat_sign']);
});
