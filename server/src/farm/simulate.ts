// Farm event generator / simulator (Cycle 4; see docs/FARM_EVENTS.md).
//
//   npm run simulate:farm -w server -- --scenario=night-visitor-unknown --days-ago=3
//   npm run simulate:farm -w server -- --all --days-ago=14
//
// Replays a scenario through the REAL ingestion endpoints over HTTP rather than
// writing to SQLite directly, so the normalizer gets genuine coverage now.
//
// Burst mode: POSTs go out immediately with correct backdated timestamps and no
// artificial delay. A slowed-down "watch it happen" replay is a Cycle 5
// frontend concern, not a generator one.
//
// replayScenario() is exported so verify.ts can drive it in-process instead of
// shelling out -- one implementation of the replay logic, not two.

import { daysAgo } from '../seed';
import type { Scenario, ScenarioEvent } from './scenarios';
import { SCENARIOS, SCENARIO_NAMES, scenarioSpanDays } from './scenarios';

const DEFAULT_BASE_URL = process.env.FARM_BASE_URL ?? 'http://localhost:4000';
const DEFAULT_DAYS_AGO = 14;

/** Set on every generated request so the endpoint can mark rows
 * is_synthetic = 1. Never a payload field -- that would diverge the synthetic
 * payload shape from the real one. */
const SYNTHETIC_HEADER = 'X-Synthetic-Source';
const SYNTHETIC_VALUE = 'simulator';

const PATHS: Record<string, string> = {
  frigate: '/api/webhooks/frigate',
  double_take: '/api/webhooks/double-take',
};

// --- timeline ---------------------------------------------------------------

/**
 * The absolute instant a scenario starts, in epoch ms.
 *
 * `daysAgo()` (reused from the seed, so farm timestamps line up with dairy
 * dates) yields a local 'YYYY-MM-DD'; combining it with 'HH:MM:SS' and no zone
 * designator makes JS parse the result in the HOST's local timezone, which is
 * the documented interpretation (FARM_EVENTS.md § Timekeeping).
 */
export function scenarioStartMs(days: number, startTime: string): number {
  const ms = new Date(`${daysAgo(days)}T${startTime}`).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`invalid scenario startTime: ${startTime}`);
  }
  return ms;
}

/** Stamp the timestamp field(s) this source actually uses, in its native
 * format: epoch float seconds for Frigate, ISO-8601 for Double Take. Returns a
 * deep clone so the scenario consts are never mutated across runs. */
export function stampTimestamps(event: ScenarioEvent, instantMs: number): Record<string, unknown> {
  const payload = structuredClone(event.payload);
  if (event.source === 'frigate') {
    const epochSeconds = instantMs / 1000;
    const after = payload.after as Record<string, unknown> | undefined;
    if (after) after.start_time = epochSeconds;
    // Kept consistent with `after` purely for payload fidelity; the normalizer
    // reads only `after`.
    const before = payload.before as Record<string, unknown> | undefined;
    if (before) before.start_time = epochSeconds;
  } else {
    payload.timestamp = new Date(instantMs).toISOString();
  }
  return payload;
}

// --- replay -----------------------------------------------------------------

export interface ReplayResult {
  scenario: string;
  posted: number;
  created: number;
  skipped: number;
  failures: string[];
}

export interface ReplayOptions {
  days: number;
  baseUrl?: string;
  log?: (message: string) => void;
}

