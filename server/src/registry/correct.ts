// Animal registry -- `registry:correct-calving`.
//
//   npm run registry:correct-calving -w server -- --event=aevt_... \
//     --on=2023-05-01 --precision=month --source-form=recall --recorded-by=adnan
//
// A thin shell over correctCalving(), which writes BOTH halves of a calving
// date correction in one transaction. Sibling of calve.ts; they share every
// validation rule via cli.ts but stay one-file-per-script, the convention every
// other command in this repo follows.

import {
  CliError,
  PROVENANCE_FLAGS,
  optStr,
  parseFlags,
  rejectUnknownFlags,
  requireDate,
  requirePrecision,
  requireProvenance,
  requireStr,
  runCli,
  wantsHelp,
} from './cli';
import { correctCalving } from './calving';
import { farmToday } from './time';
import type { CalvingAssistance } from './types';

const ASSISTANCE = ['none', 'assisted', 'vet'] as const;



const CORRECT_FLAGS = [
  'event',
  'on',
  'time',
  'precision',
  'assistance',
  'notes',
  'as-of',
  'allow-near-duplicate',
  ...PROVENANCE_FLAGS,
] as const;

export const CORRECT_USAGE = `
Usage:
  npm run registry:correct-calving -w server -- --event=<calving event id> \\
    --on=<corrected date> --precision=<p> --source-form=<form> --recorded-by=<who>

Corrects a calving's date by writing BOTH halves of the correction -- a
superseding calving on the dam and a superseding birth on the calf -- in one
transaction.

Correcting only the calving would leave the calf's birth event on the old date.
That FEELS complete (the dam's record now reads right) but leaves the two dates
divergent, which invariant 6 reports on the next verification run. This command
is why that cannot happen by hand.

Required:
  --event=aevt_...            the CURRENTLY EFFECTIVE calving event id
  --on=YYYY-MM-DD             the corrected date
  --precision=<p>             precision of the corrected date. NEVER defaulted.
  --source-form=<form>        typically 'recall' -- a date remembered better
  --recorded-by=<id>

Optional:
  --time=HH:MM                only valid with --precision=day
  --assistance=<a>            also correct assistance
  --notes=<text>              also correct notes
  --observed-by=<id>  --source-ref=<ref>  --as-of=YYYY-MM-DD
  --allow-near-duplicate

Nothing is ever UPDATEd or DELETEd: the old events remain in the log, marked
superseded, and the projections ignore them. Find the event id with
verify:registry or by querying registry_animal_events.
`.trim();

export function correctMain(argv: string[]): void {
  const flags = parseFlags(argv);
  if (wantsHelp(flags)) {
    console.log(CORRECT_USAGE);
    return;
  }
  rejectUnknownFlags(flags, CORRECT_FLAGS);

  const assistance = optStr(flags, 'assistance');
  if (assistance !== null && !(ASSISTANCE as readonly string[]).includes(assistance)) {
    throw new CliError(`--assistance must be one of ${ASSISTANCE.join(' | ')}`);
  }

  const asOf = optStr(flags, 'as-of') ?? farmToday();

  // Importing usage/help must never open or migrate the farm database.
  const { db } = require('../db') as typeof import('../db');
  const r = correctCalving(db, {
    calving_event_id: requireStr(flags, 'event', 'the calving event being corrected'),
    occurred_on: requireDate(flags, 'on', 'the corrected date'),
    occurred_time: optStr(flags, 'time'),
    date_precision: requirePrecision(flags),
    // `undefined` means "leave as it was"; an explicit flag means "change it".
    assistance: assistance === null ? undefined : (assistance as CalvingAssistance),
    notes: flags.has('notes') ? optStr(flags, 'notes') : undefined,
    provenance: requireProvenance(flags),
    asOf,
    allow_near_duplicate: flags.has('allow-near-duplicate'),
  });

  console.log('registry:correct-calving');
  console.log(`  dam         ${r.dam_id}`);
  console.log(`  calf        ${r.calf_id}`);
  console.log(`  superseded  calving ${r.superseded.calving_event_id}`);
  console.log(`              birth   ${r.superseded.birth_event_id}`);
  if (r.superseded.departure_event_id) {
    console.log(`              departure ${r.superseded.departure_event_id}`);
  }
  console.log(`  new         calving ${r.calving_event_id}`);
  console.log(`              birth   ${r.birth_event_id}`);
  if (r.departure_event_id) {
    console.log(`              departure ${r.departure_event_id}   (calf did not live)`);
  }
  console.log(`  as-of       ${asOf}`);
  console.log(
    `\n  ${r.departure_event_id ? 'All three events' : 'Both halves'} written. The superseded ` +
      'events remain in the log and are\n  ignored by every projection.',
  );
}

if (require.main === module) runCli(() => correctMain(process.argv.slice(2)));
