// Live Double Take MQTT capture (Cycle 7 FU-3; see
// docs/Cycle7-fu3-double-take-validation.md).
//
//   npm run capture:doubletake -w server -- --minutes=20
//   npm run capture:doubletake -w server -- --topic='double-take/#' --minutes=5
//
// A SIBLING of captureMqtt.ts rather than a flag on it, for one reason that
// matters: this capture puts a REDACTION STEP on the write path, and the
// Frigate capture has no business carrying that. Frigate's payloads contain no
// image bytes (FU-1 verified: no string over 200 chars across 250 messages);
// Double Take's can contain a full base64 face crop.
//
// ---------------------------------------------------------------------------
// HARD CONSTRAINT 1: never import `../db` (open decision 1, inherited).
// ---------------------------------------------------------------------------
// `../db` calls `new Database(DB_PATH)` at module load, so an import alone
// opens (and on a fresh clone creates) dairy.db. That also rules out
// `./simulate` (imports ../seed, which imports ./db on its first line).
// Asserted by captureIsolation.test.ts.
//
// ---------------------------------------------------------------------------
// HARD CONSTRAINT 2: no face image is ever written to disk.
// ---------------------------------------------------------------------------
// This camera faces a street, so every face processed belongs to someone who
// has not consented. Three independent things stand between a stranger's face
// and this JSONL file, and none of them trusts the others:
//
//   1. the config pins detect.*.base64 false          (double-take/config.yml)
//   2. THIS module redacts base64 before writing      (redact.ts)
//   3. the written line is re-checked after redaction (containsInlineImage)
//
// Layer 3 exists because layer 2 could be misapplied by a future edit -- e.g.
// writing `record` instead of the redacted copy. A guard that only runs the
// thing it guards is worth very little.
//
// Redaction is SHAPE-PRESERVING (see redact.ts): a base64 string becomes a
// short sentinel string, so the deltas list still reports `base64` at type
// `string`. Deleting the key would corrupt the deliverable.

import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import mqtt from 'mqtt';
import { containsInlineImage, redactBiometrics } from './redact';
import { ALLOWED_SUBJECT, checkGallery, checkRecognition, retentionProblems } from './doubleTakeGuards';

/** Double Take publishes the full matches/misses/unknowns envelope on
 * `double-take/cameras/<camera>` and a singular-shaped payload on
 * `double-take/matches/<name>` (or `/matches/unknown`). Subscribing to the
 * whole prefix captures both plus anything undocumented, which is the point of
 * a shape-validation pass. */
const DEFAULT_TOPIC = 'double-take/#';
const DEFAULT_BROKER = process.env.FRIGATE_MQTT_URL ?? 'mqtt://localhost:1883';
const DEFAULT_MINUTES = 20;
const DEEPSTACK = process.env.DEEPSTACK_URL ?? 'http://127.0.0.1:5051';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');
const CAPTURE_DIR = path.join(__dirname, '..', '..', 'captures');
const ENROLL_DIR = path.join(REPO_ROOT, 'double-take', 'enroll');
/** The config Double Take actually loads -- gitignored, so this is the only
 * place it can be checked. doubleTakeStack.test.ts can only see the example. */
const LIVE_CONFIG = path.join(REPO_ROOT, 'double-take', 'config.yml');

export interface CaptureRecord {
  received_at: string;
  topic: string;
  payload: unknown;
  unparsed?: string;
  /** Shape paths redacted in this record, if any. Recorded IN the capture so
   * the artifact is self-describing: a reader can see that redaction happened
   * and where, rather than having to trust that it did. */
  redacted?: string[];
}

interface Args {
  broker: string;
  topic: string;
  minutes: number;
  max: number;
  out: string;
  skipPreflight: boolean;
  help: boolean;
}

function defaultOutPath(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(CAPTURE_DIR, `double-take-${stamp}.jsonl`);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    broker: DEFAULT_BROKER,
    topic: DEFAULT_TOPIC,
    minutes: DEFAULT_MINUTES,
    max: Number.POSITIVE_INFINITY,
    out: '',
    skipPreflight: false,
    help: false,
  };
  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    switch (flag) {
      case '--broker': args.broker = value ?? DEFAULT_BROKER; break;
      case '--topic': args.topic = value ?? DEFAULT_TOPIC; break;
      case '--minutes': args.minutes = Number(value); break;
      case '--max': args.max = Number(value); break;
      case '--out': args.out = value ?? ''; break;
      // Deliberately verbose. The preflight is the privacy guard; skipping it
      // should read like a decision in the shell history, not a convenience.
      case '--i-know-the-gallery-is-not-verified': args.skipPreflight = true; break;
      case '--help': case '-h': args.help = true; break;
      default: throw new Error(`unknown argument: ${raw}`);
    }
  }
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
    throw new Error(`--minutes must be a positive number, got: ${args.minutes}`);
  }
  if (!(args.max > 0)) throw new Error(`--max must be a positive number, got: ${args.max}`);
  return args;
}

