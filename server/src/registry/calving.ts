// Animal registry -- the calving transaction (decision doc §8).
//
// One function, one BEGIN IMMEDIATE transaction, all-or-nothing.
//
// This is the most important code in the cycle, because the failure it prevents
// -- orphaned calves and a pedigree graph of disconnected nodes -- surfaces
// much later and CANNOT be repaired from the data. A calf inserted without its
// birth event has no dam, and nothing in the log says who it was.

import type { Db } from './schema';
export { CalvingError } from './errors';
import { newEventId } from './events';
import { allocateSerial, appendEvent, eventsForAnimal, getAnimal, insertAnimal } from './store';
import { CalvingError } from './errors';
import { definitelyBefore } from './invariants';
import { effectiveEvents } from './project';
import { rebuildAnimals } from './projectStore';
import type {
  CalvingAssistance,
  CalvingOutcome,
  DatePrecision,
  Provenance,
  RegistryEvent,
  RegistrySex,
} from './types';

/**
 * Days either side of a proposed calving within which an existing calving is
 * treated as a probable double entry.
 *
 * PROVISIONAL. A buffalo's calving interval is on the order of 400+ days, so
 * anything inside a couple of months is far more likely to be the same event
 * entered twice than a real second calving -- which is the actual risk during a
 * recall-based backfill, where the same remembered calving arrives from two
 * sheets. Overridable per call, never silently ignored.
 */
export const DOUBLE_ENTRY_WINDOW_DAYS = 60;

export interface RecordCalvingInput {
  dam_id: string;
  occurred_on: string;
  occurred_time?: string | null;
  date_precision: DatePrecision;
  calf: {
    /**
     * LINK MODE. Attach this calving to an animal that ALREADY EXISTS instead
     * of minting a new one.
     *
     * The backfill reconciliation case, and the reason it is a first-class mode
     * rather than a manual fix-up: pass one enters every animal it can, and a
     * farm-born animal whose dam is still in the herd gets entered as
     * `acquired` because pass one has no calvings yet. Pass two then records
     * the dam's calving -- and without this, mints a DUPLICATE of an animal
     * that is already in the registry. Duplicate animal, duplicate origin
     * event, and no command able to repair either.
     *
     * In link mode the calf's `acquired` origin is superseded by a `birth`, and
     * registry_animals.origin is promoted to 'born_on_farm'. No serial is
     * allocated.
     */
    existing_id?: string;
    sex: RegistrySex;
    name?: string | null;
    outcome: CalvingOutcome;
    species?: string;
  };
  sire_ref?: string | null;
  assistance?: CalvingAssistance | null;
  notes?: string | null;
  provenance: Provenance;
  /**
   * Accept a calving inside DOUBLE_ENTRY_WINDOW_DAYS of an existing one.
   * Required rather than advisory: the guard warns and refuses, and the operator
   * says "yes, really" in the input rather than the code guessing.
   */
  allow_near_duplicate?: boolean;
  /**
   * The date the projections are computed as of. Explicit for the reason given
   * in project.ts's header: status depends on the current date, so a hidden
   * clock read would make the rebuild non-reproducible.
   */
  asOf: string;
  /**
   * TEST-ONLY fault injection. Throws immediately after the numbered step
   * completes, so registry.calving.test.ts can prove that a failure at each of
   * the six steps leaves zero rows written.
   *
   * This exists because steps 4, 5 and 6 have no natural failure mode that a
   * test can trigger from outside without corrupting the schema, and "we
   * believe it is atomic" is exactly the claim that should not be taken on
   * trust for the one transaction whose failure cannot be repaired.
   */
  __faultAfterStep?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface RecordCalvingResult {
  calf_id: string;
  calving_event_id: string;
  birth_event_id: string;
  /** Present when the calf was stillborn or died within 24h. */
  departure_event_id: string | null;
  /** True when an existing animal was linked rather than a new one minted. */
  linked: boolean;
  /** In link mode, the `acquired` origin event the birth superseded. */
  superseded_origin_event_id: string | null;
}

function daysApart(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.abs(
    Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000),
  );
}

