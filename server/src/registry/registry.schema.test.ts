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
  assert.match(dbSource(), /^applyRegistrySchema\(db,/m);
});

test('db.ts wires the pre-migration backup hook', () => {
  // The hook is INJECTED, not imported by schema.ts, which means nothing inside
  // the migration runner can enforce that it is present -- db.ts is the only
  // place it exists, and dropping the option silently returns the system to
  // migrating irreplaceable records with no snapshot. That is precisely the
  // "guard that silently stops checking" this file already refuses to allow.
  assert.match(dbSource(), /beforeMigrate:.*preMigrationBackup/s);
  assert.match(dbSource(), /from '\.\/registry\/backup'/);
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

// ---------------------------------------------------------------------------
// Migration 2 -- `estimated` stores January 1, and the table rebuild that
// adding a CHECK to an existing table requires
// ---------------------------------------------------------------------------

/** A database at schema version 1, for testing the v1 -> v2 upgrade. */
function dbAtVersion1(): ReturnType<typeof freshDb> {
  const db = new Database(':memory:');
  applyRegistryPragmas(db);
  db.transaction(() => {
    MIGRATIONS[0].up(db);
    db.exec('PRAGMA user_version = 1');
  })();
  return db;
}

test('a fresh database lands on the current target version, now 8', () => {
  // The literal is deliberate and this test is meant to fail when a migration is
  // added: it forces whoever adds one to state the new number here rather than
  // letting TARGET_VERSION verify itself against itself.
  const db = freshDb();
  assert.equal(db.pragma('user_version', { simple: true }), TARGET_VERSION);
  assert.equal(TARGET_VERSION, 8);
  db.close();
});

test('migrations 2 through 8 upgrade a v1 database and PRESERVE its rows', () => {
  // The rebuild is create-copy-drop-rename. The copy is the part that would
  // silently lose data if it were wrong, so it is tested with data present --
  // even though the real database was empty when this shipped.
  const db = dbAtVersion1();
  db.prepare(
    `INSERT INTO registry_animals (id,name,sex,species,origin,post_no,tag_no)
     VALUES ('BD-0001','Noor','female','buffalo','acquired',NULL,NULL)`,
  ).run();
  const ins = db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES (@id,'BD-0001',@type,@on,NULL,@p,'{}','recall',NULL,NULL,'x',@at,@sup)`,
  );
  ins.run({ id: 'aevt_1', type: 'acquired', on: '2019-01-01', p: 'year', at: 't1', sup: null });
  ins.run({ id: 'aevt_2', type: 'note', on: '2020-03-14', p: 'day', at: 't2', sup: null });
  // A superseding row, so the self-referencing FK is exercised by the copy.
  ins.run({ id: 'aevt_3', type: 'note', on: '2020-03-15', p: 'day', at: 't3', sup: 'aevt_2' });

  const result = runMigrations(db);
  assert.equal(result.from, 1);
  assert.equal(result.to, 8);
  assert.equal(
    result.applied,
    7,
    'the estimated-convention rebuild, the milking table, the override columns, ' +
      'the four sales tables, the six labour tables AND the staff-destination rebuild',
  );

  const rows = db
    .prepare(`SELECT id, supersedes_id FROM registry_animal_events ORDER BY id`)
    .all() as { id: string; supersedes_id: string | null }[];
  assert.deepEqual(rows, [
    { id: 'aevt_1', supersedes_id: null },
    { id: 'aevt_2', supersedes_id: null },
    { id: 'aevt_3', supersedes_id: 'aevt_2' },
  ]);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) n FROM registry_animals`).get() as { n: number }).n,
    1,
  );
  // Migration 3 rode along on the same run and created its table.
  assert.equal(
    (db.prepare(`SELECT COUNT(*) n FROM registry_milkings`).get() as { n: number }).n,
    0,
  );
  db.close();
});

