// Animal registry -- the two stage 4 calving warnings: a calving before the
// calving window, and a calving past the sourced extreme, measured from the
// breeding case the calving closes (docs/records/REGISTRY_BREEDING.md).

import assert from 'node:assert';
import { test } from 'node:test';

import { correctCalving, recordCalving } from './calving';
import type { RecordCalvingInput } from './calving';
import { recordBreedingEvent } from './breeding';
import { isRegistryError } from './errors';
import type { RegistryError } from './errors';
import { addAcquired, calve, freshDb, RECALL } from './fixtures';
import { effectiveEvents } from './project';
import { addDays } from './reproduction';
import { eventsForAnimal } from './store';
import type { Db } from './schema';
import type { DatePrecision, RegistryEvent } from './types';

const AS_OF = '2026-11-13';
const SERVICE = '2025-01-10';

function dam(service?: { on: string; precision: DatePrecision }): Db {
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2019-01-01', acquired_precision: 'year' });
  if (service) {
    recordBreedingEvent(db, {
      animal_id: 'BD-0001',
      type: 'insemination',
      occurred_on: service.on,
      date_precision: service.precision,
      payload: { service_type: 'ai' },
      provenance: RECALL,
      allow_no_heat_sign: true,
    });
  }
  return db;
}
const served = () => dam({ on: SERVICE, precision: 'day' });

const calving = (on: string, over: Partial<RecordCalvingInput> = {}): RecordCalvingInput => ({
  dam_id: 'BD-0001',
  occurred_on: on,
  date_precision: 'day',
  calf: { sex: 'female', outcome: 'live' },
  provenance: RECALL,
  asOf: AS_OF,
  breeding: true,
  ...over,
});

function lastCalving(db: Db): RegistryEvent {
  const all = effectiveEvents(eventsForAnimal(db, 'BD-0001')).filter((e) => e.type === 'calving');
  return all[all.length - 1];
}

function refusal(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (e) {
    if (isRegistryError(e)) return e;
    throw e;
  }
  assert.fail('expected a refusal');
}

const before = (d: number, service = SERVICE) =>
  `This calving is ${d} days after the earliest possible conception for BD-0001 (service on ${service}). ` +
  `The calving window opens at day 285; check the service or the calving date. Saved, the calving counts as it is.`;
const past = (d: number) =>
  `This calving is ${d} days after the latest possible conception for BD-0001, past the 346-day extreme. ` +
  `A service is probably missing from her record. Saved, the calving counts as it is.`;

test('a calving 280 days after a day-precision AI is before the window', () => {
  const db = served();
  const e = refusal(() => recordCalving(db, calving(addDays(SERVICE, 280))));
  assert.equal(e.code, 'calving_before_window');
  assert.equal(e.field, 'occurred_on');
  assert.equal(e.message, before(280));
  assert.deepEqual(e.warnings, [{ check: 'calving_before_window', message: before(280) }]);
  assert.equal(lastCalving(db), undefined, 'nothing written');
});

test('285 days: no warning', () => {
  const db = served();
  recordCalving(db, calving(addDays(SERVICE, 285)));
  assert.deepEqual(lastCalving(db).override_checks, []);
});

test('347 days after the latest conception is past the extreme; 346 is not', () => {
  const db = served();
  const e = refusal(() => recordCalving(db, calving(addDays(SERVICE, 347))));
  assert.equal(e.code, 'calving_past_extreme');
  assert.equal(e.field, 'occurred_on');
  assert.equal(e.message, past(347));
  assert.deepEqual(e.warnings, [{ check: 'calving_past_extreme', message: past(347) }]);

  const ok = served();
  recordCalving(ok, calving(addDays(SERVICE, 346)));
  assert.deepEqual(lastCalving(ok).override_checks, []);
});

test('a month-precision service: conception 1 to 31 March', () => {
  const db = dam({ on: '2025-03-01', precision: 'month' });
  recordCalving(db, calving(addDays('2025-03-01', 290)));
  assert.deepEqual(lastCalving(db).override_checks, [], '290 days after 1 Mar is inside the window');

  const late = dam({ on: '2025-03-01', precision: 'month' });
  const e = refusal(() => recordCalving(late, calving(addDays('2025-03-31', 350))));
  assert.equal(e.code, 'calving_past_extreme');
  assert.equal(e.message, past(350));
});

test('a dam with no service: no warning', () => {
  const db = dam();
  recordCalving(db, calving('2025-10-17'));
  assert.deepEqual(lastCalving(db).override_checks, []);
});

