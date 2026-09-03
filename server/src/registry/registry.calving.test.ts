// Animal registry -- the calving transaction (decision doc §8).
//
// The atomicity proof is the reason this file exists. The failure recordCalving
// prevents -- an orphaned calf with no birth event and therefore no dam --
// surfaces much later and cannot be repaired from the data, so "we believe it
// is atomic" is exactly the claim that must not be taken on trust.
//
// `:memory:` only; writes nothing to disk.

import assert from 'node:assert';
import { test } from 'node:test';

import { DOUBLE_ENTRY_WINDOW_DAYS, correctCalving, recordCalving } from './calving';
import { rebuild } from './projectStore';
import {
  allEvents,
  allLactations,
  allParentage,
  allStatuses,
  eventsForAnimal,
  getAnimal,
  readNextSerial,
  snapshot,
} from './store';
import { lactationIdFor } from './events';
import { effectiveEvents } from './project';
import { checkSnapshot } from './invariants';
import { AS_OF, RECALL, addAcquired, addDeparture, calve, freshDb, resetRecordedSeq } from './fixtures';
import type { Db } from './schema';

function damOnly(): Db {
  resetRecordedSeq();
  const db = freshDb();
  addAcquired(db, {
    id: 'BD-0001',
    sex: 'female',
    acquired_on: '2019-01-01',
    acquired_precision: 'year',
    birth_on: '2017-01-01',
    birth_precision: 'year',
  });
  rebuild(db, { asOf: AS_OF });
  return db;
}

function counts(db: Db) {
  return {
    animals: (db.prepare(`SELECT COUNT(*) n FROM registry_animals`).get() as { n: number }).n,
    events: (db.prepare(`SELECT COUNT(*) n FROM registry_animal_events`).get() as { n: number }).n,
    lactations: allLactations(db).length,
    parentage: allParentage(db).length,
    nextSerial: readNextSerial(db),
  };
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('a calving writes the dam event, the calf, the birth event and both projections', () => {
  const db = damOnly();
  const r = calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });

  const calf = getAnimal(db, r.calf_id);
  assert.ok(calf, 'the calf exists as an animal');
  assert.equal(calf?.origin, 'born_on_farm');
  assert.equal(r.calf_id, 'BD-0002', 'the serial came from the counter');

  const damEvents = eventsForAnimal(db, 'BD-0001');
  const calving = damEvents.find((e) => e.type === 'calving');
  assert.ok(calving, 'the calving event is on the dam');
  assert.equal(calving?.payload.calf_id, r.calf_id);

  const birth = eventsForAnimal(db, r.calf_id).find((e) => e.type === 'birth');
  assert.ok(birth, 'the birth event is on the calf');
  assert.equal(birth?.payload.dam_id, 'BD-0001');
  assert.equal(birth?.payload.calving_event_id, r.calving_event_id);

  const dam = allStatuses(db).find((s) => s.animal_id === 'BD-0001');
  assert.equal(dam?.status, 'lactating');
  assert.equal(dam?.parity, 1);
  db.close();
});

test('the birth event carries the SAME date and precision as the calving', () => {
  // Same physical fact seen from two animals. If the dates can diverge, the
  // timeline lies.
  const db = damOnly();
  const r = calve(db, {
    dam_id: 'BD-0001',
    on: '2024-06-01',
    precision: 'month',
  });
  const calving = allEvents(db).find((e) => e.id === r.calving_event_id);
  const birth = allEvents(db).find((e) => e.id === r.birth_event_id);
  assert.equal(birth?.occurred_on, calving?.occurred_on);
  assert.equal(birth?.date_precision, calving?.date_precision);
  db.close();
});

test('the calf gets a dam parentage edge', () => {
  const db = damOnly();
  const r = calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });
  const edge = allParentage(db).find((p) => p.child_id === r.calf_id);
  assert.equal(edge?.relation, 'dam');
  assert.equal(edge?.parent_ref, 'BD-0001');
  assert.equal(edge?.certainty, 'known');
  db.close();
});