// ---------------------------------------------------------------------------
// Migration 4 -- the override moves from the payload to two columns
// ---------------------------------------------------------------------------

/** A database at schema version 3, for testing the v3 -> v4 upgrade. */
function dbAtVersion3(): ReturnType<typeof freshDb> {
  const db = new Database(':memory:');
  applyRegistryPragmas(db);
  db.transaction(() => {
    MIGRATIONS[0].up(db);
    MIGRATIONS[1].up(db);
    MIGRATIONS[2].up(db);
    db.exec('PRAGMA user_version = 3');
  })();
  return db;
}

test('migration 4 MOVES a payload override into the columns, and out of the payload', () => {
  // The copy is the part that would silently lose data if it were wrong, so it
  // runs with data present -- and unlike migration 2 this one REWRITES every
  // payload, which is a strictly larger blast radius than copying one across.
  const db = dbAtVersion3();
  db.prepare(
    `INSERT INTO registry_animals (id,name,sex,species,origin,post_no,tag_no)
     VALUES ('BD-0001','Noor','female','buffalo','acquired',NULL,NULL)`,
  ).run();
  const ins = db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES (@id,'BD-0001',@type,@on,NULL,'day',@payload,'recall',NULL,NULL,'x',@at,@sup)`,
  );
  // An override WITH a reason, one WITHOUT (the flag is the load-bearing part),
  // the explicit `override: null` that every untripped write stored, and a row
  // that never had the key at all.
  ins.run({
    id: 'aevt_1',
    type: 'dry_off',
    on: '2024-01-01',
    at: 't1',
    sup: null,
    payload: JSON.stringify({
      notes: null,
      override: { check: 'animal_departed', reason: 'stayed on until August' },
      reason: null,
    }),
  });
  ins.run({
    id: 'aevt_2',
    type: 'dry_off',
    on: '2024-01-02',
    at: 't2',
    sup: null,
    payload: JSON.stringify({ notes: null, override: { check: 'animal_departed' }, reason: null }),
  });
  ins.run({
    id: 'aevt_3',
    type: 'dry_off',
    on: '2024-01-03',
    at: 't3',
    sup: null,
    payload: JSON.stringify({ notes: null, override: null, reason: 'scheduled' }),
  });
  // Superseding, so the self-referencing FK is exercised by this copy too.
  ins.run({
    id: 'aevt_4',
    type: 'note',
    on: '2024-01-04',
    at: 't4',
    sup: 'aevt_3',
    payload: JSON.stringify({ text: 'hello' }),
  });

  const result = runMigrations(db);
  assert.equal(result.from, 3);
  assert.equal(result.to, 8);
  assert.equal(
    result.applied,
    5,
    'the override rebuild, the sales tables, the labour tables and the staff rebuild',
  );

  const rows = db
    .prepare(
      `SELECT id, payload, override_check, override_reason, supersedes_id
         FROM registry_animal_events ORDER BY id`,
    )
    .all() as {
    id: string;
    payload: string;
    override_check: string | null;
    override_reason: string | null;
    supersedes_id: string | null;
  }[];

  assert.deepEqual(rows, [
    {
      id: 'aevt_1',
      payload: '{"notes":null,"reason":null}',
      override_check: 'animal_departed',
      override_reason: 'stayed on until August',
      supersedes_id: null,
    },
    {
      id: 'aevt_2',
      payload: '{"notes":null,"reason":null}',
      override_check: 'animal_departed',
      override_reason: null,
      supersedes_id: null,
    },
    {
      id: 'aevt_3',
      payload: '{"notes":null,"reason":"scheduled"}',
      override_check: null,
      override_reason: null,
      supersedes_id: null,
    },
    {
      id: 'aevt_4',
      payload: '{"text":"hello"}',
      override_check: null,
      override_reason: null,
      supersedes_id: 'aevt_3',
    },
  ]);
  db.close();
});

test('migration 4 rewrites payloads with SORTED keys, like the writer does', () => {
  // The rebuild-diff compares stored payload TEXT, so a payload rewritten in a
  // different key order than appendEvent would produce reads as a change that
  // is not one. This is why the copy is JavaScript and not json_remove().
  const db = dbAtVersion3();
  db.prepare(
    `INSERT INTO registry_animals (id,name,sex,species,origin,post_no,tag_no)
     VALUES ('BD-0001',NULL,'female','buffalo','acquired',NULL,NULL)`,
  ).run();
  db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
        source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
     VALUES ('aevt_1','BD-0001','departure','2024-01-01',NULL,'day',@payload,
             'recall',NULL,NULL,'x','t1',NULL)`,
  ).run({
    // Deliberately unsorted on the way in.
    payload: JSON.stringify({
      to: 'market',
      reason: 'sold',
      override: { check: 'animal_departed', reason: 'why' },
      cause: null,
      notes: null,
    }),
  });

  runMigrations(db);

  const { payload } = db
    .prepare(`SELECT payload FROM registry_animal_events WHERE id='aevt_1'`)
    .get() as { payload: string };
  assert.equal(payload, '{"cause":null,"notes":null,"reason":"sold","to":"market"}');
  assert.deepEqual(Object.keys(JSON.parse(payload)), ['cause', 'notes', 'reason', 'to']);
  db.close();
});

