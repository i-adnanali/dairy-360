// Farm event CLASSIFICATION verification (Cycle 5; see docs/FARM_MONITOR.md).
//
//   npm run verify:classify -w server            # all scenarios
//   npm run verify:classify -w server -- --scenario=camera-dropout
//
// Per scenario: clear farm_events, replay it through the live endpoints, run
// summarize_daily_activity over every farm-local day it spans, then assert the
// persisted severities and the reconciliation findings against
// classify.expectations.ts. Exits 0 for a clean full set, non-zero with a
// printed diff otherwise.
//
// A sibling of verify.ts, not a replacement: that script proves PIPELINE
// integrity (do the right rows land), this one proves MEANING (do the right
// verdicts come out). Both are deliberately NOT *.test.ts -- they need a live
// server, so they stay local commands rather than something `npm test -w
// server` picks up unconditionally.
//
// Scoping is resetFarmEvents() per scenario. That is not a convenience here,
// it is REQUIRED: UNKNOWN_CLUSTER_A1 appears in two scenarios, so a shared
// table gives that cluster four sightings in one lookback window and corrupts
// every occurrence number (FARM_MONITOR.md Decision 2, standing rule).

import { farmEventsInRange, resetFarmEvents } from '../db';
import type { FarmEvent } from '@dairy/shared';
import { farmDayBoundsUtc, farmLocalDate } from './classify';
import type { ClassifyExpectation, ExpectedSeverityRow } from './classify.expectations';
import { CLASSIFY_EXPECTATIONS } from './classify.expectations';
import { replayScenario } from './simulate';
import { SCENARIOS, SCENARIO_NAMES, scenarioSpanDays } from './scenarios';
import { summarizeDailyActivity, type CameraFinding } from '../tools/farmReads';

const DEFAULT_BASE_URL = process.env.FARM_BASE_URL ?? 'http://localhost:6400';

interface ScenarioReport {
  name: string;
  failures: string[];
  rowsFound: number;
  daysSummarized: number;
}

// --- digest shape (what summarizeDailyActivity returns in modelDigest) ------

interface Digest {
  date: string;
  events_examined: number;
  newly_classified: number;
  severities: { routine: number; notable: number; urgent: number };
  flagged: { id: string; flag_severity: string; flag_reason: string }[];
  attendance: { enrolled: string[]; seen: string[]; absent: string[] };
  cameras: CameraFinding[];
}

// --- assertions -------------------------------------------------------------

/** Comparable fields of a classified row, in a stable order, for multiset
 * matching -- verify.ts's MATCH_FIELDS plus the verdict. */
function rowKey(row: {
  event_type: string;
  camera_id: string;
  zone: string | null;
  identity: string | null;
  confidence: number | null;
  severity: string;
  reason: string | null;
}): string {
  return [
    row.event_type,
    row.camera_id,
    row.zone ?? 'null',
    row.identity ?? 'null',
    row.confidence ?? 'null',
    row.severity,
    row.reason ?? 'null',
  ].join(' | ');
}

function actualKey(e: FarmEvent): string {
  return rowKey({
    event_type: e.event_type,
    camera_id: e.camera_id,
    zone: e.zone,
    identity: e.identity,
    confidence: e.confidence,
    // A routine row is `flagged = 0, flag_severity = NULL`; severity is derived
    // rather than stored, which is exactly the distinction classified_at makes
    // meaningful.
    severity: e.flag_severity ?? 'routine',
    reason: e.flag_reason,
  });
}

