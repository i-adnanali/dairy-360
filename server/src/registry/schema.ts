// Animal registry -- schema and the repo's first migration runner
// (see docs/REGISTRY.md; decision doc §2.4, §4).
//
// TWO THINGS LIVE HERE, and they are separable on purpose:
//
//   1. A GLOBAL migration runner. `PRAGMA user_version` as the marker, an
//      ordered array of functions, each applied inside one transaction that
//      also bumps the version. The registry is its first customer, not its
//      owner -- any future cycle appends to MIGRATIONS.
//
//   2. applyRegistrySchema(db), the single entry point. db.ts calls it against
//      the module singleton; tests and the rebuild-diff call it against
//      `new Database(':memory:')`. One function, any handle.
//
// WHY A RUNNER AT ALL, when FARM_SCHEMA gets by with IF NOT EXISTS: because
// `CREATE TABLE IF NOT EXISTS` does nothing to a database that already has the
// table, which is why Cycle 5's four nullable columns required every developer
// to drop a live table by hand (FARM_MONITOR.md § "The schema gap"). The
// registry schema is expected to change at steps 3, 4 and 5, on the one set of
// tables holding data that cannot be recovered from software.
//
// VERSION 0 MEANS "the schema as it stands at v0.10.0". The demo tables and
// farm_events are deliberately NOT retrofitted into migration history: they are
// created by `SCHEMA`/`FARM_SCHEMA` as before, and pretending otherwise would
// require a migration that lies about what it did.

import type BetterSqlite3 from 'better-sqlite3';

/** Any better-sqlite3 handle -- the file singleton or an in-memory one. */
export type Db = BetterSqlite3.Database;

// ---------------------------------------------------------------------------
// Migration 1 -- the registry tables
// ---------------------------------------------------------------------------

/**
 * Every registry table carries the `registry_` prefix, including the ones that
 * do not collide with a demo table. The set is the unit: a consistent prefix
 * makes the boundary legible at a glance, lets the DROP-list guard in
 * registry.schema.test.ts be a single substring check, and makes any future
 * rename mechanical.
 *
 * NOTE ON FOREIGN KEYS: no registry table references a demo table, and none
 * ever may. resetSchema() drops the demo tables children-first, which is the
 * only reason `foreign_keys = ON` does not abort it; a registry -> demo FK
 * would start failing that DROP and would also couple the two lifecycles.
 */
