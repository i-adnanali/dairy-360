// Real-vs-documented Double Take payload shape verification (Cycle 7 FU-3).
//
//   npm run verify:payload:dt -w server -- --capture=captures/double-take-....jsonl
//
// A sibling of verifyPayloadShape.ts rather than a flag on it. That script is
// Frigate-hardwired in five places, and one of them would silently destroy this
// analysis: its loadCapture() keeps only records whose payload has a top-level
// `type` string, and a Double Take payload HAS NO ROOT `type` -- every message
// would be counted as a "non-event" and dropped.
//
// ---------------------------------------------------------------------------
// HARD CONSTRAINT: never import `../db` (open decision 1, inherited from FU-1).
// ---------------------------------------------------------------------------
// So no `./simulate` either (it imports ../seed, which imports ./db on line 1).
// The generator baseline's timestamp is stamped inline below instead; the
// duplication is the point. Asserted by captureIsolation.test.ts.
//
// ---------------------------------------------------------------------------
// WHY THE FACE OBJECTS ARE DIFFED SEPARATELY -- the whole reason this exists
// ---------------------------------------------------------------------------
// payloadShape.ts's differ generalises to Double Take unchanged. Pointed at a
// whole payload, though, it produces a report that is both noisy and blind,
// because the documented example and a no-enrolment instance populate OPPOSITE
// arrays: the doc shows `matches: [<face>]` with `unknowns: []`, while street
// traffic against a synthetic-only gallery yields `matches: []` with
// `unknowns: [<face>]`.
//
// Diffing those directly gives:
//   - ~16 false `only_in_real` deltas, one per `unknowns[].*` field, for fields
//     that ARE documented -- just under `matches[]`; and
//   - zero coverage of the documented `matches[].*` paths, because
//     impliedByEmptyAncestor correctly suppresses them under an empty array.
//
// So the per-face shape -- the actual subject of this slice -- would go
// entirely unexercised while the report looked busy. The fix is to pull face
// objects out of whichever container they arrived in, on BOTH sides, and diff
// them as their own aggregate. Envelope and face, two reports.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeDoubleTake } from './ingest';
import type { IngestResult } from './ingest';
import {
  aggregateShapes,
  diffShapes,
  formatDelta,
  groupByKind,
} from './payloadShape';
import type { AggregateShape, PathDelta } from './payloadShape';
import { SCENARIOS } from './scenarios';
import { REDACTED } from './redact';
import type { CaptureRecord } from './captureDoubleTake';

const DOC_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'FARM_EVENTS.md');

/** Confirmed in FU-1's open decision 2 and unchanged here: this is the only
 * thing separating the capture from real farm data. */
const EXPECTED_CAMERA = 'test_street_cam';

/** Minimum payloads for the run to mean anything (BL-3). Deliberately LOW:
 * Double Take processes one event at a time and drops the rest, so payload
 * count measures its throughput, not camera activity. What matters is that the
 * shape was observed more than once. */
const MIN_PAYLOADS = 3;

/** Double Take's native confidence scale is 0-100. Any real non-zero value is
 * therefore >= 1 in practice; a value in (0,1) means someone is emitting a 0..1
 * scale and `percentToUnit` is silently dividing it again. */
const MIN_NATIVE_CONFIDENCE = 1;

/** Face containers, and how a face reaches them. */
const FACE_ARRAYS = ['matches', 'misses', 'unknowns'] as const;
const FACE_SINGULARS = ['match', 'unknown'] as const;

// --- baselines --------------------------------------------------------------

/** The documented Double Take payload, parsed out of FARM_EVENTS.md itself
 * rather than copied here -- a hand-copied duplicate could drift from the
 * normative doc and quietly make the diff meaningless. */
