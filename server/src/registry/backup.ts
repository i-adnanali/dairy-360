// Animal registry -- snapshots of the one database that cannot be regenerated.
//
//   npm run registry:backup -w server
//   npm run registry:backup -w server -- --out=~/Dropbox/dairy-backups
//   npm run registry:backup -w server -- --no-dump
//
// Every other dataset in this repo is reproducible: the demo tables come from
// `npm run seed`, farm_events from a webhook replay, the projection tables from
// `registry:rebuild`. The registry's four RECORD tables are not reproducible
// from anything, which is the entire reason this module exists.
//
// ---------------------------------------------------------------------------
// WHY NOT `cp dairy.db`
// ---------------------------------------------------------------------------
// dairy.db is in WAL mode, so committed transactions can live in the `-wal`
// sidecar rather than the main file until a checkpoint. Copying only `dairy.db`
// from a running server therefore yields a STALE snapshot, and copying the three
// files non-atomically can yield a torn one. Neither failure announces itself --
// you get a file that opens cleanly and is missing yesterday.
//
// `VACUUM INTO` is the fix: it runs on a live connection, needs no downtime, and
// writes a transactionally consistent, fully-checkpointed single file. Two
// properties of its output are worth knowing:
//
//   - It is NOT in WAL mode (measured: the output reports `delete`). A backup is
//     one self-contained file with no sidecars, so the `immutable=1`-not-
//     `-readonly` trap documented in DEVELOPMENT.md § 6 does not apply to
//     backups -- a plain read-only open works.
//   - It REFUSES to overwrite an existing file ("output file already exists").
//     That is a feature and is not worked around here: a backup must never
//     silently replace another backup.
//
// ---------------------------------------------------------------------------
// WHY BOTH A .db AND A .sql
// ---------------------------------------------------------------------------
// They fail differently, which is the point of having two.
//
// The `.db` is exact and instantly restorable, but it is opaque: you cannot see
// what changed between Tuesday and Wednesday, and a single flipped byte can cost
// you the file.
//
// The `.sql` is a deterministic text dump of the four record tables -- stable
// column order, ordered by primary key -- so consecutive dumps `diff` cleanly.
// That makes "when did this animal's birth date change?" answerable, makes the
// dumps compress and deduplicate in git, and keeps them readable by anything
// that can read text if SQLite itself ever becomes the problem.
//
// The dump carries DATA ONLY, no DDL. Schema is reproducible -- it is the
// MIGRATIONS array -- so a restore is `migrate, then load`, and the dump stays
// free of the schema noise that would swamp the diff. The `user_version` it was
// taken at is recorded in the header so a mismatch is detectable rather than
// discovered halfway through a restore.
//
// ---------------------------------------------------------------------------
// THIS MODULE IMPORTS NO `../db`
// ---------------------------------------------------------------------------
// Asserted by registry.backup.test.ts, and load-bearing for two separate
// reasons. The pre-migration hook runs DURING db.ts's module load, so importing
// the singleton here would be a genuine require cycle. And a backup tool that
// could only ever reach the singleton could not snapshot a file handed to it on
// the command line, which is most of what a backup tool is for.

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Db, PendingMigrations } from './schema';
import {
  REGISTRY_PROJECTION_TABLES,
  REGISTRY_TABLES,
  TARGET_VERSION,
  applyRegistryPragmas,
} from './schema';
import { farmStamp } from './time';

/**
 * The tables a backup must contain, derived rather than listed.
 *
 * REGISTRY_TABLES minus REGISTRY_PROJECTION_TABLES: `registry_animals`,
 * `registry_animal_events`, `registry_milkings`, `registry_serial_counter`.
 *
 * DERIVED ON PURPOSE. A hardcoded list would go stale the first time a
 * migration adds a record table, and it would go stale SILENTLY -- the backup
 * would keep succeeding while quietly omitting the new table. Computing it from
 * the two lists schema.ts already exports means a new table is either a
 * projection (regenerable, correctly skipped) or a record (backed up), and
 * there is no third state where it is forgotten.
 */
export const SOURCE_OF_TRUTH_TABLES: readonly string[] = REGISTRY_TABLES.filter(
  (t) => !(REGISTRY_PROJECTION_TABLES as readonly string[]).includes(t),
);

export interface BackupPaths {
  db: string;
  sql: string;
}