test('migration 4 restores the indexes and the append-only triggers too', () => {
  // The SECOND rebuild of this table. Migration 2 proved the recreation once;
  // this asserts migration 4 did not quietly drop half of it, because a lost
  // trigger is the failure that looks exactly like success.
  const db = dbAtVersion3();
  runMigrations(db);

  const objects = (
    db
      .prepare(`SELECT name, type FROM sqlite_master WHERE tbl_name='registry_animal_events'`)
      .all() as { name: string; type: string }[]
  ).map((r) => `${r.type}:${r.name}`);

  for (const expected of [
    'trigger:registry_animal_events_no_update',
    'trigger:registry_animal_events_no_delete',
    'index:idx_registry_events_supersedes',
    'index:idx_registry_events_animal',
    'index:idx_registry_events_type',
  ]) {
    assert.ok(objects.includes(expected), `${expected} survived migration 4`);
  }
  db.close();
});

test('the rebuild restores the indexes and the append-only triggers', () => {
  // DROP TABLE takes indexes and triggers with it. If migration 2 forgot to
  // recreate them, the append-only guarantee would vanish silently -- the worst
  // possible outcome of a migration that looks like it worked.
  const db = dbAtVersion1();
  runMigrations(db);

  const objects = (
    db
      .prepare(`SELECT name, type FROM sqlite_master WHERE tbl_name='registry_animal_events'`)
      .all() as { name: string; type: string }[]
  ).map((r) => `${r.type}:${r.name}`);

  for (const expected of [
    'trigger:registry_animal_events_no_update',
    'trigger:registry_animal_events_no_delete',
    'index:idx_registry_events_supersedes',
    'index:idx_registry_events_animal',
    'index:idx_registry_events_type',
  ]) {
    assert.ok(objects.includes(expected), `${expected} survived the rebuild`);
  }

  insertAnimal(db, { id: 'BD-0001', sex: 'female', species: 'buffalo', origin: 'acquired' });
  const id = appendEvent(db, {
    animal_id: 'BD-0001', type: 'note', occurred_on: '2026-01-01', date_precision: 'day',
    payload: { text: 't' }, provenance: RECALL, recorded_at: '2026-01-01T00:00:00.000Z',
  }).id;
  assert.throws(
    () => db.prepare(`UPDATE registry_animal_events SET payload='{}' WHERE id=?`).run(id),
    /append-only/,
    'the update trigger works after the rebuild',
  );
  assert.throws(
    () => db.prepare(`DELETE FROM registry_animal_events WHERE id=?`).run(id),
    /append-only/,
    'the delete trigger works after the rebuild',
  );
  db.close();
});

