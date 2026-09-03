// Animal registry -- the rebuild-diff orchestration (invariants 0, 1, 2).
//
// These run against `:memory:` fixtures with real content. Without this file
// the clone-rebuild-diff path would only ever be exercised by hand against
// whatever the live database happens to hold -- which today is nothing, so
// `verify:registry` would pass vacuously and prove the orchestration works when
// it might not.

import assert from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  checkIdempotence,
  checkLactationIdStability,
  checkRebuildFidelity,
  cloneEventLogToMemory,
  verifyAll,
} from './verify';
import { rebuild } from './projectStore';
import { allEvents, allLactations, allParentage, allStatuses, snapshot } from './store';
import { AS_OF, cleanHerd, freshDb, herdWithCorrection } from './fixtures';

const dbSource = (): string => readFileSync(path.join(__dirname, '..', 'db.ts'), 'utf8');

test('the clone carries the event log and animals but NOT the projections', () => {
  // A clone that copied projections would make invariant 1 compare a table with
  // itself and pass unconditionally.
  const live = cleanHerd();
  const mem = cloneEventLogToMemory(live);

  assert.equal(snapshot(mem).animals.length, snapshot(live).animals.length);
  assert.equal(allEvents(mem).length, allEvents(live).length);
  assert.ok(allEvents(live).length > 0, 'the fixture has events to copy');
  assert.equal(allLactations(mem).length, 0, 'projections are NOT copied');
  assert.equal(allParentage(mem).length, 0);
  assert.equal(allStatuses(mem).length, 0);
  assert.equal(
    snapshot(mem).nextSerial,
    snapshot(live).nextSerial,
    'the serial counter comes across, or invariant 10 would fire on the clone',
  );
  live.close();
  mem.close();
});

test('the clone preserves superseding events despite the self-referencing FK', () => {
  // supersedes_id references the same table and foreign_keys is ON. This
  // fixture's corrections carry a recorded_at EARLIER than the events they
  // replace, so no ORDER BY makes the insert topological -- it is the case that
  // fails without defer_foreign_keys, and it failed for real before that fix.
  const { db } = herdWithCorrection();
  const mem = cloneEventLogToMemory(db);
  const superseding = allEvents(mem).filter((e) => e.supersedes_id !== null);
  assert.ok(superseding.length >= 2, 'both halves of the paired correction came across');
  db.close();
  mem.close();
});

test('invariant 0 passes on real fixture content, not just on an empty database', () => {
  const db = cleanHerd();
  assert.ok(allLactations(db).length > 0, 'there is something to be idempotent about');
  assert.deepEqual(checkIdempotence(db, AS_OF), []);
  db.close();
});

test('invariant 1 passes when the stored projections match the log', () => {
  const db = cleanHerd();
  assert.deepEqual(checkRebuildFidelity(db, AS_OF), []);
  db.close();
});

test('invariant 1 FAILS when a stored projection has drifted from the log', () => {
  const db = cleanHerd();
  db.prepare(`UPDATE registry_animal_status SET status = 'dry' WHERE animal_id = 'BD-0001'`).run();
  const found = checkRebuildFidelity(db, AS_OF);
  assert.ok(found.length > 0, 'the rebuild-diff detects the drift');
  assert.equal(found[0].invariant, 1);
  db.close();
});

test('invariant 1 FAILS when a lactation row was deleted from the projection', () => {
  const db = cleanHerd();
  db.prepare(`DELETE FROM registry_lactations WHERE animal_id = 'BD-0002'`).run();
  const found = checkRebuildFidelity(db, AS_OF);
  // Deleted from stored, so the rebuild has it and stored does not.
  assert.ok(found.some((v) => v.detail.includes('in rebuilt but NOT in stored')));
  db.close();
});

test('invariant 1 FAILS when a spurious projection row was added', () => {
  const db = cleanHerd();
  const l = allLactations(db)[0];
  db.prepare(
    `INSERT INTO registry_lactations
       (id, animal_id, opened_by_event_id, started_on, start_precision,
        ended_on, end_precision, end_reason, closed_by_event_id)
     VALUES ('lact_invented', @animal_id, @opened_by_event_id, @started_on, @start_precision,
             NULL, NULL, NULL, NULL)`,
  ).run({
    animal_id: l.animal_id,
    opened_by_event_id: l.opened_by_event_id,
    started_on: l.started_on,
    start_precision: l.start_precision,
  });
  const found = checkRebuildFidelity(db, AS_OF);
  // Invented in stored, so stored has it and the rebuild does not.
  assert.ok(found.some((v) => v.detail.includes('in stored but NOT in rebuilt')));
  db.close();
});

test('invariant 2 passes on real content and can detect a shift', () => {
  const db = cleanHerd();
  assert.ok(allLactations(db).length >= 4, 'several ids to compare');
  assert.deepEqual(checkLactationIdStability(db, AS_OF), []);

  // Rename a stored id: the rebuild regenerates the derived one, so they diverge.
  db.prepare(`UPDATE registry_lactations SET id = 'lact_shifted' WHERE id = ?`).run(
    allLactations(db)[0].id,
  );
  const found = checkLactationIdStability(db, AS_OF);
  assert.equal(found.length, 1);
  assert.equal(found[0].invariant, 2);
  assert.match(found[0].detail, /lactation ids changed across rebuild/);
  db.close();
});

test('verifyAll reports zero violations for a clean herd', () => {
  const db = cleanHerd();
  const found = verifyAll(db, AS_OF, dbSource());
  assert.deepEqual(
    found,
    [],
    found.map((v) => `[${v.invariant}] ${v.name}: ${v.detail}`).join('\n'),
  );
  db.close();
});

test('verifyAll on an EMPTY registry passes -- and that is why it proves nothing', () => {
  // Documents the vacuity the CLI warns about, so nobody later mistakes a green
  // `verify:registry` against an empty database for evidence.
  const db = freshDb();
  assert.deepEqual(verifyAll(db, AS_OF, dbSource()), []);
  db.close();
});

test('the verification never mutates the database it is verifying', () => {
  // A verifier with a side effect is worse than no verifier.
  const db = cleanHerd();
  const before = {
    l: allLactations(db),
    p: allParentage(db),
    s: allStatuses(db),
    e: allEvents(db),
  };
  verifyAll(db, AS_OF, dbSource());
  assert.deepEqual(allLactations(db), before.l);
  assert.deepEqual(allParentage(db), before.p);
  assert.deepEqual(allStatuses(db), before.s);
  assert.deepEqual(allEvents(db), before.e);
  db.close();
});

test('a rebuild at a different as-of, then verified at that same as-of, is clean', () => {
  // The stale-projection story from the other direction: rebuild forward and the
  // registry is consistent again.
  const db = cleanHerd();
  const later = '2030-01-01';
  assert.ok(
    verifyAll(db, later, dbSource()).some((v) => v.invariant === 1),
    'stale before the rebuild',
  );
  rebuild(db, { asOf: later });
  assert.deepEqual(verifyAll(db, later, dbSource()), [], 'clean after the rebuild');
  db.close();
});