const MIGRATION_1_REGISTRY = `
-- Serial allocation (decision doc §5). One row, id pinned to 1 by CHECK so a
-- second counter cannot be inserted. Gaps are expected and acceptable; reuse is
-- not, which is why this is a high-water mark and never a MAX(id)+1 query.
CREATE TABLE registry_serial_counter (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  next_serial INTEGER NOT NULL CHECK (next_serial >= 1)
);
INSERT INTO registry_serial_counter (id, next_serial) VALUES (1, 1);

-- Identity, not projection. Nothing the rebuild writes lives here, which is
-- what makes "projection tables can be dropped and recreated at any time"
-- literally true (decision doc §4). Derived state is in registry_animal_status.
--
-- species is TEXT with no CHECK on purpose: constraining it to the demo
-- Species union would couple the registry to shared/src/types.ts, which §9
-- exists to avoid.
CREATE TABLE registry_animals (
  id      TEXT PRIMARY KEY,
  name    TEXT,
  sex     TEXT NOT NULL CHECK (sex IN ('female','male')),
  species TEXT NOT NULL,
  origin  TEXT NOT NULL CHECK (origin IN ('born_on_farm','acquired')),
  post_no TEXT,
  tag_no  TEXT
);

-- The sole source of truth. Append-only, enforced by triggers below.
--
-- Three distinct times, three columns (decision doc §6): occurred_on is the
-- FARM-LOCAL calendar date, occurred_time the farm-local HH:MM when known, and
-- recorded_at the exact UTC instant of transcription.
--
-- FARM-LOCAL, NOT UTC, AND DELIBERATELY SO -- do not "fix" this. FARM_TZ is
-- Asia/Karachi, Pakistan does not observe DST, and the offset has been fixed
-- for the entire period any record covers, so local date ordering is total and
-- unambiguous. Every operational fact on this farm -- the 05:00/12:00/17:00/
-- 22:00 rounds, AM/PM milking, the daily sheet -- is expressed in local days.
-- Converting to UTC would move the 22:00 round onto the previous day and make
-- every sheet reconciliation a puzzle.
CREATE TABLE registry_animal_events (
  id             TEXT PRIMARY KEY,
  animal_id      TEXT NOT NULL REFERENCES registry_animals(id),
  type           TEXT NOT NULL CHECK (
                   type IN ('birth','acquired','calving','dry_off','departure','note')
                 ),
  occurred_on    TEXT NOT NULL,
  occurred_time  TEXT,
  -- NOT NULL with NO DEFAULT. A default is how 'day' gets applied to a guess.
  date_precision TEXT NOT NULL CHECK (
                   date_precision IN ('day','month','year','estimated')
                 ),
  payload        TEXT NOT NULL,
  source_form    TEXT NOT NULL CHECK (
                   source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                 ),
  source_ref     TEXT,
  observed_by    TEXT,
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  supersedes_id  TEXT REFERENCES registry_animal_events(id),

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- There is no such thing as knowing the hour but not the day.
  CONSTRAINT time_only_at_day_precision
    CHECK (occurred_time IS NULL OR date_precision = 'day'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- The stored-date conventions of §6, enforced here as well as by invariant
  -- 11: a 'month' row dated the 14th means someone silently downgraded a known
  -- date, and catching that at write time is cheaper than catching it in a
  -- verification run.
  CONSTRAINT month_precision_dated_first
    CHECK (date_precision <> 'month' OR substr(occurred_on, 9, 2) = '01'),
  CONSTRAINT year_precision_dated_jan_first
    CHECK (date_precision <> 'year' OR substr(occurred_on, 6, 5) = '01-01'),
  CONSTRAINT no_self_supersede
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

-- Two events claiming to replace the same one would make the correction chain
-- ambiguous. Partial so the overwhelming majority of rows (supersedes_id NULL)
-- are not forced unique.
CREATE UNIQUE INDEX idx_registry_events_supersedes
  ON registry_animal_events(supersedes_id)
  WHERE supersedes_id IS NOT NULL;

CREATE INDEX idx_registry_events_animal
  ON registry_animal_events(animal_id, occurred_on);
CREATE INDEX idx_registry_events_type
  ON registry_animal_events(type);

-- Append-only, enforced rather than documented. THE REPO'S FIRST TRIGGERS.
--
-- These are necessary but NOT sufficient on their own: SQLite skips DELETE
-- triggers for the implicit delete inside INSERT OR REPLACE unless
-- PRAGMA recursive_triggers is ON. Measured, not assumed -- with the pragma
-- off, "INSERT OR REPLACE INTO registry_animal_events" silently overwrites a
-- row and fires neither trigger. applyRegistrySchema() sets the pragma, and
-- registry.schema.test.ts proves the statement is rejected.
CREATE TRIGGER registry_animal_events_no_update
BEFORE UPDATE ON registry_animal_events
BEGIN
  SELECT RAISE(ABORT, 'registry_animal_events is append-only: correct by superseding event');
END;

CREATE TRIGGER registry_animal_events_no_delete
BEFORE DELETE ON registry_animal_events
BEGIN
  SELECT RAISE(ABORT, 'registry_animal_events is append-only: correct by superseding event');
END;

-- ---------------------------------------------------------------------------
-- Projection tables. Written ONLY by projectStore.ts's rebuild. Every row here
-- is derivable from registry_animal_events; if that ever stops being true,
-- something has been stored that is not derived and it belongs in an event.
-- ---------------------------------------------------------------------------

CREATE TABLE registry_lactations (
  id                 TEXT PRIMARY KEY,
  animal_id          TEXT NOT NULL REFERENCES registry_animals(id),
  opened_by_event_id TEXT NOT NULL,
  started_on         TEXT NOT NULL,
  start_precision    TEXT NOT NULL,
  ended_on           TEXT,
  end_precision      TEXT,
  end_reason         TEXT CHECK (
                       end_reason IN ('dry_off','inferred_at_next_calving')
                     ),
  closed_by_event_id TEXT,
  -- Either fully open or fully closed; a half-closed lactation is a bug.
  CONSTRAINT closed_consistently CHECK (
    (ended_on IS NULL AND end_precision IS NULL AND end_reason IS NULL)
    OR
    (ended_on IS NOT NULL AND end_precision IS NOT NULL AND end_reason IS NOT NULL)
  )
);
CREATE INDEX idx_registry_lactations_animal ON registry_lactations(animal_id);

CREATE TABLE registry_parentage (
  child_id        TEXT NOT NULL REFERENCES registry_animals(id),
  relation        TEXT NOT NULL CHECK (relation IN ('dam','sire')),
  -- A registry animal id for an on-farm dam; free text for an outside sire;
  -- NULL when the edge is asserted with certainty 'unknown'.
  parent_ref      TEXT,
  certainty       TEXT NOT NULL CHECK (certainty IN ('known','unknown')),
  source_event_id TEXT NOT NULL,
  PRIMARY KEY (child_id, relation)
);

CREATE TABLE registry_animal_status (
  animal_id         TEXT PRIMARY KEY REFERENCES registry_animals(id),
  status            TEXT NOT NULL CHECK (
                      status IN ('departed','calf','lactating','dry','heifer','male')
                    ),
  parity            INTEGER NOT NULL CHECK (parity >= 0),
  birth_on          TEXT,
  birth_precision   TEXT,
  open_lactation_id TEXT
);
`;

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Migration 2 -- `estimated` stores January 1, like `year`
// ---------------------------------------------------------------------------

/**
 * Adding a CHECK to an existing table requires REBUILDING it: SQLite has
 * ALTER TABLE ADD COLUMN but no ADD CONSTRAINT. So this is the documented
 * create-copy-drop-rename procedure, and it is the first real exercise of the
 * migration runner -- deliberately done now, while the table is empty and the
 * stakes are zero, rather than discovered at step 4.
 *
 * Three things the rebuild has to get right, all verified before it was written:
 *
 *   - `supersedes_id` is a SELF-referencing foreign key. Dropping the old table
 *     registers a deferred FK violation that renaming the new one does not
 *     clear, so `defer_foreign_keys` is NOT enough -- this needs foreign_keys
 *     OFF, which cannot be set inside a transaction. Hence `rebuildsTables`.
 *   - Dropping a table drops its indexes AND its triggers. Both are recreated
 *     below; without that the append-only guarantee would silently vanish.
 *   - The new table declares its self-FK against the FINAL name, which resolves
 *     correctly after the rename.
 */