test('foreign keys are enforced again after the rebuild ran with them off', () => {
  // The rebuild needs foreign_keys OFF, which is the one relaxation in the whole
  // schema. If it were not restored, every write afterwards would run unchecked.
  const db = dbAtVersion1();
  runMigrations(db);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO registry_animal_events
             (id, animal_id, type, occurred_on, occurred_time, date_precision, payload,
              source_form, source_ref, observed_by, recorded_by, recorded_at, supersedes_id)
           VALUES ('aevt_x','BD-NOPE','note','2026-01-01',NULL,'day','{}','recall',NULL,NULL,'x','t',NULL)`,
        )
        .run(),
    /FOREIGN KEY constraint failed/,
  );
  db.close();
});

test('applyRegistrySchema re-asserts the pragmas after migrating', () => {
  // A rebuildsTables migration toggles foreign_keys. The second assertion is
  // what catches one that failed to restore it.
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  assertRegistryPragmas(db);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.equal(db.pragma('recursive_triggers', { simple: true }), 1);
  db.close();
});

test('estimated precision must be dated January 1 (CHECK)', () => {
  const db = freshDb();
  assert.throws(
    () => rawInsert(db, { date_precision: 'estimated', occurred_on: '2021-04-12' }),
    /CHECK constraint failed: estimated_precision_dated_jan_first/,
    'a fabricated day wearing a humility label is rejected at the database',
  );
  db.close();
});

test('estimated precision dated January 1 is accepted', () => {
  const db = freshDb();
  assert.doesNotThrow(() =>
    rawInsert(db, { date_precision: 'estimated', occurred_on: '2021-01-01' }),
  );
  db.close();
});

test('estimated is rejected mid-year even in a month-like position', () => {
  const db = freshDb();
  assert.throws(
    () => rawInsert(db, { date_precision: 'estimated', occurred_on: '2021-06-01' }),
    /estimated_precision_dated_jan_first/,
  );
  db.close();
});

test('the other three precisions are unaffected by migration 2', () => {
  for (const [precision, on] of [
    ['day', '2021-04-12'],
    ['month', '2021-04-01'],
    ['year', '2021-01-01'],
  ] as const) {
    const db = freshDb();
    assert.doesNotThrow(
      () => rawInsert(db, { date_precision: precision, occurred_on: on }),
      `${precision} ${on} is still accepted`,
    );
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Migration 6 -- people, engagements, packages and the wage ledger
// (docs/REGISTRY_PAYROLL.md §9)
// ---------------------------------------------------------------------------

/** A person, an engagement and a term, so the child tables have parents. */
function labourFixture(db: ReturnType<typeof freshDb>): void {
  db.prepare(
    `INSERT INTO registry_people (id,identifier,recorded_by,recorded_at)
     VALUES ('per_1','imran','adnan','t')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_engagements (id,person_id,kind,started_on,recorded_by,recorded_at)
     VALUES ('eng_1','per_1','permanent','2024-01-01','adnan','t')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_pay_terms
       (id,engagement_id,effective_from,cash_minor,cash_period,recorded_by,recorded_at)
     VALUES ('trm_1','eng_1','2024-01-01',2500000,'month','adnan','t')`,
  ).run();
}

const insPerson = (db: ReturnType<typeof freshDb>, id: string, identifier: string) =>
  db
    .prepare(
      `INSERT INTO registry_people (id,identifier,recorded_by,recorded_at)
       VALUES (?,?,'adnan','t')`,
    )
    .run(id, identifier);

test('a person identifier is unique CASE-INSENSITIVELY', () => {
  // The whole reason registry_people exists is that free text produced `abdul`,
  // `Abdul` and `abdul_r`. History still holds all three; this table must not.
  const db = freshDb();
  insPerson(db, 'per_1', 'abdul');
  assert.throws(() => insPerson(db, 'per_2', 'Abdul'), /UNIQUE/);
  assert.throws(() => insPerson(db, 'per_3', 'ABDUL'), /UNIQUE/);
  assert.doesNotThrow(() => insPerson(db, 'per_4', 'abdul_r'));
  db.close();
});

test('a person identifier cannot be blank or whitespace', () => {
  const db = freshDb();
  assert.throws(() => insPerson(db, 'per_1', '   '), /a_person_has_an_identifier/);
  db.close();
});

test('a person may hold TWO OVERLAPPING engagements -- the flexibility is deliberate', () => {
  // People leave and come back, and somebody can be milker and night watchman at
  // once. Invariant 8's one-open-lactation rule is deliberately NOT copied here;
  // overlap is a /check report line. If this test ever starts failing, someone
  // has added a constraint the farm explicitly asked not to have.
  const db = freshDb();
  insPerson(db, 'per_1', 'imran');
  const ins = db.prepare(
    `INSERT INTO registry_engagements (id,person_id,kind,started_on,ended_on,recorded_by,recorded_at)
     VALUES (?,'per_1',?,?,?,'adnan','t')`,
  );
  assert.doesNotThrow(() => ins.run('eng_1', 'permanent', '2024-01-01', null));
  assert.doesNotThrow(() => ins.run('eng_2', 'daily', '2024-06-01', null));
  assert.doesNotThrow(() => ins.run('eng_3', 'permanent', '2022-01-01', '2023-06-30'));
  assert.equal(
    (db.prepare(`SELECT COUNT(*) n FROM registry_engagements`).get() as { n: number }).n,
    3,
  );
  db.close();
});

test('an engagement range must run forwards', () => {
  const db = freshDb();
  insPerson(db, 'per_1', 'imran');
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO registry_engagements
             (id,person_id,kind,started_on,ended_on,recorded_by,recorded_at)
           VALUES ('eng_1','per_1','daily','2024-06-01','2024-05-01','adnan','t')`,
        )
        .run(),
    /the_range_runs_forwards/,
  );
  db.close();
});

