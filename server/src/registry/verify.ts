// Animal registry -- the rebuild-based invariants (0, 1, 2).
//
// Takes a Db handle and imports NO `../db`, which is what lets the same code
// run against the live dairy.db from the CLI and against an `:memory:` fixture
// from registry.verify.test.ts. The CLI shell is verifyRegistry.ts.
//
// These three cannot live in invariants.ts because they need to RUN a rebuild,
// and invariants.ts is a pure function of a snapshot. They are still separated
// from the CLI so that the orchestration -- cloning the log, rebuilding into a
// fresh database, diffing -- is itself under test rather than only ever
// exercised by hand against whatever the live database happens to contain.

import Database from 'better-sqlite3';
import type { Db } from './schema';
import { applyRegistrySchema } from './schema';
import { rebuild } from './projectStore';
import { allLactations, allParentage, allStatuses } from './store';
import { checkDbSourceIsolation, checkSnapshot, diffRowSets, type Violation } from './invariants';
import { snapshot } from './store';

/**
 * Copy animals, the event log and the serial counter -- but NOT the projection
 * tables -- into a fresh in-memory database, so a rebuild there starts from the
 * source of truth alone.
 *
 * A verification script must never mutate the thing it is verifying, which is
 * why every rebuild-based check below runs against one of these rather than
 * against the live handle.
 */
export function cloneEventLogToMemory(live: Db): Db {
  const mem = new Database(':memory:');
  applyRegistrySchema(mem);

  const insAnimal = mem.prepare(
    `INSERT INTO registry_animals (id, name, sex, species, origin, post_no, tag_no)
     VALUES (@id, @name, @sex, @species, @origin, @post_no, @tag_no)`,
  );
  const insEvent = mem.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES
       (@id, @animal_id, @type, @occurred_on, @occurred_time, @date_precision, @payload,
        @source_form, @source_ref, @observed_by, @recorded_by, @recorded_at, @supersedes_id)`,
  );

  mem.transaction(() => {
    // supersedes_id is a SELF-REFERENCING foreign key, so no single ORDER BY is
    // a guaranteed topological order -- a correction can legitimately carry an
    // earlier recorded_at than the event it replaces (a backfill entered out of
    // order, or two operators working from different sheets). Defer the checks
    // to COMMIT instead of trying to sort the graph.
    //
    // This does NOT weaken the check: a genuinely dangling supersedes_id still
    // fails, just at commit rather than at the row. Verified, not assumed.
    // The pragma is transaction-scoped and resets itself on commit.
    mem.pragma('defer_foreign_keys = ON');

    for (const a of live.prepare(`SELECT * FROM registry_animals`).all()) {
      insAnimal.run(a as Record<string, never>);
    }
    for (const e of live.prepare(`SELECT * FROM registry_animal_events`).all()) {
      insEvent.run(e as Record<string, never>);
    }
    const counter = live
      .prepare(`SELECT next_serial FROM registry_serial_counter WHERE id = 1`)
      .get() as { next_serial: number };
    mem
      .prepare(`UPDATE registry_serial_counter SET next_serial = ? WHERE id = 1`)
      .run(counter.next_serial);
  })();

  return mem;
}

/** Invariant 0 -- rebuilding twice produces identical projection row-sets. */
export function checkIdempotence(live: Db, asOf: string): Violation[] {
  const mem = cloneEventLogToMemory(live);
  try {
    rebuild(mem, { asOf });
    const first = {
      l: allLactations(mem),
      p: allParentage(mem),
      s: allStatuses(mem),
    };
    rebuild(mem, { asOf });
    const sides = { stored: 'first rebuild', rebuilt: 'second rebuild' };
    return [
      ...diffRowSets('lactations', first.l, allLactations(mem), sides),
      ...diffRowSets('parentage', first.p, allParentage(mem), sides),
      ...diffRowSets('statuses', first.s, allStatuses(mem), sides),
    ].map((detail) => ({ invariant: 0, name: 'rebuild-idempotent', detail }));
  } finally {
    mem.close();
  }
}

/**
 * Invariant 1 -- a rebuild into a fresh database reproduces what is stored.
 *
 * Compared as MULTISETS under a canonical row key, NOT byte-wise: SQLite files
 * differ in page layout, freelists and WAL state for identical content, so a
 * file hash would fail for reasons that mean nothing. Same approach verify.ts
 * already uses for farm events.
 */
export function checkRebuildFidelity(live: Db, asOf: string): Violation[] {
  const mem = cloneEventLogToMemory(live);
  try {
    rebuild(mem, { asOf });
    return [
      ...diffRowSets('lactations', allLactations(live), allLactations(mem)),
      ...diffRowSets('parentage', allParentage(live), allParentage(mem)),
      ...diffRowSets('statuses', allStatuses(live), allStatuses(mem)),
    ].map((detail) => ({ invariant: 1, name: 'rebuild-fidelity', detail }));
  } finally {
    mem.close();
  }
}

/**
 * Invariant 2 -- lactation ids survive a rebuild unchanged.
 *
 * Its own check rather than a line in the fidelity diff, because this is the
 * failure that is silent and permanent: step 4's yield rows will carry these
 * ids as foreign keys, and an id that shifts repoints yield at the wrong
 * lactation with nothing to notice.
 */
export function checkLactationIdStability(live: Db, asOf: string): Violation[] {
  const before = allLactations(live)
    .map((l) => l.id)
    .sort();
  const mem = cloneEventLogToMemory(live);
  try {
    rebuild(mem, { asOf });
    const after = allLactations(mem)
      .map((l) => l.id)
      .sort();
    if (before.join('|') === after.join('|')) return [];
    return [
      {
        invariant: 2,
        name: 'lactation-ids-stable',
        detail:
          `lactation ids changed across rebuild.\n    stored:  ${before.join(', ') || '(none)'}` +
          `\n    rebuilt: ${after.join(', ') || '(none)'}`,
      },
    ];
  } finally {
    mem.close();
  }
}

/** Every invariant, 0 through 13. `dbSource` is db.ts's text, for invariant 13. */
export function verifyAll(live: Db, asOf: string, dbSource: string): Violation[] {
  return [
    ...checkIdempotence(live, asOf),
    ...checkRebuildFidelity(live, asOf),
    ...checkLactationIdStability(live, asOf),
    ...checkSnapshot(snapshot(live), asOf),
    ...checkDbSourceIsolation(dbSource),
  ];
}
