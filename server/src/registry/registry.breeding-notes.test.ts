// Breeding stage 3: the derived notes. Computed on read from the view, never stored.

import assert from 'node:assert';
import { test } from 'node:test';

import { BREEDING_AS_OF, breedingHerd } from './breeding-fixtures';
import { reproductionNotes } from './breeding-notes';
import { animalDetail } from './reads';
import { deriveReproduction } from './reproduction';
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
const AI = { service_type: 'ai', exposure_days: null };
const BULL = { service_type: 'bull_exposure', exposure_days: 45 };
const svc = (on: string, over: Partial<RegistryEvent> = {}, payload: Record<string, unknown> = AI) =>
  ev({ type: 'insemination', occurred_on: on, payload, ...over });
const check = (on: string, method: string, result: string) =>
  ev({ type: 'pregnancy_check', occurred_on: on, payload: { method, result } });
const view = (events: RegistryEvent[], asOf: string, inMilk = false) => {
  const v = deriveReproduction({ events, asOf, inMilk });
  assert.ok(v);
  return v;
};
const codes = (events: RegistryEvent[], asOf: string, inMilk = false, attributionChanged = false) =>
  reproductionNotes(view(events, asOf, inMilk), { inMilk, attributionChanged }).map((n) => n.code);

test('null_observation: one note per entry, worded by what was watched', () => {
  const nul = (on: string, watched_for: string) => ev({ type: 'null_observation', occurred_on: on, payload: { watched_for } });
  const notes = reproductionNotes(
    view([svc('2026-10-05'), nul('2026-10-26', 'heat'), nul('2026-11-05', 'pregnancy_check')], '2026-11-13'),
    { inMilk: false, attributionChanged: false },
  );
  assert.deepEqual(notes, [
    { code: 'null_observation', text: 'Watched for heat on 2026-10-26 and nothing was seen. That records an absence; it is not evidence that she is not cycling.' },
    { code: 'null_observation', text: 'Watched for a pregnancy check on 2026-11-05 and nothing was seen. That records an absence; it is not evidence that she is not cycling.' },
  ]);
});

test('negative_inside_exposure: the bull was still with her', () => {
  const notes = reproductionNotes(view([svc('2026-08-01', {}, BULL), check('2026-09-10', 'ultrasound', 'negative')], '2026-11-13'), { inMilk: false, attributionChanged: false });
  assert.deepEqual(notes, [
    { code: 'negative_inside_exposure', text: 'The negative check fell while the bull was still with her. He may have served her since, so she stays Open (worked out).' },
  ]);
});

test('dry_off_while_unconfirmed: in milk, unconfirmed, from day 248', () => {
  const events = [svc('2026-01-01')];
  assert.deepEqual(codes(events, '2026-09-10', true), ['dry_off_while_unconfirmed']);
  const v = view(events, '2026-09-10', true);
  assert.ok(['bred', 'unconfirmed'].includes(v.state));
  assert.deepEqual(reproductionNotes(v, { inMilk: true, attributionChanged: false })[0].text, 'Dry-off would be due now if she is pregnant, but no check has confirmed it.');
  assert.deepEqual(codes(events, '2026-09-10', false), [], 'not in milk');
  assert.deepEqual(codes(events, '2026-08-20', true), [], 'before day 248');
  assert.deepEqual(codes([svc('2026-01-01'), check('2026-03-15', 'palpation', 'positive')], '2026-09-10', true), [], 'confirmed');
});

test('wide_window: a month-precision service with a window', () => {
  const events = [svc('2026-06-01', { date_precision: 'month' }, BULL)];
  const v = view(events, '2026-11-13', true);
  assert.ok(v.window);
  const notes = reproductionNotes(v, { inMilk: true, attributionChanged: false });
  assert.ok(notes.some((n) => n.code === 'wide_window' && n.text === 'The calving window is wider because the service date is known to the month only.'));
  assert.ok(!codes([svc('2026-06-01')], '2026-11-13').includes('wide_window'));
});

test('attribution_changed: from the context flag, last in the list', () => {
  const events = [svc('2026-10-05')];
  assert.deepEqual(reproductionNotes(view(events, '2026-11-13'), { inMilk: false, attributionChanged: true }), [
    { code: 'attribution_changed', text: 'The latest record changed which service this pregnancy is counted from.' },
  ]);
  assert.deepEqual(codes(events, '2026-11-13'), []);
});

test('animal detail: notes ride with the view; none for a plain confirmed pregnancy', () => {
  const db = breedingHerd();
  const kali = animalDetail(db, 'BD-0004', { asOf: BREEDING_AS_OF });
  assert.deepEqual(kali?.reproduction_notes, []);
  const unserved = animalDetail(db, 'BD-0001', { asOf: '2020-01-01' });
  assert.deepEqual([unserved?.reproduction, unserved?.reproduction_notes], [null, []]);
});
