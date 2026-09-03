// Animal registry -- schema, migration runner, and the isolation guards.
//
// Runs under plain `npm test -w server`. Uses `:memory:` only, so the suite
// still writes nothing to disk.
//
// NOTE ON LOCATION: this file is at src/registry/*.test.ts and must stay two
// directories deep. The test script's glob is `src/**/*.test.ts`, expanded by
// sh where `**` is NOT globstar -- it resolves to src/<dir>/<file>.test.ts.
// A test in src/registry/__tests__/ would be silently skipped by CI forever,
// which is how src/agent/__tests__/*.test.ts already escapes `npm test`.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';

import {
  applyRegistryPragmas,
  applyRegistrySchema,
  assertRegistryPragmas,
  MIGRATIONS,
  REGISTRY_TABLES,
  runMigrations,
  TARGET_VERSION,
} from './schema';
import { checkDbSourceIsolation } from './invariants';
import { appendEvent, insertAnimal } from './store';
import { RECALL, freshDb } from './fixtures';

const dbSource = (): string =>
  readFileSync(path.join(__dirname, '..', 'db.ts'), 'utf8');

// ---------------------------------------------------------------------------
// The migration runner
// ---------------------------------------------------------------------------

test('a fresh database migrates to the target version', () => {
  const db = new Database(':memory:');
  const result = applyRegistrySchema(db);
  assert.equal(result.from, 0, 'a fresh database starts at user_version 0');
  assert.equal(result.to, TARGET_VERSION);
  assert.equal(result.applied, MIGRATIONS.length);
  assert.equal(db.pragma('user_version', { simple: true }), TARGET_VERSION);
  db.close();
});

test('the runner is idempotent -- a second call applies nothing', () => {
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  const again = runMigrations(db);
  assert.equal(again.applied, 0, 'no migration re-runs');
  assert.equal(again.from, TARGET_VERSION);
  assert.equal(again.to, TARGET_VERSION);
  db.close();
});

test('every registry table exists after migration, and nothing else was created', () => {
  const db = freshDb();
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name);
  for (const t of REGISTRY_TABLES) {
    assert.ok(tables.includes(t), `${t} was created`);
  }
  // The registry migration must not create a demo or farm table as a side
  // effect -- it shares a database with them in production.
  for (const t of ['animals', 'milkings', 'farm_events', 'vendors', 'deliveries']) {
    assert.ok(!tables.includes(t), `${t} is NOT created by the registry migration`);
  }
  db.close();
});

test('a migration failure leaves the version at the last good one', () => {
  // Exercises the runner's atomicity contract directly, with a deliberately
  // broken migration list rather than by corrupting the real one.
  const db = new Database(':memory:');
  applyRegistryPragmas(db);
  const good = (d: typeof db) => d.exec('CREATE TABLE m1 (id TEXT)');
  const bad = () => {
    throw new Error('migration 2 is broken');
  };
  let threw: Error | null = null;
  try {
    for (const [i, m] of [good, bad].entries()) {
      db.transaction(() => {
        (m as (d: typeof db) => void)(db);
        db.exec(`PRAGMA user_version = ${i + 1}`);
      })();
    }
  } catch (e) {
    threw = e as Error;
  }
  assert.match(threw?.message ?? '', /migration 2 is broken/);
  assert.equal(
    db.pragma('user_version', { simple: true }),
    1,
    'the version stopped at the last successfully applied migration',
  );
  assert.ok(
    db.prepare(`SELECT name FROM sqlite_master WHERE name='m1'`).get(),
    'migration 1 survived',
  );
  db.close();
});

test('the runner refuses to touch a schema newer than it knows about', () => {
  const db = new Database(':memory:');
  db.exec(`PRAGMA user_version = ${MIGRATIONS.length + 5}`);
  assert.throws(() => runMigrations(db), /newer than this build knows about/);
  db.close();
});