/**
 * Record a calving: the dam's event, the calf as an animal, the calf's birth
 * event, and the projections for both. All or nothing.
 *
 * A `stillborn` or `died_within_24h` calf is STILL created as an animal, still
 * gets a birth event, and still opens the dam's lactation -- plus a `departure`
 * event with reason `died`. A stillbirth counts toward parity and toward the
 * calving interval, so the calf must exist as a node in the graph. Suppressing
 * it would corrupt the one metric this cycle exists to produce.
 */
export function recordCalving(db: Db, input: RecordCalvingInput): RecordCalvingResult {
  const fault = input.__faultAfterStep;
  const faultAt = (step: number): void => {
    if (fault === step) {
      throw new CalvingError('invalid_payload', `__faultAfterStep=${step} (test-only fault injection)`);
    }
  };

  // Ids are generated up front because the two events reference each other: the
  // calving payload names the calf, the birth payload names the calving event.
  const calvingEventId = newEventId();
  const birthEventId = newEventId();

  const run = db.transaction((): RecordCalvingResult => {
    // --- 1. Validate ------------------------------------------------------
    const dam = getAnimal(db, input.dam_id);
    if (!dam) {
      throw new CalvingError('unknown_dam', `unknown dam '${input.dam_id}'`, 'dam_id');
    }
    if (dam.sex !== 'female') {
      throw new CalvingError('dam_not_female', `dam '${dam.id}' is recorded as ${dam.sex}, not female`, 'dam_id');
    }

    const damEvents = effectiveEvents(eventsForAnimal(db, dam.id));

    const departure = damEvents.find(
      (e) => e.type === 'departure' && e.occurred_on <= input.occurred_on,
    );
    if (departure) {
      throw new CalvingError(
        'animal_departed',
        `dam '${dam.id}' has a departure event on ${departure.occurred_on}, ` +
          `on or before the calving date ${input.occurred_on}`,
      );
    }

    const near = damEvents.find(
      (e) =>
        e.type === 'calving' &&
        daysApart(e.occurred_on, input.occurred_on) <= DOUBLE_ENTRY_WINDOW_DAYS,
    );
    if (near && !input.allow_near_duplicate) {
      throw new CalvingError(
        'near_duplicate_calving',
        `dam '${dam.id}' already has a calving on ${near.occurred_on}, within ` +
          `${DOUBLE_ENTRY_WINDOW_DAYS} days of ${input.occurred_on}. This is far more ` +
          `likely a double entry than a real second calving. Pass ` +
          `allow_near_duplicate: true if it is genuinely a separate event.`,
      );
    }
    // Link mode validation, all of it here in step 1 alongside the dam checks.
    let linkedOrigin: RegistryEvent | null = null;
    if (input.calf.existing_id !== undefined) {
      const targetId = input.calf.existing_id;
      if (targetId === dam.id) {
        throw new CalvingError('self_calf', `an animal cannot be its own calf ('${targetId}')`, 'calf');
      }
      const target = getAnimal(db, targetId);
      if (!target) {
        throw new CalvingError(
        'unknown_animal',`unknown calf '${targetId}' -- link mode attaches to an ` +
          `animal that already exists. Omit the id to mint a new one.`);
      }
      if (target.sex !== input.calf.sex) {
        throw new CalvingError(
        'sex_mismatch',
          `calf '${targetId}' is recorded as ${target.sex} but this calving says ` +
            `${input.calf.sex}. One of the two is wrong; fix that before linking.`,
        );
      }
      if (input.calf.outcome !== 'live') {
        throw new CalvingError(
        'link_requires_live',
          `link mode requires outcome 'live', got '${input.calf.outcome}'. A calf that did ` +
            `not live would not have been entered separately as an animal, so linking one ` +
            `is almost certainly the wrong animal.`,
        );
      }

      const targetEvents = effectiveEvents(eventsForAnimal(db, targetId));
      const origin = targetEvents.find((e) => e.type === 'birth' || e.type === 'acquired');
      if (!origin) {
        throw new CalvingError(
        'no_origin_event',
          `calf '${targetId}' has no effective origin event, so there is nothing to ` +
            `supersede. Run verify:registry -- invariant 3 is already failing.`,
        );
      }
      if (origin.type === 'birth') {
        throw new CalvingError(
        'already_has_birth',
          `calf '${targetId}' already has a birth event (${origin.id}) dated ` +
            `${origin.occurred_on}, so it already has a dam. Linking would give it two ` +
            `origins. If THAT birth is the wrong one, correct the calving that claims it.`,
        );
      }

      // Nothing on the calf may predate its new origin (invariant 4). This is
      // the realistic failure: the animal was entered as acquired years after
      // it was actually born, and something was recorded in between.
      const tooEarly = targetEvents.find(
        (e) =>
          e.type !== 'note' &&
          e.id !== origin.id &&
          definitelyBefore(
            { on: e.occurred_on, precision: e.date_precision },
            { on: input.occurred_on, precision: input.date_precision },
          ),
      );
      if (tooEarly) {
        throw new CalvingError(
        'event_before_origin',
          `calf '${targetId}' has a ${tooEarly.type} on ${tooEarly.occurred_on} ` +
            `(${tooEarly.date_precision}), before the calving date ${input.occurred_on}. ` +
            `Its birth cannot postdate its own history -- check which date is wrong.`,
        );
      }

      linkedOrigin = origin;
    }
    faultAt(1);

    // --- 2. Resolve the calf's id ----------------------------------------
    // Mint mode allocates a serial INSIDE this transaction, so a rolled-back
    // calving does not burn a number. Link mode allocates nothing: the animal
    // already exists and already has its serial.
    const calfId = linkedOrigin ? input.calf.existing_id! : allocateSerial(db);
    faultAt(2);

    // --- 3. Create or promote the calf -----------------------------------
    if (linkedOrigin) {
      // registry_animals is identity, not a projection, so the rebuild will
      // never fix this column -- it is written here and checked by invariant 3.
      db.prepare(`UPDATE registry_animals SET origin = 'born_on_farm' WHERE id = ?`).run(calfId);
    } else {
      insertAnimal(db, {
        id: calfId,
        name: input.calf.name ?? null,
        sex: input.calf.sex,
        species: input.calf.species ?? dam.species,
        origin: 'born_on_farm',
      });
    }
    faultAt(3);

    // --- 4. The calving event, on the dam --------------------------------
    appendEvent(db, {
      id: calvingEventId,
      animal_id: dam.id,
      type: 'calving',
      occurred_on: input.occurred_on,
      occurred_time: input.occurred_time ?? null,
      date_precision: input.date_precision,
      payload: {
        calf_id: calfId,
        calf_sex: input.calf.sex,
        outcome: input.calf.outcome,
        assistance: input.assistance ?? null,
        notes: input.notes ?? null,
      },
      provenance: input.provenance,
    });
    faultAt(4);

    // --- 5. The birth event, on the calf ---------------------------------
    // SAME date and SAME precision as the calving. These are the same physical
    // fact seen from two animals; if their dates can diverge, the timeline lies.
    appendEvent(db, {
      id: birthEventId,
      animal_id: calfId,
      type: 'birth',
      occurred_on: input.occurred_on,
      occurred_time: input.occurred_time ?? null,
      date_precision: input.date_precision,
      payload: {
        dam_id: dam.id,
        sire_ref: input.sire_ref ?? null,
        calving_event_id: calvingEventId,
        sex: input.calf.sex,
        outcome: input.calf.outcome,
      },
      provenance: input.provenance,
      // Link mode: this birth REPLACES the `acquired` origin. The only
      // supersession in the schema that changes an event's type -- see
      // isOriginPromotion() in invariants.ts for why it is allowed here and
      // not in reverse.
      supersedes_id: linkedOrigin?.id ?? null,
    });

    let departureEventId: string | null = null;
    if (input.calf.outcome !== 'live') {
      const d = appendEvent(db, {
        animal_id: calfId,
        type: 'departure',
        occurred_on: input.occurred_on,
        occurred_time: input.occurred_time ?? null,
        date_precision: input.date_precision,
        payload: {
          reason: 'died',
          to: null,
          cause: input.calf.outcome === 'stillborn' ? 'stillborn' : 'died within 24h',
          notes: null,
        },
        provenance: input.provenance,
      });
      departureEventId = d.id;
    }
    faultAt(5);

    // --- 6. Rebuild projections for both animals -------------------------
    // Via the rebuild rather than hand-patched rows, so there remains exactly
    // one code path that writes a projection table.
    rebuildAnimals(db, { asOf: input.asOf, animalIds: [dam.id, calfId] });
    faultAt(6);

    return {
      calf_id: calfId,
      calving_event_id: calvingEventId,
      birth_event_id: birthEventId,
      departure_event_id: departureEventId,
      linked: linkedOrigin !== null,
      superseded_origin_event_id: linkedOrigin?.id ?? null,
    };
  });

  // BEGIN IMMEDIATE: take the write lock up front rather than upgrading from a
  // read lock partway through, which under concurrency can fail with SQLITE_BUSY
  // after the validation reads have already succeeded.
  return run.immediate();
}

