// Animal registry -- types (see docs/REGISTRY.md).
//
// DELIBERATELY SEPARATE FROM shared/src/types.ts. The registry is a different
// domain from the demo tables, and `AnimalStatus` there is
// 'lactating' | 'dry' | 'pregnant' | 'calf', baked into two tool input_schema
// enums in tools/index.ts. Widening it would be a breaking change to tool
// schemas for no benefit this cycle (decision doc §9).
//
// These types are not re-exported from @dairy/shared either: nothing in
// web-angular reads the registry (verified -- zero references to AnimalStatus
// or its literals anywhere in web-angular/src), so putting registry vocabulary
// in front of the demo UI would buy nothing. If the tools cycle surfaces the
// registry to the client, that is the moment to move them.

// ---------------------------------------------------------------------------
// Status vocabulary (decision doc §9)
// ---------------------------------------------------------------------------

/**
 * Registry status. Always DERIVED, never authored.
 *
 * `lactating` deliberately reuses the demo vocabulary's word rather than the
 * more precise `milking`: gratuitous divergence in a small codebase is a tax
 * paid at every future read. `heifer`, `male` and `departed` have no demo
 * equivalent. `pregnant` is absent until breeding events exist at step 5.
 *
 * A const array with the type derived from it, following LIVE_EVENT_TYPES
 * below: the agent's `list_registry_animals` needs the vocabulary as VALUES for
 * its input_schema enum, and a hand-copied list in a tool schema is exactly
 * what would still say six words after step 5 adds `pregnant`.
 */
export const REGISTRY_ANIMAL_STATUSES = [
  'departed',
  'calf',
  'lactating',
  'dry',
  'heifer',
  'male',
] as const;

export type RegistryAnimalStatus = (typeof REGISTRY_ANIMAL_STATUSES)[number];

export type RegistrySex = 'female' | 'male';

export type RegistryOrigin = 'born_on_farm' | 'acquired';

// ---------------------------------------------------------------------------
// Time and provenance (decision doc §6)
// ---------------------------------------------------------------------------

/**
 * How well the date is known. NOT NULL with NO DEFAULT in the schema: a default
 * is how `day` gets silently applied to a guess.
 *
 * Storage convention, enforced by CHECK constraints in schema.ts, by
 * assertDatePrecision() at the write boundary, AND by invariant 11:
 * `month` -> the 1st of that month; `year` and `estimated` -> January 1.
 *
 * `year` and `estimated` therefore STORE the same shape, but they are not
 * interchangeable and must stay separate values: `year` means "I know the
 * year", `estimated` means "I am guessing it". The difference is load-bearing
 * in two places -- definitelyBefore() treats an estimated date as NOT
 * COMPARABLE at all (so invariants 4 and 5 behave differently), and the
 * precision histogram splits on it, which is the point of the histogram.
 */
export type DatePrecision = 'day' | 'month' | 'year' | 'estimated';

export const DATE_PRECISIONS: readonly DatePrecision[] = [
  'day',
  'month',
  'year',
  'estimated',
];

/** Where the fact came from. `recall` is first-class, not a fallback. */
export type SourceForm =
  | 'daily_herd_sheet'
  | 'cycle_card'
  | 'direct_entry'
  | 'import'
  | 'recall';

export const SOURCE_FORMS: readonly SourceForm[] = [
  'daily_herd_sheet',
  'cycle_card',
  'direct_entry',
  'import',
  'recall',
];

export interface Provenance {
  source_form: SourceForm;
  source_ref?: string | null;
  /** Who saw it. Null is legitimate -- nobody observed a purchase record. */
  observed_by?: string | null;
  /** Who typed it. NOT NULL. */
  recorded_by: string;
}

// ---------------------------------------------------------------------------
// Event taxonomy (decision doc §7)
// ---------------------------------------------------------------------------

export const LIVE_EVENT_TYPES = [
  'birth',
  'acquired',
  'calving',
  'dry_off',
  'departure',
  'note',
] as const;

