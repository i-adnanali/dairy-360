// Sales read tools (docs/REGISTRY_SALES.md §14 item 9).
//
// Four tools over the destinations, the ledger and the reconciliation. Reads
// only, following REGISTRY_TOOLS.md Decision 1 -- writes are a later cycle, and
// a second entry path competing with a screen under measurement contaminates
// the reading of that screen.
//
// ---------------------------------------------------------------------------
// A FACTORY, LIKE registryReads.ts, AND FOR THE SAME REASON
// ---------------------------------------------------------------------------
// This file imports no `../db`. The singleton is reached one level up in
// index.ts, which is what keeps `npm test` from ever opening dairy.db.
//
// ---------------------------------------------------------------------------
// TWO THINGS EVERY DIGEST HERE HAS TO GET RIGHT
// ---------------------------------------------------------------------------
//   1. MONEY IS PAISA, AND A RATE IS TWO NUMBERS. Every amount is an integer of
//      paisa AND a formatted string, because a model reasoning over `700000`
//      will say "seven hundred thousand rupees" often enough to matter. Every
//      rate carries its lot size: this farm prices per 40 litres, and a rate
//      reported as a bare number is a fortyfold error waiting for someone to
//      quote it.
//   2. THE GAP IS NOT A PERCENTAGE WHEN PRODUCTION IS INCOMPLETE. `gap_pct`
//      comes through as null with the reason attached, exactly as the HTTP
//      route serves it. A model handed a number with a caveat will drop the
//      caveat; one handed a null cannot quote it.

import type { ReadToolResult, ToolError } from '@dairy/shared';
import { isRegistryError } from '../registry/errors';
import { destinationList, getDestination } from '../registry/destinations';
import { reconcileRange } from '../registry/dispatch';
import { balances, statement } from '../registry/ledger';
import { formatMinor, formatRate } from '../registry/money';
import { farmToday } from '../registry/time';
import type { Db } from '../registry/schema';
import type { ToolSchema } from './index';

type Args = Record<string, unknown>;

/** Run a read and map a domain refusal onto a ToolError. Same shape as registryReads. */
function guarded(fn: () => ReadToolResult): ReadToolResult {
  try {
    return fn();
  } catch (e) {
    if (isRegistryError(e)) {
      return { modelDigest: { ...e.toWire() } as unknown as ToolError };
    }
    throw e;
  }
}

/** Paisa AND prose. See the header: a bare 700000 gets misread as rupees. */
const money = (minor: number) => ({ minor, formatted: formatMinor(minor) });