// ---------------------------------------------------------------------------
// Correcting a calving date
// ---------------------------------------------------------------------------

export interface CorrectCalvingInput {
  /**
   * The calving event being corrected. Must be the CURRENTLY EFFECTIVE one --
   * if it has already been superseded, this throws and names its replacement,
   * because the partial unique index permits only one event to supersede a
   * given event and guessing which end of the chain was meant would be worse
   * than refusing.
   */
  calving_event_id: string;
  occurred_on: string;
  occurred_time?: string | null;
  date_precision: DatePrecision;
  assistance?: CalvingAssistance | null;
  notes?: string | null;
  provenance: Provenance;
  asOf: string;
  /** As on recordCalving: accept a corrected date near another calving. */
  allow_near_duplicate?: boolean;
  /** TEST-ONLY fault injection, per step. See recordCalving. */
  __faultAfterStep?: 1 | 2 | 3 | 4 | 5;
}

export interface CorrectCalvingResult {
  dam_id: string;
  calf_id: string;
  /** The superseding calving event on the dam. */
  calving_event_id: string;
  /** The superseding birth event on the calf. */
  birth_event_id: string;
  /**
   * The superseding departure event on the calf, when the calving outcome was
   * not `live`. Null for a live calf, which has no departure to move.
   */
  departure_event_id: string | null;
  superseded: {
    calving_event_id: string;
    birth_event_id: string;
    departure_event_id: string | null;
  };
}