test('a second pay term on the same effective_from is refused', () => {
  // Not a raise -- a typo, and which one won would be silent.
  const db = freshDb();
  labourFixture(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO registry_pay_terms
             (id,engagement_id,effective_from,cash_minor,cash_period,recorded_by,recorded_at)
           VALUES ('trm_2','eng_1','2024-01-01',2600000,'month','adnan','t')`,
        )
        .run(),
    /UNIQUE/,
  );
  db.close();
});

test('a term with zero cash is legal -- a package may be entirely in kind', () => {
  const db = freshDb();
  labourFixture(db);
  assert.doesNotThrow(() =>
    db
      .prepare(
        `INSERT INTO registry_pay_terms
           (id,engagement_id,effective_from,cash_minor,cash_period,recorded_by,recorded_at)
         VALUES ('trm_2','eng_1','2025-01-01',0,'month','adnan','t')`,
      )
      .run(),
  );
  db.close();
});

test('benefit quantity, unit and period stand or fall together', () => {
  const db = freshDb();
  labourFixture(db);
  const ins = db.prepare(
    `INSERT INTO registry_pay_benefits (id,term_id,kind,quantity,unit,period,note)
     VALUES (?,'trm_1',?,?,?,?,?)`,
  );
  // Accommodation is the case with none of the three, and it must pass.
  assert.doesNotThrow(() => ins.run('ben_1', 'accommodation', null, null, null, null));
  assert.doesNotThrow(() => ins.run('ben_2', 'milk', 2, 'L', 'day', null));
  assert.doesNotThrow(() => ins.run('ben_3', 'flour', 20, 'kg', 'month', null));
  assert.throws(
    () => ins.run('ben_4', 'flour', 20, null, 'month', null),
    /a_quantity_has_a_unit/,
    'a figure without its unit is not a quantity',
  );
  assert.throws(
    () => ins.run('ben_5', 'flour', 20, 'kg', null, null),
    /a_quantity_has_a_period/,
  );
  assert.throws(() => ins.run('ben_6', 'milk', 0, 'L', 'day', null), /quantity_is_positive/);
  db.close();
});

test("benefit kind 'other' must say what it is", () => {
  const db = freshDb();
  labourFixture(db);
  const ins = db.prepare(
    `INSERT INTO registry_pay_benefits (id,term_id,kind,note) VALUES (?,'trm_1','other',?)`,
  );
  assert.throws(() => ins.run('ben_1', null), /other_says_what_it_is/);
  assert.throws(() => ins.run('ben_2', '   '), /other_says_what_it_is/);
  assert.doesNotThrow(() => ins.run('ben_3', 'electricity for the quarters'));
  db.close();
});

test("'utilities' is NOT a benefit kind -- it was removed rather than carried unused", () => {
  // The farm's list is milk, flour and accommodation. A value nobody files
  // anything under is the farm_events.is_synthetic failure in miniature.
  const db = freshDb();
  labourFixture(db);
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO registry_pay_benefits (id,term_id,kind) VALUES ('ben_1','trm_1','utilities')`,
        )
        .run(),
    /CHECK constraint failed/,
  );
  db.close();
});

