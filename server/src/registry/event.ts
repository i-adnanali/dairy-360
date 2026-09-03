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
import { appendEvent, eventsForAnimal, getAnimal } from './store';
import { effectiveEvents } from './project';
import { rebuildAnimals } from './projectStore';
import { farmToday } from './time';
import { RESERVED_EVENT_TYPES } from './types';
import type { DepartureReason, DryOffReason } from './types';

/** The types this command owns. */
const ENTERABLE = ['dry_off', 'departure', 'note'] as const;
type EnterableType = (typeof ENTERABLE)[number];

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
  const animal = getAnimal(db, animalId);
  if (!animal) {
    throw new CliError(
      `unknown registry animal '${animalId}'.\n` +
        '  List what exists with: npm run verify:registry -w server',
    );
  }

  const on = requireDate(flags, 'on', 'when it happened, farm-local');
  const precision = requirePrecision(flags);
  const time = optStr(flags, 'time');
  const provenance = requireProvenance(flags);
  const asOf = optStr(flags, 'as-of') ?? farmToday();

  // A departure is terminal. Writing anything but a note after one is almost
  // always a mistake -- an out-of-order backfill entry -- and invariant 5 would
  // report it later. Catch it here, where the operator can still fix it, and
  // allow the override for the genuine case (a sale recorded, then the dry-off
  // that preceded it remembered afterwards).
  const existing = effectiveEvents(eventsForAnimal(db, animalId));
  const departure = existing.find((e) => e.type === 'departure');
  if (departure && type !== 'note' && !flags.has('allow-after-departure')) {
    throw new CliError(
      `animal '${animalId}' departed on ${departure.occurred_on} (${departure.date_precision}), ` +
        `and departure is terminal.\n` +
        `  A '${type}' dated ${on} would violate invariant 5.\n` +
        '  If this event genuinely PRECEDES the departure and you are entering it out of\n' +
        '  order, that is fine -- check the date. If it genuinely follows, pass\n' +
        '  --allow-after-departure and expect verify:registry to flag it.',
    );
  }
  if (type === 'departure' && departure) {
    throw new CliError(
      `animal '${animalId}' already has a departure event on ${departure.occurred_on}. ` +
        'An animal leaves once.\n' +
        '  To correct the date, write a superseding event rather than a second departure.',
    );
  }

  const payload = buildPayload(type as EnterableType, flags);

  const result = db.transaction(() => {
    const event = appendEvent(db, {
      animal_id: animalId,
      type: type as EnterableType,
      occurred_on: on,
      occurred_time: time,
      date_precision: precision,
      payload,
      provenance,
    });
    rebuildAnimals(db, { asOf, animalIds: [animalId] });
    return event;
  }).immediate();

  const status = db
    .prepare(`SELECT status, parity, open_lactation_id FROM registry_animal_status WHERE animal_id = ?`)
    .get(animalId) as { status: string; parity: number; open_lactation_id: string | null };

  console.log(`registry:event  ${type} on ${animalId}`);
  console.log(`  occurred    ${on}${time ? ` ${time}` : ''} (${precision})`);
  console.log(`  provenance  ${provenance.source_form} / recorded_by=${provenance.recorded_by}`);
  console.log(`  event       ${result.id}`);
  console.log(
    `  status now  ${status.status}  parity ${status.parity}  ` +
      `open lactation ${status.open_lactation_id ?? '(none)'}   as-of ${asOf}`,
  );
}

function buildPayload(type: EnterableType, flags: ReturnType<typeof parseFlags>): unknown {
  switch (type) {
    case 'dry_off': {
      const reason = optStr(flags, 'reason');
      const allowed = ['scheduled', 'low_yield', 'health', 'other'];
      if (reason !== null && !allowed.includes(reason)) {
        throw new CliError(`--reason for dry_off must be one of ${allowed.join(' | ')}`);
      }
      return { reason: reason as DryOffReason | null, notes: optStr(flags, 'notes') };
    }
    case 'departure': {
      const reason = requireStr(flags, 'reason', 'sold | died | culled | lost');
      const allowed = ['sold', 'died', 'culled', 'lost'];
      if (!allowed.includes(reason)) {
        throw new CliError(`--reason for departure must be one of ${allowed.join(' | ')}`);
      }
      return {
        reason: reason as DepartureReason,
        to: optStr(flags, 'to'),
        cause: optStr(flags, 'cause'),
        notes: optStr(flags, 'notes'),
      };
    }
    case 'note':
      return { text: requireStr(flags, 'text', 'the note body') };
  }
}

if (require.main === module) runCli(() => main(process.argv.slice(2)));