/**
 * Correct a calving's date (and optionally its assistance/notes) by writing
 * BOTH halves of the correction in one transaction.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AS AN API RATHER THAN TWO appendEvent() CALLS
 * ---------------------------------------------------------------------------
 * A calving and its calf's birth are the same physical fact seen from two
 * animals. Superseding only the calving leaves the two dates divergent, which
 * invariant 6 catches -- but only AFTER the fact, on the next verification run.
 *
 * That is the wrong place to catch it, because this is the single most likely
 * correction during a recall-based backfill (a remembered date sharpens on a
 * second telling), and the half-applied version FEELS COMPLETE: the dam's
 * record now reads correctly, and the calf's stale birth date is on a different
 * animal's timeline where nobody is looking.
 *
 * So the pairing is an API guarantee here, the same way the calf's existence is
 * an API guarantee in recordCalving, rather than a convention plus a later
 * check. Same shape: one BEGIN IMMEDIATE transaction, all-or-nothing, the same
 * validation, and the same per-step fault injection proving atomicity.
 *
 * AND IT IS NOT ALWAYS A PAIR. When the outcome was `stillborn` or
 * `died_within_24h`, recordCalving also wrote a `departure` on the calf at the
 * same date -- so the same physical fact spans THREE events, and moving only
 * two leaves the calf departed before it was born (invariants 4 and 5 both
 * fire). A test caught exactly that. The third supersession is conditional on
 * the departure actually being part of this fact, which is checked by its date
 * matching the calving being corrected, not merely by its existence.
 */
