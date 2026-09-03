// Animal registry -- overridden checks leave a trace.
//
// Two guards can be stepped past: the near-duplicate calving window and the
// terminal-departure rule. Both were transient input flags, so an overridden
// write was INDISTINGUISHABLE from one that never tripped a check -- in an
// append-only log whose premise is that the record explains itself.
//
// The load-bearing assertion in this file is not "the override is recorded".
// It is that the override is recorded from the CONDITION rather than from the
// flag: a caller passing allow_* unconditionally must not have every write
// claim an override happened, or the field means nothing and the log is worse
// than it was when it said nothing at all.

import assert from 'node:assert';
import { test } from 'node:test';

import { addAcquired, addDeparture, calve, cleanHerd, freshDb } from './fixtures';
import { appendLifeEvent } from './entry';
import { recordCalving, correctCalving } from './calving';
import { assertEventPayload } from './events';
import { eventsForAnimal } from './store';
import { effectiveEvents } from './project';
import { rebuild } from './projectStore';
import type { OverrideRecord, RegistryEvent } from './types';

const AS_OF = '2026-09-01';
const PROV = { source_form: 'recall' as const, recorded_by: 'adnan' };

const overrideOf = (e: RegistryEvent): OverrideRecord | null =>
  (e.payload.override as OverrideRecord | null) ?? null;

function latest(db: ReturnType<typeof freshDb>, animalId: string, type: string): RegistryEvent {
  const all = effectiveEvents(eventsForAnimal(db, animalId)).filter((e) => e.type === type);
  return all[all.length - 1];
}

// ---------------------------------------------------------------------------
// The near-duplicate calving guard
// ---------------------------------------------------------------------------

function damWithOneCalving() {
  const db = freshDb();
  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
  });
  calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });
  return db;
}

test('a calving that trips no guard records NO override', () => {
  // The null case first, because it is what makes a non-null one mean anything.
  const db = damWithOneCalving();
  recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2026-01-05',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: PROV,
    asOf: AS_OF,
  });
  assert.equal(overrideOf(latest(db, 'BD-0001', 'calving')), null);
});

test('a calving inside the window, allowed explicitly, records WHICH check it stepped past', () => {
  const db = damWithOneCalving();
  recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2024-07-01', // 29 days after the existing calving
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: PROV,
    asOf: AS_OF,
    allow_near_duplicate: true,
    override_reason: 'twin born the following month, confirmed against the cycle card',
  });

  const o = overrideOf(latest(db, 'BD-0001', 'calving'));
  assert.deepEqual(o, {
    check: 'near_duplicate_calving',
    reason: 'twin born the following month, confirmed against the cycle card',
  });
});

test('THE FLAG ALONE DOES NOT CLAIM AN OVERRIDE -- the condition does', () => {
  // The whole point. A script or a form that sends allow_near_duplicate
  // unconditionally would otherwise mark every calving as overridden, and a
  // field that is always set carries no information.
  const db = damWithOneCalving();
  recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2026-01-05', // nowhere near the existing calving
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: PROV,
    asOf: AS_OF,
    allow_near_duplicate: true, // set, but nothing to override
    override_reason: 'should not be recorded',
  });
  assert.equal(
    overrideOf(latest(db, 'BD-0001', 'calving')),
    null,
    'no guard was tripped, so nothing was overridden',
  );
});

test('the guard still REFUSES without the flag -- recording it is not permitting it', () => {
  const db = damWithOneCalving();
  assert.throws(
    () =>
      recordCalving(db, {
        dam_id: 'BD-0001',
        occurred_on: '2024-07-01',
        date_precision: 'day',
        calf: { sex: 'female', outcome: 'live' },
        provenance: PROV,
        asOf: AS_OF,
      }),
    /far more likely a double entry/,
  );
});

test('a reason is optional: the flag is what is load-bearing', () => {
  // Requiring prose to clear a guard makes the guard a wall, and the operator
  // types "yes" -- which looks like a reason and is worse than a null.
  const db = damWithOneCalving();
  recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2024-07-01',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: PROV,
    asOf: AS_OF,
    allow_near_duplicate: true,
  });
  assert.deepEqual(overrideOf(latest(db, 'BD-0001', 'calving')), {
    check: 'near_duplicate_calving',
    reason: null,
  });
});

// ---------------------------------------------------------------------------
// The terminal-departure guard
// ---------------------------------------------------------------------------

function departedAnimal() {
  const db = freshDb();
  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
  });
  addDeparture(db, { animal_id: 'BD-0001', on: '2024-05-01', precision: 'month' });
  return db;
}

