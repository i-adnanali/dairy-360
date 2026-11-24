// Breeding stage 3: the tasks. Computed on read from the view; each opens at its day,
// turns red at its line (the spec's comparison, both sides), and clears only when the
// matching event is recorded.

import assert from 'node:assert';
import { test } from 'node:test';

import { BREEDING_TASK_LABEL, breedingTasks, type BreedingTaskKind } from './breeding-tasks';
import { addDays, deriveReproduction } from './reproduction';
import type { RegistryEvent } from './types';

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
    override_checks: [],
    override_reason: null,
    ...over,
  };
}

const S = '2026-01-01';
const day = (n: number) => addDays(S, n);
const AI = { service_type: 'ai', exposure_days: null };
const svc = (on = S) => ev({ type: 'insemination', occurred_on: on, payload: AI });
const check = (n: number, method: string, result: string) =>
  ev({ type: 'pregnancy_check', occurred_on: day(n), payload: { method, result } });
const heat = (n: number) => ev({ type: 'heat_observed', occurred_on: day(n), payload: { sign: 'standing' } });

function tasksOn(events: RegistryEvent[], n: number, inMilk = false) {
  const v = deriveReproduction({ events, asOf: day(n), inMilk });
  return breedingTasks(v, { animal_id: 'BD-0001', inMilk });
}
const find = (events: RegistryEvent[], n: number, kind: BreedingTaskKind, inMilk = false) =>
  tasksOn(events, n, inMilk).find((t) => t.kind === kind);

test('labels', () => {
  assert.deepEqual(BREEDING_TASK_LABEL, {
    heat_watch: 'Heat watch',
    pregnancy_check: 'Pregnancy check due',
    recheck: 'Recheck due',
    dry_off: 'Dry-off reminder',
    calving_watch: 'Calving watch',
    overdue_review: 'Overdue review',
  });
});

test('heat_watch: opens day 18, red from day 24, cleared by a heat or a check', () => {
  const events = [svc()];
  assert.equal(find(events, 17, 'heat_watch'), undefined);
  assert.deepEqual(find(events, 18, 'heat_watch'), {
    kind: 'heat_watch', animal_id: 'BD-0001', standing: 'due', day_min: 18, day_max: 18, red_from: 24, red_on: day(24),
  });
  assert.equal(find(events, 23, 'heat_watch')?.standing, 'due');
  assert.equal(find(events, 24, 'heat_watch')?.standing, 'overdue');
  assert.equal(find(events, 40, 'heat_watch')?.standing, 'overdue');
  assert.equal(find([...events, heat(20)], 30, 'heat_watch'), undefined, 'a heat');
  assert.equal(find([...events, check(20, 'palpation', 'negative')], 30, 'heat_watch'), undefined, 'a check');
  const again = [svc(), heat(20), svc(day(22))];
  assert.equal(find(again, 30, 'heat_watch'), undefined, 'a new service after a heat starts a new case, counted from itself');
  assert.equal(find(again, 40, 'heat_watch')?.red_on, day(46), 'and it is red 24 days after that service');
});

test('pregnancy_check: opens day 28, red from day 61, cleared by a check', () => {
  const events = [svc()];
  assert.equal(find(events, 27, 'pregnancy_check'), undefined);
  assert.deepEqual(find(events, 28, 'pregnancy_check'), {
    kind: 'pregnancy_check', animal_id: 'BD-0001', standing: 'due', day_min: 28, day_max: 28, red_from: 61, red_on: day(61),
  });
  assert.equal(find(events, 60, 'pregnancy_check')?.standing, 'due');
  assert.equal(find(events, 61, 'pregnancy_check')?.standing, 'overdue');
  assert.equal(find([...events, check(30, 'pag', 'positive')], 61, 'pregnancy_check'), undefined, 'a check');
  assert.equal(find([...events, check(30, 'pag', 'negative')], 61, 'pregnancy_check'), undefined, 'a negative check');
});

