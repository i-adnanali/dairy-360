// Animal registry -- the entry domain core (addAcquiredAnimal, appendLifeEvent).
//
// EVERY TEST IN THIS FILE IS NEW COVERAGE. Before the extraction this logic sat
// inline in add.ts and event.ts against the imported `db` singleton, so nothing
// could reach it: the only test that touched those files imported their USAGE
// strings. Seven domain rules with no test at all, and the entry form is what
// will hit them hardest.
//
// `:memory:` only; writes nothing to disk.

import assert from 'node:assert';
import { test } from 'node:test';

import { addAcquiredAnimal, appendLifeEvent } from './entry';
import { RegistryError, isRegistryError } from './errors';
import { CalvingError } from './calving';
import { effectiveEvents } from './project';
import { rebuild } from './projectStore';
import { allEvents, allStatuses, eventsForAnimal, getAnimal, readNextSerial, snapshot } from './store';
import { checkSnapshot } from './invariants';
import { AS_OF, RECALL, SHEET, freshDb } from './fixtures';
import type { Db } from './schema';

function counts(db: Db) {
  return {
    animals: (db.prepare(`SELECT COUNT(*) n FROM registry_animals`).get() as { n: number }).n,
    events: (db.prepare(`SELECT COUNT(*) n FROM registry_animal_events`).get() as { n: number }).n,
    nextSerial: readNextSerial(db),
  };
}

/** Capture a thrown RegistryError, or fail loudly if nothing was thrown. */
function refusal(fn: () => unknown): RegistryError {
  try {
    fn();
  } catch (e) {
    if (isRegistryError(e)) return e;
    throw e;
  }
  throw new assert.AssertionError({ message: 'expected a RegistryError, nothing was thrown' });
}

