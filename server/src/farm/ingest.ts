// Farm event ingestion -- validation + normalization (Cycle 4; see
// docs/FARM_EVENTS.md).
//
// Deliberately PURE: no Express, no SQLite. Everything here is a function from
// a parsed request body to either rows, a documented skip, or a structured
// error. That is what lets ingest.test.ts run under the plain
// `npm test -w server` with no database and no API key, alongside the existing
// shaper tests.
//
// Both normalizers accept the REAL wire shape of their source, not a
// flattened mock (Decision 2): Frigate's nested {type, before, after} envelope
// with epoch-float timestamps and zone arrays, and Double Take's
// matches/misses/unknowns arrays with 0-100 confidence. The whole point is
// that swapping the generator for real webhooks in Cycle 7 is configuration,
// not a rewrite.

import { randomUUID } from 'node:crypto';
import type { FarmEvent, FarmEventType } from '@dairy/shared';

/** Valid-but-deliberately-not-persisted outcomes. Each maps to a 202 whose
 * body names the reason, so an ignored event is never silently dropped. */
export type SkipReason = 'update' | 'end' | 'false_positive' | 'no_faces';

/** Structured rejection, following the `guardIds()` convention in
 * server/src/tools/index.ts: an `error` code plus the offending detail. */
export interface IngestError {
  error: 'missing_field' | 'invalid_type' | 'invalid_timestamp' | 'invalid_payload';
  [key: string]: unknown;
}

export type IngestResult =
  | { ok: true; kind: 'created'; events: FarmEvent[] }
  | { ok: true; kind: 'skipped'; reason: SkipReason }
  | { ok: false; error: IngestError };

export interface IngestOptions {
  /** From the X-Synthetic-Source request header -- never a payload field, so
   * synthetic and real payloads stay byte-identical in shape. */
  isSynthetic: boolean;
  /** Injectable so tests are deterministic. */
  now?: () => string;
  newId?: () => string;
}

// --- small unknown-shaped-input helpers -------------------------------------

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** First entry of a zone array, or null for `[]` / a non-array. Both sources
 * emit zone lists that are frequently empty, which is why farm_events.zone is
 * nullable. */
function firstZone(v: unknown): string | null {
  return Array.isArray(v) ? asString(v[0]) : null;
}

