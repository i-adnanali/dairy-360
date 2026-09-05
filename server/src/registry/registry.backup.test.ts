// Registry backups -- the snapshot, the text dump, and the pre-migration hook.
//
// Every test here runs against a temp directory and either an `:memory:` handle
// or a temp file. Nothing touches server/dairy.db, and the module-isolation
// test at the bottom is what keeps that true as this file grows.
//
// WHAT IS ACTUALLY WORTH ASSERTING about a backup tool: not that it writes a
// file -- that fails loudly -- but the three things that fail QUIETLY.
//
//   1. The dump round-trips. A dump that loads without error but loses a NUL,
//      a NULL or a REAL is a backup you discover is wrong at restore time.
//   2. The dump is deterministic. Two dumps of unchanged data must be
//      byte-identical, or the diffability the .sql exists for is a fiction.
//   3. The table list is derived. A record table added by a future migration
//      must appear in a backup without anyone remembering to add it.

import assert from 'node:assert';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  SOURCE_OF_TRUTH_TABLES,
  backupPaths,
  dumpRecordTables,
  expandHome,
  irreplaceableRecordCount,
  preMigrationBackup,
  presentRecordTables,
  recordRowCounts,
  runBackup,
  sqlLiteral,
} from './backup';
import {
  REGISTRY_PROJECTION_TABLES,
  REGISTRY_TABLES,
  TARGET_VERSION,
  applyRegistrySchema,
} from './schema';
import type { Db } from './schema';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempDir(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'dairy-backup-'));
}

/** A migrated registry with one animal, one birth event and one milk row --
 * enough to exercise a foreign key, a self-referencing key and a REAL column. */
function seededMemoryDb(): Db {
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  db.prepare(
    `INSERT INTO registry_animals (id, name, sex, species, origin, post_no, tag_no)
     VALUES ('BD-0001', 'Kali', 'female', 'buffalo', 'born_on_farm', '3', 'pk-4412')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_animal_events
       (id, animal_id, type, occurred_on, date_precision, payload, source_form,
        recorded_by, recorded_at)
     VALUES ('ev-1', 'BD-0001', 'birth', '2019-04-02', 'day', '{}',
             'recall', 'adnan', '2026-09-04T10:00:00Z')`,
  ).run();
  db.prepare(
    `INSERT INTO registry_milkings
       (id, animal_id, occurred_on, session, status, yield_litres, recorded_by,
        recorded_at, source_form)
     VALUES ('mk-1', 'BD-0001', '2026-09-03', 'morning', 'measured', 6.25,
             'abdul', '2026-09-03T06:30:00Z', 'daily_herd_sheet')`,
  ).run();
  return db;
}

/** Apply a dump into a freshly migrated database -- the restore path itself. */
function restoreInto(sql: string): Db {
  const db = new Database(':memory:');
  applyRegistrySchema(db);
  db.exec(sql);
  return db;
}

// ---------------------------------------------------------------------------
// The table list
// ---------------------------------------------------------------------------

test('the backed-up tables are exactly the non-projection registry tables', () => {
  const expected = REGISTRY_TABLES.filter(
    (t) => !(REGISTRY_PROJECTION_TABLES as readonly string[]).includes(t),
  );
  assert.deepEqual([...SOURCE_OF_TRUTH_TABLES], [...expected]);

  // Named explicitly as well as derived. The derivation is what keeps the list
  // current; this is what would notice a table being RECLASSIFIED -- moving one
  // into REGISTRY_PROJECTION_TABLES silently drops it from every backup, and
  // that is a decision that should have to edit a test.
  assert.deepEqual(
    [...SOURCE_OF_TRUTH_TABLES].sort(),
    [
      'registry_animal_events',
      'registry_animals',
      'registry_destination_prices',
      'registry_destinations',
      'registry_dispatches',
      'registry_milkings',
      'registry_payments',
      'registry_serial_counter',
    ],
    'a registry table changed classification -- confirm it is genuinely derivable ' +
      'from the event log before accepting this',
  );
});

test('every backed-up table exists in a migrated database', () => {
  const db = seededMemoryDb();
  // recordRowCounts queries each one by name; a typo or a dropped table shows up
  // here rather than at 03:00 in a launchd job.
  const counts = recordRowCounts(db);
  assert.deepEqual(Object.keys(counts).sort(), [...SOURCE_OF_TRUTH_TABLES].sort());
  db.close();
});