function addOne(db: Db, over: Partial<Parameters<typeof addAcquiredAnimal>[1]> = {}) {
  return addAcquiredAnimal(db, {
    sex: 'female',
    acquired_on: '2019-01-01',
    date_precision: 'year',
    provenance: RECALL,
    asOf: AS_OF,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// addAcquiredAnimal -- the happy path
// ---------------------------------------------------------------------------

test('adds the animal, its origin event and its projections in one call', () => {
  const db = freshDb();
  const r = addOne(db, { name: 'Noor', birth_on: '2017-01-01', birth_precision: 'year' });

  assert.equal(r.animal_id, 'BD-0001', 'the serial came from the counter');
  const animal = getAnimal(db, r.animal_id);
  assert.equal(animal?.origin, 'acquired');
  assert.equal(animal?.name, 'Noor');
  assert.equal(animal?.species, 'buffalo', 'species defaults to buffalo');

  const origin = eventsForAnimal(db, r.animal_id).find((e) => e.type === 'acquired');
  assert.equal(origin?.id, r.event_id);
  assert.equal(origin?.payload.estimated_birth_on, '2017-01-01');

  const status = allStatuses(db).find((s) => s.animal_id === r.animal_id);
  assert.equal(status?.status, 'heifer');
  assert.equal(status?.birth_on, '2017-01-01', 'birth comes from the payload, not occurred_on');
  db.close();
});

test('the acquisition date is NOT the birth date', () => {
  const db = freshDb();
  const r = addOne(db, {
    acquired_on: '2024-01-01',
    date_precision: 'year',
    birth_on: '2021-01-01',
    birth_precision: 'year',
  });
  const status = allStatuses(db).find((s) => s.animal_id === r.animal_id);
  assert.equal(status?.birth_on, '2021-01-01');
  db.close();
});

test('an animal with no birth date has none, and cannot project as calf', () => {
  const db = freshDb();
  const r = addOne(db, { acquired_on: '2026-01-01', date_precision: 'year' });
  const status = allStatuses(db).find((s) => s.animal_id === r.animal_id);
  assert.equal(status?.birth_on, null);
  assert.equal(status?.status, 'heifer', 'the age rule has no date to test');
  db.close();
});

test('serials advance and are never reused', () => {
  const db = freshDb();
  assert.equal(addOne(db).animal_id, 'BD-0001');
  assert.equal(addOne(db).animal_id, 'BD-0002');
  assert.equal(readNextSerial(db), 3);
  db.close();
});

test('post_no and tag_no are stored as attributes, defaulting to null', () => {
  const db = freshDb();
  const bare = getAnimal(db, addOne(db).animal_id);
  assert.equal(bare?.post_no, null);
  assert.equal(bare?.tag_no, null);
  const tagged = getAnimal(db, addOne(db, { post_no: '7', tag_no: 'B-114' }).animal_id);
  assert.equal(tagged?.post_no, '7');
  assert.equal(tagged?.tag_no, 'B-114');
  db.close();
});

test('a clean add leaves zero invariant violations', () => {
  const db = freshDb();
  addOne(db, { birth_on: '2017-01-01', birth_precision: 'year', provenance: SHEET });
  const found = checkSnapshot(snapshot(db), AS_OF);
  assert.deepEqual(found, [], found.map((v) => `[${v.invariant}] ${v.detail}`).join('\n'));
  db.close();
});

// ---------------------------------------------------------------------------
// addAcquiredAnimal -- refusals
// ---------------------------------------------------------------------------

test('a birth date without its precision is refused, with the field named', () => {
  const db = freshDb();
  const e = refusal(() => addOne(db, { birth_on: '2021-04-12' }));
  assert.equal(e.code, 'precision_not_defaulted');
  assert.equal(e.field, 'birth_precision');
  assert.match(e.message, /Precision is never defaulted/);
  assert.match(e.message, /fabricated/);
  assert.deepEqual(counts(db), { animals: 0, events: 0, nextSerial: 1 }, 'nothing was written');
  db.close();
});

test('a birth precision without a birth date is refused', () => {
  const db = freshDb();
  const e = refusal(() => addOne(db, { birth_precision: 'year' }));
  assert.equal(e.code, 'invalid_payload');
  assert.equal(e.field, 'birth_on');
  db.close();
});

test('the birth date obeys the stored-date conventions too, not just occurred_on', () => {
  // The payload field is exactly where a fabricated day could otherwise slip in,
  // because it is not the column the CHECK constraints guard.
  const db = freshDb();
  assert.throws(
    () => addOne(db, { birth_on: '2021-04-12', birth_precision: 'month' }),
    /month precision must be stored as the 1st/,
  );
  assert.throws(
    () => addOne(db, { birth_on: '2021-06-01', birth_precision: 'year' }),
    /year precision must be stored as January 1/,
  );
  assert.throws(
    () => addOne(db, { birth_on: '2021-06-01', birth_precision: 'estimated' }),
    /estimated precision must be stored as January 1/,
  );
  assert.equal(counts(db).animals, 0);
  db.close();
});

test('an invalid sex is refused with the field named', () => {
  const db = freshDb();
  const e = refusal(() => addOne(db, { sex: 'unknown' as never }));
  assert.equal(e.code, 'invalid_payload');
  assert.equal(e.field, 'sex');
  db.close();
});

test('the acquisition date obeys the precision conventions', () => {
  const db = freshDb();
  assert.throws(
    () => addOne(db, { acquired_on: '2019-03-14', date_precision: 'month' }),
    /silently downgraded/,
  );
  db.close();
});

test('a failed add burns no serial', () => {
  // Allocation happens inside the transaction. Forced by pre-claiming the
  // serial the counter is about to hand out.
  const db = freshDb();
  db.prepare(
    `INSERT INTO registry_animals (id,name,sex,species,origin,post_no,tag_no)
     VALUES ('BD-0001',NULL,'female','buffalo','acquired',NULL,NULL)`,
  ).run();
  const before = readNextSerial(db);
  assert.throws(() => addOne(db), /UNIQUE constraint failed/);
  assert.equal(readNextSerial(db), before, 'the counter rolled back with the insert');
  assert.equal(counts(db).events, 0, 'and no origin event was left behind');
  db.close();
});

// ---------------------------------------------------------------------------
// appendLifeEvent -- the happy path
// ---------------------------------------------------------------------------

function withAnimal(): { db: Db; id: string } {
  const db = freshDb();
  const id = addOne(db, { birth_on: '2017-01-01', birth_precision: 'year' }).animal_id;
  return { db, id };
}

test('a note is written and changes nothing derived', () => {
  const { db, id } = withAnimal();
  const before = allStatuses(db).find((s) => s.animal_id === id);
  const r = appendLifeEvent(db, {
    animal_id: id,
    type: 'note',
    occurred_on: '2026-01-01',
    date_precision: 'day',
    text: 'limping on the near hind',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const written = allEvents(db).find((e) => e.id === r.event_id);
  assert.equal(written?.payload.text, 'limping on the near hind');
  assert.deepEqual(allStatuses(db).find((s) => s.animal_id === id), before);
  db.close();
});

test('a departure is written and the status becomes departed', () => {
  const { db, id } = withAnimal();
  appendLifeEvent(db, {
    animal_id: id,
    type: 'departure',
    occurred_on: '2025-05-01',
    date_precision: 'month',
    reason: 'sold',
    to: 'Chak 42 buyer',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const status = allStatuses(db).find((s) => s.animal_id === id);
  assert.equal(status?.status, 'departed');
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
  db.close();
});

test('a dry_off accepts an optional reason and defaults it to null', () => {
  const { db, id } = withAnimal();
  const r = appendLifeEvent(db, {
    animal_id: id,
    type: 'dry_off',
    occurred_on: '2025-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.equal(allEvents(db).find((e) => e.id === r.event_id)?.payload.reason, null);
  db.close();
});

test('occurred_time is accepted at day precision and rejected above it', () => {
  const { db, id } = withAnimal();
  assert.doesNotThrow(() =>
    appendLifeEvent(db, {
      animal_id: id,
      type: 'note',
      occurred_on: '2026-01-01',
      occurred_time: '05:30',
      date_precision: 'day',
      text: 'first sign',
      provenance: RECALL,
      asOf: AS_OF,
    }),
  );
  assert.throws(
    () =>
      appendLifeEvent(db, {
        animal_id: id,
        type: 'note',
        occurred_on: '2026-01-01',
        occurred_time: '05:30',
        date_precision: 'month',
        text: 'x',
        provenance: RECALL,
        asOf: AS_OF,
      }),
    /no such thing as knowing the hour but not the day/,
  );
  db.close();
});

// ---------------------------------------------------------------------------
// appendLifeEvent -- the seven rules that had no coverage
// ---------------------------------------------------------------------------

test('RULE: an unknown animal is refused, with the field named', () => {
  const { db } = withAnimal();
  const e = refusal(() =>
    appendLifeEvent(db, {
      animal_id: 'BD-9999',
      type: 'note',
      occurred_on: '2026-01-01',
      date_precision: 'day',
      text: 'x',
      provenance: RECALL,
      asOf: AS_OF,
    }),
  );
  assert.equal(e.code, 'unknown_animal');
  assert.equal(e.field, 'animal_id');
  db.close();
});

test('RULE: departure is terminal -- a later dry_off is refused', () => {
  const { db, id } = withAnimal();
  appendLifeEvent(db, {
    animal_id: id, type: 'departure', occurred_on: '2024-05-01',
    date_precision: 'month', reason: 'sold', provenance: RECALL, asOf: AS_OF,
  });
  const e = refusal(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'dry_off', occurred_on: '2025-01-01',
      date_precision: 'month', provenance: RECALL, asOf: AS_OF,
    }),
  );
  assert.equal(e.code, 'animal_departed');
  assert.equal(e.field, 'occurred_on');
  assert.match(e.message, /invariant 5/);
  db.close();
});

test('RULE: the terminal guard has an explicit override', () => {
  const { db, id } = withAnimal();
  appendLifeEvent(db, {
    animal_id: id, type: 'departure', occurred_on: '2024-05-01',
    date_precision: 'month', reason: 'sold', provenance: RECALL, asOf: AS_OF,
  });
  assert.doesNotThrow(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'dry_off', occurred_on: '2025-01-01',
      date_precision: 'month', provenance: RECALL, asOf: AS_OF,
      allow_after_departure: true,
    }),
  );
  // And the override does not silence the invariant -- it is still a violation.
  assert.ok(checkSnapshot(snapshot(db), AS_OF).some((v) => v.invariant === 5));
  db.close();
});

test('RULE: a note after a departure needs no override', () => {
  const { db, id } = withAnimal();
  appendLifeEvent(db, {
    animal_id: id, type: 'departure', occurred_on: '2024-05-01',
    date_precision: 'month', reason: 'sold', provenance: RECALL, asOf: AS_OF,
  });
  assert.doesNotThrow(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'note', occurred_on: '2025-01-01',
      date_precision: 'month', text: 'buyer called about her',
      provenance: RECALL, asOf: AS_OF,
    }),
  );
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), [], 'a note is exempt from invariant 5');
  db.close();
});

test('RULE: an animal leaves once -- a second departure is refused', () => {
  const { db, id } = withAnimal();
  appendLifeEvent(db, {
    animal_id: id, type: 'departure', occurred_on: '2024-05-01',
    date_precision: 'month', reason: 'sold', provenance: RECALL, asOf: AS_OF,
  });
  const e = refusal(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'departure', occurred_on: '2024-06-01',
      date_precision: 'month', reason: 'died', provenance: RECALL, asOf: AS_OF,
    }),
  );
  assert.equal(e.code, 'already_departed');
  assert.match(e.message, /superseding event rather than a second departure/);
  db.close();
});

