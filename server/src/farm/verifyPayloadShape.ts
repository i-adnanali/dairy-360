// Real-vs-documented Frigate payload shape verification (Cycle 7 step 1; see
// docs/cycle-7-live-camera-validation.md).
//
//   npm run verify:payload -w server -- --capture=captures/frigate-events-....jsonl
//
// Reads a capture produced by `npm run capture:frigate`, diffs the real payload
// shape against two baselines, runs every captured payload through the REAL
// ingest normalizer, and asserts the tightened definition of done. Exits 0 for
// a clean pass, non-zero with a printed deltas list otherwise.
//
// A sibling of verify.ts and verifyClassify.ts, and deliberately NOT a
// *.test.ts: it needs a capture artifact, so it stays a local command rather
// than something `npm test -w server` picks up unconditionally. The pure differ
// it drives IS unit-tested, in payloadShape.test.ts.
//
// ---------------------------------------------------------------------------
// HARD CONSTRAINT: this module must never import `../db`, and that rules out
// two imports it would otherwise obviously want.
// ---------------------------------------------------------------------------
// Open decision 1 is "the shared dev DB stays untouched". `../db` opens (and on
// a fresh clone creates) dairy.db at module load, so an import alone breaks it.
// Two consequences, both non-obvious:
//
//  1. It cannot reuse `stampTimestamps` from ./simulate, even though that is
//     exactly the helper wanted here. simulate.ts imports `daysAgo` from
//     ../seed, and seed.ts imports `db` on its FIRST LINE. Pulling in
//     stampTimestamps would therefore open the database transitively. The
//     stamping is reproduced inline below instead -- three lines, and the
//     duplication is the point rather than an oversight.
//  2. It reads nothing back from SQLite, so unlike verify.ts there is no
//     resetFarmEvents() anywhere in this file. That matters: finding 4 of the
//     handover doc is that verify.ts's unscoped `DELETE FROM farm_events` would
//     destroy a capture. Nothing here can do that.
//
// ./scenarios and ./ingest are both safe to import -- scenarios.ts imports only
// types, and ingest.ts imports only node:crypto plus types.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeFrigate } from './ingest';
import type { IngestResult } from './ingest';
import {
  aggregateShapes,
  diffShapes,
  formatDelta,
  groupByKind,
  shapeOf,
} from './payloadShape';
import type { AggregateShape, PathDelta } from './payloadShape';
import { SCENARIOS } from './scenarios';
import type { CaptureRecord } from './captureMqtt';

const DOC_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'FARM_EVENTS.md');

/** The camera name confirmed in open decision 2. Per finding 5 this is the ONLY
 * thing separating this capture from real farm data, so the DoD asserts it. */
const EXPECTED_CAMERA = 'test_street_cam';

/**
 * How far BEFORE the capture window an `occurred_at` may legitimately fall.
 *
 * Frigate publishes `new` within a second or two of `start_time`, but `end`
 * arrives when the object leaves while `start_time` still points at the
 * beginning of the event. So the lower bound needs slack equal to the longest
 * plausible event duration, not to clock skew. A vehicle parked in frame at the
 * gate can hold an event open for minutes.
 */
const MAX_EVENT_AGE_MS = 15 * 60_000;

/** Clock-skew allowance on the upper bound. An occurred_at meaningfully AFTER
 * the last message we received means the camera's clock is ahead, which is a
 * real finding rather than something to absorb silently. */
const MAX_CLOCK_SKEW_MS = 60_000;

// --- baselines --------------------------------------------------------------

/**
 * The documented Frigate envelope, parsed out of FARM_EVENTS.md itself rather
 * than copied into this file.
 *
 * Parsing the doc is deliberate: the doc is the normative artifact this slice
 * validates, and a hand-copied duplicate here could drift from it and quietly
 * make the diff meaningless. If the doc is edited, this baseline follows.
 */
