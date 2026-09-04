// Animal registry -- calving interval, the one metric this cycle derives
// (decision doc §12). PURE: no `../db`.
//
// The whole point of this module is the `measured` / `approximate` split, and
// the refusal to blend them. An approximate interval built from two
// month-precision calvings carries roughly +/-60 days of uncertainty, which is
// LARGER than the difference between a good interval and a bad one -- averaging
// it into a herd figure produces a number that looks precise and means nothing.

import { canonicalOrder, daysBetween, effectiveEvents } from './project';
import type { DatePrecision, RegistryEvent } from './types';

/**
 * Events grouped by animal, each list in canonical order -- the input shape
 * `intervalReport` takes.
 *
 * Lives here rather than beside each caller because it had reached three
 * copies: routes.ts (`/verification`), verifyRegistry.ts, and now the agent's
 * `get_calving_intervals`. All three built the identical map to feed the
 * identical function, so the third was the point to stop. It belongs next to
 * `intervalReport` for the same reason `summarise` takes a pre-filtered list:
 * the module owns the shape of its own input.
 */
export function groupByAnimal(events: RegistryEvent[]): Map<string, RegistryEvent[]> {
  const out = new Map<string, RegistryEvent[]>();
  for (const e of canonicalOrder(events)) {
    const list = out.get(e.animal_id);
    if (list) list.push(e);
    else out.set(e.animal_id, [e]);
  }
  return out;
}

export type IntervalQuality = 'measured' | 'approximate';

export interface CalvingInterval {
  animal_id: string;
  /** 1-based: the interval between calving n and calving n+1. */
  ordinal: number;
  from_on: string;
  from_precision: DatePrecision;
  to_on: string;
  to_precision: DatePrecision;
  days: number;
  quality: IntervalQuality;
}

/** `measured` only when BOTH endpoints are known to the day. */
export function intervalQuality(
  a: DatePrecision,
  b: DatePrecision,
): IntervalQuality {
  return a === 'day' && b === 'day' ? 'measured' : 'approximate';
}

/** Intervals for one animal, oldest first. Fewer than two calvings yields none. */
export function intervalsForAnimal(
  animalId: string,
  events: RegistryEvent[],
): CalvingInterval[] {
  const calvings = canonicalOrder(effectiveEvents(events)).filter(
    (e) => e.type === 'calving',
  );
  const out: CalvingInterval[] = [];
  for (let i = 1; i < calvings.length; i++) {
    const prev = calvings[i - 1];
    const cur = calvings[i];
    out.push({
      animal_id: animalId,
      ordinal: i,
      from_on: prev.occurred_on,
      from_precision: prev.date_precision,
      to_on: cur.occurred_on,
      to_precision: cur.date_precision,
      days: daysBetween(prev.occurred_on, cur.occurred_on),
      quality: intervalQuality(prev.date_precision, cur.date_precision),
    });
  }
  return out;
}

export interface IntervalSummary {
  quality: IntervalQuality;
  count: number;
  /** Null when count is 0. Never computed across qualities. */
  mean_days: number | null;
  min_days: number | null;
  max_days: number | null;
}

/**
 * Summarise ONE quality class.
 *
 * Takes a pre-filtered list rather than filtering internally, so there is no
 * overload that could accidentally be handed a mixed list. Blending is not
 * something this module can be asked to do.
 */
export function summarise(
  quality: IntervalQuality,
  intervals: CalvingInterval[],
): IntervalSummary {
  const days = intervals.filter((i) => i.quality === quality).map((i) => i.days);
  if (days.length === 0) {
    return { quality, count: 0, mean_days: null, min_days: null, max_days: null };
  }
  const sum = days.reduce((a, b) => a + b, 0);
  return {
    quality,
    count: days.length,
    mean_days: Math.round((sum / days.length) * 10) / 10,
    min_days: Math.min(...days),
    max_days: Math.max(...days),
  };
}

export interface IntervalReport {
  intervals: CalvingInterval[];
  measured: IntervalSummary;
  approximate: IntervalSummary;
  /** The caveat, carried in the data so a caller cannot render the number alone. */
  caveat: string;
}

/**
 * The herd report. Both summaries, always, never a combined one.
 *
 * The caveat travels WITH the numbers deliberately: five or six milking animals
 * is a case series, not a dataset, and any consumer that renders the mean
 * without it is misrepresenting the sample. Making it a field rather than a
 * comment means the caller has to actively drop it.
 */
export function intervalReport(
  byAnimal: Map<string, RegistryEvent[]>,
): IntervalReport {
  const intervals: CalvingInterval[] = [];
  for (const [animalId, events] of [...byAnimal].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  )) {
    intervals.push(...intervalsForAnimal(animalId, events));
  }
  const measured = summarise('measured', intervals);
  const approximate = summarise('approximate', intervals);
  return {
    intervals,
    measured,
    approximate,
    caveat:
      `${measured.count} measured and ${approximate.count} approximate interval(s). ` +
      'These are reported separately and never averaged together: an approximate ' +
      'interval from two month-precision calvings carries roughly +/-60 days, larger ' +
      'than the difference between a good interval and a bad one. At this herd size ' +
      'this is a case series, not a dataset.',
  };
}

// ---------------------------------------------------------------------------
// Precision histogram (decision doc §11)
// ---------------------------------------------------------------------------

/** Separator for the composite histogram key. See histogram() below for why NUL. */
const SEPARATOR = '\u0000';

export interface PrecisionHistogramCell {
  source_form: string;
  date_precision: DatePrecision;
  count: number;
}

/**
 * Event counts by source_form x date_precision.
 *
 * This REPLACES the un-checkable "no fabricated exact dates" checkbox.
 * Invariants 11 and 12 catch INCONSISTENT precision; nothing can catch
 * DISHONEST precision, because that is a claim about the world. A backfill that
 * comes out 90% day-precision `recall` is the signal you want, and only the
 * histogram shows it. Read it; do not assert on it.
 */
export function precisionHistogram(events: RegistryEvent[]): PrecisionHistogramCell[] {
  const counts = new Map<string, number>();
  for (const e of events) {
    // NUL as the separator, and written as an ESCAPE rather than a literal
    // control byte: a raw NUL makes git classify this whole source file as
    // binary, so every diff of it reads "Bin 5904 bytes" and hides the logic
    // worth reviewing. The byte itself is the right choice -- it cannot occur
    // in a source_form or a date_precision, so no pair can collide with
    // another by straddling the join. Same convention as idempotency.ts.
    const key = `${e.source_form}${SEPARATOR}${e.date_precision}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, count]) => {
      const [source_form, date_precision] = key.split(SEPARATOR);
      return { source_form, date_precision: date_precision as DatePrecision, count };
    })
    .sort((a, b) =>
      a.source_form === b.source_form
        ? a.date_precision < b.date_precision
          ? -1
          : 1
        : a.source_form < b.source_form
          ? -1
          : 1,
    );
}