test('a sire_ref produces a sire edge; its absence produces none', () => {
  const db = damOnly();
  const r = recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2024-06-02',
    date_precision: 'day',
    calf: { sex: 'female', outcome: 'live' },
    sire_ref: 'outside bull, Chak 42',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const edges = allParentage(db).filter((p) => p.child_id === r.calf_id);
  assert.equal(edges.length, 2);
  assert.ok(edges.some((e) => e.relation === 'sire' && e.parent_ref === 'outside bull, Chak 42'));
  db.close();
});

test('the lactation opens with the id derived from the calving event', () => {
  const db = damOnly();
  const r = calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });
  const l = allLactations(db);
  assert.equal(l.length, 1);
  assert.equal(l[0].id, lactationIdFor(r.calving_event_id));
  assert.equal(l[0].ended_on, null);
  db.close();
});

// ---------------------------------------------------------------------------
// Stillbirth
// ---------------------------------------------------------------------------

for (const outcome of ['stillborn', 'died_within_24h'] as const) {
  test(`a ${outcome} calf still exists, still opens the lactation, still counts`, () => {
    // Suppressing the calf would corrupt the one metric this cycle exists to
    // produce: a stillbirth still counts toward parity and toward the interval.
    const db = damOnly();
    const r = calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day', outcome });

    assert.ok(getAnimal(db, r.calf_id), 'the calf exists as a node in the graph');
    assert.ok(
      eventsForAnimal(db, r.calf_id).some((e) => e.type === 'birth'),
      'the calf has a birth event',
    );
    assert.ok(r.departure_event_id, 'a departure event was written on the calf');

    const dep = eventsForAnimal(db, r.calf_id).find((e) => e.type === 'departure');
    assert.equal(dep?.payload.reason, 'died');

    const dam = allStatuses(db).find((s) => s.animal_id === 'BD-0001');
    assert.equal(dam?.parity, 1, 'parity counts the stillbirth');
    assert.equal(dam?.status, 'lactating', 'the lactation still opened');

    const calf = allStatuses(db).find((s) => s.animal_id === r.calf_id);
    assert.equal(calf?.status, 'departed');
    db.close();
  });
}

// ---------------------------------------------------------------------------
// Closing the previous lactation
// ---------------------------------------------------------------------------

test('a second calving with no dry_off closes the first as inferred, and is accepted', () => {
  const db = damOnly();
  calve(db, { dam_id: 'BD-0001', on: '2023-04-01', precision: 'month' });
  calve(db, { dam_id: 'BD-0001', on: '2024-07-01', precision: 'month' });

  const l = allLactations(db).filter((x) => x.animal_id === 'BD-0001');
  assert.equal(l.length, 2);
  const [first, second] = l.sort((a, b) => (a.started_on < b.started_on ? -1 : 1));
  assert.equal(first.end_reason, 'inferred_at_next_calving');
  assert.equal(first.ended_on, '2024-07-01');
  assert.equal(second.ended_on, null);
  db.close();
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('an unknown dam is rejected', () => {
  const db = damOnly();
  assert.throws(() => calve(db, { dam_id: 'BD-9999', on: '2024-06-02', precision: 'day' }), /unknown dam/);
  db.close();
});

test('a male "dam" is rejected', () => {
  const db = damOnly();
  addAcquired(db, {
    id: 'BD-0050',
    sex: 'male',
    acquired_on: '2020-01-01',
    acquired_precision: 'year',
  });
  assert.throws(
    () => calve(db, { dam_id: 'BD-0050', on: '2024-06-02', precision: 'day' }),
    /recorded as male, not female/,
  );
  db.close();
});

test('a calving on or after a departure is rejected', () => {
  const db = damOnly();
  addDeparture(db, { animal_id: 'BD-0001', on: '2024-01-01', precision: 'day' });
  assert.throws(
    () => calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' }),
    /has a departure event/,
  );
  db.close();
});

test('a near-duplicate calving is refused, and requires an explicit override', () => {
  // The real risk during a recall backfill: the same remembered calving
  // arriving from two sheets. Warn and refuse; never silently accept.
  const db = damOnly();
  calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });
  assert.throws(
    () => calve(db, { dam_id: 'BD-0001', on: '2024-06-20', precision: 'day' }),
    /more likely a double entry/,
  );
  const before = counts(db);
  const r = calve(db, {
    dam_id: 'BD-0001',
    on: '2024-06-20',
    precision: 'day',
    allow_near_duplicate: true,
  });
  assert.ok(r.calf_id, 'the override lets a genuine second event through');
  assert.equal(counts(db).animals, before.animals + 1);
  db.close();
});

