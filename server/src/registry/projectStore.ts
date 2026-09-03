// Animal registry -- the projection shell (decision doc §4).
//
// THE ONLY MODULE PERMITTED TO WRITE A PROJECTION TABLE. That is the whole
// enforcement mechanism behind "stored derived state cannot contradict the
// event log": no other code path touches registry_lactations,
// registry_parentage or registry_animal_status, so the only way a projection
// row can exist is for projectAnimal() to have derived it.
//
// The calving transaction calls rebuild() for the animals it touched rather
// than hand-patching rows, for the same reason.
//
// Scoring rules live in project.ts, which stays DB-free -- the same pure-core /
// DB-shell split as classify.ts / classifyStore.ts.

import type { Db } from './schema';
import { REGISTRY_PROJECTION_TABLES } from './schema';
import { projectAnimal } from './project';
import { allAnimals, allEvents, getAnimal, eventsForAnimal } from './store';
import type { AnimalProjection, RegistryEvent } from './types';

export interface RebuildResult {
  animals: number;
  lactations: number;
  parentage: number;
  statuses: number;
}

function writeProjection(db: Db, p: AnimalProjection): void {
  const insLact = db.prepare(
    `INSERT INTO registry_lactations
       (id, animal_id, opened_by_event_id, started_on, start_precision,
        ended_on, end_precision, end_reason, closed_by_event_id)
     VALUES
       (@id, @animal_id, @opened_by_event_id, @started_on, @start_precision,
        @ended_on, @end_precision, @end_reason, @closed_by_event_id)`,
  );
  const insPar = db.prepare(
    `INSERT INTO registry_parentage
       (child_id, relation, parent_ref, certainty, source_event_id)
     VALUES (@child_id, @relation, @parent_ref, @certainty, @source_event_id)`,
  );
  const insStatus = db.prepare(
    `INSERT INTO registry_animal_status
       (animal_id, status, parity, birth_on, birth_precision, open_lactation_id)
     VALUES (@animal_id, @status, @parity, @birth_on, @birth_precision, @open_lactation_id)`,
  );

  for (const l of p.lactations) insLact.run(l);
  for (const r of p.parentage) insPar.run(r);
  insStatus.run(p.status);
}

function clearProjectionsFor(db: Db, animalId: string): void {
  db.prepare(`DELETE FROM registry_lactations WHERE animal_id = ?`).run(animalId);
  db.prepare(`DELETE FROM registry_parentage WHERE child_id = ?`).run(animalId);
  db.prepare(`DELETE FROM registry_animal_status WHERE animal_id = ?`).run(animalId);
}

/**
 * Recompute projections from the event log.
 *
 * Idempotent by construction: it deletes what it is about to rewrite, so
 * running it twice produces identical row-sets (invariant 0). Whole-registry
 * mode truncates all three projection tables rather than deleting per animal,
 * which also reaps orphan rows left by an animal that no longer exists.
 *
 * `asOf` is REQUIRED, not defaulted to today, because the status projection
 * depends on it -- see the header comment in project.ts. Passing a different
 * asOf is a legitimate operation (what did the herd look like last March), and
 * a hidden default would make that impossible to express and the rebuild
 * non-reproducible.
 *
 * Wrapped in one transaction: a half-rebuilt projection set is worse than a
 * stale one, because it looks current.
 */
export function rebuild(
  db: Db,
  opts: { asOf: string; animalId?: string },
): RebuildResult {
  const result: RebuildResult = { animals: 0, lactations: 0, parentage: 0, statuses: 0 };

  db.transaction(() => {
    if (opts.animalId) {
      const animal = getAnimal(db, opts.animalId);
      if (!animal) {
        throw new Error(`unknown registry animal '${opts.animalId}'`);
      }
      clearProjectionsFor(db, animal.id);
      const p = projectAnimal({
        animal,
        events: eventsForAnimal(db, animal.id),
        asOf: opts.asOf,
      });
      writeProjection(db, p);
      result.animals = 1;
      result.lactations = p.lactations.length;
      result.parentage = p.parentage.length;
      result.statuses = 1;
      return;
    }

    for (const t of REGISTRY_PROJECTION_TABLES) db.exec(`DELETE FROM ${t};`);

    const animals = allAnimals(db);
    // One query for the whole log, bucketed in memory. At ~20 animals and a few
    // dozen events this is irrelevant to performance; it matters because it
    // guarantees every animal is projected from the SAME read of the log.
    const byAnimal = new Map<string, RegistryEvent[]>();
    for (const e of allEvents(db)) {
      const list = byAnimal.get(e.animal_id);
      if (list) list.push(e);
      else byAnimal.set(e.animal_id, [e]);
    }

    for (const animal of animals) {
      const p = projectAnimal({
        animal,
        events: byAnimal.get(animal.id) ?? [],
        asOf: opts.asOf,
      });
      writeProjection(db, p);
      result.animals += 1;
      result.lactations += p.lactations.length;
      result.parentage += p.parentage.length;
      result.statuses += 1;
    }
  })();

  return result;
}

/** Rebuild several animals in one transaction (the calving transaction's need). */
export function rebuildAnimals(
  db: Db,
  opts: { asOf: string; animalIds: string[] },
): void {
  for (const id of opts.animalIds) {
    const animal = getAnimal(db, id);
    if (!animal) throw new Error(`unknown registry animal '${id}'`);
    clearProjectionsFor(db, id);
    writeProjection(
      db,
      projectAnimal({ animal, events: eventsForAnimal(db, id), asOf: opts.asOf }),
    );
  }
}