const MIGRATION_2_ESTIMATED_JAN_FIRST = `
CREATE TABLE registry_animal_events_new (
  id             TEXT PRIMARY KEY,
  animal_id      TEXT NOT NULL REFERENCES registry_animals(id),
  type           TEXT NOT NULL CHECK (
                   type IN ('birth','acquired','calving','dry_off','departure','note')
                 ),
  occurred_on    TEXT NOT NULL,
  occurred_time  TEXT,
  date_precision TEXT NOT NULL CHECK (
                   date_precision IN ('day','month','year','estimated')
                 ),
  payload        TEXT NOT NULL,
  source_form    TEXT NOT NULL CHECK (
                   source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                 ),
  source_ref     TEXT,
  observed_by    TEXT,
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  supersedes_id  TEXT REFERENCES registry_animal_events(id),

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT time_only_at_day_precision
    CHECK (occurred_time IS NULL OR date_precision = 'day'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CONSTRAINT month_precision_dated_first
    CHECK (date_precision <> 'month' OR substr(occurred_on, 9, 2) = '01'),
  CONSTRAINT year_precision_dated_jan_first
    CHECK (date_precision <> 'year' OR substr(occurred_on, 6, 5) = '01-01'),
  -- NEW in migration 2. Without it, 'estimated' was the one precision with no
  -- storage convention, so a route or a direct INSERT could write
  -- 'estimated 2021-04-12' -- a fabricated day wearing a humility label. The
  -- convention now fails the same way the other two do, at the database, rather
  -- than depending on every caller to normalize.
  CONSTRAINT estimated_precision_dated_jan_first
    CHECK (date_precision <> 'estimated' OR substr(occurred_on, 6, 5) = '01-01'),
  CONSTRAINT no_self_supersede
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

INSERT INTO registry_animal_events_new
  SELECT id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
         source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id
    FROM registry_animal_events;

DROP TABLE registry_animal_events;
ALTER TABLE registry_animal_events_new RENAME TO registry_animal_events;

CREATE UNIQUE INDEX idx_registry_events_supersedes
  ON registry_animal_events(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX idx_registry_events_animal
  ON registry_animal_events(animal_id, occurred_on);
CREATE INDEX idx_registry_events_type
  ON registry_animal_events(type);

CREATE TRIGGER registry_animal_events_no_update
BEFORE UPDATE ON registry_animal_events
BEGIN
  SELECT RAISE(ABORT, 'registry_animal_events is append-only: correct by superseding event');
END;

CREATE TRIGGER registry_animal_events_no_delete
BEFORE DELETE ON registry_animal_events
BEGIN
  SELECT RAISE(ABORT, 'registry_animal_events is append-only: correct by superseding event');
END;
`;

// ---------------------------------------------------------------------------
// Migration 3 -- per-animal milk yield (step 4; docs/REGISTRY_MILKING.md)
// ---------------------------------------------------------------------------

/**
 * A TABLE, NOT AN EVENT TYPE, and for two reasons.
 *
 * `milking` stays in RESERVED_EVENT_TYPES -- removing it would let a loose
 * `milking` event through the write boundary, which is the opposite of what the
 * reserved list is for.
 *
 *   1. The demo `milkings` table has a foreign key to the demo `animals`, which
 *      `resetSchema()` drops on every seed, so real yield can never go there.
 *      Decided in REGISTRY.md long before this landed.
 *   2. VOLUME. `herd()` loads every event into JavaScript on every render and
 *      `checkSnapshot` runs over a whole-registry snapshot. The herd is 31
 *      animals and 70 events; two sessions a day is thousands of rows a year,
 *      for rows no projection reads. In the event log that would make every herd
 *      page scale with milking history.
 *
 * The reserved list conflates two kinds of thing, and this is where the seam
 * shows: `heat_observed`, `insemination`, `pregnancy_check`, `abortion`,
 * `treatment` and `vet_visit` are sparse LIFE EVENTS that change what an animal
 * is and have derived consequences. `milking`, `weight` and `body_condition` are
 * repeating MEASUREMENTS that describe what it did and derive nothing. Only the
 * first group belongs in the event log; steps 5 and 6 will meet this again.
 *
 * ---------------------------------------------------------------------------
 * THIS IS A RECORD, NOT A PROJECTION
 * ---------------------------------------------------------------------------
 * It is in REGISTRY_TABLES and deliberately NOT in REGISTRY_PROJECTION_TABLES.
 * The rebuild must never touch it: nothing here is derivable from the event log,
 * which is the test that decides which list a table belongs in.
 *
 * ---------------------------------------------------------------------------
 * AND IT IS THE FIRST REGISTRY TABLE THAT PERMITS DELETE
 * ---------------------------------------------------------------------------
 * No append-only triggers, unlike registry_animal_events. A yield is a
 * MEASUREMENT, not a claim about history: nothing is derived from it but
 * aggregates that recompute, and a wrong number is a mis-reading rather than a
 * false assertion about the past. So it is corrected by UPDATE, and a whole
 * session entered against the wrong date is repaired by DELETE and re-entry --
 * there is no superseding event to write, and the UNIQUE below means the wrong
 * date keeps holding rows until they are removed.
 *
 * That divergence is stated here rather than left to be inferred from the
 * absence of a trigger. What keeps it honest is scope: deletion is per-row and
 * per-session from the roster, never a bulk statement, and it must never become
 * reachable for any other registry_* table.
 */
const MIGRATION_3_MILKINGS = `
CREATE TABLE registry_milkings (
  id            TEXT PRIMARY KEY,
  animal_id     TEXT NOT NULL REFERENCES registry_animals(id),
  -- FARM-LOCAL calendar date, same convention and same reasons as events.
  occurred_on   TEXT NOT NULL,
  session       TEXT NOT NULL CHECK (session IN ('morning','evening')),
  status        TEXT NOT NULL CHECK (
                  status IN ('measured','milked_not_measured','not_milked')
                ),
  yield_litres  REAL,
  reason        TEXT,
  occurred_time TEXT,
  observed_by   TEXT,
  recorded_by   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  source_form   TEXT NOT NULL CHECK (
                  source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                ),
  note          TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),

  -- The storage convention of the status vocabulary, enforced at the database
  -- as well as at the write boundary. A row claiming 'measured' with no number
  -- is not a measurement, and a number filed under 'not_milked' is a
  -- contradiction rather than a typo.
  CONSTRAINT measured_has_a_number
    CHECK ((status = 'measured') = (yield_litres IS NOT NULL)),
  CONSTRAINT yield_is_not_negative
    CHECK (yield_litres IS NULL OR yield_litres >= 0),
  CONSTRAINT reason_only_when_not_milked
    CHECK (reason IS NULL OR status = 'not_milked'),

  -- One row per animal per session. This is what makes a session's COMPLETENESS
  -- a countable fact rather than an interpretation, and it is what an update
  -- conflicts on when a figure is corrected.
  CONSTRAINT one_row_per_animal_per_session
    UNIQUE (animal_id, occurred_on, session)
);

CREATE INDEX idx_registry_milkings_animal ON registry_milkings(animal_id, occurred_on);
CREATE INDEX idx_registry_milkings_date   ON registry_milkings(occurred_on, session);
`;