const USAGE = `Capture Double Take MQTT payloads to a gitignored, redacted JSONL file.

  npm run capture:doubletake -w server -- [--minutes=n] [--max=n]

  --broker=<url>   MQTT broker (default ${DEFAULT_BROKER}; env FRIGATE_MQTT_URL)
  --topic=<topic>  topic to subscribe to (default ${DEFAULT_TOPIC})
  --minutes=<n>    capture window in minutes (default ${DEFAULT_MINUTES})
  --max=<n>        stop early after n messages
  --out=<path>     output file (default captures/double-take-<stamp>.jsonl)

Refuses to start unless the enrolment gallery holds exactly "${ALLOWED_SUBJECT}",
recognition actually resolves it, and the live config has retention disabled.

Never touches dairy.db. Never writes image bytes. Analyse the result with:
  npm run verify:payload:dt -w server -- --capture=<path>`;

// --- preflight --------------------------------------------------------------

async function deepstackPost(endpoint: string, form?: FormData): Promise<Record<string, unknown>> {
  const res = await fetch(`${DEEPSTACK}${endpoint}`, { method: 'POST', body: form ?? new FormData() });
  return JSON.parse(await res.text()) as Record<string, unknown>;
}

/**
 * Refuse to capture unless the privacy posture is verified LIVE.
 *
 * Every check here has a specific failure it exists to catch, and all of them
 * fail closed. The config check reads the real mounted config.yml rather than
 * the committed example, which is the gap doubleTakeStack.test.ts openly cannot
 * cover.
 */
async function preflight(): Promise<void> {
  console.log('Preflight');
  const problems: string[] = [];

  // 1. live config, not the template
  if (!existsSync(LIVE_CONFIG)) {
    problems.push(
      `${path.relative(REPO_ROOT, LIVE_CONFIG)} does not exist — Double Take is running on ` +
        'defaults, and detect.*.save DEFAULTS TO TRUE (it would be writing face crops). ' +
        'Run: cp double-take/config.example.yml double-take/config.yml',
    );
  } else {
    const cfgProblems = retentionProblems(readFileSync(LIVE_CONFIG, 'utf8'));
    problems.push(...cfgProblems.map((p) => `live config: ${p}`));
    if (cfgProblems.length === 0) console.log('  PASS  live config has retention disabled');
  }

  // 2 + 3. gallery contents, and recognition actually working
  let gallery;
  try {
    gallery = checkGallery(await deepstackPost('/v1/vision/face/list'));
  } catch (err: unknown) {
    problems.push(
      `cannot reach the detector at ${DEEPSTACK} (${err instanceof Error ? err.message : err}). ` +
        'The gallery cannot be verified, so the capture will not run.',
    );
    gallery = null;
  }

  if (gallery) {
    problems.push(...gallery.problems);
    if (gallery.ok) console.log(`  PASS  gallery holds exactly ["${ALLOWED_SUBJECT}"]`);

    const images = existsSync(ENROLL_DIR)
      ? readdirSync(ENROLL_DIR).filter((f) => /^synthetic_1\.(jpe?g|png)$/i.test(f))
      : [];
    if (images.length !== 1) {
      problems.push(`expected exactly one enrolment image in ${ENROLL_DIR}, found ${images.length}`);
    } else {
      const form = new FormData();
      const p = path.join(ENROLL_DIR, images[0]);
      form.append('image', new Blob([readFileSync(p)]), images[0]);
      const rec = checkRecognition(await deepstackPost('/v1/vision/face/recognize', form));
      problems.push(...rec.problems);
      if (rec.ok) console.log('  PASS  recognition resolves the synthetic subject');
    }
  }

  if (problems.length > 0) {
    console.error('\nPreflight FAILED — not capturing:\n');
    for (const p of problems) console.error(`  - ${p}\n`);
    throw new Error('preflight failed');
  }
  console.log('');
}

