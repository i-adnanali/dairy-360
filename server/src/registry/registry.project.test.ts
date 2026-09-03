// Animal registry -- the pure projection core, the write boundary, and the
// calving-interval metric.
//
// Every test here except the ordering-agreement one runs with NO database: the
// point of project.ts / events.ts / intervals.ts being DB-free is that the
// rules are testable without one.

import assert from 'node:assert';
import { test } from 'node:test';

import {
  CALF_MAX_AGE_MONTHS,
  canonicalOrder,
  compareEvents,
  daysBetween,
  effectiveEvents,
  findOrigin,
  monthsBetween,
  projectAnimal,
  projectLactations,
  projectStatus,
  supersededIds,
} from './project';
import {
  EventPayloadError,
  assertDatePrecision,
  assertEventPayload,
  formatSerial,
  lactationIdFor,
  newEventId,
} from './events';
import { intervalReport, intervalsForAnimal, precisionHistogram, summarise } from './intervals';
import { isRegistryError } from './errors';
import { definitelyBefore } from './invariants';
import { allEvents } from './store';
import { cleanHerd } from './fixtures';
import type { RegistryAnimalRow, RegistryEvent } from './types';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let seq = 0;
function ev(over: Partial<RegistryEvent> & Pick<RegistryEvent, 'type'>): RegistryEvent {
  seq += 1;
  return {
    id: `aevt_${String(seq).padStart(4, '0')}`,
    animal_id: 'BD-0001',
    occurred_on: '2024-01-01',
    occurred_time: null,
    date_precision: 'day',
    payload: {},
    source_form: 'recall',
    source_ref: null,
    observed_by: null,
    recorded_by: 'tester',
    recorded_at: `2026-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    supersedes_id: null,
    ...over,
  };
}

const FEMALE: RegistryAnimalRow = {
  id: 'BD-0001',
  name: null,
  sex: 'female',
  species: 'buffalo',
  origin: 'acquired',
  post_no: null,
  tag_no: null,
};

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

test('event ids carry the prefix and a FULL uuid, not the 8-char convention', () => {
  const id = newEventId();
  assert.match(
    id,
    /^aevt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'a truncated uuid here would risk a collision that silently mispoints a lactation',
  );
});

test('event ids are unique across many draws', () => {
  const n = 5000;
  const ids = new Set(Array.from({ length: n }, () => newEventId()));
  assert.equal(ids.size, n);
});

test('lactation ids derive from the opening calving event, deterministically', () => {
  const calving = newEventId();
  assert.equal(lactationIdFor(calving), lactationIdFor(calving), 'deterministic');
  assert.equal(lactationIdFor(calving), `lact_${calving.slice('aevt_'.length)}`);
});

test('lactationIdFor rejects anything that is not an event id', () => {
  assert.throws(() => lactationIdFor('BD-0001'), /expected an event id/);
});

test('serials are zero-padded so lexical order matches numeric order', () => {
  assert.equal(formatSerial(1), 'BD-0001');
  assert.equal(formatSerial(42), 'BD-0042');
  assert.equal(formatSerial(9999), 'BD-9999');
  const sorted = [formatSerial(2), formatSerial(10), formatSerial(1)].sort();
  assert.deepEqual(sorted, ['BD-0001', 'BD-0002', 'BD-0010']);
  assert.throws(() => formatSerial(0), /positive integer/);
});

// ---------------------------------------------------------------------------
// The write boundary
// ---------------------------------------------------------------------------

test('every reserved event type is rejected, not accepted with a loose payload', () => {
  for (const t of [
    'heat_observed',
    'insemination',
    'pregnancy_check',
    'abortion',
    'treatment',
    'vet_visit',
    'null_observation',
    'milking',
    'weight',
    'body_condition',
  ]) {
    assert.throws(
      () => assertEventPayload(t as never, {}),
      /RESERVED event type/,
      `${t} must be rejected`,
    );
  }
});

test('an unknown event type is rejected', () => {
  assert.throws(() => assertEventPayload('nonsense' as never, {}), /not a registry event type/);
});

test('each live type validates its required fields', () => {
  assert.throws(() => assertEventPayload('birth', {}), /dam_id/);
  assert.throws(() => assertEventPayload('calving', { calf_id: 'BD-0002' }), /calf_sex/);
  assert.throws(() => assertEventPayload('departure', {}), /reason/);
  assert.throws(() => assertEventPayload('note', {}), /text/);
  assert.throws(
    () => assertEventPayload('calving', { calf_id: 'BD-2', calf_sex: 'f', outcome: 'live' }),
    /calf_sex: must be one of female \| male/,
  );
});

test('a typo in a payload key is rejected rather than silently stored', () => {
  // The failure this prevents: `calf_sexe` would be stored as JSON, read back
  // as undefined by the projection, and produce a wrong derived value with no
  // error anywhere.
  assert.throws(
    () =>
      assertEventPayload('calving', {
        calf_id: 'BD-0002',
        calf_sexe: 'female',
        outcome: 'live',
      }),
    /unknown payload key\(s\) 'calf_sexe'/,
  );
});

test('acquired: a birth date without its precision is rejected', () => {
  assert.throws(
    () => assertEventPayload('acquired', { estimated_birth_on: '2021-04-12' }),
    /Precision is never defaulted/,
  );
  assert.throws(
    () => assertEventPayload('acquired', { estimated_birth_precision: 'year' }),
    /without estimated_birth_on/,
  );
});

test('validation normalizes optionals to explicit null so serialization is stable', () => {
  // deepEqual on the WHOLE object, not a subset: absent-vs-null and a changed
  // key set both read as a change to the rebuild-diff, so the key set is part
  // of the contract. `override` joined it when overridden checks became
  // persisted -- null here because nothing was overridden.
  const a = assertEventPayload('dry_off', {});
  assert.deepEqual(a, { reason: null, notes: null, override: null });
});

test('date/precision rules are enforced at the boundary with readable messages', () => {
  assert.throws(
    () =>
      assertDatePrecision({
        occurred_on: '2024-03-14',
        occurred_time: '05:30',
        date_precision: 'month',
      }),
    /no such thing as knowing the hour but not the day/,
  );
  assert.throws(
    () => assertDatePrecision({ occurred_on: '2024-03-14', date_precision: 'month' }),
    /silently downgraded/,
  );
  assert.throws(
    () => assertDatePrecision({ occurred_on: '2024-03-01', date_precision: 'year' }),
    /January 1/,
  );
  assert.doesNotThrow(() =>
    assertDatePrecision({
      occurred_on: '2024-03-14',
      occurred_time: '05:30',
      date_precision: 'day',
    }),
  );
  // EventPayloadError now carries the { code, field, message } contract the
  // entry form needs, and is a RegistryError so runCli() catches it instead of
  // letting a stack trace reach an operator mid-backfill.
  const e = new EventPayloadError('invalid_precision', 'x', 'occurred_on');
  assert.ok(e instanceof Error);
  assert.ok(isRegistryError(e));
  assert.deepEqual(e.toWire(), {
    error: 'invalid_precision',
    field: 'occurred_on',
    message: 'x',
  });
});

// ---------------------------------------------------------------------------
// Ordering and superseding
// ---------------------------------------------------------------------------

test('canonical order puts untimed events before timed ones on the same day', () => {
  const untimed = ev({ type: 'note', occurred_on: '2024-01-01', occurred_time: null });
  const timed = ev({ type: 'note', occurred_on: '2024-01-01', occurred_time: '05:30' });
  assert.ok(compareEvents(untimed, timed) < 0);
});

test('canonical order is total and stable under shuffling', () => {
  const events = [
    ev({ type: 'note', occurred_on: '2024-03-01' }),
    ev({ type: 'note', occurred_on: '2024-01-01', occurred_time: '18:00' }),
    ev({ type: 'note', occurred_on: '2024-01-01', occurred_time: '06:00' }),
    ev({ type: 'note', occurred_on: '2024-02-01' }),
  ];
  const once = canonicalOrder(events).map((e) => e.id);
  const shuffled = [events[2], events[0], events[3], events[1]];
  assert.deepEqual(canonicalOrder(shuffled).map((e) => e.id), once);
});

test('the SQL ORDER BY agrees with compareEvents on real rows', () => {
  // The one place the pure core and the query could silently diverge.
  const db = cleanHerd();
  const fromSql = allEvents(db).map((e) => e.id);
  const fromCore = canonicalOrder(allEvents(db)).map((e) => e.id);
  assert.deepEqual(fromSql, fromCore);
  db.close();
});

test('a superseded event is excluded, and chains resolve to the last event', () => {
  const a = ev({ type: 'note' });
  const b = ev({ type: 'note', supersedes_id: a.id });
  const c = ev({ type: 'note', supersedes_id: b.id });
  assert.deepEqual([...supersededIds([a, b, c])].sort(), [a.id, b.id].sort());
  assert.deepEqual(effectiveEvents([a, b, c]).map((e) => e.id), [c.id]);
});

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

test('monthsBetween counts calendar months, not 30-day blocks', () => {
  assert.equal(monthsBetween('2025-01-15', '2026-01-14'), 11, 'one day short of a year');
  assert.equal(monthsBetween('2025-01-15', '2026-01-15'), 12, 'exactly a year');
  assert.equal(monthsBetween('2025-01-31', '2025-03-01'), 1);
  assert.equal(monthsBetween('2026-01-01', '2026-01-01'), 0);
});

test('daysBetween is exact and host-timezone-independent', () => {
  assert.equal(daysBetween('2024-01-01', '2024-01-02'), 1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2, '2024 is a leap year');
  assert.equal(daysBetween('2023-03-14', '2024-06-02'), 446);
});

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

test('a birth event dates the animal; an acquired event does NOT', () => {
  const birth = findOrigin([ev({ type: 'birth', occurred_on: '2024-05-01', date_precision: 'day' })]);
  assert.equal(birth?.birth_on, '2024-05-01');

  // The acquisition date is when it arrived, not when it was born.
  const acquired = findOrigin([
    ev({
      type: 'acquired',
      occurred_on: '2024-05-01',
      payload: { estimated_birth_on: '2021-01-01', estimated_birth_precision: 'year' },
    }),
  ]);
  assert.equal(acquired?.birth_on, '2021-01-01');
  assert.equal(acquired?.birth_precision, 'year');
});

test('an acquired animal with no birth date has none -- not the acquisition date', () => {
  const o = findOrigin([ev({ type: 'acquired', occurred_on: '2024-05-01', payload: {} })]);
  assert.equal(o?.birth_on, null);
});

// ---------------------------------------------------------------------------
// Lactations
// ---------------------------------------------------------------------------

test('a dry_off between two calvings closes the first normally', () => {
  const c1 = ev({ type: 'calving', occurred_on: '2023-03-14' });
  const d = ev({ type: 'dry_off', occurred_on: '2024-01-10' });
  const c2 = ev({ type: 'calving', occurred_on: '2024-06-02' });
  const l = projectLactations('BD-0001', canonicalOrder([c1, d, c2]));
  assert.equal(l.length, 2);
  assert.equal(l[0].end_reason, 'dry_off');
  assert.equal(l[0].ended_on, '2024-01-10');
  assert.equal(l[0].closed_by_event_id, d.id);
  assert.equal(l[1].ended_on, null, 'the second lactation is still open');
});

test('with no dry_off the previous lactation closes as inferred, and is NOT rejected', () => {
  // Backfilled history routinely has calving dates and no dry-off dates.
  // Rejecting would force the operator to invent a date to satisfy a constraint.
  const c1 = ev({ type: 'calving', occurred_on: '2023-04-01', date_precision: 'month' });
  const c2 = ev({ type: 'calving', occurred_on: '2024-07-01', date_precision: 'month' });
  const l = projectLactations('BD-0001', canonicalOrder([c1, c2]));
  assert.equal(l[0].end_reason, 'inferred_at_next_calving');
  assert.equal(l[0].ended_on, '2024-07-01');
  assert.equal(l[0].end_precision, 'month', 'the derived boundary inherits the calving precision');
});

test('lactation ids are derived from the calving, so they survive discovering an earlier one', () => {
  // The failure this prevents: a sequence-encoded id renumbers every later
  // lactation when an earlier calving turns up during backfill, and step 4's
  // yield rows would then point at the wrong lactation, silently.
  const later = ev({ type: 'calving', occurred_on: '2024-06-02' });
  const before = projectLactations('BD-0001', canonicalOrder([later]));

  const earlier = ev({ type: 'calving', occurred_on: '2020-01-01' });
  const after = projectLactations('BD-0001', canonicalOrder([earlier, later]));

  assert.equal(after.length, 2);
  assert.equal(
    after[1].id,
    before[0].id,
    "the known lactation's id is unchanged by discovering an earlier calving",
  );
});

test('a departure does not close an open lactation', () => {
  const c = ev({ type: 'calving', occurred_on: '2024-01-01' });
  const d = ev({ type: 'departure', occurred_on: '2024-06-01', payload: { reason: 'sold' } });
  const l = projectLactations('BD-0001', canonicalOrder([c, d]));
  assert.equal(l[0].ended_on, null, 'we do not know it dried off; inventing a date would lie');
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function statusOf(events: RegistryEvent[], asOf: string, animal = FEMALE) {
  const ordered = canonicalOrder(effectiveEvents(events));
  return projectStatus({
    animal,
    ordered,
    lactations: projectLactations(animal.id, ordered),
    asOf,
  });
}

test('rule 1: departed is terminal and beats everything below it', () => {
  const s = statusOf(
    [
      ev({ type: 'birth', occurred_on: '2020-01-01', payload: { dam_id: 'BD-0009' } }),
      ev({ type: 'calving', occurred_on: '2024-01-01' }),
      ev({ type: 'departure', occurred_on: '2024-06-01', payload: { reason: 'sold' } }),
    ],
    '2026-09-01',
  );
  assert.equal(s.status, 'departed');
  assert.equal(s.parity, 1, 'parity is still counted for a departed animal');
});

test('rule 2: calf below the threshold, and not above it', () => {
  const birth = (on: string) =>
    ev({ type: 'birth', occurred_on: on, payload: { dam_id: 'BD-0009' } });
  assert.equal(statusOf([birth('2026-06-01')], '2026-09-01').status, 'calf');
  // Exactly at the threshold is no longer a calf: the rule is age < MAX.
  assert.equal(statusOf([birth('2025-09-01')], '2026-09-01').status, 'heifer');
  assert.equal(CALF_MAX_AGE_MONTHS, 12);
});

test('an unknown birth date falls through to heifer -- the documented consequence', () => {
  const s = statusOf([ev({ type: 'acquired', occurred_on: '2026-08-01', payload: {} })], '2026-09-01');
  assert.equal(s.status, 'heifer', 'rule 2 cannot fire without a birth date');
  assert.equal(s.birth_on, null);
});

test('rules 3 and 4: lactating with an open lactation, dry without', () => {
  const c = ev({ type: 'calving', occurred_on: '2024-01-01' });
  assert.equal(statusOf([c], '2026-09-01').status, 'lactating');
  const d = ev({ type: 'dry_off', occurred_on: '2024-11-01' });
  assert.equal(statusOf([c, d], '2026-09-01').status, 'dry');
});

test('rules 5 and 6: heifer and male at parity 0', () => {
  const acquired = ev({
    type: 'acquired',
    occurred_on: '2020-01-01',
    payload: { estimated_birth_on: '2019-01-01', estimated_birth_precision: 'year' },
  });
  assert.equal(statusOf([acquired], '2026-09-01').status, 'heifer');
  assert.equal(
    statusOf([acquired], '2026-09-01', { ...FEMALE, sex: 'male' }).status,
    'male',
  );
});

test('the status vocabulary uses `lactating`, matching the demo word', () => {
  const s = statusOf([ev({ type: 'calving', occurred_on: '2024-01-01' })], '2026-09-01');
  assert.equal(s.status, 'lactating');
  assert.notEqual(s.status as string, 'milking');
});

test('a superseded calving does not count toward parity', () => {
  const first = ev({ type: 'calving', occurred_on: '2023-04-01', date_precision: 'month' });
  const correction = ev({
    type: 'calving',
    occurred_on: '2023-05-01',
    date_precision: 'month',
    supersedes_id: first.id,
  });
  const s = statusOf([first, correction], '2026-09-01');
  assert.equal(s.parity, 1, 'a correction replaces the event, it does not add one');
});

test('the projection is a pure function of (events, asOf) -- same input, same output', () => {
  const events = [
    ev({ type: 'birth', occurred_on: '2022-01-01', payload: { dam_id: 'BD-0009' } }),
    ev({ type: 'calving', occurred_on: '2024-01-01' }),
  ];
  const a = projectAnimal({ animal: FEMALE, events, asOf: '2026-09-01' });
  const b = projectAnimal({ animal: FEMALE, events: [...events].reverse(), asOf: '2026-09-01' });
  assert.deepEqual(a, b, 'input order does not change the result');
});

test('asOf is what makes the projection reproducible -- a later date can change status', () => {
  // This is the documented cost of a time-dependent rule, asserted rather than
  // hidden: it is why asOf is a parameter and not a clock read, and why a stale
  // stored status is a real invariant-1 violation.
  const events = [ev({ type: 'birth', occurred_on: '2026-01-01', payload: { dam_id: 'BD-0009' } })];
  assert.equal(projectAnimal({ animal: FEMALE, events, asOf: '2026-06-01' }).status.status, 'calf');
  assert.equal(projectAnimal({ animal: FEMALE, events, asOf: '2027-06-01' }).status.status, 'heifer');
});

// ---------------------------------------------------------------------------
// Calving intervals
// ---------------------------------------------------------------------------

test('an interval is measured only when BOTH endpoints are day-precision', () => {
  const day = (on: string) => ev({ type: 'calving', occurred_on: on, date_precision: 'day' });
  const month = (on: string) =>
    ev({ type: 'calving', occurred_on: on, date_precision: 'month' });

  assert.equal(
    intervalsForAnimal('BD-0001', [day('2023-03-14'), day('2024-06-02')])[0].quality,
    'measured',
  );
  assert.equal(
    intervalsForAnimal('BD-0001', [day('2023-03-01'), month('2024-06-01')])[0].quality,
    'approximate',
    'one imprecise endpoint makes the whole interval approximate',
  );
});

test('one calving yields no interval', () => {
  assert.deepEqual(intervalsForAnimal('BD-0001', [ev({ type: 'calving' })]), []);
});

test('summarise never blends qualities', () => {
  const intervals = intervalsForAnimal('BD-0001', [
    ev({ type: 'calving', occurred_on: '2022-01-01', date_precision: 'day' }),
    ev({ type: 'calving', occurred_on: '2023-01-01', date_precision: 'day' }),
    ev({ type: 'calving', occurred_on: '2024-01-01', date_precision: 'month' }),
  ]);
  const m = summarise('measured', intervals);
  const a = summarise('approximate', intervals);
  assert.equal(m.count, 1);
  assert.equal(m.mean_days, 365);
  assert.equal(a.count, 1);
  assert.equal(a.mean_days, 365);
  assert.notEqual(m.count + a.count, 0);
});

test('an empty quality class reports null rather than 0, so it cannot be charted as a value', () => {
  const s = summarise('measured', []);
  assert.equal(s.count, 0);
  assert.equal(s.mean_days, null);
  assert.equal(s.min_days, null);
});

test('the report carries its own sample-size caveat', () => {
  const byAnimal = new Map([
    [
      'BD-0001',
      [
        ev({ type: 'calving', occurred_on: '2022-01-01', date_precision: 'day' }),
        ev({ type: 'calving', occurred_on: '2023-01-01', date_precision: 'day' }),
      ],
    ],
  ]);
  const r = intervalReport(byAnimal);
  assert.equal(r.measured.count, 1);
  assert.equal(r.approximate.count, 0);
  assert.match(r.caveat, /never averaged together/);
  assert.match(r.caveat, /case series, not a dataset/);
});

// ---------------------------------------------------------------------------
// Precision histogram
// ---------------------------------------------------------------------------

test('the histogram buckets by source_form x date_precision', () => {
  const h = precisionHistogram([
    ev({ type: 'note', source_form: 'recall', date_precision: 'month' }),
    ev({ type: 'note', source_form: 'recall', date_precision: 'month' }),
    ev({ type: 'note', source_form: 'daily_herd_sheet', date_precision: 'day' }),
  ]);
  assert.deepEqual(h, [
    { source_form: 'daily_herd_sheet', date_precision: 'day', count: 1 },
    { source_form: 'recall', date_precision: 'month', count: 2 },
  ]);
});

test('every date/precision refusal names the field the form must highlight', () => {
  // The date inputs are what an operator touches most, so these are the
  // refusals most likely to need attaching to a specific control.
  const cases: [() => unknown, string, string][] = [
    [() => assertDatePrecision({ occurred_on: '2024-03-14', date_precision: 'month' }), 'invalid_precision', 'occurred_on'],
    [() => assertDatePrecision({ occurred_on: '2024-03-01', date_precision: 'year' }), 'invalid_precision', 'occurred_on'],
    [() => assertDatePrecision({ occurred_on: '2024-06-01', date_precision: 'estimated' }), 'invalid_precision', 'occurred_on'],
    [() => assertDatePrecision({ occurred_on: '2024-03-14', occurred_time: '05:30', date_precision: 'month' }), 'invalid_precision', 'occurred_time'],
    [() => assertDatePrecision({ occurred_on: '14/03/2024', date_precision: 'day' }), 'invalid_payload', 'occurred_on'],
    [() => assertDatePrecision({ occurred_on: '2024-03-14', date_precision: 'exact' as never }), 'invalid_precision', 'date_precision'],
  ];
  for (const [fn, code, field] of cases) {
    let caught: unknown;
    try { fn(); } catch (e) { caught = e; }
    assert.ok(isRegistryError(caught), `threw a RegistryError for ${field}`);
    assert.equal((caught as EventPayloadError).code, code);
    assert.equal((caught as EventPayloadError).field, field);
  }
});

test('estimated now obeys the January 1 convention like year', () => {
  assert.doesNotThrow(() =>
    assertDatePrecision({ occurred_on: '2021-01-01', date_precision: 'estimated' }),
  );
  assert.throws(
    () => assertDatePrecision({ occurred_on: '2021-04-12', date_precision: 'estimated' }),
    /fabricated day wearing a humility label/,
  );
});

test('year and estimated store the same shape but are NOT interchangeable', () => {
  // Both are Jan 1 now, so the difference lives entirely in the precision value
  // -- and it is load-bearing in two places, which is why they stay separate.
  assert.equal(
    definitelyBefore({ on: '2020-01-01', precision: 'year' }, { on: '2024-03-14', precision: 'day' }),
    true,
    'a known year IS comparable',
  );
  assert.equal(
    definitelyBefore({ on: '2020-01-01', precision: 'estimated' }, { on: '2024-03-14', precision: 'day' }),
    false,
    'a guessed year is NOT comparable at all',
  );
  const h = precisionHistogram([
    ev({ type: 'note', source_form: 'recall', date_precision: 'year' }),
    ev({ type: 'note', source_form: 'recall', date_precision: 'estimated' }),
  ]);
  assert.equal(h.length, 2, 'and the histogram reports them separately');
});
