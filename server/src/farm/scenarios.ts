// Synthetic farm-event scenario library (Cycle 4; see docs/FARM_EVENTS.md).
//
// One module of exported consts plus a registry map, mirroring the Cycle 3
// golden dataset in server/src/agent/__tests__/scenarios.ts -- not one file per
// scenario, and not a root-level fixtures/ directory (which would fall outside
// server/tsconfig.json's rootDir: "src" and silently escape `npm run
// typecheck`).
//
// Payloads here are REAL Frigate / Double Take wire shapes, minus their
// timestamp fields: the generator stamps those from `offsetMs` in each source's
// native format (epoch float seconds for Frigate, ISO-8601 for Double Take).
// Note that face confidences below are on Double Take's native 0-100 scale,
// while the expectations are on the normalized 0..1 scale the column stores --
// that round trip is one of the things verification proves.

import type { FarmEvent, FarmEventSource } from '@dairy/shared';

// --- identities -------------------------------------------------------------

/** People enrolled for face recognition. In Cycle 7 this becomes the Double
 * Take enrollment list; here it is ground truth asserted by the fixtures, and
 * it is what `absent-employee` measures an absence against. The normalizer
 * deliberately does NOT consult this -- event_type is decided by which payload
 * array an entry came from, never by inspecting the name. */
export const ENROLLED_IDENTITIES: ReadonlySet<string> = new Set([
  'employee_1',
  'employee_2',
  'employee_3',
  'owner',
]);

// unknown_a1 is a fixed synthetic id for testing recurrence detection.
// Real Double Take does not cluster faces — see FARM_EVENTS.md §
// Known fidelity gaps. Don't assume Cycle 7's real cluster ids will be
// this stable.
export const UNKNOWN_CLUSTER_A1 = 'unknown_a1';

// --- cameras & zones --------------------------------------------------------

export const CAMERAS = {
  gate: 'gate_cam',
  barn: 'barn_cam',
  yard: 'yard_cam',
} as const;

export const ZONES = {
  gate: 'gate',
  barn: 'barn',
  yard: 'yard',
  /** Restricted after hours -- the zone night-visitor-unknown fires in. */
  feedStore: 'feed_store',
} as const;

// --- types ------------------------------------------------------------------

export interface ScenarioEvent {
  /** Milliseconds after the scenario's start instant. May exceed a day:
   * recurring-unknown-visitor spans three. */
  offsetMs: number;
  source: FarmEventSource;
  /** Real wire shape minus the timestamp field, which the generator stamps. */
  payload: Record<string, unknown>;
}

/** One expected row, matched as a multiset against what actually landed. */
export type ExpectedRow = Partial<
  Pick<FarmEvent, 'camera_id' | 'zone' | 'event_type' | 'identity' | 'confidence'>
>;

export interface ScenarioExpectation {
  rowCount: number;
  rows?: ExpectedRow[];
  /** Absence-based assertions (Decision 1: camera_offline was dropped, so a
   * dropout is asserted as silence). No row for this camera may occur strictly
   * after start + afterOffsetMs. */
  absences?: { camera_id: string; zone?: string; afterOffsetMs: number }[];
  /** Enrolled identities that must NOT appear anywhere in the scenario. Makes
   * `absent-employee`'s whole point an explicit assertion rather than an
   * implication of the row count. */
  absentIdentities?: string[];
}

export interface Scenario {
  name: string;
  description: string;
  /** 'HH:MM:SS', interpreted in the HOST's local timezone -- matching the
   * local-noon anchoring seed.ts's daysAgo() already uses. Generator and
   * verifier share that interpretation, so verification is self-consistent on
   * any machine; see FARM_EVENTS.md § Timekeeping for the caveat. */
  startTime: string;
  events: ScenarioEvent[];
  expect: ScenarioExpectation;
}

// --- payload builders (real wire shapes) ------------------------------------

/** Double Take's native confidence scale is 0-100, not 0..1. */
interface FaceSpec {
  name: string;
  confidence: number;
}

/**
 * A Frigate `frigate/events` envelope for a newly detected object.
 * `start_time` is omitted on purpose -- the generator stamps it (and
 * `before.start_time`) as epoch float seconds.
 */
