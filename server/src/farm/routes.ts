// Farm event ingestion routes (Cycle 4; see docs/FARM_EVENTS.md).
//
// An express.Router() rather than more inline handlers in index.ts: that file
// holds two routes today, and a new domain adding several more follows Cycle
// 2's precedent of new sibling files over bloating an existing one
// (server/src/tools/vendorReads.ts next to reads.ts).
//
// Mounted under /api like every other route in this app -- both existing routes
// are /api/*, and web-angular/proxy.conf.json proxies only /api.
//
// This module owns HTTP and the database. All parsing, validation and
// normalization lives in the pure ./ingest module.

import express from 'express';
import type { Request, Response } from 'express';
import { insertFarmEvents } from '../db';
import type { IngestOptions, IngestResult } from './ingest';
import { normalizeDoubleTake, normalizeFrigate } from './ingest';

export const farmRouter = express.Router();

/** Set by the generator, never present on a real webhook, so real and
 * synthetic events can be filtered apart. Deliberately a header rather than a
 * payload field: adding a field would diverge the synthetic payload shape from
 * the real one, which is exactly what Decision 2 exists to prevent. */
const SYNTHETIC_HEADER = 'x-synthetic-source';

/** better-sqlite3 surfaces a CHECK violation with this code. The normalizers
 * only ever emit valid enum values, so this is defense in depth -- but it must
 * come back as a 400 (bad input) and never as an unhandled 500. */
function isCheckViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'SQLITE_CONSTRAINT_CHECK'
  );
}

type Normalizer = (body: unknown, opts: IngestOptions) => IngestResult;

function handler(normalize: Normalizer) {
  return (req: Request, res: Response) => {
    const marker = req.header(SYNTHETIC_HEADER);
    const isSynthetic = typeof marker === 'string' && marker.length > 0;

    const result = normalize(req.body, { isSynthetic });

    if (!result.ok) return res.status(400).json(result.error);
    if (result.kind === 'skipped') {
      return res.status(202).json({ inserted: 0, reason: result.reason });
    }

    try {
      insertFarmEvents(result.events);
    } catch (err: unknown) {
      if (isCheckViolation(err)) {
        return res.status(400).json({
          error: 'invalid_enum',
          message: err instanceof Error ? err.message : 'CHECK constraint failed',
        });
      }
      throw err;
    }

    return res.status(201).json({
      inserted: result.events.length,
      ids: result.events.map((e) => e.id),
    });
  };
}

// One Frigate event yields at most one row (only type "new" persists); one
// Double Take POST can yield several (one per face) or none.
farmRouter.post('/frigate', handler(normalizeFrigate));
farmRouter.post('/double-take', handler(normalizeDoubleTake));
