// Animal registry -- every breeding case in an animal's history.
//
// breedingCases calls deriveReproduction at each case boundary, so these tests
// pin the case split and the outcome; the state rules are pinned in
// registry.reproduction.test.ts.

import assert from 'node:assert';
import { test } from 'node:test';

import { breedingCases } from './breeding-cases';
import { BREEDING_AS_OF, breedingHerd } from './breeding-fixtures';
import { canonicalOrder, effectiveEvents, projectLactations } from './project';
import { deriveReproduction } from './reproduction';
import { allAnimals, eventsForAnimal } from './store';
import type { RegistryEvent } from './types';

// ---------------------------------------------------------------------------
// helpers (as in registry.reproduction.test.ts: strictly monotonic recorded_at)
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
    recorded_at: `2026-01-01T${String(Math.floor(seq / 3600)).padStart(2, '0')}:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq % 60).padStart(2, '0')}.000Z`,
    supersedes_id: null,
    override_checks: [],
    override_reason: null,
    ...over,
  };
}

const AS_OF = '2026-11-13';
const svc = (on: string) => ev({ type: 'insemination', occurred_on: on, payload: { service_type: 'ai', exposure_days: null } });
const check = (on: string, method: string, result: string) =>
  ev({ type: 'pregnancy_check', occurred_on: on, payload: { method, result } });
const heat = (on: string) => ev({ type: 'heat_observed', occurred_on: on, payload: { sign: 'standing' } });
const calving = (on: string) => ev({ type: 'calving', occurred_on: on, payload: {} });
const abortion = (on: string) => ev({ type: 'abortion', occurred_on: on, payload: {} });

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('a service, then a calving 300 days later: one held case closed by the calving', () => {
  const s = svc('2025-01-10');
  const c = calving('2025-11-06'); // day 300
  const cases = breedingCases([s, c], AS_OF, true);
  assert.equal(cases.length, 1);
  const [k] = cases;
  assert.equal(k.outcome, 'held');
  assert.equal(k.closed_by?.type, 'calving');
  assert.equal(k.closed_by?.occurred_on, '2025-11-06');
  assert.equal(k.services_since_calving, 1);
  assert.deepEqual(k.services.map((x) => x.event_id), [s.id]);
  assert.equal(k.held_on, '2025-11-06');
  assert.equal(k.first_reliable_positive, null);
});

test('a service, a heat 21 days later, a second service, a positive on day 35: failed, then held', () => {
  const first = svc('2026-03-01');
  const h = heat('2026-03-22');
  const second = svc('2026-03-22'); // served on the heat, recorded after it
  const pos = check('2026-04-26', 'ultrasound', 'positive'); // day 35 of the second service
  const cases = breedingCases([first, h, second, pos], AS_OF, true);
  assert.equal(cases.length, 2);
  const [a, b] = cases;
  assert.deepEqual(a.services.map((x) => x.event_id), [first.id]);
  assert.equal(a.outcome, 'failed');
  assert.equal(a.closed_by?.type, 'heat_observed');
  assert.equal(a.starts_after_calving, true);
  assert.equal(a.services_since_calving, 1);
  assert.deepEqual(b.services.map((x) => x.event_id), [second.id]);
  assert.equal(b.outcome, 'held');
  assert.equal(b.closed_by, null);
  assert.equal(b.services_since_calving, 2);
  assert.equal(b.starts_after_calving, false);
  assert.deepEqual(b.first_reliable_positive, { occurred_on: '2026-04-26', day: 35 });
  assert.equal(b.held_on, '2026-04-26');
});

test('a positive, then a reliable negative: lost, inferred', () => {
  const neg = check('2026-07-30', 'ultrasound', 'negative'); // day 59
  const cases = breedingCases([svc('2026-06-01'), check('2026-07-13', 'ultrasound', 'positive'), neg], AS_OF, false);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].outcome, 'lost');
  assert.equal(cases[0].loss_basis, 'inferred');
  assert.deepEqual(cases[0].closed_by, { type: 'pregnancy_check', occurred_on: '2026-07-30', date_precision: 'day' });
});

test('an abortion after a positive: lost, observed', () => {
  const cases = breedingCases([svc('2026-06-01'), check('2026-07-13', 'ultrasound', 'positive'), abortion('2026-09-01')], AS_OF, false);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].outcome, 'lost');
  assert.equal(cases[0].loss_basis, 'observed');
  assert.equal(cases[0].closed_by?.type, 'abortion');
  assert.equal(cases[0].held_on, '2026-07-13');
});

test('a service with nothing after it as of asOf: pending', () => {
  const cases = breedingCases([calving('2026-05-01'), svc('2026-10-24')], AS_OF, true);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].outcome, 'pending');
  assert.equal(cases[0].closed_by, null);
  assert.equal(cases[0].loss_basis, null);
  assert.equal(cases[0].held_on, null);
  assert.deepEqual(cases[0].previous_calving, { occurred_on: '2026-05-01', date_precision: 'day' });
  assert.equal(cases[0].starts_after_calving, true);
});

test('an early negative between two services: two cases, the first not lost', () => {
  const first = svc('2026-03-01');
  const second = svc('2026-03-20');
  const cases = breedingCases([first, check('2026-03-16', 'ultrasound', 'negative'), second], AS_OF, false); // day 15 < 30
  assert.deepEqual(cases.map((k) => k.services.map((x) => x.event_id)), [[first.id], [second.id]]);
  assert.equal(cases[0].outcome, 'replaced');
  assert.deepEqual(cases[0].closed_by, { type: 'insemination', occurred_on: '2026-03-20', date_precision: 'day' });
  assert.equal(cases[1].services_since_calving, 2);
});

