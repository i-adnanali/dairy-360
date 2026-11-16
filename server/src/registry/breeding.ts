// Animal registry -- the one write path for breeding events.
//
// Four refusals about the event as written, in this order:
//
//   unknown_animal       no such animal                                  animal_id
//   not_female           the animal's sex is not female                  animal_id
//   breeding_precision   a precision a breeding event cannot have        date_precision
//   event_before_origin / animal_departed
//                        definitely before her origin event; or her      occurred_on
//                        departure is definitely before the date
//
// Then, only when supersedes_id is set, three correction refusals (field
// supersedes_id): unknown_event (no such event, or on another animal),
// supersede_type_mismatch (a correction keeps the type), already_superseded
// (correct the replacement instead). There is no retraction: a correction is
// always an event of the same type on the same animal.
//
// Both date comparisons use definitelyBefore, so an uncertain date never refuses.
//
// After those, three warnings the caller can save over (see breeding-checks.ts):
// ambiguous_service on a service, early_check and check_without_service on a
// check. A warning throws as a RegistryError of the same name unless the matching
// allow_* flag is true, in which case the event is written and records the
// override from the CONDITION: a flag with nothing to override records nothing.
//
// No projection rebuild: no existing projection reads these events.

import type { Db } from './schema';
import { RegistryError } from './errors';
import { breedingWarning } from './breeding-checks';
import { assertDatePrecision, assertEventPayload } from './events';
import { definitelyBefore } from './invariants';
import { canonicalOrder, effectiveEvents, findOrigin } from './project';
import { appendEvent, eventsForAnimal, getAnimal } from './store';
import type { BreedingEventType, BreedingOverriddenCheck, DatePrecision, Provenance, RegistryEvent } from './types';

export interface RecordBreedingEventInput {
  animal_id: string;
  type: BreedingEventType;
  occurred_on: string;
  occurred_time?: string | null;
  date_precision: DatePrecision;
  payload: unknown;
  provenance: Provenance;
  /** The event this one corrects: same animal, same type, not yet corrected. */
  supersedes_id?: string | null;
  allow_ambiguous_service?: boolean;
  allow_early_check?: boolean;
  allow_check_without_service?: boolean;
  /** Free text kept with an override that happened. Optional. */
  override_reason?: string | null;
}

/**
 * The refusal message for a precision (and time) a breeding event cannot have,
 * or null. Shared by the write path and invariant 29, so the two cannot drift.
 */
export function breedingPrecisionAllowed(
  type: BreedingEventType,
  payload: { service_type?: string },
  precision: DatePrecision,
  time: string | null,
): string | null {
  if (precision !== 'day' && precision !== 'month') {
    return `a breeding event is dated to the day or the month, not '${precision}'`;
  }
  if (type === 'pregnancy_check' && precision !== 'day') {
    return `a pregnancy check is dated to the day: its result depends on the days since the service`;
  }
  if (type === 'insemination' && payload.service_type === 'bull_exposure' && time !== null) {
    return `a bull exposure covers days, not a time of day`;
  }
  return null;
}