// ---------------------------------------------------------------------------
// Migration 4 -- the override moves from the payload to two columns
// ---------------------------------------------------------------------------

/**
 * REGISTRY_ENTRY_UX.md §11 carried a standing instruction: the override record
 * belongs in a column rather than the payload, "do not migrate for this alone --
 * bundle it into whichever migration lands next". This is that moment, and it
 * goes as its OWN migration rather than riding with the sales tables, because
 * this one rebuilds a table with foreign keys off and those are plain CREATEs.
 * Putting both behind one review is what REGISTRY.md refused at migration 3.
 *
 * WHY A COLUMN IS THE BETTER SHAPE (the reasoning that was in types.ts):
 * uniform across event types, queryable without json_extract, and sitting beside
 * the other provenance fields it resembles. Three things it also buys that the
 * payload could not:
 *
 *   - A CHECK on the vocabulary. In the payload, `check` was validated only at
 *     the write boundary, so a hand-written INSERT could store any string. Now
 *     the database refuses an unknown check, and refuses a `reason` with no
 *     `check` -- prose about a guard that was never stepped past.
 *   - No nested object in the payload. `stableStringify` sorts keys ONE level
 *     deep because "payloads are flat", which was true of everything except
 *     this. The nested override rode on JSON.stringify's insertion order, and
 *     the rebuild-diff compares payload TEXT. That fragility is now gone rather
 *     than documented.
 *   - The payload of every calving, dry_off and departure gets shorter, which is
 *     the shape the model sees through get_registry_animal.
 *
 * THE COPY IS DONE IN JAVASCRIPT, NOT WITH json_remove(). Two reasons, and the
 * second is the load-bearing one:
 *
 *   - The rebuild-diff compares stored payload text, so the rewritten payload
 *     must be byte-identical to what the writer would produce. SQLite's JSON
 *     functions re-render rather than edit, and matching their output to
 *     JSON.stringify's is an assumption, not a guarantee.
 *   - A migration must be FROZEN. Calling the live `stableStringify` would mean
 *     a future edit to that helper silently changes what migration 4 did to
 *     databases migrated after the edit. So the serializer is inlined here, and
 *     it must never be replaced with an import.
 */
const MIGRATION_4_CREATE = `
CREATE TABLE registry_animal_events_new (
  id             TEXT PRIMARY KEY,
  animal_id      TEXT NOT NULL REFERENCES registry_animals(id),
  type           TEXT NOT NULL CHECK (
                   type IN ('birth','acquired','calving','dry_off','departure','note')
                 ),
  occurred_on    TEXT NOT NULL,
  occurred_time  TEXT,
  date_precision TEXT NOT NULL CHECK (
                   date_precision IN ('day','month','year','estimated')
                 ),
  payload        TEXT NOT NULL,
  source_form    TEXT NOT NULL CHECK (
                   source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                 ),
  source_ref     TEXT,
  observed_by    TEXT,
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  supersedes_id  TEXT REFERENCES registry_animal_events(id),

  -- NEW in migration 4. Was payload.override.{check,reason}.
  override_check  TEXT,
  override_reason TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT time_only_at_day_precision
    CHECK (occurred_time IS NULL OR date_precision = 'day'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CONSTRAINT month_precision_dated_first
    CHECK (date_precision <> 'month' OR substr(occurred_on, 9, 2) = '01'),
  CONSTRAINT year_precision_dated_jan_first
    CHECK (date_precision <> 'year' OR substr(occurred_on, 6, 5) = '01-01'),
  CONSTRAINT estimated_precision_dated_jan_first
    CHECK (date_precision <> 'estimated' OR substr(occurred_on, 6, 5) = '01-01'),
  CONSTRAINT no_self_supersede
    CHECK (supersedes_id IS NULL OR supersedes_id <> id),

  -- The vocabulary, enforced at the database for the first time. In the payload
  -- this was a write-boundary check only.
  CONSTRAINT override_check_is_known
    CHECK (override_check IS NULL OR
           override_check IN ('near_duplicate_calving','animal_departed')),
  -- A reason with no check is prose about a guard nobody stepped past. The
  -- converse is fine and deliberate: the flag is load-bearing, the prose is
  -- optional (see OverrideRecord in types.ts).
  CONSTRAINT override_reason_needs_a_check
    CHECK (override_reason IS NULL OR override_check IS NOT NULL),
  -- A note is always allowed after a departure, so it can never carry an
  -- override. The write boundary already refused one; now the schema does too.
  CONSTRAINT note_never_overrides
    CHECK (override_check IS NULL OR type <> 'note')
);
`;

const MIGRATION_4_FINISH = `
DROP TABLE registry_animal_events;
ALTER TABLE registry_animal_events_new RENAME TO registry_animal_events;

CREATE UNIQUE INDEX idx_registry_events_supersedes
  ON registry_animal_events(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
CREATE INDEX idx_registry_events_animal
  ON registry_animal_events(animal_id, occurred_on);
CREATE INDEX idx_registry_events_type
  ON registry_animal_events(type);

CREATE TRIGGER registry_animal_events_no_update
BEFORE UPDATE ON registry_animal_events
BEGIN
  SELECT RAISE(ABORT, 'registry_animal_events is append-only: correct by superseding event');
END;

CREATE TRIGGER registry_animal_events_no_delete
BEFORE DELETE ON registry_animal_events
BEGIN
  SELECT RAISE(ABORT, 'registry_animal_events is append-only: correct by superseding event');
END;
`;

