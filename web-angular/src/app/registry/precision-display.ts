// How a stored date is DISPLAYED at the precision it was actually known to.
//
// The registry stores every date as a full ISO day and records separately how
// much of it was known: `month` is stored as the 1st, `year` and `estimated` as
// January 1 (see date-parse.ts `readingFor`). So the stored string always
// carries digits nobody ever knew.
//
// THE HERD TABLE WAS PRINTING THEM. `{{ r.birth_on }} ({{ r.birth_precision }})`
// renders a month-precision animal as `2019-03-01 (month)`, and that `-01` is a
// day the operator was careful NOT to claim. The comment directly above that
// cell reads "Precision is shown on every date. Never a bare date: hiding the
// qualifier manufactures confidence" -- which is right about the qualifier and
// blind to the fabricated day beside it. Showing both is not honest; it is two
// contradictory claims in one cell.
//
// So the figure is TRUNCATED to its precision, per UI_SYSTEM.md §6.1's own
// examples: `2017-03 month`, `2016 year`, `~2018 est`.
//
// This file is domain knowledge -- it knows what a DatePrecision means -- and
// so it lives in registry/ rather than in ui/. ui/certainty.ts holds only the
// treatment and knows nothing about dates.

import type { DatePrecision } from './types';
import type { CertaintyState } from '../ui/certainty';

/** A date, ready to render: the figure, its certainty, and its qualifier. */
export interface PrecisionParts {
  /** The figure, truncated to what was known. Empty when there is no date. */
  figure: string;
  state: CertaintyState;
  /** §6.1's lowercase word, or null when the date needs no qualifying. */
  qualifier: string | null;
}

/** The no-record state's glyph. An EN DASH, not a hyphen and not an em dash. */
export const NO_RECORD = '–';

/**
 * `estimated` keeps its tilde AND its word, which looks like belt and braces
 * and is not.
 *
 * §6.1 gives `~2018 est` as its own example, and the two marks say different
 * things: `est` names WHY the figure is imprecise (somebody estimated it),
 * while `~` says the figure itself is approximate. A `year`-precision date is
 * an exact year with an unknown month; an `estimated` one may not even be the
 * right year. The tilde is the only thing that carries that difference, and
 * dropping it would make `estimated` and `year` render identically apart from
 * one word.
 */
export function precisionParts(
  on: string | null,
  precision: DatePrecision | null,
): PrecisionParts {
  if (on === null || on.length === 0) {
    return { figure: NO_RECORD, state: 'no-record', qualifier: null };
  }
  // A date with no recorded precision is a date whose precision was never
  // asked for. It is not `day` -- asserting exactness nobody claimed is the
  // whole failure this module exists to stop -- so it reads as approximate
  // with no qualifier to name.
  if (precision === null) {
    return { figure: on, state: 'approximate', qualifier: null };
  }
  switch (precision) {
    case 'day':
      return { figure: on, state: 'known', qualifier: null };
    case 'month':
      return { figure: on.slice(0, 7), state: 'approximate', qualifier: 'month' };
    case 'year':
      return { figure: on.slice(0, 4), state: 'approximate', qualifier: 'year' };
    case 'estimated':
      return { figure: `~${on.slice(0, 4)}`, state: 'approximate', qualifier: 'est' };
  }
}

/**
 * A quantity that is approximate: `~9.9 L`.
 *
 * §6.1 keeps the tilde for quantities rather than giving them a word, "where
 * there is no room for a word and the tilde already reads as about". A mean
 * over five sessions is the case: `9.9 L est` in a table column is three tokens
 * where one will do.
 */
export function approximateQuantity(value: number | string, unit = ''): string {
  return `~${value}${unit.length > 0 ? ` ${unit}` : ''}`;
}
