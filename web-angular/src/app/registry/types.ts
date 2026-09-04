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
