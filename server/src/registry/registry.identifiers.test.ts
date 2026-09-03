// Animal registry -- previously-used free-text identifier values.
//
// Free text typed across a hundred records produces `abdul`, `Abdul` and
// `abdul_r`: three identifiers for one person, which makes "everything Abdul
// observed" unanswerable and cannot be repaired without guessing which spelling
// was meant. These are the suggestions that turn the second occurrence of a
// name into a pick rather than a retype.

import assert from 'node:assert';
import { test } from 'node:test';

import { addAcquired, cleanHerd, freshDb } from './fixtures';
import { addAcquiredAnimal, appendLifeEvent } from './entry';
import { correctCalving, recordCalving } from './calving';
import { identifierValues } from './reads';

const AS_OF = '2026-09-01';

test('an empty registry offers empty lists, not an error', () => {
  // The first hour of real entry. Three empty arrays make every input behave as
  // a plain text field, which is correct and must not look broken.
  assert.deepEqual(identifierValues(freshDb()), {
    observed_by: [],
    acquired_from: [],
    sire_ref: [],
  });
});

test('observed_by is collected from every event type', () => {
  const db = freshDb();
  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
    provenance: { source_form: 'recall', recorded_by: 'adnan', observed_by: 'abdul' },
  });
  appendLifeEvent(db, {
    animal_id: 'BD-0001',
    type: 'note',
    text: 'seen limping',
    occurred_on: '2024-03-01',
    date_precision: 'month',
    provenance: { source_form: 'recall', recorded_by: 'adnan', observed_by: 'rashid' },
    asOf: AS_OF,
  });

  assert.deepEqual(identifierValues(db).observed_by, ['abdul', 'rashid']);
});

test('acquired_from comes from the acquired payload, sire_ref from the birth payload', () => {
  // The real domain functions rather than the fixture helpers, which do not
  // take `from` or `sire_ref` -- and going through the real write path is the
  // better test anyway, since these values have to survive payload validation.
  const db = freshDb();
  const prov = { source_form: 'recall' as const, recorded_by: 'adnan' };
  const { animal_id } = addAcquiredAnimal(db, {
    sex: 'female',
    acquired_on: '2019-01-01',
    date_precision: 'year',
    from: 'Chak 47 dairy',
    provenance: prov,
    asOf: AS_OF,
  });
  recordCalving(db, {
    dam_id: animal_id,
    occurred_on: '2024-06-02',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    sire_ref: 'Nili bull #3',
    provenance: prov,
    asOf: AS_OF,
  });

  const v = identifierValues(db);
  assert.deepEqual(v.acquired_from, ['Chak 47 dairy']);
  assert.deepEqual(v.sire_ref, ['Nili bull #3']);
});

test('CASE VARIANTS ARE BOTH LISTED -- collapsing them would hide the problem', () => {
  // The temptation is to deduplicate case-insensitively and show one. That
  // hides from the operator that two spellings are already in the log, which is
  // precisely the thing worth seeing. Suggesting both is what lets them notice
  // and pick one.
  const db = freshDb();
  for (const [i, who] of ['abdul', 'Abdul', 'abdul_r'].entries()) {
    addAcquired(db, {
      id: `BD-000${i + 1}`,
      sex: 'female',
      acquired_on: '2019-01-01',
      acquired_precision: 'year',
      provenance: { source_form: 'recall', recorded_by: 'adnan', observed_by: who },
    });
  }
  assert.deepEqual(identifierValues(db).observed_by, ['abdul', 'Abdul', 'abdul_r']);
});

test('each value appears once however many events carry it', () => {
  const db = freshDb();
  for (const i of [1, 2, 3]) {
    addAcquired(db, {
      id: `BD-000${i}`,
      sex: 'female',
      acquired_on: '2019-01-01',
      acquired_precision: 'year',
      provenance: { source_form: 'recall', recorded_by: 'adnan', observed_by: 'abdul' },
    });
  }
  assert.deepEqual(identifierValues(db).observed_by, ['abdul']);
});

test('a blank observed_by contributes nothing', () => {
  // Null is the common case -- nobody observed a purchase record -- and an
  // empty option in a datalist is a row the operator can select by accident.
  const db = cleanHerd();
  const v = identifierValues(db);
  assert.ok(!v.observed_by.includes(''));
  assert.ok(!v.acquired_from.includes(''));
  assert.ok(!v.sire_ref.includes(''));
});

test('a name on a SUPERSEDED event is still suggested', () => {
  // It is still a name in use on this farm. Suggesting it is how the next
  // record spells it the same way, which is the entire point -- so this reads
  // allEvents() rather than effectiveEvents().
  const db = freshDb();
  const prov = (who: string) => ({
    source_form: 'recall' as const,
    recorded_by: 'adnan',
    observed_by: who,
  });
  const { animal_id } = addAcquiredAnimal(db, {
    sex: 'female',
    acquired_on: '2019-01-01',
    date_precision: 'year',
    provenance: prov('adnan'),
    asOf: AS_OF,
  });
  const c = recordCalving(db, {
    dam_id: animal_id,
    occurred_on: '2024-06-02',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    provenance: prov('abdul'),
    asOf: AS_OF,
  });

  correctCalving(db, {
    calving_event_id: c.calving_event_id,
    occurred_on: '2024-06-09',
    date_precision: 'day',
    provenance: prov('rashid'),
    asOf: AS_OF,
  });

  // `abdul` is now only on a superseded event, and must still be offered.
  assert.deepEqual(identifierValues(db).observed_by, ['abdul', 'adnan', 'rashid']);
});
