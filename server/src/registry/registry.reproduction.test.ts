// Animal registry -- the reproductive state, derived from an animal's events.
//
// No database: reproduction.ts is a pure function of events, a date and
// whether she is in milk.

import assert from 'node:assert';
import { test } from 'node:test';

import { attributionChanged, deriveReproduction } from './reproduction';
import type { RegistryEvent } from './types';

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
    override_checks: [],
    override_reason: null,
    ...over,
  };
}

const AS_OF = '2026-11-13';
const svc = (on: string, over: Partial<RegistryEvent> = {}, payload: Record<string, unknown> = { service_type: 'ai', exposure_days: null }) =>
  ev({ type: 'insemination', occurred_on: on, payload, ...over });
const check = (on: string, method: string, result: string) =>
  ev({ type: 'pregnancy_check', occurred_on: on, payload: { method, result } });
const heat = (on: string) => ev({ type: 'heat_observed', occurred_on: on, payload: { sign: 'standing' } });
const derive = (events: RegistryEvent[], inMilk = false, asOf = AS_OF) =>
  deriveReproduction({ events, asOf, inMilk });

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

test('no service, no view', () => {
  assert.equal(derive([heat('2026-11-01')]), null);
});

test('the sample herd lands in the expected states', () => {
  const cases: [string, RegistryEvent[], boolean, string, string, number][] = [
    ['Sohni',    [svc('2025-11-28'), check('2026-02-10', 'palpation', 'positive')],  false, 'overdue',     'inferred', 350],
    ['Rani',     [svc('2026-01-20'), check('2026-03-03', 'ultrasound', 'positive')], false, 'window',      'inferred', 297],
    ['Noori',    [svc('2026-03-05'), check('2026-05-12', 'palpation', 'positive')],  true,  'dryoff',      'inferred', 253],
    ['Noori dry',[svc('2026-03-05'), check('2026-05-12', 'palpation', 'positive')],  false, 'confirmed',   'observed', 253],
    ['Kali',     [svc('2026-07-14'), check('2026-09-15', 'palpation', 'positive')],  true,  'confirmed',   'observed', 122],
    ['Laali',    [svc('2026-08-11'), check('2026-09-22', 'ultrasound', 'positive'), heat('2026-11-10')], true, 'recheck', 'inferred', 94],
    ['Moti',     [svc('2026-09-02')],                                                true,  'unconfirmed', 'inferred', 72],
    ['Heer',     [svc('2026-10-09')],                                                true,  'unconfirmed', 'inferred', 35],
    ['Gulabo',   [svc('2026-10-24')],                                                true,  'bred',        'observed', 20],
    ['Shehzadi', [svc('2026-09-18'), check('2026-10-30', 'ultrasound', 'negative')], true,  'open',        'observed', 56],
    ['close-up', [svc('2026-02-14'), check('2026-03-26', 'ultrasound', 'positive')], true,  'close',       'inferred', 272],
  ];
  for (const [name, events, inMilk, state, basis, dayMax] of cases) {
    const v = derive(events, inMilk);
    assert.ok(v, name);
    assert.equal(v.state, state, name);
    assert.equal(v.basis, basis, name);
    assert.equal(v.day_max, dayMax, name);
  }
});

test('the calving window is counted from the service', () => {
  const v = derive([svc('2026-01-20'), check('2026-03-03', 'ultrasound', 'positive')])!;
  assert.deepEqual(v.window, { opens_on: '2026-11-01', closes_on: '2026-12-11' });
  assert.deepEqual(
    { day: v.latest_check!.day, reliable: v.latest_check!.reliable },
    { day: 42, reliable: true },
  );
});

test('a month-only bull exposure widens everything', () => {
  const v = derive([svc('2026-06-01', { date_precision: 'month' }, { service_type: 'bull_exposure', exposure_days: 45 })])!;
  assert.equal(v.conception_earliest, '2026-06-01');
  assert.equal(v.conception_latest, '2026-08-14');
  assert.deepEqual([v.day_min, v.day_max], [91, 165]);
  assert.equal(v.state, 'unconfirmed');
  assert.deepEqual(v.window, { opens_on: '2027-03-13', closes_on: '2027-07-05' });
});

