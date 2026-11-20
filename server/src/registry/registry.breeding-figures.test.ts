// Breeding stage 4: the eight herd figures, on small hand-built herds.
//
// Every herd is chosen so each count can be checked by hand. The figures read
// breedingCases and deriveReproduction; the case and state rules are pinned in
// registry.breeding-cases.test.ts and registry.reproduction.test.ts.

import assert from 'node:assert';
import { test } from 'node:test';

import { breedingFigures } from './breeding-figures';
import { addAcquired, freshDb, RECALL, resetRecordedSeq } from './fixtures';
import { addDays } from './reproduction';
import type { Db } from './schema';
import { appendEvent } from './store';
import type { DatePrecision, RegistryEventType } from './types';

const ON = '2026-11-13'; // P for 12m is 2025-11-14 .. 2026-11-13

type Step = { type: RegistryEventType; on: string; payload: Record<string, unknown>; precision?: DatePrecision };
const svc = (on: string): Step => ({ type: 'insemination', on, payload: { service_type: 'ai', exposure_days: null } });
const check = (on: string, result: 'positive' | 'negative', method = 'ultrasound'): Step =>
  ({ type: 'pregnancy_check', on, payload: { method, result } });
const pos = (on: string, method?: string): Step => check(on, 'positive', method);
const neg = (on: string): Step => check(on, 'negative');
const heat = (on: string): Step => ({ type: 'heat_observed', on, payload: { sign: 'standing' } });
const calving = (on: string, precision: DatePrecision = 'day'): Step =>
  ({ type: 'calving', on, precision, payload: { calf_id: 'BD-9999', calf_sex: 'male', outcome: 'live' } });

/** A female per key, her steps written in order (recorded_at strictly increasing). */
function herd(cows: Record<string, Step[]>): Db {
  resetRecordedSeq();
  const db = freshDb();
  let seq = 0;
  for (const id of Object.keys(cows)) {
    addAcquired(db, { id, sex: 'female', name: `cow ${id}`, acquired_on: '2020-01-01', acquired_precision: 'day', birth_on: '2018-01-01', birth_precision: 'day' });
  }
  for (const [id, steps] of Object.entries(cows)) {
    for (const s of steps) {
      seq += 1;
      appendEvent(db, {
        animal_id: id,
        type: s.type,
        occurred_on: s.on,
        date_precision: s.precision ?? 'day',
        payload: s.payload,
        provenance: RECALL,
        recorded_at: `2026-02-01T00:00:00.${String(seq).padStart(3, '0')}Z`,
      });
    }
  }
  return db;
}

const id = (n: number) => `BD-${String(n).padStart(4, '0')}`;
/** n cows with the same steps. */
function many(n: number, steps: Step[], start = 1): Record<string, Step[]> {
  const out: Record<string, Step[]> = {};
  for (let i = 0; i < n; i += 1) out[id(start + i)] = steps;
  return out;
}

// A calving before P, one service in P, a reliable positive on day 40.
const HELD: Step[] = [calving('2025-03-01'), svc('2025-12-01'), pos('2026-01-10')];
// The same, but the first service failed on a heat and she was served again on it.
const HELD_ON_SECOND: Step[] = [calving('2025-03-01'), svc('2025-12-01'), heat('2025-12-22'), svc('2025-12-22'), pos('2026-01-31')];

test('three held cases: services per conception shows the counts and no value', () => {
  const f = breedingFigures(herd(many(3, HELD)), ON, '12m');
  assert.deepEqual(f.services_per_conception, { services: 3, conceptions: 3, value: null });
  assert.equal(f.on, ON);
  assert.equal(f.period, '12m');
  assert.equal(f.from, '2025-11-14');
  assert.equal(f.animals, 3);
});

test('ten held cases with thirteen services: 1.3 services per conception', () => {
  const f = breedingFigures(herd({ ...many(7, HELD), ...many(3, HELD_ON_SECOND, 8) }), ON, '12m');
  assert.deepEqual(f.services_per_conception, { services: 13, conceptions: 10, value: 1.3 });
  // Ten first services after a calving: 7 held, 3 failed, so a rate is shown (a whole percent).
  assert.deepEqual(f.held_to_first_service, { n: 7, of: 10, rate: 70, pending: 0 });
});

test('held to first service: 4 held, 3 failed, 2 pending of 9 first services', () => {
  const failed: Step[] = [calving('2025-09-01'), svc('2025-12-01'), neg('2026-01-10')];
  const pending: Step[] = [calving('2026-06-01'), svc('2026-10-20')];
  const f = breedingFigures(herd({ ...many(4, HELD), ...many(3, failed, 5), ...many(2, pending, 8) }), ON, '12m');
  assert.deepEqual(f.held_to_first_service, { n: 4, of: 7, rate: null, pending: 2 });
});

