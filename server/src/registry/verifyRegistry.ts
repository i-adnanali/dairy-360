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

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { db } from '../db';
import { canonicalOrder } from './project';
import { allEvents, snapshot } from './store';
import { intervalReport, precisionHistogram } from './intervals';
import { farmToday } from './time';
import { verifyAll } from './verify';
import type { RegistryEvent } from './types';

interface Args {
  asOf?: string;
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
  npm run verify:registry -w server [-- --as-of=YYYY-MM-DD]

  --as-of=<date>   farm-local date to evaluate status against (default: today).

Checks invariants 0-13 from docs/REGISTRY.md against server/dairy.db, then
prints the precision histogram and the calving-interval report. Needs no
running server.
`.trim();

function groupByAnimal(events: RegistryEvent[]): Map<string, RegistryEvent[]> {
  const out = new Map<string, RegistryEvent[]>();
  for (const e of canonicalOrder(events)) {
    const list = out.get(e.animal_id);
    if (list) list.push(e);
    else out.set(e.animal_id, [e]);
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const asOf = args.asOf ?? farmToday();

  const snap = snapshot(db);
  console.log(`verify:registry  as-of=${asOf}`);
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