function dateArg(args: Args, key: string, fallback: string): string {
  const v = args[key];
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// list_buyers
// ---------------------------------------------------------------------------

function listBuyers(db: Db, args: Args): ReadToolResult {
  const asOf = dateArg(args, 'as_of', farmToday());
  const rows = destinationList(db, asOf);
  const balanceBy = new Map(balances(db).map((b) => [b.destination_id, b.balance_minor]));

  return {
    modelDigest: {
      as_of: asOf,
      count: rows.length,
      destinations: rows.map((d) => ({
        id: d.id,
        name: d.name,
        kind: d.kind,
        // Both flags, because they answer different questions and a model that
        // conflates them will say home "owes nothing" as though it could.
        billable: d.billable,
        on_every_sheet: d.standing,
        active: d.active,
        buying_since: d.started_on,
        stopped_on: d.ended_on,
        rate: d.price
          ? {
              amount_minor: d.price.price_minor,
              per_litres: d.price.price_unit_litres,
              formatted: formatRate(d.price.price_minor, d.price.price_unit_litres),
              agreed_from: d.price.effective_from,
            }
          : null,
        balance: d.billable ? money(balanceBy.get(d.id) ?? 0) : null,
      })),
      note:
        'A destination with billable=false is milk the farm KEPT (home use), not a customer. It ' +
        'has no rate, no balance, and nothing owes anything on it. A rate is an amount AND the ' +
        'litres it covers -- report it as agreed (e.g. "Rs 7,000 per 40 litres"), never divided ' +
        'down to a per-litre figure the buyer never agreed to.',
    },
  };
}

// ---------------------------------------------------------------------------
// get_buyer_balance
// ---------------------------------------------------------------------------

function getBuyerBalance(db: Db, args: Args): ReadToolResult {
  const id = typeof args.destination_id === 'string' ? args.destination_id : '';
  const s = statement(db, id);
  if (!s) {
    return {
      modelDigest: {
        error: 'unknown_destination',
        destination_id: id,
        message: `No destination '${id}'. Call list_buyers for the current ids.`,
      } satisfies ToolError,
    };
  }
  if (!s.billable) {
    return {
      modelDigest: {
        error: 'not_billable',
        destination_id: id,
        message:
          `${s.name} is milk the farm kept, not a customer. There is no balance, because ` +
          `nothing was ever billed for it.`,
      } satisfies ToolError,
    };
  }

  return {
    modelDigest: {
      destination_id: s.destination_id,
      name: s.name,
      litres: s.litres,
      billed: money(s.billed_minor),
      paid: money(s.paid_minor),
      balance: money(s.balance_minor),
      // Said in words, because a negative balance is the state most likely to
      // be reported backwards.
      direction:
        s.balance_minor > 0
          ? 'they owe the farm'
          : s.balance_minor < 0
            ? 'they are in credit -- the farm owes them'
            : 'settled',
      months: s.months.map((m) => ({
        month: m.month,
        litres: m.litres,
        billed: money(m.billed_minor),
        paid: money(m.paid_minor),
        closing: money(m.closing_minor),
      })),
      note:
        'The month is a display grouping, not a settled period: the closing figure RUNS across ' +
        'months rather than resetting. This farm settles monthly with the dodhi and at the end ' +
        'of a run with an occasional household, so a month with a non-zero closing figure is ' +
        'not necessarily overdue.',
    },
  };
}

// ---------------------------------------------------------------------------
// get_dispatches
// ---------------------------------------------------------------------------

/** How many rows a dispatch digest will name before it summarises instead. */
export const DISPATCH_ROW_CAP = 40;

function getDispatches(db: Db, args: Args): ReadToolResult {
  const to = dateArg(args, 'to', farmToday());
  const from = dateArg(args, 'from', to);
  const id = typeof args.destination_id === 'string' ? args.destination_id : null;

  if (id !== null && getDestination(db, id) === null) {
    return {
      modelDigest: {
        error: 'unknown_destination',
        destination_id: id,
        message: `No destination '${id}'. Call list_buyers for the current ids.`,
      } satisfies ToolError,
    };
  }

  const r = reconcileRange(db, from, to);
  const rows = db
    .prepare(
      id === null
        ? `SELECT d.*, dest.name, dest.billable FROM registry_dispatches d
             JOIN registry_destinations dest ON dest.id = d.destination_id
            WHERE d.occurred_on BETWEEN ? AND ?
            ORDER BY d.occurred_on DESC, d.session`
        : `SELECT d.*, dest.name, dest.billable FROM registry_dispatches d
             JOIN registry_destinations dest ON dest.id = d.destination_id
            WHERE d.occurred_on BETWEEN ? AND ? AND d.destination_id = ?
            ORDER BY d.occurred_on DESC, d.session`,
    )
    .all(...(id === null ? [from, to] : [from, to, id])) as {
    id: string;
    name: string;
    billable: number;
    occurred_on: string;
    session: string;
    status: string;
    litres: number | null;
    price_minor: number | null;
    price_unit_litres: number | null;
    reason: string | null;
  }[];

  // Capped rather than coarsened: unlike a yield series there is no meaningful
  // bucket to collapse into -- each row is a transaction with a counterparty.
  // So the totals stay exact and only the enumeration is bounded.
  const shown = rows.slice(0, DISPATCH_ROW_CAP);

  return {
    modelDigest: {
      from,
      to,
      destination_id: id,
      total_rows: rows.length,
      shown: shown.length,
      truncated: rows.length > shown.length,
      sold_litres: r.dispatched_sold,
      kept_at_home_litres: r.dispatched_home,
      billed: money(r.billed_minor),
      rows: shown.map((d) => ({
        date: d.occurred_on,
        session: d.session,
        name: d.name,
        status: d.status,
        litres: d.litres,
        reason: d.reason,
        rate:
          d.price_minor === null || d.price_unit_litres === null
            ? null
            : formatRate(d.price_minor, d.price_unit_litres),
      })),
      note:
        "status 'none' means they came to nothing or did not come -- it is a recorded fact, not " +
        'a missing row. An occasional buyer with NO row simply did not take milk that session; ' +
        'absence is their normal state and must never be reported as missing data.',
    },
  };
}

// ---------------------------------------------------------------------------
// get_milk_reconciliation
// ---------------------------------------------------------------------------

function getMilkReconciliation(db: Db, args: Args): ReadToolResult {
  const to = dateArg(args, 'to', farmToday());
  const from = dateArg(args, 'from', to);
  const r = reconcileRange(db, from, to);

  return {
    modelDigest: {
      from: r.from,
      to: r.to,
      produced_measured_litres: r.produced_measured,
      measured_rows: r.measured_rows,
      milked_but_not_weighed_rows: r.not_measured_rows,
      not_milked_rows: r.not_milked_rows,
      animal_sessions_with_no_row: r.missing_milking_rows,
      sold_litres: r.dispatched_sold,
      kept_at_home_litres: r.dispatched_home,
      dispatched_total_litres: r.dispatched_total,
      billed: money(r.billed_minor),
      gap_litres: r.gap_litres,
      // NULL, with the reason, exactly as the route serves it.
      gap_pct: r.gap_pct,
      gap_pct_withheld_because: r.gap_pct_withheld_because,
      dispatch_sessions: r.sessions,
      dispatch_sessions_complete: r.complete_sessions,
      billed_off_agreed_rate: r.off_schedule.length,
      caveat: r.interpretation,
    },
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const SALES_READ_TOOLS: ToolSchema[] = [
  {
    name: 'list_buyers',
    description:
      "Who the farm's milk goes to, from the real registry: dodhis and households who buy it, AND the household's own use, which is recorded as a destination but never billed. Returns each one's id, kind, agreed rate, current balance, and whether it must be accounted for in every session. A rate is an amount AND the litres it covers -- this farm prices per 40 litres, so report it the way it was agreed (\"Rs 7,000 per 40 litres\") and never divide it into a per-litre figure. A destination with billable=false is milk the farm kept: it has no rate and no balance.",
    input_schema: {
      type: 'object',
      properties: {
        as_of: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'get_buyer_balance',
    description:
      'What one buyer owes, and the month-by-month working behind it. Returns litres, amount billed, amount paid, and the balance, all in paisa AND as formatted rupees, plus a running closing figure per calendar month. The balance is derived from the rows every time and is never stored. A NEGATIVE balance means the buyer is in credit and the farm owes them -- the `direction` field says which way it goes, in words. Use for "what does X owe?" and "is X up to date?".',
    input_schema: {
      type: 'object',
      required: ['destination_id'],
      properties: {
        destination_id: { type: 'string', description: 'From list_buyers, e.g. dst_...' },
      },
    },
  },
  {
    name: 'get_dispatches',
    description:
      'Milk that left the bulk over a date range, optionally for one buyer: per-session rows with litres, the rate each was billed at, and totals split into sold and kept-at-home. Use for "how much did the dodhi take last week?". A row with status `none` records that they took nothing that session; an occasional buyer with no row at all simply did not come, which is normal and is not missing data.',
    input_schema: {
      type: 'object',
      properties: {
        destination_id: { type: 'string', description: 'From list_buyers. Omit for everyone.' },
        from: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to `to`.' },
        to: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
  {
    name: 'get_milk_reconciliation',
    description:
      'Milk produced against milk that left the bulk, over a range: measured production, litres sold, litres kept at home, and the gap between them. Use for "does what we produce match what we sell?". CRITICAL: `gap_pct` is null whenever production is incomplete, and `gap_pct_withheld_because` says why -- when it is null, do NOT compute a percentage yourself, because the denominator is a lower bound. A NEGATIVE gap is normal while any milking is unweighed: the milk existed, nobody measured it. Report the gap in litres with the counts beside it and pass the caveat through.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to `to`.' },
        to: { type: 'string', description: 'ISO date YYYY-MM-DD. Defaults to today.' },
      },
    },
  },
];

export function salesReadExecutors(db: Db): Record<string, (args: Args) => ReadToolResult> {
  return {
    list_buyers: (args) => guarded(() => listBuyers(db, args)),
    get_buyer_balance: (args) => guarded(() => getBuyerBalance(db, args)),
    get_dispatches: (args) => guarded(() => getDispatches(db, args)),
    get_milk_reconciliation: (args) => guarded(() => getMilkReconciliation(db, args)),
  };
}
