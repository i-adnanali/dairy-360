// Animal registry -- milk leaving the bulk (docs/REGISTRY_SALES.md §4.3, §11, §12.1).
//
// The daily sheet: who took milk, in which session, and what it was priced at.
// One module for the whole feature -- the pure rules, the transactional write,
// the sheet read model and the reconciliation -- the same shape as milking.ts,
// and cohesive for the same reason.
//
// ---------------------------------------------------------------------------
// WHAT MAKES THIS DIFFERENT FROM registry_milkings
// ---------------------------------------------------------------------------
// A yield is a MEASUREMENT with no counterparty. A dispatch is a TRANSACTION:
// somebody else's money depends on the figure, and a disputed balance is
// settled by pointing at these rows. Three consequences:
//
//   1. THREE row states, not four. `milked_not_measured` exists because a
//      fabricated yield is worse than a recorded gap and nobody is harmed by an
//      unweighed milking. Here the litres IS the transaction, so an unmeasured
//      dispatch is not a thing that happens.
//   2. The roster is SPLIT. Standing destinations (the dodhi, home) must be
//      accounted for in every session and block the save when untouched;
//      occasional ones (the households, who take surplus) are not rows until
//      they took something. See §4.1a -- and note the cost, which is real:
//      an occasional sale nobody records leaves no hole here to find. The
//      reconciliation below is the only thing that catches it.
//   3. The price is CAPTURED, with its lot size, at entry time.
//
// Corrections are an UPDATE and whole sessions are deleted and re-entered,
// exactly as for milkings. That is settled for now and NOT settled forever:
// §8 records why a revisions table is the likely next step.

import { randomUUID } from 'node:crypto';

import { RegistryError } from './errors';
import { activeOn, getDestination, priceInForce } from './destinations';
import { lactationCovering } from './milking';
import { amountMinor } from './money';
import type { Db } from './schema';
import type {
  DestinationPriceRow,
  DestinationRow,
  DispatchRow,
  DispatchStatus,
  LactationRow,
  MilkingSession,
  Provenance,
  RegistryMilkingRow,
} from './types';
import { DISPATCH_STATUSES, MILKING_SESSIONS } from './types';

export const DISPATCH_ID_PREFIX = 'dsp_';