function frigate(opts: {
  eventId: string;
  camera: string;
  zone?: string | null;
  label?: string;
  score: number;
  hasSnapshot?: boolean;
}): Record<string, unknown> {
  const zones = opts.zone ? [opts.zone] : [];
  const core = {
    id: opts.eventId,
    camera: opts.camera,
    label: opts.label ?? 'person',
    sub_label: null,
    false_positive: false,
    end_time: null,
    has_snapshot: opts.hasSnapshot ?? true,
    has_clip: false,
    stationary: false,
    motionless_count: 0,
    position_changes: 1,
    box: [424, 500, 536, 712],
    area: 23744,
    region: [264, 450, 667, 853],
    attributes: {},
    current_attributes: [],
  };
  return {
    type: 'new',
    // Real Frigate sends the full previous state. On a `new` event the object
    // has only just appeared and has not yet been credited to a zone.
    before: { ...core, score: opts.score, top_score: opts.score, current_zones: [], entered_zones: [] },
    after: {
      ...core,
      score: opts.score,
      top_score: opts.score,
      current_zones: zones,
      entered_zones: zones,
    },
  };
}

/**
 * A Double Take `double-take/cameras/<camera>` payload. `timestamp` is omitted
 * on purpose -- the generator stamps it as ISO-8601.
 *
 * `matches` are above Double Take's threshold, `misses` are a *named* identity
 * below it, `unknowns` are faces with no name at all.
 */
function doubleTake(opts: {
  eventId: string;
  camera: string;
  zone?: string | null;
  matches?: FaceSpec[];
  misses?: FaceSpec[];
  unknowns?: FaceSpec[];
}): Record<string, unknown> {
  const toFace = (f: FaceSpec, matched: boolean) => ({
    name: f.name,
    confidence: f.confidence,
    match: matched,
    box: { top: 286, left: 744, width: 319, height: 397 },
    type: 'latest',
    duration: 0.8,
    detector: 'compreface',
    filename: `${opts.eventId}-${f.name}.jpg`,
    base64: null,
  });
  const matches = (opts.matches ?? []).map((f) => toFace(f, true));
  const misses = (opts.misses ?? []).map((f) => toFace(f, false));
  const unknowns = (opts.unknowns ?? []).map((f) => toFace(f, false));
  return {
    id: opts.eventId,
    duration: 1.26,
    attempts: 3,
    camera: opts.camera,
    zones: opts.zone ? [opts.zone] : [],
    matches,
    misses,
    unknowns,
    counts: {
      person: matches.length + misses.length + unknowns.length,
      match: matches.length,
      miss: misses.length,
      unknown: unknowns.length,
    },
  };
}

const MINUTE = 60_000;
const DAY = 86_400_000;

// --- scenarios --------------------------------------------------------------

/** Baseline: enrolled employees arriving on schedule, plus routine yard
 * activity with no face attached. Nothing anomalous. */
