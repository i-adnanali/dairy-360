// Farm monitor read tools (Cycle 5; see docs/FARM_MONITOR.md Decision 6).
//
// Both tools return STRUCTURED findings in a modelDigest and nothing else --
// no prose, no Anthropic SDK call. That is not a style preference: runReads()
// in agent/stream.ts executes read tools SYNCHRONOUSLY, so an executor
// physically cannot await a model call. Narration is instructed instead, in
// systemPrompt.ts's farmSection(), exactly the way get_yield_vs_deliveries
// leaves "explain the likely causes" to reconcileSection().

import type { FarmEvent, ReadToolResult, ToolError } from '@dairy/shared';
import { farmEventsInRange } from '../db';
import {
  CAMERA_SILENCE_MINUTES,
  FARM_TZ,
  farmDayBoundsUtc,
  farmLocalParts,
} from '../farm/classify';
import { classifyEvents } from '../farm/classifyStore';
import { ENROLLED_IDENTITIES } from '../farm/scenarios';
import type { ToolSchema } from './index';

type Args = Record<string, unknown>;

/** Cap on rows returned to the model, mirroring search_animals' tooMany flag.
 * Real cameras produce orders of magnitude more rows than the herd does
 * (FARM_EVENTS.md § Open items), so this tool never streams a whole day. */
const MAX_ROWS = 50;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Compact per-row shape for the model: raw_payload and snapshot_ref are
 * deliberately withheld -- a 2 KB payload per row would blow the digest. */
