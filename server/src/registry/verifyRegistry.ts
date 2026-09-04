// Animal registry -- verification against the LIVE database (decision doc §10).
//
//   npm run verify:registry -w server
//   npm run verify:registry -w server -- --as-of=2026-03-01
//
// Runs invariants 0-13 against server/dairy.db and prints the precision
// histogram and the calving-interval report. Exits 0 clean, non-zero with a
// printed diff otherwise.
//
// WHY THIS EXISTS ALONGSIDE registry.invariants.test.ts, rather than instead of
// it: the two callers need different data. The invariants must run against REAL
// data, which CI will never have; the projection logic must run in CI, against
// fixtures, on every push. Both call the same functions in invariants.ts and
// verify.ts, so there is one definition of each rule and two ways to reach it.
//
// UNLIKE verify:farm and verify:classify, this needs NO running server: there
// is no webhook to replay through, so it runs entirely in-process. That is
// precisely why the sibling test exists -- the stated reason those two are
// scripts rather than tests ("they need a live server") does not apply here, so
// the logic would otherwise never run in CI.
//
// This file is the SHELL ONLY: argument parsing, the live handle, and printing.
// Everything it checks lives in verify.ts / invariants.ts, which take a handle
// and are exercised against fixtures by registry.verify.test.ts.

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { expandHome } from './backup';
import type { Db } from './schema';
import {
  TARGET_VERSION,
  applyRegistryPragmas,
  assertRegistryPragmas,
} from './schema';
import { allEvents, snapshot } from './store';
import { groupByAnimal, intervalReport, precisionHistogram } from './intervals';
import { milkingReport } from './milking';
import { farmToday } from './time';
import { verifyAll } from './verify';

