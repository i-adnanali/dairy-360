// Registry wire types -- mirrors what server/src/registry/routes.ts returns.
//
// Hand-mirrored rather than imported from @dairy/shared, because the registry's
// own types deliberately do NOT live there: `RegistryAnimalStatus` is separate
// from the demo `AnimalStatus`, and putting registry vocabulary into the shared
// package would put it in front of the demo UI for no reason. See
// docs/REGISTRY.md, Decision 10.
//
// If these drift from the server, the route tests will not catch it -- they
// assert the server's shape, not this file's. What catches it is that every
// field used here appears in a component test against a fixture response.

export type RegistryAnimalStatus =
  | 'departed' | 'calf' | 'lactating' | 'dry' | 'heifer' | 'male';

export type RegistrySex = 'female' | 'male';
export type RegistryOrigin = 'born_on_farm' | 'acquired';

/** day | month | year | estimated. Chosen BEFORE a date, never defaulted. */
export type DatePrecision = 'day' | 'month' | 'year' | 'estimated';

export type SourceForm =
  | 'daily_herd_sheet' | 'cycle_card' | 'direct_entry' | 'import' | 'recall';

export type RegistryEventType =
  | 'birth' | 'acquired' | 'calving' | 'dry_off' | 'departure' | 'note';

export type EnterableEventType = 'dry_off' | 'departure' | 'note';

/**
 * The two guards a write can be recorded as having stepped past. Mirrors
 * OverriddenCheck on the server; columns on the event since migration 4.
 */
export type OverriddenCheck = 'near_duplicate_calving' | 'animal_departed';
export type CalvingOutcome = 'live' | 'stillborn' | 'died_within_24h';

export interface HerdRow {
  id: string;
  name: string | null;
  sex: RegistrySex;
  species: string;
  origin: RegistryOrigin;
  post_no: string | null;
  tag_no: string | null;
  status: RegistryAnimalStatus | null;
  parity: number | null;
  birth_on: string | null;
  birth_precision: DatePrecision | null;
  open_lactation_id: string | null;
  event_count: number;
}

export interface TimelineEvent {
  id: string;
  type: RegistryEventType;
  occurred_on: string;
  occurred_time: string | null;
  date_precision: DatePrecision;
  payload: Record<string, unknown>;
  source_form: SourceForm;
  source_ref: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  supersedes_id: string | null;
  /**
   * The guard this write stepped past, or null. Columns since migration 4 --
   * these used to live inside `payload.override`.
   */
  override_check: OverriddenCheck | null;
  override_reason: string | null;
  /** The event that REPLACED this one. Rendered, not filtered. */
  superseded_by_id: string | null;
  effective: boolean;
}

export interface AnimalDetail {
  animal: Omit<HerdRow, 'status' | 'parity' | 'birth_on' | 'birth_precision' | 'open_lactation_id' | 'event_count'>;
  status: {
    animal_id: string;
    status: RegistryAnimalStatus;
    parity: number;
    birth_on: string | null;
    birth_precision: DatePrecision | null;
    open_lactation_id: string | null;
  } | null;
  events: TimelineEvent[];
}

export interface LinkCandidate {
  id: string;
  name: string | null;
  sex: RegistrySex;
  origin: RegistryOrigin;
  birth_on: string | null;
  birth_precision: DatePrecision | null;
  eligible: boolean;
  /** Why not, when not. Shown greyed rather than omitted from the list. */
  ineligible_reason: string | null;
  /**
   * Signed whole days from this animal's birth date to the proposed calving
   * date. Null when either is missing — which ranks the animal FIRST, not last:
   * an animal with no birth date is the likeliest link target there is.
   */
  days_apart: number | null;
  /** Inside the server's match window. Unjudgeable animals are inside it. */
  within_match_window: boolean;
}

export interface Violation {
  invariant: number;
  name: string;
  detail: string;
}