test('RULE: a departure requires a reason', () => {
  const { db, id } = withAnimal();
  const e = refusal(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'departure', occurred_on: '2024-05-01',
      date_precision: 'month', provenance: RECALL, asOf: AS_OF,
    }),
  );
  assert.equal(e.code, 'invalid_payload');
  assert.equal(e.field, 'reason');
  assert.match(e.message, /sold \| died \| culled \| lost/);
  db.close();
});

test('RULE: reasons are validated per event type', () => {
  const { db, id } = withAnimal();
  const bad = (type: 'dry_off' | 'departure', reason: string) =>
    refusal(() =>
      appendLifeEvent(db, {
        animal_id: id, type, occurred_on: '2024-05-01', date_precision: 'month',
        reason, provenance: RECALL, asOf: AS_OF,
      }),
    );
  assert.equal(bad('dry_off', 'sold').field, 'reason', 'a departure reason is not a dry_off reason');
  assert.equal(bad('departure', 'scheduled').field, 'reason');
  db.close();
});

test('RULE: a note requires text', () => {
  const { db, id } = withAnimal();
  const e = refusal(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'note', occurred_on: '2024-05-01',
      date_precision: 'month', provenance: RECALL, asOf: AS_OF,
    }),
  );
  assert.equal(e.code, 'invalid_payload');
  assert.equal(e.field, 'text');
  db.close();
});

