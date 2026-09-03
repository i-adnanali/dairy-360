// Animal registry -- read models for the entry UI.
//
// Takes a `db` handle, imports no `../db`, so the same functions serve the live
// database and an `:memory:` fixture herd.
//
// Scope is deliberately narrow: enough to CHECK YOUR OWN WORK while entering a
// herd, and nothing more. A herd table, one animal's timeline, and the link
// picker. No lifetime lane, no pedigree, no herd lanes.

import type { Db } from './schema';
import { definitelyBefore } from './invariants';
import { effectiveEvents } from './project';
import { allAnimals, allEvents, allStatuses, eventsForAnimal, getAnimal } from './store';
import type {
  AnimalStatusRow,
  DatePrecision,
  RegistryAnimalRow,
  RegistryEventType,
  RegistrySex,
  SourceForm,
} from './types';

// ---------------------------------------------------------------------------
// The herd table
// ---------------------------------------------------------------------------

export interface HerdRow extends RegistryAnimalRow {
  status: AnimalStatusRow['status'] | null;
  parity: number | null;
  birth_on: string | null;
  birth_precision: DatePrecision | null;
  open_lactation_id: string | null;
  /** Non-superseded events on this animal. The "have I entered it yet" column. */
  event_count: number;
}

/**
 * Every animal with its derived status, serial order.
 *
 * `status` is nullable even though the rebuild writes one per animal: an animal
 * whose projections have not been rebuilt would otherwise be invisible in the
 * one view meant to show you everything. Showing it with a blank status is how
 * you notice.
 */
