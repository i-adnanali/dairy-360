// Live Frigate MQTT capture (Cycle 7 step 1; see
// docs/cycle-7-live-camera-validation.md).
//
//   npm run capture:frigate -w server -- --minutes=120
//   npm run capture:frigate -w server -- --topic='frigate/#' --minutes=5   # discovery
//
// Subscribes to Frigate's `frigate/events` topic and appends every message to a
// gitignored JSONL file. That file is the slice's raw material: the deltas list
// is produced from it afterwards by `npm run verify:payload -w server`.
//
// ---------------------------------------------------------------------------
// HARD CONSTRAINT: this module must never import `../db`.
// ---------------------------------------------------------------------------
// Open decision 1 in the handover doc is "the shared dev DB stays untouched",
// and merely IMPORTING ../db would violate it -- that module calls
// `new Database(DB_PATH)` and `db.exec(FARM_SCHEMA)` at module load, so an
// import alone opens (and on a fresh clone, creates) dairy.db. The same reason
// ingest.ts and classify.ts stay pure. Capture writes to a flat file and
// nothing else.
//
// WHY CAPTURE IS DUMB: it records the payload verbatim and does not normalize.
// Normalization happens in verifyPayloadShape.ts, reading this file back. That
// keeps the capture LOSSLESS and re-analysable -- when the normalizer changes,
// you re-run the analysis against the same capture instead of having to stand
// the camera back up. It is the same clone-and-diff-against-known-good
// discipline the rest of this project uses, applied to a capture artifact.

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import mqtt from 'mqtt';

/** Frigate's own default event topic. Its `topic_prefix` config key can change
 * this, which is why it is overridable. */
const DEFAULT_TOPIC = 'frigate/events';
const DEFAULT_BROKER = process.env.FRIGATE_MQTT_URL ?? 'mqtt://localhost:1883';
const DEFAULT_MINUTES = 120;

/** Capture output lives beside the server package, next to dairy.db, and is
 * gitignored as `server/captures/`. Deliberately NOT under src/: it is data,
 * and anything under src/ falls inside tsconfig's rootDir. */
const CAPTURE_DIR = path.join(__dirname, '..', '..', 'captures');

export interface CaptureRecord {
  /** When WE received it -- the trustworthy clock for window assertions, since
   * the payload's own start_time is what is under test. */
  received_at: string;
  topic: string;
  /** The parsed message. `null` when the message was not JSON, with the raw
   * text preserved in `unparsed` -- a non-JSON message on this topic is itself
   * a finding and must not be silently dropped. */
  payload: unknown;
  unparsed?: string;
}

interface Args {
  broker: string;
  topic: string;
  minutes: number;
  max: number;
  out: string;
  help: boolean;
}

function defaultOutPath(): string {
  // Colons are legal on macOS but hostile in shell arguments; use a flat stamp.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(CAPTURE_DIR, `frigate-events-${stamp}.jsonl`);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    broker: DEFAULT_BROKER,
    topic: DEFAULT_TOPIC,
    minutes: DEFAULT_MINUTES,
    max: Number.POSITIVE_INFINITY,
    out: '',
    help: false,
  };
  for (const raw of argv) {
    const [flag, value] = raw.includes('=') ? raw.split(/=(.*)/s) : [raw, undefined];
    switch (flag) {
      case '--broker':
        args.broker = value ?? DEFAULT_BROKER;
        break;
      case '--topic':
        args.topic = value ?? DEFAULT_TOPIC;
        break;
      case '--minutes':
        args.minutes = Number(value);
        break;
      case '--max':
        args.max = Number(value);
        break;
      case '--out':
        args.out = value ?? '';
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`unknown argument: ${raw}`);
    }
  }
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) {
    throw new Error(`--minutes must be a positive number, got: ${args.minutes}`);
  }
  if (!(args.max > 0)) {
    throw new Error(`--max must be a positive number, got: ${args.max}`);
  }
  return args;
}