export function newDispatchId(): string {
  return `${DISPATCH_ID_PREFIX}${randomUUID()}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refuse(code: ConstructorParameters<typeof RegistryError>[0], msg: string, field?: string): never {
  throw new RegistryError(code, msg, field);
}

function blank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

// ---------------------------------------------------------------------------
// Validation -- PURE
// ---------------------------------------------------------------------------

export interface DispatchEntryInput {
  destination_id: string;
  status: DispatchStatus;
  /** Required exactly when status is `taken`; refused otherwise. */
  litres?: number | null;
  /** Only with `none`. */
  reason?: string | null;
  observed_by?: string | null;
  note?: string | null;
}

export interface NormalizedDispatchEntry {
  destination_id: string;
  status: DispatchStatus;
  litres: number | null;
  reason: string | null;
  observed_by: string | null;
  note: string | null;
}

/**
 * One entry, validated and normalized.
 *
 * The status/litres agreement is checked here AND by a CHECK constraint AND by
 * invariant 19 -- three layers, the same arrangement as the date conventions.
 * This one exists to produce a readable refusal.
 */
export function assertDispatchEntry(raw: unknown): NormalizedDispatchEntry {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    refuse('invalid_payload', 'each entry must be an object', 'entries');
  }
  const e = raw as Record<string, unknown>;

  const destinationId = typeof e.destination_id === 'string' ? e.destination_id.trim() : '';
  if (destinationId.length === 0) {
    refuse('invalid_payload', 'each entry needs a destination_id', 'destination_id');
  }

  const status = e.status;
  if (!(DISPATCH_STATUSES as readonly unknown[]).includes(status)) {
    refuse(
      'invalid_payload',
      `status must be one of ${DISPATCH_STATUSES.join(' | ')}, got ${JSON.stringify(status)}`,
      'status',
    );
  }

  const litresRaw = e.litres;
  let litres: number | null = null;
  if (status === 'taken') {
    if (typeof litresRaw !== 'number' || !Number.isFinite(litresRaw)) {
      refuse(
        'invalid_payload',
        `${destinationId}: 'taken' needs a number of litres. If nothing was taken, that is ` +
          `'none' -- a different and recordable fact.`,
        'litres',
      );
    }
    if (litresRaw < 0) {
      refuse('invalid_payload', `${destinationId}: litres cannot be negative`, 'litres');
    }
    litres = litresRaw;
  } else if (litresRaw !== undefined && litresRaw !== null) {
    refuse(
      'invalid_payload',
      `${destinationId}: 'none' means no milk was taken, so it cannot carry litres`,
      'litres',
    );
  }

  const reason = blank(e.reason as string | null | undefined);
  if (reason !== null && status !== 'none') {
    refuse(
      'invalid_payload',
      `${destinationId}: a reason explains why nothing was taken, so it belongs only to 'none'`,
      'reason',
    );
  }

  return {
    destination_id: destinationId,
    status: status as DispatchStatus,
    litres,
    reason,
    observed_by: blank(e.observed_by as string | null | undefined),
    note: blank(e.note as string | null | undefined),
  };
}

// ---------------------------------------------------------------------------
// The write -- one session, one transaction
// ---------------------------------------------------------------------------

export interface SaveDispatchSessionInput {
  occurred_on: string;
  session: MilkingSession;
  occurred_time?: string | null;
  /** Who handed the milk over. Each entry may override it. */
  observed_by?: string | null;
  entries: DispatchEntryInput[];
  provenance: Provenance;
}

export interface SaveDispatchSessionResult {
  occurred_on: string;
  session: MilkingSession;
  written: number;
  taken: number;
  none: number;
  updated: number;
  /** Total litres out, and what was billed for them. */
  litres: number;
  amount_minor: number;
  rows: DispatchRow[];
}

/**
 * Save a whole session. ALL ROWS OR NONE.
 *
 * An UPSERT rather than an insert, because correcting a figure is the ordinary
 * repair path and it conflicts on (destination_id, occurred_on, session).
 *
 * ---------------------------------------------------------------------------
 * EVERY STANDING DESTINATION MUST BE ACCOUNTED FOR, AND THAT IS ENFORCED HERE
 * ---------------------------------------------------------------------------
 * Not only in the UI. A sheet that silently accepts a missing dodhi row is a
 * sheet whose completeness count means nothing, and the screen is not the only
 * caller -- the route is reachable directly. Occasional destinations are the
 * exact opposite: absent is their normal state and is never an error.
 */
export function saveDispatchSession(
  db: Db,
  input: SaveDispatchSessionInput,
): SaveDispatchSessionResult {
  if (!DATE_RE.test(input.occurred_on)) {
    refuse(
      'invalid_payload',
      `occurred_on must be YYYY-MM-DD, got '${input.occurred_on}'`,
      'occurred_on',
    );
  }
  if (!(MILKING_SESSIONS as readonly string[]).includes(input.session)) {
    refuse(
      'invalid_payload',
      `session must be one of ${MILKING_SESSIONS.join(' | ')}, got ${JSON.stringify(input.session)}`,
      'session',
    );
  }
  const time = blank(input.occurred_time);
  if (time !== null && !/^[0-2]\d:[0-5]\d$/.test(time)) {
    refuse('invalid_payload', `occurred_time must be HH:MM, got '${time}'`, 'occurred_time');
  }
  if (!Array.isArray(input.entries)) {
    refuse('invalid_payload', 'entries must be an array', 'entries');
  }

  const normalized = input.entries.map(assertDispatchEntry);

  const seen = new Set<string>();
  for (const e of normalized) {
    if (seen.has(e.destination_id)) {
      refuse(
        'invalid_payload',
        `${e.destination_id} appears twice in one session. One row per destination per session ` +
          `is what makes completeness countable.`,
        'entries',
      );
    }
    seen.add(e.destination_id);
  }

  const sessionHandler = blank(input.observed_by);
  const recordedAt = new Date().toISOString();

  const run = db.transaction((): SaveDispatchSessionResult => {
    // Every standing destination active on this date has to have an answer.
    const standing = (
      db.prepare(`SELECT * FROM registry_destinations WHERE standing = 1`).all() as {
        id: string;
        name: string;
        started_on: string;
        ended_on: string | null;
      }[]
    ).filter((d) => activeOn(d as unknown as DestinationRow, input.occurred_on));

    const missing = standing.filter((d) => !seen.has(d.id));
    if (missing.length > 0) {
      refuse(
        'untouched_standing_destination',
        `${missing.map((d) => d.name).join(', ')} ${missing.length === 1 ? 'is' : 'are'} on ` +
          `every sheet and ${missing.length === 1 ? 'has' : 'have'} no answer for this session. ` +
          `If nothing was taken, say so -- that is a real answer and an omission is not.`,
        'entries',
      );
    }

    const rows: DispatchRow[] = [];
    let updated = 0;

    for (const e of normalized) {
      const destination = getDestination(db, e.destination_id);
      if (!destination) {
        refuse(
          'unknown_destination',
          `unknown destination '${e.destination_id}'`,
          'destination_id',
        );
      }
      if (!activeOn(destination, input.occurred_on)) {
        refuse(
          'destination_not_active',
          `${destination.name} was not taking milk on ${input.occurred_on} ` +
            `(${destination.started_on} to ${destination.ended_on ?? 'open'}). Either the date ` +
            `is wrong, or the range needs correcting first.`,
          'destination_id',
        );
      }

      // The price is CAPTURED, with its lot size. Only for a billable
      // destination that actually took milk: home has no price, and a `none`
      // row is not a sale.
      let priceMinor: number | null = null;
      let priceUnitLitres: number | null = null;
      if (destination.billable && e.status === 'taken') {
        const prices = db
          .prepare(
            `SELECT * FROM registry_destination_prices
              WHERE destination_id = ? ORDER BY effective_from`,
          )
          .all(e.destination_id) as DestinationPriceRow[];
        const inForce = priceInForce(prices, input.occurred_on);
        if (inForce === null) {
          refuse(
            'no_price_in_force',
            `${destination.name} has no agreed price covering ${input.occurred_on}, so this ` +
              `milk cannot be billed. Set a price effective from that date or earlier, then ` +
              `save again.`,
            'destination_id',
          );
        }
        priceMinor = inForce.price_minor;
        priceUnitLitres = inForce.price_unit_litres;
      }

      const existing = db
        .prepare(
          `SELECT id FROM registry_dispatches
            WHERE destination_id = ? AND occurred_on = ? AND session = ?`,
        )
        .get(e.destination_id, input.occurred_on, input.session) as { id: string } | undefined;

      const row: DispatchRow = {
        id: existing?.id ?? newDispatchId(),
        destination_id: e.destination_id,
        occurred_on: input.occurred_on,
        session: input.session,
        status: e.status,
        litres: e.litres,
        price_minor: priceMinor,
        price_unit_litres: priceUnitLitres,
        reason: e.reason,
        occurred_time: time,
        observed_by: e.observed_by ?? sessionHandler,
        recorded_by: input.provenance.recorded_by,
        recorded_at: recordedAt,
        source_form: input.provenance.source_form,
        note: e.note,
      };

      db.prepare(
        `INSERT INTO registry_dispatches
           (id, destination_id, occurred_on, session, status, litres, price_minor,
            price_unit_litres, reason, occurred_time, observed_by, recorded_by, recorded_at,
            source_form, note)
         VALUES
           (@id, @destination_id, @occurred_on, @session, @status, @litres, @price_minor,
            @price_unit_litres, @reason, @occurred_time, @observed_by, @recorded_by, @recorded_at,
            @source_form, @note)
         ON CONFLICT (destination_id, occurred_on, session) DO UPDATE SET
            status            = excluded.status,
            litres            = excluded.litres,
            price_minor       = excluded.price_minor,
            price_unit_litres = excluded.price_unit_litres,
            reason            = excluded.reason,
            occurred_time     = excluded.occurred_time,
            observed_by       = excluded.observed_by,
            recorded_by       = excluded.recorded_by,
            recorded_at       = excluded.recorded_at,
            source_form       = excluded.source_form,
            note              = excluded.note`,
      ).run(row);

      if (existing) updated++;
      rows.push(row);
    }

    return {
      occurred_on: input.occurred_on,
      session: input.session,
      written: rows.length,
      taken: rows.filter((r) => r.status === 'taken').length,
      none: rows.filter((r) => r.status === 'none').length,
      updated,
      litres: round2(rows.reduce((s, r) => s + (r.litres ?? 0), 0)),
      amount_minor: rows.reduce((s, r) => s + dispatchAmountMinor(r), 0),
      rows,
    };
  });

  return run();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * What one dispatch row is worth, in paisa. Zero when nothing is billable.
 *
 * The ONLY place a dispatch row becomes money, so that the sheet footer, the
 * statement and the balance cannot disagree about the same row.
 */
export function dispatchAmountMinor(r: DispatchRow): number {
  if (r.status !== 'taken' || r.litres === null) return 0;
  if (r.price_minor === null || r.price_unit_litres === null) return 0;
  return amountMinor(r.litres, r.price_minor, r.price_unit_litres);
}

/**
 * Remove a session, or one destination's row in it.
 *
 * The repair path for a session entered against the wrong date, which
 * update-in-place leaves no other way to fix. Deliberately narrow -- a date and
 * a session, never a range -- exactly as for milkings, and for the same reason:
 * there must be no shape of call that clears history.
 */
export function deleteDispatches(
  db: Db,
  where: { occurred_on: string; session: MilkingSession; destination_id?: string },
): number {
  if (!DATE_RE.test(where.occurred_on)) {
    refuse(
      'invalid_payload',
      `occurred_on must be YYYY-MM-DD, got '${where.occurred_on}'`,
      'occurred_on',
    );
  }
  if (!(MILKING_SESSIONS as readonly string[]).includes(where.session)) {
    refuse('invalid_payload', `unknown session '${where.session}'`, 'session');
  }
  const info =
    where.destination_id !== undefined
      ? db
          .prepare(
            `DELETE FROM registry_dispatches
              WHERE occurred_on = ? AND session = ? AND destination_id = ?`,
          )
          .run(where.occurred_on, where.session, where.destination_id)
      : db
          .prepare(`DELETE FROM registry_dispatches WHERE occurred_on = ? AND session = ?`)
          .run(where.occurred_on, where.session);
  return info.changes;
}

// ---------------------------------------------------------------------------
// The sheet -- the read model the entry screen is
// ---------------------------------------------------------------------------

export interface SheetRow {
  destination_id: string;
  name: string;
  kind: DestinationRow['kind'];
  billable: boolean;
  standing: boolean;
  /** This destination's row for THIS session, when one has been saved. */
  existing: DispatchRow | null;
  /** The same session yesterday -- a misplaced decimal is obvious against it. */
  previous: { occurred_on: string; status: DispatchStatus; litres: number | null } | null;
  /** The agreement in force on this date. Null for home, and for an unpriced buyer. */
  price: DestinationPriceRow | null;
}

export interface DispatchSheet {
  occurred_on: string;
  session: MilkingSession;
  previous_session: { occurred_on: string; session: MilkingSession };
  /** Must be answered. Untouched blocks the save. */
  standing: SheetRow[];
  /** Offered, never required -- a row only when they took something. */
  occasional: SheetRow[];
  /** Litres and money already saved for this session. */
  litres: number;
  amount_minor: number;
  /**
   * What the herd produced in THIS session, as far as anyone measured.
   *
   * On the sheet so the gap is visible at the moment it is cheapest to fix, and
   * `not_measured` travels beside it so "out exceeds produced" reads as the
   * missing measurement it usually is rather than as an alarm.
   */
  produced: SessionProduction;
}

export interface SessionProduction {
  /** Sum of MEASURED yields only. A LOWER BOUND while not_measured > 0. */
  measured_litres: number;
  measured: number;
  not_measured: number;
  not_milked: number;
  /** Animals with a lactation covering this date -- who should have a row. */
  expected: number;
  recorded: number;
}

/** The last comparable session: the same one, the day before. */
export function previousSession(on: string, session: MilkingSession): {
  occurred_on: string;
  session: MilkingSession;
} {
  const [y, m, d] = on.split('-').map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  return { occurred_on: prev.toISOString().slice(0, 10), session };
}

/**
 * What the herd produced in one session, from the milking rows. PURE.
 *
 * MEASURED AND NOT-MEASURED ARE NEVER SUMMED. `measured_litres` is a lower
 * bound whenever `not_measured` is above zero, and every consumer has to have
 * both numbers to say anything true about the difference.
 */
export function sessionProduction(
  milkings: readonly RegistryMilkingRow[],
  lactations: readonly LactationRow[],
  on: string,
  session: MilkingSession,
): SessionProduction {
  const rows = milkings.filter((m) => m.occurred_on === on && m.session === session);

  const byAnimal = new Map<string, LactationRow[]>();
  for (const l of lactations) {
    const list = byAnimal.get(l.animal_id);
    if (list) list.push(l);
    else byAnimal.set(l.animal_id, [l]);
  }
  let expected = 0;
  for (const list of byAnimal.values()) {
    if (lactationCovering(list, on) !== null) expected++;
  }

  return {
    measured_litres: round2(
      rows.filter((r) => r.status === 'measured').reduce((s, r) => s + (r.yield_litres ?? 0), 0),
    ),
    measured: rows.filter((r) => r.status === 'measured').length,
    not_measured: rows.filter((r) => r.status === 'milked_not_measured').length,
    not_milked: rows.filter((r) => r.status === 'not_milked').length,
    expected,
    recorded: rows.length,
  };
}

/**
 * The sheet for one session.
 *
 * SPLIT INTO TWO LISTS, and that split is the whole of §4.1a. Standing
 * destinations must be answered; occasional ones are offered. Both lists are
 * DERIVED from the active range, never picked, so there is no way to leave a
 * standing destination out of the list -- which is what makes an omission
 * deliberate rather than possible.
 */
export function dispatchSheet(
  db: Db,
  opts: { occurred_on: string; session: MilkingSession },
): DispatchSheet {
  if (!DATE_RE.test(opts.occurred_on)) {
    refuse(
      'invalid_payload',
      `occurred_on must be YYYY-MM-DD, got '${opts.occurred_on}'`,
      'occurred_on',
    );
  }
  if (!(MILKING_SESSIONS as readonly string[]).includes(opts.session)) {
    refuse('invalid_payload', `unknown session '${opts.session}'`, 'session');
  }

  const prev = previousSession(opts.occurred_on, opts.session);

  const destinations = (
    db.prepare(`SELECT * FROM registry_destinations ORDER BY name, id`).all() as (Omit<
      DestinationRow,
      'billable' | 'standing'
    > & { billable: number; standing: number })[]
  )
    .map((d) => ({ ...d, billable: d.billable === 1, standing: d.standing === 1 }))
    .filter((d) => activeOn(d, opts.occurred_on));

  const prices = db
    .prepare(`SELECT * FROM registry_destination_prices ORDER BY destination_id, effective_from`)
    .all() as DestinationPriceRow[];
  const pricesBy = new Map<string, DestinationPriceRow[]>();
  for (const p of prices) {
    const list = pricesBy.get(p.destination_id);
    if (list) list.push(p);
    else pricesBy.set(p.destination_id, [p]);
  }

  const rows: SheetRow[] = destinations.map((d) => {
    const existing =
      (db
        .prepare(
          `SELECT * FROM registry_dispatches
            WHERE destination_id = ? AND occurred_on = ? AND session = ?`,
        )
        .get(d.id, opts.occurred_on, opts.session) as DispatchRow | undefined) ?? null;

    const previous =
      (db
        .prepare(
          `SELECT occurred_on, status, litres FROM registry_dispatches
            WHERE destination_id = ? AND occurred_on = ? AND session = ?`,
        )
        .get(d.id, prev.occurred_on, prev.session) as SheetRow['previous']) ?? null;

    return {
      destination_id: d.id,
      name: d.name,
      kind: d.kind,
      billable: d.billable,
      standing: d.standing,
      existing,
      previous,
      price: d.billable ? priceInForce(pricesBy.get(d.id) ?? [], opts.occurred_on) : null,
    };
  });

  const saved = rows.map((r) => r.existing).filter((r): r is DispatchRow => r !== null);

  const milkings = db
    .prepare(`SELECT * FROM registry_milkings WHERE occurred_on = ? AND session = ?`)
    .all(opts.occurred_on, opts.session) as RegistryMilkingRow[];
  const lactations = db
    .prepare(`SELECT * FROM registry_lactations ORDER BY animal_id, started_on`)
    .all() as LactationRow[];

  return {
    occurred_on: opts.occurred_on,
    session: opts.session,
    previous_session: prev,
    standing: rows.filter((r) => r.standing),
    occasional: rows.filter((r) => !r.standing),
    litres: round2(saved.reduce((s, r) => s + (r.litres ?? 0), 0)),
    amount_minor: saved.reduce((s, r) => s + dispatchAmountMinor(r), 0),
    produced: sessionProduction(milkings, lactations, opts.occurred_on, opts.session),
  };
}

/** One destination's dispatch history, oldest first. */
export function dispatchesFor(db: Db, destinationId: string): DispatchRow[] {
  return db
    .prepare(
      `SELECT * FROM registry_dispatches WHERE destination_id = ?
        ORDER BY occurred_on, CASE session WHEN 'morning' THEN 0 ELSE 1 END`,
    )
    .all(destinationId) as DispatchRow[];
}

// ---------------------------------------------------------------------------
// Reconciliation -- the number this feature exists to make honest
// (docs/REGISTRY_SALES.md §11)
// ---------------------------------------------------------------------------

export interface OffSchedule {
  dispatch_id: string;
  destination_id: string;
  name: string;
  occurred_on: string;
  session: MilkingSession;
  captured_minor: number;
  captured_unit_litres: number;
  agreed_minor: number;
  agreed_unit_litres: number;
}

export interface SessionCompleteness {
  occurred_on: string;
  session: MilkingSession;
  /** Standing destinations active that day -- who MUST have a row. */
  expected_standing: number;
  recorded_standing: number;
}

export interface Reconciliation {
  from: string;
  to: string;

  /** Sum of MEASURED yields only. A LOWER BOUND while not_measured > 0. */
  produced_measured: number;
  measured_rows: number;
  not_measured_rows: number;
  not_milked_rows: number;
  expected_milking_rows: number;
  missing_milking_rows: number;

  dispatched_sold: number;
  dispatched_home: number;
  dispatched_total: number;
  billed_minor: number;

  /** produced_measured - dispatched_total. Sign matters; see `interpretation`. */
  gap_litres: number;
  /**
   * NULL whenever production is incomplete, and `gap_pct_withheld_because` says
   * which. A caveat can be dropped by a consumer; a null cannot be quoted.
   */
  gap_pct: number | null;
  gap_pct_withheld_because: string | null;

  sessions: number;
  complete_sessions: number;
  incomplete: SessionCompleteness[];

  /** Dispatches billed at something other than the agreement in force. */
  off_schedule: OffSchedule[];

  interpretation: string;
}

/** How many recent incomplete sessions to name. A diagnostic, not an export. */
export const RECENT_INCOMPLETE = 14;

/**
 * Produced against dispatched, over a range. PURE.
 *
 * THIS IS A CONTROL, NOT ONLY A REPORT, and §4.1a is why. Occasional
 * destinations have no untouched state, so a household sale nobody wrote down
 * leaves no hole in registry_dispatches to find. The gap is the only place it
 * surfaces.
 *
 * TWO POPULATIONS ARE MIXED INTO THAT GAP and they pull in opposite directions
 * -- unmeasured production makes it look negative, unrecorded sales make it look
 * positive. They cannot be separated from the data, so this does not try:
 * report the gap, report the counts beside it, and let a person read both. A
 * single "efficiency" figure computed from them would be two unknowns dressed
 * as one answer.
 *
 * A NEGATIVE GAP IS THE NORMAL STATE EARLY ON. More milk going out than was
 * recorded as produced is what `milked_not_measured` MEANS -- the milk existed,
 * nobody weighed it. Nothing here styles it as an alert, and nothing downstream
 * may either: an alarm that fires every day for months is trained away, taking
 * the real signal with it.
 */
export function reconcile(
  milkings: readonly RegistryMilkingRow[],
  lactations: readonly LactationRow[],
  dispatches: readonly DispatchRow[],
  destinations: readonly DestinationRow[],
  prices: readonly DestinationPriceRow[],
  from: string,
  to: string,
): Reconciliation {
  const inRange = <T extends { occurred_on: string }>(rows: readonly T[]): T[] =>
    rows.filter((r) => r.occurred_on >= from && r.occurred_on <= to);

  const milk = inRange(milkings);
  const out = inRange(dispatches);

  const byId = new Map(destinations.map((d) => [d.id, d]));
  const pricesBy = new Map<string, DestinationPriceRow[]>();
  for (const p of prices) {
    const list = pricesBy.get(p.destination_id);
    if (list) list.push(p);
    else pricesBy.set(p.destination_id, [p]);
  }

  const lactBy = new Map<string, LactationRow[]>();
  for (const l of lactations) {
    const list = lactBy.get(l.animal_id);
    if (list) list.push(l);
    else lactBy.set(l.animal_id, [l]);
  }

  // --- production ---------------------------------------------------------
  const measured = milk.filter((m) => m.status === 'measured');
  const notMeasured = milk.filter((m) => m.status === 'milked_not_measured');
  const notMilked = milk.filter((m) => m.status === 'not_milked');

  // `expected` is recomputed per milking SESSION that has any row, for the same
  // reason milkingReport() does it: counting every session in the range would
  // measure how long the range is rather than how complete the record is.
  const milkSessions = new Set(milk.map((m) => `${m.occurred_on}\0${m.session}`));
  let expectedMilkingRows = 0;
  for (const key of milkSessions) {
    const [on] = key.split('\0');
    for (const list of lactBy.values()) {
      if (lactationCovering(list, on) !== null) expectedMilkingRows++;
    }
  }

  // --- dispatch -----------------------------------------------------------
  const taken = out.filter((d) => d.status === 'taken');
  const sold = taken.filter((d) => byId.get(d.destination_id)?.billable === true);
  const kept = taken.filter((d) => byId.get(d.destination_id)?.billable === false);

  const soldLitres = round2(sold.reduce((s, d) => s + (d.litres ?? 0), 0));
  const homeLitres = round2(kept.reduce((s, d) => s + (d.litres ?? 0), 0));
  const totalLitres = round2(soldLitres + homeLitres);
  const producedMeasured = round2(measured.reduce((s, m) => s + (m.yield_litres ?? 0), 0));

  // --- completeness of the dispatch sheet ---------------------------------
  const sessions = new Map<string, SessionCompleteness>();
  for (const d of out) {
    const key = `${d.occurred_on}\0${d.session}`;
    let row = sessions.get(key);
    if (!row) {
      row = {
        occurred_on: d.occurred_on,
        session: d.session,
        expected_standing: destinations.filter((x) => x.standing && activeOn(x, d.occurred_on))
          .length,
        recorded_standing: 0,
      };
      sessions.set(key, row);
    }
    if (byId.get(d.destination_id)?.standing === true) row.recorded_standing++;
  }
  const sessionRows = [...sessions.values()].sort((a, b) =>
    a.occurred_on === b.occurred_on
      ? a.session === b.session
        ? 0
        : a.session === 'evening'
          ? -1
          : 1
      : a.occurred_on < b.occurred_on
        ? 1
        : -1,
  );

  // --- prices that do not match the agreement -----------------------------
  const offSchedule: OffSchedule[] = [];
  for (const d of sold) {
    if (d.price_minor === null || d.price_unit_litres === null) continue;
    const agreed = priceInForce(pricesBy.get(d.destination_id) ?? [], d.occurred_on);
    if (agreed === null) continue; // invariant 21's problem, not a price mismatch
    if (
      agreed.price_minor !== d.price_minor ||
      agreed.price_unit_litres !== d.price_unit_litres
    ) {
      offSchedule.push({
        dispatch_id: d.id,
        destination_id: d.destination_id,
        name: byId.get(d.destination_id)?.name ?? d.destination_id,
        occurred_on: d.occurred_on,
        session: d.session,
        captured_minor: d.price_minor,
        captured_unit_litres: d.price_unit_litres,
        agreed_minor: agreed.price_minor,
        agreed_unit_litres: agreed.price_unit_litres,
      });
    }
  }

  // --- the gap ------------------------------------------------------------
  const missingMilkingRows = Math.max(0, expectedMilkingRows - milk.length);
  const gap = round2(producedMeasured - totalLitres);

  let withheld: string | null = null;
  if (notMeasured.length > 0 && missingMilkingRows > 0) {
    withheld =
      `${notMeasured.length} milking(s) were taken but not weighed and ${missingMilkingRows} ` +
      `animal-session(s) have no row at all, so production is a lower bound and a percentage ` +
      `of it would be false in a direction nobody would guess.`;
  } else if (notMeasured.length > 0) {
    withheld =
      `${notMeasured.length} milking(s) were taken but not weighed, so production is a lower ` +
      `bound and a percentage of it would understate the herd.`;
  } else if (missingMilkingRows > 0) {
    withheld =
      `${missingMilkingRows} animal-session(s) in milk have no row at all, so production is a ` +
      `lower bound.`;
  } else if (producedMeasured === 0) {
    withheld = 'nothing measured in this range, so there is no denominator.';
  }

  return {
    from,
    to,
    produced_measured: producedMeasured,
    measured_rows: measured.length,
    not_measured_rows: notMeasured.length,
    not_milked_rows: notMilked.length,
    expected_milking_rows: expectedMilkingRows,
    missing_milking_rows: missingMilkingRows,
    dispatched_sold: soldLitres,
    dispatched_home: homeLitres,
    dispatched_total: totalLitres,
    billed_minor: sold.reduce((s, d) => s + dispatchAmountMinor(d), 0),
    gap_litres: gap,
    gap_pct:
      withheld === null ? Math.round((gap / producedMeasured) * 1000) / 10 : null,
    gap_pct_withheld_because: withheld,
    sessions: sessionRows.length,
    complete_sessions: sessionRows.filter((s) => s.recorded_standing >= s.expected_standing)
      .length,
    incomplete: sessionRows
      .filter((s) => s.recorded_standing < s.expected_standing)
      .slice(0, RECENT_INCOMPLETE),
    off_schedule: offSchedule,
    interpretation:
      'The gap is produced minus dispatched, and it mixes two unknowns that pull in opposite ' +
      'directions: milk that was taken but never weighed makes it negative, and a sale nobody ' +
      'recorded makes it positive. A NEGATIVE GAP IS NORMAL while any milking is unweighed -- ' +
      'the milk existed, nobody measured it -- and it is not an alert. Occasional buyers have ' +
      'no row when they take nothing, so this gap is the only place an unrecorded household ' +
      'sale ever surfaces. Read it with the counts beside it, never on its own.',
  };
}

/** Reconciliation over the live tables. The shell around the pure function. */
export function reconcileRange(db: Db, from: string, to: string): Reconciliation {
  if (!DATE_RE.test(from)) refuse('invalid_payload', `from must be YYYY-MM-DD, got '${from}'`, 'from');
  if (!DATE_RE.test(to)) refuse('invalid_payload', `to must be YYYY-MM-DD, got '${to}'`, 'to');

  const milkings = db
    .prepare(`SELECT * FROM registry_milkings WHERE occurred_on BETWEEN ? AND ?`)
    .all(from, to) as RegistryMilkingRow[];
  const lactations = db
    .prepare(`SELECT * FROM registry_lactations ORDER BY animal_id, started_on`)
    .all() as LactationRow[];
  const dispatches = db
    .prepare(`SELECT * FROM registry_dispatches WHERE occurred_on BETWEEN ? AND ?`)
    .all(from, to) as DispatchRow[];
  const destinations = (
    db.prepare(`SELECT * FROM registry_destinations`).all() as (Omit<
      DestinationRow,
      'billable' | 'standing'
    > & { billable: number; standing: number })[]
  ).map((d) => ({ ...d, billable: d.billable === 1, standing: d.standing === 1 }));
  const prices = db
    .prepare(`SELECT * FROM registry_destination_prices`)
    .all() as DestinationPriceRow[];

  return reconcile(milkings, lactations, dispatches, destinations, prices, from, to);
}
