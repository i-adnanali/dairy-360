// Animal registry -- the domain core for animal entry and life events.
//
// Extracted from add.ts and event.ts, which had this logic inline against the
// imported `db` singleton. That made it unreachable from anything but a CLI --
// no route could call it, no test could exercise it against `:memory:`, and in
// fact NOTHING tested it: the only test touching those files imported their
// USAGE strings.
//
// These functions take an explicit `db` handle, like recordCalving and
// correctCalving already did, and throw RegistryError (code + field + prose)
// rather than CliError, because these are rules about the herd and they hold
// whichever transport is asking.
//
// What stayed in the CLI: argument parsing, and the mis-routing hints that name
// a specific command ("use registry:calve"). Those are about which command you
// invoked, not about the animals.

import type { Db } from './schema';
import { RegistryError } from './errors';
import { assertDatePrecision } from './events';
import { effectiveEvents } from './project';
import { rebuildAnimals } from './projectStore';
import { allocateSerial, appendEvent, eventsForAnimal, getAnimal, insertAnimal } from './store';
import type {
  DatePrecision,
  DepartureReason,
  DryOffReason,
  OverrideRecord,
  Provenance,
  RegistrySex,
} from './types';

// ---------------------------------------------------------------------------
// Adding an acquired animal
// ---------------------------------------------------------------------------

export interface AddAcquiredAnimalInput {
  sex: RegistrySex;
  name?: string | null;
  species?: string | null;
  /** When the animal arrived on the farm. NOT its birth date. */
  acquired_on: string;
  date_precision: DatePrecision;
  /**
   * The animal's BIRTH date, if known. Optional -- but its precision is not
   * optional when it is given, which is the rule this pair enforces.
   */
  birth_on?: string | null;
  birth_precision?: DatePrecision | null;
  from?: string | null;
  post_no?: string | null;
  tag_no?: string | null;
  notes?: string | null;
  provenance: Provenance;
  asOf: string;
}

export interface AddAcquiredAnimalResult {
  animal_id: string;
  event_id: string;
}

/**
 * Create one `acquired` animal and its origin event, in one transaction.
 *
 * ONLY `acquired`. A farm-born animal is created BY the calving that produced
 * it -- recordCalving allocates its serial, writes its birth event and links it
 * to its dam in the same transaction. Minting a `born_on_farm` animal here
 * would produce a calf with no dam edge and no calving on any dam, which
 * invariants 6 and 7 reject and which nothing could repair, because no event
 * would say who the dam was.
 *
 * The transaction matters: an animal row without its origin event would violate
 * invariant 3 and could not be corrected, since there would be nothing to
 * supersede.
 */
