// GET /api/farm/events -- the Farm Monitor screen's read.
//
// READ-ONLY, AND IT TAKES ITS READER AS AN ARGUMENT. Flags are still written
// only through the assistant's approval card (flag_anomaly); this route never
// writes. The reader is injected so the registry harness can serve synthetic
// events without importing ../db, which opens dairy.db at module load (see
// registry/harness.ts, HARD CONSTRAINT).
//
// The raw payload is deliberately not returned: it is the camera system's
// verbatim body, useful to the verification scripts and noise on a screen.

import { Router } from 'express';
import type { FarmEvent } from '@dairy/shared';

export type FarmEventView = Omit<FarmEvent, 'raw_payload'>;
export type FarmEventReader = (fromIso: string, toIso: string) => FarmEventView[];

const MAX_WINDOW_MS = 31 * 24 * 3600_000;

export function farmMonitorRouter(read: FarmEventReader, opts: { synthetic?: boolean } = {}): Router {
  const router = Router();
  router.get('/events', (req, res) => {
    const now = Date.now();
    const to = typeof req.query.to === 'string' ? Date.parse(req.query.to) : now;
    const from = typeof req.query.from === 'string' ? Date.parse(req.query.from) : to - 24 * 3600_000;
    if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
      return res.status(400).json({ error: 'Use ISO-8601 instants with from <= to.' });
    }
    if (to - from > MAX_WINDOW_MS) {
      return res.status(400).json({ error: 'The window is limited to 31 days.' });
    }
    const fromIso = new Date(from).toISOString();
    const toIso = new Date(to).toISOString();
    const events = read(fromIso, toIso)
      .slice()
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    res.json({ from: fromIso, to: toIso, synthetic: !!opts.synthetic, events });
  });
  return router;
}
