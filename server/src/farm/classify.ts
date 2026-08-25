// Farm event classification -- the PURE core (Cycle 5; see
// docs/FARM_MONITOR.md Decision 5 and Decision 8).
//
// Deliberately DB-free, exactly like ingest.ts: constants, farm-local time
// helpers, and scoreEvent(). `priorSightingCount` arrives as a parameter, so
// classify.test.ts exercises every rule under plain `npm test -w server` with
// no database, no API key, and no running server.
//
// The impure shell -- querying prior sightings and writing the verdict back --
// lives in classifyStore.ts. Importing `../db` from THIS module would open
// dairy.db at module load and drag a real database into a unit test, which is
// precisely what ingest.ts's purity exists to avoid.
//
// This module deliberately does NOT call the Anthropic SDK. Classification is
// mechanical; narration is the model's job, instructed from systemPrompt.ts --
// the same division get_yield_vs_deliveries already follows (Decision 1).

import type { FarmEvent, FarmEventSeverity } from '@dairy/shared';

// ---------------------------------------------------------------------------
// Constants (Decision 3). Named, exported, and asserted against the scenario
// library by classify.test.ts -- not magic numbers buried in a comparison.
// ---------------------------------------------------------------------------

export const CONFIDENCE = {
  /**
   * A `face_match` at or above this is treated as a confident identification.
   *
   * Gated to event_type === 'face_match' ONLY. `detection` rows carry Frigate's
   * object-detection score in the same column (0.72..0.93 across the scenario
   * library), so an ungated comparison would flag normal-weekday's 0.76 yard
   * detection and break "every row lands routine".
   *
   * 0.85 sits inside the library's separating band of (0.386, 0.901]: the
   * highest below-threshold face is low-confidence-match's 0.386, the lowest
   * confident match is absent-employee's 0.901.
   */
  MATCH_CONFIDENT: 0.85,
} as const;

export const RECURRENCE = {
  /** Occurrence 1+ of an unknown cluster is notable. */
  NOTABLE_AFTER: 1,
  /** Occurrence 3+ within the lookback window is urgent. */
  URGENT_AFTER: 3,
  /**
   * Lookback measured BACKWARDS FROM THE EVENT, not from wall-clock now, so a
   * pass is reproducible whenever it runs. recurring-unknown-visitor's three
   * sightings span 2 days, leaving a 19-day margin here; 14 was rejected
   * because at the --days-ago=14 the README documents, the oldest sighting is
   * 14.37 days old and falls outside the window, making urgent unreachable.
   */
  LOOKBACK_DAYS: 21,
} as const;

/**
 * Zones treated as restricted outside WORK_HOURS.
 *
 * PROVISIONAL working default (FARM_MONITOR.md § Open items): it describes the
 * real farm, and only feed_store has repo evidence -- scenarios.ts annotates it
 * "Restricted after hours -- the zone night-visitor-unknown fires in".
 *
 * `gate` is deliberately EXCLUDED and that exclusion is load-bearing:
 * recurring-unknown-visitor fires in `gate` at 01:40, which is off-hours. Were
 * gate restricted, rule 1 below would escalate occurrence 1 straight to urgent
 * and collapse the notable->urgent gradient that treating recurrence as a
 * weighted signal exists to produce.
 */
export const RESTRICTED_ZONES: ReadonlySet<string> = new Set(['feed_store']);

/** Farm-local working hours, inclusive of start, exclusive of end. */
export const WORK_HOURS = { start: '04:00', end: '20:00' } as const;

/**
 * The farm's timezone (Decision 4). occurred_at is stored ISO-8601 UTC and
 * converted into THIS zone before any hours comparison -- never host-local.
 *
 * The generator does not share this property: scenarioStartMs() composes
 * `daysAgo(n) + 'T' + startTime` with no zone designator, which JS parses as
 * host-local. On a UTC runner it would stamp night-visitor-unknown at 02:14Z,
 * which is 07:14 in Karachi -- inside work hours, silently failing the very
 * flag that scenario exists to produce. `TZ=Asia/Karachi` is pinned on the
 * farm scripts to close that; explicit conversion here makes this module
 * correct regardless.
 */