test('the day boundaries fall where the rules say', () => {
  const at = (asOf: string, inMilk = false, positive = true) =>
    derive(positive ? [svc('2026-01-01'), check('2026-02-15', 'ultrasound', 'positive')] : [svc('2026-01-01')], inMilk, asOf)!.state;
  assert.equal(at('2026-01-25', false, false), 'bred');        // day 24
  assert.equal(at('2026-01-26', false, false), 'unconfirmed'); // day 25
  assert.equal(at('2026-09-05', true), 'confirmed');           // day 247
  assert.equal(at('2026-09-06', true), 'dryoff');              // day 248
  assert.equal(at('2026-09-21', true), 'dryoff');              // day 263
  assert.equal(at('2026-09-22', true), 'close');               // day 264
  assert.equal(at('2026-10-12'), 'close');                     // day 284
  assert.equal(at('2026-10-13'), 'window');                    // day 285
  assert.equal(at('2026-11-22'), 'window');                    // day 325
  assert.equal(at('2026-11-23'), 'overdue');                   // day 326
});

test('checks too early for their method do not settle anything', () => {
  assert.equal(derive([svc('2026-10-01'), check('2026-11-05', 'palpation', 'positive')])!.state, 'recheck');    // day 35 < 46
  assert.equal(derive([svc('2026-10-01'), check('2026-11-05', 'progesterone', 'positive')])!.state, 'recheck');
  assert.equal(derive([svc('2026-10-20'), check('2026-11-09', 'ultrasound', 'negative')])!.state, 'bred');      // day 20 < 30
});

test('a loss is observed when seen and inferred when only checks say so', () => {
  const seen = derive([svc('2026-06-01'), check('2026-07-13', 'ultrasound', 'positive'), ev({ type: 'abortion', occurred_on: '2026-09-01' })])!;
  assert.deepEqual([seen.state, seen.basis, seen.window], ['lost', 'observed', null]);
  const unseen = derive([svc('2026-06-01'), check('2026-07-13', 'ultrasound', 'positive'), check('2026-08-20', 'ultrasound', 'negative')])!;
  assert.deepEqual([unseen.state, unseen.basis], ['lost', 'inferred']);
});

test('a return to heat opens the case, except while the bull is in', () => {
  assert.deepEqual(
    ((v) => [v.state, v.basis])(derive([svc('2026-10-01'), heat('2026-10-22')])!),
    ['open', 'inferred'],
  );
  const bull = derive([svc('2026-10-01', {}, { service_type: 'bull_exposure', exposure_days: 30 }), heat('2026-10-22')])!;
  assert.equal(bull.state, 'bred');
});

test('a negative inside a bull-exposure window is only inferred open', () => {
  const v = derive([svc('2026-08-01', {}, { service_type: 'bull_exposure', exposure_days: 60 }), check('2026-09-10', 'ultrasound', 'negative')])!;
  assert.deepEqual([v.state, v.basis], ['open', 'inferred']);   // day 40 <= W 60
});

test('two services with nothing between them are both candidates', () => {
  const both = derive([svc('2026-06-02'), svc('2026-07-14')])!;
  assert.deepEqual(
    [both.services_in_case, both.ambiguous_attribution, both.conception_earliest, both.conception_latest],
    [2, true, '2026-06-02', '2026-07-14'],
  );
  const ruledOut = derive([svc('2026-06-02'), heat('2026-06-23'), svc('2026-07-14')])!;
  assert.deepEqual([ruledOut.services_in_case, ruledOut.conception_earliest], [1, '2026-07-14']);
});

test('a calving closes the case and a later service starts a new one', () => {
  const calving = ev({ type: 'calving', occurred_on: '2026-10-28', payload: {} });
  assert.equal(derive([svc('2025-12-20'), check('2026-02-18', 'palpation', 'positive'), calving])!.state, 'calved');
  const again = derive([svc('2025-12-20'), calving, svc('2026-11-10')])!;
  assert.deepEqual([again.state, again.services_in_case, again.day_max], ['bred', 1, 3]);
});

test('events after asOf are invisible', () => {
  const events = [svc('2026-01-20'), check('2026-03-03', 'ultrasound', 'positive')];
  assert.equal(derive(events, false, '2026-01-19'), null);
  assert.equal(derive(events, false, '2026-02-01')!.state, 'bred');          // the check has not happened yet
});

test('a superseded service is ignored', () => {
  const wrong = svc('2026-01-20');
  const right = svc('2026-02-20', { supersedes_id: wrong.id });
  const v = derive([wrong, right])!;
  assert.deepEqual([v.conception_earliest, v.services_in_case], ['2026-02-20', 1]);
});

// ---------------------------------------------------------------------------
// stage 3: what else the derivation knows
// ---------------------------------------------------------------------------

