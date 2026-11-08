// Synthetic farm events for the registry harness, so the Farm Monitor screen
// has something to show without cameras or dairy.db. Every row is marked
// is_synthetic and the route reports `synthetic: true`. Times are generated
// relative to "now" so "overnight" always has events in it.
//
// Never import ../db here (see registry/harness.ts).

import type { FarmEventView } from './monitorRoutes';

export function syntheticFarmEvents(now = new Date()): FarmEventView[] {
  // Anchor on 01:10 farm time (UTC+5) of the most recent night.
  const farmNow = new Date(now.getTime() + 5 * 3600_000);
  const night = Date.UTC(farmNow.getUTCFullYear(), farmNow.getUTCMonth(), farmNow.getUTCDate(), 1, 10) - 5 * 3600_000;
  const anchor = night > now.getTime() ? night - 24 * 3600_000 : night;
  const at = (minutes: number) => new Date(anchor + minutes * 60_000).toISOString();
  const base = {
    source: 'frigate' as const,
    source_event_id: null,
    is_synthetic: true,
    snapshot_ref: null,
    classified_at: at(2),
  };
  const row = (
    id: string,
    minutes: number,
    camera_id: string,
    zone: string | null,
    event_type: FarmEventView['event_type'],
    identity: string | null,
    confidence: number | null,
    severity: 'notable' | 'urgent' | null,
    reason: string | null,
  ): FarmEventView => ({
    ...base,
    id,
    camera_id,
    zone,
    event_type,
    identity,
    confidence,
    occurred_at: at(minutes),
    ingested_at: at(minutes + 1),
    flagged: severity !== null,
    flag_severity: severity,
    flag_reason: reason,
  });
  return [
    row('farm_event_syn01', 0, 'cam_feed_store', 'feed_store', 'detection', null, 0.91, 'notable', 'Person in a restricted zone overnight'),
    row('farm_event_syn02', 12, 'cam_feed_store', 'feed_store', 'unknown_cluster', null, 0.64, 'urgent', 'Unrecognised face in the feed store at night'),
    row('farm_event_syn03', 30, 'cam_feed_store', 'feed_store', 'face_match', 'rashid', 0.88, null, null),
    row('farm_event_syn04', 255, 'cam_gate', 'yard', 'face_match', 'abdul', 0.93, null, null),
    row('farm_event_syn05', 262, 'cam_barn', 'barn', 'detection', null, 0.77, null, null),
    row('farm_event_syn06', -300, 'cam_gate', 'yard', 'face_match', 'imran', 0.9, null, null),
    row('farm_event_syn07', -1700, 'cam_barn', 'barn', 'detection', null, 0.58, null, null),
  ];
}