function diffRows(expected: ExpectedSeverityRow[], actual: FarmEvent[]): string[] {
  const failures: string[] = [];
  const remaining = new Map<string, number>();
  for (const row of actual) {
    const k = actualKey(row);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  const unmatched: string[] = [];
  for (const exp of expected) {
    const k = rowKey(exp);
    const n = remaining.get(k) ?? 0;
    if (n === 0) unmatched.push(k);
    else remaining.set(k, n - 1);
  }
  for (const k of unmatched) failures.push(`expected verdict not found: ${k}`);
  for (const [k, n] of remaining) {
    if (n > 0) failures.push(`unexpected verdict (x${n}): ${k}`);
  }
  return failures;
}

/** DoD #1: every row the classifier touched carries classified_at, so a
 * routine row is distinguishable from one nobody has looked at. */
function checkClassifiedAt(actual: FarmEvent[]): string[] {
  const failures: string[] = [];
  const unexamined = actual.filter((r) => r.classified_at === null);
  if (unexamined.length > 0) {
    failures.push(`${unexamined.length} row(s) have classified_at = NULL after the pass`);
  }
  for (const r of actual) {
    if (r.classified_at && !r.classified_at.endsWith('Z')) {
      failures.push(`classified_at must be ISO-8601 UTC, got ${r.classified_at}`);
    }
    // The flag columns must agree with each other in both directions.
    if (r.flagged && (!r.flag_severity || !r.flag_reason)) {
      failures.push(`row ${r.id} is flagged but missing severity/reason`);
    }
    if (!r.flagged && (r.flag_severity || r.flag_reason)) {
      failures.push(`row ${r.id} is not flagged but carries severity/reason`);
    }
  }
  return failures;
}

function checkSeverityCounts(
  expected: ClassifyExpectation['severities'],
  actual: FarmEvent[],
): string[] {
  const counts = { routine: 0, notable: 0, urgent: 0 };
  for (const r of actual) {
    if (r.flag_severity === 'urgent') counts.urgent += 1;
    else if (r.flag_severity === 'notable') counts.notable += 1;
    else counts.routine += 1;
  }
  const failures: string[] = [];
  for (const key of ['routine', 'notable', 'urgent'] as const) {
    if (counts[key] !== expected[key]) {
      failures.push(`${key}: expected ${expected[key]}, found ${counts[key]}`);
    }
  }
  return failures;
}

function checkAttendance(expected: string[], digests: Digest[]): string[] {
  const failures: string[] = [];
  // Union across days: an identity seen on any day of a multi-day scenario is
  // not absent from the scenario.
  const absentEveryDay = expected.filter((id) =>
    digests.every((d) => d.attendance.absent.includes(id)),
  );
  const missing = expected.filter((id) => !absentEveryDay.includes(id));
  if (missing.length > 0) {
    failures.push(
      `expected absent on every day but were not: ${missing.join(', ')} ` +
        `(absent per day: ${digests.map((d) => `${d.date}=[${d.attendance.absent.join(',')}]`).join(' ')})`,
    );
  }
  // And nothing unexpected in the absent list -- a scenario that stops
  // producing a sighting should fail here, not pass quietly.
  for (const d of digests) {
    const extra = d.attendance.absent.filter((id) => !expected.includes(id));
    if (extra.length > 0) {
      failures.push(`${d.date}: unexpectedly absent: ${extra.join(', ')}`);
    }
  }
  return failures;
}

function checkCameras(expected: ClassifyExpectation['cameras'], digests: Digest[]): string[] {
  const failures: string[] = [];
  for (const d of digests) {
    const actual = d.cameras;
    if (actual.length !== expected.length) {
      failures.push(
        `${d.date}: expected ${expected.length} camera finding(s), found ${actual.length} ` +
          `(${actual.map((c) => c.camera_id).join(', ')})`,
      );
      continue;
    }
    for (const exp of expected) {
      const got = actual.find((c) => c.camera_id === exp.camera_id);
      if (!got) {
        failures.push(`${d.date}: no finding for ${exp.camera_id}`);
        continue;
      }
      if (got.events !== exp.events) {
        failures.push(
          `${d.date}: ${exp.camera_id} events: expected ${exp.events}, found ${got.events}`,
        );
      }
      if (got.silence_flagged !== exp.silence_flagged) {
        failures.push(
          `${d.date}: ${exp.camera_id} silence_flagged: expected ${exp.silence_flagged}, ` +
            `found ${got.silence_flagged} (${got.silence_minutes} min)`,
        );
      }
      if (got.control_active !== exp.control_active) {
        failures.push(
          `${d.date}: ${exp.camera_id} control_active: expected ${exp.control_active}, ` +
            `found ${got.control_active}`,
        );
      }
    }
  }
  return failures;
}

/** DoD #7: re-running the pass on the same data must not change any verdict. */
function checkReproducible(before: FarmEvent[], after: FarmEvent[]): string[] {
  const key = (rows: FarmEvent[]): string =>
    rows
      .map((r) => `${r.id}:${r.flag_severity ?? 'routine'}:${r.flag_reason ?? '-'}`)
      .sort()
      .join('\n');
  return key(before) === key(after)
    ? []
    : ['re-running classification changed at least one verdict'];
}

// --- per-scenario run -------------------------------------------------------

/** The farm-local dates a scenario's rows actually fall on, ascending. Derived
 * from the persisted rows rather than from the fixtures, so a timezone bug
 * shows up here instead of being assumed away. */
function farmDatesOf(rows: FarmEvent[]): string[] {
  return [...new Set(rows.map((r) => farmLocalDate(r.occurred_at)))].sort();
}

function summarizeDay(date: string): Digest {
  const { modelDigest } = summarizeDailyActivity({ date });
  return modelDigest as Digest;
}

/** Every row the scenario produced, across all the days it spans. */
function allRowsAcross(dates: string[]): FarmEvent[] {
  const { startIso } = farmDayBoundsUtc(dates[0]);
  const { endIso } = farmDayBoundsUtc(dates[dates.length - 1]);
  return farmEventsInRange({ startIso, endIso });
}

async function verifyScenario(
  name: string,
  days: number,
  baseUrl: string,
): Promise<ScenarioReport> {
  const scenario = SCENARIOS[name];
  const expected = CLASSIFY_EXPECTATIONS[name];
  const report: ScenarioReport = { name, failures: [], rowsFound: 0, daysSummarized: 0 };

  // REQUIRED, not tidiness -- see the header note on UNKNOWN_CLUSTER_A1.
  resetFarmEvents();

  const replay = await replayScenario(scenario, { days, baseUrl, log: () => {} });
  report.failures.push(...replay.failures);

  const ingested = farmEventsInRange({
    startIso: '0000-01-01T00:00:00.000Z',
    endIso: '9999-12-31T23:59:59.999Z',
  });
  report.rowsFound = ingested.length;
  if (ingested.length === 0) {
    report.failures.push('no rows landed; cannot classify');
    return report;
  }

  const dates = farmDatesOf(ingested);
  report.daysSummarized = dates.length;
  if (dates.length !== expected.days) {
    report.failures.push(
      `farm-local days: expected ${expected.days}, found ${dates.length} (${dates.join(', ')})`,
    );
  }

  // Ascending order matters: an unknown cluster's occurrence number counts
  // rows already classified, so summarizing the newest day first would still
  // read the same priors but would not exercise the gradient in sequence.
  const digests = dates.map((d) => summarizeDay(d));

  const classified = allRowsAcross(dates);
  report.failures.push(...checkClassifiedAt(classified));
  report.failures.push(...checkSeverityCounts(expected.severities, classified));
  report.failures.push(...diffRows(expected.rows, classified));
  report.failures.push(...checkAttendance(expected.absentIdentities, digests));
  report.failures.push(...checkCameras(expected.cameras, digests));

  // Every row was unclassified before the first pass and none after it.
  const totalNewlyClassified = digests.reduce((s, d) => s + d.newly_classified, 0);
  if (totalNewlyClassified !== classified.length) {
    report.failures.push(
      `newly_classified across days: expected ${classified.length}, got ${totalNewlyClassified}`,
    );
  }

  // DoD #7: a second pass must be a no-op.
  for (const d of dates) summarizeDay(d);
  report.failures.push(...checkReproducible(classified, allRowsAcross(dates)));
  const secondPass = dates.map((d) => summarizeDay(d));
  const reclassified = secondPass.reduce((s, d) => s + d.newly_classified, 0);
  if (reclassified !== 0) {
    report.failures.push(
      `a repeat pass reclassified ${reclassified} row(s); classified_at is not being honoured`,
    );
  }

  return report;
}

// --- CLI --------------------------------------------------------------------

async function assertServerReachable(baseUrl: string): Promise<void> {
  try {
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
    if (!CLASSIFY_EXPECTATIONS[n]) {
      throw new Error(`no classification expectation declared for "${n}"`);
    }
  }

  // Same anchor rule verify.ts uses: backdate far enough that even the widest
  // scenario stays in the past.
  const days = Math.max(...SCENARIO_NAMES.map((n) => scenarioSpanDays(SCENARIOS[n]))) + 1;

  console.log(
    `Verifying classification for ${names.length} scenario(s) against ${baseUrl} ` +
      `(--days-ago=${days}, TZ=${process.env.TZ ?? '<host>'})\n`,
  );

  const reports: ScenarioReport[] = [];
  for (const n of names) {
    const report = await verifyScenario(n, days, baseUrl);
    reports.push(report);
    const status = report.failures.length === 0 ? 'PASS' : 'FAIL';
    console.log(
      `  ${status}  ${n.padEnd(28)} ${report.rowsFound} row(s), ${report.daysSummarized} day(s)`,
    );
    for (const f of report.failures) console.log(`        - ${f}`);
  }

  // Leave the table clean, matching verify.ts.
  resetFarmEvents();

  const failed = reports.filter((r) => r.failures.length > 0).length;
  console.log(`\n${reports.length - failed}/${reports.length} scenario(s) passed`);
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