export function documentedDoubleTakeShape(markdown: string): unknown {
  const heading = /^###\s+Double Take\b.*$/m.exec(markdown);
  if (!heading) throw new Error('could not find the "### Double Take ..." heading in FARM_EVENTS.md');
  const after = markdown.slice(heading.index);
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(after);
  if (!fence) throw new Error('could not find a ```json block under the Double Take heading');
  try {
    return JSON.parse(fence[1]) as unknown;
  } catch (err: unknown) {
    throw new Error(
      `the documented Double Take JSON block does not parse: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * The synthetic generator's Double Take payload.
 *
 * The generator OMITS `timestamp` (simulate.ts stamps it at send time), so it
 * is stamped here. Without this, `timestamp` reports as a spurious
 * `only_in_real` delta against baseline B -- a finding about the generator's
 * internals rather than about Double Take.
 */
export function generatorDoubleTakeShape(): Record<string, unknown> {
  const scenario = SCENARIOS['normal-weekday'];
  const event = scenario.events.find((e) => e.source === 'double_take');
  if (!event) throw new Error('normal-weekday has no double_take event');
  const payload = structuredClone(event.payload) as Record<string, unknown>;
  payload.timestamp = '2026-08-28T07:41:03.512Z';
  return payload;
}

// --- capture loading --------------------------------------------------------

export interface LoadedCapture {
  records: CaptureRecord[];
  /** Records that look like a Double Take recognition payload. */
  payloads: Record<string, unknown>[];
  unparsed: number;
  /** Parsed but not a recognition payload -- `double-take/available` carries
   * "online", `double-take/cameras/<cam>/person` a bare count. */
  nonPayloads: number;
  /** Records where a redaction fired for ANY reason. */
  redactedRecords: number;
  /** Records where an actual `base64` KEY was redacted -- i.e. Double Take
   * really did put image bytes on the wire. Counted separately from the
   * length-rule redactions because conflating them makes the report claim
   * image data was present when it was not: in practice the length rule fires
   * on long error stack traces published to `double-take/errors`, which are
   * not biometric at all. */
  base64Redactions: number;
  /** Redactions that fired only because a string exceeded the length cap. */
  lengthRedactions: number;
  firstReceivedMs: number;
  lastReceivedMs: number;
}

/** A Double Take recognition payload has no root `type`; it is identified by
 * its required core plus at least one face container. */
function isRecognitionPayload(p: unknown): p is Record<string, unknown> {
  if (p === null || typeof p !== 'object' || Array.isArray(p)) return false;
  const r = p as Record<string, unknown>;
  const hasCore = typeof r.id === 'string' && typeof r.camera === 'string' && typeof r.timestamp === 'string';
  const hasFaces =
    FACE_ARRAYS.some((k) => Array.isArray(r[k])) ||
    FACE_SINGULARS.some((k) => r[k] !== null && typeof r[k] === 'object');
  return hasCore && hasFaces;
}

export function loadCapture(text: string): LoadedCapture {
  const records: CaptureRecord[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as CaptureRecord);
    } catch {
      throw new Error(`capture line ${i + 1} is not valid JSON -- is this a capture file?`);
    }
  }
  if (records.length === 0) throw new Error('the capture file is empty');

  const payloads: Record<string, unknown>[] = [];
  let unparsed = 0;
  let nonPayloads = 0;
  let redactedRecords = 0;
  let base64Redactions = 0;
  let lengthRedactions = 0;

  for (const r of records) {
    if (r.redacted && r.redacted.length > 0) {
      redactedRecords += 1;
      for (const p of r.redacted) {
        // A path ending in `base64` was redacted BY KEY -- real image bytes.
        // Anything else hit the length cap.
        if (/(^|\.)base64$/.test(p)) base64Redactions += 1;
        else lengthRedactions += 1;
      }
    }
    if (r.unparsed !== undefined || r.payload === null) {
      unparsed += 1;
      continue;
    }
    if (isRecognitionPayload(r.payload)) payloads.push(r.payload);
    else nonPayloads += 1;
  }

  const times = records.map((r) => new Date(r.received_at).getTime()).filter((n) => !Number.isNaN(n));
  return {
    records,
    payloads,
    unparsed,
    nonPayloads,
    redactedRecords,
    base64Redactions,
    lengthRedactions,
    firstReceivedMs: Math.min(...times),
    lastReceivedMs: Math.max(...times),
  };
}

// --- face extraction (the finding-4 fix) ------------------------------------

/** Every face object in a payload, from whichever container it arrived in. */
export function faceEntries(payload: unknown): Record<string, unknown>[] {
  if (payload === null || typeof payload !== 'object') return [];
  const r = payload as Record<string, unknown>;
  const out: Record<string, unknown>[] = [];
  for (const k of FACE_ARRAYS) {
    const list = r[k];
    if (Array.isArray(list)) {
      for (const e of list) if (e !== null && typeof e === 'object' && !Array.isArray(e)) out.push(e as Record<string, unknown>);
    }
  }
  for (const k of FACE_SINGULARS) {
    const e = r[k];
    if (e !== null && typeof e === 'object' && !Array.isArray(e)) out.push(e as Record<string, unknown>);
  }
  return out;
}

/** True for a path INSIDE a face object, which the envelope report excludes. */
function isFaceInternalPath(p: string): boolean {
  return (
    FACE_ARRAYS.some((k) => p.startsWith(`${k}[].`) || p.startsWith(`${k}[][`)) ||
    FACE_SINGULARS.some((k) => p.startsWith(`${k}.`) || p.startsWith(`${k}[`))
  );
}

/** Drop face internals so the envelope report is about the envelope. The array
 * itself (`matches`) and its element type (`matches[]`) are kept -- "the array
 * is empty" is an envelope-level fact and a real finding. */
function envelopeOnly(agg: AggregateShape): AggregateShape {
  const paths = new Map(
    [...agg.paths].filter(([p]) => !isFaceInternalPath(p)),
  );
  return { paths, sampleCount: agg.sampleCount };
}

// --- normalization ----------------------------------------------------------

interface Row {
  camera_id: string;
  zone: string | null;
  confidence: number | null;
  identity: string | null;
  event_type: string;
  occurred_at: string;
  source_event_id: string | null;
  snapshot_ref: string | null;
}

interface Tally {
  created: number;
  skipped: Map<string, number>;
  rejected: Map<string, number>;
  rows: Row[];
}

export function normalizeAll(payloads: Record<string, unknown>[]): Tally {
  const tally: Tally = { created: 0, skipped: new Map(), rejected: new Map(), rows: [] };
  for (const payload of payloads) {
    const result: IngestResult = normalizeDoubleTake(payload, { isSynthetic: false });
    if (!result.ok) {
      const key = `${result.error.error} ${String(result.error.field ?? result.error.expected ?? '')}`.trim();
      tally.rejected.set(key, (tally.rejected.get(key) ?? 0) + 1);
      continue;
    }
    if (result.kind === 'skipped') {
      tally.skipped.set(result.reason, (tally.skipped.get(result.reason) ?? 0) + 1);
      continue;
    }
    tally.created += result.events.length;
    for (const e of result.events) {
      tally.rows.push({
        camera_id: e.camera_id,
        zone: e.zone,
        confidence: e.confidence,
        identity: e.identity,
        event_type: e.event_type,
        occurred_at: e.occurred_at,
        source_event_id: e.source_event_id,
        snapshot_ref: e.snapshot_ref,
      });
    }
  }
  return tally;
}

// --- definition of done -----------------------------------------------------

interface Check { label: string; pass: boolean; detail: string }

/**
 * The tightened criterion (open decision 4), which is STRICTER than FU-1's.
 *
 * FU-1's list is necessary but not sufficient here, and the reason is worth
 * stating: on the Double Take side a run can be simultaneously green and
 * worthless. `percentToUnit` has no range check, so
 *
 *   - a native `0`   -> stored 0      : non-null, inside 0..1  -> FU-1 PASSES
 *   - a native `0.914` (wrong scale) -> stored 0.0091 : ditto  -> FU-1 PASSES
 *
 * The first is exactly what an empty gallery produces; the second is the 100x
 * inversion this whole follow-up exists to catch. So the checks below assert on
 * the NATIVE, pre-normalization value as well as the stored one.
 */
export function dodChecks(
  tally: Tally,
  cap: LoadedCapture,
  natives: number[],
): Check[] {
  const rows = tally.rows;
  const n = rows.length;

  const nonZeroNatives = natives.filter((c) => c !== 0);
  const subUnit = nonZeroNatives.filter((c) => c < MIN_NATIVE_CONFIDENCE);
  const nullConf = rows.filter((r) => r.confidence === null);
  const outOfRange = rows.filter((r) => r.confidence !== null && (r.confidence < 0 || r.confidence > 1));
  const wrongCamera = [...new Set(rows.map((r) => r.camera_id))].filter((c) => c !== EXPECTED_CAMERA);
  const withZone = rows.filter((r) => r.zone !== null);
  const noSourceId = rows.filter((r) => !r.source_event_id);
  const noSnapshotRef = rows.filter((r) => !r.snapshot_ref);
  const lower = cap.firstReceivedMs - 15 * 60_000;
  const upper = cap.lastReceivedMs + 60_000;
  const outsideWindow = rows.filter((r) => {
    const ms = new Date(r.occurred_at).getTime();
    return Number.isNaN(ms) || ms < lower || ms > upper;
  });

  return [
    {
      label: `sufficiency: at least ${MIN_PAYLOADS} recognition payloads`,
      pass: cap.payloads.length >= MIN_PAYLOADS,
      detail: `${cap.payloads.length} payload(s)` +
        (cap.payloads.length < MIN_PAYLOADS
          ? ' — too few to call the shape observed; a green run over 1 payload proves nothing'
          : ''),
    },
    { label: 'at least one row was created', pass: n > 0, detail: `${n} row(s)` },
    {
      label: 'every row has a non-null confidence',
      pass: n > 0 && nullConf.length === 0,
      detail: nullConf.length === 0 ? `${n}/${n}` : `${n - nullConf.length}/${n} — ${nullConf.length} NULL`,
    },
    {
      label: 'every stored confidence is inside 0..1',
      pass: outOfRange.length === 0,
      detail: outOfRange.length === 0 ? `${n}/${n}` : `${outOfRange.length} outside 0..1`,
    },
    {
      // The check FU-1's list cannot express, and the one that catches an
      // all-zeros (empty-gallery) run.
      label: 'at least one NON-ZERO native confidence',
      pass: nonZeroNatives.length > 0,
      detail: nonZeroNatives.length > 0
        ? `${nonZeroNatives.length}/${natives.length} face(s) scored non-zero`
        : `0/${natives.length} — every face scored 0. The gallery was effectively empty, ` +
          'so the 0-100 scale is UNVALIDATED and this run does not close FU-3.',
    },
    {
      // The 100x inversion guard. A 0..1-scaled payload would store 0.0091,
      // which passes "inside 0..1" — so it must be caught pre-normalization.
      label: `every non-zero native confidence is >= ${MIN_NATIVE_CONFIDENCE} (0-100 scale)`,
      pass: subUnit.length === 0,
      detail: subUnit.length === 0
        ? `${nonZeroNatives.length}/${nonZeroNatives.length}` +
          (nonZeroNatives.length
            ? ` (max ${Math.max(...nonZeroNatives)}, min ${Math.min(...nonZeroNatives)})`
            : '')
        : `${subUnit.length} face(s) below 1: [${subUnit.join(', ')}] — this is a 0..1 scale, ` +
          'and percentToUnit() would silently divide it by 100 again',
    },
    {
      label: 'every occurred_at is inside the capture window',
      pass: n > 0 && outsideWindow.length === 0,
      detail: outsideWindow.length === 0 ? `${n}/${n}` : `${outsideWindow.length} outside`,
    },
    {
      label: 'every row has a non-empty source_event_id',
      pass: n > 0 && noSourceId.length === 0,
      detail: noSourceId.length === 0 ? `${n}/${n}` : `${noSourceId.length} missing`,
    },
    {
      label: 'every row has a snapshot_ref (non-empty filename)',
      pass: n > 0 && noSnapshotRef.length === 0,
      detail: noSnapshotRef.length === 0 ? `${n}/${n}` : `${noSnapshotRef.length} missing filename`,
    },
    {
      label: `every row's camera_id is "${EXPECTED_CAMERA}"`,
      pass: n > 0 && wrongCamera.length === 0,
      detail: wrongCamera.length === 0 ? `${n}/${n}` : `unexpected: ${wrongCamera.join(', ')}`,
    },
    {
      label: 'zone is NULL on every row (classification rule 1 unreachable)',
      pass: withZone.length === 0,
      detail: withZone.length === 0 ? `${n}/${n}` : `${withZone.length} row(s) carry a zone`,
    },
    {
      // Not a shape check -- a privacy check, asserted on the ARTIFACT itself
      // rather than on the config that was supposed to prevent it.
      label: 'no inline image data survives in the capture',
      pass: !JSON.stringify(cap.records).includes('base64,'),
      detail:
        `${cap.base64Redactions} base64 value(s) redacted` +
        (cap.lengthRedactions > 0
          ? `; ${cap.lengthRedactions} over-long string(s) also redacted (these are ` +
            'error stack traces on double-take/errors, not image data)'
          : ''),
    },
  ];
}

// --- report -----------------------------------------------------------------

function printDeltas(title: string, deltas: PathDelta[]): void {
  console.log(`\n${title}`);
  if (deltas.length === 0) {
    console.log('  zero deltas — the documented shape matches the real payload.');
    return;
  }
  for (const group of groupByKind(deltas)) {
    console.log(`\n  ${group.kind}  (${group.deltas.length})`);
    for (const d of group.deltas) console.log(`    - ${formatDelta(d)}`);
  }
}

interface Args { capture: string; help: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { capture: '', help: false };
  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    if (flag === '--capture') args.capture = value ?? '';
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`unknown argument: ${raw}`);
  }
  return args;
}

