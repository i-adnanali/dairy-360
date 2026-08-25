// Expected CLASSIFICATION outcomes per scenario (Cycle 5; see
// docs/FARM_MONITOR.md Decision 7).
//
// Deliberately a separate module from scenarios.ts, which stays ingestion-only
// truth: that file answers "what rows land", this one answers "what do they
// mean". Same registry-map shape, keyed by the same scenario names.
//
// Severities and reasons are written out LONGHAND rather than derived by
// calling scoreEvent(), which would make the assertion circular -- it would
// prove only that the implementation agrees with itself. The duplication with
// scenarios.ts's expect.rows is the price of an independent check, and is the
// point.

import type { FarmEventSeverity, FarmEventType } from '@dairy/shared';
import { RULE } from './classify';
import { CAMERAS, UNKNOWN_CLUSTER_A1, ZONES } from './scenarios';

/** One expected row, matched as a MULTISET against what actually landed --
 * same reasoning as verify.ts's diffRows: rows from a single Double Take POST
 * share an occurred_at and carry random primary keys, so their relative order
 * is not deterministic and asserting on it would test SQLite's tie-breaking. */
export interface ExpectedSeverityRow {
  event_type: FarmEventType;
  camera_id: string;
  zone: string | null;
  identity: string | null;
  confidence: number | null;
  severity: FarmEventSeverity;
  /** The rule that fired. `null` for routine rows, which carry no reason. */
  reason: string | null;
}

export interface ExpectedCamera {
  camera_id: string;
  events: number;
  silence_flagged: boolean;
  control_active: boolean;
}

export interface ClassifyExpectation {
  /** Farm-local days the scenario spans, each summarized in ascending order.
   * Only recurring-unknown-visitor exceeds 1. */
  days: number;
  severities: { routine: number; notable: number; urgent: number };
  rows: ExpectedSeverityRow[];
  /**
   * Enrolled identities that must appear in attendance.absent.
   *
   * Note `owner` is absent from EVERY scenario -- no fixture ever produces an
   * owner sighting -- and employee_3 is absent from all but none. So this list
   * is the honest full set, not just the one identity absent-employee is named
   * for. absent-employee's distinction is that it is the scenario BUILT around
   * the gap, and its scenarios.ts absentIdentities declares employee_3
   * explicitly; the reconciliation surfaces both.
   */
  absentIdentities: string[];
  /** Per-camera findings that must hold on EVERY summarized day. */
  cameras: ExpectedCamera[];
}

// --- row helpers ------------------------------------------------------------

const routine = (
  event_type: FarmEventType,
  camera_id: string,
  zone: string | null,
  identity: string | null,
  confidence: number | null,
): ExpectedSeverityRow => ({
  event_type,
  camera_id,
  zone,
  identity,
  confidence,
  severity: 'routine',
  reason: null,
});

const flagged = (
  event_type: FarmEventType,
  camera_id: string,
  zone: string | null,
  identity: string | null,
  confidence: number | null,
  severity: 'notable' | 'urgent',
  reason: string,
): ExpectedSeverityRow => ({
  event_type,
  camera_id,
  zone,
  identity,
  confidence,
  severity,
  reason,
});

const ALL_ENROLLED = ['employee_1', 'employee_2', 'employee_3', 'owner'];

// --- expectations -----------------------------------------------------------

/** Baseline: nothing flagged. The two silence findings are NOT a defect --
 * see the note on CAMERA_SILENCE_MINUTES in FARM_MONITOR.md § Open items.
 * gate_cam and barn_cam each catch one moment early in a 30-minute window and
 * are quiet afterwards, which absence-based detection cannot tell apart from a
 * dropout. Recorded here as observed truth rather than hidden. */
const NORMAL_WEEKDAY: ClassifyExpectation = {
  days: 1,
  severities: { routine: 5, notable: 0, urgent: 0 },
  rows: [
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.93),
    routine('face_match', CAMERAS.gate, ZONES.gate, 'employee_1', 0.942),
    routine('detection', CAMERAS.barn, ZONES.barn, null, 0.88),
    routine('face_match', CAMERAS.barn, ZONES.barn, 'employee_2', 0.91),
    routine('detection', CAMERAS.yard, ZONES.yard, null, 0.76),
  ],
  absentIdentities: ['employee_3', 'owner'],
  cameras: [
    { camera_id: CAMERAS.barn, events: 2, silence_flagged: true, control_active: true },
    { camera_id: CAMERAS.gate, events: 2, silence_flagged: true, control_active: true },
    { camera_id: CAMERAS.yard, events: 1, silence_flagged: false, control_active: false },
  ],
};

/** The absence is the whole signal: no row is flagged, and employee_3 surfaces
 * only through reconciliation (DoD #4). */
const ABSENT_EMPLOYEE: ClassifyExpectation = {
  days: 1,
  severities: { routine: 4, notable: 0, urgent: 0 },
  rows: [
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.91),
    routine('face_match', CAMERAS.gate, ZONES.gate, 'employee_1', 0.935),
    routine('detection', CAMERAS.barn, ZONES.barn, null, 0.87),
    routine('face_match', CAMERAS.barn, ZONES.barn, 'employee_2', 0.901),
  ],
  absentIdentities: ['employee_3', 'owner'],
  cameras: [
    { camera_id: CAMERAS.barn, events: 2, silence_flagged: false, control_active: false },
    { camera_id: CAMERAS.gate, events: 2, silence_flagged: false, control_active: true },
  ],
};