export function recordBreedingEvent(db: Db, input: RecordBreedingEventInput): { event_id: string } {
  const animal = getAnimal(db, input.animal_id);
  if (!animal) {
    throw new RegistryError('unknown_animal', `unknown registry animal '${input.animal_id}'`, 'animal_id');
  }
  if (animal.sex !== 'female') {
    throw new RegistryError(
      'not_female',
      `animal '${input.animal_id}' is ${animal.sex}; a breeding event is recorded against the female`,
      'animal_id',
    );
  }

  const time = input.occurred_time ?? null;
  const refusal = breedingPrecisionAllowed(
    input.type,
    (input.payload ?? {}) as { service_type?: string },
    input.date_precision,
    time,
  );
  if (refusal) throw new RegistryError('breeding_precision', refusal, 'date_precision');
  assertDatePrecision({ occurred_on: input.occurred_on, occurred_time: time, date_precision: input.date_precision });

  const ordered = canonicalOrder(effectiveEvents(eventsForAnimal(db, input.animal_id)));
  const when = { on: input.occurred_on, precision: input.date_precision };

  const origin = findOrigin(ordered);
  if (origin && definitelyBefore(when, { on: origin.event.occurred_on, precision: origin.event.date_precision })) {
    throw new RegistryError(
      'event_before_origin',
      `a '${input.type}' dated ${input.occurred_on} is before animal '${input.animal_id}' ` +
        `arrived or was born (${origin.event.occurred_on})`,
      'occurred_on',
    );
  }

  const departure = ordered.find((e) => e.type === 'departure');
  if (departure && definitelyBefore({ on: departure.occurred_on, precision: departure.date_precision }, when)) {
    throw new RegistryError(
      'animal_departed',
      `animal '${input.animal_id}' departed on ${departure.occurred_on}; a '${input.type}' dated ` +
        `${input.occurred_on} did not happen on this farm`,
      'occurred_on',
    );
  }

  const supersedesId = input.supersedes_id ?? null;
  if (supersedesId !== null) {
    const target = eventsForAnimal(db, input.animal_id).find((e) => e.id === supersedesId);
    if (!target) {
      const elsewhere = db.prepare(`SELECT animal_id FROM registry_animal_events WHERE id = ?`).get(supersedesId) as
        | { animal_id: string }
        | undefined;
      throw new RegistryError(
        'unknown_event',
        elsewhere
          ? `event '${supersedesId}' belongs to animal '${elsewhere.animal_id}', not '${input.animal_id}'; a correction is on the same animal`
          : `no event '${supersedesId}' to correct`,
        'supersedes_id',
      );
    }
    if (target.type !== input.type) {
      throw new RegistryError(
        'supersede_type_mismatch',
        `event '${supersedesId}' is a '${target.type}'; a correction keeps the type, so it cannot be replaced by a '${input.type}'`,
        'supersedes_id',
      );
    }
    const replacedBy = db
      .prepare(`SELECT id FROM registry_animal_events WHERE supersedes_id = ?`)
      .get(supersedesId) as { id: string } | undefined;
    if (replacedBy) {
      throw new RegistryError(
        'already_superseded',
        `event '${supersedesId}' has already been superseded by '${replacedBy.id}'. Correct that event instead -- ` +
          `only one event may supersede a given event, so the chain is extended at its end.`,
        'supersedes_id',
      );
    }
  }

  // The candidate carries the timestamp the event will be stored with, so on a
  // same-day tie it sorts after the events already there and its warning holds.
  const recordedAt = new Date().toISOString();
  const candidate: RegistryEvent = {
    id: 'candidate',
    animal_id: input.animal_id,
    type: input.type,
    occurred_on: input.occurred_on,
    occurred_time: time,
    date_precision: input.date_precision,
    payload: assertEventPayload(input.type, input.payload) as unknown as Record<string, unknown>,
    source_form: input.provenance.source_form,
    source_ref: input.provenance.source_ref ?? null,
    observed_by: input.provenance.observed_by ?? null,
    recorded_by: input.provenance.recorded_by,
    recorded_at: recordedAt,
    supersedes_id: supersedesId,
    override_check: null,
    override_reason: null,
  };
  const warning = breedingWarning(eventsForAnimal(db, input.animal_id), candidate);
  const allowed: Record<BreedingOverriddenCheck, boolean | undefined> = {
    ambiguous_service: input.allow_ambiguous_service,
    early_check: input.allow_early_check,
    check_without_service: input.allow_check_without_service,
  };
  if (warning && allowed[warning.check] !== true) {
    throw new RegistryError(warning.check, warning.message, warning.field);
  }

  const row = appendEvent(db, {
    animal_id: input.animal_id,
    type: input.type,
    occurred_on: input.occurred_on,
    occurred_time: time,
    date_precision: input.date_precision,
    payload: input.payload,
    provenance: input.provenance,
    supersedes_id: supersedesId,
    recorded_at: recordedAt,
    override: warning ? { check: warning.check, reason: input.override_reason ?? null } : null,
  });
  return { event_id: row.id };
}