export function addAcquiredAnimal(
  db: Db,
  input: AddAcquiredAnimalInput,
): AddAcquiredAnimalResult {
  if (input.sex !== 'female' && input.sex !== 'male') {
    throw new RegistryError(
      'invalid_payload',
      `sex must be 'female' or 'male', got '${String(input.sex)}'`,
      'sex',
    );
  }

  assertDatePrecision({
    occurred_on: input.acquired_on,
    date_precision: input.date_precision,
  });

  const birthOn = input.birth_on ?? null;
  const birthPrecision = input.birth_precision ?? null;

  // Precision is never defaulted, and a birth date is exactly where `day` would
  // be invented. Checked as a PAIR because either half alone is meaningless.
  if (birthOn !== null && birthPrecision === null) {
    throw new RegistryError(
      'precision_not_defaulted',
      'a birth date was given without its precision. Precision is never defaulted, and a ' +
        'birth date is exactly where `day` would be invented. State `year` or `estimated` ' +
        'if that is what you know -- an animal born `estimated 2021` is more useful than ' +
        'one born a confident, fabricated `2021-04-12`, because only the first can be ' +
        'corrected without someone first discovering it was wrong.',
      'birth_precision',
    );
  }
  if (birthOn === null && birthPrecision !== null) {
    throw new RegistryError(
      'invalid_payload',
      'a birth precision was given without a birth date',
      'birth_on',
    );
  }
  if (birthOn !== null && birthPrecision !== null) {
    // The stored-date conventions apply to the birth date too, even though it
    // lives in a payload rather than in occurred_on -- otherwise `estimated
    // 2021-04-12` could enter through this field while being rejected on every
    // other one.
    assertDatePrecision({ occurred_on: birthOn, date_precision: birthPrecision });
  }

  return db.transaction((): AddAcquiredAnimalResult => {
    const id = allocateSerial(db);
    insertAnimal(db, {
      id,
      name: input.name ?? null,
      sex: input.sex,
      species: input.species ?? 'buffalo',
      origin: 'acquired',
      post_no: input.post_no ?? null,
      tag_no: input.tag_no ?? null,
    });
    const event = appendEvent(db, {
      animal_id: id,
      type: 'acquired',
      occurred_on: input.acquired_on,
      date_precision: input.date_precision,
      payload: {
        from: input.from ?? null,
        estimated_birth_on: birthOn,
        estimated_birth_precision: birthPrecision,
        notes: input.notes ?? null,
      },
      provenance: input.provenance,
    });
    rebuildAnimals(db, { asOf: input.asOf, animalIds: [id] });
    return { animal_id: id, event_id: event.id };
  }).immediate();
}

// ---------------------------------------------------------------------------
// Appending a life event
// ---------------------------------------------------------------------------

/** The three life events with no cross-animal consequences. */
export const ENTERABLE_EVENT_TYPES = ['dry_off', 'departure', 'note'] as const;
export type EnterableEventType = (typeof ENTERABLE_EVENT_TYPES)[number];

const DRY_OFF_REASONS = ['scheduled', 'low_yield', 'health', 'other'] as const;
const DEPARTURE_REASONS = ['sold', 'died', 'culled', 'lost'] as const;

export interface AppendLifeEventInput {
  animal_id: string;
  type: EnterableEventType;
  occurred_on: string;
  occurred_time?: string | null;
  date_precision: DatePrecision;
  /** dry_off: optional. departure: REQUIRED. */
  reason?: string | null;
  to?: string | null;
  cause?: string | null;
  /** note: REQUIRED. */
  text?: string | null;
  notes?: string | null;
  provenance: Provenance;
  asOf: string;
  /**
   * Write a non-note event after a departure anyway.
   *
   * Required rather than advisory: an out-of-order backfill entry is the
   * realistic case, and the guard is what turns "invariant 5 will report this
   * later" into "fix the date now, while you remember".
   */
  allow_after_departure?: boolean;
  /** Free text recorded alongside an exercised override. Optional. */
  override_reason?: string | null;
}

export interface AppendLifeEventResult {
  event_id: string;
}

/**
 * Append one `dry_off`, `departure` or `note` to an existing animal, and
 * rebuild its projections. One transaction.
 *
 * Deliberately cannot write `calving` (it creates an animal), `birth` or
 * `acquired` (origin events, exactly one per animal). Those refusals live here
 * as a backstop; the CLI adds the hint naming the right command.
 */
