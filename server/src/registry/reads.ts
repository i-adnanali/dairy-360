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
import { daysBetween, effectiveEvents } from './project';
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
// Previously-used free-text identifiers
// ---------------------------------------------------------------------------

/**
 * Values already used in the three free-text identifier fields.
 *
 * WHY THIS EXISTS: free text typed across a hundred records produces `abdul`,
 * `Abdul` and `abdul_r` -- three identifiers for one person, which makes
 * "everything Abdul observed" unanswerable and cannot be repaired without
 * deciding which spelling was meant. A datalist turns the second occurrence
 * into a pick instead of a retype, which is the cheapest point to stop it.
 *
 * NOT A CONSTRAINT, and deliberately not deduplicated case-insensitively. These
 * are suggestions: a new name must stay typeable without friction, and
 * collapsing `abdul` into `Abdul` here would hide from the operator that both
 * are already in the log -- which is exactly the thing worth seeing.
 *
 * Read from the EVENT LOG rather than from a lookup table, because the log is
 * the only source of truth and a table would be a second one to keep in sync.
 */
export interface IdentifierValues {
  /** From every event's `observed_by` column. */
  observed_by: string[];
  /** From `acquired` payloads' `from`. */
  acquired_from: string[];
  /** From `birth` payloads' `sire_ref`. */
  sire_ref: string[];
}

export function identifierValues(db: Db): IdentifierValues {
  const observed = new Set<string>();
  const from = new Set<string>();
  const sire = new Set<string>();

  // Superseded events INCLUDED on purpose: a name typed on an event that was
  // later corrected is still a name in use on this farm, and suggesting it is
  // how the next record spells it the same way.
  for (const e of allEvents(db)) {
    if (e.observed_by !== null && e.observed_by.length > 0) observed.add(e.observed_by);
    if (e.type === 'acquired') {
      const v = e.payload.from;
      if (typeof v === 'string' && v.length > 0) from.add(v);
    }
    if (e.type === 'birth') {
      const v = e.payload.sire_ref;
      if (typeof v === 'string' && v.length > 0) sire.add(v);
    }
  }

  const sorted = (s: Set<string>): string[] =>
    [...s].sort((a, b) => a.localeCompare(b));

  return {
    observed_by: sorted(observed),
    acquired_from: sorted(from),
    sire_ref: sorted(sire),
  };
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
  /**
   * Whole days between this animal's recorded birth date and the proposed
   * calving date. Null when either date is missing.
   *
   * A NULL IS THE STRONGEST SIGNAL HERE, not the weakest. An animal with no
   * birth date is the likeliest link target of all: the roster pass enters
   * animals without one, and pass one enters a farm-born calf as `acquired`
   * because there are no calvings yet. Which is why the sort puts nulls first
   * rather than last.
   */
  days_apart: number | null;
  /** Whether this animal falls inside the match window described below. */
  within_match_window: boolean;
}

/**
 * Days either side of a proposed calving within which an existing animal's
 * recorded birth date makes it a plausible match, by the coarsest precision of
 * the two dates.
 *
 * The windows widen with uncertainty because that is what uncertainty means: two
 * month-precision dates stored on the 1st can be 30 days apart and describe the
 * same week, so a ±7 window at that grain would hide the right animal. All three
 * values are PROVISIONAL, in the sense CALF_MAX_AGE_MONTHS is -- they are chosen
 * to be generous rather than tight, because the cost of a candidate you scroll
 * past is nothing and the cost of one that never appears is a duplicate animal.
 */
export const MATCH_WINDOW_DAYS = { day: 7, month: 45 } as const;
/** At year or estimated grain the window is calendar years, not days. */
export const MATCH_WINDOW_YEARS = 1;

/**
 * True when `birth` is close enough to `proposed` to be worth offering.
 *
 * NOTE THE DEPARTURE FROM definitelyBefore(), which refuses to compare an
 * `estimated` date at all. That function's job is to PROVE a timeline violation,
 * so a guess is not evidence and it declines. This one's job is to SUGGEST a
 * match, where a guess is exactly what you want to act on -- an animal recorded
 * as "estimated 2019" is a fine candidate for a 2019 calving. Same two dates,
 * opposite correct answers, because proving and suggesting are different jobs.
 */
export function withinMatchWindow(
  birth: { on: string; precision: DatePrecision },
  proposed: { on: string; precision: DatePrecision },
): boolean {
  const coarse = (p: DatePrecision): 'day' | 'month' | 'year' =>
    p === 'estimated' ? 'year' : p;
  const grain =
    coarse(birth.precision) === 'year' || coarse(proposed.precision) === 'year'
      ? 'year'
      : coarse(birth.precision) === 'month' || coarse(proposed.precision) === 'month'
        ? 'month'
        : 'day';

  if (grain === 'year') {
    const by = Number(birth.on.slice(0, 4));
    const py = Number(proposed.on.slice(0, 4));
    return Math.abs(by - py) <= MATCH_WINDOW_YEARS;
  }
  return Math.abs(daysBetween(birth.on, proposed.on)) <= MATCH_WINDOW_DAYS[grain];
}

/**
 * Ranking order for the picker.
 *
 * 1. Eligible before ineligible. An ineligible animal cannot be chosen, and one
 *    sitting at the top of a recognition list is a target the eye lands on and
 *    the hand cannot click. They stay in the list -- with their reason, which
 *    teaches -- but below the animals that can actually be picked.
 * 2. No birth date before any birth date. See `days_apart`.
 * 3. Closest first.
 * 4. Serial, so the order is total and stable across calls.
 */
function compareCandidates(a: LinkCandidate, b: LinkCandidate): number {
  if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
  const an = a.days_apart === null;
  const bn = b.days_apart === null;
  if (an !== bn) return an ? -1 : 1;
  if (!an && !bn && a.days_apart !== b.days_apart) {
    return Math.abs(a.days_apart!) - Math.abs(b.days_apart!);
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
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

    const birthOn = s?.birth_on ?? null;
    const birthPrecision = s?.birth_precision ?? null;

    // Proximity needs both dates. Missing either leaves days_apart null and
    // the animal INSIDE the window -- "we could not judge" must not resolve
    // into hiding a candidate, which is the same direction target.ts takes
    // when it cannot tell which database it is pointed at.
    const comparable =
      birthOn !== null &&
      birthPrecision !== null &&
      opts.occurredOn !== undefined &&
      opts.datePrecision !== undefined;

    return {
      id: a.id,
      name: a.name,
      sex: a.sex,
      origin: a.origin,
      birth_on: birthOn,
      birth_precision: birthPrecision,
      eligible: reason === null,
      ineligible_reason: reason,
      days_apart: comparable ? daysBetween(birthOn!, opts.occurredOn!) : null,
      within_match_window: comparable
        ? withinMatchWindow(
            { on: birthOn!, precision: birthPrecision! },
            { on: opts.occurredOn!, precision: opts.datePrecision! },
          )
        : true,
    };
  })
    .sort(compareCandidates);
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
        // Proximity is meaningless for a DAM: there is no proposed birth date to
        // be near. Null and in-window rather than omitted, so the shape stays
        // identical to the link picker's and one component can render both.
        days_apart: null,
        within_match_window: true,
      };
    });
}