// ---------------------------------------------------------------------------
// Literals -- the quiet-failure surface
// ---------------------------------------------------------------------------

test('sqlLiteral encodes the values SQLite can actually hold', () => {
  assert.equal(sqlLiteral(null), 'NULL');
  assert.equal(sqlLiteral(undefined), 'NULL');
  assert.equal(sqlLiteral(42), '42');
  assert.equal(sqlLiteral(6.25), '6.25');
  assert.equal(sqlLiteral(-0.5), '-0.5');
  assert.equal(sqlLiteral(10n), '10');
  assert.equal(sqlLiteral('plain'), "'plain'");
  assert.equal(sqlLiteral("it's"), "'it''s'");
  assert.equal(sqlLiteral(Buffer.from([0xde, 0xad])), "x'dead'");

  // The bug class this repo has shipped twice: a control character written as
  // itself. A NUL inside a quoted literal truncates the statement for most
  // readers, so it goes out as hex instead.
  assert.equal(sqlLiteral('a\u0000b'), "CAST(x'610062' AS TEXT)");
  assert.equal(sqlLiteral('tab\there'), "CAST(x'7461620968657265' AS TEXT)");

  // Neither should ever reach a registry column, but emitting `NaN` would be a
  // syntax error that fails the entire restore rather than one row.
  assert.equal(sqlLiteral(NaN), 'NULL');
  assert.equal(sqlLiteral(Infinity), '9e999');
});

test('a NUL in a stored value survives dump and restore', () => {
  const db = seededMemoryDb();
  // `name` is free text an operator types; a stray control character arriving
  // from a paste is the realistic route in.
  db.prepare(`UPDATE registry_animals SET name = ? WHERE id = 'BD-0001'`).run('Ka\u0000li');

  const restored = restoreInto(dumpRecordTables(db, { source: ':memory:', stamp: 's' }));
  const row = restored
    .prepare(`SELECT name FROM registry_animals WHERE id = 'BD-0001'`)
    .get() as { name: string };
  assert.equal(row.name, 'Ka\u0000li');

  db.close();
  restored.close();
});

// ---------------------------------------------------------------------------
// The dump
// ---------------------------------------------------------------------------

test('a dump round-trips every record table into a migrated database', () => {
  const db = seededMemoryDb();
  const before = recordRowCounts(db);
  const sql = dumpRecordTables(db, { source: ':memory:', stamp: '2026-09-04T120000' });

  const restored = restoreInto(sql);
  assert.deepEqual(recordRowCounts(restored), before);

  // Values, not just counts -- a REAL rendered as a truncated string would pass
  // a row count and lose a milk figure.
  const milk = restored
    .prepare(`SELECT yield_litres, status FROM registry_milkings WHERE id = 'mk-1'`)
    .get() as { yield_litres: number; status: string };
  assert.equal(milk.yield_litres, 6.25);
  assert.equal(milk.status, 'measured');

  // A NULL must restore as NULL and not as the string 'NULL'.
  const ev = restored
    .prepare(`SELECT occurred_time, supersedes_id FROM registry_animal_events WHERE id = 'ev-1'`)
    .get() as { occurred_time: unknown; supersedes_id: unknown };
  assert.equal(ev.occurred_time, null);
  assert.equal(ev.supersedes_id, null);

  db.close();
  restored.close();
});

test('a dump carries data only -- the projections come back from the rebuild', () => {
  const db = seededMemoryDb();
  const sql = dumpRecordTables(db, { source: ':memory:', stamp: 's' });

  // No DDL: the schema is the MIGRATIONS array, and including it would swamp
  // the diff the .sql exists to produce.
  assert.ok(!/CREATE TABLE/i.test(sql), 'the dump should contain no DDL');
  for (const t of REGISTRY_PROJECTION_TABLES) {
    assert.ok(
      !new RegExp(`INSERT INTO ${t}\\b`).test(sql),
      `${t} is derivable and must not be dumped`,
    );
  }
  // And it says which schema it came from, so a restore can detect a mismatch.
  assert.match(sql, new RegExp(`user_version = ${TARGET_VERSION}`));

  db.close();
});

