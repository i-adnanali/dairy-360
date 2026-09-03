// Animal registry -- `registry:add`, the pass-one backfill entry point.
//
//   npm run registry:add -w server -- \
//     --sex=female --acquired-on=2019-01-01 --precision=year \
//     --birth-on=2017-01-01 --birth-precision=year \
//     --source-form=recall --recorded-by=adnan --name=Noor
//
// Creates one `acquired` animal and its origin event, in one transaction.
//
// ---------------------------------------------------------------------------
// WHY THIS ONLY HANDLES `acquired`
// ---------------------------------------------------------------------------
// An animal's origin is either `birth` or `acquired`, exactly one of them, and
// a `born_on_farm` animal is created BY the calving that produced it --
// recordCalving allocates its serial, writes its birth event, and links it to
// its dam in the same transaction. Letting this command mint a `born_on_farm`
// animal would produce a calf with no dam edge and no calving on any dam, which
// invariants 6 and 7 would immediately reject and which nothing could repair,
// because no event would say who the dam was.
//
// So: pass one enters the animals that arrived from elsewhere; pass two
// (`registry:calve`) enters the calvings, oldest first, and the farm-born
// animals appear as a consequence. That is the two-pass order decision doc §11
// prescribes, enforced by which command exists rather than by a note.

import { db } from '../db';
import {
  CliError,
  PROVENANCE_FLAGS,
  optDate,
  optPrecision,
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
import { addAcquiredAnimal } from './entry';
import { farmToday } from './time';
import type { RegistrySex } from './types';

const FLAGS = [
  'sex',
  'name',
  'species',
  'acquired-on',
  'precision',
  'birth-on',
  'birth-precision',
  'from',
  'post-no',
  'tag-no',
  'notes',
  'as-of',
  ...PROVENANCE_FLAGS,
] as const;

export const USAGE = `
Usage:
  npm run registry:add -w server -- --sex=<female|male> --acquired-on=<date> \\
    --precision=<day|month|year|estimated> --source-form=<form> --recorded-by=<who> [options]

Creates one ACQUIRED animal and its origin event. Farm-born animals are created
by their dam's calving -- use registry:calve for those.

Required:
  --sex=female|male
  --acquired-on=YYYY-MM-DD    when the animal arrived on the farm
  --precision=<p>             precision of --acquired-on. NEVER defaulted.
  --source-form=<form>        daily_herd_sheet | cycle_card | direct_entry | import | recall
  --recorded-by=<id>          who typed this in

Birth date (optional, but precision is mandatory if you give one):
  --birth-on=YYYY-MM-DD       the animal's BIRTH date, not its acquisition date
  --birth-precision=<p>       required whenever --birth-on is given

Optional:
  --name=<name>               animals need not have one
  --species=<s>               default: buffalo
  --from=<where>              who it was acquired from
  --post-no=<n>  --tag-no=<n> attributes, not identity -- both change over a life
  --notes=<text>
  --observed-by=<id>          who saw it (omit for a purchase record)
  --source-ref=<ref>          the sheet date, card, or page number
  --as-of=YYYY-MM-DD          date to project status against (default: today)

Without a birth date the animal projects as heifer/male even if it is visibly a
calf -- the age rule cannot fire on a date that is not there. Entering an
estimated birth date is the fix, and the precision qualifier makes it safe.
`.trim();

export function main(argv: string[]): void {
  const flags = parseFlags(argv);
  if (wantsHelp(flags)) {
    console.log(USAGE);
    return;
  }
  rejectUnknownFlags(flags, FLAGS);

  const sex = requireStr(flags, 'sex', 'female | male');
  if (sex !== 'female' && sex !== 'male') {
    throw new CliError(`--sex must be female or male, got '${sex}'`);
  }

  const acquiredOn = requireDate(flags, 'acquired-on', 'when the animal arrived');
  const precision = requirePrecision(flags);
  const provenance = requireProvenance(flags);

  const birthOn = optDate(flags, 'birth-on');
  const birthPrecision = optPrecision(flags, 'birth-precision');
  const asOf = optStr(flags, 'as-of') ?? farmToday();

  // Every rule below this line lives in addAcquiredAnimal(). This file only
  // turns flags into an input object and prints the result.
  const result = addAcquiredAnimal(db, {
    sex: sex as RegistrySex,
    name: optStr(flags, 'name'),
    species: optStr(flags, 'species'),
    acquired_on: acquiredOn,
    date_precision: precision,
    birth_on: birthOn,
    birth_precision: birthPrecision,
    from: optStr(flags, 'from'),
    post_no: optStr(flags, 'post-no'),
    tag_no: optStr(flags, 'tag-no'),
    notes: optStr(flags, 'notes'),
    provenance,
    asOf,
  });

  const status = db
    .prepare(`SELECT status, birth_on, birth_precision FROM registry_animal_status WHERE animal_id = ?`)
    .get(result.animal_id) as { status: string; birth_on: string | null; birth_precision: string | null };

  console.log(`registry:add  ${result.animal_id}`);
  console.log(`  acquired    ${acquiredOn} (${precision})`);
  console.log(
    `  birth       ${status.birth_on ? `${status.birth_on} (${status.birth_precision})` : '(unknown)'}`,
  );
  console.log(`  status      ${status.status}   as-of ${asOf}`);
  console.log(`  provenance  ${provenance.source_form} / recorded_by=${provenance.recorded_by}`);
  console.log(`  event       ${result.event_id}`);
  if (!status.birth_on) {
    console.log(
      '\n  NOTE: no birth date, so this animal cannot project as `calf` -- the age rule\n' +
        '  has no date to test. Add one with an honest precision when you know it.',
    );
  }
}

if (require.main === module) runCli(() => main(process.argv.slice(2)));