export interface IntervalSummary {
  quality: 'measured' | 'approximate';
  count: number;
  mean_days: number | null;
  min_days: number | null;
  max_days: number | null;
}

// ---------------------------------------------------------------------------
// Milk yield (step 4 -- docs/REGISTRY_MILKING.md)
// ---------------------------------------------------------------------------

export type MilkingSession = 'morning' | 'evening';

/**
 * THREE VALUES, and the difference between the last two is the point.
 *
 *   measured            -- a number was taken
 *   milked_not_measured -- milk was taken, nobody weighed it. MISSING DATA.
 *   not_milked          -- no milk was taken. Behaves like a zero.
 *
 * Collapsing the last two drags every per-animal mean down with milkings that
 * did happen, which corrupts exactly the drop-detection this exists for.
 */
export type MilkingStatus = 'measured' | 'milked_not_measured' | 'not_milked';

export interface MilkingRow {
  id: string;
  animal_id: string;
  occurred_on: string;
  session: MilkingSession;
  status: MilkingStatus;
  yield_litres: number | null;
  reason: string | null;
  occurred_time: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  source_form: SourceForm;
  note: string | null;
}

export interface RosterRow {
  animal_id: string;
  name: string | null;
  days_in_milk: number;
  lactation_started_on: string;
  /** Already saved for THIS session, when re-opening one. */
  existing: MilkingRow | null;
  /** The previous session's figure -- the strongest error-catcher on the screen. */
  previous: {
    session: MilkingSession; occurred_on: string;
    status: MilkingStatus; yield_litres: number | null;
  } | null;
  recent_mean: number | null;
  recent_n: number;
}

export interface MilkingRoster {
  occurred_on: string;
  session: MilkingSession;
  previous_session: { occurred_on: string; session: MilkingSession };
  rows: RosterRow[];
  saved: number;
}

export interface SessionCompleteness {
  occurred_on: string;
  session: MilkingSession;
  expected: number;
  recorded: number;
  measured: number;
  milked_not_measured: number;
  not_milked: number;
}

export interface MilkingReport {
  rows: number;
  measured: number;
  milked_not_measured: number;
  not_milked: number;
  sessions: number;
  complete_sessions: number;
  first_on: string | null;
  last_on: string | null;
  recent: SessionCompleteness[];
  caveat: string;
}

export interface MilkingHistoryRow extends MilkingRow {
  lactation_id: string | null;
  days_in_milk: number | null;
}

export interface Verification {
  as_of: string;
  counts: { animals: number; events: number; lactations: number; milkings: number };
  violations: Violation[];
  histogram: { source_form: string; date_precision: DatePrecision; count: number }[];
  intervals: {
    intervals: {
      animal_id: string; ordinal: number; from_on: string; to_on: string;
      days: number; quality: 'measured' | 'approximate';
    }[];
    measured: IntervalSummary;
    approximate: IntervalSummary;
    caveat: string;
  };
  milking: MilkingReport;
  /**
   * A REPORT, not violations. Every line fires on rows the farm asked to be
   * able to write -- overlapping stints, a settlement after somebody left, a
   * figure that differs from the agreement -- so /check must render these
   * differently or people learn to ignore the page.
   */
  labour: LabourReportLine[];
}

/**
 * The server's refusal shape. `field` names a DOMAIN COLUMN, which is why the
 * form controls are named after domain columns too -- a mapping layer would be
 * the same string-matching problem one level up.
 */
export interface WireError {
  error: string;
  field?: string;
  message: string;
}

/** `GET /api/registry/storage` -- which database the server writes to. */
export interface StorageInfo {
  storage: string;
  memory: boolean;
}

/**
 * What the app knows about the database on the other end.
 *
 * `unknown` is a real answer and is kept distinct from both others: a server
 * that will not say which database it holds must not be shown as the harness,
 * and it must not be asserted to be the real registry either.
 */
