// Animal registry -- `registry:breed-backfill`, the breeding cases the owner picks.
//
//   npm run registry:breed-backfill -w server -- --file=cases.json --recorded-by=adnan [--save]
//
// A thin shell over checkBackfill / saveBackfill (breeding-backfill.ts), which
// hold every rule. Without --save it prints the report and writes nothing; with
// it, the whole file is written in one transaction or not at all.

import { readFileSync } from 'node:fs';

import { CliError, flagIsOn, parseFlags, rejectUnknownFlags, requireStr, runCli, wantsHelp } from './cli';
import { checkBackfill, saveBackfill } from './breeding-backfill';
import type { BackfillReport, BackfillRow } from './breeding-backfill';
import type { Db } from './schema';

const FLAGS = ['file', 'recorded-by', 'save'] as const;

export const BACKFILL_USAGE = `
Usage:
  npm run registry:breed-backfill -w server -- --file=<path> --recorded-by=<who> [--save]

Checks a JSON file of breeding cases, one animal per case, events written in the
order given. Every row goes through the same write path as registry:breed, so a
later row of a case is checked with the earlier ones already in place.

This command opens the registry database the other registry:* commands open --
in normal use that is the REAL one, server/dairy.db.

  --file=<path>        { "cases": [ { "animal_id", "source_form", "events": [...] } ] }
  --recorded-by=<id>   who is entering this backfill
  --save               write the file. A switch: bare or =true is on, =false is off.
                       Without it, nothing is written.

Each row reports one of:
  would_write          it will be written (with --save: it was)
  already_on_record    the same event is already on record; not written again
  refused              a refusal that has no override (code and message)
  needs_allow          a warning fired that the row's "allow" does not name

The exit code is non-zero when any row is refused or needs an allow, and then
--save writes nothing at all, not even the other rows.
`.trim();

export function parseBackfillArgs(argv: string[]): { file: string; recordedBy: string; save: boolean } {
  const flags = parseFlags(argv);
  rejectUnknownFlags(flags, FLAGS);
  return {
    file: requireStr(flags, 'file', 'the JSON file of cases'),
    recordedBy: requireStr(flags, 'recorded-by', 'who is entering this backfill'),
    save: flagIsOn(flags, 'save'),
  };
}

function describe(r: BackfillRow): string {
  const head = `  case ${r.case_index + 1} row ${r.event_index + 1}  ${r.animal_id}  ${r.type} on ${r.occurred_on}`;
  switch (r.outcome) {
    case 'would_write':
      return `${head}\n    would_write`;
    case 'already_on_record':
      return `${head}\n    already_on_record  ${r.event_id}`;
    case 'refused':
      return `${head}\n    refused  ${r.code}: ${r.message}`;
    case 'needs_allow':
      return `${head}\n    needs_allow\n${r.warnings.map((w) => `      ${w.check}: ${w.message}`).join('\n')}`;
  }
}

function printReport(report: BackfillReport): void {
  for (const r of report.rows) console.log(describe(r));
  const count = (o: BackfillRow['outcome']) => report.rows.filter((r) => r.outcome === o).length;
  console.log(
    `\n  ${count('would_write')} would_write, ${count('already_on_record')} already_on_record, ` +
      `${count('refused')} refused, ${count('needs_allow')} needs_allow`,
  );
}

/**
 * Returns the exit code. `handle` is for tests (an :memory: database); the
 * command itself opens dairy.db, and only once the arguments and file are read.
 */
export function backfillMain(argv: string[], handle?: Db): number {
  if (wantsHelp(parseFlags(argv))) {
    console.log(BACKFILL_USAGE);
    return 0;
  }
  const args = parseBackfillArgs(argv);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(args.file, 'utf8'));
  } catch (e) {
    throw new CliError(`cannot read ${args.file} as JSON: ${(e as Error).message}`);
  }

  // Importing usage/help must never open or migrate the farm database.
  const db = handle ?? (require('../db') as typeof import('../db')).db;

  console.log(`registry:breed-backfill  ${args.file}${args.save ? '  (--save)' : '  (check only, nothing written)'}`);
  if (!args.save) {
    const report = checkBackfill(db, raw, args.recordedBy);
    printReport(report);
    return report.clean ? 0 : 1;
  }
  const result = saveBackfill(db, raw, args.recordedBy);
  printReport(result.report);
  console.log(
    result.written
      ? `  written: ${result.event_ids.length} event(s) in one transaction`
      : '  nothing written: fix the refused rows, or name the warnings in "allow", and run again',
  );
  return result.written ? 0 : 1;
}

if (require.main === module) {
  runCli(() => {
    process.exitCode = backfillMain(process.argv.slice(2));
  });
}
