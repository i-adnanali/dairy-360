// Farm event pipeline verification (Cycle 4; see docs/FARM_EVENTS.md).
//
//   npm run verify:farm -w server            # all scenarios
//   npm run verify:farm -w server -- --scenario=camera-dropout
//
// Per scenario: clear farm_events, replay it through the live endpoints, query
// SQLite directly, and assert against the scenario's declared expectation.
// Exits 0 for a clean full set, non-zero with a printed diff otherwise.
//
// This checks PIPELINE INTEGRITY only -- there is no agent behavior to assert
// against yet. It is deliberately NOT named *.test.ts: it needs a live server,
// so it must stay a local command rather than something the existing
// `npm test -w server` CI step picks up and runs unconditionally.
//
// Scoping is by resetFarmEvents() per scenario against the shared dev database
// (Decision 6) -- the same "reset your own data" approach the Cycle 3
// regression suite takes with seed(), not a second database file.

import { allFarmEvents, resetFarmEvents } from '../db';
import type { FarmEvent } from '@dairy/shared';
import { replayScenario, scenarioStartMs } from './simulate';
import type { ExpectedRow, Scenario } from './scenarios';
import { SCENARIOS, SCENARIO_NAMES, scenarioSpanDays } from './scenarios';

const DEFAULT_BASE_URL = process.env.FARM_BASE_URL ?? 'http://localhost:4000';

/** Comparable fields of a row, in a stable order, for multiset matching. */
const MATCH_FIELDS = ['event_type', 'camera_id', 'zone', 'identity', 'confidence'] as const;

function rowKey(row: ExpectedRow | FarmEvent): string {
  return MATCH_FIELDS.map((f) => JSON.stringify((row as Record<string, unknown>)[f] ?? null)).join(
    ' | ',
  );
}

interface ScenarioReport {
  name: string;
  failures: string[];
  rowsFound: number;
}

// --- assertions -------------------------------------------------------------

/**
 * Match expected rows against actual as a MULTISET, not a sequence. Rows from
 * one Double Take POST share an occurred_at and carry random primary keys, so
 * their relative order is not deterministic and asserting on it would be
 * testing SQLite's tie-breaking rather than the pipeline.
 */