test('confirmed by day 60: days 42, 58, 63 and 74', () => {
  const cows: Record<string, Step[]> = {};
  [42, 58, 63, 74].forEach((day, i) => {
    cows[id(i + 1)] = [calving('2025-09-01'), svc('2026-03-01'), pos(addDays('2026-03-01', day))];
  });
  const f = breedingFigures(herd(cows), ON, '12m');
  assert.deepEqual(f.confirmed_by_day_60, { n: 2, of: 4, rate: null, later_days: [63, 74] });
});

test('days open 67, 97 and 148: the median is 97', () => {
  const cows: Record<string, Step[]> = {};
  [148, 67, 97].forEach((days, i) => {
    const served = addDays('2025-10-01', days);
    cows[id(i + 1)] = [calving('2025-10-01'), svc(served), pos(addDays(served, 40))];
  });
  const f = breedingFigures(herd(cows), ON, '12m');
  assert.deepEqual(f.days_open, { value: 97, n: 3, min: 67, max: 148, approximate: 0 });
});

test('days open from a month-precision calving is counted approximate', () => {
  const f = breedingFigures(herd({ [id(1)]: [calving('2025-10-01', 'month'), svc('2025-12-15'), pos('2026-01-24')] }), ON, '12m');
  assert.equal(f.days_open.n, 1);
  assert.equal(f.days_open.approximate, 1);
});

test('calving intervals 408 and 430: the mean is 419', () => {
  const first = '2025-01-01';
  const f = breedingFigures(
    herd({
      [id(1)]: [calving(first), svc(addDays(first, 100)), calving(addDays(first, 408))],
      [id(2)]: [calving(first), svc(addDays(first, 122)), calving(addDays(first, 430))],
    }),
    ON,
    '12m',
  );
  assert.deepEqual(f.calving_interval, { value: 419, n: 2, min: 408, max: 430, approximate: 0 });
});

test('one inferred loss of four confirmed cases', () => {
  const confirmed: Step[] = [calving('2025-09-01'), svc('2026-03-01'), pos('2026-04-10')];
  const f = breedingFigures(herd({ ...many(3, confirmed), [id(4)]: [...confirmed, neg('2026-05-20')] }), ON, '12m');
  assert.deepEqual(f.losses, { n: 1, of: 4, rate: null });
});

/** Open on the heat of `heatOn` until the service of 2026-09-23 (no check on the earlier services). */
const openFrom = (heatOn: string) =>
  herd({ [id(1)]: [calving('2025-06-01'), svc('2025-10-01'), svc('2026-07-01'), heat(heatOn), svc('2026-09-23')] });

test('a female open for 63 days of P is expected to show 3 heats, and for 62 days 2', () => {
  // Unconfirmed from 2025-10-01 (no check), open on the heat of 2026-07-22, served again
  // on 2026-09-23: open 2026-07-22 .. 2026-09-22, 63 days. A heat a day later: 62 days.
  assert.deepEqual(breedingFigures(openFrom('2026-07-22'), ON, '12m').heats_caught, { recorded: 1, expected: 3, estimated: true });
  assert.deepEqual(breedingFigures(openFrom('2026-07-23'), ON, '12m').heats_caught, { recorded: 1, expected: 2, estimated: true });
});

test('a female calved 45 days ago or more with no service since is eligible', () => {
  // Calved 2026-09-01: eligible from 2026-10-16 to ON, 29 days -> 1 expected heat.
  // She needs a view to be a current female, so an earlier service closed by this calving.
  const f = breedingFigures(herd({ [id(1)]: [calving('2025-06-01'), svc('2025-11-01'), calving('2026-09-01')] }), ON, '12m');
  assert.equal(f.heats_caught.expected, 1);
});

test('a dam with calvings and no service still counts for the calving interval', () => {
  const f = breedingFigures(herd({ [id(1)]: [calving('2025-08-01'), calving('2026-09-01')] }), ON, '12m');
  assert.deepEqual(f.calving_interval, { value: 396, n: 1, min: 396, max: 396, approximate: 0 });
  assert.equal(f.animals, 0);
  assert.deepEqual(f.by_animal, []);
});

test('a calved cow never served is eligible from day 45 of her calving', () => {
  // Calved 2026-05-01: eligible 2026-06-15 .. 2026-11-13 = 16 + 31 + 31 + 30 + 31 + 13 = 152 days -> 7.
  const f = breedingFigures(herd({ [id(1)]: [calving('2026-05-01')] }), ON, '12m');
  assert.deepEqual(f.heats_caught, { recorded: 0, expected: 7, estimated: true });
});

