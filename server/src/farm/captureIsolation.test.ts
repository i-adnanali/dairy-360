// Module-isolation guard for the Cycle 7 capture tooling (see
// docs/cycle-7-live-camera-validation.md, open decision 1).
//
// Open decision 1 is a HARD constraint: "the shared dev DB stays untouched"
// during the live-camera validation window. That constraint is enforced by an
// absence -- captureMqtt.ts and verifyPayloadShape.ts must not import `../db`,
// directly or transitively -- and an absence is exactly the kind of invariant
// that gets broken later by a one-line import that looks harmless.
//
// It really is one line away. `../db` calls `new Database(DB_PATH)` and
// `db.exec(FARM_SCHEMA)` at MODULE LOAD, so merely importing it opens (and on a
// fresh clone, creates) dairy.db -- no query required. And the trap is
// transitive: ./simulate imports `daysAgo` from ../seed, and seed.ts imports
// `db` on its first line. So `import { stampTimestamps } from './simulate'` --
// the single most natural thing to reach for in verifyPayloadShape.ts -- would
// silently break the constraint.
//
// This test asserts the invariant mechanically rather than trusting a comment.

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

/** Modules whose mere presence in the require cache means the constraint broke.
 * better-sqlite3 is listed as well as our own two files: a future helper could
 * open the database without going through db.ts. */
const FORBIDDEN = [/better-sqlite3/, /[/\\]src[/\\]db\.ts$/, /[/\\]src[/\\]seed\.ts$/];

function offendingModules(): string[] {
  return Object.keys(require.cache).filter((p) => FORBIDDEN.some((re) => re.test(p)));
}

test('the capture tooling never loads db.ts, seed.ts or better-sqlite3', () => {
  // Sanity: if something else in this test process already pulled the database
  // in, the assertion below would be vacuous rather than failing.
  assert.deepEqual(
    offendingModules(),
    [],
    'a database module was already loaded before this test ran — the check would be meaningless',
  );

  // Load exactly what a capture run loads. Both files guard their CLI entry
  // behind `require.main === module`, so this imports without running anything.
  require('./captureMqtt');
  require('./verifyPayloadShape');
  require('./payloadShape');

  assert.deepEqual(
    offendingModules(),
    [],
    'the capture tooling now reaches the database — open decision 1 is broken. ' +
      'Check for a new import of ../db, ../seed, or ./simulate (which imports ../seed).',
  );
});

test('./simulate is the transitive trap this guard exists for', () => {
  // Checked STATICALLY, by reading the source. The obvious version of this test
  // -- `require('./simulate')` and assert the database got pulled in -- would
  // prove the point by doing the very thing the constraint forbids: it opens
  // dairy.db and moves its mtime. A test asserting "we never touch the shared
  // database" must not touch the shared database.
  const read = (f: string): string =>
    readFileSync(path.join(__dirname, f), 'utf8');

  assert.match(
    read('simulate.ts'),
    /^import .*\bdaysAgo\b.* from '\.\.\/seed';$/m,
    'simulate.ts no longer imports from ../seed',
  );
  assert.match(
    read(path.join('..', 'seed.ts')),
    /^import .*\bdb\b.* from '\.\/db';$/m,
    'seed.ts no longer imports ./db — verifyPayloadShape.ts could reuse stampTimestamps',
  );

  // And the two capture modules must not name the forbidden imports at all.
  for (const file of ['captureMqtt.ts', 'verifyPayloadShape.ts']) {
    const src = read(file);
    for (const forbidden of ["'../db'", "'../seed'", "'./simulate'"]) {
      assert.ok(
        !new RegExp(`^import[^\\n]*from ${forbidden.replace(/[./]/g, '\\$&')};$`, 'm').test(src),
        `${file} imports ${forbidden} — open decision 1 is broken`,
      );
    }
  }
});
