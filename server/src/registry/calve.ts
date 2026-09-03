// Animal registry -- `registry:calve`, pass two of the backfill.
//
//   npm run registry:calve -w server -- --dam=BD-0001 --on=2023-04-01 \
//     --precision=month --calf-sex=female --outcome=live \
//     --source-form=recall --recorded-by=adnan
//
// A thin shell over recordCalving(). All the atomicity and validation lives
// there and is tested there; this file adds argument parsing and a readable
// summary, nothing else. Its sibling is correct.ts (registry:correct-calving).
//
// Enter calvings OLDEST FIRST (decision doc §11). Each one creates its calf, so
// entering them in order means a farm-born animal exists before anything can
// refer to it -- and it keeps the serial sequence roughly chronological, which
// is not required but makes the herd list far easier to read by eye.

import { db } from '../db';
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
import { recordCalving } from './calving';
import { farmToday } from './time';
import type { CalvingAssistance, CalvingOutcome, RegistrySex } from './types';

const OUTCOMES = ['live', 'stillborn', 'died_within_24h'] as const;
const ASSISTANCE = ['none', 'assisted', 'vet'] as const;

// ---------------------------------------------------------------------------
// registry:calve
// ---------------------------------------------------------------------------

const CALVE_FLAGS = [
  'dam',
  'on',
  'time',
  'precision',
  'calf-sex',
  'calf-name',
  'outcome',
  'sire-ref',
  'assistance',
  'notes',
  'as-of',
  'allow-near-duplicate',
  ...PROVENANCE_FLAGS,
] as const;

export const CALVE_USAGE = `
Usage:
  npm run registry:calve -w server -- --dam=<serial> --on=<date> --precision=<p> \\
    --calf-sex=<female|male> --outcome=<outcome> --source-form=<form> --recorded-by=<who>

Records a calving: the event on the dam, the calf as a new animal, the calf's
birth event, the dam parentage edge, and the lactation -- one transaction.

Required:
  --dam=BD-0001               an existing female registry animal
  --on=YYYY-MM-DD             farm-local calving date
  --precision=<p>             day | month | year | estimated. NEVER defaulted.
  --calf-sex=female|male
  --outcome=<o>               ${OUTCOMES.join(' | ')}
  --source-form=<form>        daily_herd_sheet | cycle_card | direct_entry | import | recall
  --recorded-by=<id>

Optional:
  --time=HH:MM                only valid with --precision=day
  --calf-name=<name>
  --sire-ref=<text>           free text -- an outside bull is not a registry animal
  --assistance=<a>            ${ASSISTANCE.join(' | ')}
  --notes=<text>
  --observed-by=<id>  --source-ref=<ref>
  --as-of=YYYY-MM-DD
  --allow-near-duplicate      accept a calving within 60 days of an existing one

A stillborn or died_within_24h calf is STILL created, still gets a birth event,
and still opens the lactation -- it counts toward parity and toward the calving
interval. Enter calvings oldest first.
`.trim();

export function calveMain(argv: string[]): void {
  const flags = parseFlags(argv);
  if (wantsHelp(flags)) {
    console.log(CALVE_USAGE);
    return;
  }
  rejectUnknownFlags(flags, CALVE_FLAGS);

  const calfSex = requireStr(flags, 'calf-sex', 'female | male');
  if (calfSex !== 'female' && calfSex !== 'male') {
    throw new CliError(`--calf-sex must be female or male, got '${calfSex}'`);
  }
  const outcome = requireStr(flags, 'outcome', OUTCOMES.join(' | '));
  if (!(OUTCOMES as readonly string[]).includes(outcome)) {
    throw new CliError(`--outcome must be one of ${OUTCOMES.join(' | ')}, got '${outcome}'`);
  }
  const assistance = optStr(flags, 'assistance');
  if (assistance !== null && !(ASSISTANCE as readonly string[]).includes(assistance)) {
    throw new CliError(`--assistance must be one of ${ASSISTANCE.join(' | ')}`);
  }

  const asOf = optStr(flags, 'as-of') ?? farmToday();

  const r = recordCalving(db, {
    dam_id: requireStr(flags, 'dam', 'e.g. BD-0001'),
    occurred_on: requireDate(flags, 'on', 'the calving date'),
    occurred_time: optStr(flags, 'time'),
    date_precision: requirePrecision(flags),
    calf: {
      sex: calfSex as RegistrySex,
      name: optStr(flags, 'calf-name'),
      outcome: outcome as CalvingOutcome,
    },
    sire_ref: optStr(flags, 'sire-ref'),
    assistance: assistance as CalvingAssistance | null,
    notes: optStr(flags, 'notes'),
    provenance: requireProvenance(flags),
    asOf,
    allow_near_duplicate: flags.has('allow-near-duplicate'),
  });

  const rows = db
    .prepare(
      `SELECT animal_id, status, parity, open_lactation_id
         FROM registry_animal_status WHERE animal_id IN (?, ?) ORDER BY animal_id`,
    )
    .all(requireStr(flags, 'dam', ''), r.calf_id) as {
    animal_id: string;
    status: string;
    parity: number;
    open_lactation_id: string | null;
  }[];

  console.log(`registry:calve  calf ${r.calf_id}`);
  console.log(`  calving     ${r.calving_event_id}`);
  console.log(`  birth       ${r.birth_event_id}`);
  if (r.departure_event_id) {
    console.log(`  departure   ${r.departure_event_id}   (${outcome} -- the calf still exists)`);
  }
  for (const row of rows) {
    console.log(
      `  ${row.animal_id.padEnd(10)} ${row.status.padEnd(10)} parity ${row.parity}  ` +
        `open lactation ${row.open_lactation_id ?? '(none)'}`,
    );
  }
  console.log(`  as-of       ${asOf}`);
}

if (require.main === module) runCli(() => calveMain(process.argv.slice(2)));