const insWagePeriod = (db: ReturnType<typeof freshDb>) =>
  db.prepare(
    `INSERT INTO registry_wage_periods
       (id,engagement_id,kind,from_on,to_on,amount_minor,recorded_by,recorded_at,source_form)
     VALUES (?,?,?,?,?,?,'adnan','t','direct_entry')`,
  );

test('one wage-period table serves a salaried month and a single dihari day', () => {
  // The claim that registry_wage_periods needs no branch for the two kinds of
  // engagement, exercised rather than asserted.
  const db = freshDb();
  labourFixture(db);
  db.prepare(
    `INSERT INTO registry_engagements (id,person_id,kind,started_on,recorded_by,recorded_at)
     VALUES ('eng_2','per_1','daily','2026-01-01','adnan','t')`,
  ).run();
  const ins = insWagePeriod(db);
  assert.doesNotThrow(() =>
    ins.run('wag_1', 'eng_1', 'wage', '2026-09-01', '2026-09-30', 2500000),
  );
  assert.doesNotThrow(() =>
    ins.run('wag_2', 'eng_2', 'wage', '2026-09-14', '2026-09-14', 120000),
  );
  db.close();
});

test('a bonus is one day, and a wage period may not run backwards', () => {
  const db = freshDb();
  labourFixture(db);
  const ins = insWagePeriod(db);
  assert.doesNotThrow(() =>
    ins.run('wag_1', 'eng_1', 'bonus', '2026-09-20', '2026-09-20', 500000),
  );
  assert.throws(
    () => ins.run('wag_2', 'eng_1', 'bonus', '2026-10-01', '2026-10-31', 500000),
    /a_bonus_is_one_day/,
  );
  assert.throws(
    () => ins.run('wag_3', 'eng_1', 'wage', '2026-11-30', '2026-11-01', 100),
    /the_range_runs_forwards/,
  );
  db.close();
});

test('two wage periods with the same start are refused; OVERLAPPING ones are not', () => {
  // The exact limit of what a CHECK can defend, and the reason invariant 24
  // exists. If SQLite ever grew a cross-row constraint this test is where the
  // second half moves out of the invariant and into the schema.
  const db = freshDb();
  labourFixture(db);
  const ins = insWagePeriod(db);
  ins.run('wag_1', 'eng_1', 'wage', '2026-09-01', '2026-09-30', 2500000);
  assert.throws(
    () => ins.run('wag_2', 'eng_1', 'wage', '2026-09-01', '2026-09-15', 100),
    /UNIQUE/,
  );
  assert.doesNotThrow(
    () => ins.run('wag_3', 'eng_1', 'wage', '2026-09-15', '2026-10-15', 100),
    'overlap is invariant 24, NOT a constraint -- a CHECK cannot see another row',
  );
  db.close();
});

