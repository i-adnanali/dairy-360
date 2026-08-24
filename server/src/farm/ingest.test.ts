// Unit tests for the pure ingestion normalizers (Cycle 4; see
// docs/FARM_EVENTS.md). node:test via `tsx --test`, the same runner as
// src/tools/shaper.test.ts -- no database, no API key, so these run in the
// plain `npm test -w server` CI step.

import assert from 'node:assert';
import { test } from 'node:test';
import {
  epochSecondsToIso,
  isoToIso,
  normalizeDoubleTake,
  normalizeFrigate,
  percentToUnit,
} from './ingest';
import type { IngestError, IngestResult, SkipReason } from './ingest';
import type { FarmEvent } from '@dairy/shared';

// Deterministic id/clock so assertions are exact.
let idSeq = 0;
const OPTS = {
  isSynthetic: true,
  now: () => '2026-08-24T12:00:00.000Z',
  newId: () => `farm_event_t${String((idSeq += 1)).padStart(4, '0')}`,
};

// assert.fail() returns `never`, so these narrow the IngestResult union for the
// type checker as well as asserting at runtime.

function rows(result: IngestResult): FarmEvent[] {
  if (!result.ok) assert.fail(`expected rows, got error ${JSON.stringify(result.error)}`);
  if (result.kind !== 'created') assert.fail(`expected rows, got skip "${result.reason}"`);
  return result.events;
}

function errorOf(result: IngestResult): IngestError {
  if (result.ok) assert.fail(`expected a rejection, got "${result.kind}"`);
  return result.error;
}

function skipReason(result: IngestResult): SkipReason {
  if (!result.ok) assert.fail(`expected a skip, got error ${JSON.stringify(result.error)}`);
  if (result.kind !== 'skipped') assert.fail('expected a skip, got rows');
  return result.reason;
}

// --- fixtures: the REAL wire shapes, not the flattened mock ------------------

/** Frigate `frigate/events` envelope. */
function frigateEvent(over: Record<string, unknown> = {}, type = 'new'): unknown {
  return {
    type,
    before: { id: 'evt-1', camera: 'gate_cam' },
    after: {
      id: 'evt-1',
      camera: 'gate_cam',
      label: 'person',
      sub_label: null,
      score: 0.789,
      top_score: 0.9375,
      false_positive: false,
      start_time: 1787000000.475377,
      end_time: null,
      current_zones: ['yard'],
      entered_zones: ['gate'],
      has_snapshot: true,
      has_clip: false,
      stationary: false,
      ...over,
    },
  };
}

/** Double Take `double-take/cameras/<camera>` payload. */
function doubleTakeEvent(over: Record<string, unknown> = {}): unknown {
  return {
    id: 'evt-1',
    duration: 4.25,
    timestamp: '2026-08-21T02:14:03.695Z',
    attempts: 5,
    camera: 'gate_cam',
    zones: ['gate'],
    matches: [],
    misses: [],
    unknowns: [],
    counts: { person: 1, match: 0, miss: 0, unknown: 0 },
    ...over,
  };
}

const face = (over: Record<string, unknown> = {}) => ({
  name: 'employee_2',
  confidence: 91.4,
  match: true,
  box: { top: 286, left: 744, width: 319, height: 397 },
  type: 'latest',
  duration: 0.8,
  detector: 'compreface',
  filename: 'abc123.jpg',
  base64: null,
  ...over,
});

// --- timestamp + scale conversion -------------------------------------------

test('epochSecondsToIso: Frigate epoch float -> ISO-8601 UTC', () => {
  // cross-checked against `date -u -r 1607123955`
  assert.equal(epochSecondsToIso(1607123955.475377), '2020-12-04T23:19:15.475Z');
});

test('epochSecondsToIso: rejects non-positive, non-finite, and millisecond values', () => {
  assert.equal(epochSecondsToIso(0), null);
  assert.equal(epochSecondsToIso(-1), null);
  assert.equal(epochSecondsToIso(Number.NaN), null);
  // milliseconds sent by mistake would otherwise land in the year 52680
  assert.equal(epochSecondsToIso(1607123955475), null);
});

test('isoToIso: canonicalizes to UTC, rejects garbage', () => {
  assert.equal(isoToIso('2026-08-21T02:14:03.695Z'), '2026-08-21T02:14:03.695Z');
  assert.equal(isoToIso('2026-08-21T07:14:03.695+05:00'), '2026-08-21T02:14:03.695Z');
  assert.equal(isoToIso('not-a-date'), null);
});

test('percentToUnit: Double Take 0-100 -> 0..1 with no float artifacts', () => {
  assert.equal(percentToUnit(91.4), 0.914);
  assert.equal(percentToUnit(100), 1);
  assert.equal(percentToUnit(0), 0);
  assert.equal(percentToUnit(66.07), 0.6607);
});

// --- Frigate ----------------------------------------------------------------

