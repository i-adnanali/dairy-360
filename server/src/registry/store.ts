// Animal registry -- DB access helpers (the impure shell's foundation).
//
// Every function here takes an explicit `db` handle rather than importing the
// module singleton. That is what lets the same code run against the live
// dairy.db and against a `new Database(':memory:')` in a test -- the seam
// decision doc §4 names as a deliverable.
//
// Nothing in this file writes a projection table: that is rebuild()'s exclusive
// job in projectStore.ts.

import type { Db } from './schema';
import { assertDatePrecision, assertEventPayload, formatSerial, newEventId } from './events';
import type {
  AnimalStatusRow,
  LactationRow,
  ParentageRow,
  Provenance,
  RegistryAnimalRow,
  RegistryEvent,
  RegistryEventRow,
  RegistryEventType,
  RegistryOrigin,
  RegistrySex,
  RegistrySnapshot,
} from './types';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

function parseEvent(row: RegistryEventRow): RegistryEvent {
  return { ...row, payload: JSON.parse(row.payload) as Record<string, unknown> };
}

export function allAnimals(db: Db): RegistryAnimalRow[] {
  return db
    .prepare(`SELECT * FROM registry_animals ORDER BY id`)
    .all() as RegistryAnimalRow[];
}

export function getAnimal(db: Db, id: string): RegistryAnimalRow | undefined {
  return db.prepare(`SELECT * FROM registry_animals WHERE id = ?`).get(id) as
    | RegistryAnimalRow
    | undefined;
}

export function animalExists(db: Db, id: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS x FROM registry_animals WHERE id = ?`)
    .get(id) as { x: number } | undefined;
  return !!row;
}

/**
 * Every event, in the canonical order of decision doc §5.
 *
 * The ORDER BY mirrors compareEvents() in project.ts. Both exist because the
 * pure core must be orderable without a database, and the query must not hand
 * the core a differently-ordered list -- registry.project.test.ts asserts the
 * two agree on a shuffled fixture.
 */
export function allEvents(db: Db): RegistryEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM registry_animal_events
       ORDER BY occurred_on, COALESCE(occurred_time, '00:00'), recorded_at, id`,
    )
    .all() as RegistryEventRow[];
  return rows.map(parseEvent);
}