test('recheck: opens with the recheck state, amber, never red, cleared by a reliable check', () => {
  const events = [svc(), check(40, 'palpation', 'positive')];
  assert.equal(find(events, 39, 'recheck'), undefined);
  assert.deepEqual(find(events, 40, 'recheck'), {
    kind: 'recheck', animal_id: 'BD-0001', standing: 'due', day_min: 40, day_max: 40, red_from: null, red_on: null,
  });
  for (const n of [100, 200, 300]) assert.equal(find(events, n, 'recheck')?.standing, 'due');
  assert.equal(find([...events, check(50, 'palpation', 'positive')], 100, 'recheck'), undefined);
});

test('dry_off: opens day 248 in milk, red from day 264, cleared by a dry-off', () => {
  const events = [svc(), check(50, 'palpation', 'positive')];
  assert.equal(find(events, 247, 'dry_off', true), undefined);
  assert.deepEqual(find(events, 248, 'dry_off', true), {
    kind: 'dry_off', animal_id: 'BD-0001', standing: 'due', day_min: 248, day_max: 248, red_from: 264, red_on: day(264),
  });
  assert.equal(find(events, 263, 'dry_off', true)?.standing, 'due');
  assert.equal(find(events, 264, 'dry_off', true)?.standing, 'overdue');
  assert.equal(find(events, 270, 'dry_off', false), undefined, 'a dry-off makes inMilk false');
  assert.equal(find([...events, ev({ type: 'calving', occurred_on: day(280), payload: {} })], 300, 'dry_off', true), undefined, 'calved');
});

test('calving_watch: opens day 285, red from day 319, cleared by a calving or a loss', () => {
  const events = [svc(), check(50, 'palpation', 'positive')];
  assert.equal(find(events, 284, 'calving_watch'), undefined);
  assert.deepEqual(find(events, 285, 'calving_watch'), {
    kind: 'calving_watch', animal_id: 'BD-0001', standing: 'due', day_min: 285, day_max: 285, red_from: 319, red_on: day(319),
  });
  assert.equal(find(events, 318, 'calving_watch')?.standing, 'due');
  assert.equal(find(events, 319, 'calving_watch')?.standing, 'overdue');
  assert.equal(find([...events, ev({ type: 'calving', occurred_on: day(290), payload: {} })], 300, 'calving_watch'), undefined, 'calved');
  assert.equal(find([...events, ev({ type: 'abortion', occurred_on: day(290), payload: {} })], 300, 'calving_watch'), undefined, 'lost');
});

test('overdue_review: opens day 333, red from day 347, cleared by a check on or after day 333', () => {
  const events = [svc(), check(50, 'palpation', 'positive')];
  assert.equal(find(events, 332, 'overdue_review'), undefined);
  assert.deepEqual(find(events, 333, 'overdue_review'), {
    kind: 'overdue_review', animal_id: 'BD-0001', standing: 'due', day_min: 333, day_max: 333, red_from: 347, red_on: day(347),
  });
  assert.equal(find(events, 346, 'overdue_review')?.standing, 'due');
  assert.equal(find(events, 347, 'overdue_review')?.standing, 'overdue');
  assert.ok(find([...events, check(332, 'palpation', 'positive')], 340, 'overdue_review'), 'a check on day 332 does not clear it');
  assert.equal(find([...events, check(333, 'palpation', 'positive')], 340, 'overdue_review'), undefined, 'a check on day 333');
  assert.equal(find([...events, ev({ type: 'calving', occurred_on: day(335), payload: {} })], 340, 'overdue_review'), undefined, 'calved');
});