test('frigate: type "new" -> one detection row, zone from entered_zones', () => {
  const [row] = rows(normalizeFrigate(frigateEvent(), OPTS));
  assert.equal(row.source, 'frigate');
  assert.equal(row.source_event_id, 'evt-1');
  assert.equal(row.event_type, 'detection');
  assert.equal(row.camera_id, 'gate_cam');
  // entered_zones wins over current_zones
  assert.equal(row.zone, 'gate');
  assert.equal(row.identity, null);
  // top_score preferred over score, passed through un-rescaled
  assert.equal(row.confidence, 0.9375);
  // 1787000000.475377, cross-checked against `date -u -r 1787000000`
  assert.equal(row.occurred_at, '2026-08-17T20:53:20.475Z');
  assert.equal(row.ingested_at, '2026-08-24T12:00:00.000Z');
  assert.equal(row.is_synthetic, true);
  assert.equal(row.snapshot_ref, '/api/events/evt-1/snapshot.jpg');
  // raw_payload retains what the column drops (zone arrays, boxes, label)
  assert.equal(JSON.parse(row.raw_payload).after.label, 'person');
});

test('frigate: falls back to current_zones, then to null', () => {
  const a = rows(normalizeFrigate(frigateEvent({ entered_zones: [] }), OPTS))[0];
  assert.equal(a.zone, 'yard');
  const b = rows(
    normalizeFrigate(frigateEvent({ entered_zones: [], current_zones: [] }), OPTS),
  )[0];
  assert.equal(b.zone, null);
});

test('frigate: falls back to score when top_score is absent', () => {
  const row = rows(normalizeFrigate(frigateEvent({ top_score: undefined }), OPTS))[0];
  assert.equal(row.confidence, 0.789);
});

test('frigate: has_snapshot false -> null snapshot_ref', () => {
  const row = rows(normalizeFrigate(frigateEvent({ has_snapshot: false }), OPTS))[0];
  assert.equal(row.snapshot_ref, null);
});

test('frigate: update and end are accepted but not persisted', () => {
  for (const type of ['update', 'end'] as const) {
    assert.equal(skipReason(normalizeFrigate(frigateEvent({}, type), OPTS)), type);
  }
});

test('frigate: false_positive is accepted but not persisted', () => {
  const r = normalizeFrigate(frigateEvent({ false_positive: true }), OPTS);
  assert.equal(skipReason(r), 'false_positive');
});

test('frigate: a malformed update is still rejected, not skipped', () => {
  // validity is independent of whether we choose to store it
  const r = normalizeFrigate(frigateEvent({ camera: undefined }, 'update'), OPTS);
  assert.equal(errorOf(r).error, 'missing_field');
  assert.equal(errorOf(r).field, 'after.camera');
});

test('frigate: rejects missing required fields', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ id: undefined }, 'after.id'],
    [{ camera: undefined }, 'after.camera'],
    [{ label: undefined }, 'after.label'],
    [{ start_time: undefined }, 'after.start_time'],
  ];
  for (const [over, field] of cases) {
    const e = errorOf(normalizeFrigate(frigateEvent(over), OPTS));
    assert.equal(e.error, 'missing_field', `for ${field}`);
    assert.equal(e.field, field);
  }
});

test('frigate: rejects a bad envelope', () => {
  assert.equal(errorOf(normalizeFrigate('nope', OPTS)).error, 'invalid_payload');
  assert.equal(errorOf(normalizeFrigate({}, OPTS)).field, 'type');
  assert.equal(errorOf(normalizeFrigate({ type: 'bogus' }, OPTS)).error, 'invalid_type');
  assert.equal(errorOf(normalizeFrigate({ type: 'new' }, OPTS)).field, 'after');
});

test('frigate: rejects an out-of-range start_time', () => {
  const e = errorOf(normalizeFrigate(frigateEvent({ start_time: 1607123955475 }), OPTS));
  assert.equal(e.error, 'invalid_timestamp');
  assert.equal(e.field, 'after.start_time');
});

test('frigate: synthetic flag comes from options, never the payload', () => {
  const row = rows(normalizeFrigate(frigateEvent(), { ...OPTS, isSynthetic: false }))[0];
  assert.equal(row.is_synthetic, false);
});

// --- Double Take ------------------------------------------------------------

test('double take: a match -> one face_match row, confidence rescaled to 0..1', () => {
  const [row] = rows(normalizeDoubleTake(doubleTakeEvent({ matches: [face()] }), OPTS));
  assert.equal(row.source, 'double_take');
  assert.equal(row.source_event_id, 'evt-1'); // the Frigate event id
  assert.equal(row.event_type, 'face_match');
  assert.equal(row.identity, 'employee_2');
  assert.equal(row.confidence, 0.914); // 91.4 / 100
  assert.equal(row.zone, 'gate');
  assert.equal(row.camera_id, 'gate_cam');
  assert.equal(row.occurred_at, '2026-08-21T02:14:03.695Z');
  assert.equal(row.snapshot_ref, '/api/storage/matches/abc123.jpg');
});

