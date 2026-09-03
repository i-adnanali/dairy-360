// Animal registry -- `registry:event`, appending a life event to an animal.
//
//   npm run registry:event -w server -- --animal=BD-0001 --type=dry_off \
//     --on=2024-01-01 --precision=month --source-form=recall --recorded-by=adnan
//
//   npm run registry:event -w server -- --animal=BD-0004 --type=departure \
//     --on=2024-05-01 --precision=month --reason=sold --to="Chak 42 buyer" \
//     --source-form=recall --recorded-by=adnan
//
// Handles `dry_off`, `departure` and `note` -- the three life events with no
// cross-animal consequences.
//
// ---------------------------------------------------------------------------
// WHAT THIS DELIBERATELY WILL NOT WRITE
// ---------------------------------------------------------------------------
//   calving          -> registry:calve. It creates an animal and links a
//                       pedigree edge; a bare appendEvent would produce a
//                       calving naming a calf that does not exist.
//   birth, acquired  -> origin events, exactly one per animal. `acquired` comes
//                       from registry:add, `birth` from registry:calve.
//   the ten reserved -> rejected by assertEventPayload, and rejected here with
//                       a message naming the cycle they belong to, rather than
//                       a generic "unknown type".
//
// Each refusal names the command to use instead. An operator hitting the wrong
// one mid-backfill should be redirected, not just stopped.

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
import { ENTERABLE_EVENT_TYPES, appendLifeEvent } from './entry';
import type { EnterableEventType } from './entry';
import { farmToday } from './time';
import { RESERVED_EVENT_TYPES } from './types';

/** The types this command owns -- the core's list, not a second copy of it. */
const ENTERABLE = ENTERABLE_EVENT_TYPES;

const FLAGS = [
  'animal',
  'type',
  'on',
  'time',
  'precision',
  'reason',
  'to',
  'cause',
  'text',
  'notes',
  'as-of',
  'allow-after-departure',
  ...PROVENANCE_FLAGS,
] as const;

export const USAGE = `
Usage:
  npm run registry:event -w server -- --animal=<serial> --type=<type> --on=<date> \\
    --precision=<p> --source-form=<form> --recorded-by=<who> [options]

Types this command writes:
  dry_off     --reason=scheduled|low_yield|health|other  (optional)
  departure   --reason=sold|died|culled|lost             (REQUIRED)
              --to=<where>  --cause=<what>               (optional)
  note        --text="..."                               (REQUIRED)

Required for all:
  --animal=BD-0001            an existing registry animal
  --on=YYYY-MM-DD             farm-local date the thing happened
  --precision=<p>             day | month | year | estimated. NEVER defaulted.
  --source-form=<form>        daily_herd_sheet | cycle_card | direct_entry | import | recall
  --recorded-by=<id>          who typed this in

Optional:
  --time=HH:MM                only valid with --precision=day
  --notes=<text>
  --observed-by=<id>  --source-ref=<ref>
  --as-of=YYYY-MM-DD          date to project status against (default: today)
  --allow-after-departure     override the terminal-departure guard (a note is
                              always allowed after departure and needs no flag)

Not handled here, on purpose:
  calving           -> npm run registry:calve
  birth, acquired   -> origin events: registry:calve / registry:add
`.trim();

export function main(argv: string[]): void {
  const flags = parseFlags(argv);
  if (wantsHelp(flags)) {
    console.log(USAGE);
    return;
  }
  rejectUnknownFlags(flags, FLAGS);

  const type = requireStr(flags, 'type', ENTERABLE.join(' | '));

  if (type === 'calving') {
    throw new CliError(
      'a calving is not entered here.\n' +
        '  It creates an animal (the calf), allocates its serial, writes its birth event\n' +
        '  and links its dam -- all in one transaction. Use:\n' +
        '    npm run registry:calve -w server -- --help',
    );
  }
  if (type === 'birth' || type === 'acquired') {
    throw new CliError(
      `'${type}' is an ORIGIN event, and an animal has exactly one.\n` +
        (type === 'acquired'
          ? '  Use: npm run registry:add -w server -- --help\n'
          : '  A birth event is written by the calving that produced the calf:\n' +
            '    npm run registry:calve -w server -- --help\n') +
        '  To correct an existing origin event, write a superseding event rather than a\n' +
        '  second one.',
    );
  }
  if ((RESERVED_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new CliError(
      `'${type}' is a RESERVED event type: named in the taxonomy so it is designed\n` +
        '  once rather than accreted, but not implemented in this cycle. Breeding and\n' +
        '  heat events are step 5; treatments and null-observations arrive with sheet\n' +
        '  transcription at step 3. See docs/REGISTRY.md, Decision 8.',
    );
  }
  if (!(ENTERABLE as readonly string[]).includes(type)) {
    throw new CliError(`--type='${type}' is not an event type. One of: ${ENTERABLE.join(' | ')}`);
  }

  const animalId = requireStr(flags, 'animal', 'e.g. BD-0001');
  const asOf = optStr(flags, 'as-of') ?? farmToday();

  // Every rule below this line lives in appendLifeEvent(): the unknown-animal
  // check, the terminal-departure guard, the one-departure rule, and payload
  // validation. This file only turns flags into an input object.
  //
  // The refusals ABOVE stay here on purpose -- they are about which command you
  // invoked, and their messages name the command to use instead, which is a
  // fact about this transport rather than about the herd.
  const result = appendLifeEvent(db, {
    animal_id: animalId,
    type: type as EnterableEventType,
    occurred_on: requireDate(flags, 'on', 'when it happened, farm-local'),
    occurred_time: optStr(flags, 'time'),
    date_precision: requirePrecision(flags),
    reason: optStr(flags, 'reason'),
    to: optStr(flags, 'to'),
    cause: optStr(flags, 'cause'),
    text: optStr(flags, 'text'),
    notes: optStr(flags, 'notes'),
    provenance: requireProvenance(flags),
    asOf,
    allow_after_departure: flags.has('allow-after-departure'),
  });

  const status = db
    .prepare(`SELECT status, parity, open_lactation_id FROM registry_animal_status WHERE animal_id = ?`)
    .get(animalId) as { status: string; parity: number; open_lactation_id: string | null };

  console.log(`registry:event  ${type} on ${animalId}`);
  console.log(`  event       ${result.event_id}`);
  console.log(
    `  status now  ${status.status}  parity ${status.parity}  ` +
      `open lactation ${status.open_lactation_id ?? '(none)'}   as-of ${asOf}`,
  );
}

if (require.main === module) runCli(() => main(process.argv.slice(2)));
