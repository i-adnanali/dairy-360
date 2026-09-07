// Animal registry -- the day board (docs/REGISTRY_PAYROLL.md §12.4).
//
// What still needs recording. Assembled on the SERVER rather than by six client
// round trips, for the reason every other read model is: the rule for "is this
// session done" is one rule, and a client that re-derived it would be a second
// implementation that drifts.
//
// ---------------------------------------------------------------------------
// IT ANSWERS A QUESTION, IT DOES NOT SUMMARISE THE FARM
// ---------------------------------------------------------------------------
// There is no herd count here, no litres this month, no revenue. Those are
// interesting and they are not what somebody opens the app holding -- and a
// landing page of figures nobody acts on is one people stop reading, which
// costs the lines that DO need acting on. Every line on this board is
// actionable or it is not on it.
//
// ---------------------------------------------------------------------------
// `on` IS A PARAMETER, NEVER A CLOCK READ
// ---------------------------------------------------------------------------
// Same rule the projections follow. It is what lets a test open the board on a
// fixed date, and what would let the screen show yesterday if that is ever
// wanted.

import { dispatchSheet } from './dispatch';
import { milkingRoster } from './milking';
import { payrollRun } from './payroll';
import type { Db } from './schema';
import type { MilkingSession } from './types';

const SESSIONS: readonly MilkingSession[] = ['morning', 'evening'];

export interface SessionStanding {
  session: MilkingSession;
  /** How many rows the session expects. Zero means there is nothing to do. */
  expected: number;
  /** How many are recorded. */
  recorded: number;
  /** True when every expected row has an answer. */
  complete: boolean;
}

export interface DayBoard {
  on: string;
  /** Per-animal yield. `expected` is the milking roster, derived from lactations. */
  milking: SessionStanding[];
  /** Milk leaving the bulk. `expected` counts STANDING destinations only. */
  dispatch: SessionStanding[];
  payroll: {
    /** The month `on` falls in. */
    from_on: string;
    to_on: string;
    /** Salaried engagements with no figure yet. */
    outstanding: number;
    permanent: number;
  };
  /**
   * The month BEFORE the one `on` falls in, when it is still unanswered.
   *
   * Present because the current month is outstanding for the whole of it, which
   * would make the payroll line permanently amber and therefore permanently
   * ignorable. Last month unanswered on the 7th is a real prompt; this month
   * unanswered on the 7th is just the calendar.
   */
  payroll_previous: {
    from_on: string;
    to_on: string;
    outstanding: number;
    permanent: number;
  } | null;
}

/** First and last day of the month `on` falls in. Farm-local, no clock. */
export function monthBounds(on: string): { from: string; to: string } {
  const [y, m] = on.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** The month before the one `on` falls in. */
export function previousMonthBounds(on: string): { from: string; to: string } {
  const [y, m] = on.split('-').map(Number);
  const py = m === 1 ? y - 1 : y;
  const pm = m === 1 ? 12 : m - 1;
  return monthBounds(`${py}-${String(pm).padStart(2, '0')}-01`);
}

/**
 * The day board for `on`.
 *
 * Composed from the read models that already exist rather than from new
 * queries, so "recorded" means here exactly what it means on the screen that
 * records it. If the milking roster's rule changes, this changes with it.
 */
export function dayBoard(db: Db, on: string): DayBoard {
  const milking: SessionStanding[] = SESSIONS.map((session) => {
    const roster = milkingRoster(db, { occurred_on: on, session });
    return {
      session,
      expected: roster.rows.length,
      recorded: roster.saved,
      // An animal-less farm, or one with nothing in milk, has nothing to do --
      // and `0 of 0` must read as done rather than as an outstanding task.
      complete: roster.rows.length === 0 || roster.saved >= roster.rows.length,
    };
  });

  const dispatch: SessionStanding[] = SESSIONS.map((session) => {
    const sheet = dispatchSheet(db, { occurred_on: on, session });
    // STANDING only. An occasional destination that took nothing is not a gap
    // -- absence is its normal state -- so counting it would make the sheet
    // permanently incomplete and the line permanently ignorable.
    const recorded = sheet.standing.filter((r) => r.existing !== null).length;
    return {
      session,
      expected: sheet.standing.length,
      recorded,
      complete: sheet.standing.length === 0 || recorded >= sheet.standing.length,
    };
  });

  const thisMonth = monthBounds(on);
  const run = payrollRun(db, thisMonth.from, thisMonth.to, on);

  const prev = previousMonthBounds(on);
  const prevRun = payrollRun(db, prev.from, prev.to, on);

  return {
    on,
    milking,
    dispatch,
    payroll: {
      from_on: thisMonth.from,
      to_on: thisMonth.to,
      outstanding: run.outstanding,
      permanent: run.permanent.length,
    },
    payroll_previous:
      prevRun.outstanding > 0
        ? {
            from_on: prev.from,
            to_on: prev.to,
            outstanding: prevRun.outstanding,
            permanent: prevRun.permanent.length,
          }
        : null,
  };
}