export type TargetKind = 'harness' | 'real' | 'unknown';

/** Previously-used values for the free-text identifier fields. Suggestions only. */
export interface IdentifierValues {
  observed_by: string[];
  acquired_from: string[];
  sire_ref: string[];
}

export type DuplicateMatchKind = 'post_no' | 'tag_no' | 'name_exact' | 'name_near';

/** An animal that might already be the one being entered. A soft signal only. */
export interface DuplicateCandidate {
  id: string;
  name: string | null;
  sex: RegistrySex;
  post_no: string | null;
  tag_no: string | null;
  matched_on: DuplicateMatchKind;
  /** Server-computed, for the same reason `ineligible_reason` is. */
  match_reason: string;
  /** When the animal was TYPED -- its origin event's recorded_at, UTC. */
  recorded_at: string | null;
}

// ---------------------------------------------------------------------------
// Milk sales, home use and the buyer ledger (docs/REGISTRY_SALES.md)
// ---------------------------------------------------------------------------

/** `staff` was added by migration 7: milk allocated as part of a salary
 *  arrangement, ONE DESTINATION PER PERSON. See docs/REGISTRY_PAYROLL.md §4.6a. */
export type DestinationKind = 'dodhi' | 'household' | 'shop' | 'home' | 'staff' | 'other';
export type DispatchStatus = 'taken' | 'none';
export type PaymentMethod = 'cash' | 'bank' | 'adjustment';

export interface Destination {
  id: string;
  name: string;
  kind: DestinationKind;
  /** Does money follow the milk. Home never does. */
  billable: boolean;
  /** Must the sheet account for this destination in EVERY session? */
  standing: boolean;
  contact: string | null;
  started_on: string;
  ended_on: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
  /** The staff member this milk belongs to; null for every other kind. */
  person_id: string | null;
}

/**
 * A price agreement, AS QUOTED.
 *
 * Two numbers, never one: `price_minor` is paisa and `price_unit_litres` is the
 * lot it covers. Rs 7,000 per 40 L is `(700000, 40)`. Never normalise this to
 * per-litre for storage or for display -- see money.ts.
 */
export interface DestinationPrice {
  id: string;
  destination_id: string;
  effective_from: string;
  price_minor: number;
  price_unit_litres: number;
  recorded_by: string;
  recorded_at: string;
  note: string | null;
}

export interface DestinationListRow extends Destination {
  price: DestinationPrice | null;
  active: boolean;
}

export interface Dispatch {
  id: string;
  destination_id: string;
  occurred_on: string;
  session: MilkingSession;
  status: DispatchStatus;
  litres: number | null;
  price_minor: number | null;
  price_unit_litres: number | null;
  reason: string | null;
  occurred_time: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  source_form: SourceForm;
  note: string | null;
}

export interface SheetRow {
  destination_id: string;
  name: string;
  kind: DestinationKind;
  billable: boolean;
  standing: boolean;
  existing: Dispatch | null;
  previous: { occurred_on: string; status: DispatchStatus; litres: number | null } | null;
  price: DestinationPrice | null;
}

/** What the herd gave this session, as far as anyone measured it. */
export interface SessionProduction {
  measured_litres: number;
  measured: number;
  not_measured: number;
  not_milked: number;
  expected: number;
  recorded: number;
}

export interface DispatchSheet {
  occurred_on: string;
  session: MilkingSession;
  previous_session: { occurred_on: string; session: MilkingSession };
  /** Must be answered. Untouched blocks the save. */
  standing: SheetRow[];
  /** Offered, never required. */
  occasional: SheetRow[];
  litres: number;
  amount_minor: number;
  produced: SessionProduction;
}

export interface Payment {
  id: string;
  destination_id: string;
  occurred_on: string;
  amount_minor: number;
  method: PaymentMethod;
  reference: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  note: string | null;
}

