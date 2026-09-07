// Animal registry -- packages and the payroll run (docs/REGISTRY_PAYROLL.md §4.4-§4.6, §12.1).
//
// What somebody is on, and what they were actually paid for a stretch of time.
//
// ---------------------------------------------------------------------------
// TWO LAYERS, BECAUSE THEY ANSWER DIFFERENT QUESTIONS
// ---------------------------------------------------------------------------
// A PAY TERM is the AGREEMENT: effective-dated, a raise is a new row, and the
// term in force on a date is the latest row at or before it. Exactly the shape
// of registry_destination_prices, and for exactly the same reason -- money must
// not move when an agreement is corrected.
//
// A WAGE PERIOD is what was actually settled. The term supplies the DEFAULT at
// entry and nothing more.
//
// ---------------------------------------------------------------------------
// AND UNLIKE A DISPATCH, IT CAPTURES NO RATE
// ---------------------------------------------------------------------------
// A dispatch stores `price_minor` and `price_unit_litres` because its amount is
// DERIVED from them (litres x rate), so the figures have to travel with the row
// or money would be recomputed from a lookup that can move. A wage period's
// amount is not derived from anything -- it IS the stored figure -- so there is
// nothing to capture. Whoever reads dispatch.ts first will come looking for the
// captured rate; this is where they find out where it went.
//
// The consequence is deliberate: an amount that differs from the term in force
// is LEGITIMATE. A month with four days' leave, a rounded cash figure, a
// dihari paid extra on Eid -- all of them are the agreed figure, and none of
// them is a violation. /check reports the difference and never refuses it.
//
// ---------------------------------------------------------------------------
// THE ONE HARD RULE IN A LOOSE MODEL
// ---------------------------------------------------------------------------
// Engagements may overlap; wage periods on one engagement may NOT. Overlap
// there is double payment, which is an error rather than a shape of
// employment, and the schema cannot see it -- a CHECK cannot read another row.
// So it is refused here AND reported by invariant 24.

import { randomUUID } from 'node:crypto';

import { RegistryError } from './errors';
import { engagedDuring, getEngagement, getPerson } from './people';
import type { Db } from './schema';
import type {
  BenefitKind,
  BenefitPeriod,
  CashPeriod,
  EngagementRow,
  PayBenefitRow,
  PayTermRow,
  PersonRow,
  Provenance,
  WagePeriodKind,
  WagePeriodRow,
} from './types';
import {
  BENEFIT_KINDS,
  BENEFIT_PERIODS,
  CASH_PERIODS,
  SOURCE_FORMS,
  WAGE_PERIOD_KINDS,
} from './types';

export const PAY_TERM_ID_PREFIX = 'trm_';
export const PAY_BENEFIT_ID_PREFIX = 'ben_';
export const WAGE_PERIOD_ID_PREFIX = 'wag_';

export function newPayTermId(): string {
  return `${PAY_TERM_ID_PREFIX}${randomUUID()}`;
}

export function newPayBenefitId(): string {
  return `${PAY_BENEFIT_ID_PREFIX}${randomUUID()}`;
}