export const NORMAL_WEEKDAY: Scenario = {
  name: 'normal-weekday',
  description: 'Employees arriving on schedule; routine zone activity, nothing flagged',
  startTime: '05:30:00',
  events: [
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-nw-1', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.93 }) },
    { offsetMs: 2_000, source: 'double_take', payload: doubleTake({ eventId: 'evt-nw-1', camera: CAMERAS.gate, zone: ZONES.gate, matches: [{ name: 'employee_1', confidence: 94.2 }] }) },
    { offsetMs: 10 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-nw-2', camera: CAMERAS.barn, zone: ZONES.barn, score: 0.88 }) },
    { offsetMs: 10 * MINUTE + 2_000, source: 'double_take', payload: doubleTake({ eventId: 'evt-nw-2', camera: CAMERAS.barn, zone: ZONES.barn, matches: [{ name: 'employee_2', confidence: 91 }] }) },
    { offsetMs: 30 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-nw-3', camera: CAMERAS.yard, zone: ZONES.yard, score: 0.76 }) },
  ],
  expect: {
    rowCount: 5,
    rows: [
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.93 },
      { event_type: 'face_match', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: 'employee_1', confidence: 0.942 },
      { event_type: 'detection', camera_id: CAMERAS.barn, zone: ZONES.barn, identity: null, confidence: 0.88 },
      { event_type: 'face_match', camera_id: CAMERAS.barn, zone: ZONES.barn, identity: 'employee_2', confidence: 0.91 },
      { event_type: 'detection', camera_id: CAMERAS.yard, zone: ZONES.yard, identity: null, confidence: 0.76 },
    ],
  },
};

/** employee_3 is enrolled but never shows up. Nothing here is anomalous at the
 * row level -- the absence is the signal, and reconciling it against a roster
 * is Cycle 5's job. */
export const ABSENT_EMPLOYEE: Scenario = {
  name: 'absent-employee',
  description: 'An expected enrolled identity never appears; sets up Cycle 5 reconciliation',
  startTime: '05:30:00',
  events: [
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-ae-1', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.91 }) },
    { offsetMs: 2_000, source: 'double_take', payload: doubleTake({ eventId: 'evt-ae-1', camera: CAMERAS.gate, zone: ZONES.gate, matches: [{ name: 'employee_1', confidence: 93.5 }] }) },
    { offsetMs: 10 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-ae-2', camera: CAMERAS.barn, zone: ZONES.barn, score: 0.87 }) },
    { offsetMs: 10 * MINUTE + 2_000, source: 'double_take', payload: doubleTake({ eventId: 'evt-ae-2', camera: CAMERAS.barn, zone: ZONES.barn, matches: [{ name: 'employee_2', confidence: 90.1 }] }) },
  ],
  expect: {
    rowCount: 4,
    rows: [
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.91 },
      { event_type: 'face_match', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: 'employee_1', confidence: 0.935 },
      { event_type: 'detection', camera_id: CAMERAS.barn, zone: ZONES.barn, identity: null, confidence: 0.87 },
      { event_type: 'face_match', camera_id: CAMERAS.barn, zone: ZONES.barn, identity: 'employee_2', confidence: 0.901 },
    ],
    absentIdentities: ['employee_3'],
  },
};

/** An unrecognized face in a restricted zone, off-hours, lingering long enough
 * to produce a second detection. */
export const NIGHT_VISITOR_UNKNOWN: Scenario = {
  name: 'night-visitor-unknown',
  description: 'Unrecognized face in a restricted zone, off-hours',
  startTime: '02:14:00',
  events: [
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-nv-1', camera: CAMERAS.yard, zone: ZONES.feedStore, score: 0.81 }) },
    { offsetMs: 3_000, source: 'double_take', payload: doubleTake({ eventId: 'evt-nv-1', camera: CAMERAS.yard, zone: ZONES.feedStore, unknowns: [{ name: UNKNOWN_CLUSTER_A1, confidence: 8.4 }] }) },
    { offsetMs: 45_000, source: 'frigate', payload: frigate({ eventId: 'evt-nv-2', camera: CAMERAS.yard, zone: ZONES.feedStore, score: 0.79 }) },
  ],
  expect: {
    rowCount: 3,
    rows: [
      { event_type: 'detection', camera_id: CAMERAS.yard, zone: ZONES.feedStore, identity: null, confidence: 0.81 },
      { event_type: 'unknown_cluster', camera_id: CAMERAS.yard, zone: ZONES.feedStore, identity: UNKNOWN_CLUSTER_A1, confidence: 0.084 },
      { event_type: 'detection', camera_id: CAMERAS.yard, zone: ZONES.feedStore, identity: null, confidence: 0.79 },
    ],
  },
};

/**
 * The same cluster id on three consecutive backdated nights. Requires
 * `--days-ago` >= 3 or the generator's future-date guard fires.
 *
 * The unchanging id is a deliberate simplification, NOT a fidelity claim: real
 * Double Take does not cluster faces at all. See FARM_EVENTS.md § Known
 * fidelity gaps before building anything on top of it.
 */
export const RECURRING_UNKNOWN_VISITOR: Scenario = {
  name: 'recurring-unknown-visitor',
  description: 'The same unlabeled cluster id reappearing across three backdated days',
  startTime: '01:40:00',
  events: [
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-ru-d0', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.84 }) },
    { offsetMs: 2_500, source: 'double_take', payload: doubleTake({ eventId: 'evt-ru-d0', camera: CAMERAS.gate, zone: ZONES.gate, unknowns: [{ name: UNKNOWN_CLUSTER_A1, confidence: 9.1 }] }) },
    { offsetMs: DAY, source: 'frigate', payload: frigate({ eventId: 'evt-ru-d1', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.86 }) },
    { offsetMs: DAY + 2_500, source: 'double_take', payload: doubleTake({ eventId: 'evt-ru-d1', camera: CAMERAS.gate, zone: ZONES.gate, unknowns: [{ name: UNKNOWN_CLUSTER_A1, confidence: 7.7 }] }) },
    { offsetMs: 2 * DAY, source: 'frigate', payload: frigate({ eventId: 'evt-ru-d2', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.83 }) },
    { offsetMs: 2 * DAY + 2_500, source: 'double_take', payload: doubleTake({ eventId: 'evt-ru-d2', camera: CAMERAS.gate, zone: ZONES.gate, unknowns: [{ name: UNKNOWN_CLUSTER_A1, confidence: 10.4 }] }) },
  ],
  expect: {
    rowCount: 6,
    rows: [
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.84 },
      { event_type: 'unknown_cluster', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: UNKNOWN_CLUSTER_A1, confidence: 0.091 },
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.86 },
      { event_type: 'unknown_cluster', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: UNKNOWN_CLUSTER_A1, confidence: 0.077 },
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.83 },
      { event_type: 'unknown_cluster', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: UNKNOWN_CLUSTER_A1, confidence: 0.104 },
    ],
  },
};

