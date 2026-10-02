# Optional integration operations

This reference owns camera-event simulation, classification and optional Langfuse tracing. For installation, the registry harness, builds, tests and backups, use [DEVELOPMENT.md](DEVELOPMENT.md). Commands run from the repository root unless stated otherwise. Live-camera records retain their original hardware and capture-window limits.

## Farm event ingestion (synthetic)

Synthetic camera-event plumbing — these commands need no hardware or agent reasoning. Needs the server
running; see [FARM_EVENTS.md](FARM_EVENTS.md).

```bash
# replay one scenario, backdated 3 days
npm run simulate:farm -w server -- --scenario=night-visitor-unknown --days-ago=3

# replay every scenario
npm run simulate:farm -w server -- --all --days-ago=14

# list the scenario names and flags
npm run simulate:farm -w server -- --help

# prove every scenario lands correctly in farm_events (exits non-zero on a diff)
npm run verify:farm -w server
```

> `verify:farm` clears `farm_events` before each scenario and again when it
> finishes, so it leaves the table empty. It does not touch the dairy tables,
> and `npm run seed -w server` does not touch `farm_events`.

## Live camera validation (Cycle 7)

Captures **real** Frigate and Double Take events off MQTT and diffs their shape
against the payload documented in [FARM_EVENTS.md](FARM_EVENTS.md).
Hardware-gated, run once per window, and destructive to set up — so the full
procedure lives with the record of the run rather than here:

- Frigate — [cycle-7-live-camera-validation.md § To run the capture](cycle-7-live-camera-validation.md)
  (`capture:frigate`, `verify:payload`)
- Double Take — [Cycle7-fu3-double-take-validation.md § To run the capture](Cycle7-fu3-double-take-validation.md)
  (`enroll:synthetic`, `capture:doubletake`, `verify:payload:dt`)

Both carry caveats this section used to omit — the DeepStack restart without
which every face resolves as unknown and the window is wasted, and
`--topic='frigate/#'` for topic discovery when nothing arrives. Neither stack
may outlive its capture window; both teardowns take `-v`.

## Farm event classification

Reads those rows for meaning: routine / notable / urgent per event, plus
attendance and camera-silence reconciliation across a day. Needs the server
running; see [FARM_MONITOR.md](FARM_MONITOR.md).

```bash
# classify + reconcile every scenario and assert the verdicts
npm run verify:classify -w server

# one scenario only
npm run verify:classify -w server -- --scenario=recurring-unknown-visitor
```

> Both farm scripts pin `TZ=Asia/Karachi`: the generator composes scenario start
> times in the *host's* zone, so an unpinned run on a UTC machine would stamp
> `night-visitor-unknown` at 02:14 UTC — 07:14 farm-local, inside working hours,
> silently failing the off-hours flag the scenario exists to produce.
>
> `verify:classify` resets `farm_events` before each scenario, and that is
> required rather than tidy: the `unknown_a1` cluster id appears in two
> scenarios, so a shared table would give it four sightings in one lookback
> window and corrupt every recurrence count. `simulate:farm --all` accumulates
> all six scenarios into one table and is for ingestion checks only — never use
> it as the basis for a recurrence assertion.


## Observability (Langfuse)

Every agent turn is traced with a **self-hosted [Langfuse](https://langfuse.com)**
instance, instrumented via its OTel-based JS SDK (`@langfuse/tracing`,
`@langfuse/otel`, `@opentelemetry/sdk-node`). Tracing sits one layer below the
AG-UI transport, in the shared tool-call/model-call logic, so it is decoupled
from the wire protocol.

```bash
# 1. start the Langfuse stack (Postgres, ClickHouse, Redis, MinIO, web + worker)
docker compose -f docker-compose.langfuse.yml up -d

# 2. open the UI, create a project, copy its keys into server/.env
open http://localhost:3000        # LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY

# 3. run the app as usual; traces stream to Langfuse
npm run dev:angular
```

What gets traced, per turn:

- **One trace per run**, grouped into a **session keyed by `threadId`** — so an
  approval **pause and its resume are two traces under one session**, not two
  disconnected traces.
- **A generation observation per model call**, with token counts pulled from the
  Anthropic response `usage` so Langfuse infers cost with no hand-rolled pricing
  table.
- **A tool observation per read/write tool call**, recording the model digest
  (never the raw dataset rows) as output.
- **Custom trace attributes:** `digest_size` and `dataset_rows` (to correlate
  response shape with latency/cost), `finish_reason`
  (`completed` / `iteration_cap` / `awaiting_approval`), and `agent`
  (`dairy` / `vendor` / `both` — which agent the dispatcher routed the turn to).

If the `LANGFUSE_*` keys are unset, tracing is silently disabled and the agent
runs normally.


Stop Langfuse with `docker compose -f docker-compose.langfuse.yml down` to keep trace volumes. Adding `-v` deletes them. Root `.env` configuration for camera Compose is separate from `server/.env`; see [configuration](DEVELOPMENT.md#3-configure--two-env-files-not-one).