test('applying the registry schema is order-independent with FARM_SCHEMA', () => {
  // The production concern: db.ts applies FARM_SCHEMA then the registry. This
  // asserts the reverse order converges identically, so the two are genuinely
  // independent rather than accidentally working in one arrangement.
  const FARM = `CREATE TABLE IF NOT EXISTS farm_events (id TEXT PRIMARY KEY, x TEXT);
                CREATE INDEX IF NOT EXISTS idx_fe ON farm_events(x);`;
  const names = (db: ReturnType<typeof freshDb>): string =>
    (
      db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .join(',');

  const farmFirst = new Database(':memory:');
  farmFirst.exec(FARM);
  applyRegistrySchema(farmFirst);

  const registryFirst = new Database(':memory:');
  applyRegistrySchema(registryFirst);
  registryFirst.exec(FARM);

  assert.equal(names(farmFirst), names(registryFirst), 'same tables either way');
  assert.equal(
    farmFirst.pragma('user_version', { simple: true }),
    registryFirst.pragma('user_version', { simple: true }),
    'same user_version either way',
  );
  farmFirst.close();
  registryFirst.close();
});

// ---------------------------------------------------------------------------
// Append-only enforcement
// ---------------------------------------------------------------------------

function seedOneEvent(db: ReturnType<typeof freshDb>): string {
  insertAnimal(db, {
    id: 'BD-0001',
    sex: 'female',
    species: 'buffalo',
    origin: 'acquired',
  });
  return appendEvent(db, {
    animal_id: 'BD-0001',
    type: 'note',
    occurred_on: '2026-01-01',
    date_precision: 'day',
    payload: { text: 'original' },
    provenance: RECALL,
    recorded_at: '2026-01-01T00:00:00.000Z',
  }).id;
}

test('UPDATE on the event log is rejected by trigger', () => {
  const db = freshDb();
  const id = seedOneEvent(db);
  assert.throws(
    () => db.prepare(`UPDATE registry_animal_events SET payload = ? WHERE id = ?`).run('{}', id),
    /append-only/,
  );
  db.close();
});

test('DELETE on the event log is rejected by trigger', () => {
  const db = freshDb();
  const id = seedOneEvent(db);
  assert.throws(
    () => db.prepare(`DELETE FROM registry_animal_events WHERE id = ?`).run(id),
    /append-only/,
  );
  db.close();
});

test('INSERT OR REPLACE is rejected -- the pragma the triggers depend on is set', () => {
  // THE REASON applyRegistryPragmas() EXISTS. SQLite skips the DELETE trigger
  // for the implicit delete inside INSERT OR REPLACE unless recursive_triggers
  // is ON, so without the pragma this statement silently overwrites the row and
  // the append-only guarantee is one keyword away from being false. Measured,
  // not assumed -- see the negative control below.
  const db = freshDb();
  const id = seedOneEvent(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT OR REPLACE INTO registry_animal_events
             (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
              source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
           VALUES (?, 'BD-0001', 'note', '2026-01-01', NULL, 'day', '{"text":"overwritten"}',
                   'recall', NULL, NULL, 'x', '2026-01-01T00:00:00.000Z', NULL)`,
        )
        .run(id),
    /append-only/,
  );
  const row = db
    .prepare(`SELECT payload FROM registry_animal_events WHERE id = ?`)
    .get(id) as { payload: string };
  assert.match(row.payload, /original/, 'the original row is intact');
  db.close();
});

test('recursive_triggers is what makes that hold (negative control)', () => {
  // Proves the pragma is load-bearing rather than decorative: with it off, the
  // same statement succeeds and the row is silently replaced. If a future
  // refactor drops applyRegistryPragmas(), the test above starts failing and
  // this one explains why.
  const db = freshDb();
  const id = seedOneEvent(db);
  db.pragma('recursive_triggers = OFF');
  db.prepare(
    `INSERT OR REPLACE INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES (?, 'BD-0001', 'note', '2026-01-01', NULL, 'day', '{"text":"overwritten"}',
             'recall', NULL, NULL, 'x', '2026-01-01T00:00:00.000Z', NULL)`,
  ).run(id);
  const row = db
    .prepare(`SELECT payload FROM registry_animal_events WHERE id = ?`)
    .get(id) as { payload: string };
  assert.match(
    row.payload,
    /overwritten/,
    'without recursive_triggers the append-only triggers do not cover INSERT OR REPLACE',
  );
  db.close();
});

test('applyRegistrySchema sets both pragmas the guarantees depend on', () => {
  const db = freshDb();
  assert.equal(db.pragma('recursive_triggers', { simple: true }), 1);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  db.close();
});

// ---------------------------------------------------------------------------
// Schema CHECK constraints
// ---------------------------------------------------------------------------

function rawInsert(
  db: ReturnType<typeof freshDb>,
  over: Partial<Record<string, unknown>>,
): void {
  insertAnimal(db, {
    id: 'BD-0001',
    sex: 'female',
    species: 'buffalo',
    origin: 'acquired',
  });
  const row = {
    id: 'aevt_x',
    animal_id: 'BD-0001',
    type: 'note',
    occurred_on: '2026-01-01',
    occurred_time: null,
    date_precision: 'day',
    payload: '{"text":"t"}',
    source_form: 'recall',
    source_ref: null,
    observed_by: null,
    recorded_by: 'x',
    recorded_at: '2026-01-01T00:00:00.000Z',
    supersedes_id: null,
    ...over,
  };
  db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES
       (@id, @animal_id, @type, @occurred_on, @occurred_time, @date_precision, @payload,
        @source_form, @source_ref, @observed_by, @recorded_by, @recorded_at, @supersedes_id)`,
  ).run(row);
}

test('date_precision has NO default -- an omitted value is rejected', () => {
  const db = freshDb();
  insertAnimal(db, { id: 'BD-0001', sex: 'female', species: 'buffalo', origin: 'acquired' });
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO registry_animal_events
             (id, animal_id, type, occurred_on, payload, source_form, recorded_by, recorded_at)
           VALUES ('aevt_x','BD-0001','note','2026-01-01','{"text":"t"}','recall','x','2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    /NOT NULL constraint failed: registry_animal_events.date_precision/,
    'no default means the column cannot be silently filled with "day"',
  );
  db.close();
});

test('occurred_time is rejected at non-day precision (CHECK, not just the helper)', () => {
  const db = freshDb();
  assert.throws(
    () => rawInsert(db, { occurred_time: '05:30', date_precision: 'month', occurred_on: '2026-01-01' }),
    /CHECK constraint failed: time_only_at_day_precision/,
  );
  db.close();
});

test('month precision must be dated the 1st (CHECK)', () => {
  const db = freshDb();
  assert.throws(
    () => rawInsert(db, { date_precision: 'month', occurred_on: '2026-03-14' }),
    /CHECK constraint failed: month_precision_dated_first/,
  );
  db.close();
});

test('year precision must be dated January 1 (CHECK)', () => {
  const db = freshDb();
  assert.throws(
    () => rawInsert(db, { date_precision: 'year', occurred_on: '2026-03-01' }),
    /CHECK constraint failed: year_precision_dated_jan_first/,
  );
  db.close();
});

test('recorded_by and recorded_at are NOT NULL', () => {
  const db = freshDb();
  assert.throws(() => rawInsert(db, { recorded_by: null }), /NOT NULL.*recorded_by/);
  db.close();
  const db2 = freshDb();
  assert.throws(() => rawInsert(db2, { recorded_at: null }), /NOT NULL.*recorded_at/);
  db2.close();
});

test('the partial unique index stops two events superseding the same one', () => {
  const db = freshDb();
  const original = seedOneEvent(db);
  const mk = (id: string) =>
    appendEvent(db, {
      id,
      animal_id: 'BD-0001',
      type: 'note',
      occurred_on: '2026-01-02',
      date_precision: 'day',
      payload: { text: 'correction' },
      provenance: RECALL,
      recorded_at: '2026-01-02T00:00:00.000Z',
      supersedes_id: original,
    });
  mk('aevt_c1');
  assert.throws(() => mk('aevt_c2'), /UNIQUE constraint failed/);
  db.close();
});

test('many events may have supersedes_id NULL -- the index is partial', () => {
  const db = freshDb();
  insertAnimal(db, { id: 'BD-0001', sex: 'female', species: 'buffalo', origin: 'acquired' });
  for (let i = 0; i < 5; i++) {
    appendEvent(db, {
      animal_id: 'BD-0001',
      type: 'note',
      occurred_on: '2026-01-01',
      date_precision: 'day',
      payload: { text: `n${i}` },
      provenance: RECALL,
      recorded_at: `2026-01-01T00:0${i}:00.000Z`,
    });
  }
  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM registry_animal_events`)
    .get() as { n: number };
  assert.equal(n.n, 5);
  db.close();
});

test('an event cannot supersede itself', () => {
  const db = freshDb();
  // rawInsert() creates the animal itself -- do not also insert it here.
  assert.throws(
    () => rawInsert(db, { id: 'aevt_self', supersedes_id: 'aevt_self' }),
    /CHECK constraint failed: no_self_supersede/,
  );
  db.close();
});

test('a second serial counter row cannot exist', () => {
  const db = freshDb();
  assert.throws(
    () => db.prepare(`INSERT INTO registry_serial_counter (id, next_serial) VALUES (2, 1)`).run(),
    /CHECK constraint failed/,
  );
  db.close();
});

// ---------------------------------------------------------------------------
// Invariant 13 -- the demo/registry isolation guard
// ---------------------------------------------------------------------------

test('invariant 13: resetSchema() drops no registry table, and SCHEMA defines none', () => {
  // THE FAILURE THIS GUARDS: seed() calls resetSchema(), and the regression
  // suite calls seed() in beforeEach. A registry table in either the DROP list
  // or the SCHEMA const would be destroyed on every seed -- taking real,
  // unrecoverable animal records with it.
  const violations = checkDbSourceIsolation(dbSource());
  assert.deepEqual(
    violations,
    [],
    violations.map((v) => `[${v.invariant}] ${v.detail}`).join('\n'),
  );
});

test('invariant 13 fires when a registry table is added to the DROP list', () => {
  // The guard must be able to fail, or it proves nothing. Corrupt a copy of the
  // source rather than the file.
  const corrupted = dbSource().replace(
    'DROP TABLE IF EXISTS animals;',
    'DROP TABLE IF EXISTS animals;\n    DROP TABLE IF EXISTS registry_animals;',
  );
  const violations = checkDbSourceIsolation(corrupted);
  assert.ok(violations.length > 0, 'the guard detects a registry table in the DROP list');
  assert.equal(violations[0].invariant, 13);
  assert.match(violations[0].detail, /registry_animals/);
});

test('invariant 13 fires when a registry table is added to the SCHEMA const', () => {
  const src = dbSource();
  const corrupted = src.replace(
    'CREATE TABLE animals (',
    'CREATE TABLE registry_animals (id TEXT PRIMARY KEY);\nCREATE TABLE animals (',
  );
  const violations = checkDbSourceIsolation(corrupted);
  assert.ok(violations.length > 0, 'the guard detects a registry table in SCHEMA');
  assert.match(violations.map((v) => v.detail).join(' '), /SCHEMA const defines/);
});

test('invariant 13 fails loudly if it can no longer find what it inspects', () => {
  // A guard that silently stops checking is worse than one that fails.
  const violations = checkDbSourceIsolation('export const nothing = 1;');
  assert.ok(violations.length >= 2, 'both matchers report their own failure');
  assert.match(violations.map((v) => v.detail).join(' '), /could not locate/);
});

test('db.ts still applies FARM_SCHEMA at module load, unchanged', () => {
  // The registry addition must not have disturbed the farm path. Asserted on
  // source text so it needs no database.
  assert.match(dbSource(), /^db\.exec\(FARM_SCHEMA\);$/m);
  assert.match(dbSource(), /^applyRegistrySchema\(db\);$/m);
});

// ---------------------------------------------------------------------------
// The pragma boot assertion (follow-up 4)
// ---------------------------------------------------------------------------

test('assertRegistryPragmas passes on a handle built by applyRegistrySchema', () => {
  const db = freshDb();
  assert.doesNotThrow(() => assertRegistryPragmas(db));
  db.close();
});

test('assertRegistryPragmas FAILS when recursive_triggers is off', () => {
  // The guarantee travels with the CONNECTION, not the database file, so the
  // only defence is reading the pragma back. Setting it and never checking is
  // how a handle that lost it becomes invisible.
  const db = freshDb();
  db.pragma('recursive_triggers = OFF');
  assert.throws(
    () => assertRegistryPragmas(db),
    /PRAGMA recursive_triggers is 0, expected 1/,
  );
  // And the message must say what breaks, not just that a number is wrong.
  assert.throws(() => assertRegistryPragmas(db), /silently\s+overwrites a row/);
  assert.throws(() => assertRegistryPragmas(db), /PER-CONNECTION/);
  db.close();
});

test('assertRegistryPragmas FAILS when foreign_keys is off', () => {
  const db = freshDb();
  db.pragma('foreign_keys = OFF');
  assert.throws(() => assertRegistryPragmas(db), /PRAGMA foreign_keys is 0, expected 1/);
  db.close();
});

test('a bare handle -- the sqlite3-CLI case -- fails the assertion', () => {
  // What any script that calls `new Database()` directly gets: better-sqlite3
  // defaults foreign_keys ON but recursive_triggers OFF, so the append-only
  // guarantee is absent and the assertion is what says so.
  const bare = new Database(':memory:');
  assert.equal(bare.pragma('recursive_triggers', { simple: true }), 0);
  assert.throws(() => assertRegistryPragmas(bare), /recursive_triggers/);
  bare.close();
});

test('applyRegistrySchema asserts, so a broken boot throws at import time', () => {
  // Guards the wiring: if applyRegistrySchema ever stops calling the assertion,
  // db.ts would happily boot on a connection without the guarantee.
  const src = readFileSync(path.join(__dirname, 'schema.ts'), 'utf8');
  const body = /export function applyRegistrySchema[\s\S]*?\n}/.exec(src);
  assert.ok(body, 'located applyRegistrySchema');
  assert.match(body![0], /applyRegistryPragmas\(db\)/);
  assert.match(body![0], /assertRegistryPragmas\(db\)/);
});