export interface StatementMonth {
  month: string;
  litres: number;
  billed_minor: number;
  paid_minor: number;
  closing_minor: number;
  dispatches: Dispatch[];
  payments: Payment[];
}

export interface Statement {
  destination_id: string;
  name: string;
  billable: boolean;
  months: StatementMonth[];
  litres: number;
  billed_minor: number;
  paid_minor: number;
  balance_minor: number;
  prices: DestinationPrice[];
}

export interface BalanceRow {
  destination_id: string;
  name: string;
  billable: boolean;
  balance_minor: number;
  last_dispatch_on: string | null;
  last_payment_on: string | null;
}

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
  expected_standing: number;
  recorded_standing: number;
}

/**
 * Produced against dispatched.
 *
 * `gap_pct` is NULL whenever production is incomplete, and
 * `gap_pct_withheld_because` says which. The view must render the reason rather
 * than a dash -- a missing number with no explanation reads as a bug.
 */
export interface Reconciliation {
  from: string;
  to: string;
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
  gap_litres: number;
  gap_pct: number | null;
  gap_pct_withheld_because: string | null;
  sessions: number;
  complete_sessions: number;
  incomplete: SessionCompleteness[];
  off_schedule: OffSchedule[];
  interpretation: string;
}

// ---------------------------------------------------------------------------
// Labour: people, engagements, packages, the run and the wage ledger
// (docs/REGISTRY_PAYROLL.md)
// ---------------------------------------------------------------------------

export type EngagementKind = 'permanent' | 'daily';
export type CashPeriod = 'month' | 'day';
export type BenefitKind = 'milk' | 'flour' | 'accommodation' | 'other';
export type BenefitPeriod = 'day' | 'month';
export type WagePeriodKind = 'wage' | 'bonus';

/**
 * A person the farm knows -- NOT necessarily an employee.
 *
 * `identifier` is the stable string that also appears in `observed_by`. The
 * link is BY VALUE, and the identifier CANNOT BE RENAMED once records exist:
 * every milking and dispatch that names them stores it as text, and the event
 * log cannot be rewritten. The form must not offer it as editable.
 */