/** Expand a leading `~` -- CLI paths get typed by hand, and shells that would
 * have expanded it are not always in the picture (launchd runs no shell). */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** `dairy-<stamp>[-<label>].db` and the matching `.sql`. */
export function backupPaths(
  outDir: string,
  stamp: string,
  label?: string,
): BackupPaths {
  const suffix = label ? `-${label}` : '';
  return {
    db: path.join(outDir, `dairy-${stamp}${suffix}.db`),
    sql: path.join(outDir, `registry-${stamp}${suffix}.sql`),
  };
}

// ---------------------------------------------------------------------------
// The binary snapshot
// ---------------------------------------------------------------------------

/**
 * `VACUUM INTO dest`. Synchronous, like every other write in this codebase.
 *
 * The path is interpolated into SQL because VACUUM INTO takes a literal, not a
 * bound parameter -- SQLite would accept `?` and then fail to parse it. So the
 * quote-doubling is the actual escaping and not decoration.
 */
export function snapshotTo(db: Db, dest: string): void {
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
}

export interface SnapshotCheck {
  integrity: string;
  foreignKeyViolations: number;
  userVersion: number;
  rows: Record<string, number>;
}

/**
 * Tables whose rows are created by the MIGRATION rather than by the application,
 * and which therefore already exist in the database a restore loads into.
 *
 * There is exactly one: MIGRATION_1 ends with
 * `INSERT INTO registry_serial_counter (id, next_serial) VALUES (1, 1)`, and the
 * `CHECK (id = 1)` means there is never a second row. Its EXISTENCE is schema;
 * only its VALUE is data. Dumping it as an INSERT makes the restore fail on
 * `UNIQUE constraint failed: registry_serial_counter.id` -- which is how this
 * list came to exist rather than being foreseen.
 *
 * Dumped as an UPDATE, which is also how the application itself writes it and
 * how cloneEventLogToMemory() in verify.ts copies it. Note what is NOT used
 * here: `INSERT OR REPLACE`, whose implicit delete is the exact statement the
 * append-only triggers and `recursive_triggers` exist to defeat. It must not
 * appear anywhere near a registry table, including in a file that only ever
 * touches this one.
 */
const PRESEEDED_SINGLETON_TABLES: readonly string[] = ['registry_serial_counter'];

/**
 * Which record tables actually exist on this handle.
 *
 * NOT a formality. A database at `user_version = 0` -- a fresh clone, a new
 * machine, CI -- has NONE of them, because migration 1 is what creates them.
 * Assuming they exist made the pre-migration hook throw `no such table` and,
 * since a failed backup refuses the migration, made a fresh install unable to
 * boot at all. Found by the test, not by reasoning.
 */