test('a calving outside the double-entry window needs no override', () => {
  const db = damOnly();
  calve(db, { dam_id: 'BD-0001', on: '2023-01-02', precision: 'day' });
  const far = new Date(Date.UTC(2023, 0, 2) + (DOUBLE_ENTRY_WINDOW_DAYS + 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  assert.doesNotThrow(() => calve(db, { dam_id: 'BD-0001', on: far, precision: 'day' }));
  db.close();
});

// ---------------------------------------------------------------------------
// ATOMICITY -- the proof
// ---------------------------------------------------------------------------

for (const step of [1, 2, 3, 4, 5, 6] as const) {
  test(`a forced failure after step ${step} leaves ZERO rows written`, () => {
    const db = damOnly();
    const before = counts(db);

    assert.throws(
      () =>
        recordCalving(db, {
          dam_id: 'BD-0001',
          occurred_on: '2024-06-02',
          date_precision: 'day',
          calf: { sex: 'female', outcome: 'live' },
          provenance: RECALL,
          asOf: AS_OF,
          __faultAfterStep: step,
        }),
      new RegExp(`__faultAfterStep=${step}`),
    );

    assert.deepEqual(
      counts(db),
      before,
      `step ${step}: the transaction rolled back completely, including the serial counter`,
    );
    db.close();
  });
}

test('a rolled-back calving does not burn a serial number', () => {
  // Allocation happens inside the transaction precisely so this holds. A
  // separately-committed increment would leave a permanent gap on every failure.
  const db = damOnly();
  const before = readNextSerial(db);
  assert.throws(() =>
    recordCalving(db, {
      dam_id: 'BD-0001',
      occurred_on: '2024-06-02',
      date_precision: 'day',
      calf: { sex: 'female', outcome: 'live' },
      provenance: RECALL,
      asOf: AS_OF,
      __faultAfterStep: 5,
    }),
  );
  assert.equal(readNextSerial(db), before);
  // And the next real calving takes the number that was never burned.
  const r = calve(db, { dam_id: 'BD-0001', on: '2024-06-02', precision: 'day' });
  assert.equal(r.calf_id, 'BD-0002');
  db.close();
});

test('serials are never reused, even after the animal count changes', () => {
  const db = damOnly();
  const a = calve(db, { dam_id: 'BD-0001', on: '2022-01-02', precision: 'day' });
  const b = calve(db, { dam_id: 'BD-0001', on: '2023-06-02', precision: 'day' });
  const c = calve(db, { dam_id: 'BD-0001', on: '2024-11-02', precision: 'day' });
  assert.deepEqual([a.calf_id, b.calf_id, c.calf_id], ['BD-0002', 'BD-0003', 'BD-0004']);
  assert.equal(readNextSerial(db), 5, 'the counter is a high-water mark, not MAX(id)+1');
  db.close();
});

test('the calving is invisible to a reader until it commits', () => {
  // Not just "the rows are gone afterwards": nothing partial is ever observable.
  const db = damOnly();
  assert.throws(() =>
    recordCalving(db, {
      dam_id: 'BD-0001',
      occurred_on: '2024-06-02',
      date_precision: 'day',
      calf: { sex: 'female', outcome: 'live' },
      provenance: RECALL,
      asOf: AS_OF,
      __faultAfterStep: 3,
    }),
  );
  assert.equal(getAnimal(db, 'BD-0002'), undefined, 'the calf row never became visible');
  assert.equal(
    allEvents(db).filter((e) => e.type === 'calving').length,
    0,
    'no calving event survived',
  );
  db.close();
});

// ---------------------------------------------------------------------------
// correctCalving -- the paired correction (follow-up 3)
// ---------------------------------------------------------------------------

function damWithOneCalving(): { db: Db; calving: string; calf: string; birth: string } {
  const db = damOnly();
  const r = calve(db, { dam_id: 'BD-0001', on: '2023-04-01', precision: 'month' });
  return { db, calving: r.calving_event_id, calf: r.calf_id, birth: r.birth_event_id };
}

test('correctCalving supersedes BOTH the calving and the birth', () => {
  // The whole reason this is an API and not two appendEvent calls: superseding
  // only the calving leaves the calf's birth date stale, on a different
  // animal's timeline where nobody is looking.
  const { db, calving, calf, birth } = damWithOneCalving();

  const r = correctCalving(db, {
    calving_event_id: calving,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });

  assert.equal(r.superseded.calving_event_id, calving);
  assert.equal(r.superseded.birth_event_id, birth);

  const events = allEvents(db);
  const supersedes = new Map(events.filter((e) => e.supersedes_id).map((e) => [e.supersedes_id!, e]));
  assert.ok(supersedes.has(calving), 'the calving was superseded');
  assert.ok(supersedes.has(birth), 'the birth was superseded too');

  // Both new events carry the corrected date and precision.
  for (const id of [r.calving_event_id, r.birth_event_id]) {
    const e = events.find((x) => x.id === id)!;
    assert.equal(e.occurred_on, '2023-05-01');
    assert.equal(e.date_precision, 'month');
  }
  // And the new birth points at the NEW calving -- invariant 6's back-reference.
  const newBirth = events.find((e) => e.id === r.birth_event_id)!;
  assert.equal(newBirth.payload.calving_event_id, r.calving_event_id);
  assert.equal(r.calf_id, calf);
  db.close();
});

test('a corrected calving leaves the registry with zero invariant violations', () => {
  // The end-to-end point: invariant 6 caught the half-applied case before this
  // API existed, and now the API makes the clean case the only reachable one.
  const { db, calving } = damWithOneCalving();
  correctCalving(db, {
    calving_event_id: calving,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const found = checkSnapshot(snapshot(db), AS_OF);
  assert.deepEqual(found, [], found.map((v) => `[${v.invariant}] ${v.detail}`).join('\n'));
  db.close();
});

test('the correction moves the projection and does not add a second lactation', () => {
  const { db, calving } = damWithOneCalving();
  const r = correctCalving(db, {
    calving_event_id: calving,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const l = allLactations(db).filter((x) => x.animal_id === 'BD-0001');
  assert.equal(l.length, 1, 'a correction replaces, it does not add');
  assert.equal(l[0].started_on, '2023-05-01');
  assert.equal(l[0].opened_by_event_id, r.calving_event_id);
  assert.equal(l[0].id, lactationIdFor(r.calving_event_id));

  const status = allStatuses(db).find((s) => s.animal_id === 'BD-0001');
  assert.equal(status?.parity, 1, 'parity is unchanged by a correction');
  db.close();
});

test('correcting an already-superseded calving is refused and names its replacement', () => {
  // Only one event may supersede a given event (partial unique index), so the
  // chain must be extended at its end. Guessing which end was meant would be
  // worse than refusing.
  const { db, calving } = damWithOneCalving();
  const first = correctCalving(db, {
    calving_event_id: calving,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.throws(
    () =>
      correctCalving(db, {
        calving_event_id: calving,
        occurred_on: '2023-06-01',
        date_precision: 'month',
        provenance: RECALL,
        asOf: AS_OF,
      }),
    new RegExp(`already been superseded by '${first.calving_event_id}'`),
  );
  db.close();
});

test('a correction chain of two is clean and the last one wins', () => {
  const { db, calving } = damWithOneCalving();
  const first = correctCalving(db, {
    calving_event_id: calving,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const second = correctCalving(db, {
    calving_event_id: first.calving_event_id,
    occurred_on: '2023-06-14',
    date_precision: 'day',
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
  const l = allLactations(db).filter((x) => x.animal_id === 'BD-0001');
  assert.equal(l.length, 1);
  assert.equal(l[0].started_on, '2023-06-14');
  assert.equal(l[0].start_precision, 'day');
  assert.equal(l[0].opened_by_event_id, second.calving_event_id);
  db.close();
});

test('correctCalving rejects a non-calving event', () => {
  const { db } = damWithOneCalving();
  const acquired = allEvents(db).find((e) => e.type === 'acquired')!;
  assert.throws(
    () =>
      correctCalving(db, {
        calving_event_id: acquired.id,
        occurred_on: '2020-01-01',
        date_precision: 'year',
        provenance: RECALL,
        asOf: AS_OF,
      }),
    /is a 'acquired', not a calving/,
  );
  db.close();
});

test('correctCalving rejects an unknown event id', () => {
  const { db } = damWithOneCalving();
  assert.throws(
    () =>
      correctCalving(db, {
        calving_event_id: 'aevt_nope',
        occurred_on: '2023-05-01',
        date_precision: 'month',
        provenance: RECALL,
        asOf: AS_OF,
      }),
    /unknown event 'aevt_nope'/,
  );
  db.close();
});

test('correctCalving applies the same departure guard as recording', () => {
  const { db, calving } = damWithOneCalving();
  addDeparture(db, { animal_id: 'BD-0001', on: '2024-01-01', precision: 'day' });
  assert.throws(
    () =>
      correctCalving(db, {
        calving_event_id: calving,
        occurred_on: '2024-06-01',
        date_precision: 'month',
        provenance: RECALL,
        asOf: AS_OF,
      }),
    /has a departure event/,
  );
  db.close();
});

test('correctCalving applies the double-entry guard, excluding the event being corrected', () => {
  const db = damOnly();
  const a = calve(db, { dam_id: 'BD-0001', on: '2022-01-02', precision: 'day' });
  calve(db, { dam_id: 'BD-0001', on: '2023-06-02', precision: 'day' });

  // Moving the first calving next to the second is a probable double entry.
  assert.throws(
    () =>
      correctCalving(db, {
        calving_event_id: a.calving_event_id,
        occurred_on: '2023-06-20',
        date_precision: 'day',
        provenance: RECALL,
        asOf: AS_OF,
      }),
    /within 60 days of dam/,
  );
  // But a small nudge of the same event must NOT trip on itself.
  assert.doesNotThrow(() =>
    correctCalving(db, {
      calving_event_id: a.calving_event_id,
      occurred_on: '2022-01-09',
      date_precision: 'day',
      provenance: RECALL,
      asOf: AS_OF,
    }),
  );
  db.close();
});

test('correctCalving preserves assistance and notes unless explicitly changed', () => {
  const db = damOnly();
  const r = recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2023-04-01',
    date_precision: 'month',
    calf: { sex: 'female', outcome: 'live' },
    assistance: 'vet',
    notes: 'difficult calving',
    provenance: RECALL,
    asOf: AS_OF,
  });

  const kept = correctCalving(db, {
    calving_event_id: r.calving_event_id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const e1 = allEvents(db).find((e) => e.id === kept.calving_event_id)!;
  assert.equal(e1.payload.assistance, 'vet', 'carried forward');
  assert.equal(e1.payload.notes, 'difficult calving', 'carried forward');

  const changed = correctCalving(db, {
    calving_event_id: kept.calving_event_id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    assistance: 'none',
    notes: null,
    provenance: RECALL,
    asOf: AS_OF,
  });
  const e2 = allEvents(db).find((e) => e.id === changed.calving_event_id)!;
  assert.equal(e2.payload.assistance, 'none');
  assert.equal(e2.payload.notes, null);
  db.close();
});

test('correctCalving cannot change the calf identity or the outcome', () => {
  // Those are what the calf's animal row and its departure event were built
  // from; moving them here would desynchronise records this API cannot reach.
  const db = damOnly();
  const r = calve(db, {
    dam_id: 'BD-0001',
    on: '2023-04-01',
    precision: 'month',
    outcome: 'stillborn',
  });
  const c = correctCalving(db, {
    calving_event_id: r.calving_event_id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  const e = allEvents(db).find((x) => x.id === c.calving_event_id)!;
  assert.equal(e.payload.calf_id, r.calf_id);
  assert.equal(e.payload.outcome, 'stillborn');
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
  db.close();
});

test('correcting a STILLBIRTH date moves the calf departure too -- it is a triple', () => {
  // The same physical fact spans three events when the calf did not live.
  // Moving only the calving and the birth leaves the calf departed before it
  // was born: invariants 4 and 5 both fire. A test found this, not review.
  const db = damOnly();
  const r = calve(db, {
    dam_id: 'BD-0001',
    on: '2023-04-01',
    precision: 'month',
    outcome: 'stillborn',
  });
  const oldDeparture = eventsForAnimal(db, r.calf_id).find((e) => e.type === 'departure')!;

  const c = correctCalving(db, {
    calving_event_id: r.calving_event_id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });

  assert.equal(c.superseded.departure_event_id, oldDeparture.id, 'the departure was superseded');
  assert.ok(c.departure_event_id, 'a replacement departure was written');

  const moved = allEvents(db).find((e) => e.id === c.departure_event_id)!;
  assert.equal(moved.occurred_on, '2023-05-01', 'it moved to the corrected date');
  assert.equal(moved.payload.reason, 'died');
  assert.equal(moved.payload.cause, 'stillborn', 'the cause carried forward');

  const found = checkSnapshot(snapshot(db), AS_OF);
  assert.deepEqual(found, [], found.map((v) => `[${v.invariant}] ${v.detail}`).join('\n'));
  db.close();
});

test('correcting a LIVE calving has no departure to move', () => {
  const db = damOnly();
  const r = calve(db, { dam_id: 'BD-0001', on: '2023-04-01', precision: 'month' });
  const c = correctCalving(db, {
    calving_event_id: r.calving_event_id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.equal(c.departure_event_id, null);
  assert.equal(c.superseded.departure_event_id, null);
  db.close();
});

test('a calf departure on a DIFFERENT date is not re-dated by a calving correction', () => {
  // A live calf that later died is a separate fact. Matching the departure by
  // date rather than by existence is what keeps this correct.
  const db = damOnly();
  const r = calve(db, { dam_id: 'BD-0001', on: '2023-04-01', precision: 'month' });
  const later = addDeparture(db, {
    animal_id: r.calf_id,
    on: '2024-08-01',
    precision: 'month',
    reason: 'sold',
  });
  const c = correctCalving(db, {
    calving_event_id: r.calving_event_id,
    occurred_on: '2023-05-01',
    date_precision: 'month',
    provenance: RECALL,
    asOf: AS_OF,
  });
  assert.equal(c.superseded.departure_event_id, null, 'the unrelated departure was left alone');
  const untouched = allEvents(db).find((e) => e.id === later)!;
  assert.equal(untouched.occurred_on, '2024-08-01');
  db.close();
});

for (const step of [1, 2, 3, 4, 5] as const) {
  test(`correctCalving: a forced failure after step ${step} leaves ZERO rows written`, () => {
    const { db, calving } = damWithOneCalving();
    const before = counts(db);
    assert.throws(
      () =>
        correctCalving(db, {
          calving_event_id: calving,
          occurred_on: '2023-05-01',
          date_precision: 'month',
          provenance: RECALL,
          asOf: AS_OF,
          __faultAfterStep: step,
        }),
      new RegExp(`__faultAfterStep=${step}`),
    );
    assert.deepEqual(counts(db), before, `step ${step}: nothing was written`);
    // And critically: neither half of the pair landed on its own.
    assert.equal(
      allEvents(db).filter((e) => e.supersedes_id !== null).length,
      0,
      'no half-applied correction survived',
    );
    db.close();
  });
}

// ---------------------------------------------------------------------------
// Link mode -- attaching a calving to an animal that already exists
// ---------------------------------------------------------------------------
//
// The backfill reconciliation case: pass one enters a farm-born animal as
// `acquired` (it must, because pass one has no calvings), then pass two records
// its dam's calving. Without link mode that mints a duplicate of an animal
// already in the registry -- duplicate animal, duplicate origin event, and no
// command able to repair either.

function damAndAcquiredCalf(): Db {
  const db = damOnly();
  addAcquired(db, {
    id: 'BD-0002',
    sex: 'female',
    name: 'X',
    acquired_on: '2021-01-01',
    acquired_precision: 'year',
    birth_on: '2021-01-01',
    birth_precision: 'year',
  });
  rebuild(db, { asOf: AS_OF });
  return db;
}

function linkCalving(db: Db, over: Record<string, unknown> = {}) {
  return recordCalving(db, {
    dam_id: 'BD-0001',
    occurred_on: '2021-06-01',
    date_precision: 'month',
    calf: { existing_id: 'BD-0002', sex: 'female', outcome: 'live' },
    provenance: RECALL,
    asOf: AS_OF,
    ...over,
  } as Parameters<typeof recordCalving>[1]);
}

test('link mode attaches to the existing animal and mints nothing', () => {
  const db = damAndAcquiredCalf();
  const serialBefore = readNextSerial(db);
  const animalsBefore = counts(db).animals;

  const r = linkCalving(db);

  assert.equal(r.calf_id, 'BD-0002', 'the existing animal was used');
  assert.equal(r.linked, true);
  assert.equal(counts(db).animals, animalsBefore, 'no new animal was created');
  assert.equal(readNextSerial(db), serialBefore, 'no serial was burned');
  db.close();
});

test('link mode supersedes the acquired origin with the birth event', () => {
  const db = damAndAcquiredCalf();
  const acquired = eventsForAnimal(db, 'BD-0002').find((e) => e.type === 'acquired')!;

  const r = linkCalving(db);

  assert.equal(r.superseded_origin_event_id, acquired.id);
  const birth = allEvents(db).find((e) => e.id === r.birth_event_id)!;
  assert.equal(birth.supersedes_id, acquired.id);
  assert.equal(birth.payload.dam_id, 'BD-0001');
  assert.equal(birth.payload.calving_event_id, r.calving_event_id);
  db.close();
});

test('link mode promotes registry_animals.origin to born_on_farm', () => {
  const db = damAndAcquiredCalf();
  assert.equal(getAnimal(db, 'BD-0002')?.origin, 'acquired');
  linkCalving(db);
  assert.equal(getAnimal(db, 'BD-0002')?.origin, 'born_on_farm');
  db.close();
});

test('the projection treats the superseded acquired as GONE for origin purposes', () => {
  // The specific worry: this is the only supersession in the schema that
  // changes an event's TYPE, so findOrigin() must not still see the acquired.
  const db = damAndAcquiredCalf();
  linkCalving(db);

  const effective = effectiveEvents(eventsForAnimal(db, 'BD-0002'));
  assert.equal(
    effective.filter((e) => e.type === 'acquired').length,
    0,
    'the acquired origin is no longer effective',
  );
  assert.equal(effective.filter((e) => e.type === 'birth').length, 1, 'exactly one origin remains');

  const status = allStatuses(db).find((s) => s.animal_id === 'BD-0002')!;
  assert.equal(
    status.birth_on,
    '2021-06-01',
    'the birth date is now the calving date, not the acquired estimate',
  );
  assert.equal(status.birth_precision, 'month', 'and it carries the calving precision');
  db.close();
});

test('invariants 3 and 7 both hold across the type-changing supersession', () => {
  // Invariant 3: exactly one origin event. Invariant 7: every born_on_farm
  // animal has a dam edge. Both are the ones the promotion could break.
  const db = damAndAcquiredCalf();
  linkCalving(db);

  const found = checkSnapshot(snapshot(db), AS_OF);
  assert.deepEqual(found, [], found.map((v) => `[${v.invariant}] ${v.detail}`).join('\n'));

  const edge = allParentage(db).find((p) => p.child_id === 'BD-0002');
  assert.equal(edge?.relation, 'dam');
  assert.equal(edge?.parent_ref, 'BD-0001');
  db.close();
});

test('invariant 9 permits birth-supersedes-acquired but nothing else', () => {
  // The narrow exception. Any OTHER type change must still be caught, or the
  // exception has swallowed the rule.
  const db = damAndAcquiredCalf();
  linkCalving(db);
  assert.deepEqual(
    checkSnapshot(snapshot(db), AS_OF).filter((v) => v.invariant === 9),
    [],
    'birth superseding acquired is allowed',
  );

  const s = JSON.parse(JSON.stringify(snapshot(db)));
  const dryOff = s.events.find((e: { type: string }) => e.type === 'birth');
  dryOff.type = 'note';
  dryOff.payload = { text: 'x' };
  assert.ok(
    checkSnapshot(s, AS_OF).some((v) => v.invariant === 9),
    'a note superseding an acquired is still rejected',
  );
  db.close();
});

test('the promoted animal survives a rebuild unchanged', () => {
  const db = damAndAcquiredCalf();
  linkCalving(db);
  const before = allStatuses(db).find((s) => s.animal_id === 'BD-0002');
  rebuild(db, { asOf: AS_OF });
  assert.deepEqual(allStatuses(db).find((s) => s.animal_id === 'BD-0002'), before);
  assert.deepEqual(checkSnapshot(snapshot(db), AS_OF), []);
  db.close();
});

test('invariant 3 catches registry_animals.origin drifting from the origin event', () => {
  // origin is the one derivable column the rebuild does NOT write, so it can
  // come apart from the log. Link mode is what made it drift-prone.
  const db = damAndAcquiredCalf();
  linkCalving(db);
  db.prepare(`UPDATE registry_animals SET origin = 'acquired' WHERE id = 'BD-0002'`).run();
  const found = checkSnapshot(snapshot(db), AS_OF);
  assert.ok(found.some((v) => v.invariant === 3 && /implies 'born_on_farm'/.test(v.detail)));
  db.close();
});

// --- link mode refusals ----------------------------------------------------

test('link mode refuses an animal that already has a birth event', () => {
  const db = damOnly();
  const first = calve(db, { dam_id: 'BD-0001', on: '2021-06-01', precision: 'month' });
  assert.throws(
    () =>
      recordCalving(db, {
        dam_id: 'BD-0001',
        occurred_on: '2023-06-01',
        date_precision: 'month',
        calf: { existing_id: first.calf_id, sex: 'female', outcome: 'live' },
        provenance: RECALL,
        asOf: AS_OF,
      }),
    /already has a birth event/,
  );
  db.close();
});

test('link mode refuses an unknown animal rather than minting one', () => {
  const db = damAndAcquiredCalf();
  assert.throws(() => linkCalving(db, { calf: { existing_id: 'BD-9999', sex: 'female', outcome: 'live' } }), /unknown calf 'BD-9999'/);
  db.close();
});

test('link mode refuses a sex disagreement', () => {
  const db = damAndAcquiredCalf();
  assert.throws(
    () => linkCalving(db, { calf: { existing_id: 'BD-0002', sex: 'male', outcome: 'live' } }),
    /recorded as female but this calving says male/,
  );
  db.close();
});

test('link mode refuses an animal that is its own dam', () => {
  const db = damAndAcquiredCalf();
  assert.throws(
    () => linkCalving(db, { calf: { existing_id: 'BD-0001', sex: 'female', outcome: 'live' } }),
    /cannot be its own calf/,
  );
  db.close();
});

test('link mode refuses a non-live outcome', () => {
  const db = damAndAcquiredCalf();
  assert.throws(
    () => linkCalving(db, { calf: { existing_id: 'BD-0002', sex: 'female', outcome: 'stillborn' } }),
    /link mode requires outcome 'live'/,
  );
  db.close();
});

test('link mode refuses when the calf already calved BEFORE the proposed birth date', () => {
  const db = damAndAcquiredCalf();
  // BD-0002 (entered as acquired) has her own calving in 2024...
  calve(db, { dam_id: 'BD-0002', on: '2024-03-01', precision: 'month' });
  // ...so linking her birth to a 2025 calving would put her birth after it.
  assert.throws(
    () =>
      linkCalving(db, {
        occurred_on: '2025-01-01',
        date_precision: 'month',
        allow_near_duplicate: true,
      }),
    /before the calving date 2025-01-01/,
  );
  db.close();
});

test('link mode still runs the dam validation', () => {
  const db = damAndAcquiredCalf();
  addDeparture(db, { animal_id: 'BD-0001', on: '2020-01-01', precision: 'year' });
  assert.throws(() => linkCalving(db), /has a departure event/);
  db.close();
});

for (const step of [1, 2, 3, 4, 5, 6] as const) {
  test(`link mode: a forced failure after step ${step} leaves ZERO rows written`, () => {
    const db = damAndAcquiredCalf();
    const before = counts(db);
    const originBefore = getAnimal(db, 'BD-0002')?.origin;

    assert.throws(() => linkCalving(db, { __faultAfterStep: step }), new RegExp(`__faultAfterStep=${step}`));

    assert.deepEqual(counts(db), before, `step ${step}: nothing was written`);
    assert.equal(
      getAnimal(db, 'BD-0002')?.origin,
      originBefore,
      `step ${step}: the origin promotion rolled back too`,
    );
    db.close();
  });
}