/**
 * Frozen copy of `stableStringify` from store.ts. DO NOT replace with an import:
 * see the note above. If store.ts's serializer ever changes, this one must not.
 */
function migration4Json(o: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) sorted[k] = o[k];
  return JSON.stringify(sorted);
}

interface Migration4Row {
  id: string;
  animal_id: string;
  type: string;
  occurred_on: string;
  occurred_time: string | null;
  date_precision: string;
  payload: string;
  source_form: string;
  source_ref: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  supersedes_id: string | null;
}

function migration4(db: Db): void {
  db.exec(MIGRATION_4_CREATE);

  const rows = db.prepare(`SELECT * FROM registry_animal_events`).all() as Migration4Row[];
  const insert = db.prepare(
    `INSERT INTO registry_animal_events_new
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id,
        override_check, override_reason)
     VALUES
       (@id, @animal_id, @type, @occurred_on, @occurred_time, @date_precision, @payload,
        @source_form, @source_ref, @observed_by, @recorded_by, @recorded_at, @supersedes_id,
        @override_check, @override_reason)`,
  );

  for (const r of rows) {
    const payload = JSON.parse(r.payload) as Record<string, unknown>;
    // `override: null` was stored explicitly whenever a guard was not tripped,
    // so `delete` rather than a truthiness test -- both shapes must leave the
    // payload with no `override` key at all.
    const raw = payload.override as { check?: unknown; reason?: unknown } | null | undefined;
    delete payload.override;
    insert.run({
      ...r,
      payload: migration4Json(payload),
      override_check: typeof raw?.check === 'string' ? raw.check : null,
      override_reason: typeof raw?.reason === 'string' ? raw.reason : null,
    });
  }

  db.exec(MIGRATION_4_FINISH);
}

// ---------------------------------------------------------------------------
// Migration 5 -- milk sales, home use and the buyer ledger
// (docs/REGISTRY_SALES.md §9)
// ---------------------------------------------------------------------------

/**
 * FOUR TABLES, ALL RECORDS, NONE A PROJECTION.
 *
 * They go in REGISTRY_TABLES and stay out of REGISTRY_PROJECTION_TABLES, by the
 * test that decides the question: nothing in them is derivable from the event
 * log. The rebuild must never touch them. Because backup.ts computes
 * SOURCE_OF_TRUTH_TABLES as REGISTRY_TABLES minus the projections rather than
 * listing it, they are backed up with nothing to remember -- which is that
 * design paying for itself for the first time.
 *
 * THE FIRST REGISTRY TABLES WITH NO `animal_id`. Every registry table before
 * this hangs off an animal; these four hang off a counterparty. That is why
 * this is not "step 5" -- it is a different axis from the animal record, and
 * the registry's step numbering should not absorb it.
 *
 * A PLAIN SET OF CREATEs: nothing existing is touched, so no `rebuildsTables`
 * and no foreign-keys relaxation. The cheap kind of migration, unlike the one
 * immediately before it.
 *
 * ---------------------------------------------------------------------------
 * WHY `registry_dispatches` AND NOT `registry_sales`
 * ---------------------------------------------------------------------------
 * Because milk kept for the house has to go somewhere, and the two ways of
 * forcing it into a sales table are both worse: a "sale" at price zero to
 * yourself is a lie in the one table that must not contain any, and a separate
 * registry_home_use table duplicates the key, the row states, the save path and
 * the completeness count -- and makes every future disposition a third table.
 *
 * The row records milk LEAVING THE BULK to a destination in a session. Selling
 * is the dominant disposition, not the only one, and money is a property of the
 * destination rather than of the act.
 *
 * The payoff is not tidiness: home use becomes a row on the daily sheet that
 * blocks the save when untouched, exactly as an unrecorded animal blocks the
 * milking roster. Home use is the most forgettable quantity on a dairy, and at
 * month end it is the whole of the unexplained difference.
 */