export type RegistryEventType = (typeof LIVE_EVENT_TYPES)[number];

/**
 * Named now so the taxonomy is designed once rather than accreted, and REJECTED
 * by the write boundary rather than accepted with a loose payload.
 */
export const RESERVED_EVENT_TYPES = [
  'heat_observed',
  'insemination',
  'pregnancy_check',
  'abortion',
  'treatment',
  'vet_visit',
  'null_observation',
  'milking',
  'weight',
  'body_condition',
] as const;

export type ReservedEventType = (typeof RESERVED_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Overridden checks
// ---------------------------------------------------------------------------

/**
 * The soft checks a write can be pushed past, named so the log can say which.
 *
 * Both are hard refusals with an explicit opt-out rather than warnings: the
 * caller passes `allow_near_duplicate` / `allow_after_departure` and the guard
 * steps aside. What was missing is that stepping aside left NO TRACE -- an
 * overridden write was indistinguishable from one that never tripped a check,
 * in an append-only log whose whole premise is that the record explains itself.
 */
export type OverriddenCheck = 'near_duplicate_calving' | 'animal_departed';

export const OVERRIDDEN_CHECKS: readonly OverriddenCheck[] = [
  'near_duplicate_calving',
  'animal_departed',
];

/**
 * A record that a check was overridden, and why.
 *
 * ---------------------------------------------------------------------------
 * IT LIVES IN TWO COLUMNS, AS OF MIGRATION 4
 * ---------------------------------------------------------------------------
 * It lived in the event payload first, for one reason only: a column cost a
 * migration, and the entry-UX build order's standing claim was that everything
 * above its cut line landed without one. REGISTRY_ENTRY_UX.md §11 recorded the
 * debt -- "do not migrate for this alone, bundle it into whichever migration
 * lands next" -- and migration 4 is where it was paid.
 *
 * `override_check` and `override_reason` are now columns on
 * registry_animal_events: uniform across event types, queryable without
 * json_extract, sitting beside the other provenance fields they resemble, and
 * -- new -- constrained by the database rather than only by this module. See
 * the migration 4 comment in schema.ts for what else the move bought.
 *
 * This interface survives as the in-memory shape passed to appendEvent() and
 * returned to readers. It is no longer part of any payload.
 *
 * `reason` is OPTIONAL, deliberately. Requiring prose to get past a guard would
 * make the guard a wall, and the operator would type "yes" to clear it -- which
 * is worse than a null, because a null is honest about knowing nothing while
 * "yes" looks like a reason. The FLAG is the load-bearing part; the prose is a
 * bonus when someone bothers.
 */
export interface OverrideRecord {
  check: OverriddenCheck;
  reason: string | null;
}

export type CalvingOutcome = 'live' | 'stillborn' | 'died_within_24h';
export type CalvingAssistance = 'none' | 'assisted' | 'vet';
export type DryOffReason = 'scheduled' | 'low_yield' | 'health' | 'other';
export type DepartureReason = 'sold' | 'died' | 'culled' | 'lost';

export interface BirthPayload {
  dam_id: string;
  sire_ref?: string | null;
  calving_event_id: string;
  sex: RegistrySex;
  outcome: CalvingOutcome;
}

export interface AcquiredPayload {
  from?: string | null;
  /** The animal's birth date, which is NOT the acquisition date. */
  estimated_birth_on?: string | null;
  estimated_birth_precision?: DatePrecision | null;
  notes?: string | null;
}

export interface CalvingPayload {
  calf_id: string;
  calf_sex: RegistrySex;
  outcome: CalvingOutcome;
  assistance?: CalvingAssistance | null;
  notes?: string | null;
  /** Set only when the near-duplicate guard was actually stepped past. */
}

export interface DryOffPayload {
  reason?: DryOffReason | null;
  notes?: string | null;
  /** Set only when the terminal-departure guard was actually stepped past. */
}

export interface DeparturePayload {
  reason: DepartureReason;
  to?: string | null;
  cause?: string | null;
  notes?: string | null;
  /** Set only when the terminal-departure guard was actually stepped past. */
}

/**
 * No `override` here, and that is not an omission: a note is ALWAYS allowed
 * after a departure (somebody ringing about a sold animal is a real thing to
 * record), so there is no guard for a note to be pushed past.
 */
export interface NotePayload {
  text: string;
}

/** One discriminated union on `type`, validated by assertEventPayload(). */
export type RegistryEventPayload =
  | { type: 'birth'; payload: BirthPayload }
  | { type: 'acquired'; payload: AcquiredPayload }
  | { type: 'calving'; payload: CalvingPayload }
  | { type: 'dry_off'; payload: DryOffPayload }
  | { type: 'departure'; payload: DeparturePayload }
  | { type: 'note'; payload: NotePayload };

export type PayloadFor<T extends RegistryEventType> = Extract<
  RegistryEventPayload,
  { type: T }
>['payload'];

// ---------------------------------------------------------------------------
// Row types (mirror the SQLite schema in registry/schema.ts)
// ---------------------------------------------------------------------------

export interface RegistryAnimalRow {
  id: string;
  name: string | null;
  sex: RegistrySex;
  species: string;
  origin: RegistryOrigin;
  post_no: string | null;
  tag_no: string | null;
}

/** An event row exactly as stored. `payload` is JSON TEXT. */
export interface RegistryEventRow {
  id: string;
  animal_id: string;
  type: RegistryEventType;
  occurred_on: string;
  occurred_time: string | null;
  date_precision: DatePrecision;
  payload: string;
  source_form: SourceForm;
  source_ref: string | null;
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  supersedes_id: string | null;
  /**
   * The guard this write stepped past, or null. Migration 4 moved these out of
   * the payload; see OverrideRecord.
   *
   * Recorded from the CONDITION, never from the caller's flag -- a caller that
   * passes `allow_near_duplicate` unconditionally must not have every write
   * claim an override happened, because a field that is always set carries no
   * information.
   */
  override_check: OverriddenCheck | null;
  override_reason: string | null;
}

/** An event row with its payload parsed -- what the pure core consumes. */
export interface RegistryEvent extends Omit<RegistryEventRow, 'payload'> {
  payload: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Milk yield (step 4 -- see docs/REGISTRY_MILKING.md)
// ---------------------------------------------------------------------------

/**
 * Which milking. A CATEGORY, never derived from a clock time.
 *
 * Milking times move with the season and with who is available; only a window is
 * guaranteed. A stored clock time would therefore usually be a reconstruction,
 * so `occurred_time` on a milking is optional and never defaulted -- the same
 * rule as on an event.
 *
 * THE CONSEQUENCE, stated so it is not discovered later: yield depends on the
 * interval since the previous milking, and with variable times that interval is
 * unknown. Morning and evening figures must therefore never be POOLED or
 * compared to each other. A per-animal DAILY TOTAL is legitimate, because it is
 * the sum of a real day. "Morning average vs evening average" is not a
 * comparison this data supports and no read model may offer it.
 */
export type MilkingSession = 'morning' | 'evening';

export const MILKING_SESSIONS: readonly MilkingSession[] = ['morning', 'evening'];

/**
 * What is known about one animal at one session. THREE VALUES, and the
 * distinction between the last two is the whole point.
 *
 *   - `measured`             -- a number was taken.
 *   - `milked_not_measured`  -- an ordinary milking nobody weighed. Milk exists;
 *                               the quantity is MISSING DATA.
 *   - `not_milked`           -- sick, treated, away, dried off. NO MILK WAS
 *                               TAKEN. For a daily total this behaves like zero.
 *
 * Collapse the last two into one blank and every per-animal mean is dragged down
 * by milkings that did happen -- which corrupts precisely the drop-detection
 * this feature exists for. The farm's current practice is to measure only when a
 * drop is noticed, so `milked_not_measured` is expected to be the MAJORITY state
 * for the first months. It is a first-class value, not an error.
 *
 * There is deliberately no fourth value for "not entered". An animal with no row
 * for a session is exactly that, and session completeness is countable because
 * of it.
 */
export type MilkingStatus = 'measured' | 'milked_not_measured' | 'not_milked';

export const MILKING_STATUSES: readonly MilkingStatus[] = [
  'measured',
  'milked_not_measured',
  'not_milked',
];

/**
 * One animal, one session, as stored.
 *
 * NOTE WHAT IS ABSENT: there is no `lactation_id`. The lactation is DERIVED at
 * read time by date range, because a lactation id is not a stable key -- see
 * events.ts's lactationIdFor and docs/REGISTRY_MILKING.md §2. The general rule
 * is that registry_lactations is a projection the rebuild drops and recreates,
 * so a permanent record must never carry a foreign key into it.
 */
export interface RegistryMilkingRow {
  id: string;
  animal_id: string;
  occurred_on: string;
  session: MilkingSession;
  status: MilkingStatus;
  /** NOT NULL exactly when status is `measured`, enforced by CHECK. */
  yield_litres: number | null;
  /** Why no milk was taken. Only ever set with `not_milked`. */
  reason: string | null;
  occurred_time: string | null;
  /** The MILKER -- who actually took it. Not the app user. */
  observed_by: string | null;
  recorded_by: string;
  recorded_at: string;
  source_form: SourceForm;
  note: string | null;
}

export type LactationEndReason = 'dry_off' | 'inferred_at_next_calving';

export interface LactationRow {
  id: string;
  animal_id: string;
  opened_by_event_id: string;
  started_on: string;
  start_precision: DatePrecision;
  ended_on: string | null;
  end_precision: DatePrecision | null;
  end_reason: LactationEndReason | null;
  closed_by_event_id: string | null;
}

export type ParentRelation = 'dam' | 'sire';
export type ParentCertainty = 'known' | 'unknown';

export interface ParentageRow {
  child_id: string;
  relation: ParentRelation;
  /** A registry animal id for an on-farm dam; free text for an outside sire. */
  parent_ref: string | null;
  certainty: ParentCertainty;
  source_event_id: string;
}

/**
 * The status projection.
 *
 * Deliberately carries NO `computed_at` column. Invariants 0 and 1 compare
 * projection row-sets across rebuilds; a wall-clock stamp would differ on every
 * run and make both invariants unfalsifiable.
 */
export interface AnimalStatusRow {
  animal_id: string;
  status: RegistryAnimalStatus;
  parity: number;
  birth_on: string | null;
  birth_precision: DatePrecision | null;
  open_lactation_id: string | null;
}

/** Everything the rebuild derives for one animal. */
export interface AnimalProjection {
  status: AnimalStatusRow;
  lactations: LactationRow[];
  parentage: ParentageRow[];
}

// ---------------------------------------------------------------------------
// Milk sales, home use and the buyer ledger (docs/REGISTRY_SALES.md)
// ---------------------------------------------------------------------------

/**
 * Where milk goes when it leaves the bulk.
 *
 * `home` is in this list because home use is a DISPOSITION, not a sale, and the
 * two ways of keeping it out of here are both worse -- see the migration 5
 * comment in schema.ts. Money is a property of the destination (`billable`),
 * not of the act.
 */
export const DESTINATION_KINDS = ['dodhi', 'household', 'shop', 'home', 'other'] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

/**
 * A destination.
 *
 * `billable` and `standing` are stored as 0/1 and normalized to booleans on the
 * way out, the same convention as the demo `Delivery.paid`.
 *
 * THE TWO FLAGS ARE INDEPENDENT and neither is derived from `kind`:
 *
 *   - `billable` -- does money follow the milk. Home is never billable, which
 *     the schema enforces.
 *   - `standing` -- must the daily sheet account for this destination in EVERY
 *     session (the dodhi, home), or is it only a row when it took something
 *     (the households, who take surplus and whose pattern varies with the
 *     season)? See REGISTRY_SALES.md §4.1a for why this exists instead of the
 *     morning/evening column it replaced.
 *
 * `started_on` / `ended_on` are an ACTIVE RANGE rather than a status flag, so
 * the sheet can open a past date and show who was buying then.
 */
export interface DestinationRow {
  id: string;
  name: string;
  kind: DestinationKind;
  billable: boolean;
  standing: boolean;
  contact: string | null;
  started_on: string;
  ended_on: string | null;
  note: string | null;
  recorded_by: string;
  recorded_at: string;
}

/**
 * One effective-dated price agreement.
 *
 * A PRICE IS TWO NUMBERS: `price_minor` (paisa) and `price_unit_litres` (the lot
 * it covers). Rs 7,000 per 40 L is `(700000, 40)`, stored as it was agreed.
 * money.ts holds the arithmetic and the reasoning.
 */
export interface DestinationPriceRow {
  id: string;
  destination_id: string;
  effective_from: string;
  price_minor: number;
  price_unit_litres: number;
  recorded_by: string;
  recorded_at: string;
  note: string | null;
}

/**
 * Milk taken, or deliberately not taken, by one destination in one session.
 *
 * THREE STATES, NOT FOUR. `registry_milkings` needs `milked_not_measured`
 * because a fabricated yield is worse than a recorded gap; a dispatch has a
 * counterparty whose money depends on the figure, so the litres IS the
 * transaction and an unmeasured one does not happen.
 */
export type DispatchStatus = 'taken' | 'none';

export const DISPATCH_STATUSES: readonly DispatchStatus[] = ['taken', 'none'];

export interface DispatchRow {
  id: string;
  destination_id: string;
  occurred_on: string;
  session: MilkingSession;
  status: DispatchStatus;
  litres: number | null;
  /** Captured at entry time, with its lot size, never looked up later. */
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

/**
 * Money received, or an adjustment.
 *
 * `adjustment` is the only signed kind and it must carry a note: a written-off
 * balance, a rounding settlement or a figure carried forward from the khata is
 * a decision somebody made, and a signed number with no sentence attached is
 * unauditable a month later.
 */
export type PaymentMethod = 'cash' | 'bank' | 'adjustment';

export const PAYMENT_METHODS: readonly PaymentMethod[] = ['cash', 'bank', 'adjustment'];

export interface PaymentRow {
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

/**
 * A whole-registry snapshot, the unit the invariant checks operate on.
 *
 * NOTE ON `milkings`, which is the one member that grows with TIME rather than
 * with herd size. Everything else here is bounded by the number of animals and
 * their life events -- tens of rows each. Milk yield is two rows per milking
 * animal per day, so it is thousands a year and it never stops.
 *
 * It is included anyway, because the alternative is making the milk invariants
 * impure and the purity of this module is what lets every rule run in CI with no
 * database. `/check` is an occasional diagnostic rather than a hot path, so the
 * cost is paid where it is affordable. If verification ever gets slow, this is
 * the member to page or to date-bound, and nothing else here needs touching.
 */
export interface RegistrySnapshot {
  animals: RegistryAnimalRow[];
  events: RegistryEvent[];
  lactations: LactationRow[];
  parentage: ParentageRow[];
  statuses: AnimalStatusRow[];
  milkings: RegistryMilkingRow[];
  /**
   * The sales tables (invariants 18-22). Like `milkings` above, `dispatches`
   * grows with time rather than with herd size -- a handful of destinations
   * twice a day -- and is included for the same reason and at the same cost.
   */
  destinations: DestinationRow[];
  prices: DestinationPriceRow[];
  dispatches: DispatchRow[];
  payments: PaymentRow[];
  nextSerial: number;
}