export interface Person {
  id: string;
  identifier: string;
  name: string | null;
  contact: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/**
 * One STINT. A person has as many as they have had.
 *
 * Overlapping stints and more than one open at a time are LEGITIMATE -- the
 * farm asked for them, because people leave and come back and somebody can be
 * milker and night watchman at once. The UI must not treat either as an error.
 */
export interface Engagement {
  id: string;
  person_id: string;
  kind: EngagementKind;
  role: string | null;
  started_on: string;
  ended_on: string | null;
  end_reason: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/**
 * A package agreement, AS AGREED.
 *
 * Two values, never one: `cash_minor` is paisa and `cash_period` is what it
 * covers. Rs 25,000 a month is `(2500000, 'month')`. Never render it as a
 * per-day conversion -- see money.ts, and REGISTRY_PAYROLL.md §5.
 */
export interface PayTerm {
  id: string;
  engagement_id: string;
  effective_from: string;
  cash_minor: number;
  cash_period: CashPeriod;
  recorded_by: string;
  recorded_at: string;
  note: string | null;
}

/**
 * One in-kind line of a package.
 *
 * `quantity`, `unit` and `period` stand or fall together, and accommodation is
 * the case with none of the three. THERE IS NO VALUE FIELD, deliberately: the
 * rupee worth of a package is a computed, explicitly-imputed report figure and
 * never a stored number anybody can sum into a balance.
 */
export interface PayBenefit {
  id: string;
  term_id: string;
  kind: BenefitKind;
  quantity: number | null;
  unit: string | null;
  period: BenefitPeriod | null;
  note: string | null;
}

export interface PayTermWithBenefits extends PayTerm {
  benefits: PayBenefit[];
}

/** The debit side -- a salaried month, a dihari day, or a one-day bonus. */
export interface WagePeriod {
  id: string;
  engagement_id: string;
  kind: WagePeriodKind;
  from_on: string;
  to_on: string;
  amount_minor: number;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  source_form: SourceForm;
  note: string | null;
}

/** The credit side. Keyed on the PERSON, not the engagement. */
export interface WagePayment {
  id: string;
  person_id: string;
  occurred_on: string;
  amount_minor: number;
  method: PaymentMethod;
  reference: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  note: string | null;
}

/** The milk half of the package report: entitlement against what was taken. */
/**
 * The expectation is CLIPPED TO TODAY for a per-day allowance, so a month still
 * running does not read as a shortfall made of days that have not happened.
 * A monthly allowance is not clipped — 20 kg a month is not 4.6 kg by the 7th.
 */
export interface MilkAgainstAllowance {
  allowance_per_day: number | null;
  allowance_period: BenefitPeriod | null;
  taken_litres: number;
  expected_litres: number | null;
  through_on: string;
  /** True while the period is still running, so the screen can say “to date”. */
  partial: boolean;
}

export interface PayrollRunRow {
  engagement: Engagement;
  person: Person;
  term: PayTerm | null;
  benefits: PayBenefit[];
  /** The default the form offers. Null when there is no agreement to offer. */
  suggested_minor: number | null;
  /** Already saved for this exact range, if anything is. */
  existing: WagePeriod | null;
  milk: MilkAgainstAllowance | null;
}

export interface PayrollRun {
  from_on: string;
  to_on: string;
  through_on: string;
  /** Must be answered before the run saves. */
  permanent: PayrollRunRow[];
  /** Dihari days already entered inside the range. */
  daily: (WagePeriod & { person: Person; engagement: Engagement })[];
  /** Daily engagements available to add a day against. */
  daily_candidates: PayrollRunRow[];
  answered: number;
  outstanding: number;
  total_minor: number;
}

export interface WageStatementMonth {
  month: string;
  earned_minor: number;
  paid_minor: number;
  closing_minor: number;
  periods: WagePeriod[];
  payments: WagePayment[];
}

export interface WageStatement {
  person_id: string;
  identifier: string;
  name: string | null;
  engagements: Engagement[];
  months: WageStatementMonth[];
  earned_minor: number;
  paid_minor: number;
  balance_minor: number;
  as_of: string;
  packages: {
    engagement_id: string;
    terms: PayTermWithBenefits[];
    current: { term: PayTerm | null; benefits: PayBenefit[] };
  }[];
}

export interface WageBalanceRow {
  person_id: string;
  identifier: string;
  name: string | null;
  /** False for somebody with no open stint -- the screen dims them. */
  engaged: boolean;
  balance_minor: number;
  last_period_on: string | null;
  last_payment_on: string | null;
}

export interface LabourReportLine {
  kind:
    | 'unknown_identifier'
    | 'overlapping_engagements'
    | 'multiple_open_engagements'
    | 'wage_period_outside_engagement'
    | 'amount_differs_from_term';
  detail: string;
}

// ---------------------------------------------------------------------------
// The day board -- what still needs recording
// ---------------------------------------------------------------------------

export interface SessionStanding {
  session: MilkingSession;
  /** How many rows the session expects. Zero means there is nothing to do. */
  expected: number;
  recorded: number;
  complete: boolean;
}

export interface DayBoard {
  on: string;
  milking: SessionStanding[];
  /** STANDING destinations only — an occasional household is not a gap. */
  dispatch: SessionStanding[];
  payroll: { from_on: string; to_on: string; outstanding: number; permanent: number };
  /**
   * Last month, when it is still unanswered. Null once it is settled.
   *
   * The CURRENT month is outstanding for the whole of it, so prompting about it
   * would make the payroll line permanently amber and therefore ignorable.
   */
  payroll_previous: { from_on: string; to_on: string; outstanding: number; permanent: number } | null;
}