const MIGRATION_5_SALES = `
-- Who milk goes to: buyers AND home. See registry_dispatches below for why
-- those are one table.
CREATE TABLE registry_destinations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('dodhi','household','shop','home','other')),

  -- billable is its OWN column, not a filter on kind. REGISTRY.md records the
  -- farm_events.is_synthetic failure -- a discriminator that exists and that
  -- nothing filters on, whose correctness has therefore never been exercised.
  -- The defence here is structural instead: a non-billable destination has no
  -- rows in registry_destination_prices, so it cannot produce an amount, cannot
  -- appear in a balance and cannot be invoiced. This column makes the intent
  -- legible and gives invariant 22 something to check.
  billable    INTEGER NOT NULL CHECK (billable IN (0,1)),

  -- Standing destinations are on every sheet and BLOCK THE SAVE when untouched;
  -- occasional ones are not rows until they took something.
  --
  -- This exists instead of the 'sessions' column the farm was asked for. The
  -- answer -- "the dodhi comes both times, the households can vary ... depends
  -- on how much milking animals are in that season and time of the month" --
  -- means a fixed morning/evening pattern would be FICTION, wrong for half the
  -- year. What varies is availability, so what is stored is whether the sheet
  -- must account for them, not when they come.
  --
  -- NOT derived from kind: kind is who they are, standing is how the sheet
  -- treats them, and a household moves between the two with the season.
  standing    INTEGER NOT NULL CHECK (standing IN (0,1)),

  contact     TEXT,
  -- The ACTIVE RANGE, not a status flag. Membership on a past date is a range
  -- test, which is what lets the sheet open last Tuesday and show who was
  -- buying THEN -- the same argument milking.ts makes for deriving the roster
  -- from lactation rows rather than from the status projection.
  started_on  TEXT NOT NULL,
  ended_on    TEXT,
  note        TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,

  CONSTRAINT started_on_is_a_date
    CHECK (started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT ended_on_is_a_date
    CHECK (ended_on IS NULL OR ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT the_range_runs_forwards
    CHECK (ended_on IS NULL OR ended_on >= started_on),
  CONSTRAINT a_destination_is_named
    CHECK (length(trim(name)) > 0),
  -- Home milk is never billed, and that is structural rather than a habit.
  CONSTRAINT home_is_never_billable
    CHECK (kind <> 'home' OR billable = 0)
);
CREATE INDEX idx_registry_destinations_active
  ON registry_destinations(started_on, ended_on);

-- NOTE THE ABSENCE OF A UNIQUE INDEX pinning a single non-billable destination.
-- Splitting home use into household and staff milk, or adding calves or
-- spoilage, must not cost a migration -- that is what makes "calves are a row,
-- not a schema change" literally true rather than aspirational.

-- The AGREEMENT. Effective-dated: a price change is a new row, never an UPDATE
-- to the old one, and the price in force on a date is the latest row at or
-- before it.
--
-- A PRICE IS TWO NUMBERS. price_minor is the amount and price_unit_litres is
-- the lot it covers: Rs 7,000 per 40 L is (700000, 40), stored as agreed. See
-- money.ts for why normalising to per-litre would be wrong in three separate
-- ways.
--
-- NO APPEND-ONLY TRIGGERS, unlike registry_animal_events, and that is safe
-- BECAUSE OF THE CAPTURE below: every dispatch already holds its own figure, so
-- correcting an agreement changes only the default offered to future entry and
-- rewrites no history.
CREATE TABLE registry_destination_prices (
  id                TEXT PRIMARY KEY,
  destination_id    TEXT NOT NULL REFERENCES registry_destinations(id),
  effective_from    TEXT NOT NULL,
  price_minor       INTEGER NOT NULL CHECK (price_minor >= 0),
  price_unit_litres REAL    NOT NULL CHECK (price_unit_litres > 0),
  recorded_by       TEXT NOT NULL,
  recorded_at       TEXT NOT NULL,
  note              TEXT,

  CONSTRAINT effective_from_is_a_date
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- A second price on the same date for the same destination is not a price
  -- change, it is a typo -- and which one won would be silent.
  CONSTRAINT one_price_per_destination_per_day
    UNIQUE (destination_id, effective_from)
);
CREATE INDEX idx_registry_destination_prices_dest
  ON registry_destination_prices(destination_id, effective_from);

-- Milk leaving the bulk. One row per destination per session.
--
-- THREE ROW STATES, NOT FOUR, and the asymmetry with registry_milkings is the
-- point. A yield needs 'milked_not_measured' because a fabricated number is
-- worse than a recorded gap and nobody is harmed by an unweighed milking. A
-- dispatch has a counterparty whose money depends on the figure, so an
-- unmeasured one is not a thing that happens -- the litres IS the transaction.
-- Whoever copies the milking table to build the next one of these will look for
-- the fourth state; this comment is where they find out where it went.
CREATE TABLE registry_dispatches (
  id                TEXT PRIMARY KEY,
  destination_id    TEXT NOT NULL REFERENCES registry_destinations(id),
  occurred_on       TEXT NOT NULL,          -- farm-local calendar date
  session           TEXT NOT NULL CHECK (session IN ('morning','evening')),
  status            TEXT NOT NULL CHECK (status IN ('taken','none')),
  litres            REAL,
  -- CAPTURED at entry time, not looked up -- and the LOT SIZE travels with the
  -- amount, because a figure without its unit is not a price.
  price_minor       INTEGER,
  price_unit_litres REAL,
  reason            TEXT,                   -- why nothing was taken
  occurred_time     TEXT,                   -- optional, never defaulted
  observed_by       TEXT,                   -- who handed the milk over
  recorded_by       TEXT NOT NULL,
  recorded_at       TEXT NOT NULL,
  source_form       TEXT NOT NULL CHECK (
                      source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                    ),
  note              TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CONSTRAINT taken_has_litres
    CHECK ((status = 'taken') = (litres IS NOT NULL)),
  CONSTRAINT litres_is_not_negative
    CHECK (litres IS NULL OR litres >= 0),
  CONSTRAINT reason_only_when_none
    CHECK (reason IS NULL OR status = 'none'),
  CONSTRAINT price_only_when_taken
    CHECK (price_minor IS NULL OR status = 'taken'),
  CONSTRAINT price_is_not_negative
    CHECK (price_minor IS NULL OR price_minor >= 0),
  -- Both halves of a price or neither. A rate with no lot size is unpriceable
  -- and a lot size with no rate is meaningless.
  CONSTRAINT a_price_is_both_halves
    CHECK ((price_minor IS NULL) = (price_unit_litres IS NULL)),
  CONSTRAINT price_unit_is_positive
    CHECK (price_unit_litres IS NULL OR price_unit_litres > 0),
  -- One row per destination per session. What makes a session's COMPLETENESS a
  -- countable fact rather than an interpretation, and what an update conflicts
  -- on when a figure is corrected.
  CONSTRAINT one_row_per_destination_per_session
    UNIQUE (destination_id, occurred_on, session)
);
CREATE INDEX idx_registry_dispatches_dest ON registry_dispatches(destination_id, occurred_on);
CREATE INDEX idx_registry_dispatches_date ON registry_dispatches(occurred_on, session);

-- The credit half of the ledger.
--
-- THERE IS NO 'paid' COLUMN ANYWHERE, and that is the whole reason this table
-- exists. The demo deliveries.paid is a per-row boolean, and a dodhi handing
-- over Rs 40,000 against three weeks of collections is paying against no row in
-- particular -- partial payment, overpayment, an advance and a running balance
-- are not hard to express with a flag, they are UNREPRESENTABLE.
--
-- balance = SUM(amountMinor over taken billable dispatches) - SUM(payments),
-- derived on every read and never cached: a stored balance is a number that can
-- disagree with the rows it came from.
CREATE TABLE registry_payments (
  id             TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES registry_destinations(id),
  occurred_on    TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('cash','bank','adjustment')),
  reference      TEXT,                   -- cheque no., transfer ref, khata page
  observed_by    TEXT,                   -- who took the money
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  note           TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Only an adjustment may be signed. Cash and bank are money that changed
  -- hands, and a negative one is a different fact wearing the wrong label.
  CONSTRAINT cash_and_bank_are_positive
    CHECK (method = 'adjustment' OR amount_minor > 0),
  -- A signed number with no sentence attached is unauditable a month later, and
  -- an adjustment is always a decision somebody made rather than a transaction.
  CONSTRAINT an_adjustment_explains_itself
    CHECK (method <> 'adjustment'
           OR (amount_minor <> 0 AND note IS NOT NULL AND length(trim(note)) > 0))
);
CREATE INDEX idx_registry_payments_dest ON registry_payments(destination_id, occurred_on);
`;