function compact(e: FarmEvent): Record<string, unknown> {
  const { date, minutes } = farmLocalParts(e.occurred_at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    id: e.id,
    occurred_at: e.occurred_at,
    // Farm-local wall time alongside the UTC instant: the model reasons about
    // "night" in the farm's terms, and occurred_at alone reads as 5 hours off.
    farm_local_time: `${date} ${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
    camera_id: e.camera_id,
    zone: e.zone,
    event_type: e.event_type,
    identity: e.identity,
    confidence: e.confidence,
    classified_at: e.classified_at,
    flagged: e.flagged,
    flag_severity: e.flag_severity,
    flag_reason: e.flag_reason,
  };
}

// --- get_farm_events --------------------------------------------------------
// Reads farm_events over an inclusive range of FARM-LOCAL dates. No
// classification side effect: this tool answers "what was seen", never "what
// does it mean".
export function getFarmEvents(args: Args): ReadToolResult {
  const start = String(args.start ?? '');
  const end = String(args.end ?? '');
  if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
    return {
      modelDigest: {
        error: 'missing_range',
        message: 'Both start and end (YYYY-MM-DD, farm-local) are required.',
      } satisfies ToolError,
    };
  }
  if (start > end) {
    return {
      modelDigest: {
        error: 'invalid_range',
        message: `start ${start} is after end ${end}.`,
      } satisfies ToolError,
    };
  }

  const zone = typeof args.zone === 'string' && args.zone ? args.zone : undefined;
  const identity =
    typeof args.identity === 'string' && args.identity ? args.identity : undefined;

  // Inclusive of both dates, following the from/to convention of
  // get_deliveries and get_milk_yield: take start's opening midnight through
  // end's CLOSING midnight, which is the next day's opening instant.
  const { startIso } = farmDayBoundsUtc(start);
  const { endIso } = farmDayBoundsUtc(end);

  const rows = farmEventsInRange({ startIso, endIso, zone, identity });
  const truncated = rows.length > MAX_ROWS;

  const byType: Record<string, number> = {};
  const byCamera: Record<string, number> = {};
  for (const r of rows) {
    byType[r.event_type] = (byType[r.event_type] ?? 0) + 1;
    byCamera[r.camera_id] = (byCamera[r.camera_id] ?? 0) + 1;
  }

  return {
    modelDigest: {
      start,
      end,
      farm_tz: FARM_TZ,
      count: rows.length,
      byEventType: byType,
      byCamera,
      flaggedCount: rows.filter((r) => r.flagged).length,
      unclassifiedCount: rows.filter((r) => r.classified_at === null).length,
      tooMany: truncated,
      events: rows.slice(0, MAX_ROWS).map(compact),
    },
  };
}

// --- summarize_daily_activity -----------------------------------------------

export interface CameraFinding {
  camera_id: string;
  events: number;
  first_seen: string;
  last_seen: string;
  /** Minutes from this camera's last event to the last event on ANY camera. */
  silence_minutes: number;
  silence_flagged: boolean;
  /** Did another camera keep reporting after this one's last event? Without
   * that, "no rows" is equally explained by ingestion being broken -- the same
   * control-camera condition verify.ts asserts for camera-dropout. */
  control_active: boolean;
}

/** Longest trailing silence per camera, measured against the day's last event
 * on any camera. See FARM_MONITOR.md: Cycle 4 documents that a dropout is
 * indistinguishable from a genuinely quiet camera until a watchdog exists, so
 * this reports the gap as DATA and leaves the reading to the model. */
export function cameraFindings(rows: FarmEvent[]): CameraFinding[] {
  if (rows.length === 0) return [];
  const lastOverall = rows.reduce(
    (m, r) => (r.occurred_at > m ? r.occurred_at : m),
    rows[0].occurred_at,
  );

  const byCamera = new Map<string, FarmEvent[]>();
  for (const r of rows) {
    const list = byCamera.get(r.camera_id);
    if (list) list.push(r);
    else byCamera.set(r.camera_id, [r]);
  }

  const findings: CameraFinding[] = [];
  for (const [camera_id, list] of byCamera) {
    const sorted = [...list].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    const lastSeen = sorted[sorted.length - 1].occurred_at;
    const silenceMs = new Date(lastOverall).getTime() - new Date(lastSeen).getTime();
    const silenceMinutes = Math.round(silenceMs / 60_000);
    findings.push({
      camera_id,
      events: sorted.length,
      first_seen: sorted[0].occurred_at,
      last_seen: lastSeen,
      silence_minutes: silenceMinutes,
      silence_flagged: silenceMinutes >= CAMERA_SILENCE_MINUTES,
      control_active: rows.some(
        (r) => r.camera_id !== camera_id && r.occurred_at > lastSeen,
      ),
    });
  }
  return findings.sort((a, b) => a.camera_id.localeCompare(b.camera_id));
}

/** Enrolled identities that never appear in the window -- the absent-employee
 * signal. Measured against ENROLLED_IDENTITIES, which scenarios.ts owns as
 * ground truth and which becomes the Double Take enrollment list in Cycle 7. */
export function attendanceFindings(rows: FarmEvent[]): {
  enrolled: string[];
  seen: string[];
  absent: string[];
} {
  const enrolled = [...ENROLLED_IDENTITIES].sort();
  const seenSet = new Set(
    rows.filter((r) => r.identity && ENROLLED_IDENTITIES.has(r.identity)).map((r) => r.identity as string),
  );
  const seen = [...seenSet].sort();
  return { enrolled, seen, absent: enrolled.filter((id) => !seenSet.has(id)) };
}

/**
 * Classify the day's unclassified rows, then reconcile across the whole day.
 *
 * Two passes over the same window on purpose: rows are classified first so the
 * flag counts and the flagged list below reflect this run rather than whatever
 * a previous run left behind.
 */
export function summarizeDailyActivity(args: Args): ReadToolResult {
  const date = String(args.date ?? '');
  if (!ISO_DATE.test(date)) {
    return {
      modelDigest: {
        error: 'missing_date',
        message: 'date (YYYY-MM-DD, farm-local) is required.',
      } satisfies ToolError,
    };
  }

  const { startIso, endIso } = farmDayBoundsUtc(date);
  const before = farmEventsInRange({ startIso, endIso });

  if (before.length === 0) {
    return {
      modelDigest: {
        date,
        farm_tz: FARM_TZ,
        events_examined: 0,
        newly_classified: 0,
        severities: { routine: 0, notable: 0, urgent: 0 },
        flagged: [],
        attendance: attendanceFindings([]),
        cameras: [],
        silence_threshold_minutes: CAMERA_SILENCE_MINUTES,
        note: 'No farm events recorded on this date.',
      },
    };
  }

  // Only the unexamined rows are (re)classified. Re-running for the same date
  // is deterministic given the same data, so this is a cost saving rather than
  // a correctness fix (FARM_MONITOR.md § Open items).
  const unclassified = before.filter((r) => r.classified_at === null);
  classifyEvents(unclassified);

  // Re-read so severities reflect what is now persisted.
  const rows = farmEventsInRange({ startIso, endIso });
  const severities = { routine: 0, notable: 0, urgent: 0 };
  for (const r of rows) {
    if (r.flag_severity === 'urgent') severities.urgent += 1;
    else if (r.flag_severity === 'notable') severities.notable += 1;
    else severities.routine += 1;
  }

  return {
    modelDigest: {
      date,
      farm_tz: FARM_TZ,
      events_examined: rows.length,
      newly_classified: unclassified.length,
      severities,
      flagged: rows.filter((r) => r.flagged).map(compact),
      attendance: attendanceFindings(rows),
      cameras: cameraFindings(rows),
      silence_threshold_minutes: CAMERA_SILENCE_MINUTES,
    },
  };
}

// --- schemas ----------------------------------------------------------------

export const FARM_READ_TOOLS: ToolSchema[] = [
  {
    name: 'get_farm_events',
    description:
      'Camera events (Frigate detections, Double Take face matches, unknown face clusters) over an inclusive range of farm-local dates, optionally filtered by zone or identity. Returns counts by event type and camera plus up to 50 rows with their classification state; tooMany is true when truncated. Read-only: it never classifies or flags anything. Use for "who was at the gate yesterday", "show me unknown faces last week".',
    input_schema: {
      type: 'object',
      required: ['start', 'end'],
      properties: {
        start: { type: 'string', description: 'ISO date YYYY-MM-DD, farm-local' },
        end: { type: 'string', description: 'ISO date YYYY-MM-DD, farm-local' },
        zone: { type: 'string', description: "e.g. 'gate', 'barn', 'yard', 'feed_store'" },
        identity: {
          type: 'string',
          description: "An enrolled name (e.g. 'employee_1') or an unknown cluster id",
        },
      },
    },
  },
  {
    name: 'summarize_daily_activity',
    description:
      "Classify and reconcile one farm-local day's camera events. Classifies any not-yet-examined rows, then returns severity counts (routine/notable/urgent), the flagged rows with the rule that fired, attendance (which enrolled people appeared and which are absent), and per-camera activity with trailing-silence minutes. A camera with silence_flagged true and control_active true went quiet while others kept reporting -- a possible dropout, though a genuinely quiet camera looks the same. Use for \"anything unusual today\", \"who was in today\", \"is any camera down\".",
    input_schema: {
      type: 'object',
      required: ['date'],
      properties: {
        date: { type: 'string', description: 'ISO date YYYY-MM-DD, farm-local' },
      },
    },
  },
];

export const FARM_READ_EXECUTORS: Record<string, (args: Args) => ReadToolResult> = {
  get_farm_events: getFarmEvents,
  summarize_daily_activity: summarizeDailyActivity,
};
