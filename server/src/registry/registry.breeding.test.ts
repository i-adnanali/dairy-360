// Animal registry -- the breeding write path: four refusals and nothing else.

import assert from 'node:assert';
import { test } from 'node:test';

import { USAGE, buildBreedingPayload } from './breed';
import { recordBreedingEvent } from './breeding';
import { CliError, parseFlags } from './cli';
import { isRegistryError } from './errors';
import { addAcquired, addDeparture, freshDb, RECALL } from './fixtures';
import { checkSnapshot } from './invariants';
import { eventsForAnimal, snapshot } from './store';
import type { Db } from './schema';

function herd(): Db {
  const db = freshDb();
  addAcquired(db, { id: 'BD-0001', sex: 'female', acquired_on: '2024-03-01', acquired_precision: 'month' });
  addAcquired(db, { id: 'BD-0002', sex: 'male', acquired_on: '2024-03-01', acquired_precision: 'month' });
  return db;
}
const base = { occurred_on: '2026-01-20', date_precision: 'day' as const, provenance: RECALL };
const refuses = (db: Db, input: object, code: string) =>
  assert.throws(() => recordBreedingEvent(db, input as never), (e: unknown) => isRegistryError(e) && e.code === code);

test('a service is written as an ordinary appended event', () => {
  const db = herd();
  const { event_id } = recordBreedingEvent(db, { ...base, animal_id: 'BD-0001', type: 'insemination', payload: { service_type: 'ai' } });
  const row = eventsForAnimal(db, 'BD-0001').find((e) => e.id === event_id)!;
  assert.deepEqual([row.type, row.payload], ['insemination', { service_type: 'ai', exposure_days: null }]);
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