const timed = (e: RegistryEvent, time: string): RegistryEvent => ({ ...e, occurred_time: time });
const sign = (events: RegistryEvent[]) => derive(events)!.heat_sign_before_service;
const BULL = { service_type: 'bull_exposure', exposure_days: 45 };

test('heat sign: both times, within 36 hours before the service', () => {
  assert.equal(sign([timed(heat('2026-11-10'), '08:00'), timed(svc('2026-11-11'), '18:00')]), 'seen');      // 34 h
  assert.equal(sign([timed(heat('2026-11-10'), '06:00'), timed(svc('2026-11-11'), '19:00')]), 'not_seen');  // 37 h
  assert.equal(sign([timed(svc('2026-11-11'), '08:00'), timed(heat('2026-11-11'), '18:00')]), 'not_seen');  // after the AI
});

test('heat sign: a missing time falls back to the same day or the day before', () => {
  assert.equal(sign([heat('2026-11-10'), timed(svc('2026-11-11'), '18:00')]), 'seen');
  assert.equal(sign([heat('2026-11-09'), svc('2026-11-11')]), 'not_seen');
  assert.equal(sign([timed(heat('2026-11-11'), '08:00'), svc('2026-11-11')]), 'seen');
  assert.equal(sign([svc('2026-11-11'), heat('2026-11-12')]), 'not_seen');
});

test('heat sign: unknowable for a bull exposure or a month-precision service', () => {
  assert.equal(sign([heat('2026-11-10'), svc('2026-11-11', {}, BULL)]), 'unknowable');
  assert.equal(sign([heat('2026-11-10'), svc('2026-11-01', { date_precision: 'month' })]), 'unknowable');
});

test('heat_after_positive is true for Laali and false for Kali', () => {
  const laali = derive([svc('2026-08-11'), check('2026-09-22', 'ultrasound', 'positive'), heat('2026-11-10')], true)!;
  const kali = derive([svc('2026-07-14'), check('2026-09-15', 'palpation', 'positive')], true)!;
  assert.deepEqual([laali.state, laali.heat_after_positive], ['recheck', true]);
  assert.deepEqual([kali.state, kali.heat_after_positive], ['confirmed', false]);
});

test('null_observations lists those after the service and omits those before it', () => {
  const nul = (on: string, watched_for: string) => ev({ type: 'null_observation', occurred_on: on, payload: { watched_for } });
  const v = derive([nul('2026-10-01', 'heat'), svc('2026-10-05'), nul('2026-10-26', 'heat'), nul('2026-11-05', 'pregnancy_check')])!;
  assert.deepEqual(v.null_observations, [
    { watched_for: 'heat', occurred_on: '2026-10-26' },
    { watched_for: 'pregnancy_check', occurred_on: '2026-11-05' },
  ]);
});

test('negative_inside_exposure: a negative on day 40 of a 45-day exposure, not on day 50', () => {
  const at = (on: string) => derive([svc('2026-08-01', {}, BULL), check(on, 'ultrasound', 'negative')])!;
  assert.deepEqual([at('2026-09-10').state, at('2026-09-10').basis, at('2026-09-10').negative_inside_exposure], ['open', 'inferred', true]);
  assert.deepEqual([at('2026-09-20').state, at('2026-09-20').basis, at('2026-09-20').negative_inside_exposure], ['open', 'observed', false]);
});

test('month_precision_service is true for Bulbul', () => {
  const bulbul = derive([svc('2026-06-01', { date_precision: 'month' }, BULL)], true)!;
  assert.equal(bulbul.month_precision_service, true);
  assert.equal(derive([svc('2026-06-01')])!.month_precision_service, false);
});

test('attributionChanged: a heat that splits two services changes it, a check does not', () => {
  const a = svc('2026-06-02');
  const b = svc('2026-07-14');
  const split = heat('2026-06-23');   // recorded last
  assert.equal(attributionChanged({ events: [a, b, split], asOf: AS_OF, inMilk: false }), true);
  const later = check('2026-09-20', 'ultrasound', 'positive');
  assert.equal(attributionChanged({ events: [a, b, later], asOf: AS_OF, inMilk: false }), false);
});

test('attributionChanged: a new insemination recorded last changes it', () => {
  const a = svc('2026-06-02');
  const b = svc('2026-09-14');   // recorded last, after a heat between the two
  assert.equal(attributionChanged({ events: [a, heat('2026-06-23'), b], asOf: AS_OF, inMilk: false }), true);
});