export const FARM_TZ = 'Asia/Karachi';

/** Camera-silence gap past which summarize_daily_activity reports a dropout.
 * camera-dropout only pins this below barn_cam's 20-minute gap; the exact
 * value has no scenario behind it (FARM_MONITOR.md § Open items). */
export const CAMERA_SILENCE_MINUTES = 15;

// ---------------------------------------------------------------------------
// Time helpers -- farm-local, never host-local
// ---------------------------------------------------------------------------

/** 'HH:MM' -> minutes since farm-local midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

const WORK_START_MIN = toMinutes(WORK_HOURS.start);
const WORK_END_MIN = toMinutes(WORK_HOURS.end);

/**
 * One cached formatter. Constructing an Intl.DateTimeFormat is the expensive
 * part of this file by an order of magnitude, and every call wants the same
 * options.
 *
 * en-CA formats as 'YYYY-MM-DD, HH:MM' with stable field ordering, and
 * hourCycle 'h23' avoids the hour-24 midnight quirk that `hour12: false`
 * produces in some ICU versions.
 */
const FARM_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: FARM_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

interface FarmParts {
  date: string;
  minutes: number;
  /** The same wall clock read as if it were UTC -- used for offset arithmetic. */
  asUtcMs: number;
}

function partsOf(ms: number): FarmParts {
  const p = FARM_FORMAT.formatToParts(new Date(ms));
  const get = (type: string): number => Number(p.find((x) => x.type === type)?.value);
  const [y, mo, d, h, mi] = [get('year'), get('month'), get('day'), get('hour'), get('minute')];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    date: `${y}-${pad(mo)}-${pad(d)}`,
    minutes: h * 60 + mi,
    asUtcMs: Date.UTC(y, mo - 1, d, h, mi),
  };
}

/** Wall-clock parts of a UTC instant AS SEEN IN FARM_TZ. */
export function farmLocalParts(occurredAtIso: string): { date: string; minutes: number } {
  const ms = new Date(occurredAtIso).getTime();
  if (Number.isNaN(ms)) throw new Error(`unparseable occurred_at: ${occurredAtIso}`);
  const { date, minutes } = partsOf(ms);
  return { date, minutes };
}

/** The farm-local calendar date (YYYY-MM-DD) an instant falls on. */
export function farmLocalDate(occurredAtIso: string): string {
  return farmLocalParts(occurredAtIso).date;
}

/** True when the instant falls outside WORK_HOURS in FARM_TZ. */
export function isOffHours(occurredAtIso: string): boolean {
  const { minutes } = farmLocalParts(occurredAtIso);
  return minutes < WORK_START_MIN || minutes >= WORK_END_MIN;
}

/** FARM_TZ's offset from UTC, in minutes, at a given instant. */
function farmOffsetMinutes(ms: number): number {
  // Truncate to the minute so the difference is exactly the zone offset and not
  // offset-plus-leftover-seconds.
  const truncated = Math.floor(ms / 60_000) * 60_000;
  return (partsOf(truncated).asUtcMs - truncated) / 60_000;
}

/** The UTC instant of farm-local midnight opening the given calendar date. */
function farmMidnightUtcMs(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d) throw new Error(`invalid date: ${date}`);
  const naive = Date.UTC(y, mo - 1, d, 0, 0);
  // Two passes: the first offset is read at the naive instant, the second at
  // the corrected one. Asia/Karachi has no DST so one would do, but this stays
  // correct if FARM_TZ ever becomes a zone that does.
  let ms = naive;
  for (let i = 0; i < 2; i++) ms = naive - farmOffsetMinutes(ms) * 60_000;
  return ms;
}