/** Rule 1, and rule 1 applying to EVERY event_type: all three rows flag
 * urgent, including the two detections with no identity at all. A person in
 * the feed store at 02:14 is the anomaly whether or not a face resolved. */
const NIGHT_VISITOR_UNKNOWN: ClassifyExpectation = {
  days: 1,
  severities: { routine: 0, notable: 0, urgent: 3 },
  rows: [
    flagged('detection', CAMERAS.yard, ZONES.feedStore, null, 0.81, 'urgent', RULE.RESTRICTED_OFF_HOURS),
    flagged(
      'unknown_cluster',
      CAMERAS.yard,
      ZONES.feedStore,
      UNKNOWN_CLUSTER_A1,
      0.084,
      'urgent',
      RULE.RESTRICTED_OFF_HOURS,
    ),
    flagged('detection', CAMERAS.yard, ZONES.feedStore, null, 0.79, 'urgent', RULE.RESTRICTED_OFF_HOURS),
  ],
  absentIdentities: ALL_ENROLLED,
  cameras: [
    { camera_id: CAMERAS.yard, events: 3, silence_flagged: false, control_active: false },
  ],
};

/** The gradient rule 2 exists to produce: notable at occurrence 1, still
 * notable at 2, urgent by 3. The three detections stay routine -- `gate` is
 * deliberately not a restricted zone, which is what leaves room for the
 * gradient (see RESTRICTED_ZONES). Spans three farm-local days. */
const RECURRING_UNKNOWN_VISITOR: ClassifyExpectation = {
  days: 3,
  severities: { routine: 3, notable: 2, urgent: 1 },
  rows: [
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.84),
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.86),
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.83),
    flagged(
      'unknown_cluster',
      CAMERAS.gate,
      ZONES.gate,
      UNKNOWN_CLUSTER_A1,
      0.091,
      'notable',
      RULE.RECURRING_UNKNOWN,
    ),
    flagged(
      'unknown_cluster',
      CAMERAS.gate,
      ZONES.gate,
      UNKNOWN_CLUSTER_A1,
      0.077,
      'notable',
      RULE.RECURRING_UNKNOWN,
    ),
    flagged(
      'unknown_cluster',
      CAMERAS.gate,
      ZONES.gate,
      UNKNOWN_CLUSTER_A1,
      0.104,
      'urgent',
      RULE.RECURRING_UNKNOWN,
    ),
  ],
  absentIdentities: ALL_ENROLLED,
  cameras: [
    // Each of the three days carries one detection + one cluster on gate_cam,
    // so every day looks identical and nothing is ever the last camera
    // standing.
    { camera_id: CAMERAS.gate, events: 2, silence_flagged: false, control_active: false },
  ],
};

/** Infra-level: no row is flagged, and barn_cam's dropout surfaces only as a
 * silence gap with a control camera still reporting (DoD #5). */
const CAMERA_DROPOUT: ClassifyExpectation = {
  days: 1,
  severities: { routine: 6, notable: 0, urgent: 0 },
  rows: [
    routine('detection', CAMERAS.barn, ZONES.barn, null, 0.88),
    routine('detection', CAMERAS.barn, ZONES.barn, null, 0.86),
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.9),
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.87),
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.85),
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.89),
  ],
  absentIdentities: ALL_ENROLLED,
  cameras: [
    { camera_id: CAMERAS.barn, events: 2, silence_flagged: true, control_active: true },
    { camera_id: CAMERAS.gate, events: 4, silence_flagged: false, control_active: false },
  ],
};

/** Rule 3, and the gating that keeps rule 3 off detection rows: the 0.386 face
 * match is notable, the 0.72 detection beside it stays routine even though
 * 0.72 is also below MATCH_CONFIDENT. 19:20 is inside WORK_HOURS, so nothing
 * here is off-hours. */
const LOW_CONFIDENCE_MATCH: ClassifyExpectation = {
  days: 1,
  severities: { routine: 1, notable: 1, urgent: 0 },
  rows: [
    routine('detection', CAMERAS.gate, ZONES.gate, null, 0.72),
    flagged(
      'face_match',
      CAMERAS.gate,
      ZONES.gate,
      'employee_2',
      0.386,
      'notable',
      RULE.LOW_CONFIDENCE_MATCH,
    ),
  ],
  absentIdentities: ['employee_1', 'employee_3', 'owner'],
  cameras: [
    { camera_id: CAMERAS.gate, events: 2, silence_flagged: false, control_active: false },
  ],
};

// --- registry ---------------------------------------------------------------

/** Keyed by the same names scenarios.ts registers, so a rename there breaks
 * here loudly rather than silently skipping a scenario. */
export const CLASSIFY_EXPECTATIONS: Record<string, ClassifyExpectation> = {
  'normal-weekday': NORMAL_WEEKDAY,
  'absent-employee': ABSENT_EMPLOYEE,
  'night-visitor-unknown': NIGHT_VISITOR_UNKNOWN,
  'recurring-unknown-visitor': RECURRING_UNKNOWN_VISITOR,
  'camera-dropout': CAMERA_DROPOUT,
  'low-confidence-match': LOW_CONFIDENCE_MATCH,
};