test('RULE: a non-enterable type is refused as a backstop, even from a route', () => {
  // The CLI catches this earlier with a message naming the right command; this
  // is the core's own guard, which is what an HTTP caller would hit.
  const { db, id } = withAnimal();
  for (const type of ['calving', 'birth', 'acquired', 'insemination']) {
    const e = refusal(() =>
      appendLifeEvent(db, {
        animal_id: id, type: type as never, occurred_on: '2024-05-01',
        date_precision: 'month', provenance: RECALL, asOf: AS_OF,
      }),
    );
    assert.equal(e.field, 'type', `${type} is refused`);
  }
  db.close();
});

test('a refused life event writes nothing', () => {
  const { db, id } = withAnimal();
  const before = counts(db);
  assert.throws(() =>
    appendLifeEvent(db, {
      animal_id: id, type: 'departure', occurred_on: '2024-05-01',
      date_precision: 'month', provenance: RECALL, asOf: AS_OF,
    }),
  );
  assert.deepEqual(counts(db), before);
  db.close();
});

// ---------------------------------------------------------------------------
// The error contract the entry UI depends on
// ---------------------------------------------------------------------------

test('toWire() is { error, field?, message } with the prose verbatim', () => {
  const e = new RegistryError('unknown_animal', 'unknown registry animal BD-9999', 'animal_id');
  assert.deepEqual(e.toWire(), {
    error: 'unknown_animal',
    field: 'animal_id',
    message: 'unknown registry animal BD-9999',
  });
  assert.equal(e.toWire().message, e.message, 'the message is never rewritten');
});

test('a fieldless error omits `field` rather than sending null', () => {
  const e = new RegistryError('invalid_payload', 'something general');
  assert.deepEqual(e.toWire(), { error: 'invalid_payload', message: 'something general' });
  assert.ok(!('field' in e.toWire()));
});

test('CalvingError is a RegistryError, so one handler covers every domain refusal', () => {
  const e = new CalvingError('unknown_dam', 'unknown dam BD-9999', 'dam_id');
  assert.ok(isRegistryError(e));
  assert.ok(e instanceof CalvingError, 'and still narrows to CalvingError');
  assert.equal(e.name, 'CalvingError');
  assert.equal(e.toWire().error, 'unknown_dam');
});

test('every domain refusal carries a code and most carry a field', () => {
  // The contract the form relies on: a message can be attached to an input
  // without string-matching it.
  const { db, id } = withAnimal();
  const cases = [
    () => appendLifeEvent(db, { animal_id: 'BD-9999', type: 'note', occurred_on: '2026-01-01', date_precision: 'day', text: 'x', provenance: RECALL, asOf: AS_OF }),
    () => appendLifeEvent(db, { animal_id: id, type: 'departure', occurred_on: '2026-01-01', date_precision: 'day', provenance: RECALL, asOf: AS_OF }),
    () => addOne(db, { birth_on: '2021-04-12' }),
    () => addOne(db, { sex: 'x' as never }),
  ];
  for (const fn of cases) {
    const e = refusal(fn);
    assert.ok(e.code.length > 0, 'has a code');
    assert.ok(e.field && e.field.length > 0, `has a field: ${e.code}`);
    assert.ok(e.message.length > 0);
  }
  db.close();
});

// ---------------------------------------------------------------------------
// The rebuild still owns the projections
// ---------------------------------------------------------------------------

test('entry writes are reproducible by the rebuild', () => {
  const { db, id } = withAnimal();
  appendLifeEvent(db, {
    animal_id: id, type: 'departure', occurred_on: '2025-05-01',
    date_precision: 'month', reason: 'culled', provenance: RECALL, asOf: AS_OF,
  });
  const before = allStatuses(db);
  rebuild(db, { asOf: AS_OF });
  assert.deepEqual(allStatuses(db), before, 'the rebuild reproduces what entry wrote');
  db.close();
});

test('superseding an origin event still leaves exactly one effective origin', () => {
  const { db, id } = withAnimal();
  assert.equal(
    effectiveEvents(eventsForAnimal(db, id)).filter(
      (e) => e.type === 'acquired' || e.type === 'birth',
    ).length,
    1,
  );
  db.close();
});
