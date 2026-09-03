// Animal registry -- farm-local "today". PURE (no `../db`).
//
// Split into its own module rather than added to project.ts so the pure
// projection core stays a pure FUNCTION of its inputs: project.ts must never
// read a clock, or the rebuild stops being reproducible and invariants 0 and 1
// become unfalsifiable. Reading the clock is a decision the CLI entry points
// make, once, and pass down as `asOf`.
//
// FARM_TZ is duplicated here rather than imported from farm/classify.ts. That
// module's subject is camera events and people; importing it would couple the
// registry to the Farm Monitor classifier for one string, and classify.ts's own
// header makes its DB-freedom a load-bearing property that a registry import
// would put at risk. Extracting a genuinely shared constants module is a
// separate small change and FARM_TZ is the only constant that would qualify.

/** Asia/Karachi. Pakistan does not observe DST; the offset is fixed at UTC+5. */
export const FARM_TZ = 'Asia/Karachi';

/**
 * en-CA formats as YYYY-MM-DD with stable field ordering -- the same choice
 * classify.ts makes, for the same reason.
 */
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
