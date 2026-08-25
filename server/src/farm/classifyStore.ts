// Farm event classification -- the impure shell (Cycle 5; see
// docs/FARM_MONITOR.md Decision 5).
//
// Everything here touches SQLite. The scoring rules themselves live in
// classify.ts, which stays DB-free so classify.test.ts can exercise them with
// no database -- the same pure-core split ingest.ts/routes.ts already uses.
//
// Writes go through setFarmEventFlag(), a plain DB helper with NO approval
// card. That is the whole point of the split write path in Decision 6: an
// automatic pass over a day's rows must not raise a confirmation card per row,
// while the flag_anomaly tool (which DOES raise one) reaches the same SQL.

import type { FarmEvent, FarmFlagSeverity } from '@dairy/shared';
import { countPriorSightings, setFarmEventFlag } from '../db';
import type { Verdict } from './classify';
import { lookbackStartIso, scoreEvent } from './classify';

/**
 * Classify one persisted event and write the verdict back.
 *
 * Prior sightings are counted only for `unknown_cluster` rows -- the one rule
 * that needs history. Every other rule is decidable from the row alone, so
 * there is no reason to pay for a query.
 */
export function classifyEvent(event: FarmEvent, now = new Date()): Verdict {
  let priorSightingCount = 0;
  if (event.event_type === 'unknown_cluster' && event.identity) {
    priorSightingCount = countPriorSightings({
      identity: event.identity,
      eventType: 'unknown_cluster',
      occurredAt: event.occurred_at,
      id: event.id,
      windowStartIso: lookbackStartIso(event.occurred_at),
    });
  }

  const verdict = scoreEvent(event, priorSightingCount);

  setFarmEventFlag({
    id: event.id,
    severity: verdict.severity === 'routine' ? null : (verdict.severity as FarmFlagSeverity),
    reason: verdict.severity === 'routine' ? null : verdict.reason,
    classifiedAt: now.toISOString(),
  });

  return verdict;
}

/**
 * Classify a batch, oldest first.
 *
 * The ordering is not cosmetic. An unknown cluster's occurrence number counts
 * rows already persisted, so the verdict sequence only reads as a gradient
 * (notable, notable, urgent) when the batch is walked in the order the events
 * actually occurred -- which is also the order a live pass would see them in.
 */
export function classifyEvents(events: FarmEvent[], now = new Date()): Verdict[] {
  const ordered = [...events].sort((a, b) =>
    a.occurred_at === b.occurred_at
      ? a.id.localeCompare(b.id)
      : a.occurred_at.localeCompare(b.occurred_at),
  );
  return ordered.map((e) => classifyEvent(e, now));
}