test('a dry_off after a departure, allowed explicitly, records the override', () => {
  const db = departedAnimal();
  appendLifeEvent(db, {
    animal_id: 'BD-0001',
    type: 'dry_off',
    occurred_on: '2024-08-01',
    date_precision: 'month',
    provenance: PROV,
    asOf: AS_OF,
    allow_after_departure: true,
    override_reason: 'sold in May but stayed on the farm until August',
  });
  assert.deepEqual(overrideOf(latest(db, 'BD-0001', 'dry_off')), {
    check: 'animal_departed',
    reason: 'sold in May but stayed on the farm until August',
  });
});

test('an event on a NON-departed animal records nothing, flag or no flag', () => {
  const db = freshDb();
  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
  });
  appendLifeEvent(db, {
    animal_id: 'BD-0001',
    type: 'dry_off',
    occurred_on: '2024-08-01',
    date_precision: 'month',
    provenance: PROV,
    asOf: AS_OF,
    allow_after_departure: true,
    override_reason: 'should not be recorded',
  });
  assert.equal(overrideOf(latest(db, 'BD-0001', 'dry_off')), null);
});

test('a note after a departure records no override -- there is no guard to step past', () => {
  // A note is always allowed after a departure; somebody ringing about a sold
  // animal is a real thing to record. So `note` has no override field at all,
  // and asking for one is rejected by the write boundary (below).
  const db = departedAnimal();
  appendLifeEvent(db, {
    animal_id: 'BD-0001',
    type: 'note',
    text: 'buyer rang about her papers',
    occurred_on: '2024-09-01',
    date_precision: 'month',
    provenance: PROV,
    asOf: AS_OF,
    allow_after_departure: true,
  });
  const note = latest(db, 'BD-0001', 'note');
  assert.equal(note.payload.override, undefined, 'a note payload has no override key');
});

// ---------------------------------------------------------------------------
// Corrections
// ---------------------------------------------------------------------------

test('a correction records its OWN override, and does not inherit the superseded one', () => {
  // The superseded event keeps its own record of what it stepped past. Copying
  // it forward would claim the operator stepped past a guard they never saw.
  const db = cleanHerd();
  const calvings = effectiveEvents(eventsForAnimal(db, 'BD-0001')).filter(
    (e) => e.type === 'calving',
  );
  const target = calvings[0];

  const r = correctCalving(db, {
    calving_event_id: target.id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: PROV,
    asOf: AS_OF,
  });

  const corrected = eventsForAnimal(db, 'BD-0001').find((e) => e.id === r.calving_event_id)!;
  assert.equal(overrideOf(corrected), null, 'this correction tripped nothing');
});

// ---------------------------------------------------------------------------
// The write boundary
// ---------------------------------------------------------------------------

test('an override naming an unknown check is refused', () => {
  assert.throws(
    () =>
      assertEventPayload('dry_off', {
        override: { check: 'made_it_up', reason: null },
      }),
    /must be one of near_duplicate_calving \| animal_departed/,
  );
});

test('an override with an unknown key is refused', () => {
  // A typo'd key would otherwise be stored as JSON and read back as undefined,
  // which is the same silent-wrong-value class rejectUnknownKeys exists for.
  assert.throws(
    () =>
      assertEventPayload('departure', {
        reason: 'sold',
        override: { check: 'animal_departed', why: 'typo for reason' },
      }),
    /unknown payload key\(s\) 'why'/,
  );
});

test('a note payload REFUSES an override, because a note has no guard', () => {
  assert.throws(
    () => assertEventPayload('note', { text: 'hi', override: { check: 'animal_departed' } }),
    /unknown payload key\(s\) 'override'/,
  );
});

test('override normalises to null so serialization stays stable', () => {
  // Same contract as every other optional: absent and explicit-null must
  // serialize identically, or the rebuild-diff reads a change that is not one.
  assert.deepEqual(assertEventPayload('dry_off', {}), {
    reason: null,
    notes: null,
    override: null,
  });
  assert.deepEqual(assertEventPayload('dry_off', { override: null }), {
    reason: null,
    notes: null,
    override: null,
  });
});

test('a recorded override survives a projection rebuild untouched', () => {
  // It lives in the payload, and no projection reads the payload's override --
  // so a rebuild must neither drop it nor act on it.
  const db = damWithOneCalving();
  recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2024-07-01',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: PROV,
    asOf: AS_OF,
    allow_near_duplicate: true,
    override_reason: 'checked against the card',
  });
  const before = overrideOf(latest(db, 'BD-0001', 'calving'));

  rebuild(db, { asOf: AS_OF });

  assert.deepEqual(overrideOf(latest(db, 'BD-0001', 'calving')), before);
});