test('only an adjustment wage payment may be signed, and it must explain itself', () => {
  const db = freshDb();
  labourFixture(db);
  const ins = db.prepare(
    `INSERT INTO registry_wage_payments
       (id,person_id,occurred_on,amount_minor,method,recorded_by,recorded_at,note)
     VALUES (?,'per_1','2026-09-30',?,?,'adnan','t',?)`,
  );
  assert.throws(() => ins.run('wpy_1', -100, 'cash', null), /cash_and_bank_are_positive/);
  assert.throws(() => ins.run('wpy_2', 0, 'bank', null), /cash_and_bank_are_positive/);
  assert.throws(() => ins.run('wpy_3', -5000, 'adjustment', null), /an_adjustment_explains_itself/);
  assert.throws(() => ins.run('wpy_4', 0, 'adjustment', 'nothing'), /an_adjustment_explains_itself/);
  assert.doesNotThrow(() => ins.run('wpy_5', -5000, 'adjustment', 'carried forward from the khata'));
  assert.doesNotThrow(() => ins.run('wpy_6', 800000, 'cash', null));
  db.close();
});

test('an advance is just a payment -- the balance is allowed to go negative', () => {
  // No advance table, no flag, no recovery schedule. The row dated before
  // anything was earned is the whole mechanism.
  const db = freshDb();
  labourFixture(db);
  db.prepare(
    `INSERT INTO registry_wage_payments
       (id,person_id,occurred_on,amount_minor,method,recorded_by,recorded_at)
     VALUES ('wpy_1','per_1','2026-08-20',800000,'cash','adnan','t')`,
  ).run();
  insWagePeriod(db).run('wag_1', 'eng_1', 'wage', '2026-09-01', '2026-09-30', 2500000);
  const earned = (
    db.prepare(`SELECT COALESCE(SUM(amount_minor),0) n FROM registry_wage_periods`).get() as {
      n: number;
    }
  ).n;
  const paid = (
    db.prepare(`SELECT COALESCE(SUM(amount_minor),0) n FROM registry_wage_payments`).get() as {
      n: number;
    }
  ).n;
  assert.equal(earned - paid, 1700000, 'Rs 25,000 earned less an Rs 8,000 advance');
  db.close();
});

// ---------------------------------------------------------------------------
// Migration 7 -- `staff` destinations (docs/REGISTRY_PAYROLL.md §4.6a)
// ---------------------------------------------------------------------------

const insDestination = (db: ReturnType<typeof freshDb>) =>
  db.prepare(
    `INSERT INTO registry_destinations
       (id,name,kind,billable,standing,started_on,recorded_by,recorded_at,person_id)
     VALUES (?,?,?,?,?,'2026-09-01','adnan','t',?)`,
  );

