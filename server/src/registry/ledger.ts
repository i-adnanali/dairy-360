// Animal registry -- the buyer ledger (docs/REGISTRY_SALES.md §4.4, §12.3).
//
// What is owed, and the statement that says why.
//
// ---------------------------------------------------------------------------
// THERE IS NO `paid` COLUMN, AND THAT IS THE WHOLE POINT
// ---------------------------------------------------------------------------
// The demo `deliveries.paid` is a per-row boolean. A dodhi handing over
// Rs 40,000 against three weeks of collections is paying against no row in
// particular, and there is no combination of flag values that records it.
// Partial payment, overpayment, an advance and a running balance are not hard
// to express with a flag -- they are UNREPRESENTABLE.
//
//   balance = SUM(amount over taken billable dispatches) - SUM(payments)
//
// Derived on every read, never cached. A stored balance is a number that can
// disagree with the rows it came from, which is Decision 4's rule applied to
// money.
//
// ---------------------------------------------------------------------------
// THE MONTH IS A DISPLAY GROUPING AND NOTHING MORE
// ---------------------------------------------------------------------------
// No stored period, no closing flag, no row that says "September". The farm
// settles monthly with the dodhi and at the end of a run with an occasional
// household, so a stored period would have to be per-destination and per-run
// rather than a calendar month -- a `month` column would be wrong for two of
// the three buyers. §8 is where that would change, and it should change
// deliberately rather than by a schema growing a column that looked obvious.

import { randomUUID } from 'node:crypto';

import { RegistryError } from './errors';
import { getDestination } from './destinations';
import { dispatchAmountMinor } from './dispatch';
import { allDispatches, allPayments } from './store';
import type { Db } from './schema';
import type { DispatchRow, PaymentMethod, PaymentRow } from './types';
import { PAYMENT_METHODS } from './types';

export const PAYMENT_ID_PREFIX = 'pay_';