test('two services with nothing between them are one case', () => {
  const a = svc('2026-10-01');
  const b = svc('2026-10-03');
  const cases = breedingCases([a, b], AS_OF, false);
  assert.deepEqual(cases.map((k) => k.services.map((x) => x.event_id)), [[a.id, b.id]]);
});

test('a confirmed case followed by a heat and a new service is replaced; the new one calves', () => {
  const a = svc('2025-01-01');
  const pos = check('2025-02-05', 'ultrasound', 'positive'); // day 35
  const h = heat('2025-02-20');                                // day 50
  const b = svc('2025-02-20');                                 // recorded after the heat
  const c = calving('2025-11-27');                             // day 280 of b
  const cases = breedingCases([a, pos, h, b, c], AS_OF, true);
  assert.deepEqual(cases.map((k) => k.services.map((x) => x.event_id)), [[a.id], [b.id]]);
  assert.equal(cases[0].outcome, 'replaced');
  assert.deepEqual(cases[0].first_reliable_positive, { occurred_on: '2025-02-05', day: 35 });
  assert.equal(cases[0].held_on, '2025-02-05');
  assert.deepEqual(cases[0].closed_by, { type: 'insemination', occurred_on: '2025-02-20', date_precision: 'day' });
  assert.equal(cases[1].outcome, 'held');
  assert.equal(cases[1].closed_by?.type, 'calving');
  assert.equal(cases[1].closed_by?.occurred_on, '2025-11-27');
});

test('a reliable positive, an unreliable negative, then a new service: the first case is replaced', () => {
  const cases = breedingCases(
    [
      svc('2026-03-01'),
      check('2026-04-05', 'ultrasound', 'positive'), // day 35
      check('2026-04-10', 'palpation', 'negative'),  // day 40 < 46
      svc('2026-04-12'),
    ],
    AS_OF,
    false,
  );
  assert.equal(cases.length, 2);
  assert.equal(cases[0].outcome, 'replaced');
  assert.equal(cases[0].first_reliable_positive?.occurred_on, '2026-04-05');
  assert.equal(cases[1].outcome, 'pending');
});

test('an inferred loss that an abortion then records is observed, closed by the abortion', () => {
  const cases = breedingCases(
    [
      svc('2026-06-01'),
      check('2026-07-13', 'ultrasound', 'positive'),
      check('2026-07-30', 'ultrasound', 'negative'),
      abortion('2026-08-05'),
    ],
    AS_OF,
    false,
  );
  assert.equal(cases.length, 1);
  assert.equal(cases[0].outcome, 'lost');
  assert.equal(cases[0].loss_basis, 'observed');
  assert.deepEqual(cases[0].closed_by, { type: 'abortion', occurred_on: '2026-08-05', date_precision: 'day' });
});

test('a corrected service gives one case, anchored on the correction', () => {
  const wrong = svc('2026-02-01');
  const right = ev({ type: 'insemination', occurred_on: '2026-02-20', payload: { service_type: 'ai', exposure_days: null }, supersedes_id: wrong.id });
  const cases = breedingCases([wrong, right], AS_OF, false);
  assert.equal(cases.length, 1);
  assert.deepEqual(cases[0].services.map((x) => x.event_id), [right.id]);
});

test('a female with no service has no case', () => {
  assert.deepEqual(breedingCases([calving('2026-05-01'), heat('2026-06-10')], AS_OF, true), []);
});

// ---------------------------------------------------------------------------
// the fixture herd
// ---------------------------------------------------------------------------

const db = breedingHerd();

function inMilkOf(id: string, rows: RegistryEvent[]): boolean {
  const upTo = canonicalOrder(effectiveEvents(rows)).filter((e) => e.occurred_on <= BREEDING_AS_OF);
  return projectLactations(id, upTo).some((l) => l.ended_on === null);
}

test('Bulbul (BD-0010) as of BREEDING_AS_OF: one pending case with a conception range', () => {
  const rows = eventsForAnimal(db, 'BD-0010');
  const cases = breedingCases(rows, BREEDING_AS_OF, inMilkOf('BD-0010', rows));
  assert.equal(cases.length, 1);
  assert.equal(cases[0].outcome, 'pending');
  assert.ok(cases[0].conception_earliest < cases[0].conception_latest);
});

test("every fixture animal's current case agrees with deriveReproduction", () => {
  let seen = 0;
  for (const animal of allAnimals(db)) {
    if (animal.sex !== 'female') continue;
    const rows = eventsForAnimal(db, animal.id);
    const inMilk = inMilkOf(animal.id, rows);
    const view = deriveReproduction({ events: rows, asOf: BREEDING_AS_OF, inMilk });
    const cases = breedingCases(rows, BREEDING_AS_OF, inMilk);
    if (!view) {
      assert.deepEqual(cases, [], animal.id);
      continue;
    }
    seen += 1;
    const current = cases.find((k) => k.services.some((x) => x.event_id === view.service.event_id));
    assert.ok(current, animal.id);
    assert.equal(current.services[current.services.length - 1].event_id, view.service.event_id, animal.id);
    assert.equal(current.services.length, view.services_in_case, animal.id);
    assert.equal(current.conception_earliest, view.conception_earliest, animal.id);
    assert.equal(current.conception_latest, view.conception_latest, animal.id);
    assert.equal(current.animal_id, animal.id);
  }
  assert.equal(seen, 11);
});