test('saved over: allow_calving_before_window records the check from the condition', () => {
  const db = served();
  recordCalving(db, calving(addDays(SERVICE, 280), { allow_calving_before_window: true, override_reason: 'premature' }));
  const row = lastCalving(db);
  assert.deepEqual(row.override_checks, ['calving_before_window']);
  assert.equal(row.override_reason, 'premature');
});

test('a flag with nothing fired records nothing', () => {
  const db = served();
  recordCalving(db, calving(addDays(SERVICE, 300), { allow_calving_before_window: true, allow_calving_past_extreme: true }));
  assert.deepEqual(lastCalving(db).override_checks, []);
});

test('breeding off: the same 280-day calving writes plainly', () => {
  const db = served();
  recordCalving(db, calving(addDays(SERVICE, 280), { breeding: false }));
  assert.deepEqual(lastCalving(db).override_checks, []);
  const absent = served();
  const { breeding: _ignored, ...input } = calving(addDays(SERVICE, 280));
  recordCalving(absent, input);
  assert.deepEqual(lastCalving(absent).override_checks, []);
});

test('the flag for one check does not save over another', () => {
  const db = served();
  const e = refusal(() => recordCalving(db, calving(addDays(SERVICE, 280), { allow_calving_past_extreme: true })));
  assert.equal(e.code, 'calving_before_window');
});

test('two fired: breeding_warnings with both, and one override list when both are allowed', () => {
  const near = addDays(SERVICE, 250);
  const on = addDays(SERVICE, 280);
  const nearMessage =
    `dam 'BD-0001' already has a calving on ${near}, within 60 days of ${on}. This is far more ` +
    `likely a double entry than a real second calving. Pass allow_near_duplicate: true if it is genuinely a separate event.`;
  const db = served();
  calve(db, { dam_id: 'BD-0001', on: near, precision: 'day' });
  const e = refusal(() => recordCalving(db, calving(on, { allow_near_duplicate: true })));
  assert.equal(e.code, 'breeding_warnings');
  assert.equal(e.field, 'occurred_on');
  assert.equal(e.message, `${nearMessage} ${before(280)}`);
  assert.deepEqual(e.warnings, [
    { check: 'near_duplicate_calving', message: nearMessage },
    { check: 'calving_before_window', message: before(280) },
  ]);

  recordCalving(db, calving(on, { allow_near_duplicate: true, allow_calving_before_window: true }));
  assert.deepEqual(lastCalving(db).override_checks, ['near_duplicate_calving', 'calving_before_window']);
});

test('breeding on, only the near-duplicate fires: its code, field occurred_on, and warnings', () => {
  const db = dam();
  calve(db, { dam_id: 'BD-0001', on: '2025-06-01', precision: 'day' });
  const e = refusal(() => recordCalving(db, calving('2025-06-20')));
  assert.equal(e.code, 'near_duplicate_calving');
  assert.equal(e.field, 'occurred_on');
  assert.deepEqual(e.warnings, [{ check: 'near_duplicate_calving', message: e.message }]);
});

test('breeding off, the near-duplicate refusal is as in stage 3: no field, no warnings', () => {
  const db = dam();
  calve(db, { dam_id: 'BD-0001', on: '2025-06-01', precision: 'day' });
  const e = refusal(() => recordCalving(db, calving('2025-06-20', { breeding: false })));
  assert.equal(e.code, 'near_duplicate_calving');
  assert.deepEqual(e.toWire(), { error: 'near_duplicate_calving', message: e.message });
});

test('correctCalving to a date 280 days after the service warns', () => {
  const db = served();
  const r = recordCalving(db, calving(addDays(SERVICE, 300)));
  const correct = (over: object = {}) =>
    correctCalving(db, {
      calving_event_id: r.calving_event_id,
      occurred_on: addDays(SERVICE, 280),
      date_precision: 'day',
      provenance: RECALL,
      asOf: AS_OF,
      breeding: true,
      ...over,
    });
  const e = refusal(() => correct());
  assert.equal(e.code, 'calving_before_window');
  assert.deepEqual(e.warnings, [{ check: 'calving_before_window', message: before(280) }]);

  correct({ allow_calving_before_window: true });
  assert.deepEqual(lastCalving(db).override_checks, ['calving_before_window']);
});

test('correctCalving with breeding off writes the same date plainly', () => {
  const db = served();
  const r = recordCalving(db, calving(addDays(SERVICE, 300)));
  correctCalving(db, {
    calving_event_id: r.calving_event_id,
    occurred_on: addDays(SERVICE, 280),
    date_precision: 'day',
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.deepEqual(lastCalving(db).override_checks, []);
});