test('a dump defers foreign keys rather than disabling them', () => {
  const db = seededMemoryDb();
  const sql = dumpRecordTables(db, { source: ':memory:', stamp: 's' });

  // `sqlite3 .dump` emits `PRAGMA foreign_keys=OFF`, which would let a dump with
  // a dangling supersedes_id restore silently. Deferring keeps the check and
  // moves it to COMMIT, which is what a self-referencing key needs.
  assert.match(sql, /PRAGMA defer_foreign_keys = ON;/);
  assert.ok(!/foreign_keys\s*=\s*OFF/i.test(sql), 'the dump must not disable foreign keys');

  db.close();
});

test('a dangling reference makes the restore fail rather than load quietly', () => {
  const db = seededMemoryDb();
  const sql = dumpRecordTables(db, { source: ':memory:', stamp: 's' });

  // The property the deferral is there to preserve. Point the event at an animal
  // the dump does not carry: deferred or not, this must not load.
  const corrupt = sql.replace(/'BD-0001', 'birth'/, "'BD-9999', 'birth'");
  assert.notEqual(corrupt, sql, 'the fixture statement changed shape -- update this test');
  assert.throws(() => restoreInto(corrupt), /FOREIGN KEY constraint failed/);

  db.close();
});

test('two dumps of unchanged data are byte-identical', () => {
  const db = seededMemoryDb();
  const meta = { source: ':memory:', stamp: '2026-09-04T120000' };
  assert.equal(dumpRecordTables(db, meta), dumpRecordTables(db, meta));

  // Determinism must survive the rows arriving in a different physical order,
  // which is the case ORDER BY rowid would silently get wrong.
  const first = dumpRecordTables(db, meta);
  db.prepare(
    `INSERT INTO registry_animals (id, name, sex, species, origin)
     VALUES ('BD-0002', 'Noor', 'female', 'buffalo', 'acquired')`,
  ).run();
  db.prepare(`DELETE FROM registry_animals WHERE id = 'BD-0002'`).run();
  assert.equal(dumpRecordTables(db, meta), first, 'the dump is order-dependent');

  db.close();
});

// ---------------------------------------------------------------------------
// runBackup
// ---------------------------------------------------------------------------