function diffRows(expected: ExpectedRow[], actual: FarmEvent[]): string[] {
  const failures: string[] = [];
  const remaining = new Map<string, number>();
  for (const row of actual) {
    const k = rowKey(row);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const unmatched: string[] = [];
  for (const exp of expected) {
    const k = rowKey(exp);
    const n = remaining.get(k) ?? 0;
    if (n === 0) unmatched.push(k);
    else remaining.set(k, n - 1);
  }
  for (const k of unmatched) failures.push(`expected row not found: ${k}`);
  for (const [k, n] of remaining) {
    if (n > 0) failures.push(`unexpected row (x${n}): ${k}`);
  }
  return failures;
}

function checkWindow(scenario: Scenario, days: number, actual: FarmEvent[]): string[] {
  const failures: string[] = [];
  const startMs = scenarioStartMs(days, scenario.startTime);
  const maxOffset = scenario.events.reduce((m, e) => Math.max(m, e.offsetMs), 0);
  // Generous upper bound: the last event's instant. Lower bound: the start.
  const from = startMs;
  const to = startMs + maxOffset;
  const now = Date.now();

  for (const row of actual) {
    const occurred = new Date(row.occurred_at).getTime();
    if (Number.isNaN(occurred)) {
      failures.push(`occurred_at is not parseable: ${row.occurred_at}`);
      continue;
    }
    if (occurred < from || occurred > to) {
      failures.push(
        `occurred_at ${row.occurred_at} outside the scenario window ` +
          `[${new Date(from).toISOString()} .. ${new Date(to).toISOString()}]`,
      );
    }
    if (occurred > now) {
      failures.push(`occurred_at ${row.occurred_at} is in the future`);
    }
    const ingested = new Date(row.ingested_at).getTime();
    if (Number.isNaN(ingested)) {
      failures.push(`ingested_at is not parseable: ${row.ingested_at}`);
    } else if (ingested < occurred) {
      failures.push(
        `ingested_at ${row.ingested_at} precedes occurred_at ${row.occurred_at}`,
      );
    }
    if (!row.occurred_at.endsWith('Z') || !row.ingested_at.endsWith('Z')) {
      failures.push(
        `timestamps must be ISO-8601 UTC: occurred_at=${row.occurred_at} ingested_at=${row.ingested_at}`,
      );
    }
  }
  return failures;
}

function checkAbsences(scenario: Scenario, days: number, actual: FarmEvent[]): string[] {
  const failures: string[] = [];
  const absences = scenario.expect.absences ?? [];
  if (absences.length === 0) return failures;
  const startMs = scenarioStartMs(days, scenario.startTime);

  for (const absence of absences) {
    const cutoff = startMs + absence.afterOffsetMs;
    const offenders = actual.filter(
      (r) =>
        r.camera_id === absence.camera_id &&
        (absence.zone === undefined || r.zone === absence.zone) &&
        new Date(r.occurred_at).getTime() > cutoff,
    );
    if (offenders.length > 0) {
      failures.push(
        `expected silence from ${absence.camera_id} after ${new Date(cutoff).toISOString()}, ` +
          `found ${offenders.length} row(s): ${offenders.map((o) => o.occurred_at).join(', ')}`,
      );
    }
    // A dropout assertion is vacuous unless something else kept reporting --
    // "no barn rows" is equally true when ingestion is simply broken.
    const controls = actual.filter(
      (r) => r.camera_id !== absence.camera_id && new Date(r.occurred_at).getTime() > cutoff,
    );
    if (controls.length === 0) {
      failures.push(
        `no control-camera rows after ${new Date(cutoff).toISOString()} — the absence ` +
          `assertion for ${absence.camera_id} would pass even with ingestion broken`,
      );
    }
  }
  return failures;
}

function checkAbsentIdentities(scenario: Scenario, actual: FarmEvent[]): string[] {
  const failures: string[] = [];
  for (const identity of scenario.expect.absentIdentities ?? []) {
    const hits = actual.filter((r) => r.identity === identity);
    if (hits.length > 0) {
      failures.push(`identity "${identity}" was expected to be absent, found ${hits.length} row(s)`);
    }
  }
  return failures;
}

// --- per-scenario run -------------------------------------------------------

async function verifyScenario(
  scenario: Scenario,
  days: number,
  baseUrl: string,
): Promise<ScenarioReport> {
  const report: ScenarioReport = { name: scenario.name, failures: [], rowsFound: 0 };

  resetFarmEvents();

  const replay = await replayScenario(scenario, {
    days,
    baseUrl,
    log: () => {}, // quiet: this script prints its own per-scenario summary
  });
  report.failures.push(...replay.failures);

  const actual = allFarmEvents();
  report.rowsFound = actual.length;

  if (actual.length !== scenario.expect.rowCount) {
    report.failures.push(
      `row count: expected ${scenario.expect.rowCount}, found ${actual.length}`,
    );
  }
  if (scenario.expect.rows) {
    report.failures.push(...diffRows(scenario.expect.rows, actual));
  }

  // Every generated row must be flagged synthetic (from the header).
  const notSynthetic = actual.filter((r) => !r.is_synthetic);
  if (notSynthetic.length > 0) {
    report.failures.push(`${notSynthetic.length} row(s) have is_synthetic = 0`);
  }
  // Confidence, whatever the source sent, is stored on one scale.
  for (const row of actual) {
    if (row.confidence !== null && (row.confidence < 0 || row.confidence > 1)) {
      report.failures.push(`confidence ${row.confidence} is outside 0..1`);
    }
  }
  // Every row keeps its source correlation key and its original payload.
  for (const row of actual) {
    if (!row.source_event_id) report.failures.push(`row ${row.id} has no source_event_id`);
    try {
      JSON.parse(row.raw_payload);
    } catch {
      report.failures.push(`row ${row.id} has unparseable raw_payload`);
    }
  }

  report.failures.push(...checkWindow(scenario, days, actual));
  report.failures.push(...checkAbsences(scenario, days, actual));
  report.failures.push(...checkAbsentIdentities(scenario, actual));

  return report;
}

// --- rejection checks (DoD #6) ----------------------------------------------

interface RejectionCase {
  label: string;
  path: string;
  body: unknown;
  expectStatus: number;
  expectError?: string;
  expectReason?: string;
}

const REJECTION_CASES: RejectionCase[] = [
  // A bare JSON string never reaches the handler: express.json() is strict by
  // default and only accepts an object or array at the top level. Still a 400,
  // just body-parser's rather than ours -- so only the status is asserted.
  { label: 'frigate: bare JSON string (body-parser)', path: '/api/webhooks/frigate', body: 'nope', expectStatus: 400 },
  // An array DOES get past body-parser, so this exercises our own guard.
  { label: 'frigate: array instead of object', path: '/api/webhooks/frigate', body: [], expectStatus: 400, expectError: 'invalid_payload' },
  { label: 'frigate: missing type', path: '/api/webhooks/frigate', body: {}, expectStatus: 400, expectError: 'missing_field' },
  { label: 'frigate: bogus type', path: '/api/webhooks/frigate', body: { type: 'deleted', after: {} }, expectStatus: 400, expectError: 'invalid_type' },
  { label: 'frigate: missing after', path: '/api/webhooks/frigate', body: { type: 'new' }, expectStatus: 400, expectError: 'missing_field' },
  { label: 'frigate: missing camera', path: '/api/webhooks/frigate', body: { type: 'new', after: { id: 'e', label: 'person', start_time: 1787000000 } }, expectStatus: 400, expectError: 'missing_field' },
  { label: 'frigate: epoch ms mistaken for seconds', path: '/api/webhooks/frigate', body: { type: 'new', after: { id: 'e', camera: 'c', label: 'person', start_time: 1787000000000 } }, expectStatus: 400, expectError: 'invalid_timestamp' },
  { label: 'frigate: update is a no-op', path: '/api/webhooks/frigate', body: { type: 'update', after: { id: 'e', camera: 'c', label: 'person', start_time: 1787000000 } }, expectStatus: 202, expectReason: 'update' },
  { label: 'double-take: missing timestamp', path: '/api/webhooks/double-take', body: { id: 'e', camera: 'c', matches: [] }, expectStatus: 400, expectError: 'missing_field' },
  { label: 'double-take: unparseable timestamp', path: '/api/webhooks/double-take', body: { id: 'e', camera: 'c', timestamp: 'yesterday', matches: [] }, expectStatus: 400, expectError: 'invalid_timestamp' },
  { label: 'double-take: no face arrays', path: '/api/webhooks/double-take', body: { id: 'e', camera: 'c', timestamp: '2026-08-21T02:14:03.695Z' }, expectStatus: 400, expectError: 'invalid_payload' },
  { label: 'double-take: nameless face', path: '/api/webhooks/double-take', body: { id: 'e', camera: 'c', timestamp: '2026-08-21T02:14:03.695Z', unknowns: [{ confidence: 5 }] }, expectStatus: 400, expectError: 'missing_field' },
  { label: 'double-take: empty faces is a no-op', path: '/api/webhooks/double-take', body: { id: 'e', camera: 'c', timestamp: '2026-08-21T02:14:03.695Z', matches: [], misses: [], unknowns: [] }, expectStatus: 202, expectReason: 'no_faces' },
];

async function verifyRejections(baseUrl: string): Promise<string[]> {
  const failures: string[] = [];
  resetFarmEvents();

  for (const c of REJECTION_CASES) {
    const res = await fetch(`${baseUrl}${c.path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Synthetic-Source': 'simulator' },
      body: JSON.stringify(c.body),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* non-JSON body */
    }
    if (res.status !== c.expectStatus) {
      failures.push(`${c.label}: expected ${c.expectStatus}, got ${res.status} ${text.slice(0, 120)}`);
      continue;
    }
    if (c.expectError && body.error !== c.expectError) {
      failures.push(`${c.label}: expected error "${c.expectError}", got "${String(body.error)}"`);
    }
    if (c.expectReason && body.reason !== c.expectReason) {
      failures.push(`${c.label}: expected reason "${c.expectReason}", got "${String(body.reason)}"`);
    }
  }

  // Nothing above may have written a row.
  const leaked = allFarmEvents();
  if (leaked.length > 0) {
    failures.push(`${leaked.length} row(s) were written by rejected/no-op payloads`);
  }
  return failures;
}

// --- CLI --------------------------------------------------------------------

async function assertServerReachable(baseUrl: string): Promise<void> {
  try {
    // An unseeded DB answers 503 here; that is still "reachable and fine" --
    // ingestion does not depend on dairy seed data.
    await fetch(`${baseUrl}/api/health`);
  } catch {
    throw new Error(
      `cannot reach ${baseUrl}. Start the server first:\n  npm run dev -w server`,
    );
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let only: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    if (flag === '--scenario') only = value;
    else if (flag === '--base-url') baseUrl = value ?? DEFAULT_BASE_URL;
    else throw new Error(`unknown argument: ${raw}`);
  }

  await assertServerReachable(baseUrl);

  const names = only ? [only] : SCENARIO_NAMES;
  for (const n of names) {
    if (!SCENARIOS[n]) {
      throw new Error(`unknown scenario "${n}". Known: ${SCENARIO_NAMES.join(', ')}`);
    }
  }

  // Backdate far enough that even the widest scenario stays in the past.
  const days = Math.max(...SCENARIO_NAMES.map((n) => scenarioSpanDays(SCENARIOS[n]))) + 1;

  console.log(`Verifying ${names.length} scenario(s) against ${baseUrl} (--days-ago=${days})\n`);

  const reports: ScenarioReport[] = [];
  for (const n of names) {
    const report = await verifyScenario(SCENARIOS[n], days, baseUrl);
    reports.push(report);
    const status = report.failures.length === 0 ? 'PASS' : 'FAIL';
    console.log(`  ${status}  ${n.padEnd(28)} ${report.rowsFound} row(s)`);
    for (const f of report.failures) console.log(`        - ${f}`);
  }

  console.log('');
  const rejectionFailures = await verifyRejections(baseUrl);
  const rejStatus = rejectionFailures.length === 0 ? 'PASS' : 'FAIL';
  console.log(`  ${rejStatus}  ${'payload rejection'.padEnd(28)} ${REJECTION_CASES.length} case(s)`);
  for (const f of rejectionFailures) console.log(`        - ${f}`);

  // Leave the table clean rather than with the last scenario's rows in it.
  resetFarmEvents();

  const failed = reports.filter((r) => r.failures.length > 0).length;
  const total = reports.length + 1; // + the rejection suite
  const passed = total - failed - (rejectionFailures.length > 0 ? 1 : 0);
  console.log(`\n${passed}/${total} checks passed`);

  if (failed > 0 || rejectionFailures.length > 0) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