test("migration 7 PRESERVES existing destinations and gives them a null person", () => {
  // The rebuild is create-copy-drop-rename over a table with THREE inbound
  // foreign keys, which is the part that would silently lose data if it were
  // wrong. Run against a database that already holds all four sales tables.
  const db = freshDb();
  db.prepare(
    `INSERT INTO registry_destinations
       (id,name,kind,billable,standing,started_on,recorded_by,recorded_at)
     VALUES ('dst_1','Rashid dodhi','dodhi',1,1,'2026-01-01','adnan','t')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_destination_prices
       (id,destination_id,effective_from,price_minor,price_unit_litres,recorded_by,recorded_at)
     VALUES ('prc_1','dst_1','2026-01-01',700000,40,'adnan','t')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_dispatches
       (id,destination_id,occurred_on,session,status,litres,price_minor,price_unit_litres,
        recorded_by,recorded_at,source_form)
     VALUES ('dsp_1','dst_1','2026-09-01','morning','taken',42,700000,40,'adnan','t','direct_entry')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_payments
       (id,destination_id,occurred_on,amount_minor,method,recorded_by,recorded_at)
     VALUES ('pay_1','dst_1','2026-09-30',735000,'cash','adnan','t')`,
  ).run();

  // freshDb() is already at TARGET_VERSION, so the rebuild has run. Every row
  // and every child must have survived it.
  const row = db
    .prepare(`SELECT kind, billable, person_id FROM registry_destinations WHERE id = 'dst_1'`)
    .get() as { kind: string; billable: number; person_id: string | null };
  assert.deepEqual(row, { kind: 'dodhi', billable: 1, person_id: null });
  for (const [table, n] of [
    ['registry_destination_prices', 1],
    ['registry_dispatches', 1],
    ['registry_payments', 1],
  ] as const) {
    assert.equal(
      (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n,
      n,
      `${table} survived the destinations rebuild`,
    );
  }
  assert.equal((db.pragma('foreign_key_check') as unknown[]).length, 0);
  db.close();
});

test('migration 7 recreates the active index and adds the partial person index', () => {
  // Dropping a table drops its indexes. Without the recreate, the loss would be
  // silent and would only show up as a slow query months later.
  const db = freshDb();
  const names = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='registry_destinations'`)
      .all() as { name: string }[]
  ).map((r) => r.name);
  assert.ok(names.includes('idx_registry_destinations_active'));
  assert.ok(names.includes('idx_registry_destinations_person'));
  db.close();
});

test('a staff destination names a person, and a person named means staff', () => {
  const db = freshDb();
  insPerson(db, 'per_1', 'imran');
  const ins = insDestination(db);
  assert.doesNotThrow(() => ins.run('dst_1', 'Imran milk', 'staff', 0, 1, 'per_1'));
  assert.throws(
    () => ins.run('dst_2', 'Staff milk', 'staff', 0, 1, null),
    /staff_names_a_person/,
    'a shared staff row cannot say whose milk it was, so it is refused',
  );
  assert.throws(
    () => ins.run('dst_3', 'Odd', 'household', 1, 0, 'per_1'),
    /staff_names_a_person/,
  );
  db.close();
});

test('a staff destination can never be billable', () => {
  // Making it billable would give one person two balances -- a buyer balance and
  // a wage balance -- settled separately, when the farm nets it against pay.
  const db = freshDb();
  insPerson(db, 'per_1', 'imran');
  assert.throws(
    () => insDestination(db).run('dst_1', 'Sold to Imran', 'staff', 1, 1, 'per_1'),
    /staff_is_never_billable/,
  );
  db.close();
});

test('one person cannot hold two milk destinations, but many destinations have none', () => {
  // The index is PARTIAL. If it were not, the second dodhi would collide with
  // the first on a NULL and the sales screens would break.
  const db = freshDb();
  insPerson(db, 'per_1', 'imran');
  insPerson(db, 'per_2', 'abdul');
  const ins = insDestination(db);
  ins.run('dst_1', 'Imran milk', 'staff', 0, 1, 'per_1');
  assert.throws(() => ins.run('dst_2', 'Imran again', 'staff', 0, 1, 'per_1'), /UNIQUE/);
  assert.doesNotThrow(() => ins.run('dst_3', 'Abdul milk', 'staff', 0, 1, 'per_2'));
  assert.doesNotThrow(() => ins.run('dst_4', 'Dodhi one', 'dodhi', 1, 1, null));
  assert.doesNotThrow(() => ins.run('dst_5', 'Dodhi two', 'dodhi', 1, 1, null));
  db.close();
});

test('a staff destination must name a person who exists', () => {
  const db = freshDb();
  assert.throws(
    () => insDestination(db).run('dst_1', 'Ghost milk', 'staff', 0, 1, 'per_missing'),
    /FOREIGN KEY/,
  );
  db.close();
});