/** The [start, end) UTC instant bounds of one farm-local calendar date. */
export function farmDayBoundsUtc(date: string): { startIso: string; endIso: string } {
  const startMs = farmMidnightUtcMs(date);
  // Derive the NEXT farm date from a point safely inside the following day,
  // then take its midnight -- so a 23- or 25-hour DST day would still bound
  // correctly rather than assuming exactly 24 hours.
  const endMs = farmMidnightUtcMs(partsOf(startMs + 36 * 3_600_000).date);
  return {
    startIso: new Date(startMs).toISOString(),
    endIso: new Date(endMs).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// scoreEvent -- the pure core (Decision 8)
// ---------------------------------------------------------------------------

export interface Verdict {
  severity: FarmEventSeverity;
  /** Which rule fired, in a form that lands in flag_reason verbatim. */
  reason: string;
  /** 1-based, only meaningful for unknown_cluster rows. */
  occurrenceNumber: number;
}

/** Rule identifiers, exported so expectations assert on the rule that fired
 * rather than on prose that might get reworded. */
export const RULE = {
  RESTRICTED_OFF_HOURS: 'restricted_zone_off_hours',
  RECURRING_UNKNOWN: 'recurring_unknown_cluster',
  LOW_CONFIDENCE_MATCH: 'low_confidence_face_match',
  ROUTINE: 'routine',
} as const;

/**
 * Score one event. Priority order, first match wins (Decision 8):
 *
 *   1. zone in RESTRICTED_ZONES and off-hours -> urgent (any event_type)
 *   2. unknown_cluster -> notable/urgent by occurrence number
 *   3. face_match below MATCH_CONFIDENT -> notable
 *   4. otherwise -> routine
 *
 * Rule 1 preceding rule 2 is what keeps cluster recurrence a WEIGHTED SIGNAL
 * rather than a certainty: a restricted-zone fact outranks any count, and a
 * count can only raise severity inside rule 2. Rule 1 applying to every
 * event_type is deliberate -- all three of night-visitor-unknown's rows flag
 * urgent, including the two `detection` rows with no identity, because a person
 * in the feed store at 02:14 is the anomaly whether or not a face resolved.
 *
 * PURE: no DB, no clock. `priorSightingCount` is supplied by the caller.
 */
export function scoreEvent(
  event: Pick<FarmEvent, 'zone' | 'event_type' | 'confidence' | 'occurred_at'>,
  priorSightingCount = 0,
): Verdict {
  const occurrenceNumber = priorSightingCount + 1;

  // --- rule 1: restricted zone, off-hours -- overrides everything ----------
  if (event.zone && RESTRICTED_ZONES.has(event.zone) && isOffHours(event.occurred_at)) {
    return {
      severity: 'urgent',
      reason: RULE.RESTRICTED_OFF_HOURS,
      occurrenceNumber,
    };
  }

  // --- rule 2: unknown cluster, by occurrence number -----------------------
  if (event.event_type === 'unknown_cluster') {
    // Compared on occurrenceNumber, NOT priorSightingCount: occurrence 1 has a
    // prior count of 0 and occurrence 3 has 2, so comparing the raw count
    // against these constants is off by one in both directions and would make
    // both `notable` on first sighting and `urgent` by the third unreachable.
    if (occurrenceNumber >= RECURRENCE.URGENT_AFTER) {
      return { severity: 'urgent', reason: RULE.RECURRING_UNKNOWN, occurrenceNumber };
    }
    if (occurrenceNumber >= RECURRENCE.NOTABLE_AFTER) {
      return { severity: 'notable', reason: RULE.RECURRING_UNKNOWN, occurrenceNumber };
    }
  }

  // --- rule 3: a named identity that fell below threshold ------------------
  if (
    event.event_type === 'face_match' &&
    event.confidence !== null &&
    event.confidence < CONFIDENCE.MATCH_CONFIDENT
  ) {
    return {
      severity: 'notable',
      reason: RULE.LOW_CONFIDENCE_MATCH,
      occurrenceNumber,
    };
  }

  // --- rule 4 --------------------------------------------------------------
  return { severity: 'routine', reason: RULE.ROUTINE, occurrenceNumber };
}

// ---------------------------------------------------------------------------
// Lookback window -- pure, so the shell and the tests share one definition
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

/** The event-relative lookback window start for one event. */
export function lookbackStartIso(occurredAtIso: string): string {
  const ms = new Date(occurredAtIso).getTime();
  if (Number.isNaN(ms)) throw new Error(`unparseable occurred_at: ${occurredAtIso}`);
  return new Date(ms - RECURRENCE.LOOKBACK_DAYS * DAY_MS).toISOString();
}
