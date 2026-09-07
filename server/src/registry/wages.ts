// Animal registry -- the wage ledger (docs/REGISTRY_PAYROLL.md §4.7, §12.2).
//
// What is owed to somebody, and the statement that says why.
//
// ---------------------------------------------------------------------------
// THE SAME LEDGER AS THE BUYERS', WITH THE SIGN THE OTHER WAY UP
// ---------------------------------------------------------------------------
//   balance = SUM(wage periods, across ALL of their engagements)
//           - SUM(wage payments)
//
// Positive means the FARM owes THEM. Derived on every read, never cached: a
// stored balance is a number that can disagree with the rows it came from,
// which is Decision 4's rule applied to money.
//
// There is no `paid` column here for exactly the reason there is none on
// registry_payments -- somebody handed Rs 20,000 against six weeks of work is
// paying against no row in particular.
//
// ---------------------------------------------------------------------------
// THE ASYMMETRY: EARNING IS PER-ENGAGEMENT, PAYING IS PER-PERSON
// ---------------------------------------------------------------------------
// A wage period names an engagement, because the terms do. A payment names the
// PERSON, because one cash handover settles whatever is outstanding and an
// advance paid between two stints belongs to the person rather than to either
// job. It is also how the farm thinks: "what do I owe Rashid", never "what do I
// owe Rashid's second engagement".
//
// ---------------------------------------------------------------------------
// AN ADVANCE IS NOT A FEATURE
// ---------------------------------------------------------------------------
// No advance table, no flag, no recovery schedule. Money handed over before it
// was earned is an ordinary payment dated when it happened, and the balance
// goes negative -- which ledger.ts already calls "an ordinary state ... that
// needs no special case". The next wage period walks it back towards zero on
// its own, so recovery is not an operation at all. A schedule would be a second
// representation of arithmetic already being done, and the two could disagree.
//
// ---------------------------------------------------------------------------
// THE MONTH IS A DISPLAY GROUPING AND NOTHING MORE
// ---------------------------------------------------------------------------
// No stored period, no closing flag. Same as the buyer statement, and here the
// argument is stronger: a dihari settles the day they worked and a salaried
// employee settles monthly, so a stored period would be wrong for one of them.

import { randomUUID } from 'node:crypto';

import { RegistryError } from './errors';
import { getPerson } from './people';
import { allPeople, allWagePayments, allWagePeriods } from './store';
import type { Db } from './schema';
import type {
  EngagementRow,
  PaymentMethod,
  PersonRow,
  WagePaymentRow,
  WagePeriodRow,
} from './types';
import { PAYMENT_METHODS } from './types';

export const WAGE_PAYMENT_ID_PREFIX = 'wpy_';