export function presentRecordTables(db: Db): string[] {
  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${
      SOURCE_OF_TRUTH_TABLES.map(() => '?').join(', ')
    })`)
    .all(...SOURCE_OF_TRUTH_TABLES) as { name: string }[];
  const found = new Set(rows.map((r) => r.name));
  return SOURCE_OF_TRUTH_TABLES.filter((t) => found.has(t));
}

/**
 * Row counts for the record tables that exist -- the comparison both sides of
 * the snapshot check are made of.
 *
 * Absent tables are OMITTED rather than reported as 0, so the source-vs-copy
 * comparison in runBackup compares key sets as well as counts: a snapshot that
 * somehow lost a whole table fails the check instead of matching a zero.
 */
export function recordRowCounts(db: Db): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of presentRecordTables(db)) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
    counts[t] = row.n;
  }
  return counts;
}

/**
 * Rows that could not be recreated if this database were lost. Zero means a
 * backup of it would protect nothing.
 *
 * EXCLUDES the pre-seeded singletons, which is the whole reason this is not just
 * a sum of recordRowCounts(). `registry_serial_counter` always holds exactly one
 * row -- migration 1 inserts it -- so a migrated but never-used registry would
 * otherwise report 1 and read as "has records". Its existence is schema; with no
 * animals its value is the initial 1 and carries nothing.
 *
 * recordRowCounts() still includes it, and must: the snapshot has to match its
 * source exactly, whatever the row means.
 */
export function irreplaceableRecordCount(db: Db): number {
  return Object.entries(recordRowCounts(db))
    .filter(([t]) => !PRESEEDED_SINGLETON_TABLES.includes(t))
    .reduce((total, [, n]) => total + n, 0);
}

/**
 * Open the FINISHED COPY and check it. Verifying the artifact is the whole
 * point -- an integrity check on the source proves nothing about the file you
 * would actually restore from, which is the file that might be truncated by a
 * full disk or corrupted on the way out.
 *
 * Read-only, because a backup is a record and a verification pass must not
 * write to it. Safe here specifically because VACUUM INTO output is not in WAL
 * mode and so needs no `-shm` sidecar to read.
 */
export function verifySnapshot(dest: string): SnapshotCheck {
  const copy = new Database(dest, { readonly: true });
  try {
    applyRegistryPragmas(copy);
    const integrity = copy.pragma('integrity_check', { simple: true }) as string;
    const fk = copy.pragma('foreign_key_check') as unknown[];
    return {
      integrity,
      foreignKeyViolations: fk.length,
      userVersion: copy.pragma('user_version', { simple: true }) as number,
      rows: recordRowCounts(copy),
    };
  } finally {
    copy.close();
  }
}

// ---------------------------------------------------------------------------
// The logical dump
// ---------------------------------------------------------------------------

/** Control characters cannot go into a SQL string literal as themselves. NUL is
 * the one that matters: it terminates the string as far as most C-based readers
 * are concerned, so a row containing one would silently truncate the statement
 * that restores it. This repo has already shipped that bug twice, in the
 * composite-key and histogram-key encoders. */
// Written as ESCAPES, never as literal bytes. A source file carrying a raw NUL
// is the same mistake one layer down -- it makes this module binary to grep,
// diff and every editor, which is how the two commits above got shipped.
const NEEDS_HEX = /[\x00-\x1f\x7f]/;

/**
 * One SQLite literal. Exported for the test, which is the only way to pin the
 * NUL behaviour without a table full of control characters.
 *
 * Strings needing escapes go out as `CAST(x'..' AS TEXT)` rather than a quoted
 * literal with backslash escapes -- SQLite has no backslash escapes, so hex is
 * the only encoding that round-trips a control character exactly.
 */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    // SQLite cannot store NaN -- it reads back as NULL -- and has no keyword for
    // infinity, but it does parse an overflowing literal to Inf. Neither should
    // ever appear in a registry column; emitting a value that round-trips beats
    // emitting `NaN`, which is a syntax error and would fail the whole restore.
    if (Number.isNaN(v)) return 'NULL';
    if (v === Infinity) return '9e999';
    if (v === -Infinity) return '-9e999';
    return String(v);
  }
  if (Buffer.isBuffer(v)) return `x'${v.toString('hex')}'`;
  if (typeof v === 'string') {
    if (NEEDS_HEX.test(v)) {
      return `CAST(x'${Buffer.from(v, 'utf8').toString('hex')}' AS TEXT)`;
    }
    return `'${v.replace(/'/g, "''")}'`;
  }
  throw new Error(
    `registry backup: cannot serialize ${typeof v} to a SQL literal. ` +
      'better-sqlite3 returns only null, number, bigint, string and Buffer, so ' +
      'this means a column type nothing in this repo has stored before.',
  );
}

interface ColumnInfo {
  name: string;
  pk: number;
}

/**
 * Columns and primary key read from the database itself, not from a constant.
 *
 * Both the explicit column list and the ORDER BY come from here, which is what
 * makes the dump insensitive to column ORDER changing in a future migration
 * (`INSERT INTO t (a, b)` keeps meaning what it says) and deterministic without
 * this module having to know any table's key.
 */