function asList(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

const fail = (error: IngestError): IngestResult => ({ ok: false, error });
const skip = (reason: SkipReason): IngestResult => ({ ok: true, kind: 'skipped', reason });
const created = (events: FarmEvent[]): IngestResult => ({ ok: true, kind: 'created', events });

function defaultId(): string {
  return `farm_event_${randomUUID().slice(0, 8)}`;
}

// --- timestamp normalization ------------------------------------------------
// Both columns end up as ISO-8601 UTC strings so occurred_at and ingested_at
// are the same format and lexicographically comparable. Note the repo has no
// other datetime column -- every existing date column is plain YYYY-MM-DD.

/** Upper bound on a plausible epoch-SECONDS value (~year 3238). Anything above
 * it is almost certainly milliseconds sent by mistake, which is worth a 400
 * rather than a row dated in the year 52680. */
const MAX_EPOCH_SECONDS = 4e10;

/** Frigate sends epoch float seconds (`1607123955.475377`). */
export function epochSecondsToIso(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > MAX_EPOCH_SECONDS) return null;
  try {
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

/** Double Take sends ISO 8601 already; re-emit it in canonical UTC form. */
export function isoToIso(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Double Take reports confidence on a 0-100 scale; Frigate's scores are
 * already 0..1. Everything is stored 0..1 so the column means one thing
 * regardless of source -- otherwise every downstream threshold becomes a
 * source-dependent trap. Rounded to 4dp only because the division is OUR
 * arithmetic and would otherwise leave float artifacts (91.4/100 ->
 * 0.9139999...); Frigate's own value is passed through untouched. */
export function percentToUnit(percent: number): number {
  return Math.round((percent / 100) * 10000) / 10000;
}

// --- Frigate ----------------------------------------------------------------

const FRIGATE_TYPES = new Set(['new', 'update', 'end']);

/**
 * `frigate/events` envelope -> at most one `detection` row.
 *
 * Only `type: "new"` is persisted. `update` and `end` are validated, accepted,
 * and ignored with a named reason: ingesting `end` would buy dwell time, which
 * nothing in Cycle 4 consumes. Validation runs BEFORE the skip decision, so a
 * malformed `update` is still a 400 -- whether a payload is well-formed is
 * independent of whether we choose to store it.
 */
export function normalizeFrigate(body: unknown, opts: IngestOptions): IngestResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? defaultId;

  const root = asRecord(body);
  if (!root) return fail({ error: 'invalid_payload', expected: 'object' });

  const type = asString(root.type);
  if (!type) return fail({ error: 'missing_field', field: 'type' });
  if (!FRIGATE_TYPES.has(type)) {
    return fail({ error: 'invalid_type', field: 'type', value: type });
  }

  const after = asRecord(root.after);
  if (!after) return fail({ error: 'missing_field', field: 'after' });

  const id = asString(after.id);
  if (!id) return fail({ error: 'missing_field', field: 'after.id' });
  const camera = asString(after.camera);
  if (!camera) return fail({ error: 'missing_field', field: 'after.camera' });
  // `label` is required for the payload to be meaningful (person vs car), but
  // farm_events has no label column -- it survives in raw_payload. Validated
  // here rather than silently ignored.
  if (!asString(after.label)) return fail({ error: 'missing_field', field: 'after.label' });

  const startTime = asNumber(after.start_time);
  if (startTime === null) return fail({ error: 'missing_field', field: 'after.start_time' });
  const occurredAt = epochSecondsToIso(startTime);
  if (!occurredAt) {
    return fail({ error: 'invalid_timestamp', field: 'after.start_time', value: startTime });
  }

  if (type !== 'new') return skip(type as 'update' | 'end');
  if (after.false_positive === true) return skip('false_positive');

  // entered_zones is preferred over current_zones: the zone that triggered the
  // event says more than wherever the object happened to drift to. A multi-zone
  // event keeps its full arrays in raw_payload; the indexed column holds one.
  const zone = firstZone(after.entered_zones) ?? firstZone(after.current_zones);

  return created([
    {
      id: newId(),
      source: 'frigate',
      source_event_id: id,
      is_synthetic: opts.isSynthetic,
      camera_id: camera,
      zone,
      event_type: 'detection',
      identity: null, // Frigate detects objects, it does not identify people
      confidence: asNumber(after.top_score) ?? asNumber(after.score),
      occurred_at: occurredAt,
      ingested_at: now(),
      snapshot_ref: after.has_snapshot === true ? `/api/events/${id}/snapshot.jpg` : null,
      raw_payload: JSON.stringify(body),
    },
  ]);
}

// --- Double Take ------------------------------------------------------------

/** Which payload array an entry came from, and the event_type it produces.
 * event_type is decided STRUCTURALLY -- by array membership -- never by
 * inspecting the name. That keeps the normalizer ignorant of which identities
 * are enrolled (the fixtures own that roster, not this module). */
const DT_GROUPS: { field: string; type: FarmEventType }[] = [
  { field: 'matches', type: 'face_match' },
  // A Double Take "miss" is a NAMED identity that fell below its confidence
  // threshold -- exactly the low-confidence-match case. So `face_match` does
  // NOT mean "confident match"; `confidence` is the only discriminator, and
  // threshold policy belongs to the Cycle 5 agent, not to this schema.
  { field: 'misses', type: 'face_match' },
  { field: 'unknowns', type: 'unknown_cluster' },
];

/**
 * Double Take camera-event payload -> one row PER FACE. One POST can therefore
 * produce several rows, or none.
 *
 * Accepts both published shapes: the `double-take/cameras/<camera>` topic
 * (matches/misses/unknowns arrays) and `double-take/matches/<name>` (a singular
 * `match` object), the latter normalized to a one-entry list.
 */
export function normalizeDoubleTake(body: unknown, opts: IngestOptions): IngestResult {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? defaultId;

  const root = asRecord(body);
  if (!root) return fail({ error: 'invalid_payload', expected: 'object' });

  // `id` carries the FRIGATE event id -- the join key back to the detection
  // this face enriches.
  const id = asString(root.id);
  if (!id) return fail({ error: 'missing_field', field: 'id' });
  const camera = asString(root.camera);
  if (!camera) return fail({ error: 'missing_field', field: 'camera' });
  const timestamp = asString(root.timestamp);
  if (!timestamp) return fail({ error: 'missing_field', field: 'timestamp' });
  const occurredAt = isoToIso(timestamp);
  if (!occurredAt) {
    return fail({ error: 'invalid_timestamp', field: 'timestamp', value: timestamp });
  }

  const groups: { field: string; type: FarmEventType; entries: unknown[] }[] = [];
  for (const g of DT_GROUPS) {
    const list = asList(root[g.field]);
    if (list) groups.push({ field: g.field, type: g.type, entries: list });
  }
  const singular = asRecord(root.match);
  if (singular) groups.push({ field: 'match', type: 'face_match', entries: [singular] });

  if (groups.length === 0) {
    return fail({
      error: 'invalid_payload',
      expected: 'at least one of matches, match, misses, unknowns',
    });
  }

  const zone = firstZone(root.zones);
  const rawPayload = JSON.stringify(body);
  const events: FarmEvent[] = [];

  for (const group of groups) {
    for (let i = 0; i < group.entries.length; i++) {
      const at = `${group.field}[${i}]`;
      const entry = asRecord(group.entries[i]);
      if (!entry) return fail({ error: 'invalid_payload', field: at, expected: 'object' });
      const name = asString(entry.name);
      if (!name) return fail({ error: 'missing_field', field: `${at}.name` });

      const percent = asNumber(entry.confidence);
      const filename = asString(entry.filename);
      events.push({
        id: newId(),
        source: 'double_take',
        source_event_id: id,
        is_synthetic: opts.isSynthetic,
        camera_id: camera,
        zone,
        event_type: group.type,
        identity: name,
        confidence: percent === null ? null : percentToUnit(percent),
        occurred_at: occurredAt,
        ingested_at: now(),
        snapshot_ref: filename ? `/api/storage/matches/${filename}` : null,
        raw_payload: rawPayload,
      });
    }
  }

  // A payload whose face arrays are all present but empty is valid Double Take
  // output (it processed a person and recognized nobody) -- accepted, not an
  // error, but there is nothing to store.
  if (events.length === 0) return skip('no_faces');
  return created(events);
}