test('double take: event_type comes from array membership, not the name', () => {
  // an "unknown_"-looking name in matches is still a face_match ...
  const a = rows(
    normalizeDoubleTake(doubleTakeEvent({ matches: [face({ name: 'unknown_a1' })] }), OPTS),
  )[0];
  assert.equal(a.event_type, 'face_match');
  assert.equal(a.identity, 'unknown_a1');
  // ... and an enrolled-looking name in unknowns is still an unknown_cluster
  const b = rows(
    normalizeDoubleTake(doubleTakeEvent({ unknowns: [face({ name: 'employee_2' })] }), OPTS),
  )[0];
  assert.equal(b.event_type, 'unknown_cluster');
  assert.equal(b.identity, 'employee_2');
});

test('double take: misses land as low-confidence face_match rows', () => {
  const [row] = rows(
    normalizeDoubleTake(
      doubleTakeEvent({ misses: [face({ confidence: 41.2, match: false })] }),
      OPTS,
    ),
  );
  // face_match does NOT imply a confident match -- confidence is the only
  // discriminator, and threshold policy is Cycle 5's, not the schema's.
  assert.equal(row.event_type, 'face_match');
  assert.equal(row.confidence, 0.412);
  assert.equal(row.identity, 'employee_2');
});

test('double take: one POST fans out to one row per face', () => {
  const evs = rows(
    normalizeDoubleTake(
      doubleTakeEvent({
        matches: [face({ name: 'employee_1' }), face({ name: 'employee_2' })],
        misses: [face({ name: 'employee_3', confidence: 30 })],
        unknowns: [face({ name: 'unknown_a1', confidence: 12 })],
      }),
      OPTS,
    ),
  );
  assert.equal(evs.length, 4);
  assert.deepEqual(
    evs.map((e) => [e.event_type, e.identity]),
    [
      ['face_match', 'employee_1'],
      ['face_match', 'employee_2'],
      ['face_match', 'employee_3'],
      ['unknown_cluster', 'unknown_a1'],
    ],
  );
  // every row carries a distinct primary key but the same source_event_id
  assert.equal(new Set(evs.map((e) => e.id)).size, 4);
  assert.equal(new Set(evs.map((e) => e.source_event_id)).size, 1);
});

test('double take: accepts the singular `match` topic shape', () => {
  const payload = { id: 'evt-9', camera: 'gate_cam', timestamp: '2026-08-21T02:14:03.695Z', zones: [], match: face() };
  const [row] = rows(normalizeDoubleTake(payload, OPTS));
  assert.equal(row.event_type, 'face_match');
  assert.equal(row.identity, 'employee_2');
});

test('double take: all face arrays empty -> accepted, nothing stored', () => {
  assert.equal(skipReason(normalizeDoubleTake(doubleTakeEvent(), OPTS)), 'no_faces');
});

test('double take: no face arrays at all -> rejected', () => {
  const r = normalizeDoubleTake(
    { id: 'e', camera: 'c', timestamp: '2026-08-21T02:14:03.695Z' },
    OPTS,
  );
  assert.equal(errorOf(r).error, 'invalid_payload');
});

test('double take: rejects missing required fields', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ id: undefined }, 'id'],
    [{ camera: undefined }, 'camera'],
    [{ timestamp: undefined }, 'timestamp'],
  ];
  for (const [over, field] of cases) {
    const e = errorOf(normalizeDoubleTake(doubleTakeEvent(over), OPTS));
    assert.equal(e.error, 'missing_field', `for ${field}`);
    assert.equal(e.field, field);
  }
});

test('double take: rejects a nameless face rather than dropping it', () => {
  const e = errorOf(
    normalizeDoubleTake(doubleTakeEvent({ unknowns: [face({ name: undefined })] }), OPTS),
  );
  assert.equal(e.error, 'missing_field');
  assert.equal(e.field, 'unknowns[0].name');
});

test('double take: rejects a non-object face entry', () => {
  const e = errorOf(normalizeDoubleTake(doubleTakeEvent({ matches: ['nope'] }), OPTS));
  assert.equal(e.error, 'invalid_payload');
  assert.equal(e.field, 'matches[0]');
});

test('double take: missing confidence is null, not zero', () => {
  const row = rows(
    normalizeDoubleTake(doubleTakeEvent({ unknowns: [face({ confidence: undefined })] }), OPTS),
  )[0];
  assert.equal(row.confidence, null);
});

test('double take: empty zones array -> null zone', () => {
  const row = rows(
    normalizeDoubleTake(doubleTakeEvent({ zones: [], matches: [face()] }), OPTS),
  )[0];
  assert.equal(row.zone, null);
});

test('double take: rejects an unparseable timestamp', () => {
  const e = errorOf(normalizeDoubleTake(doubleTakeEvent({ timestamp: 'yesterday' }), OPTS));
  assert.equal(e.error, 'invalid_timestamp');
});
