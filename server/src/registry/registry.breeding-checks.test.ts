// Animal registry -- the breeding warnings, worded from what the derivation says.

import assert from 'node:assert';
import { test } from 'node:test';

import { breedingHerd } from './breeding-fixtures';
import { breedingWarnings } from './breeding-checks';
import { addDays, deriveReproduction } from './reproduction';
import { eventsForAnimal } from './store';
import type { CheckMethod, CheckResult, RegistryEvent } from './types';

const db = breedingHerd();
const eventsOf = (id: string): RegistryEvent[] => eventsForAnimal(db, id);

const candidate = (animal_id: string, type: RegistryEvent['type'], on: string, payload: Record<string, unknown>): RegistryEvent => ({
  id: 'candidate',
  animal_id,
  type,
  occurred_on: on,
  occurred_time: null,
  date_precision: 'day',
  payload,
  source_form: 'recall',
  source_ref: null,
  observed_by: null,
  recorded_by: 'test',
  recorded_at: '2026-11-13T00:00:00.000Z',
  supersedes_id: null,
  override_checks: [],
  override_reason: null,
});
const service = (id: string, on: string) => candidate(id, 'insemination', on, { service_type: 'ai', exposure_days: null });
const check = (id: string, on: string, method: CheckMethod, result: CheckResult) =>
  candidate(id, 'pregnancy_check', on, { method, result });

test('a palpation on day 35 is an early check, in the mockup\'s words', () => {
  // Heer, BD-0007: AI on 2026-10-09.
  const w = breedingWarnings(eventsOf('BD-0007'), check('BD-0007', '2026-11-13', 'palpation', 'positive'));
  assert.deepEqual(w, [{
    check: 'early_check',
    field: 'occurred_on',
    message: 'A check by hand is not relied on before day 46. This one is on day 35.',
  }]);
});

test('an ultrasound on the same day is not early', () => {
  assert.deepEqual(breedingWarnings(eventsOf('BD-0007'), check('BD-0007', '2026-11-13', 'ultrasound', 'positive')), []);
});

test('a progesterone negative counts from day 20, not day 19', () => {
  // Gulabo, BD-0008: AI on 2026-10-24.
  assert.deepEqual(breedingWarnings(eventsOf('BD-0008'), check('BD-0008', '2026-11-13', 'progesterone', 'negative')), []);
  assert.deepEqual(breedingWarnings(eventsOf('BD-0008'), check('BD-0008', '2026-11-12', 'progesterone', 'negative')).map((x) => x.check), ['early_check']);
});

test('a progesterone positive is always early, with its own sentence', () => {
  const [w] = breedingWarnings(eventsOf('BD-0008'), check('BD-0008', '2026-12-20', 'progesterone', 'positive'));
  assert.equal(w?.message, 'A progesterone test never confirms a pregnancy on its own. If saved, she reads as Pregnant, re-check due.');
});

test('a check dated before any service has nothing to count from', () => {
  // Moti, BD-0006: her only service is on 2026-09-02.
  const [w] = breedingWarnings(eventsOf('BD-0006'), check('BD-0006', '2026-08-20', 'ultrasound', 'negative'));
  assert.equal(w?.check, 'check_without_service');
  assert.match(w!.message, /on or before 2026-08-20/);
});

test('a second service with nothing between joins the case and warns', () => {
  const [w] = breedingWarnings(eventsOf('BD-0006'), service('BD-0006', '2026-09-23'));
  assert.equal(w?.check, 'ambiguous_service');
  assert.match(w!.message, /^BD-0006 has 1 earlier service in this case, the first on 2026-09-02,/);
});

test('a reliable negative between the services means a new case and no warning', () => {
  // Shehzadi, BD-0009: AI 2026-09-18, negative ultrasound 2026-10-30 (day 42).
  assert.deepEqual(breedingWarnings(eventsOf('BD-0009'), service('BD-0009', '2026-11-13')).map((x) => x.check).filter((c) => c === 'ambiguous_service'), []);
});

test('a heat between the services means a new case and no warning', () => {
  // Laali, BD-0005: AI 2026-08-11, heat 2026-11-10.
  assert.deepEqual(breedingWarnings(eventsOf('BD-0005'), service('BD-0005', '2026-11-11')), []);
});

test('a correction is judged without the event it replaces', () => {
  // Re-dating Moti's only service is not a second service.
  const original = eventsOf('BD-0006').find((e) => e.type === 'insemination')!;
  assert.deepEqual(breedingWarnings(eventsOf('BD-0006'), { ...service('BD-0006', '2026-09-03'), supersedes_id: original.id }).map((x) => x.check).filter((c) => c === 'ambiguous_service'), []);
});

test('early_check fires exactly when the derived latest check is not reliable', () => {
  // Review Focus 1. Heer's AI on 2026-10-09 is day 0. The sweep starts at day 1:
  // a check on the service day itself may sort before the service and not count.
  for (const method of ['palpation', 'ultrasound', 'pag', 'progesterone'] as const) {
    for (const result of ['positive', 'negative'] as const) {
      for (let day = 1; day <= 60; day += 1) {
        const c = check('BD-0007', addDays('2026-10-09', day), method, result);
        const view = deriveReproduction({ events: [...eventsOf('BD-0007'), c], asOf: c.occurred_on, inMilk: false });
        const warned = breedingWarnings(eventsOf('BD-0007'), c).some((x) => x.check === 'early_check');
        assert.equal(warned, view!.latest_check!.reliable === false, `${method} ${result} day ${day}`);
      }
    }
  }
});

const checksOf = (id: string, c: RegistryEvent) => breedingWarnings(eventsOf(id), c).map((w) => w.check);
const heatEvent = (id: string, on: string) => candidate(id, 'heat_observed', on, { sign: 'standing' });

test('a service with no heat sign warns', () => {
  // Shehzadi, BD-0009: her reliable negative is 2026-10-30; no heat since.
  const [w] = breedingWarnings(eventsOf('BD-0009'), service('BD-0009', '2026-11-13'));
  assert.deepEqual(checksOf('BD-0009', service('BD-0009', '2026-11-13')), ['no_heat_sign']);
  assert.equal(
    w.message,
    'No heat sign is recorded for BD-0009 in the 36 hours before this service, or on its day or the day before when a time is missing. Saved, the service counts as it is; record the heat too if one was seen.',
  );
});

test('a heat the day before silences it', () => {
  const events = [...eventsOf('BD-0009'), heatEvent('BD-0009', '2026-11-12')];
  assert.deepEqual(breedingWarnings(events, service('BD-0009', '2026-11-13')), []);
});

test('a bull exposure never warns about heat', () => {
  const bull = candidate('BD-0009', 'insemination', '2026-11-13', { service_type: 'bull_exposure', exposure_days: 30 });
  assert.deepEqual(checksOf('BD-0009', bull), []);
});

test('an ambiguous service with no heat sign raises both', () => {
  assert.deepEqual(checksOf('BD-0006', service('BD-0006', '2026-09-23')), ['ambiguous_service', 'no_heat_sign']);
});

test('a heat after a positive check warns', () => {
  // Kali, BD-0004: positive palpation 2026-09-15.
  const [w] = breedingWarnings(eventsOf('BD-0004'), heatEvent('BD-0004', '2026-10-01'));
  assert.deepEqual(w, {
    check: 'heat_after_positive',
    field: 'occurred_on',
    message: 'BD-0004 has a positive check on 2026-09-15. A heat after it does not end the pregnancy on its own; she reads as Pregnant, re-check due until a check says otherwise.',
  });
});