export function newWagePeriodId(): string {
  return `${WAGE_PERIOD_ID_PREFIX}${randomUUID()}`;
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

function assertDate(value: string, field: string): string {
  if (!DATE_RE.test(value)) {
    refuse('invalid_payload', `${field} must be YYYY-MM-DD, got '${value}'`, field);
  }
  return value;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// PURE -- the term in force, and overlap
// ---------------------------------------------------------------------------

/**
 * The package agreement in force on `on` -- the latest row at or before it.
 *
 * Returns null when there is none, which is a real and expected state: an
 * engagement opened today has no term until one is set. That is a refusal at
 * the write boundary rather than a silently assumed zero, because an unpaid
 * month is a decision somebody has to have made.
 *
 * PURE, and takes the whole list rather than querying, so the same function
 * serves the write boundary, the run read model and invariant 23. The exact
 * shape of priceInForce(), deliberately -- see people.ts on why the near-
 * duplicate is accepted rather than abstracted.
 */
export function termInForce(terms: readonly PayTermRow[], on: string): PayTermRow | null {
  let best: PayTermRow | null = null;
  for (const t of terms) {
    if (t.effective_from > on) continue;
    if (best === null || t.effective_from > best.effective_from) best = t;
  }
  return best;
}

/** Do two inclusive date ranges share a day? PURE; invariant 24 uses it too. */
export function rangesOverlap(
  a: { from_on: string; to_on: string },
  b: { from_on: string; to_on: string },
): boolean {
  return a.from_on <= b.to_on && b.from_on <= a.to_on;
}

// ---------------------------------------------------------------------------
// DB shell -- reads
// ---------------------------------------------------------------------------

export function termsFor(db: Db, engagementId: string): PayTermRow[] {
  return db
    .prepare(`SELECT * FROM registry_pay_terms WHERE engagement_id = ? ORDER BY effective_from`)
    .all(engagementId) as PayTermRow[];
}

export function benefitsFor(db: Db, termId: string): PayBenefitRow[] {
  return db
    .prepare(`SELECT * FROM registry_pay_benefits WHERE term_id = ? ORDER BY kind, id`)
    .all(termId) as PayBenefitRow[];
}

export function wagePeriodsFor(db: Db, engagementId: string): WagePeriodRow[] {
  return db
    .prepare(`SELECT * FROM registry_wage_periods WHERE engagement_id = ? ORDER BY from_on, id`)
    .all(engagementId) as WagePeriodRow[];
}

/** The whole package on a date: the agreement plus its in-kind lines. */
export interface PackageOnDate {
  term: PayTermRow | null;
  benefits: PayBenefitRow[];
}

export function packageOn(db: Db, engagementId: string, on: string): PackageOnDate {
  const term = termInForce(termsFor(db, engagementId), on);
  return { term, benefits: term ? benefitsFor(db, term.id) : [] };
}

// ---------------------------------------------------------------------------
// DB shell -- the agreement
// ---------------------------------------------------------------------------

export interface BenefitInput {
  kind: BenefitKind;
  quantity?: number | null;
  unit?: string | null;
  period?: BenefitPeriod | null;
  note?: string | null;
}

export interface SetTermInput {
  engagement_id: string;
  effective_from: string;
  cash_minor: number;
  cash_period: CashPeriod;
  /** The whole in-kind package, replacing nothing -- this is a NEW agreement. */
  benefits?: BenefitInput[];
  note?: string | null;
  recorded_by: string;
  id?: string;
  recorded_at?: string;
}

export interface SetTermResult {
  term: PayTermRow;
  benefits: PayBenefitRow[];
}

/**
 * Record a package agreement, effective from a date.
 *
 * A NEW ROW, never an UPDATE to the old one -- what somebody was on in March
 * must not move when they get a raise in September.
 *
 * THE BENEFITS COME WITH IT, in the same transaction, because the PACKAGE is
 * the unit that changes. A raise usually moves the milk allowance too, and
 * effective-dating the parts separately is how the two drift out of step.
 * A term with no benefits is an all-cash package and is perfectly ordinary.
 */
export function setTerm(db: Db, input: SetTermInput): SetTermResult {
  const engagement = getEngagement(db, input.engagement_id);
  if (!engagement) {
    refuse('unknown_engagement', `unknown engagement '${input.engagement_id}'`, 'engagement_id');
  }

  assertDate(input.effective_from, 'effective_from');

  if (!Number.isInteger(input.cash_minor) || input.cash_minor < 0) {
    refuse(
      'invalid_payload',
      `cash_minor must be a whole number of paisa and not negative, got ` +
        `${JSON.stringify(input.cash_minor)}`,
      'cash_minor',
    );
  }
  if (!(CASH_PERIODS as readonly string[]).includes(input.cash_period)) {
    refuse(
      'invalid_payload',
      `cash_period must be one of ${CASH_PERIODS.join(' | ')}, got ` +
        `${JSON.stringify(input.cash_period)}`,
      'cash_period',
    );
  }

  const benefits = input.benefits ?? [];
  const seenKinds = new Set<string>();
  for (const b of benefits) {
    if (!(BENEFIT_KINDS as readonly string[]).includes(b.kind)) {
      refuse(
        'invalid_payload',
        `benefit kind must be one of ${BENEFIT_KINDS.join(' | ')}, got ${JSON.stringify(b.kind)}`,
        'benefits',
      );
    }
    // One line per kind, except `other` which is distinguished by its note.
    if (b.kind !== 'other') {
      if (seenKinds.has(b.kind)) {
        refuse(
          'invalid_payload',
          `the package lists ${b.kind} twice. Two allowances of the same thing is a typo, ` +
            `and which one applied would be silent.`,
          'benefits',
        );
      }
      seenKinds.add(b.kind);
    }

    const quantity = b.quantity ?? null;
    const unit = blank(b.unit);
    const period = b.period ?? null;
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      refuse('invalid_payload', `a ${b.kind} allowance must be a positive number`, 'benefits');
    }
    if ((quantity === null) !== (unit === null)) {
      refuse(
        'invalid_payload',
        `a ${b.kind} allowance needs both a quantity and its unit -- "20" is not an amount ` +
          `until it says kg.`,
        'benefits',
      );
    }
    if (quantity !== null && period === null) {
      refuse(
        'invalid_payload',
        `a ${b.kind} allowance needs to say whether it is per day or per month`,
        'benefits',
      );
    }
    if (period !== null && !(BENEFIT_PERIODS as readonly string[]).includes(period)) {
      refuse(
        'invalid_payload',
        `benefit period must be one of ${BENEFIT_PERIODS.join(' | ')}`,
        'benefits',
      );
    }
    if (b.kind === 'other' && blank(b.note) === null) {
      refuse(
        'invalid_payload',
        'an "other" line has to say what it is. An unlabelled benefit is prose about ' +
          'something nobody can price later.',
        'benefits',
      );
    }
  }

  const recordedAt = input.recorded_at ?? new Date().toISOString();
  const termId = input.id ?? newPayTermId();

  return db.transaction((): SetTermResult => {
    const clash = db
      .prepare(
        `SELECT id FROM registry_pay_terms WHERE engagement_id = ? AND effective_from = ?`,
      )
      .get(input.engagement_id, input.effective_from) as { id: string } | undefined;
    if (clash) {
      refuse(
        'invalid_payload',
        `there is already a package for this engagement effective ${input.effective_from}. ` +
          `A second one on the same date is not a raise, it is a typo -- and which one ` +
          `applied would be silent.`,
        'effective_from',
      );
    }

    const term: PayTermRow = {
      id: termId,
      engagement_id: input.engagement_id,
      effective_from: input.effective_from,
      cash_minor: input.cash_minor,
      cash_period: input.cash_period,
      recorded_by: input.recorded_by,
      recorded_at: recordedAt,
      note: blank(input.note),
    };
    db.prepare(
      `INSERT INTO registry_pay_terms
         (id, engagement_id, effective_from, cash_minor, cash_period, recorded_by,
          recorded_at, note)
       VALUES
         (@id, @engagement_id, @effective_from, @cash_minor, @cash_period, @recorded_by,
          @recorded_at, @note)`,
    ).run(term);

    const ins = db.prepare(
      `INSERT INTO registry_pay_benefits (id, term_id, kind, quantity, unit, period, note)
       VALUES (@id, @term_id, @kind, @quantity, @unit, @period, @note)`,
    );
    const written: PayBenefitRow[] = [];
    for (const b of benefits) {
      const row: PayBenefitRow = {
        id: newPayBenefitId(),
        term_id: termId,
        kind: b.kind,
        quantity: b.quantity ?? null,
        unit: blank(b.unit),
        period: b.period ?? null,
        note: blank(b.note),
      };
      ins.run(row);
      written.push(row);
    }

    return { term, benefits: written };
  })();
}

/**
 * Correct a package agreement in place.
 *
 * SAFE FOR THE SAME REASON CORRECTING A PRICE IS SAFE: every wage period holds
 * its own figure, so this changes only the default offered to future entry and
 * rewrites nothing. It is for a rate typed wrong and caught immediately -- a
 * genuine change of agreement is a NEW term with a later effective date, which
 * is what keeps "what were they on in March" answerable.
 *
 * The benefits are REPLACED wholesale rather than patched, because the package
 * is the unit: a correction that left a stale milk line behind would produce an
 * agreement nobody ever made.
 */
export function correctTerm(
  db: Db,
  termId: string,
  input: Omit<SetTermInput, 'engagement_id' | 'id' | 'recorded_at'>,
): SetTermResult {
  const current = db.prepare(`SELECT * FROM registry_pay_terms WHERE id = ?`).get(termId) as
    | PayTermRow
    | undefined;
  if (!current) refuse('invalid_payload', `unknown package '${termId}'`, 'id');

  return db.transaction((): SetTermResult => {
    db.prepare(`DELETE FROM registry_pay_benefits WHERE term_id = ?`).run(termId);
    db.prepare(`DELETE FROM registry_pay_terms WHERE id = ?`).run(termId);
    return setTerm(db, {
      ...input,
      engagement_id: current.engagement_id,
      id: termId,
      recorded_at: current.recorded_at,
    });
  })();
}

// ---------------------------------------------------------------------------
// The write -- one run, one transaction
// ---------------------------------------------------------------------------

export interface WagePeriodEntryInput {
  engagement_id: string;
  kind?: WagePeriodKind;
  /** Defaulted to the run's range; a dihari day overrides both. */
  from_on?: string;
  to_on?: string;
  amount_minor: number;
  observed_by?: string | null;
  note?: string | null;
}

export interface SaveRunInput {
  from_on: string;
  to_on: string;
  entries: WagePeriodEntryInput[];
  provenance: Provenance;
}

export interface SaveRunResult {
  from_on: string;
  to_on: string;
  written: number;
  updated: number;
  total_minor: number;
  rows: WagePeriodRow[];
}

/**
 * Save a whole payroll run. ALL ROWS OR NONE.
 *
 * An UPSERT on (engagement_id, from_on), because correcting a figure is the
 * ordinary repair path and that is what it conflicts on.
 *
 * ---------------------------------------------------------------------------
 * EVERY PERMANENT ENGAGEMENT MUST BE ACCOUNTED FOR, ENFORCED HERE
 * ---------------------------------------------------------------------------
 * Not only in the UI -- the route is reachable directly, and a run that
 * silently accepts a missing salaried employee is a run whose completeness
 * means nothing. Daily engagements are the exact opposite: absent is their
 * normal state, because most months most dihari were never hired.
 */
export function saveRun(db: Db, input: SaveRunInput): SaveRunResult {
  assertDate(input.from_on, 'from_on');
  assertDate(input.to_on, 'to_on');
  if (input.to_on < input.from_on) {
    refuse('invalid_payload', `to_on ${input.to_on} is before from_on ${input.from_on}`, 'to_on');
  }
  if (!Array.isArray(input.entries)) {
    refuse('invalid_payload', 'entries must be an array', 'entries');
  }
  if (!(SOURCE_FORMS as readonly string[]).includes(input.provenance.source_form)) {
    refuse('invalid_payload', 'unknown source_form', 'source_form');
  }

  const recordedAt = new Date().toISOString();

  return db.transaction((): SaveRunResult => {
    const answered = new Set<string>();
    const rows: WagePeriodRow[] = [];
    let updated = 0;

    for (const raw of input.entries) {
      const engagement = getEngagement(db, raw.engagement_id);
      if (!engagement) {
        refuse(
          'unknown_engagement',
          `unknown engagement '${raw.engagement_id}'`,
          'entries',
        );
      }

      const kind: WagePeriodKind = raw.kind ?? 'wage';
      if (!(WAGE_PERIOD_KINDS as readonly string[]).includes(kind)) {
        refuse('invalid_payload', `kind must be one of ${WAGE_PERIOD_KINDS.join(' | ')}`, 'entries');
      }

      // A dihari day carries its own dates; a salaried row inherits the run's.
      const fromOn = assertDate(raw.from_on ?? input.from_on, 'from_on');
      const toOn = assertDate(raw.to_on ?? (raw.from_on ? raw.from_on : input.to_on), 'to_on');
      if (toOn < fromOn) {
        refuse('invalid_payload', `to_on ${toOn} is before from_on ${fromOn}`, 'entries');
      }
      if (kind === 'bonus' && toOn !== fromOn) {
        refuse(
          'invalid_payload',
          'a bonus is a moment, not a period -- give it one date',
          'entries',
        );
      }

      if (!Number.isInteger(raw.amount_minor) || raw.amount_minor < 0) {
        refuse(
          'invalid_payload',
          `the amount must be a whole number of paisa and not negative, got ` +
            `${JSON.stringify(raw.amount_minor)}`,
          'entries',
        );
      }

      // A wage needs an agreement behind it. A BONUS DOES NOT, deliberately --
      // it is a decision rather than a rate, and demanding a term for one would
      // refuse the commonest reason a bonus exists.
      if (kind === 'wage') {
        const term = termInForce(termsFor(db, raw.engagement_id), fromOn);
        if (!term) {
          const person = getPerson(db, engagement.person_id);
          refuse(
            'no_term_in_force',
            `${person?.identifier ?? engagement.person_id} has no package agreement covering ` +
              `${fromOn}. Record what they are on before paying them for it -- a figure with ` +
              `no agreement behind it is one nobody can point at later.`,
            'entries',
          );
        }
      }

      // THE ONE HARD RULE. Engagements may overlap; wage periods on one
      // engagement may not, because that is double payment.
      const clash = (
        db
          .prepare(
            `SELECT * FROM registry_wage_periods WHERE engagement_id = ? AND from_on <> ?`,
          )
          .all(raw.engagement_id, fromOn) as WagePeriodRow[]
      ).find((w) => rangesOverlap({ from_on: fromOn, to_on: toOn }, w));
      if (clash) {
        refuse(
          'overlapping_wage_period',
          `${fromOn} to ${toOn} overlaps a period already recorded for this engagement ` +
            `(${clash.from_on} to ${clash.to_on}). Two overlapping periods is paying twice ` +
            `for the same days.`,
          'entries',
        );
      }

      const existing = db
        .prepare(`SELECT id FROM registry_wage_periods WHERE engagement_id = ? AND from_on = ?`)
        .get(raw.engagement_id, fromOn) as { id: string } | undefined;
      if (existing) updated++;

      const row: WagePeriodRow = {
        id: existing?.id ?? newWagePeriodId(),
        engagement_id: raw.engagement_id,
        kind,
        from_on: fromOn,
        to_on: toOn,
        amount_minor: raw.amount_minor,
        observed_by: blank(raw.observed_by),
        recorded_by: input.provenance.recorded_by,
        recorded_at: recordedAt,
        source_form: input.provenance.source_form,
        note: blank(raw.note),
      };

      db.prepare(
        `INSERT INTO registry_wage_periods
           (id, engagement_id, kind, from_on, to_on, amount_minor, observed_by,
            recorded_by, recorded_at, source_form, note)
         VALUES
           (@id, @engagement_id, @kind, @from_on, @to_on, @amount_minor, @observed_by,
            @recorded_by, @recorded_at, @source_form, @note)
         ON CONFLICT(engagement_id, from_on) DO UPDATE SET
           kind = excluded.kind,
           to_on = excluded.to_on,
           amount_minor = excluded.amount_minor,
           observed_by = excluded.observed_by,
           recorded_by = excluded.recorded_by,
           recorded_at = excluded.recorded_at,
           source_form = excluded.source_form,
           note = excluded.note`,
      ).run(row);

      rows.push(row);
      if (kind === 'wage') answered.add(raw.engagement_id);
    }

    // Every permanent engagement running in this range needs an answer.
    const permanent = (
      db.prepare(`SELECT * FROM registry_engagements WHERE kind = 'permanent'`).all() as
        EngagementRow[]
    ).filter((e) => engagedDuring(e, input.from_on, input.to_on));

    const missing = permanent.filter((e) => !answered.has(e.id));
    if (missing.length > 0) {
      const names = missing.map((e) => getPerson(db, e.person_id)?.identifier ?? e.person_id);
      refuse(
        'untouched_permanent_engagement',
        `${names.join(', ')} ${missing.length === 1 ? 'is' : 'are'} on the payroll for this ` +
          `period and ${missing.length === 1 ? 'has' : 'have'} no figure. Enter what was ` +
          `agreed -- an omission is not an answer.`,
        'entries',
      );
    }

    return {
      from_on: input.from_on,
      to_on: input.to_on,
      written: rows.length,
      updated,
      total_minor: rows.reduce((s, r) => s + r.amount_minor, 0),
      rows,
    };
  })();
}

/**
 * Remove wage periods.
 *
 * Narrow on purpose -- explicit ids, never a range -- and it exists because a
 * run entered against the wrong month has no other repair: UNIQUE
 * (engagement_id, from_on) means the wrong dates keep holding the rows until
 * they are removed. Same shape and same limits as deleteMilkings().
 */
export function deleteWagePeriods(db: Db, ids: readonly string[]): number {
  if (ids.length === 0) return 0;
  const stmt = db.prepare(`DELETE FROM registry_wage_periods WHERE id = ?`);
  return db.transaction(() => ids.reduce((n, id) => n + stmt.run(id).changes, 0))();
}

// ---------------------------------------------------------------------------
// The run read model (docs/REGISTRY_PAYROLL.md §12.1)
// ---------------------------------------------------------------------------

/**
 * The milk half of the package report: allowance against what was collected.
 *
 * ---------------------------------------------------------------------------
 * THE EXPECTATION IS CLIPPED TO `asOf`, AND THAT IS NOT A DETAIL
 * ---------------------------------------------------------------------------
 * Found by opening the harness on the 7th: the run defaults to the whole
 * current month, so an allowance of 2 L/day produced "60 L due, 14 L taken" --
 * a 46 L shortfall consisting almost entirely of days that have not happened.
 * The arithmetic was right and the screen was false, which is the failure this
 * repo has now hit three times with fixtures and once here with live data.
 *
 * So the expectation covers `from_on .. min(to_on, asOf)` and `through_on` says
 * where it stopped. A completed month is unaffected -- asOf is past to_on, the
 * clip is a no-op, and the figure is the whole month's entitlement.
 */
export interface MilkAgainstAllowance {
  /** From the package, per day. Null when there is no milk line. */
  allowance_per_day: number | null;
  allowance_period: BenefitPeriod | null;
  /** What actually left the bulk to this person's destination in the range. */
  taken_litres: number;
  /** Null when there is no allowance to compare against. */
  expected_litres: number | null;
  /** The last day the expectation counts -- `to_on`, or `asOf` if it is earlier. */
  through_on: string;
  /** True when the period is still running, so the screen can say "to date". */
  partial: boolean;
}

export interface PayrollRunRow {
  engagement: EngagementRow;
  person: PersonRow;
  term: PayTermRow | null;
  benefits: PayBenefitRow[];
  /** The default the form offers. Null when there is no agreement to offer. */
  suggested_minor: number | null;
  /** Already saved for this exact range, if anything is. */
  existing: WagePeriodRow | null;
  milk: MilkAgainstAllowance | null;
}

export interface PayrollRun {
  from_on: string;
  to_on: string;
  /** Where a per-day expectation stops counting: `to_on`, or today if earlier. */
  through_on: string;
  /** Must be answered before the run saves. */
  permanent: PayrollRunRow[];
  /** Dihari days already entered inside the range. */
  daily: (WagePeriodRow & { person: PersonRow; engagement: EngagementRow })[];
  /** Daily engagements available to add a day against. */
  daily_candidates: PayrollRunRow[];
  answered: number;
  outstanding: number;
  total_minor: number;
}

/** Days in an inclusive date range, for turning a per-day allowance into a total. */
function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * The payroll run for a period.
 *
 * DERIVED FROM ENGAGEMENT ROWS, never from a status column -- the same argument
 * milkingRoster() makes for reading lactations rather than
 * registry_animal_status. It is what lets the run open last March and show who
 * was employed then, including somebody who has since left.
 *
 * `suggested_minor` is the TERM'S figure and is only a default. The screen must
 * present it as editable (§12.1): a pre-filled figure that looks read-only is
 * how the leave month gets paid in full by reflex.
 */
export function payrollRun(
  db: Db,
  fromOn: string,
  toOn: string,
  /**
   * Today, farm-local. A PARAMETER, never a clock read in here -- the same rule
   * projections follow, and what lets a test open a mid-month run at a fixed
   * date. Defaults to `toOn`, which makes the clip a no-op for a settled month.
   */
  asOf: string = toOn,
): PayrollRun {
  assertDate(fromOn, 'from_on');
  assertDate(toOn, 'to_on');
  if (toOn < fromOn) {
    refuse('invalid_payload', `to_on ${toOn} is before from_on ${fromOn}`, 'to_on');
  }
  // Clipped, never extended: an asOf before the range start would make the
  // expectation negative, and one after to_on is simply a finished period.
  const throughOn = asOf < toOn ? (asOf < fromOn ? fromOn : asOf) : toOn;

  const engagements = (
    db.prepare(`SELECT * FROM registry_engagements ORDER BY started_on, id`).all() as
      EngagementRow[]
  ).filter((e) => engagedDuring(e, fromOn, toOn));

  const people = new Map(
    (db.prepare(`SELECT * FROM registry_people`).all() as PersonRow[]).map((p) => [p.id, p]),
  );

  const build = (e: EngagementRow): PayrollRunRow => {
    const { term, benefits } = packageOn(db, e.id, fromOn);
    const existing =
      (db
        .prepare(`SELECT * FROM registry_wage_periods WHERE engagement_id = ? AND from_on = ?`)
        .get(e.id, fromOn) as WagePeriodRow) ?? null;

    const milkLine = benefits.find((b) => b.kind === 'milk') ?? null;
    let milk: MilkAgainstAllowance | null = null;
    if (milkLine !== null) {
      // What actually left the bulk to this person's own destination. The
      // dispatch rows are the fact; the package holds only the entitlement, and
      // the two are deliberately allowed to differ.
      const taken = db
        .prepare(
          `SELECT COALESCE(SUM(d.litres), 0) AS litres
             FROM registry_dispatches d
             JOIN registry_destinations dst ON dst.id = d.destination_id
            WHERE dst.person_id = ? AND d.status = 'taken'
              AND d.occurred_on >= ? AND d.occurred_on <= ?`,
        )
        .get(e.person_id, fromOn, toOn) as { litres: number };
      // A MONTHLY allowance is spread over the WHOLE period, not over the
      // elapsed part -- 20 kg of flour a month is not 4.6 kg by the 7th. Only a
      // per-DAY allowance accrues daily, so only it is clipped.
      const perDay = milkLine.quantity === null || milkLine.period !== 'day'
        ? null
        : milkLine.quantity;
      const monthly = milkLine.quantity !== null && milkLine.period === 'month'
        ? milkLine.quantity
        : null;
      milk = {
        allowance_per_day: perDay,
        allowance_period: milkLine.period,
        taken_litres: round2(taken.litres),
        expected_litres:
          perDay !== null
            ? round2(perDay * daysInclusive(fromOn, throughOn))
            : monthly,
        through_on: throughOn,
        partial: throughOn < toOn,
      };
    }

    return {
      engagement: e,
      person: people.get(e.person_id) as PersonRow,
      term,
      benefits,
      suggested_minor: term ? term.cash_minor : null,
      existing,
      milk,
    };
  };

  const permanent = engagements.filter((e) => e.kind === 'permanent').map(build);
  const dailyCandidates = engagements.filter((e) => e.kind === 'daily').map(build);

  const dailyRows = (
    db
      .prepare(
        `SELECT w.* FROM registry_wage_periods w
           JOIN registry_engagements e ON e.id = w.engagement_id
          WHERE e.kind = 'daily' AND w.from_on >= ? AND w.from_on <= ?
          ORDER BY w.from_on, w.id`,
      )
      .all(fromOn, toOn) as WagePeriodRow[]
  ).map((w) => {
    const e = db
      .prepare(`SELECT * FROM registry_engagements WHERE id = ?`)
      .get(w.engagement_id) as EngagementRow;
    return { ...w, engagement: e, person: people.get(e.person_id) as PersonRow };
  });

  const answered = permanent.filter((r) => r.existing !== null).length;

  return {
    from_on: fromOn,
    to_on: toOn,
    through_on: throughOn,
    permanent,
    daily: dailyRows,
    daily_candidates: dailyCandidates,
    answered,
    outstanding: permanent.length - answered,
    total_minor:
      permanent.reduce((s, r) => s + (r.existing?.amount_minor ?? 0), 0) +
      dailyRows.reduce((s, r) => s + r.amount_minor, 0),
  };
}