/**
 * barn_cam goes silent five minutes in while gate_cam keeps reporting. Purely
 * infra-level: there is no camera_offline row to find, because neither Frigate
 * nor Double Take emits one (Decision 1). The control camera matters -- without
 * it, "no barn rows" would also be satisfied by ingestion being broken.
 */
export const CAMERA_DROPOUT: Scenario = {
  name: 'camera-dropout',
  description: 'One camera goes silent mid-scenario while a control camera keeps reporting',
  startTime: '06:00:00',
  events: [
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-cd-b0', camera: CAMERAS.barn, zone: ZONES.barn, score: 0.88 }) },
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-cd-g0', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.9 }) },
    { offsetMs: 5 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-cd-b1', camera: CAMERAS.barn, zone: ZONES.barn, score: 0.86 }) },
    { offsetMs: 5 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-cd-g1', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.87 }) },
    // barn_cam produces nothing from here on -- that silence IS the scenario.
    { offsetMs: 15 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-cd-g2', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.85 }) },
    { offsetMs: 25 * MINUTE, source: 'frigate', payload: frigate({ eventId: 'evt-cd-g3', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.89 }) },
  ],
  expect: {
    rowCount: 6,
    rows: [
      { event_type: 'detection', camera_id: CAMERAS.barn, zone: ZONES.barn, identity: null, confidence: 0.88 },
      { event_type: 'detection', camera_id: CAMERAS.barn, zone: ZONES.barn, identity: null, confidence: 0.86 },
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.9 },
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.87 },
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.85 },
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.89 },
    ],
    absences: [{ camera_id: CAMERAS.barn, zone: ZONES.barn, afterOffsetMs: 5 * MINUTE }],
  },
};

/**
 * A Double Take `misses` entry: a named, enrolled identity that fell below the
 * recognition threshold. It lands as a `face_match` row with a low confidence
 * -- `face_match` does not mean "confident match", and deciding what to do
 * about 0.386 is Cycle 5's problem, not the schema's.
 */
export const LOW_CONFIDENCE_MATCH: Scenario = {
  name: 'low-confidence-match',
  description: 'A face match well below threshold; exercises hedging, not certainty',
  startTime: '19:20:00',
  events: [
    { offsetMs: 0, source: 'frigate', payload: frigate({ eventId: 'evt-lc-1', camera: CAMERAS.gate, zone: ZONES.gate, score: 0.72 }) },
    { offsetMs: 2_500, source: 'double_take', payload: doubleTake({ eventId: 'evt-lc-1', camera: CAMERAS.gate, zone: ZONES.gate, misses: [{ name: 'employee_2', confidence: 38.6 }] }) },
  ],
  expect: {
    rowCount: 2,
    rows: [
      { event_type: 'detection', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: null, confidence: 0.72 },
      { event_type: 'face_match', camera_id: CAMERAS.gate, zone: ZONES.gate, identity: 'employee_2', confidence: 0.386 },
    ],
  },
};

// --- registry ---------------------------------------------------------------

export const SCENARIOS: Record<string, Scenario> = {
  [NORMAL_WEEKDAY.name]: NORMAL_WEEKDAY,
  [ABSENT_EMPLOYEE.name]: ABSENT_EMPLOYEE,
  [NIGHT_VISITOR_UNKNOWN.name]: NIGHT_VISITOR_UNKNOWN,
  [RECURRING_UNKNOWN_VISITOR.name]: RECURRING_UNKNOWN_VISITOR,
  [CAMERA_DROPOUT.name]: CAMERA_DROPOUT,
  [LOW_CONFIDENCE_MATCH.name]: LOW_CONFIDENCE_MATCH,
};

/** Registry order, which is also the order `--all` replays and verifies. */
export const SCENARIO_NAMES: string[] = Object.keys(SCENARIOS);

/** Largest offset any scenario reaches, in whole days -- the minimum
 * `--days-ago` that keeps every event in the past. */
export function scenarioSpanDays(s: Scenario): number {
  const maxOffset = s.events.reduce((m, e) => Math.max(m, e.offsetMs), 0);
  return Math.ceil(maxOffset / DAY);
}