test('days open leaves out a span with a year or estimated date, with a rough line', () => {
  const year = breedingFigures(herd({ [id(1)]: [calving('2025-01-01', 'year'), svc('2025-12-01'), pos('2026-01-10')] }), ON, '12m');
  assert.deepEqual(year.days_open, { value: null, n: 0, min: null, max: null, approximate: 0 });
  assert.deepEqual(year.rough, [
    '1 days-open span left out because a date is known only to the year or estimated',
    'expected heats are estimated',
  ]);
  const both = breedingFigures(
    herd({
      [id(1)]: [calving('2025-01-01', 'year'), svc('2025-12-01'), pos('2026-01-10')],
      [id(2)]: [calving('2025-01-01', 'estimated'), svc('2025-12-01'), pos('2026-01-10')],
      [id(3)]: HELD,
    }),
    ON,
    '12m',
  );
  assert.equal(both.days_open.n, 1);
  assert.equal(both.rough[0], '2 days-open spans left out because a date is known only to the year or estimated');
});

test('"no outcome yet" counts services, not cases', () => {
  // Two services with nothing between them join one pending case.
  const f = breedingFigures(herd({ [id(1)]: [calving('2026-06-01'), svc('2026-10-01'), svc('2026-10-20')] }), ON, '12m');
  assert.equal(f.rough[0], '2 services have no outcome yet');
});

test('period all includes a case before P that 12m leaves out', () => {
  const db = herd({ [id(1)]: [calving('2024-01-01'), svc('2024-03-01'), pos('2024-04-10')] });
  const year = breedingFigures(db, ON, '12m');
  const all = breedingFigures(db, ON, 'all');
  assert.equal(year.services_per_conception.conceptions, 0);
  assert.equal(all.services_per_conception.conceptions, 1);
  assert.equal(year.animals, 0);
  assert.equal(all.animals, 1);
  assert.equal(all.from, null);
});

test('overdue now ignores P and lists the animal with her day', () => {
  // Positive in 2025, never calved: past day 325 + W on ON.
  const f = breedingFigures(herd({ [id(1)]: [calving('2024-06-01'), svc('2025-09-01'), pos('2025-10-15')] }), ON, '12m');
  assert.equal(f.overdue_now.n, 1);
  assert.deepEqual(f.overdue_now.animals, [{ animal_id: id(1), animal_name: 'cow BD-0001', day_max: 438 }]);
});

test('replaced cases are counted apart, with a rough line each', () => {
  const f = breedingFigures(
    herd({
      // A reliable positive, then a heat and a new service with no loss recorded.
      [id(1)]: [calving('2025-03-01'), svc('2025-12-01'), pos('2026-01-10'), heat('2026-02-20'), svc('2026-02-20'), pos('2026-04-01')],
      // A progesterone positive never counts on its own: no outcome, then a new service.
      [id(2)]: [calving('2025-03-01'), svc('2026-01-01'), pos('2026-01-25', 'progesterone'), heat('2026-02-10'), svc('2026-02-10')],
      // No earlier calving on file.
      [id(3)]: [svc('2025-12-01'), pos('2026-01-10')],
    }),
    ON,
    '12m',
  );
  // Held: BD-0001's second case (2 services since calving) and BD-0003 (1); the replaced case is out.
  assert.deepEqual(f.services_per_conception, { services: 3, conceptions: 2, value: null });
  // First services after a calving (or ever): BD-0001's and BD-0002's are replaced and do not
  // count; BD-0003's first service ever held.
  assert.deepEqual(f.held_to_first_service, { n: 1, of: 1, rate: null, pending: 0 });
  // Reliable positives in P on held cases: BD-0001's second (day 40) and BD-0003 (day 40).
  assert.deepEqual(f.confirmed_by_day_60, { n: 2, of: 2, rate: null, later_days: [] });
  assert.deepEqual(f.losses, { n: 0, of: 2, rate: null });
  assert.deepEqual(f.rough, [
    '1 service has no outcome yet',
    '1 animal has no earlier calving',
    '1 confirmed pregnancy followed by a new service with no loss recorded',
    '1 service followed by a new service with no outcome recorded',
    'expected heats are estimated',
  ]);
});

test('rough lines are plural when k is not 1', () => {
  const f = breedingFigures(herd({ ...many(2, [svc('2026-11-01')]), ...many(2, [svc('2025-12-01'), pos('2026-01-10')], 3) }), ON, '12m');
  assert.deepEqual(f.rough, ['2 services have no outcome yet', '2 animals have no earlier calving', 'expected heats are estimated']);
});

test('by animal: one row per female with a service in P', () => {
  const f = breedingFigures(
    herd({
      [id(1)]: [calving('2025-10-01'), svc('2025-12-07'), pos('2026-01-16')],
      [id(2)]: [calving('2024-01-01'), svc('2024-03-01'), pos('2024-04-10')], // nothing in P
    }),
    ON,
    '12m',
  );
  assert.deepEqual(f.by_animal, [
    { animal_id: id(1), animal_name: 'cow BD-0001', services: 1, first_service: 'held', confirmed_day: 40, days_open: 67, calving_interval: null },
  ]);
});
