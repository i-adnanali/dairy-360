// Animal registry -- the PURE projection core (decision doc §4, §9).
//
// Events in, projection objects out. NO `../db` import, so
// registry.project.test.ts exercises every rule with no database, no API key
// and no running server -- the same property classify.ts holds and for the same
// reason. The impure shell is projectStore.ts.
//
// ---------------------------------------------------------------------------
// WHY `asOf` IS AN EXPLICIT PARAMETER AND NOT `new Date()`
// ---------------------------------------------------------------------------
// One status rule depends on the current date: an animal is a `calf` until it
// is CALF_MAX_AGE_MONTHS old. That makes the status projection a function of
// TIME as well as of the event log, and a hidden clock read would make the
// rebuild non-reproducible -- invariant 0 (idempotence) and invariant 1
// (rebuild fidelity) would both become unfalsifiable, because two runs a day
// apart could legitimately disagree.
//
// So `asOf` is passed in, and the consequence is stated rather than hidden:
// stored projections go STALE as animals age. A stale row is a real invariant-1
// violation and the correct response is `npm run registry:rebuild`, not a
// loosened comparison. verify:registry reports age-drift as its own diagnosis
// so the operator can tell "stale" from "wrong".

import type {
  AnimalProjection,
  AnimalStatusRow,
  DatePrecision,
  LactationRow,
  ParentageRow,
  RegistryAnimalRow,
  RegistryAnimalStatus,
  RegistryEvent,
} from './types';
import { lactationIdFor } from './events';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Age below which an animal projects as `calf` -- a KATTI -- in months.
 *
 * 18, confirmed against how the farm actually talks about the animals. It was
 * 12, which was a working guess with no farm evidence behind it.
 *
 * THIS IS THE SCHEME'S ONLY AGE THRESHOLD, and that is the point: every other
 * boundary is derived from events the registry already holds. A katti becomes a
 * choti by getting older; a choti becomes a majj by CALVING, and by nothing
 * else. See the rule order below for why that distinction is load-bearing.
 *
 * Still policy rather than biology, and provisional in one respect: the real
 * katti->choti transition is physical -- she gains weight and features -- not
 * arithmetic. 18 months is the default inference, and an explicit life-stage
 * override event is an open item. If it changes, only rule 4 below moves, and
 * `registry:rebuild` republishes every status; nothing stored depends on the
 * old value.
 *
 * Deliberately NOT placed alongside FARM_TZ / WORK_HOURS / RESTRICTED_ZONES.
 * Those are exports of farm/classify.ts, whose subject is cameras and people
 * and whose DB-freedom is asserted by its own test; there is no shared
 * constants module in this repo. The convention the repo actually has is a
 * named, exported, commented constant at the top of the module that owns the
 * rule -- which is this one.
 */
export const CALF_MAX_AGE_MONTHS = 18;

// ---------------------------------------------------------------------------
// Event-stream helpers
// ---------------------------------------------------------------------------

/**
 * Ids replaced by a correction. An event named by ANY other event's
 * supersedes_id is superseded, which handles chains correctly: if B supersedes
 * A and C supersedes B, then {A, B} are superseded and only C is effective.
 */