export function correctCalving(
  db: Db,
  input: CorrectCalvingInput,
): CorrectCalvingResult {
  const fault = input.__faultAfterStep;
  const faultAt = (step: number): void => {
    if (fault === step) {
      throw new CalvingError('invalid_payload', `__faultAfterStep=${step} (test-only fault injection)`);
    }
  };

  const newCalvingId = newEventId();
  const newBirthId = newEventId();
  const newDepartureId = newEventId();

  const run = db.transaction((): CorrectCalvingResult => {
    // --- 1. Validate ------------------------------------------------------
    const all = eventsForAnimal_all(db, input.calving_event_id);
    const original = all.original;

    if (!original) {
      throw new CalvingError('unknown_event', `unknown event '${input.calving_event_id}'`, 'calving_event_id');
    }
    if (original.type !== 'calving') {
      throw new CalvingError(
        'not_a_calving',
        `event '${input.calving_event_id}' is a '${original.type}', not a calving`,
      );
    }
    if (all.supersededBy) {
      throw new CalvingError(
        'already_superseded',
        `calving '${input.calving_event_id}' has already been superseded by ` +
          `'${all.supersededBy}'. Correct that event instead -- only one event may ` +
          `supersede a given event, so the chain must be extended at its end.`,
      );
    }

    const damId = original.animal_id;
    const dam = getAnimal(db, damId);
    if (!dam) {
      throw new CalvingError(
        'unknown_dam',`calving '${original.id}' references unknown dam '${damId}'`);
    }

    const calfId = original.payload.calf_id as string;
    const calf = getAnimal(db, calfId);
    if (!calf) {
      throw new CalvingError(
        'unknown_animal',`calving '${original.id}' names unknown calf '${calfId}'`);
    }

    // The calf's effective birth event -- the other half of the pair.
    const calfEvents = effectiveEvents(eventsForAnimal(db, calfId));
    const birth = calfEvents.find((e) => e.type === 'birth');
    if (!birth) {
      throw new CalvingError(
        'inconsistent_pair',
        `calf '${calfId}' has no effective birth event, so the pair cannot be corrected ` +
          `together. Fix that first: invariant 6 would fail either way.`,
      );
    }
    if (birth.payload.calving_event_id !== original.id) {
      throw new CalvingError(
        'inconsistent_pair',
        `calf '${calfId}' birth event points at calving ` +
          `'${String(birth.payload.calving_event_id)}', not '${original.id}'. The pair is ` +
          `already inconsistent -- run verify:registry before correcting.`,
      );
    }

    // Same validation as recording: a departure on or before the NEW date, and
    // the double-entry window against the dam's OTHER calvings.
    const damEvents = effectiveEvents(eventsForAnimal(db, damId));
    const departure = damEvents.find(
      (e) => e.type === 'departure' && e.occurred_on <= input.occurred_on,
    );
    if (departure) {
      throw new CalvingError(
        'animal_departed',
        `dam '${damId}' has a departure event on ${departure.occurred_on}, on or before ` +
          `the corrected calving date ${input.occurred_on}`,
      );
    }

    const near = damEvents.find(
      (e) =>
        e.type === 'calving' &&
        e.id !== original.id && // never compare the event being corrected to itself
        daysApart(e.occurred_on, input.occurred_on) <= DOUBLE_ENTRY_WINDOW_DAYS,
    );
    if (near && !input.allow_near_duplicate) {
      throw new CalvingError(
        'near_duplicate_calving',
        `the corrected date ${input.occurred_on} lands within ${DOUBLE_ENTRY_WINDOW_DAYS} ` +
          `days of dam '${damId}' other calving on ${near.occurred_on}. Pass ` +
          `allow_near_duplicate: true if both are genuinely separate events.`,
      );
    }
    faultAt(1);

    // --- 2. The superseding calving event, on the dam ---------------------
    appendEvent(db, {
      id: newCalvingId,
      animal_id: damId,
      type: 'calving',
      occurred_on: input.occurred_on,
      occurred_time: input.occurred_time ?? null,
      date_precision: input.date_precision,
      payload: {
        // Identity of the calf and the outcome are NOT correctable here: they
        // are what the calf's animal row and departure events were built from.
        // Only the date and the soft fields move.
        calf_id: calfId,
        calf_sex: original.payload.calf_sex,
        outcome: original.payload.outcome,
        assistance:
          input.assistance !== undefined
            ? input.assistance
            : ((original.payload.assistance as CalvingAssistance | null) ?? null),
        notes:
          input.notes !== undefined
            ? input.notes
            : ((original.payload.notes as string | null) ?? null),
      },
      provenance: input.provenance,
      supersedes_id: original.id,
    });
    faultAt(2);

    // --- 3. The superseding birth event, on the calf ----------------------
    // Same new date and precision, and re-pointed at the NEW calving event --
    // which is what invariant 6's back-reference check verifies.
    appendEvent(db, {
      id: newBirthId,
      animal_id: calfId,
      type: 'birth',
      occurred_on: input.occurred_on,
      occurred_time: input.occurred_time ?? null,
      date_precision: input.date_precision,
      payload: {
        dam_id: birth.payload.dam_id,
        sire_ref: (birth.payload.sire_ref as string | null) ?? null,
        calving_event_id: newCalvingId,
        sex: birth.payload.sex,
        outcome: birth.payload.outcome,
      },
      provenance: input.provenance,
      supersedes_id: birth.id,
    });
    faultAt(3);

    // --- 4. The superseding departure, for a calf that did not live -------
    // recordCalving wrote this at the calving date as part of the same fact, so
    // it moves with the date. Matched on its date rather than merely its
    // existence: a departure on some OTHER date is a separate fact and must not
    // be silently re-dated by a calving correction.
    let supersededDeparture: string | null = null;
    let newDeparture: string | null = null;
    if (original.payload.outcome !== 'live') {
      const departureOnCalf = calfEvents.find(
        (e) => e.type === 'departure' && e.occurred_on === original.occurred_on,
      );
      if (departureOnCalf) {
        appendEvent(db, {
          id: newDepartureId,
          animal_id: calfId,
          type: 'departure',
          occurred_on: input.occurred_on,
          occurred_time: input.occurred_time ?? null,
          date_precision: input.date_precision,
          payload: {
            reason: departureOnCalf.payload.reason,
            to: (departureOnCalf.payload.to as string | null) ?? null,
            cause: (departureOnCalf.payload.cause as string | null) ?? null,
            notes: (departureOnCalf.payload.notes as string | null) ?? null,
          },
          provenance: input.provenance,
          supersedes_id: departureOnCalf.id,
        });
        supersededDeparture = departureOnCalf.id;
        newDeparture = newDepartureId;
      }
    }
    faultAt(4);

    // --- 5. Rebuild projections for both animals --------------------------
    rebuildAnimals(db, { asOf: input.asOf, animalIds: [damId, calfId] });
    faultAt(5);

    return {
      dam_id: damId,
      calf_id: calfId,
      calving_event_id: newCalvingId,
      birth_event_id: newBirthId,
      departure_event_id: newDeparture,
      superseded: {
        calving_event_id: original.id,
        birth_event_id: birth.id,
        departure_event_id: supersededDeparture,
      },
    };
  });

  return run.immediate();
}

/**
 * Look up one event by id plus whatever supersedes it.
 *
 * Separate from store.ts's readers because it is the only place that needs to
 * ask "has this specific event been replaced?", and answering that requires the
 * reverse edge rather than the effective-events filter.
 */
function eventsForAnimal_all(
  db: Db,
  eventId: string,
): { original: RegistryEvent | undefined; supersededBy: string | null } {
  const row = db
    .prepare(`SELECT * FROM registry_animal_events WHERE id = ?`)
    .get(eventId) as { payload: string } | undefined;
  if (!row) return { original: undefined, supersededBy: null };

  const original = {
    ...(row as unknown as RegistryEvent),
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  };
  const sup = db
    .prepare(`SELECT id FROM registry_animal_events WHERE supersedes_id = ?`)
    .get(eventId) as { id: string } | undefined;

  return { original, supersededBy: sup?.id ?? null };
}
