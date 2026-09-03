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

/**
 * Ordered, append-only. Index i is schema version i+1. NEVER reorder, never
 * edit an applied entry, never remove one -- a database already at version N
 * will not re-run entries below N, so an edit silently produces two different
 * schemas depending on when the database was created.
 */
export const MIGRATIONS: readonly ((db: Db) => void)[] = [
  (db) => db.exec(MIGRATION_1_REGISTRY),
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
    const migrate = MIGRATIONS[i];
    db.transaction(() => {
      migrate(db);
      // Pragmas cannot be parameterized, so the version is interpolated. It is
      // a loop index over a static array, never external input -- do not
      // "fix" this into a bound parameter, which SQLite would silently ignore.
      db.exec(`PRAGMA user_version = ${version}`);
    })();
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

/**
 * The single entry point. Sets the required pragmas, asserts them, migrates.
 *
 * `db.ts` calls this once at module load against the singleton. Tests and the
 * rebuild-diff call it against `new Database(':memory:')`.
 *
 * Note for in-memory handles: `journal_mode = WAL` is silently ignored by
 * SQLite for `:memory:` databases (it returns "memory", not an error), which is
 * why this function does not set or assert a journal mode.
 */
export function applyRegistrySchema(db: Db): MigrationResult {
  applyRegistryPragmas(db);
  assertRegistryPragmas(db);
  return runMigrations(db);
}

/** Every table this module creates, for the DROP-list guard and the rebuild. */
export const REGISTRY_TABLES = [
  'registry_animal_events',
  'registry_animal_status',
  'registry_animals',
  'registry_lactations',
  'registry_parentage',
  'registry_serial_counter',
] as const;

/** The projection tables -- the ones the rebuild is allowed to clear. */
export const REGISTRY_PROJECTION_TABLES = [
  'registry_animal_status',
  'registry_lactations',
  'registry_parentage',
] as const;