export function documentedFrigateShape(markdown: string): unknown {
  const heading = /^###\s+Frigate\b.*$/m.exec(markdown);
  if (!heading) {
    throw new Error('could not find the "### Frigate ..." heading in FARM_EVENTS.md');
  }
  const after = markdown.slice(heading.index);
  const fence = /```json\s*\n([\s\S]*?)\n```/.exec(after);
  if (!fence) {
    throw new Error('could not find a ```json block under the Frigate heading');
  }
  try {
    return JSON.parse(fence[1]) as unknown;
  } catch (err: unknown) {
    throw new Error(
      `the documented Frigate JSON block does not parse: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * The synthetic generator's Frigate payload, with `start_time` stamped the way
 * simulate.ts stamps it.
 *
 * Inlined rather than importing `stampTimestamps` -- see the header note. The
 * value is arbitrary; only the PRESENCE and TYPE of the field affect a shape
 * diff, which is the whole reason a stand-in is acceptable here.
 */
export function generatorFrigateShape(): unknown {
  const scenario = SCENARIOS['normal-weekday'];
  const event = scenario.events.find((e) => e.source === 'frigate');
  if (!event) throw new Error('normal-weekday has no frigate event');

  const payload = structuredClone(event.payload);
  const epochSeconds = 1756180000.123456;
  for (const key of ['before', 'after'] as const) {
    const branch = payload[key] as Record<string, unknown> | undefined;
    if (branch) branch.start_time = epochSeconds;
  }
  return payload;
}

// --- capture loading --------------------------------------------------------

export interface LoadedCapture {
  /** Every record in the file, in order. */
  records: CaptureRecord[];
  /** Records whose payload looks like a Frigate event envelope. */
  events: Record<string, unknown>[];
  unparsed: number;
  /** Records that parsed but carry no `type` -- e.g. `frigate/<cam>/person`
   * counts picked up by a `frigate/#` discovery run. */
  nonEvents: number;
  firstReceivedMs: number;
  lastReceivedMs: number;
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

  const events: Record<string, unknown>[] = [];
  let unparsed = 0;
  let nonEvents = 0;
  for (const r of records) {
    if (r.unparsed !== undefined || r.payload === null) {
      unparsed += 1;
      continue;
    }
    const p = r.payload as Record<string, unknown>;
    if (typeof p === 'object' && !Array.isArray(p) && typeof p.type === 'string') {
      events.push(p);
    } else {
      nonEvents += 1;
    }
  }

  const times = records.map((r) => new Date(r.received_at).getTime()).filter((n) => !Number.isNaN(n));
  return {
    records,
    events,
    unparsed,
    nonEvents,
    firstReceivedMs: Math.min(...times),
    lastReceivedMs: Math.max(...times),
  };
}

// --- normalization pass -----------------------------------------------------

interface NormalizationTally {
  created: number;
  skipped: Map<string, number>;
  rejected: Map<string, number>;
  rows: {
    camera_id: string;
    zone: string | null;
    confidence: number | null;
    occurred_at: string;
    source_event_id: string | null;
  }[];
}

/** Run every captured payload through the REAL ingest normalizer.
 *
 * This is what open decision 1 asks for -- the capture is exercised by the
 * genuine confidence/zone-null handling, not by a copy of it -- while the
 * output stays in memory and never reaches SQLite. `isSynthetic: false`
 * because these are real webhook-equivalent payloads; per finding 5 that is
 * also what a real webhook would produce, so the resulting rows are a faithful
 * preview of what ingestion WOULD have written. */
export function normalizeAll(events: Record<string, unknown>[]): NormalizationTally {
  const tally: NormalizationTally = {
    created: 0,
    skipped: new Map(),
    rejected: new Map(),
    rows: [],
  };
  for (const payload of events) {
    const result: IngestResult = normalizeFrigate(payload, { isSynthetic: false });
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
        occurred_at: e.occurred_at,
        source_event_id: e.source_event_id,
      });
    }
  }
  return tally;
}

// --- definition of done -----------------------------------------------------

interface Check {
  label: string;
  pass: boolean;
  detail: string;
}

/**
 * The tightened success criterion (open decision 4), replacing "zero parse
 * errors" entirely.
 *
 * The original criterion could not fail on the most likely defect: finding 2
 * proved the endpoint returns 201 while writing `confidence = NULL` when
 * `after.score`/`after.top_score` are absent. So every check below asserts on a
 * VALUE, not on a status code.
 */
