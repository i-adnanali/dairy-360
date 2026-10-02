# Configure and troubleshoot tracing

Optional integration. Docker/Compose and a running local app are prerequisites. Commands run from the repository root. This procedure does not claim a live service check.

## Observability (Langfuse)

When configured, each agent turn is traced with a **self-hosted [Langfuse](https://langfuse.com)**
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


Stop Langfuse with `docker compose -f docker-compose.langfuse.yml down` to keep trace volumes. Adding `-v` deletes them. Root `.env` configuration for camera Compose is separate from `server/.env`; see [configuration](development.md#run-the-persistent-app).
## Verify and recover

Send a synthetic assistant request only when model use is intended; inspect a trace with the expected thread/run and tool/model observations. An approval pause and resume should share the thread session, while remaining separate runs. If nothing arrives, check `server/.env`, server restart, service health and `LANGFUSE_BASE_URL`. Absent keys intentionally disable tracing; that is not a successful trace-delivery test.

Trace output can include model digests and conversation data. Keep real farm content out of public evidence. The [original observability record](../records/OBSERVABILITY.md) preserves design choices and dated verification.