const USAGE = `Diff a real Double Take MQTT capture against the documented payload shape.

  npm run verify:payload:dt -w server -- --capture=<path to .jsonl>

Produce a capture first:
  npm run capture:doubletake -w server -- --minutes=20

Never opens dairy.db.`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.capture) {
    console.log(USAGE);
    if (!args.help) process.exitCode = 1;
    return;
  }

  const cap = loadCapture(readFileSync(args.capture, 'utf8'));
  const documented = documentedDoubleTakeShape(readFileSync(DOC_PATH, 'utf8'));
  const generator = generatorDoubleTakeShape();

  console.log('Double Take payload shape — real vs documented');
  console.log('==============================================\n');
  console.log(`Capture: ${args.capture}`);
  console.log(
    `  ${cap.records.length} message(s): ${cap.payloads.length} recognition payload(s), ` +
      `${cap.nonPayloads} other, ${cap.unparsed} unparsed`,
  );
  console.log(
    `  window:  ${new Date(cap.firstReceivedMs).toISOString()} .. ${new Date(cap.lastReceivedMs).toISOString()}`,
  );

  if (cap.payloads.length === 0) {
    console.log('\nNo Double Take recognition payloads in this capture — nothing to diff.');
    process.exitCode = 1;
    return;
  }

  const realFull = aggregateShapes(cap.payloads);
  const realFaces = aggregateShapes(cap.payloads.flatMap(faceEntries));
  const docFaces = aggregateShapes(faceEntries(documented));
  const genFaces = aggregateShapes(faceEntries(generator));

  const cameras = new Set(cap.payloads.map((p) => String(p.camera)));
  const faceCount = cap.payloads.flatMap(faceEntries).length;
  console.log(`  cameras: ${[...cameras].join(', ')}`);
  console.log(`  faces:   ${faceCount} across ${cap.payloads.length} payload(s)`);
  if (cap.redactedRecords > 0) {
    console.log(
      `  redacted: ${cap.base64Redactions} base64 value(s), ` +
        `${cap.lengthRedactions} over-long string(s), across ${cap.redactedRecords} record(s)`,
    );
  }

  // --- envelope ------------------------------------------------------------
  console.log('\n\nENVELOPE  (face-object internals excluded — diffed separately below)');
  console.log('====================================================================');
  printDeltas(
    'Baseline A — FARM_EVENTS.md § "Double Take — camera event payload"',
    diffShapes(envelopeOnly(realFull), envelopeOnly(aggregateShapes([documented]))),
  );
  printDeltas(
    'Baseline B — synthetic generator (scenarios.ts normal-weekday)',
    diffShapes(envelopeOnly(realFull), envelopeOnly(aggregateShapes([generator]))),
  );

  // --- per-face ------------------------------------------------------------
  console.log('\n\nPER-FACE OBJECT  (pooled from matches / misses / unknowns / match / unknown)');
  console.log('============================================================================');
  console.log(
    '  Pooled deliberately: the documented example fills `matches` while a\n' +
      '  no-enrolment instance fills `unknowns`, so diffing them positionally would\n' +
      '  report every documented field as missing and every real field as new.',
  );
  printDeltas('Baseline A — the documented per-face object', diffShapes(realFaces, docFaces));
  printDeltas('Baseline B — the generator per-face object', diffShapes(realFaces, genFaces));

  // --- normalization + DoD -------------------------------------------------
  const tally = normalizeAll(cap.payloads);
  const natives = cap.payloads
    .flatMap(faceEntries)
    .map((f) => f.confidence)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c));

  console.log('\n\nNormalization through the real ingest logic (normalizeDoubleTake)');
  console.log('================================================================');
  console.log(`  created:  ${tally.created} row(s)`);
  console.log(`  skipped:  ${[...tally.skipped].map(([r, n]) => `${r}=${n}`).join(' ') || 'none'}`);
  console.log(`  rejected: ${[...tally.rejected].map(([r, n]) => `${r}=${n}`).join(' ') || 'none'}`);

  const byType = new Map<string, number>();
  const identities = new Map<string, number>();
  for (const r of tally.rows) {
    byType.set(r.event_type, (byType.get(r.event_type) ?? 0) + 1);
    identities.set(String(r.identity), (identities.get(String(r.identity)) ?? 0) + 1);
  }
  console.log(`  by event_type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(' ') || 'none'}`);
  console.log(`  identities:    ${[...identities].map(([i, n]) => `${i}=${n}`).join(' ') || 'none'}`);
  if (natives.length > 0) {
    console.log(
      `  native confidence: min=${Math.min(...natives)} max=${Math.max(...natives)} ` +
        `(0-100 scale, pre-normalization)`,
    );
  }

  console.log('\nDefinition of done (tightened — open decision 4)');
  const checks = dodChecks(tally, cap, natives);
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label.padEnd(60)} ${c.detail}`);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

if (require.main === module) {
  try {
    main();
  } catch (err: unknown) {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

// Referenced so the redaction sentinel stays in one place if it is ever renamed.
export { REDACTED };