export function eventsForAnimal(db: Db, animalId: string): RegistryEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM registry_animal_events
        WHERE animal_id = ?
        ORDER BY occurred_on, COALESCE(occurred_time, '00:00'), recorded_at, id`,
    )
    .all(animalId) as RegistryEventRow[];
  return rows.map(parseEvent);
}

export function allLactations(db: Db): LactationRow[] {
  return db
    .prepare(`SELECT * FROM registry_lactations ORDER BY animal_id, started_on, id`)
    .all() as LactationRow[];
}

export function allParentage(db: Db): ParentageRow[] {
  return db
    .prepare(`SELECT * FROM registry_parentage ORDER BY child_id, relation`)
    .all() as ParentageRow[];
}

export function allStatuses(db: Db): AnimalStatusRow[] {
  return db
    .prepare(`SELECT * FROM registry_animal_status ORDER BY animal_id`)
    .all() as AnimalStatusRow[];
}

export function readNextSerial(db: Db): number {
  const row = db
    .prepare(`SELECT next_serial FROM registry_serial_counter WHERE id = 1`)
    .get() as { next_serial: number } | undefined;
  if (!row) {
    throw new Error(
      'registry_serial_counter has no row 1 -- the schema was created without its ' +
        'seed INSERT, or something deleted it. Serial allocation cannot proceed.',
    );
  }
  return row.next_serial;
}

/** Everything the invariant checks operate on, read in one place. */
export function snapshot(db: Db): RegistrySnapshot {
  return {
    animals: allAnimals(db),
    events: allEvents(db),
    lactations: allLactations(db),
    parentage: allParentage(db),
    statuses: allStatuses(db),
    nextSerial: readNextSerial(db),
  };
}

// ---------------------------------------------------------------------------
// Writes -- animals and events only
// ---------------------------------------------------------------------------

/**
 * Allocate the next serial, advancing the counter.
 *
 * MUST be called inside the caller's transaction, which is why it does not open
 * one of its own: a rolled-back calving must not burn a number, and wrapping it
 * separately would commit the increment even when the insert that needed it
 * fails. Gaps are still acceptable and expected -- what is forbidden is reuse,
 * which is why this is a high-water counter and never MAX(id)+1.
 */
export function allocateSerial(db: Db): string {
  const next = readNextSerial(db);
  const info = db
    .prepare(
      `UPDATE registry_serial_counter SET next_serial = next_serial + 1
        WHERE id = 1 AND next_serial = ?`,
    )
    .run(next);
  if (info.changes !== 1) {
    throw new Error(
      'serial counter moved underneath the allocation -- concurrent write outside a ' +
        'transaction. Call allocateSerial() inside BEGIN IMMEDIATE.',
    );
  }
  return formatSerial(next);
}

export interface InsertAnimalInput {
  id: string;
  name?: string | null;
  sex: RegistrySex;
  species: string;
  origin: RegistryOrigin;
  post_no?: string | null;
  tag_no?: string | null;
}

export function insertAnimal(db: Db, a: InsertAnimalInput): void {
  db.prepare(
    `INSERT INTO registry_animals (id, name, sex, species, origin, post_no, tag_no)
     VALUES (@id, @name, @sex, @species, @origin, @post_no, @tag_no)`,
  ).run({
    id: a.id,
    name: a.name ?? null,
    sex: a.sex,
    species: a.species,
    origin: a.origin,
    post_no: a.post_no ?? null,
    tag_no: a.tag_no ?? null,
  });
}

export interface AppendEventInput {
  id?: string;
  animal_id: string;
  type: RegistryEventType;
  occurred_on: string;
  occurred_time?: string | null;
  date_precision: RegistryEvent['date_precision'];
  payload: unknown;
  provenance: Provenance;
  recorded_at?: string;
  supersedes_id?: string | null;
}

/**
 * The single write path into the event log.
 *
 * Validates the payload and the date/precision pair BEFORE the insert, so a bad
 * write fails with a readable message rather than a CHECK-constraint code. The
 * schema CHECKs remain as the backstop for any process that bypasses this.
 *
 * Returns the stored row so callers that need the generated id (the calving
 * transaction) do not have to re-read it.
 */
export function appendEvent(db: Db, input: AppendEventInput): RegistryEventRow {
  const payload = assertEventPayload(input.type, input.payload);
  assertDatePrecision({
    occurred_on: input.occurred_on,
    occurred_time: input.occurred_time ?? null,
    date_precision: input.date_precision,
  });

  const row: RegistryEventRow = {
    id: input.id ?? newEventId(),
    animal_id: input.animal_id,
    type: input.type,
    occurred_on: input.occurred_on,
    occurred_time: input.occurred_time ?? null,
    date_precision: input.date_precision,
    // Sorted keys so two logically identical payloads serialize identically --
    // the rebuild-diff compares stored text, and key order would read as a
    // change that is not one.
    payload: stableStringify(payload as Record<string, unknown>),
    source_form: input.provenance.source_form,
    source_ref: input.provenance.source_ref ?? null,
    observed_by: input.provenance.observed_by ?? null,
    recorded_by: input.provenance.recorded_by,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    supersedes_id: input.supersedes_id ?? null,
  };

  db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES
       (@id, @animal_id, @type, @occurred_on, @occurred_time, @date_precision, @payload,
        @source_form, @source_ref, @observed_by, @recorded_by, @recorded_at, @supersedes_id)`,
  ).run(row);

  return row;
}

/** JSON with object keys sorted, one level deep -- payloads are flat. */
export function stableStringify(o: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) sorted[k] = o[k];
  return JSON.stringify(sorted);
}