export function supersededIds(events: RegistryEvent[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (e.supersedes_id) out.add(e.supersedes_id);
  return out;
}

/** Non-superseded events only. Projections never see a replaced event. */
export function effectiveEvents(events: RegistryEvent[]): RegistryEvent[] {
  const dead = supersededIds(events);
  return events.filter((e) => !dead.has(e.id));
}

/**
 * The canonical order (decision doc §5). Untimed events sort before timed ones
 * on the same day -- arbitrary, but STABLE across rebuilds, which is the
 * property that matters. `recorded_at` then `id` break remaining ties so the
 * order is total.
 */
export function compareEvents(a: RegistryEvent, b: RegistryEvent): number {
  if (a.occurred_on !== b.occurred_on) {
    return a.occurred_on < b.occurred_on ? -1 : 1;
  }
  const at = a.occurred_time ?? '00:00';
  const bt = b.occurred_time ?? '00:00';
  if (at !== bt) return at < bt ? -1 : 1;
  if (a.recorded_at !== b.recorded_at) {
    return a.recorded_at < b.recorded_at ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function canonicalOrder(events: RegistryEvent[]): RegistryEvent[] {
  return [...events].sort(compareEvents);
}

// ---------------------------------------------------------------------------
// Date arithmetic -- farm-local calendar dates, never instants
// ---------------------------------------------------------------------------

/**
 * Whole months from `from` to `to`, both `YYYY-MM-DD` farm-local dates.
 *
 * Calendar months, not 30-day blocks: "under 12 months old" is a statement
 * about the calendar, and 365/30 would put the boundary in the wrong place.
 * Pure string arithmetic, so there is no Date object and therefore no timezone
 * to get wrong -- the reason this does not reuse anything from classify.ts,
 * which converts INSTANTS into farm-local time and has no need for this.
 */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

/**
 * Whole days between two `YYYY-MM-DD` farm-local dates.
 *
 * Both endpoints are composed as UTC midnight, so the difference is exact whole
 * days regardless of the host timezone -- and note the `- 1` on the month:
 * Date.UTC takes a 0-indexed month, and passing it 1-indexed silently shifts
 * both endpoints by a month, which only shows up as an error when the two
 * months have different lengths.
 */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
}

// ---------------------------------------------------------------------------
// Origin
// ---------------------------------------------------------------------------

export interface OriginInfo {
  event: RegistryEvent;
  /**
   * The animal's BIRTH date, which is not always the origin event's date. For
   * `birth` it is the event date; for `acquired` it is the payload's
   * estimated_birth_on, because the acquisition date is when it arrived, not
   * when it was born.
   */
  birth_on: string | null;
  birth_precision: DatePrecision | null;
}

export function findOrigin(ordered: RegistryEvent[]): OriginInfo | null {
  const origin = ordered.find((e) => e.type === 'birth' || e.type === 'acquired');
  if (!origin) return null;
  if (origin.type === 'birth') {
    return {
      event: origin,
      birth_on: origin.occurred_on,
      birth_precision: origin.date_precision,
    };
  }
  const on = (origin.payload.estimated_birth_on as string | null) ?? null;
  const prec = (origin.payload.estimated_birth_precision as DatePrecision | null) ?? null;
  return { event: origin, birth_on: on, birth_precision: prec };
}

// ---------------------------------------------------------------------------
// Lactations
// ---------------------------------------------------------------------------

/**
 * Lactations for one animal, oldest first.
 *
 * Each `calving` opens one. Before opening the next, the previous is closed:
 *
 *   - a `dry_off` between the two calvings  -> ended there, reason 'dry_off'
 *   - no `dry_off`                          -> ended at the next calving date,
 *                                              reason 'inferred_at_next_calving'
 *
 * The second case is NOT an error and must never reject the calving. Backfilled
 * history routinely has calving dates and no dry-off dates, and rejecting would
 * force the operator to invent a dry-off date -- inventing precision to satisfy
 * a constraint. The marker records that the boundary is a derivation rather than
 * an observation, and is available to anything that later cares about dry-period
 * length.
 *
 * A stillbirth still opens a lactation. The dam lactates regardless of whether
 * the calf lived, and the interval still counts.
 *
 * A `departure` deliberately does NOT close an open lactation: we do not know
 * that the animal dried off, and inventing an end date would be the same
 * dishonesty the precision rules exist to prevent. The status projection reports
 * `departed` regardless, and invariant 8 is about two OPEN lactations, which
 * this cannot produce.
 */
export function projectLactations(
  animalId: string,
  ordered: RegistryEvent[],
): LactationRow[] {
  const calvings = ordered.filter((e) => e.type === 'calving');
  const dryOffs = ordered.filter((e) => e.type === 'dry_off');
  const out: LactationRow[] = [];

  for (let i = 0; i < calvings.length; i++) {
    const calving = calvings[i];
    const next = calvings[i + 1];

    const row: LactationRow = {
      id: lactationIdFor(calving.id),
      animal_id: animalId,
      opened_by_event_id: calving.id,
      started_on: calving.occurred_on,
      start_precision: calving.date_precision,
      ended_on: null,
      end_precision: null,
      end_reason: null,
      closed_by_event_id: null,
    };

    // The first dry_off at or after this calving and strictly before the next.
    const dry = dryOffs.find(
      (d) =>
        compareEvents(d, calving) >= 0 &&
        (next === undefined || compareEvents(d, next) < 0),
    );

    if (dry) {
      row.ended_on = dry.occurred_on;
      row.end_precision = dry.date_precision;
      row.end_reason = 'dry_off';
      row.closed_by_event_id = dry.id;
    } else if (next) {
      row.ended_on = next.occurred_on;
      row.end_precision = next.date_precision;
      row.end_reason = 'inferred_at_next_calving';
      row.closed_by_event_id = next.id;
    }

    out.push(row);
  }

  return out;
}

// ---------------------------------------------------------------------------
// Parentage
// ---------------------------------------------------------------------------

/**
 * Parentage edges for one animal, derived from its origin event.
 *
 * Only a `birth` event carries parentage: a farm-born calf's dam is known
 * because recordCalving created the calf from the dam's calving. An `acquired`
 * animal gets no edges -- we did not witness its birth, and a fabricated
 * `unknown` edge would add a row that asserts nothing.
 *
 * `certainty` exists for the case where a dam is recorded but not witnessed.
 * Everything this cycle writes is 'known', because the only producer is the
 * calving transaction; the column is here so the backfill can assert an
 * uncertain edge without a schema change.
 */
export function projectParentage(
  animalId: string,
  ordered: RegistryEvent[],
): ParentageRow[] {
  const birth = ordered.find((e) => e.type === 'birth');
  if (!birth) return [];

  const out: ParentageRow[] = [];
  const damId = (birth.payload.dam_id as string | undefined) ?? null;
  if (damId) {
    out.push({
      child_id: animalId,
      relation: 'dam',
      parent_ref: damId,
      certainty: 'known',
      source_event_id: birth.id,
    });
  }
  const sireRef = (birth.payload.sire_ref as string | null | undefined) ?? null;
  if (sireRef) {
    out.push({
      child_id: animalId,
      relation: 'sire',
      parent_ref: sireRef,
      certainty: 'known',
      source_event_id: birth.id,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Status rules, evaluated in order, first match wins (decision doc §9).
 *
 *   1. departed  -- a `departure` event exists. Terminal.
 *   2. lactating -- parity >= 1 and an open lactation exists.
 *   3. dry       -- parity >= 1 and no open lactation.
 *   4. calf      -- birth date known and age < CALF_MAX_AGE_MONTHS.
 *   5. heifer    -- female, parity 0.
 *   6. male      -- male, parity 0.
 *
 * ---------------------------------------------------------------------------
 * PARITY IS CHECKED BEFORE AGE, AND THE OPPOSITE ORDER WAS A BUG
 * ---------------------------------------------------------------------------
 * The cow boundary is `parity >= 1` and NOTHING ELSE. A choti becomes a majj by
 * calving; no amount of age does it, and no youth undoes it.
 *
 * The age rule used to be evaluated FIRST, which meant an animal that HAD
 * CALVED projected as a `calf` whenever its recorded age fell under the
 * threshold. Measured before the fix, at the old threshold of 12:
 *
 *     8 months old, parity 0              -> calf
 *     8 months old, parity 1 (HAS CALVED) -> calf     <-- wrong
 *
 * Buffalo gestation is about 310 days, so that combination is not reachable by
 * biology. It is very reachable by a BIRTH-YEAR TYPO during a backfill, which
 * is precisely what this application is for -- and raising the threshold to 18
 * widens the window in which one produces it. The consequence was a milking
 * animal displayed as a katti, which is the kind of wrong that makes an
 * operator distrust the whole screen.
 *
 * The reverse case was always right: an animal old enough to look like a majj
 * who has never calved projects `heifer`, because rules 2 and 3 cannot fire at
 * parity 0.
 *
 * If the birth date is UNKNOWN, rule 4 cannot fire and a parity-0 animal falls
 * through to heifer/male even if it is visibly a calf. That is a documented
 * consequence, not a bug: the fix is to enter an estimated birth date, which
 * the precision qualifier makes safe to do.
 */
export function projectStatus(opts: {
  animal: RegistryAnimalRow;
  ordered: RegistryEvent[];
  lactations: LactationRow[];
  asOf: string;
}): AnimalStatusRow {
  const { animal, ordered, lactations, asOf } = opts;

  const origin = findOrigin(ordered);
  const birth_on = origin?.birth_on ?? null;
  const birth_precision = origin?.birth_precision ?? null;

  const parity = ordered.filter((e) => e.type === 'calving').length;
  const open = lactations.find((l) => l.ended_on === null) ?? null;

  const base = {
    animal_id: animal.id,
    parity,
    birth_on,
    birth_precision,
    open_lactation_id: open?.id ?? null,
  };

  const status: RegistryAnimalStatus = (() => {
    if (ordered.some((e) => e.type === 'departure')) return 'departed';
    // The cow boundary, event-driven and ahead of every age test.
    if (parity >= 1) return open ? 'lactating' : 'dry';
    if (birth_on !== null && monthsBetween(birth_on, asOf) < CALF_MAX_AGE_MONTHS) {
      return 'calf';
    }
    return animal.sex === 'female' ? 'heifer' : 'male';
  })();

  return { ...base, status };
}

// ---------------------------------------------------------------------------
// The whole projection for one animal
// ---------------------------------------------------------------------------

/**
 * Everything derived for one animal. The ONLY function that decides what
 * projection rows exist; projectStore.ts merely writes what this returns.
 *
 * `events` may arrive in any order and may include superseded rows -- this
 * filters and orders them, so a caller cannot get it subtly wrong.
 */
export function projectAnimal(opts: {
  animal: RegistryAnimalRow;
  events: RegistryEvent[];
  asOf: string;
}): AnimalProjection {
  const ordered = canonicalOrder(effectiveEvents(opts.events));
  const lactations = projectLactations(opts.animal.id, ordered);
  const parentage = projectParentage(opts.animal.id, ordered);
  const status = projectStatus({
    animal: opts.animal,
    ordered,
    lactations,
    asOf: opts.asOf,
  });
  return { status, lactations, parentage };
}