export function appendLifeEvent(
  db: Db,
  input: AppendLifeEventInput,
): AppendLifeEventResult {
  if (!(ENTERABLE_EVENT_TYPES as readonly string[]).includes(input.type)) {
    throw new RegistryError(
      'invalid_payload',
      `'${String(input.type)}' cannot be entered as a life event. This path writes ` +
        `${ENTERABLE_EVENT_TYPES.join(', ')} only: a calving creates an animal, and birth ` +
        `and acquired are origin events with exactly one per animal.`,
      'type',
    );
  }

  const animal = getAnimal(db, input.animal_id);
  if (!animal) {
    throw new RegistryError(
      'unknown_animal',
      `unknown registry animal '${input.animal_id}'`,
      'animal_id',
    );
  }

  assertDatePrecision({
    occurred_on: input.occurred_on,
    occurred_time: input.occurred_time ?? null,
    date_precision: input.date_precision,
  });

  const existing = effectiveEvents(eventsForAnimal(db, input.animal_id));
  const departure = existing.find((e) => e.type === 'departure');

  // An animal leaves once. A second departure is not a correction -- a
  // correction supersedes.
  if (input.type === 'departure' && departure) {
    throw new RegistryError(
      'already_departed',
      `animal '${input.animal_id}' already has a departure event on ` +
        `${departure.occurred_on}. An animal leaves once. To correct the date, write a ` +
        `superseding event rather than a second departure.`,
      'occurred_on',
    );
  }

  // Departure is terminal. A note is always allowed after one -- somebody
  // ringing about a sold animal is a real thing to record.
  if (departure && input.type !== 'note' && !input.allow_after_departure) {
    throw new RegistryError(
      'animal_departed',
      `animal '${input.animal_id}' departed on ${departure.occurred_on} ` +
        `(${departure.date_precision}), and departure is terminal. A '${input.type}' dated ` +
        `${input.occurred_on} would violate invariant 5. If this event genuinely PRECEDES ` +
        `the departure and you are entering it out of order, check the date. If it ` +
        `genuinely follows, allow it explicitly and expect verify:registry to flag it.`,
      'occurred_on',
    );
  }

  // ONLY when the guard was actually stepped past, which is not the same as
  // the flag being set. A caller that always passes allow_after_departure --
  // a script, or a form that sends it unconditionally -- must not have every
  // write claim an override happened. The override is a fact about THIS write
  // meeting THIS guard, so it is recorded from the condition, not the input.
  const overrode =
    departure !== undefined && input.type !== 'note' && input.allow_after_departure === true;

  const payload = buildLifeEventPayload(input, overrode);

  const event = db.transaction(() => {
    const written = appendEvent(db, {
      animal_id: input.animal_id,
      type: input.type,
      occurred_on: input.occurred_on,
      occurred_time: input.occurred_time ?? null,
      date_precision: input.date_precision,
      payload,
      provenance: input.provenance,
    });
    rebuildAnimals(db, { asOf: input.asOf, animalIds: [input.animal_id] });
    return written;
  }).immediate();

  return { event_id: event.id };
}

function buildLifeEventPayload(
  input: AppendLifeEventInput,
  overrode: boolean,
): unknown {
  const override: OverrideRecord | null = overrode
    ? { check: 'animal_departed', reason: input.override_reason ?? null }
    : null;

  switch (input.type) {
    case 'dry_off': {
      const reason = input.reason ?? null;
      if (reason !== null && !(DRY_OFF_REASONS as readonly string[]).includes(reason)) {
        throw new RegistryError(
          'invalid_payload',
          `dry_off reason must be one of ${DRY_OFF_REASONS.join(' | ')}, got '${reason}'`,
          'reason',
        );
      }
      return { reason: reason as DryOffReason | null, notes: input.notes ?? null, override };
    }
    case 'departure': {
      const reason = input.reason ?? null;
      if (reason === null) {
        throw new RegistryError(
          'invalid_payload',
          `a departure needs a reason: one of ${DEPARTURE_REASONS.join(' | ')}`,
          'reason',
        );
      }
      if (!(DEPARTURE_REASONS as readonly string[]).includes(reason)) {
        throw new RegistryError(
          'invalid_payload',
          `departure reason must be one of ${DEPARTURE_REASONS.join(' | ')}, got '${reason}'`,
          'reason',
        );
      }
      return {
        reason: reason as DepartureReason,
        to: input.to ?? null,
        cause: input.cause ?? null,
        notes: input.notes ?? null,
        override,
      };
    }
    case 'note': {
      const text = input.text ?? null;
      if (text === null || text.length === 0) {
        throw new RegistryError('invalid_payload', 'a note needs text', 'text');
      }
      return { text };
    }
  }
}