export function herd(db: Db): HerdRow[] {
  const statuses = new Map(allStatuses(db).map((s) => [s.animal_id, s]));
  const counts = new Map<string, number>();
  for (const e of effectiveEvents(allEvents(db))) {
    counts.set(e.animal_id, (counts.get(e.animal_id) ?? 0) + 1);
  }
  return allAnimals(db).map((a) => {
    const s = statuses.get(a.id);
    return {
      ...a,
      status: s?.status ?? null,
      parity: s?.parity ?? null,
      birth_on: s?.birth_on ?? null,
      birth_precision: s?.birth_precision ?? null,
      open_lactation_id: s?.open_lactation_id ?? null,
      event_count: counts.get(a.id) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// One animal's event list
// ---------------------------------------------------------------------------

export interface TimelineEvent {
  id: string;
  type: RegistryEventType;
  occurred_on: string;
  occurred_time: string | null;
  date_precision: DatePrecision;
  payload: Record<string, unknown>;
  source_form: SourceForm;
  source_ref: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  /** The event this one replaced, if any. */
  supersedes_id: string | null;
  /**
   * The event that replaced THIS one, if any. The reverse edge, which the log
   * does not store -- computed here because it is what the UI needs to strike a
   * row through and say what took its place.
   */
  superseded_by_id: string | null;
  /** False when superseded_by_id is set. No projection sees this row. */
  effective: boolean;
}

export interface AnimalDetail {
  animal: RegistryAnimalRow;
  status: AnimalStatusRow | null;
  /** Canonical order, oldest first. INCLUDES superseded events. */
  events: TimelineEvent[];
}

/**
 * One animal, with its whole event list.
 *
 * SUPERSEDED EVENTS ARE INCLUDED, marked rather than filtered. This view is the
 * only window into whether a correction did what was meant: an event that
 * simply vanished would be indistinguishable from one that was never written,
 * and the operator would have no way to tell a successful correction from a
 * silent no-op. Every row carries `effective` and, when replaced,
 * `superseded_by_id`.
 */
export function animalDetail(db: Db, animalId: string): AnimalDetail | null {
  const animal = getAnimal(db, animalId);
  if (!animal) return null;

  const rows = eventsForAnimal(db, animalId);
  const replacedBy = new Map<string, string>();
  for (const e of rows) {
    if (e.supersedes_id) replacedBy.set(e.supersedes_id, e.id);
  }

  const status =
    (allStatuses(db).find((s) => s.animal_id === animalId) as AnimalStatusRow | undefined) ??
    null;

  return {
    animal,
    status,
    events: rows.map((e) => {
      const superseded_by_id = replacedBy.get(e.id) ?? null;
      return {
        id: e.id,
        type: e.type,
        occurred_on: e.occurred_on,
        occurred_time: e.occurred_time,
        date_precision: e.date_precision,
        payload: e.payload,
        source_form: e.source_form,
        source_ref: e.source_ref,
        observed_by: e.observed_by,
        recorded_by: e.recorded_by,
        recorded_at: e.recorded_at,
        supersedes_id: e.supersedes_id,
        superseded_by_id,
        effective: superseded_by_id === null,
      };
    }),
  };
}

/** The calvings on one animal, for the correction picker. */
export function calvingsFor(db: Db, animalId: string): TimelineEvent[] {
  const detail = animalDetail(db, animalId);
  return detail ? detail.events.filter((e) => e.type === 'calving') : [];
}

// ---------------------------------------------------------------------------
// Link candidates
// ---------------------------------------------------------------------------

export interface LinkCandidate {
  id: string;
  name: string | null;
  sex: RegistrySex;
  origin: RegistryAnimalRow['origin'];
  birth_on: string | null;
  birth_precision: DatePrecision | null;
  eligible: boolean;
  /**
   * Why not, when not. Computed here rather than inferred by the client, for
   * the same reason `field` is on an error: a UI deriving it from other columns
   * is re-implementing a server rule, and the two will drift.
   */
  ineligible_reason: string | null;
}

/**
 * Every animal, marked for link-mode eligibility against a given dam.
 *
 * INELIGIBLE ANIMALS ARE INCLUDED, not filtered out. An animal missing from a
 * picker reads as data loss to the person entering the herd, who will stop and
 * go looking for it. Greyed with a reason costs one column and answers the
 * question before it is asked.
 */
export function linkCandidates(
  db: Db,
  opts: {
    damId?: string;
    calfSex?: RegistrySex;
    /**
     * The proposed calving date. Supplying it is what lets this list apply the
     * SAME timeline rule recordCalving does -- an animal whose own history
     * predates the proposed birth cannot be linked, because its birth would
     * postdate its own events (invariant 4).
     *
     * Omitting it produces a list that is right about everything else and
     * silent about this one, which is why the route always passes it when the
     * form has one.
     */
    occurredOn?: string;
    datePrecision?: DatePrecision;
  } = {},
): LinkCandidate[] {
  const statuses = new Map(allStatuses(db).map((s) => [s.animal_id, s]));

  return allAnimals(db).map((a) => {
    const mine = effectiveEvents(eventsForAnimal(db, a.id));
    const origin = mine.find((e) => e.type === 'birth' || e.type === 'acquired');
    const s = statuses.get(a.id);

    const reason = ((): string | null => {
      if (opts.damId !== undefined && a.id === opts.damId) {
        return 'this is the dam -- an animal cannot be its own calf';
      }
      if (!origin) return 'no effective origin event (run verify:registry)';
      if (origin.type === 'birth') return 'already has a birth event, so it already has a dam';
      if (opts.calfSex !== undefined && a.sex !== opts.calfSex) {
        return `recorded as ${a.sex}, but this calving says ${opts.calfSex}`;
      }
      if (opts.occurredOn !== undefined && opts.datePrecision !== undefined) {
        const tooEarly = mine.find(
          (e) =>
            e.type !== 'note' &&
            e.id !== origin.id &&
            definitelyBefore(
              { on: e.occurred_on, precision: e.date_precision },
              { on: opts.occurredOn!, precision: opts.datePrecision! },
            ),
        );
        if (tooEarly) {
          return (
            `has a ${tooEarly.type} on ${tooEarly.occurred_on}, before the proposed birth ` +
            `date ${opts.occurredOn} -- its birth cannot postdate its own history`
          );
        }
      }
      return null;
    })();

    return {
      id: a.id,
      name: a.name,
      sex: a.sex,
      origin: a.origin,
      birth_on: s?.birth_on ?? null,
      birth_precision: s?.birth_precision ?? null,
      eligible: reason === null,
      ineligible_reason: reason,
    };
  });
}

/** Females that could be a dam: not departed, and not the calf being linked. */
export function damCandidates(db: Db): LinkCandidate[] {
  const statuses = new Map(allStatuses(db).map((s) => [s.animal_id, s]));
  return allAnimals(db)
    .filter((a) => a.sex === 'female')
    .map((a) => {
      const s = statuses.get(a.id);
      const departed = s?.status === 'departed';
      return {
        id: a.id,
        name: a.name,
        sex: a.sex,
        origin: a.origin,
        birth_on: s?.birth_on ?? null,
        birth_precision: s?.birth_precision ?? null,
        eligible: !departed,
        ineligible_reason: departed
          ? 'departed -- a calving on or after a departure is refused'
          : null,
      };
    });
}