test('Bulbul: a month-precision bull exposure produces tasks from day_max, with a wider range', () => {
  const bull = ev({
    type: 'insemination',
    occurred_on: '2026-06-01',
    date_precision: 'month',
    payload: { service_type: 'bull_exposure', exposure_days: 45 },
  });
  const asOf = '2026-07-20';
  const v = deriveReproduction({ events: [bull], asOf, inMilk: false });
  assert.ok(v);
  assert.ok(v.day_min < v.day_max);
  const tasks = breedingTasks(v, { animal_id: 'BD-0010', inMilk: false });
  assert.deepEqual(tasks.map((t) => t.kind), ['heat_watch', 'pregnancy_check']);
  for (const t of tasks) {
    assert.equal(t.day_max, v.day_max);
    assert.equal(t.day_min, v.day_min);
    assert.ok(t.day_min < t.day_max);
    assert.equal(t.animal_id, 'BD-0010');
  }
  assert.equal(tasks[0].red_on, addDays(v.conception_earliest, 24));
});

// Owner decision after the final review (I2, 24 Nov): heat watch and pregnancy
// check count from the latest service in the case (the anchor), not from the
// earliest possible conception, so a re-served cow is not red 3 days after it.
test('an ambiguous case: heat_watch counts from the latest service, not the earliest', () => {
  const events = [svc(), svc(day(21))];
  assert.equal(deriveReproduction({ events, asOf: day(24), inMilk: false })?.ambiguous_attribution, true);
  assert.equal(find(events, 24, 'heat_watch'), undefined, 'day 3 after the re-service');
  assert.equal(find(events, 38, 'heat_watch'), undefined, 'day 17');
  assert.deepEqual(find(events, 39, 'heat_watch'), {
    kind: 'heat_watch', animal_id: 'BD-0001', standing: 'due', day_min: 18, day_max: 18, red_from: 24, red_on: day(45),
  });
  assert.equal(find(events, 44, 'heat_watch')?.standing, 'due');
  assert.equal(find(events, 45, 'heat_watch')?.standing, 'overdue');
});

test('an ambiguous case: pregnancy_check counts from the latest service, not the earliest', () => {
  const events = [svc(), svc(day(21))];
  assert.equal(find(events, 48, 'pregnancy_check'), undefined, 'day 27 after the re-service');
  assert.deepEqual(find(events, 49, 'pregnancy_check'), {
    kind: 'pregnancy_check', animal_id: 'BD-0001', standing: 'due', day_min: 28, day_max: 28, red_from: 61, red_on: day(82),
  });
  assert.equal(find(events, 81, 'pregnancy_check')?.standing, 'due');
  assert.equal(find(events, 82, 'pregnancy_check')?.standing, 'overdue');
});

test('an ambiguous case: dry_off, calving_watch and overdue_review still count from the earliest conception', () => {
  const events = [svc(), svc(day(21)), check(80, 'palpation', 'positive')];
  assert.deepEqual(find(events, 248, 'dry_off', true), {
    kind: 'dry_off', animal_id: 'BD-0001', standing: 'due', day_min: 227, day_max: 248, red_from: 264, red_on: day(264),
  });
  assert.equal(find(events, 285, 'calving_watch')?.red_on, day(319));
  assert.equal(find(events, 333, 'overdue_review')?.red_on, day(347));
});

test('a month-precision anchor after an earlier service keeps its own range on heat_watch', () => {
  const month = ev({ type: 'insemination', occurred_on: '2026-02-01', date_precision: 'month', payload: AI });
  const v = deriveReproduction({ events: [svc(), month], asOf: '2026-03-15', inMilk: false })!;
  assert.equal(v.ambiguous_attribution, true);
  const t = breedingTasks(v, { animal_id: 'BD-0001', inMilk: false }).find((x) => x.kind === 'heat_watch');
  // 1 Feb to 15 Mar is 42 days; 28 Feb (the month's last day) to 15 Mar is 15.
  assert.deepEqual([t?.day_min, t?.day_max, t?.red_on, t?.standing], [15, 42, '2026-02-25', 'overdue']);
});

test('a male (null view) has no tasks', () => {
  assert.deepEqual(breedingTasks(null, { animal_id: 'BD-0100', inMilk: false }), []);
});
