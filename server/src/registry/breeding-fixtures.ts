// Animal registry -- a synthetic herd for looking at the breeding badge.
//
// Memory-only, like the rest of the harness: this file must never import `../db`
// (registry.harness.test.ts asserts it). Every row goes through the real write
// paths, so the herd is also a standing check that those paths accept the cases
// a farm will actually record.
//
// "Today" for this herd is BREEDING_AS_OF. The page asks the server for today's
// state, so the states drift as the real date moves on. `?as_of=2026-11-13` on the
// API URL pins them (e.g. /api/registry/animals/BD-0001?as_of=2026-11-13); the page
// does not forward it.

import { addAcquired, addDryOff, calve, freshDb, RECALL, resetRecordedSeq } from './fixtures';
import { recordBreedingEvent } from './breeding';
import { rebuild } from './projectStore';
import type { Db } from './schema';
import type { DatePrecision } from './types';

export const BREEDING_AS_OF = '2026-11-13';

/** The animals the --breeding harness opens manual entry for: Heer and Shehzadi. */
export const BREEDING_PILOT: readonly string[] = ['BD-0007', 'BD-0009'];

interface Step {
  type: 'insemination' | 'pregnancy_check' | 'heat_observed';
  on: string;
  precision?: DatePrecision;
  payload: Record<string, unknown>;
}

const svc = (on: string, over: Partial<Step> = {}, payload: Record<string, unknown> = { service_type: 'ai', exposure_days: null }): Step =>
  ({ type: 'insemination', on, payload, ...over });
const check = (on: string, method: string, result: string): Step =>
  ({ type: 'pregnancy_check', on, payload: { method, result } });
const heat = (on: string): Step => ({ type: 'heat_observed', on, payload: { sign: 'standing' } });

interface Cow {
  id: string;
  name: string;
  /** Calvings (and the dry-off that follows each one, if any), oldest first. */
  calvings: { on: string; dryOff?: string }[];
  steps: Step[];
}

// Each cow has calved at least once before her service, because `dryoff` needs an
// open lactation (she must be in milk). The cows further on were dried off, as a
// farm would; `window`, `close` and `overdue` are decided before the in-milk rule,
// so that dry-off does not change their state. The Task 3 sample-herd dates are
// kept verbatim, so the states match registry.reproduction.test.ts.
const COWS: Cow[] = [
  { id: 'BD-0001', name: 'Sohni', calvings: [{ on: '2024-09-01', dryOff: '2025-07-01' }], steps: [svc('2025-11-28'), check('2026-02-10', 'palpation', 'positive')] },
  { id: 'BD-0002', name: 'Rani', calvings: [{ on: '2025-02-01', dryOff: '2025-11-30' }], steps: [svc('2026-01-20'), check('2026-03-03', 'ultrasound', 'positive')] },
  { id: 'BD-0003', name: 'Noori', calvings: [{ on: '2025-12-01' }], steps: [svc('2026-03-05'), check('2026-05-12', 'palpation', 'positive')] },
  { id: 'BD-0004', name: 'Kali', calvings: [{ on: '2026-03-01' }], steps: [svc('2026-07-14'), check('2026-09-15', 'palpation', 'positive')] },
  { id: 'BD-0005', name: 'Laali', calvings: [{ on: '2026-04-15' }], steps: [svc('2026-08-11'), check('2026-09-22', 'ultrasound', 'positive'), heat('2026-11-10')] },
  { id: 'BD-0006', name: 'Moti', calvings: [{ on: '2026-05-20' }], steps: [svc('2026-09-02')] },
  { id: 'BD-0007', name: 'Heer', calvings: [{ on: '2026-06-10' }], steps: [svc('2026-10-09')] },
  { id: 'BD-0008', name: 'Gulabo', calvings: [{ on: '2026-07-15' }], steps: [svc('2026-10-24')] },
  { id: 'BD-0009', name: 'Shehzadi', calvings: [{ on: '2026-06-01' }], steps: [svc('2026-09-18'), check('2026-10-30', 'ultrasound', 'negative')] },
  // The bull ran with her for 45 days from some time in June; nobody checked her.
  { id: 'BD-0010', name: 'Bulbul', calvings: [{ on: '2025-11-01' }], steps: [svc('2026-06-01', { precision: 'month' }, { service_type: 'bull_exposure', exposure_days: 45 })] },
  // Served, confirmed, and already calved: the last calving is recorded after the steps.
  { id: 'BD-0011', name: 'Champa', calvings: [{ on: '2024-12-01', dryOff: '2025-10-01' }], steps: [svc('2025-12-20'), check('2026-02-18', 'palpation', 'positive')] },
];

/** Champa's calving from the service above. */
const CHAMPA_CALVING = '2026-10-28';

export function breedingHerd(): Db {
  resetRecordedSeq();
  const db = freshDb();
  // Every cow is added before any calf is born: a calf takes the next free serial,
  // and the counter must already be past the last hand-placed one.
  for (const cow of COWS) {
    addAcquired(db, {
      id: cow.id,
      sex: 'female',
      name: cow.name,
      acquired_on: '2023-06-01',
      acquired_precision: 'day',
      birth_on: '2021-01-01',
      birth_precision: 'day',
    });
  }
  for (const cow of COWS) {
    for (const c of cow.calvings) {
      calve(db, { dam_id: cow.id, on: c.on, precision: 'day', sex: 'male' });
      if (c.dryOff) addDryOff(db, { animal_id: cow.id, on: c.dryOff, precision: 'day' });
    }
    for (const s of cow.steps) {
      recordBreedingEvent(db, {
        animal_id: cow.id,
        type: s.type,
        occurred_on: s.on,
        date_precision: s.precision ?? 'day',
        payload: s.payload,
        provenance: RECALL,
      });
    }
  }
  calve(db, { dam_id: 'BD-0011', on: CHAMPA_CALVING, precision: 'day', sex: 'male' });
  rebuild(db, { asOf: BREEDING_AS_OF });
  return db;
}