test('runBackup writes a verified snapshot and a dump', () => {
  const dir = tempDir();
  try {
    const db = seededMemoryDb();
    const result = runBackup(db, { outDir: dir, stamp: '2026-09-04T120000' });

    assert.equal(result.check.integrity, 'ok');
    assert.equal(result.check.foreignKeyViolations, 0);
    assert.equal(result.check.userVersion, TARGET_VERSION);
    assert.deepEqual(result.check.rows, result.sourceRows);
    assert.equal(result.wroteDump, true);

    // The snapshot is a real, independently openable registry.
    const restored = new Database(result.paths.db, { readonly: true });
    assert.equal(
      (restored.prepare(`SELECT COUNT(*) AS n FROM registry_animals`).get() as { n: number }).n,
      1,
    );
    restored.close();

    assert.match(readFileSync(result.paths.sql, 'utf8'), /INSERT INTO registry_animals/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runBackup refuses to overwrite an existing backup', () => {
  const dir = tempDir();
  try {
    const db = seededMemoryDb();
    const stamp = '2026-09-04T120000';
    runBackup(db, { outDir: dir, stamp });

    // A backup silently replacing another backup is the one behaviour that would
    // make the whole directory untrustworthy.
    assert.throws(() => runBackup(db, { outDir: dir, stamp }), /already exists/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--no-dump writes the snapshot alone', () => {
  const dir = tempDir();
  try {
    const db = seededMemoryDb();
    const result = runBackup(db, { outDir: dir, stamp: 's', dump: false });
    assert.equal(result.wroteDump, false);
    assert.throws(() => readFileSync(result.paths.sql, 'utf8'), /ENOENT/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('backupPaths labels both files and expandHome resolves ~', () => {
  const p = backupPaths('/out', '2026-09-04T120000', 'pre-v4');
  assert.equal(p.db, '/out/dairy-2026-09-04T120000-pre-v4.db');
  assert.equal(p.sql, '/out/registry-2026-09-04T120000-pre-v4.sql');

  assert.equal(expandHome('~/x'), path.join(os.homedir(), 'x'));
  assert.equal(expandHome('/abs/x'), '/abs/x');
  // Not a home reference -- must be left alone rather than mangled.
  assert.equal(expandHome('~x/y'), '~x/y');
});

// ---------------------------------------------------------------------------
// The pre-migration hook
// ---------------------------------------------------------------------------

test('preMigrationBackup skips in-memory databases', () => {
  const db = seededMemoryDb();
  // The suite migrates hundreds of `:memory:` handles. If this ever stopped
  // being a no-op, `npm test` would start writing files.
  assert.doesNotThrow(() => preMigrationBackup(db, { from: 0, to: TARGET_VERSION }));
  db.close();
});

test('a fresh file database migrates with no backup and no error', () => {
  const dir = tempDir();
  try {
    // THE FIRST BOOT OF EVERY CLEAN CLONE, and the case that made this whole
    // feature unshippable: a new database is at user_version 0, so the record
    // tables migration 1 creates do not exist yet. Counting rows in them threw
    // `no such table`, a failed pre-migration backup refuses the migration, and
    // the app could not start at all on a fresh machine.
    const db = new Database(path.join(dir, 'live.db'));
    const out = path.join(dir, 'backups');

    assert.doesNotThrow(() =>
      applyRegistrySchema(db, {
        beforeMigrate: (pending) => preMigrationBackup(db, pending, out),
      }),
    );
    assert.equal(db.pragma('user_version', { simple: true }), TARGET_VERSION);

    // And no file: a snapshot of a database with no records restores nothing, so
    // taking one would only litter backups/ on every clean install.
    assert.throws(() => readdirSync(out), /ENOENT/);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preMigrationBackup snapshots a populated file database', () => {
  const dir = tempDir();
  try {
    // The path that actually protects records. Called directly with a pending
    // pair rather than through a staged migration: what matters is that a
    // populated FILE database produces a labelled snapshot of its current state,
    // and faking a half-applied MIGRATIONS array to reach the same branch would
    // test the fake.
    const file = path.join(dir, 'live.db');
    const out = path.join(dir, 'backups');

    const db = new Database(file);
    applyRegistrySchema(db);
    db.prepare(
      `INSERT INTO registry_animals (id, name, sex, species, origin)
       VALUES ('BD-0001', 'Kali', 'female', 'buffalo', 'born_on_farm')`,
    ).run();

    preMigrationBackup(db, { from: TARGET_VERSION, to: TARGET_VERSION + 1 }, out);
    db.close();

    // Exactly one snapshot, labelled with the version being migrated TO -- which
    // is what tells you, months later, which migration a file predates.
    const written = readdirSync(out);
    assert.equal(written.length, 1, `expected one snapshot, got ${written.join(', ')}`);
    assert.match(written[0], new RegExp(`^dairy-.*-pre-v${TARGET_VERSION + 1}\\.db$`));

    // No .sql alongside it: the pre-migration path is deliberately snapshot-only.
    assert.ok(!written.some((f) => f.endsWith('.sql')), 'the hook writes no dump');

    // And it holds the records, at the pre-migration schema version.
    const snap = new Database(path.join(out, written[0]), { readonly: true });
    assert.equal(snap.pragma('user_version', { simple: true }), TARGET_VERSION);
    assert.equal(
      (snap.prepare(`SELECT COUNT(*) AS n FROM registry_animals`).get() as { n: number }).n,
      1,
    );
    snap.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recordRowCounts omits tables that do not exist yet', () => {
  const dir = tempDir();
  try {
    // An unmigrated database must read as "no tables", not as "an empty herd".
    // The distinction matters: omitting them is what makes runBackup's
    // source-vs-copy comparison notice a snapshot that lost a whole table.
    const db = new Database(path.join(dir, 'bare.db'));
    assert.deepEqual(recordRowCounts(db), {});
    assert.deepEqual(presentRecordTables(db), []);
    assert.equal(irreplaceableRecordCount(db), 0);

    applyRegistrySchema(db);
    assert.deepEqual([...presentRecordTables(db)], [...SOURCE_OF_TRUTH_TABLES]);

    // Migration 1 seeds the serial counter, so recordRowCounts is not zero on a
    // registry nobody has used -- but nothing irreplaceable is in it, which is
    // what decides whether a pre-migration snapshot is worth taking.
    assert.equal(recordRowCounts(db).registry_serial_counter, 1);
    assert.equal(irreplaceableRecordCount(db), 0);

    db.prepare(
      `INSERT INTO registry_animals (id, name, sex, species, origin)
       VALUES ('BD-0001', 'Kali', 'female', 'buffalo', 'born_on_farm')`,
    ).run();
    assert.equal(irreplaceableRecordCount(db), 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preMigrationBackup refuses to migrate when the snapshot cannot be written', () => {
  const dir = tempDir();
  const file = path.join(dir, 'live.db');
  try {
    const db = new Database(file);
    applyRegistrySchema(db);

    // Block the default backup directory by making it a FILE. The point is the
    // failure MODE: an unwritable destination must abort the migration, because
    // the alternative is rebuilding the event log with no way back.
    const blocked = path.join(dir, 'backups');
    writeFileSync(blocked, 'not a directory');

    assert.throws(
      () => runBackup(db, { outDir: blocked, stamp: 's' }),
      /ENOTDIR|EEXIST|ENOENT/,
      'an unwritable output directory must throw',
    );

    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the pre-migration hook fires only when a migration is pending', () => {
  const file = path.join(tempDir(), 'live.db');
  const calls: { from: number; to: number }[] = [];
  try {
    const db = new Database(file);

    // Fresh database: at version 0, migrations pending, so the hook runs.
    applyRegistrySchema(db, { beforeMigrate: (p) => calls.push(p) });
    assert.deepEqual(calls, [{ from: 0, to: TARGET_VERSION }]);

    // Already migrated: the overwhelmingly common boot. A snapshot on every
    // import of db.ts would put a file in backups/ every time anything ran.
    applyRegistrySchema(db, { beforeMigrate: (p) => calls.push(p) });
    assert.equal(calls.length, 1, 'the hook fired on a no-op migration');

    db.close();
  } finally {
    rmSync(path.dirname(file), { recursive: true, force: true });
  }
});

test('a throw from beforeMigrate leaves the schema unmigrated', () => {
  const dir = tempDir();
  const file = path.join(dir, 'live.db');
  try {
    const db = new Database(file);
    assert.throws(
      () => applyRegistrySchema(db, { beforeMigrate: () => { throw new Error('no backup'); } }),
      /no backup/,
    );
    // The whole contract: refusing to back up means refusing to migrate. A
    // half-migrated database with no snapshot is the state this exists to avoid.
    assert.equal(db.pragma('user_version', { simple: true }), 0);
    assert.throws(
      () => db.prepare(`SELECT 1 FROM registry_animals`).get(),
      /no such table/,
    );
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Module isolation -- same rule, and same reasoning, as
// registry.harness.test.ts: an absence is the kind of invariant a one-line
// import breaks later.
// ---------------------------------------------------------------------------

test('backup.ts never loads db.ts', () => {
  const forbidden = /[/\\]src[/\\]db\.ts$/;
  assert.deepEqual(
    Object.keys(require.cache).filter((p) => forbidden.test(p)),
    [],
    'db.ts was already loaded before this test ran — the check would be meaningless',
  );

  // Importing it at module scope would be a require cycle resolved during
  // db.ts's own load, since db.ts imports this module for the hook. The CLI
  // reaches for the singleton through a lazy require inside main() instead.
  require('./backup');
  assert.deepEqual(
    Object.keys(require.cache).filter((p) => forbidden.test(p)),
    [],
    'backup.ts now imports ../db — the pre-migration hook would be a require cycle',
  );

  const src = readFileSync(path.join(__dirname, 'backup.ts'), 'utf8');
  assert.ok(
    !/^import .* from '\.\.\/db'/m.test(src),
    "backup.ts must reach ../db only through the lazy require in main()",
  );
});

test('backup.ts contains no raw control bytes', () => {
  // The NEEDS_HEX character class was first written as literal bytes, which made
  // this module binary to grep, diff and every editor -- the same mistake the
  // class itself is there to prevent, one layer down.
  const src = readFileSync(path.join(__dirname, 'backup.ts'), 'utf8');
  const bad = [...src].filter((c) => {
    const n = c.codePointAt(0) ?? 0;
    return (n < 0x20 && c !== '\n' && c !== '\t' && c !== '\r') || n === 0x7f;
  });
  assert.deepEqual(bad, [], 'write control characters as escapes, never as themselves');
});