function columnsOf(db: Db, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

/**
 * Deterministic statements for one table, ordered by primary key.
 *
 * Determinism is a hard requirement, not a nicety: the whole value of the text
 * dump is that two of them diff to exactly the rows that changed. Ordering by
 * rowid instead would let an unrelated VACUUM reshuffle the file and produce a
 * diff of the entire herd.
 */
export function dumpTable(db: Db, table: string): string[] {
  const cols = columnsOf(db, table);
  if (cols.length === 0) throw new Error(`registry backup: no such table '${table}'`);

  const names = cols.map((c) => c.name);
  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  // Every registry record table has a primary key; the fallback is for a future
  // one that does not, where any stable order beats an unstable one.
  const keyNames = pk.length > 0 ? pk.map((c) => c.name) : names;
  const orderBy = keyNames.join(', ');

  const quoted = names.join(', ');
  const rows = db
    .prepare(`SELECT ${quoted} FROM ${table} ORDER BY ${orderBy}`)
    .all() as Record<string, unknown>[];

  if (PRESEEDED_SINGLETON_TABLES.includes(table)) {
    if (pk.length === 0) {
      throw new Error(
        `registry backup: ${table} is listed as a pre-seeded singleton but has no ` +
          'primary key, so there is no way to address its row in an UPDATE.',
      );
    }
    const valueNames = names.filter((n) => !keyNames.includes(n));
    return rows.map((r) => {
      const set = valueNames.map((n) => `${n} = ${sqlLiteral(r[n])}`).join(', ');
      const where = keyNames.map((n) => `${n} = ${sqlLiteral(r[n])}`).join(' AND ');
      return `UPDATE ${table} SET ${set} WHERE ${where};`;
    });
  }

  return rows.map(
    (r) =>
      `INSERT INTO ${table} (${quoted}) VALUES (${names
        .map((n) => sqlLiteral(r[n]))
        .join(', ')});`,
  );
}

/**
 * The whole logical dump: a provenance header, then data for every record table.
 *
 * `defer_foreign_keys` rather than `foreign_keys = OFF`, which is what
 * `sqlite3 .dump` emits. The registry's `supersedes_id` is a SELF-REFERENCING
 * foreign key, so no single ORDER BY is a guaranteed topological order -- the
 * exact problem cloneEventLogToMemory() in verify.ts already solved, and this
 * takes the same route for the same reason. Deferring moves the check to COMMIT
 * instead of abandoning it: a genuinely dangling reference still fails the
 * restore, just at the end. Turning foreign keys off would let a corrupt dump
 * load silently, which for a restore is the worst available outcome.
 *
 * The pragma is transaction-scoped and resets itself on commit.
 */
export function dumpRecordTables(db: Db, meta: { source: string; stamp: string }): string {
  const userVersion = db.pragma('user_version', { simple: true }) as number;
  const counts = recordRowCounts(db);

  const lines: string[] = [
    `-- dairy-agent animal registry -- logical backup of the record tables.`,
    `--`,
    `--   taken     ${meta.stamp} (farm-local, Asia/Karachi)`,
    `--   source    ${meta.source}`,
    `--   schema    user_version = ${userVersion} (this build targets ${TARGET_VERSION})`,
    `--`,
    ...SOURCE_OF_TRUTH_TABLES.map(
      (t) => `--   ${t.padEnd(24)} ${String(counts[t]).padStart(6)} row(s)`,
    ),
    `--`,
    `-- DATA ONLY -- no DDL. Restore into a database already migrated to`,
    `-- user_version ${userVersion}, then run \`npm run registry:rebuild -w server\` to`,
    `-- recompute the projection tables, which are deliberately not in here.`,
    `--`,
    `-- registry_serial_counter is an UPDATE, not an INSERT: its single row is`,
    `-- created by the migration, so the target database already has it.`,
    `--`,
    `-- The projection tables (${REGISTRY_PROJECTION_TABLES.join(', ')})`,
    `-- are omitted because every row in them is derivable from the event log. If a`,
    `-- restore of this file plus a rebuild does not reproduce them, that is a bug`,
    `-- in the projection and \`npm run verify:registry\` is what reports it.`,
    ``,
    `BEGIN TRANSACTION;`,
    `PRAGMA defer_foreign_keys = ON;`,
    ``,
  ];

  for (const table of SOURCE_OF_TRUTH_TABLES) {
    lines.push(`-- ${table} (${counts[table]} row(s))`);
    const statements = dumpTable(db, table);
    if (statements.length === 0) lines.push('-- (empty)');
    else lines.push(...statements);
    lines.push('');
  }

  lines.push(`COMMIT;`, ``);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// The orchestration
// ---------------------------------------------------------------------------

export interface BackupOptions {
  outDir: string;
  /** Defaults to now, farm-local. Injectable so the test is not clock-dependent. */
  stamp?: string;
  /** Appended to both filenames -- how a pre-migration snapshot names itself. */
  label?: string;
  /** Skip the .sql dump. For the pre-migration hook, where the .db is what
   * matters and the dump would double the work at the least convenient moment. */
  dump?: boolean;
}

export interface BackupResult {
  paths: BackupPaths;
  check: SnapshotCheck;
  sourceRows: Record<string, number>;
  wroteDump: boolean;
}

/**
 * Snapshot, verify, dump. Throws rather than warns on every failure -- a backup
 * that reports success without having written a verifiable file is worse than no
 * backup, because it is the one you will rely on.
 */
export function runBackup(db: Db, opts: BackupOptions): BackupResult {
  const outDir = expandHome(opts.outDir);
  const stamp = opts.stamp ?? farmStamp();
  const wantDump = opts.dump !== false;

  mkdirSync(outDir, { recursive: true });
  const paths = backupPaths(outDir, stamp, opts.label);

  // Checked before VACUUM INTO as well as by it, so the message names the
  // collision instead of surfacing SQLite's "output file already exists".
  for (const p of wantDump ? [paths.db, paths.sql] : [paths.db]) {
    if (existsSync(p)) {
      throw new Error(
        `registry backup: ${p} already exists. Backups are never overwritten; ` +
          'pass a different --out, or wait a second and retry for a new stamp.',
      );
    }
  }

  const sourceRows = recordRowCounts(db);
  snapshotTo(db, paths.db);
  const check = verifySnapshot(paths.db);

  if (check.integrity !== 'ok') {
    throw new Error(
      `registry backup: ${paths.db} failed integrity_check: ${check.integrity}. ` +
        'The snapshot is NOT usable. Delete it and investigate the source database.',
    );
  }
  if (check.foreignKeyViolations > 0) {
    throw new Error(
      `registry backup: ${paths.db} has ${check.foreignKeyViolations} foreign key ` +
        'violation(s). The file is structurally sound but referentially broken, which ' +
        'means the SOURCE database is too -- investigate before relying on either.',
    );
  }
  // The check that catches a snapshot taken against the wrong handle, which no
  // integrity check can: a valid, uncorrupted, empty database passes both of the
  // checks above. Compares the whole object, so a table present in the source and
  // missing from the copy fails here rather than reading as a matching zero.
  const expected = JSON.stringify(sourceRows);
  const actual = JSON.stringify(check.rows);
  if (expected !== actual) {
    throw new Error(
      `registry backup: ${paths.db} does not match its source.\n` +
        `  source ${expected}\n  copy   ${actual}\n` +
        '  Do not rely on this snapshot.',
    );
  }

  if (wantDump) {
    writeFileSync(
      paths.sql,
      dumpRecordTables(db, { source: db.name, stamp }),
      'utf8',
    );
  }

  return { paths, check, sourceRows, wroteDump: wantDump };
}

// ---------------------------------------------------------------------------
// The pre-migration hook
// ---------------------------------------------------------------------------

/** Where snapshots land by default: `server/backups/`, alongside dairy.db.
 *
 * Same-disk, so this alone protects against a bad migration and a mistaken
 * DELETE but NOT against losing the machine. Getting the directory off the
 * machine is a deployment decision, documented in DEVELOPMENT.md § 8 rather
 * than assumed here. */
export const DEFAULT_BACKUP_DIR = path.join(__dirname, '..', '..', 'backups');

/** Set to `1` to migrate without a pre-migration snapshot. */
export const SKIP_ENV = 'REGISTRY_SKIP_PREMIGRATION_BACKUP';

/**
 * Snapshot before a migration runs. Wired in db.ts, called by
 * applyRegistrySchema only when there is actually a migration to apply.
 *
 * WHY THIS IS THE HIGHEST-VALUE TRIGGER: migrations here are automatic and
 * implicit. applyRegistrySchema runs at db.ts module load, so a pending
 * migration fires the moment ANY code path imports the singleton -- a one-off
 * script, a test, an editor's language server running a file. Migration 2
 * already rebuilds registry_animal_events by create-copy-drop-rename with
 * foreign keys off. An unattended table rebuild against the only irreplaceable
 * data in the repo is precisely the event worth a guaranteed snapshot.
 *
 * THROWS on failure, which aborts the migration and the boot. That is the point:
 * if the snapshot cannot be written, the safe action is to not migrate. Set
 * REGISTRY_SKIP_PREMIGRATION_BACKUP=1 to override, which is the honest way to
 * express "I know, this database is disposable" -- as the harness's `:memory:`
 * handle does not need to, since it never reaches here.
 *
 * Skips in-memory databases: tests migrate hundreds of them, none holds a
 * record, and `VACUUM INTO` on each would make the suite write files.
 *
 * `outDir` is a parameter with a default rather than a constant read inside,
 * only so the SUCCESS path is testable against a temp directory. Without it the
 * one branch that actually writes a file could be exercised only by staging a
 * pending migration against the real dairy.db, which is the last thing a test
 * suite should be doing.
 */
export function preMigrationBackup(
  db: Db,
  info: PendingMigrations,
  outDir: string = DEFAULT_BACKUP_DIR,
): void {
  if (db.memory) return;
  if (process.env[SKIP_ENV] === '1') {
    console.warn(
      `[registry] ${SKIP_ENV}=1 -- migrating ${info.from} -> ${info.to} with NO backup.`,
    );
    return;
  }

  // Nothing to protect: either the record tables do not exist yet (a fresh
  // database, at version 0 before migration 1 creates them) or they are all
  // empty. This is the FIRST BOOT of every clean clone and of CI, and it is the
  // state dairy.db is in until a herd is entered -- a snapshot here would put a
  // file in backups/ that restores nothing.
  if (irreplaceableRecordCount(db) === 0) {
    console.warn(
      `[registry] migrating ${info.from} -> ${info.to}; no records to back up yet.`,
    );
    return;
  }

  const label = `pre-v${info.to}`;
  try {
    // No .sql dump: the pre-migration path must be as short as possible, and the
    // .db alone is a complete restore. The scheduled backup is where the
    // diffable text comes from.
    const result = runBackup(db, { outDir, label, dump: false });
    console.warn(
      `[registry] migration ${info.from} -> ${info.to} pending. ` +
        `Backed up ${JSON.stringify(result.sourceRows)} to ${result.paths.db}`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `registry: REFUSING to migrate ${info.from} -> ${info.to} -- the ` +
        `pre-migration backup failed.\n  ${message}\n` +
        `  A migration on registry tables is not reversible and the records in them ` +
        `cannot be regenerated.\n  Fix the backup, or set ${SKIP_ENV}=1 if this ` +
        `database is genuinely disposable.`,
    );
  }
}

// ---------------------------------------------------------------------------
// CLI shell
// ---------------------------------------------------------------------------

interface Args {
  out?: string;
  dump: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { dump: true, help: false };
  for (const raw of argv) {
    const [flag, value] = raw.split('=');
    switch (flag) {
      case '--out':
        if (!value) throw new Error(`--out needs a directory\n\n${USAGE}`);
        args.out = value;
        break;
      case '--no-dump':
        args.dump = false;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown flag '${raw}'\n\n${USAGE}`);
    }
  }
  return args;
}

const USAGE = `
Usage:
  npm run registry:backup -w server [-- --out=<dir>] [-- --no-dump]

  --out=<dir>   where to write (default: server/backups/). Takes ~ paths.
  --no-dump     write only the .db snapshot, skipping the .sql text dump.

Writes two files, both stamped with the farm-local instant:

  dairy-<stamp>.db      VACUUM INTO snapshot, integrity-checked after writing
  registry-<stamp>.sql  deterministic text dump of the four record tables

Verify a snapshot at any time with:

  npm run verify:registry -w server -- --db=<path to a .db>
`.trim();

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  // Required here and nowhere else in this module: the CLI is the one caller
  // that means "the live database" rather than "a handle I was given".
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { db } = require('../db') as { db: Db };

  const result = runBackup(db, {
    outDir: args.out ?? DEFAULT_BACKUP_DIR,
    dump: args.dump,
  });

  console.log(`registry:backup  source=${db.name}`);
  console.log(`  ${result.paths.db}`);
  if (result.wroteDump) console.log(`  ${result.paths.sql}`);
  console.log(
    `  integrity ${result.check.integrity}   user_version ${result.check.userVersion}   ` +
      `fk violations ${result.check.foreignKeyViolations}`,
  );
  for (const t of SOURCE_OF_TRUTH_TABLES) {
    // `absent` rather than 0: an unmigrated database has no registry tables at
    // all, and printing zeroes for them would misreport that as an empty herd.
    const n = result.check.rows[t];
    console.log(`  ${t.padEnd(24)} ${n === undefined ? 'absent' : `${n} row(s)`}`);
  }

  // Judged on irreplaceable rows, so the serial counter's migration-seeded row
  // does not make an untouched registry read as having something in it.
  if (irreplaceableRecordCount(db) === 0) {
    console.log(
      '\n  NOTE: this snapshot backs up NO records -- every record table is empty or\n' +
        '  not yet created. That is the expected state until the herd is entered, and\n' +
        '  it is worth knowing that such a backup passes every check in here.',
    );
  }
}

if (require.main === module) main();