export async function replayScenario(
  scenario: Scenario,
  opts: ReplayOptions,
): Promise<ReplayResult> {
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const log = opts.log ?? ((m: string) => console.log(m));
  const result: ReplayResult = {
    scenario: scenario.name,
    posted: 0,
    created: 0,
    skipped: 0,
    failures: [],
  };

  const startMs = scenarioStartMs(opts.days, scenario.startTime);
  const now = Date.now();

  // Guard before posting anything: a scenario spanning several days forward
  // from the anchor (recurring-unknown-visitor) will run into the future if
  // --days-ago is too small, and a future occurred_at fails the DoD outright.
  const span = scenarioSpanDays(scenario);
  for (const event of scenario.events) {
    if (startMs + event.offsetMs > now) {
      throw new Error(
        `${scenario.name}: event at +${event.offsetMs}ms lands in the future ` +
          `(--days-ago=${opts.days} is too small; this scenario spans ${span} day(s), ` +
          `so use --days-ago=${Math.max(span, opts.days + span)} or more)`,
      );
    }
  }

  log(
    `\n[${scenario.name}] ${scenario.events.length} event(s), start ${new Date(startMs).toISOString()}`,
  );

  for (const event of scenario.events) {
    const instantMs = startMs + event.offsetMs;
    const payload = stampTimestamps(event, instantMs);
    const url = `${baseUrl}${PATHS[event.source]}`;
    const tag = `${scenario.name} +${event.offsetMs}ms ${event.source}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [SYNTHETIC_HEADER]: SYNTHETIC_VALUE,
        },
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      result.failures.push(`${tag}: request failed (${message})`);
      log(`  [fail] ${tag} -> ${message}`);
      continue;
    }

    result.posted += 1;
    const bodyText = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      // non-JSON error body (e.g. body-parser's own 400 page)
    }

    if (res.status === 201) {
      const inserted = Number(body.inserted ?? 0);
      result.created += inserted;
      log(`  [ok]   ${tag} -> 201 inserted=${inserted}`);
    } else if (res.status === 202) {
      result.skipped += 1;
      log(`  [skip] ${tag} -> 202 reason=${String(body.reason ?? '?')}`);
    } else {
      result.failures.push(`${tag}: unexpected ${res.status} ${bodyText.slice(0, 200)}`);
      log(`  [fail] ${tag} -> ${res.status} ${bodyText.slice(0, 200)}`);
    }
  }

  return result;
}

// --- CLI --------------------------------------------------------------------

interface Args {
  scenario?: string;
  all: boolean;
  days: number;
  baseUrl: string;
  help: boolean;
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    all: false,
    days: DEFAULT_DAYS_AGO,
    baseUrl: DEFAULT_BASE_URL,
    help: false,
  };
  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    switch (flag) {
      case '--all':
        args.all = true;
        break;
      case '--scenario':
        args.scenario = value;
        break;
      case '--days-ago':
        args.days = Number(value);
        break;
      case '--base-url':
        args.baseUrl = value ?? DEFAULT_BASE_URL;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${raw}`);
    }
  }
  return args;
}

const USAGE = `Replay synthetic farm events through the live ingestion endpoints.

  npm run simulate:farm -w server -- --scenario=<name> [--days-ago=n]
  npm run simulate:farm -w server -- --all [--days-ago=n]

  --scenario=<name>  one of: ${SCENARIO_NAMES.join(', ')}
  --all              replay every scenario, in registry order
  --days-ago=<n>     backdate the scenario start by n days (default ${DEFAULT_DAYS_AGO})
  --base-url=<url>   server to POST to (default ${DEFAULT_BASE_URL})

Requires a running server: npm run dev -w server`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }
  if (!args.all && !args.scenario) {
    throw new Error(`pass --scenario=<name> or --all\n\n${USAGE}`);
  }
  if (!Number.isFinite(args.days) || args.days < 0) {
    throw new Error(`--days-ago must be a non-negative number, got: ${args.days}`);
  }

  const selected = args.all
    ? SCENARIO_NAMES.map((n) => SCENARIOS[n])
    : [SCENARIOS[args.scenario as string]];

  if (!args.all && !selected[0]) {
    throw new Error(
      `unknown scenario "${args.scenario}". Known: ${SCENARIO_NAMES.join(', ')}`,
    );
  }

  const results: ReplayResult[] = [];
  for (const scenario of selected) {
    results.push(await replayScenario(scenario, { days: args.days, baseUrl: args.baseUrl }));
  }

  const created = results.reduce((s, r) => s + r.created, 0);
  const skipped = results.reduce((s, r) => s + r.skipped, 0);
  const failures = results.flatMap((r) => r.failures);
  console.log(
    `\n${results.length} scenario(s): ${created} row(s) created, ${skipped} skipped, ${failures.length} failure(s)`,
  );
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    process.exitCode = 1;
  }
}

// Auto-run only when invoked as a script, not when imported by verify.ts --
// the same guard seed.ts uses.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