export function dodChecks(tally: NormalizationTally, cap: LoadedCapture): Check[] {
  const rows = tally.rows;
  const n = rows.length;
  const lower = cap.firstReceivedMs - MAX_EVENT_AGE_MS;
  const upper = cap.lastReceivedMs + MAX_CLOCK_SKEW_MS;

  const nullConfidence = rows.filter((r) => r.confidence === null);
  const outOfRange = rows.filter((r) => r.confidence !== null && (r.confidence < 0 || r.confidence > 1));
  const outsideWindow = rows.filter((r) => {
    const ms = new Date(r.occurred_at).getTime();
    return Number.isNaN(ms) || ms < lower || ms > upper;
  });
  const noSourceId = rows.filter((r) => !r.source_event_id);
  const wrongCamera = [...new Set(rows.map((r) => r.camera_id))].filter((c) => c !== EXPECTED_CAMERA);
  const withZone = rows.filter((r) => r.zone !== null);

  return [
    {
      label: 'at least one row was created',
      pass: n > 0,
      detail: `${n} row(s)`,
    },
    {
      label: 'every row has a non-null confidence',
      pass: n > 0 && nullConfidence.length === 0,
      detail:
        nullConfidence.length === 0
          ? `${n}/${n}`
          : `${n - nullConfidence.length}/${n} — ${nullConfidence.length} NULL. ` +
            'Frigate is not sending after.score / after.top_score where ingest.ts reads them.',
    },
    {
      label: 'every confidence is inside 0..1',
      pass: outOfRange.length === 0,
      detail: outOfRange.length === 0 ? `${n}/${n}` : `${outOfRange.length} outside 0..1`,
    },
    {
      label: 'every occurred_at is inside the capture window',
      pass: n > 0 && outsideWindow.length === 0,
      detail:
        outsideWindow.length === 0
          ? `${n}/${n} within [${new Date(lower).toISOString()} .. ${new Date(upper).toISOString()}]`
          : `${outsideWindow.length} outside — first offender ${outsideWindow[0].occurred_at}`,
    },
    {
      label: 'every row has a non-empty source_event_id',
      pass: n > 0 && noSourceId.length === 0,
      detail: noSourceId.length === 0 ? `${n}/${n}` : `${noSourceId.length} missing`,
    },
    {
      label: `every row's camera_id is "${EXPECTED_CAMERA}"`,
      pass: n > 0 && wrongCamera.length === 0,
      detail:
        wrongCamera.length === 0
          ? `${n}/${n}`
          : `unexpected camera_id(s): ${wrongCamera.join(', ')} — these would not be separable from farm cameras`,
    },
    {
      label: 'zone is NULL on every row (classification rule 1 unreachable)',
      pass: withZone.length === 0,
      detail:
        withZone.length === 0
          ? `${n}/${n}`
          : `${withZone.length} row(s) carry a zone: ${[...new Set(withZone.map((r) => r.zone))].join(', ')} — ` +
            'zones are configured in Frigate; remove them or RESTRICTED_ZONES becomes reachable',
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

function envelopeSummary(real: AggregateShape, documented: AggregateShape): void {
  // The `after` subtree is where the headline diff runs, so the top level gets
  // its own one-line summary rather than being silently excluded.
  const topLevel = (s: AggregateShape): string[] =>
    [...s.paths.keys()].filter((p) => !p.includes('.') && !p.includes('[')).sort();
  console.log(`  documented envelope keys: ${topLevel(documented).join(', ')}`);
  console.log(`  real envelope keys:       ${topLevel(real).join(', ')}`);
}

interface Args {
  capture: string;
  help: boolean;
}

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

const USAGE = `Diff a real Frigate MQTT capture against the documented payload shape.

  npm run verify:payload -w server -- --capture=<path to .jsonl>

Produce a capture first:
  npm run capture:frigate -w server -- --minutes=120

Never opens dairy.db.`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.capture) {
    console.log(USAGE);
    if (!args.help) process.exitCode = 1;
    return;
  }

  const cap = loadCapture(readFileSync(args.capture, 'utf8'));
  const documented = shapeOf(documentedFrigateShape(readFileSync(DOC_PATH, 'utf8')));
  const generator = shapeOf(generatorFrigateShape());
  const real = aggregateShapes(cap.events);

  const byType = new Map<string, number>();
  const cameras = new Set<string>();
  for (const e of cap.events) {
    byType.set(String(e.type), (byType.get(String(e.type)) ?? 0) + 1);
    const camera = (e.after as { camera?: unknown } | undefined)?.camera;
    if (typeof camera === 'string') cameras.add(camera);
  }

  console.log('Frigate payload shape — real vs documented');
  console.log('==========================================\n');
  console.log(`Capture: ${args.capture}`);
  console.log(`  ${cap.records.length} message(s): ${cap.events.length} event envelope(s), ` +
    `${cap.nonEvents} non-event, ${cap.unparsed} unparsed`);
  console.log(`  by type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(' ') || '(none)'}`);
  console.log(`  cameras: ${[...cameras].join(', ') || '(none)'}`);
  console.log(
    `  window:  ${new Date(cap.firstReceivedMs).toISOString()} .. ${new Date(cap.lastReceivedMs).toISOString()}`,
  );

  if (cap.events.length === 0) {
    console.log('\nNo Frigate event envelopes in this capture — nothing to diff.');
    process.exitCode = 1;
    return;
  }

  console.log('\nEnvelope');
  envelopeSummary(real, documented);

  // Scoped to `after`: the only branch the normalizer reads, and the only one
  // FARM_EVENTS.md documents in full (it elides `before` as a placeholder).
  printDeltas('Baseline A — FARM_EVENTS.md § "Frigate — frigate/events envelope"  [after.*]',
    diffShapes(real, documented, 'after'));
  printDeltas('Baseline B — synthetic generator (scenarios.ts normal-weekday)  [after.*]',
    diffShapes(real, generator, 'after'));

  const tally = normalizeAll(cap.events);
  console.log('\nNormalization through the real ingest logic (normalizeFrigate)');
  console.log(`  created:  ${tally.created} row(s)`);
  console.log(
    `  skipped:  ${[...tally.skipped].map(([r, n]) => `${r}=${n}`).join(' ') || 'none'}`,
  );
  console.log(
    `  rejected: ${[...tally.rejected].map(([r, n]) => `${r}=${n}`).join(' ') || 'none'}`,
  );

  console.log('\nDefinition of done (tightened — open decision 4)');
  const checks = dodChecks(tally, cap);
  for (const c of checks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.label.padEnd(58)} ${c.detail}`);
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
