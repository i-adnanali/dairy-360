// Farm monitor write tools (Cycle 5; see docs/FARM_MONITOR.md Decision 6).
//
// This is the HUMAN-APPROVAL half of the split write path. flag_anomaly is a
// registered WRITE_EXECUTOR, so stream.ts builds a confirmation card, pauses
// the run, and writes nothing until the user approves -- the same contract the
// vendor write executors follow.
//
// The AUTOMATIC half never comes through here: classifyEvent() calls
// setFarmEventFlag() in db.ts directly, because a pass over a day's rows must
// not raise a card per row. Two entry points, one UPDATE statement.

import type { FarmFlagSeverity, PendingWrite } from '@dairy/shared';
import { getFarmEventById, setFarmEventFlag } from '../db';
import { farmLocalParts } from '../farm/classify';
import type { ToolSchema } from './index';
import type { WriteExecutor } from './writes';

/** Human-readable label for a farm event, for the confirmation card. */
function eventLabel(eventId: string): string {
  const e = getFarmEventById(eventId);
  if (!e) return eventId;
  const { date, minutes } = farmLocalParts(e.occurred_at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  const time = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  const who = e.identity ? ` — ${e.identity}` : '';
  return `${e.event_type} on ${e.camera_id}${e.zone ? ` (${e.zone})` : ''} at ${date} ${time}${who}`;
}

const SEVERITIES: ReadonlySet<string> = new Set<FarmFlagSeverity>(['notable', 'urgent']);

// --- flag_anomaly -----------------------------------------------------------
// Manual override for something the automatic pass missed, or a correction to
// its severity. Last-write-wins: there is no flag history and no unflagging in
// this cycle (FARM_MONITOR.md § What we're NOT doing), so re-flagging the same
// event simply overwrites the previous verdict.
const flagAnomaly: WriteExecutor = {
  execute(args) {
    const eventId = String(args.event_id ?? '');
    const severity = String(args.severity ?? '');
    // guardIds already rejects an unknown event_id before execute; this is the
    // same defensive backstop recordDelivery keeps against a bad vendor.
    if (!getFarmEventById(eventId)) throw new Error(`unknown farm event: ${eventId}`);
    if (!SEVERITIES.has(severity)) {
      throw new Error(`severity must be 'notable' or 'urgent', got: ${severity}`);
    }
    const reason = String(args.reason ?? '').trim();
    if (!reason) throw new Error('reason is required');

    const changes = setFarmEventFlag({
      id: eventId,
      severity: severity as FarmFlagSeverity,
      reason,
      classifiedAt: new Date().toISOString(),
    });
    return { updated: changes, event_id: eventId, severity, reason };
  },
  buildCard(toolUseId, args) {
    const eventId = String(args.event_id ?? '');
    const severity = String(args.severity ?? '');
    return {
      toolUseId,
      toolName: 'flag_anomaly',
      summary: `Flag ${eventLabel(eventId)} as ${severity}`,
      details: [
        { label: 'Event', value: eventId },
        { label: 'What', value: eventLabel(eventId) },
        { label: 'Severity', value: severity },
        { label: 'Reason', value: String(args.reason ?? '-') },
      ],
    } satisfies PendingWrite;
  },
};

// Schema colocated with its executor, following reconcile.ts (the most recent
// precedent) rather than the older split that keeps vendor schemas in index.ts.
export const FARM_WRITE_TOOLS: ToolSchema[] = [
  {
    name: 'flag_anomaly',
    description:
      'Manually flag one farm event as notable or urgent, with a reason. Confirmation-gated; the system shows a card and writes nothing until the user approves -- do not ask "shall I?" in text, just call with complete arguments. Use to flag something the automatic classification missed, or to correct its severity. Last-write-wins: this overwrites any previous verdict on that event, and there is no way to unflag.',
    input_schema: {
      type: 'object',
      required: ['event_id', 'severity', 'reason'],
      properties: {
        event_id: { type: 'string', description: 'A farm_events id (farm_event_<hex>)' },
        severity: { type: 'string', enum: ['notable', 'urgent'] },
        reason: { type: 'string', description: 'Why this event warrants attention' },
      },
    },
  },
];

export const FARM_WRITE_EXECUTORS: Record<string, WriteExecutor> = {
  flag_anomaly: flagAnomaly,
};
