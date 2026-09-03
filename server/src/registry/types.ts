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
 */
export type RegistryAnimalStatus =
  | 'departed'
  | 'calf'
  | 'lactating'
  | 'dry'
  | 'heifer'
  | 'male';

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
}

export interface DryOffPayload {
  reason?: DryOffReason | null;
  notes?: string | null;
}

export interface DeparturePayload {
  reason: DepartureReason;
  to?: string | null;
  cause?: string | null;
  notes?: string | null;
}

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
}

/** An event row with its payload parsed -- what the pure core consumes. */
export interface RegistryEvent extends Omit<RegistryEventRow, 'payload'> {
  payload: Record<string, unknown>;
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

/** A whole-registry snapshot, the unit the invariant checks operate on. */
export interface RegistrySnapshot {
  animals: RegistryAnimalRow[];
  events: RegistryEvent[];
  lactations: LactationRow[];
  parentage: ParentageRow[];
  statuses: AnimalStatusRow[];
  nextSerial: number;
}
