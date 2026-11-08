// Farm-local "today", and the farm-local hour. PURE.
//
// ---------------------------------------------------------------------------
// WHY THE CLIENT NEEDS ITS OWN, AND WHY IT IS A DUPLICATE ON PURPOSE
// ---------------------------------------------------------------------------
// Until now no screen needed a date the operator had not typed: the backfill
// forms take every date from the keyboard, and the one place the server needed
// today (`as_of`) it computed itself. The milking roster is the first surface
// that OPENS on a date, so the browser has to name one.
//
// It must be FARM-LOCAL and never host-local. A laptop set to another timezone
// -- travelling, or simply misconfigured -- would otherwise open the roster on
// the wrong day and file a session against it, and every check in the system
// would pass, because a session dated yesterday is a perfectly valid session.
// That is the same class of silent wrongness the date-precision rules exist for.
//
// It duplicates server/src/registry/time.ts rather than sharing it: @dairy/shared
// is the only module both sides import, and it holds the DEMO domain's types,
// which the registry deliberately does not touch (see registry/types.ts). Moving
// FARM_TZ there to save four lines would put registry vocabulary into the demo
// package that the fork exists to keep separate. Two copies of one string is the
// cheaper wrong thing, and this comment is the mitigation.

/** Asia/Karachi. Pakistan does not observe DST; the offset is fixed at UTC+5. */
export const FARM_TZ = 'Asia/Karachi';

const FARM_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: FARM_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's farm-local calendar date, `YYYY-MM-DD`. Never host-local. */
export function farmToday(now: Date = new Date()): string {
  return FARM_DATE_FORMAT.format(now);
}

const FARM_HOUR_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: FARM_TZ,
  hour: '2-digit',
  hour12: false,
});

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "8 Nov, 18:00" from an ISO instant, read in farm time. Pakistan has a fixed
 * UTC+5 offset (see FARM_TZ), so this needs no Intl and no host ICU data.
 * Replaces raw "2026-11-08T18:00:00+05:00" strings on screen (audit F07).
 */
export function farmMoment(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const local = new Date(t + 5 * 3600_000);
  const hh = String(local.getUTCHours()).padStart(2, '0');
  const mm = String(local.getUTCMinutes()).padStart(2, '0');
  return `${local.getUTCDate()} ${SHORT_MONTHS[local.getUTCMonth()]}, ${hh}:${mm}`;
}

/** The farm-local hour, 0-23. Used only to guess which session is being entered. */
export function farmHour(now: Date = new Date()): number {
  return Number(FARM_HOUR_FORMAT.format(now));
}

/**
 * Which session is most likely being entered right now.
 *
 * A GUESS, and shown back as a changeable control rather than applied silently
 * -- the same contract as the date parser. Milking times move with the season
 * and with who is available, so this cannot be exact and does not pretend to be;
 * it only saves a click on the common path.
 */
export function likelySession(now: Date = new Date()): 'morning' | 'evening' {
  return farmHour(now) < 13 ? 'morning' : 'evening';
}
