// Animal registry -- `registry:breed`, appending a breeding event to a female.
//
//   npm run registry:breed -w server -- --animal=BD-0001 --type=insemination \
//     --on=2026-01-20 --precision=day --service=ai \
//     --source-form=recall --recorded-by=adnan
//
// Five types: heat_observed, insemination, pregnancy_check, abortion,
// null_observation. The rules live in recordBreedingEvent() (breeding.ts); this
// file only turns flags into an input object and prints what the herd looks like
// afterwards. The refusals are about things that cannot have happened and have no
// override; the three breeding warnings (breeding-checks.ts) have an --allow-* flag.

import {
  CliError,
  PROVENANCE_FLAGS,
  optDate,
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
import type { Flags } from './cli';
import { BREEDING_EVENT_TYPES } from './types';
import type { BreedingEventType } from './types';
import { farmToday } from './time';

const FLAGS = [
  'animal',
  'type',
  'on',
  'time',
  'precision',
  'service',
  'days',
  'method',
  'result',
  'sign',
  'watched-for',
  'as-of',
  'supersedes',
  'allow-ambiguous-service',
  'allow-early-check',
  'allow-check-without-service',
  'override-reason',
  ...PROVENANCE_FLAGS,
] as const;

export const USAGE = `
Usage:
  npm run registry:breed -w server -- --animal=<serial> --type=<type> --on=<date> \\
    --precision=<p> --source-form=<form> --recorded-by=<who> [options]

Types this command writes:
  heat_observed     --sign=standing|mucus|restless|other          (REQUIRED)
  insemination      --service=ai|natural_observed|bull_exposure   (REQUIRED)
                    --days=<1..365>  how long the bull stayed     (bull_exposure only, REQUIRED)
  pregnancy_check   --method=palpation|ultrasound|pag|progesterone (REQUIRED)
                    --result=positive|negative                    (REQUIRED)
  abortion          no type flags
  null_observation  --watched-for=heat|pregnancy_check            (REQUIRED)

Required for all:
  --animal=BD-0001            an existing FEMALE registry animal
  --on=YYYY-MM-DD             farm-local date the thing happened
  --precision=<p>             day | month. NEVER defaulted. A pregnancy_check is day only;
                              year and estimated are refused.
  --source-form=<form>        daily_herd_sheet | cycle_card | direct_entry | import | recall
  --recorded-by=<id>          who typed this in

Optional:
  --time=HH:MM                only with --precision=day, and not with a bull_exposure
  --observed-by=<id>  --source-ref=<ref>
  --as-of=YYYY-MM-DD          date to read her state at (default: today)
  --supersedes=<event id>     correct that earlier event of hers: same animal, same type, once per
                              event (correct the replacement to correct again). A wrong event cannot
                              be retracted, only replaced by a corrected one of the same type.

  --allow-ambiguous-service   save a service that joins an earlier service's case
  --allow-early-check         save a check before its method can be relied on
  --allow-check-without-service
                              save a check with no service on or before it
  --override-reason=<text>    kept with an override that happened. A flag with nothing to
                              override records nothing.

Refused: an unknown animal, an animal that is not female, a
precision a breeding event cannot have, a date before she arrived or was born, and a
date after she left, and for --supersedes an unknown event (or one on another animal), a
different type, or an event already corrected. Those cannot be overridden; the three
warnings above can.
`.trim();

const choice = (flags: Flags, name: string, allowed: readonly string[]): string => {
  const v = requireStr(flags, name, allowed.join(' | '));
  if (!allowed.includes(v)) {
    throw new CliError(`--${name}='${v}' is not valid. One of: ${allowed.join(' | ')}`);
  }
  return v;
};

/**
 * The payload for a type, from its flags. Pure: no database, so it is tested
 * without one. Flags that belong to another type are refused rather than ignored.
 */
export function buildBreedingPayload(type: BreedingEventType, flags: Flags): Record<string, unknown> {
  const owned: Record<BreedingEventType, string[]> = {
    heat_observed: ['sign'],
    insemination: ['service', 'days'],
    pregnancy_check: ['method', 'result'],
    abortion: [],
    null_observation: ['watched-for'],
  };
  const stray = ['sign', 'service', 'days', 'method', 'result', 'watched-for'].filter(
    (f) => flags.has(f) && !owned[type].includes(f),
  );
  if (stray.length > 0) {
    throw new CliError(`${stray.map((f) => `--${f}`).join(', ')} does not apply to --type=${type}`);
  }
  switch (type) {
    case 'heat_observed':
      return { sign: choice(flags, 'sign', ['standing', 'mucus', 'restless', 'other']) };
    case 'insemination': {
      const service_type = choice(flags, 'service', ['ai', 'natural_observed', 'bull_exposure']);
      const days = optStr(flags, 'days');
      if (service_type !== 'bull_exposure') {
        if (days !== null) throw new CliError('--days is only for --service=bull_exposure');
        return { service_type };
      }
      if (days === null || !/^\d+$/.test(days)) {
        throw new CliError('--days=<whole number of days the bull stayed> is REQUIRED for --service=bull_exposure');
      }
      return { service_type, exposure_days: Number(days) };
    }
    case 'pregnancy_check':
      return {
        method: choice(flags, 'method', ['palpation', 'ultrasound', 'pag', 'progesterone']),
        result: choice(flags, 'result', ['positive', 'negative']),
      };
    case 'abortion':
      return {};
    case 'null_observation':
      return { watched_for: choice(flags, 'watched-for', ['heat', 'pregnancy_check']) };
  }
}

/** The --supersedes flag: an event id, or null when absent. Pure, tested without a database. */
export function buildSupersedesId(flags: Flags): string | null {
  if (!flags.has('supersedes')) return null;
  const v = optStr(flags, 'supersedes');
  if (v === null || v.trim() === '') throw new CliError('--supersedes=<event id> needs the id of the event to correct');
  return v;
}

export function main(argv: string[]): void {
  const flags = parseFlags(argv);
  if (wantsHelp(flags)) {
    console.log(USAGE);
    return;
  }
  rejectUnknownFlags(flags, FLAGS);

  const type = requireStr(flags, 'type', BREEDING_EVENT_TYPES.join(' | '));
  if (!(BREEDING_EVENT_TYPES as readonly string[]).includes(type)) {
    throw new CliError(`--type='${type}' is not a breeding event type. One of: ${BREEDING_EVENT_TYPES.join(' | ')}`);
  }
  const breedingType = type as BreedingEventType;
  const animalId = requireStr(flags, 'animal', 'e.g. BD-0001');
  // Validated with the other flags, before anything is written.
  const asOf = optDate(flags, 'as-of') ?? farmToday();
  const input = {
    animal_id: animalId,
    type: breedingType,
    occurred_on: requireDate(flags, 'on', 'when it happened, farm-local'),
    occurred_time: optStr(flags, 'time'),
    date_precision: requirePrecision(flags),
    payload: buildBreedingPayload(breedingType, flags),
    provenance: requireProvenance(flags),
    supersedes_id: buildSupersedesId(flags),
    allow_ambiguous_service: flags.has('allow-ambiguous-service'),
    allow_early_check: flags.has('allow-early-check'),
    allow_check_without_service: flags.has('allow-check-without-service'),
    override_reason: optStr(flags, 'override-reason'),
  };

  // Importing usage/help must never open or migrate the farm database.
  const { db } = require('../db') as typeof import('../db');
  const { recordBreedingEvent } = require('./breeding') as typeof import('./breeding');
  const { animalDetail } = require('./reads') as typeof import('./reads');

  const result = recordBreedingEvent(db, input);

  // The same read the API gives the page, so the two cannot disagree: null for an
  // animal with no service by --as-of, or one that had left by then.
  const view = animalDetail(db, animalId, { breeding: true, asOf })?.reproduction ?? null;

  console.log(`registry:breed  ${type} on ${animalId}`);
  console.log(`  event       ${result.event_id}`);
  if (input.supersedes_id) console.log(`  superseded  ${input.supersedes_id}`);
  console.log(
    view
      ? `  state now   ${view.state} (${view.basis})  day ${view.day_min}-${view.day_max}   as-of ${asOf}`
      : `  state now   none (no service on record, or she had left)   as-of ${asOf}`,
  );
}

if (require.main === module) runCli(() => main(process.argv.slice(2)));