interface Args {
  asOf?: string;
  dbPath?: string;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { help: false };
  for (const raw of argv) {
    const [flag, value] = raw.split('=');
    switch (flag) {
      case '--as-of':
        args.asOf = value;
        break;
      case '--db':
        if (!value) throw new Error(`--db needs a path\n\n${USAGE}`);
        args.dbPath = value;
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
  npm run verify:registry -w server [-- --as-of=YYYY-MM-DD] [-- --db=<path>]

  --as-of=<date>   farm-local date to evaluate status against (default: today).
  --db=<path>      verify this database file instead of server/dairy.db. Opened
                   READ-ONLY and never migrated -- this is how a backup taken by
                   \`npm run registry:backup -w server\` gets checked.

Checks invariants 0-13 from docs/REGISTRY.md against server/dairy.db, then
prints the precision histogram and the calving-interval report. Needs no
running server.
`.trim();

/**
 * The handle to verify.
 *
 * `../db` is reached for through `require`, LAZILY, and this is the only reason
 * why: importing it at module scope opens dairy.db and RUNS ITS MIGRATIONS as an
 * import side effect. Under `--db` that would mean checking a backup while
 * silently migrating the live database -- and, since db.ts wires the
 * pre-migration hook, snapshotting it too. A verification pass must not have
 * side effects on a database it was not pointed at.
 *
 * A file given by path is opened read-only and deliberately NOT migrated: it may
 * be an older backup, and quietly upgrading a record you are trying to verify
 * destroys the thing you were checking. Pragmas still get applied and asserted,
 * because they are per-connection and the invariants depend on them.
 */
function openTarget(dbPath?: string): { db: Db; label: string } {
  if (!dbPath) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { db } = require('../db') as { db: Db };
    return { db, label: db.name };
  }
  // Resolved and existence-checked before opening, so a mistyped path names
  // itself. `npm run ... -w server` runs with cwd = server/, NOT the repo root,
  // so `--db=server/backups/x.db` -- the path you see from the repo root and the
  // obvious thing to type -- resolves to server/server/backups/x.db. Left to
  // better-sqlite3 that surfaces as "Cannot open database because the directory
  // does not exist", which names neither the path it tried nor the cwd.
  const resolved = path.resolve(expandHome(dbPath));
  if (!existsSync(resolved)) {
    throw new Error(
      `verify:registry: no such database '${resolved}'.\n` +
        `  --db was given '${dbPath}', resolved against cwd ${process.cwd()}.\n` +
        `  npm runs workspace scripts from server/, so a repo-root-relative path ` +
        `needs one fewer segment:\n` +
        `    npm run verify:registry -w server -- --db=backups/<file>.db`,
    );
  }
  const handle = new Database(resolved, { readonly: true });
  applyRegistryPragmas(handle);
  assertRegistryPragmas(handle);
  return { db: handle, label: `${resolved} (read-only)` };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const asOf = args.asOf ?? farmToday();
  const { db, label } = openTarget(args.dbPath);

  const version = db.pragma('user_version', { simple: true }) as number;
  if (version !== TARGET_VERSION) {
    // Reported, not fatal. Verifying an older backup against today's invariants
    // is a legitimate thing to do; being unaware that is what you are doing is
    // not, because a violation may be the schema gap rather than the data.
    console.log(
      `NOTE: ${label} is at user_version ${version}; this build targets ` +
        `${TARGET_VERSION}. Invariants below are today's rules applied to an ` +
        `older schema -- read violations with that in mind.\n`,
    );
  }

  const snap = snapshot(db);
  console.log(`verify:registry  as-of=${asOf}  db=${label}`);
  console.log(
    `  ${snap.animals.length} animal(s), ${snap.events.length} event(s), ` +
      `${snap.lactations.length} lactation(s)`,
  );
  if (snap.animals.length === 0) {
    console.log(
      '  NOTE: the registry is EMPTY, so every invariant passes vacuously. This is\n' +
        '  the expected state until the herd is backfilled -- it is not evidence that\n' +
        '  the checks work. registry.invariants.test.ts is what proves that.',
    );
  }
  console.log('');

  const dbSource = readFileSync(path.join(__dirname, '..', 'db.ts'), 'utf8');
  const violations = verifyAll(db, asOf, dbSource);

  // --- the two reported artifacts (never assertions) ------------------------

  console.log('Precision histogram (source_form x date_precision)');
  const hist = precisionHistogram(snap.events);
  if (hist.length === 0) {
    console.log('  (no events)');
  } else {
    for (const c of hist) {
      console.log(`  ${c.source_form.padEnd(18)} ${c.date_precision.padEnd(10)} ${c.count}`);
    }
    console.log(
      '  Read this, do not assert on it: invariants 11 and 12 catch INCONSISTENT\n' +
        '  precision; nothing can catch DISHONEST precision, which is a claim about the\n' +
        '  world. A backfill that comes out mostly day-precision `recall` is the signal\n' +
        '  worth acting on.',
    );
  }

  console.log('\nCalving intervals');
  const report = intervalReport(groupByAnimal(allEvents(db)));
  if (report.intervals.length === 0) {
    console.log('  (no animal has two or more calvings yet)');
  } else {
    for (const i of report.intervals) {
      console.log(
        `  ${i.animal_id}  #${i.ordinal}  ${i.from_on} -> ${i.to_on}  ` +
          `${String(i.days).padStart(4)}d  ${i.quality}`,
      );
    }
    for (const s of [report.measured, report.approximate]) {
      console.log(
        `  ${s.quality.padEnd(12)} n=${s.count}` +
          (s.count > 0
            ? `  mean ${s.mean_days}d  min ${s.min_days}d  max ${s.max_days}d`
            : ''),
      );
    }
  }
  console.log(`  ${report.caveat}`);

  // A third reported artifact, and the same kind of thing as the other two: a
  // number to read, asserting nothing, with nothing branching on it. It answers
  // the question the milk table exists to make answerable -- whether what has
  // been collected can carry the weight of a conclusion.
  console.log('\nMilk record completeness');
  const milk = milkingReport(snap.milkings, snap.lactations);
  if (milk.rows === 0) {
    console.log('  (no milking recorded yet)');
  } else {
    console.log(
      `  ${milk.rows} row(s) over ${milk.sessions} session(s), ` +
        `${milk.complete_sessions} complete   ${milk.first_on} -> ${milk.last_on}`,
    );
    console.log(
      `  measured ${milk.measured}   milked, not measured ${milk.milked_not_measured}   ` +
        `not milked ${milk.not_milked}`,
    );
    for (const c of milk.recent) {
      // `!` marks a session an animal in milk has no row in. Not a violation --
      // a gap is a legitimate thing to record -- but the thing worth seeing.
      const flag = c.recorded >= c.expected ? ' ' : '!';
      console.log(
        `  ${flag} ${c.occurred_on}  ${c.session.padEnd(8)} ` +
          `${String(c.recorded).padStart(3)}/${String(c.expected).padEnd(3)} recorded, ` +
          `${c.measured} measured`,
      );
    }
    console.log(`  ${milk.caveat}`);
  }

  // --- verdict --------------------------------------------------------------

  if (violations.length === 0) {
    console.log('\nAll invariants pass.');
    return;
  }

  console.log(`\n${violations.length} violation(s):\n`);
  for (const x of violations.sort((a, b) => a.invariant - b.invariant)) {
    console.log(`  [${x.invariant}] ${x.name}: ${x.detail}`);
  }
  if (violations.some((x) => x.invariant === 1)) {
    console.log(
      '\n  NOTE: invariant 1 also fires when stored projections are merely STALE --\n' +
        '  status depends on the as-of date, so an animal that aged past the calf\n' +
        '  threshold since the last rebuild differs legitimately. Run\n' +
        '  `npm run registry:rebuild -w server` and re-verify before treating it as a bug.',
    );
  }
  process.exitCode = 1;
}

if (require.main === module) main();