// --- main -------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  if (args.skipPreflight) {
    console.warn('\n  !! PREFLIGHT SKIPPED. The gallery and retention config are NOT verified.\n');
  } else {
    await preflight();
  }

  const outPath = args.out || defaultOutPath();
  mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`Connecting to ${args.broker} ...`);
  const client = await mqtt.connectAsync(args.broker, { reconnectPeriod: 2000 });
  await client.subscribeAsync(args.topic);

  const deadline = Date.now() + args.minutes * 60_000;
  console.log(
    `Subscribed to "${args.topic}". Capturing for ${args.minutes} minute(s) ` +
      `(until ${new Date(deadline).toISOString()}).\n  -> ${outPath}\n` +
      'Ctrl-C to stop early and keep what has been captured.\n',
  );

  let total = 0;
  let unparsed = 0;
  let withFaces = 0;
  let redactions = 0;
  const byTopic = new Map<string, number>();
  const cameras = new Set<string>();

  client.on('message', (topic: string, buf: Buffer) => {
    const text = buf.toString('utf8');
    const record: CaptureRecord = { received_at: new Date().toISOString(), topic, payload: null };

    try {
      const parsed = JSON.parse(text) as unknown;
      const r = redactBiometrics(parsed);
      record.payload = r.value;
      if (r.paths.length > 0) {
        record.redacted = r.paths;
        redactions += r.byKey + r.byLength;
        if (r.byLength > 0) {
          console.warn(
            `  ! redacted ${r.byLength} unexpectedly long string(s) at ${r.paths.join(', ')}`,
          );
        }
      }
    } catch {
      // Not JSON. `double-take/cameras/<cam>/person` carries a bare integer and
      // `double-take/available` a status word, so this is expected under the
      // wildcard topic and is recorded rather than dropped.
      record.unparsed = text.length > 512 ? `${text.slice(0, 512)}...[truncated]` : text;
      unparsed += 1;
    }

    // Layer 3: never trust that layer 2 was applied correctly.
    if (containsInlineImage(record.payload) || containsInlineImage(record.unparsed ?? null)) {
      console.error(
        `\nREFUSING TO WRITE a message on ${topic}: it still contains inline image data ` +
          'after redaction. This is a bug in redact.ts — the capture is stopping rather ' +
          "than writing a stranger's face to disk.",
      );
      process.exitCode = 1;
      void client.endAsync();
      return;
    }

    appendFileSync(outPath, `${JSON.stringify(record)}\n`);

    total += 1;
    byTopic.set(topic, (byTopic.get(topic) ?? 0) + 1);
    const p = record.payload as Record<string, unknown> | null;
    if (p && typeof p.camera === 'string') cameras.add(p.camera);
    const faceCount = ['matches', 'misses', 'unknowns']
      .map((k) => (Array.isArray(p?.[k]) ? (p![k] as unknown[]).length : 0))
      .reduce((a, b) => a + b, 0);
    if (faceCount > 0) withFaces += 1;

    if (total % 5 === 0 || total <= 5) {
      console.log(`  ${total} message(s), ${withFaces} with faces, ${redactions} redaction(s)`);
    }
  });

  const finish = async (why: string): Promise<void> => {
    console.log(`\n[${why}] captured ${total} message(s) to ${outPath}`);
    if (total === 0) {
      console.log(
        '  No messages. Double Take publishes only when a Frigate `person` event yields a\n' +
          '  DETECTED FACE, so silence can mean "no faces resolved at this distance" rather\n' +
          '  than a broken pipeline. Check `docker logs frigate-double-take` for\n' +
          '  "url validation failed" (image fetch) or "no detectors configured".',
      );
    } else {
      console.log(`  by topic: ${[...byTopic].map(([t, n]) => `${t}=${n}`).join(' ')}`);
      console.log(`  cameras:  ${[...cameras].join(', ') || '(none)'}`);
      console.log(`  messages carrying at least one face: ${withFaces}`);
      console.log(`  redactions applied: ${redactions}`);
      if (unparsed > 0) console.log(`  ${unparsed} message(s) were not JSON`);
      console.log(`\nNext:\n  npm run verify:payload:dt -w server -- --capture=${outPath}`);
    }
    await client.endAsync();
  };

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (Date.now() >= deadline || total >= args.max) {
        clearInterval(timer);
        void finish(Date.now() >= deadline ? 'window elapsed' : 'max reached').then(resolve);
      }
    }, 1000);
    process.on('SIGINT', () => {
      clearInterval(timer);
      void finish('interrupted').then(resolve);
    });
  });
}

if (require.main === module) {
  main().catch((err: unknown) => {
    if (!(err instanceof Error && err.message === 'preflight failed')) {
      console.error(`\n${err instanceof Error ? err.message : err}`);
    }
    process.exitCode = 1;
  });
}