export function newWagePaymentId(): string {
  return `${WAGE_PAYMENT_ID_PREFIX}${randomUUID()}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refuse(
  code: ConstructorParameters<typeof RegistryError>[0],
  msg: string,
  field?: string,
): never {
  throw new RegistryError(code, msg, field);
}

function blank(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RecordWagePaymentInput {
  person_id: string;
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
 * Record money paid to somebody, or an adjustment.
 *
 * `adjustment` is the only signed kind and it MUST carry a note. It is the one
 * mechanism for three separate things, and giving each a column would be three
 * dead columns within a month:
 *
 *   - an opening balance carried forward from the khata,
 *   - a DEDUCTION -- damage, a fine, milk taken above the allowance,
 *   - a written-off remainder at a final settlement.
 *
 * All three are decisions somebody made rather than money that changed hands,
 * and a signed number with no sentence attached is unauditable a month later.
 *
 * NOTE WHAT IS NOT REFUSED: a payment to somebody with no engagement covering
 * the date. A final settlement two weeks after leaving is real, and an advance
 * before a stint starts is how dihari sometimes work. /check reports it.
 */
export function recordWagePayment(db: Db, input: RecordWagePaymentInput): WagePaymentRow {
  const person = getPerson(db, input.person_id);
  if (!person) refuse('unknown_person', `unknown person '${input.person_id}'`, 'person_id');

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
        `reduce what is owed -- a deduction, or milk taken above the allowance -- record an ` +
        `adjustment and say why.`,
      'amount_minor',
    );
  }

  const row: WagePaymentRow = {
    id: input.id ?? newWagePaymentId(),
    person_id: input.person_id,
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
    `INSERT INTO registry_wage_payments
       (id, person_id, occurred_on, amount_minor, method, reference, observed_by,
        recorded_by, recorded_at, note)
     VALUES
       (@id, @person_id, @occurred_on, @amount_minor, @method, @reference, @observed_by,
        @recorded_by, @recorded_at, @note)`,
  ).run(row);

  return row;
}

/**
 * Remove one wage payment.
 *
 * Narrow on purpose -- one id, never a range -- and it exists because a payment
 * typed against the wrong person has no other repair: correcting it in place
 * would move money between two people's balances without either statement
 * saying so.
 */
export function deleteWagePayment(db: Db, id: string): number {
  return db.prepare(`DELETE FROM registry_wage_payments WHERE id = ?`).run(id).changes;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function wagePaymentsFor(db: Db, personId: string): WagePaymentRow[] {
  return db
    .prepare(`SELECT * FROM registry_wage_payments WHERE person_id = ? ORDER BY occurred_on, id`)
    .all(personId) as WagePaymentRow[];
}

/** Every wage period across all of one person's engagements, oldest first. */
export function wagePeriodsForPerson(db: Db, personId: string): WagePeriodRow[] {
  return db
    .prepare(
      `SELECT w.* FROM registry_wage_periods w
         JOIN registry_engagements e ON e.id = w.engagement_id
        WHERE e.person_id = ?
        ORDER BY w.from_on, w.id`,
    )
    .all(personId) as WagePeriodRow[];
}

/**
 * What the farm owes one person, in paisa. PURE.
 *
 * Positive means the farm owes them; negative means they are IN ADVANCE, which
 * is an ordinary state for somebody paid ahead and needs no special case.
 */
export function wageBalanceMinor(
  periods: readonly WagePeriodRow[],
  payments: readonly WagePaymentRow[],
): number {
  const earned = periods.reduce((s, w) => s + w.amount_minor, 0);
  const paid = payments.reduce((s, p) => s + p.amount_minor, 0);
  return earned - paid;
}

export interface WageStatementMonth {
  /** `YYYY-MM`. A GROUPING, not a stored period -- see the module comment. */
  month: string;
  earned_minor: number;
  paid_minor: number;
  /** Running balance at the END of this month, across all months so far. */
  closing_minor: number;
  periods: WagePeriodRow[];
  payments: WagePaymentRow[];
}

export interface WageStatement {
  person_id: string;
  identifier: string;
  name: string | null;
  engagements: EngagementRow[];
  /** Oldest first, so the closing balance reads down the page. */
  months: WageStatementMonth[];
  earned_minor: number;
  paid_minor: number;
  balance_minor: number;
}

/**
 * The statement -- the screen you show somebody when they ask what they are
 * owed.
 *
 * Grouped by calendar month with a subtotal, like the buyer statement, because
 * that is the cadence a salaried employee settles on. A dihari's month holds one
 * row per day worked, which is the right amount of detail for the same reason:
 * the monthly line is the artifact, the rows underneath are the evidence.
 *
 * A wage period is filed under the month it STARTS in. One spanning a month
 * boundary -- a stint from the 20th to the 5th -- lands whole in the first
 * rather than being split by a proration this design refuses to invent (§4.6).
 */
export function wageStatement(db: Db, personId: string): WageStatement | null {
  const person = getPerson(db, personId);
  if (!person) return null;

  const periods = wagePeriodsForPerson(db, personId);
  const payments = wagePaymentsFor(db, personId);
  const engagements = db
    .prepare(`SELECT * FROM registry_engagements WHERE person_id = ? ORDER BY started_on, id`)
    .all(personId) as EngagementRow[];

  const months = new Map<string, WageStatementMonth>();
  const month = (key: string): WageStatementMonth => {
    let m = months.get(key);
    if (!m) {
      m = {
        month: key,
        earned_minor: 0,
        paid_minor: 0,
        closing_minor: 0,
        periods: [],
        payments: [],
      };
      months.set(key, m);
    }
    return m;
  };

  for (const w of periods) {
    const m = month(w.from_on.slice(0, 7));
    m.earned_minor += w.amount_minor;
    m.periods.push(w);
  }
  for (const p of payments) {
    const m = month(p.occurred_on.slice(0, 7));
    m.paid_minor += p.amount_minor;
    m.payments.push(p);
  }

  const ordered = [...months.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
  let running = 0;
  for (const m of ordered) {
    running += m.earned_minor - m.paid_minor;
    m.closing_minor = running;
  }

  return {
    person_id: person.id,
    identifier: person.identifier,
    name: person.name,
    engagements,
    months: ordered,
    earned_minor: periods.reduce((s, w) => s + w.amount_minor, 0),
    paid_minor: payments.reduce((s, p) => s + p.amount_minor, 0),
    balance_minor: wageBalanceMinor(periods, payments),
  };
}

export interface WageBalanceRow {
  person_id: string;
  identifier: string;
  name: string | null;
  /** True when any engagement is open on `asOf` -- for dimming past staff. */
  engaged: boolean;
  balance_minor: number;
  last_period_on: string | null;
  last_payment_on: string | null;
}

/**
 * Every person's balance, for the list screen.
 *
 * PEOPLE WITH NO ENGAGEMENT ARE INCLUDED, unlike the buyer list which excludes
 * non-billable destinations. The reasoning diverges because the situations do:
 * a zero beside `home` would read as "settled", implying there was something to
 * settle, whereas somebody who has left may still be owed a final payment, and
 * hiding them is how it gets forgotten. The screen dims them instead.
 */
export function wageBalances(db: Db, asOf: string): WageBalanceRow[] {
  const periods = allWagePeriods(db);
  const payments = allWagePayments(db);
  const engagements = db.prepare(`SELECT * FROM registry_engagements`).all() as EngagementRow[];

  const engagementPerson = new Map(engagements.map((e) => [e.id, e.person_id]));

  const byPeriod = new Map<string, WagePeriodRow[]>();
  for (const w of periods) {
    const personId = engagementPerson.get(w.engagement_id);
    if (personId === undefined) continue;
    const list = byPeriod.get(personId);
    if (list) list.push(w);
    else byPeriod.set(personId, [w]);
  }
  const byPayment = new Map<string, WagePaymentRow[]>();
  for (const p of payments) {
    const list = byPayment.get(p.person_id);
    if (list) list.push(p);
    else byPayment.set(p.person_id, [p]);
  }
  const openFor = new Set(
    engagements
      .filter((e) => e.started_on <= asOf && (e.ended_on === null || asOf <= e.ended_on))
      .map((e) => e.person_id),
  );

  return allPeople(db).map((p: PersonRow) => {
    const mine = byPeriod.get(p.id) ?? [];
    const paid = byPayment.get(p.id) ?? [];
    return {
      person_id: p.id,
      identifier: p.identifier,
      name: p.name,
      engaged: openFor.has(p.id),
      balance_minor: wageBalanceMinor(mine, paid),
      last_period_on: mine.length > 0 ? mine[mine.length - 1].from_on : null,
      last_payment_on: paid.length > 0 ? paid[paid.length - 1].occurred_on : null,
    };
  });
}