export function newPaymentId(): string {
  return `${PAYMENT_ID_PREFIX}${randomUUID()}`;
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

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RecordPaymentInput {
  destination_id: string;
  occurred_on: string;
  /** Paisa. Positive for cash and bank; an adjustment may be signed. */
  amount_minor: number;
  method: PaymentMethod;
  reference?: string | null;
  observed_by?: string | null;
  note?: string | null;
  recorded_by: string;
  id?: string;
  recorded_at?: string;
}

/**
 * Record money received, or an adjustment.
 *
 * `adjustment` is the only signed kind and it MUST carry a note. A written-off
 * balance, a rounding settlement, or a figure carried forward from the khata is
 * a decision somebody made rather than a transaction that happened, and a
 * signed number with no sentence attached is unauditable a month later.
 *
 * A non-billable destination cannot be paid: milk kept for the house is a
 * disposition, and money against it would put the farm's own milk in a balance.
 */
export function recordPayment(db: Db, input: RecordPaymentInput): PaymentRow {
  const destination = getDestination(db, input.destination_id);
  if (!destination) {
    refuse('unknown_destination', `unknown destination '${input.destination_id}'`, 'destination_id');
  }
  if (!destination.billable) {
    refuse(
      'not_billable',
      `${destination.name} is not billed, so there is nothing to pay. Milk kept for the house ` +
        `is a disposition, not a sale.`,
      'destination_id',
    );
  }

  if (!DATE_RE.test(input.occurred_on)) {
    refuse(
      'invalid_payload',
      `occurred_on must be YYYY-MM-DD, got '${input.occurred_on}'`,
      'occurred_on',
    );
  }
  if (!(PAYMENT_METHODS as readonly string[]).includes(input.method)) {
    refuse(
      'invalid_payload',
      `method must be one of ${PAYMENT_METHODS.join(' | ')}, got ${JSON.stringify(input.method)}`,
      'method',
    );
  }
  if (!Number.isInteger(input.amount_minor)) {
    refuse(
      'invalid_payload',
      `amount_minor must be a whole number of paisa, got ${JSON.stringify(input.amount_minor)}`,
      'amount_minor',
    );
  }

  const note = blank(input.note);
  if (input.method === 'adjustment') {
    if (input.amount_minor === 0) {
      refuse('invalid_payload', 'an adjustment of zero changes nothing', 'amount_minor');
    }
    if (note === null) {
      refuse(
        'invalid_payload',
        'an adjustment must say why. It is a decision somebody made rather than money that ' +
          'changed hands, and a signed number with no sentence attached cannot be audited later.',
        'note',
      );
    }
  } else if (input.amount_minor <= 0) {
    refuse(
      'invalid_payload',
      `a ${input.method} payment is money that changed hands, so it must be positive. To ` +
        `correct a balance downwards, record an adjustment and say why.`,
      'amount_minor',
    );
  }

  const row: PaymentRow = {
    id: input.id ?? newPaymentId(),
    destination_id: input.destination_id,
    occurred_on: input.occurred_on,
    amount_minor: input.amount_minor,
    method: input.method,
    reference: blank(input.reference),
    observed_by: blank(input.observed_by),
    recorded_by: input.recorded_by,
    recorded_at: input.recorded_at ?? new Date().toISOString(),
    note,
  };

  db.prepare(
    `INSERT INTO registry_payments
       (id, destination_id, occurred_on, amount_minor, method, reference, observed_by,
        recorded_by, recorded_at, note)
     VALUES
       (@id, @destination_id, @occurred_on, @amount_minor, @method, @reference, @observed_by,
        @recorded_by, @recorded_at, @note)`,
  ).run(row);

  return row;
}

/**
 * Remove one payment.
 *
 * Narrow on purpose -- one id, never a range -- and it exists because a payment
 * typed against the wrong buyer has no other repair: correcting it in place
 * would move money between two people's balances without either statement
 * saying so. Deleting and re-entering leaves both correct.
 */
export function deletePayment(db: Db, id: string): number {
  return db.prepare(`DELETE FROM registry_payments WHERE id = ?`).run(id).changes;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function paymentsFor(db: Db, destinationId: string): PaymentRow[] {
  return db
    .prepare(`SELECT * FROM registry_payments WHERE destination_id = ? ORDER BY occurred_on, id`)
    .all(destinationId) as PaymentRow[];
}

/**
 * What one destination owes, in paisa. PURE.
 *
 * Positive means they owe the farm; negative means they are in credit, which is
 * an ordinary state for a buyer who paid ahead and needs no special case.
 */
export function balanceMinor(
  dispatches: readonly DispatchRow[],
  payments: readonly PaymentRow[],
): number {
  const billed = dispatches.reduce((s, d) => s + dispatchAmountMinor(d), 0);
  const paid = payments.reduce((s, p) => s + p.amount_minor, 0);
  return billed - paid;
}

export interface StatementMonth {
  /** `YYYY-MM`. A GROUPING, not a stored period -- see the module comment. */
  month: string;
  litres: number;
  billed_minor: number;
  paid_minor: number;
  /** Running balance at the END of this month, across all months so far. */
  closing_minor: number;
  dispatches: DispatchRow[];
  payments: PaymentRow[];
}

export interface Statement {
  destination_id: string;
  name: string;
  billable: boolean;
  /** Oldest first, so the closing balance reads down the page. */
  months: StatementMonth[];
  litres: number;
  billed_minor: number;
  paid_minor: number;
  balance_minor: number;
}

/**
 * The statement -- the screen you hand to a dodhi.
 *
 * Grouped by calendar month with a subtotal, because a month between payments
 * is around sixty rows and nobody hands over sixty rows. The monthly line is
 * the artifact; the daily detail underneath it is the evidence.
 *
 * The rate is NOT converted to per-litre anywhere in here: each dispatch row
 * carries the price and lot size it was billed at, and the screen prints them
 * as agreed. The line has to be arithmetic the buyer can check against his own
 * khata.
 */
export function statement(db: Db, destinationId: string): Statement | null {
  const destination = getDestination(db, destinationId);
  if (!destination) return null;

  const dispatches = db
    .prepare(
      `SELECT * FROM registry_dispatches WHERE destination_id = ?
        ORDER BY occurred_on, CASE session WHEN 'morning' THEN 0 ELSE 1 END`,
    )
    .all(destinationId) as DispatchRow[];
  const payments = paymentsFor(db, destinationId);

  const months = new Map<string, StatementMonth>();
  const month = (key: string): StatementMonth => {
    let m = months.get(key);
    if (!m) {
      m = {
        month: key,
        litres: 0,
        billed_minor: 0,
        paid_minor: 0,
        closing_minor: 0,
        dispatches: [],
        payments: [],
      };
      months.set(key, m);
    }
    return m;
  };

  for (const d of dispatches) {
    const m = month(d.occurred_on.slice(0, 7));
    m.litres += d.litres ?? 0;
    m.billed_minor += dispatchAmountMinor(d);
    m.dispatches.push(d);
  }
  for (const p of payments) {
    const m = month(p.occurred_on.slice(0, 7));
    m.paid_minor += p.amount_minor;
    m.payments.push(p);
  }

  const ordered = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  let running = 0;
  for (const m of ordered) {
    m.litres = round2(m.litres);
    running += m.billed_minor - m.paid_minor;
    m.closing_minor = running;
  }

  return {
    destination_id: destination.id,
    name: destination.name,
    billable: destination.billable,
    months: ordered,
    litres: round2(dispatches.reduce((s, d) => s + (d.litres ?? 0), 0)),
    billed_minor: dispatches.reduce((s, d) => s + dispatchAmountMinor(d), 0),
    paid_minor: payments.reduce((s, p) => s + p.amount_minor, 0),
    balance_minor: balanceMinor(dispatches, payments),
  };
}

export interface BalanceRow {
  destination_id: string;
  name: string;
  billable: boolean;
  balance_minor: number;
  last_dispatch_on: string | null;
  last_payment_on: string | null;
}

/**
 * Every billable destination's balance, for the list screen.
 *
 * Non-billable destinations are EXCLUDED rather than shown as zero. A zero next
 * to home would read as "settled", which implies there was something to settle.
 */
export function balances(db: Db): BalanceRow[] {
  const dispatches = allDispatches(db);
  const payments = allPayments(db);

  const byDispatch = new Map<string, DispatchRow[]>();
  for (const d of dispatches) {
    const list = byDispatch.get(d.destination_id);
    if (list) list.push(d);
    else byDispatch.set(d.destination_id, [d]);
  }
  const byPayment = new Map<string, PaymentRow[]>();
  for (const p of payments) {
    const list = byPayment.get(p.destination_id);
    if (list) list.push(p);
    else byPayment.set(p.destination_id, [p]);
  }

  const rows: BalanceRow[] = [];
  for (const d of db
    .prepare(`SELECT * FROM registry_destinations WHERE billable = 1 ORDER BY name, id`)
    .all() as { id: string; name: string }[]) {
    const mine = byDispatch.get(d.id) ?? [];
    const paid = byPayment.get(d.id) ?? [];
    rows.push({
      destination_id: d.id,
      name: d.name,
      billable: true,
      balance_minor: balanceMinor(mine, paid),
      last_dispatch_on: mine.length > 0 ? mine[mine.length - 1].occurred_on : null,
      last_payment_on: paid.length > 0 ? paid[paid.length - 1].occurred_on : null,
    });
  }
  return rows;
}