export interface Migration {
  /** Applied inside a transaction that also bumps user_version. */
  up: (db: Db) => void;
  /**
   * Set when the migration REBUILDS a table (create-copy-drop-rename), which is
   * how SQLite adds a CHECK constraint to an existing table.
   *
   * A rebuild needs `foreign_keys` OFF for its duration -- dropping a table
   * that is the target of a foreign key registers a violation that recreating
   * it does not clear, and `defer_foreign_keys` does not help. That pragma is a
   * no-op inside a transaction, so the runner toggles it AROUND the
   * transaction and runs `PRAGMA foreign_key_check` before committing, which is
   * the documented procedure and is what keeps the relaxation honest.
   */
  rebuildsTables?: boolean;
}

/**
 * Ordered, append-only. Index i is schema version i+1. NEVER reorder, never
 * edit an applied entry, never remove one -- a database already at version N
 * will not re-run entries below N, so an edit silently produces two different
 * schemas depending on when the database was created.
 */
export const MIGRATIONS: readonly Migration[] = [
  { up: (db) => db.exec(MIGRATION_1_REGISTRY) },
  { up: (db) => db.exec(MIGRATION_2_ESTIMATED_JAN_FIRST), rebuildsTables: true },
  // A plain CREATE TABLE: no existing table is rebuilt, so no `rebuildsTables`
  // and no foreign_keys relaxation.
  { up: (db) => db.exec(MIGRATION_3_MILKINGS) },
  // Rebuilds registry_animal_events to add two columns and three CHECKs, and
  // rewrites every payload to drop the key they replace. Same self-referencing
  // foreign key as migration 2, so the same relaxation.
  { up: migration4, rebuildsTables: true },
  // Four plain CREATEs (docs/REGISTRY_SALES.md). Nothing existing is touched,
  // so no `rebuildsTables` and no foreign_keys relaxation.
  { up: (db) => db.exec(MIGRATION_5_SALES) },
];

/** The version a fully-migrated database reports. */
export const TARGET_VERSION = MIGRATIONS.length;

export interface MigrationResult {
  from: number;
  to: number;
  applied: number;
}

function readUserVersion(db: Db): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Apply every migration above the database's `user_version`.
 *
 * Each migration runs inside its own transaction that also bumps the version,
 * so a failure leaves the database at the last good version with nothing
 * half-applied. Measured, not assumed: `PRAGMA user_version` participates in
 * the transaction and rolls back with the DDL.
 *
 * Idempotent -- a second call applies zero migrations.
 */
export function runMigrations(db: Db): MigrationResult {
  const from = readUserVersion(db);
  if (from > MIGRATIONS.length) {
    throw new Error(
      `database schema version ${from} is newer than this build knows about ` +
        `(${MIGRATIONS.length}). Refusing to run: an older build must not touch a ` +
        `newer schema.`,
    );
  }

  let applied = 0;
  for (let i = from; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    const migration = MIGRATIONS[i];

    const body = (): void => {
      migration.up(db);
      if (migration.rebuildsTables) {
        // The documented safeguard for running with foreign_keys OFF: prove
        // nothing was orphaned before committing. Without this, the relaxation
        // would be a hole rather than a controlled one.
        const violations = db.pragma('foreign_key_check') as unknown[];
        if (violations.length > 0) {
          throw new Error(
            `migration ${version} left ${violations.length} foreign key violation(s): ` +
              `${JSON.stringify(violations)}`,
          );
        }
      }
      // Pragmas cannot be parameterized, so the version is interpolated. It is
      // a loop index over a static array, never external input -- do not
      // "fix" this into a bound parameter, which SQLite would silently ignore.
      db.exec(`PRAGMA user_version = ${version}`);
    };

    if (migration.rebuildsTables) {
      // `foreign_keys` is a no-op inside a transaction, so it must be toggled
      // around it. The `finally` matters: a failed rebuild must not leave the
      // connection with foreign keys off, which would silently disable the
      // constraint for everything that ran afterwards.
      db.pragma('foreign_keys = OFF');
      try {
        db.transaction(body)();
      } finally {
        db.pragma('foreign_keys = ON');
      }
    } else {
      db.transaction(body)();
    }
    applied++;
  }

  return { from, to: readUserVersion(db), applied };
}

/**
 * Connection-level settings the registry's guarantees depend on.
 *
 * Called for every handle, because SQLite pragmas are PER-CONNECTION: a second
 * handle does not inherit them, so an `:memory:` database used by a test needs
 * the same settings as the file singleton or it silently tests something else.
 */