const USAGE = `Capture Frigate MQTT events to a gitignored JSONL file.

  npm run capture:frigate -w server -- [--minutes=n] [--max=n]

  --broker=<url>   MQTT broker (default ${DEFAULT_BROKER}; env FRIGATE_MQTT_URL)
  --topic=<topic>  topic to subscribe to (default ${DEFAULT_TOPIC})
  --minutes=<n>    capture window in minutes (default ${DEFAULT_MINUTES})
  --max=<n>        stop early after n messages (default: no cap)
  --out=<path>     output file (default captures/frigate-events-<stamp>.jsonl)

Never touches dairy.db. Analyse the result with:
  npm run verify:payload -w server -- --capture=<path>`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(USAGE);
    return;
  }

  const outPath = args.out || defaultOutPath();
  mkdirSync(path.dirname(outPath), { recursive: true });

  console.log(`Connecting to ${args.broker} ...`);
  const client = await mqtt.connectAsync(args.broker, { reconnectPeriod: 2000 });
  await client.subscribeAsync(args.topic);

  const deadline = Date.now() + args.minutes * 60_000;
  console.log(
    `Subscribed to "${args.topic}". Capturing for ${args.minutes} minute(s) ` +
      `(until ${new Date(deadline).toISOString()})${
        Number.isFinite(args.max) ? `, max ${args.max} message(s)` : ''
      }.\n  -> ${outPath}\nCtrl-C to stop early and keep what has been captured.\n`,
  );

  let total = 0;
  let unparsed = 0;
  const byType = new Map<string, number>();
  const cameras = new Set<string>();

  client.on('message', (topic: string, buf: Buffer) => {
    const text = buf.toString('utf8');
    const record: CaptureRecord = {
      received_at: new Date().toISOString(),
      topic,
      payload: null,
    };
    try {
      record.payload = JSON.parse(text) as unknown;
    } catch {
      // Not JSON. Frigate publishes plain scalars on some topics (e.g.
      // `frigate/<camera>/person` carries a bare count), so this is expected
      // under `--topic=frigate/#` and a genuine finding under frigate/events.
      record.unparsed = text;
      unparsed += 1;
    }
    appendFileSync(outPath, `${JSON.stringify(record)}\n`);

    total += 1;
    const p = record.payload as { type?: unknown; after?: { camera?: unknown } } | null;
    const type = typeof p?.type === 'string' ? p.type : '(none)';
    byType.set(type, (byType.get(type) ?? 0) + 1);
    if (typeof p?.after?.camera === 'string') cameras.add(p.after.camera);

    // One line per message would flood a multi-hour street-traffic window.
    if (total % 10 === 0 || total <= 5) {
      const types = [...byType].map(([t, n]) => `${t}=${n}`).join(' ');
      console.log(`  ${total} message(s)  [${types}]  cameras: ${[...cameras].join(', ') || '-'}`);
    }
  });

  const finish = async (why: string): Promise<void> => {
    console.log(`\n[${why}] captured ${total} message(s) to ${outPath}`);
    if (total === 0) {
      console.log(
        '  No messages. Check that Frigate is running, that its mqtt.enabled is true,\n' +
          '  and that its topic_prefix matches --topic.',
      );
    } else {
      console.log(`  by type: ${[...byType].map(([t, n]) => `${t}=${n}`).join(' ')}`);
      console.log(`  cameras: ${[...cameras].join(', ') || '(none seen)'}`);
      if (unparsed > 0) console.log(`  ${unparsed} message(s) were not JSON`);
      console.log(`\nNext:\n  npm run verify:payload -w server -- --capture=${outPath}`);
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

    // Ctrl-C must keep the capture rather than discard it: a partial window of
    // real payloads is still the deliverable.
    process.on('SIGINT', () => {
      clearInterval(timer);
      void finish('interrupted').then(resolve);
    });
  });
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(`\n${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  });
}