export function applyRegistryPragmas(db: Db): void {
  // Required for the append-only triggers to cover INSERT OR REPLACE. Without
  // it SQLite skips the DELETE trigger on the implicit delete and the row is
  // silently overwritten -- measured, not assumed. This is the whole reason the
  // append-only guarantee is not just the two triggers.
  db.pragma('recursive_triggers = ON');
  // better-sqlite3 already defaults this ON (raw SQLite defaults it OFF), but
  // depending on a library default for a correctness property is how it breaks
  // in a major version bump.
  db.pragma('foreign_keys = ON');
}

/** A pragma the registry's guarantees depend on, and what breaks without it. */
const REQUIRED_PRAGMAS: readonly {
  name: string;
  expected: number;
  because: string;
}[] = [
  {
    name: 'recursive_triggers',
    expected: 1,
    because:
      'without it SQLite skips the DELETE trigger for the implicit delete inside\n' +
      '  INSERT OR REPLACE, so `INSERT OR REPLACE INTO registry_animal_events` silently\n' +
      '  overwrites a row and the append-only guarantee is FALSE',
  },
  {
    name: 'foreign_keys',
    expected: 1,
    because:
      'without it an event can reference an animal that does not exist, and a\n' +
      '  supersedes_id can dangle',
  },
];

/**
 * Read the required pragmas back and hard-fail if any is wrong.
 *
 * WHY AN ASSERTION AND NOT JUST THE SET ABOVE: these are connection pragmas, so
 * the append-only guarantee travels with the HANDLE, not with the database
 * file. Any code that opens its own connection -- the `sqlite3` CLI, a
 * one-off maintenance script, a future module that calls `new Database()`
 * directly instead of importing the singleton -- gets a connection where
 * `recursive_triggers` is OFF and `INSERT OR REPLACE` silently works.
 *
 * Setting a pragma and never reading it back is how that becomes invisible. The
 * database cannot defend itself here, so the process asserts at boot: if this
 * throws, something changed the connection out from under the registry, and
 * failing at import is far better than discovering it from a mysteriously
 * mutated event.
 */
export function assertRegistryPragmas(db: Db): void {
  for (const p of REQUIRED_PRAGMAS) {
    const actual = db.pragma(p.name, { simple: true });
    if (actual !== p.expected) {
      throw new Error(
        `registry: PRAGMA ${p.name} is ${JSON.stringify(actual)}, expected ${p.expected}.\n` +
          `  ${p.because}.\n` +
          '  Pragmas are PER-CONNECTION -- see docs/REGISTRY.md, Decision 7. Every handle\n' +
          '  that touches registry tables must go through applyRegistrySchema().',
      );
    }
  }
}

/** What `beforeMigrate` is told: the version the database is at, and the one it
 * is about to be moved to. Not a MigrationResult -- nothing has been applied
 * yet, and a result type with `applied: 0` would invite reading it as one. */
export interface PendingMigrations {
  from: number;
  to: number;
}

export interface ApplySchemaOptions {
  /**
   * Called once, BEFORE the first migration runs, and only when there is at
   * least one to run. A throw here aborts the migration.
   *
   * INJECTED RATHER THAN IMPORTED, which is why this module still imports
   * nothing but a better-sqlite3 type. db.ts wires `preMigrationBackup` from
   * backup.ts; backup.ts needs this module's table lists, so importing it here
   * would be a require cycle -- and one that resolves during db.ts's own module
   * load, which is the worst place to have one.
   *
   * The same reason registryRouter is a factory: a handle, or a hook, passed in
   * beats a dependency reached for.
   */
  beforeMigrate?: (pending: PendingMigrations) => void;
}

/**
 * The single entry point. Sets the required pragmas, asserts them, migrates.
 *
 * `db.ts` calls this once at module load against the singleton, with the
 * pre-migration backup hook. Tests and the rebuild-diff call it against
 * `new Database(':memory:')` with no options, which is what keeps a suite of
 * hundreds of in-memory migrations from writing a single file.
 *
 * Note for in-memory handles: `journal_mode = WAL` is silently ignored by
 * SQLite for `:memory:` databases (it returns "memory", not an error), which is
 * why this function does not set or assert a journal mode.
 */
export function applyRegistrySchema(
  db: Db,
  opts: ApplySchemaOptions = {},
): MigrationResult {
  applyRegistryPragmas(db);
  assertRegistryPragmas(db);
  // Read before migrating and gated on there being work to do, so the hook does
  // not fire on the overwhelmingly common no-op boot. runMigrations re-reads the
  // version itself and remains the authority on what actually gets applied --
  // this is a notification, not a decision.
  if (opts.beforeMigrate) {
    const from = readUserVersion(db);
    if (from < MIGRATIONS.length) {
      opts.beforeMigrate({ from, to: MIGRATIONS.length });
    }
  }
  const result = runMigrations(db);
  // Asserted AGAIN after migrating, because a `rebuildsTables` migration turns
  // foreign_keys off and back on. If one ever failed to restore it, every write
  // after this point would run without foreign key enforcement -- silently.
  assertRegistryPragmas(db);
  return result;
}

/** Every table this module creates, for the DROP-list guard and the rebuild. */
export const REGISTRY_TABLES = [
  'registry_animal_events',
  'registry_animal_status',
  'registry_animals',
  'registry_destination_prices',
  'registry_destinations',
  'registry_dispatches',
  'registry_lactations',
  'registry_milkings',
  'registry_parentage',
  'registry_payments',
  'registry_serial_counter',
] as const;

/**
 * The projection tables -- the ones the rebuild is allowed to clear.
 *
 * `registry_milkings` is deliberately ABSENT, and so are the four sales tables
 * added by migration 5. The test for this list is whether every row is derivable
 * from the event log; a milk figure is not, a litre sold is not, and neither is
 * a payment. Clearing any of them would destroy the only copy. They are records,
 * like the event log and registry_animals.
 */
export const REGISTRY_PROJECTION_TABLES = [
  'registry_animal_status',
  'registry_lactations',
  'registry_parentage',
] as const;
