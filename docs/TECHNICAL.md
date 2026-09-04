# Dairy Farm Agent - Technical Internals

A low-level reference for the parts that make this an **agent** rather than a chat wrapper: the **loop**, the **guardrails**, and the **shape of the tool contracts**. For the high-level architecture, data flows, and system diagrams, see [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md); this document deliberately does not repeat them.

All line references are to the current source; the authoritative definitions live in the linked files.

---

## Section 1 - The agent loop (internals)

Entry point: `runAgentStream` in [server/src/agent/stream.ts](../server/src/agent/stream.ts), called once per AG-UI run (`POST /api/agent/run`) from [server/src/index.ts](../server/src/index.ts).

```ts
export async function runAgentStream(args: RunStreamArgs): Promise<void>

interface RunStreamArgs {
  threadId: string;
  runId: string;
  messages: Anthropic.MessageParam[];
  approvals?: Approval[];
  emit: (event: BaseEvent) => void; // sink wired to the SSE response
}
```

The server is **stateless**: `messages` is the entire conversation (sent by the client every turn inside the run input's `forwardedProps`) and `approvals` is the set of write decisions for this turn. The loop does not *return* a response object; it **streams** AG-UI events through `emit` (text, tool calls, and the `agent.*` CUSTOM side-channels), and the client reassembles the turn from that event stream. The updated opaque history is streamed back over a `agent.messages` CUSTOM event and then owned by the client.

Once per run, before the loop, the **dispatcher** runs: `selectAgent(latestUserText, previousUserText)` ([server/src/agent/dispatch.ts](../server/src/agent/dispatch.ts)) picks `dairy` / `vendor` / `both`; the loop then offers only that agent's tools (`toolsForAgent(agent)`) and builds an agent-specific prompt (`buildSystemPrompt(agent, today)`). The choice is emitted to the client as an `agent.selection` CUSTOM event right after `RUN_STARTED` and recorded on the trace (`agent` metadata). Because it's derived from the (unchanged) user-typed history, a pause and its resume recompute the *same* agent.

`runAgentStream` wraps the whole turn in a Langfuse root observation (`startActiveObservation('agent-run', ...)`), so one turn is one trace; see [OBSERVABILITY.md](./OBSERVABILITY.md).

### 1.1 Constants

Defined at the top of [server/src/agent/stream.ts](../server/src/agent/stream.ts):

- `DEFAULT_MODEL` = `process.env.ANTHROPIC_MODEL` or `"claude-sonnet-4-6"`.
- `FALLBACK_MODEL` = `"claude-sonnet-4-5"`.
- `MAX_TOKENS` = `1500` (per model call).
- `MAX_ITERATIONS` = `process.env.AGENT_MAX_ITERATIONS` or `8` (upper bound on model/tool rounds in a single turn; the env override exists only to make the cap path testable).

### 1.2 Per-iteration algorithm

The body is a bounded `for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++)` loop. Each iteration:

1. **Resume check.** If the last message is an assistant message that already contains `tool_use` blocks (`lastIsAssistantToolUse`), the loop is *resuming* after a confirmation pause: it reuses those tool calls and does **not** call the model again.
2. **Otherwise stream the model.** `streamWithFallback(system, messages, emit)` opens `anthropic.messages.stream()` and translates its deltas into AG-UI `TEXT_MESSAGE_*` / `TOOL_CALL_*` events; the assembled assistant reply is pushed onto `messages`. If `stop_reason !== 'tool_use'`, the model has produced its final answer -> emit `RUN_FINISHED` (the text was already streamed) and return.
3. **Split tool calls.** `tool_use` blocks are partitioned into `reads` (`READ_TOOL_NAMES`) and `writes` (`WRITE_TOOL_NAMES`).
4. **Run reads** (always; they are idempotent). Each read is guarded (`guardIds`), executed, and emitted as a `TOOL_CALL_RESULT` carrying the digest; any produced `dataset` is streamed to the client over a `agent.dataset` CUSTOM event. On a resume run the read UI events are suppressed (already emitted in the run that proposed the write) and the read re-executes silently for the model only.
5. **If no writes:** append the read results as a `user` message and continue to the next iteration so the model can digest and answer.
6. **If writes exist:** enforce the human-in-the-loop gate (Section 1.3).

### 1.3 The write gate: pause and resume

- **Unresolved writes** (a write `tool_use` with no matching `approvals` entry) cause the loop to build `PendingWrite` cards, emit them over a `agent.pending` CUSTOM event, and **end the run** with a plain `RUN_FINISHED` (deliberately *not* an AG-UI `outcome: interrupt` — see Section 2.6 and [AGUI_MIGRATION.md](./AGUI_MIGRATION.md)). Nothing is executed. The client renders the cards.
- **Resolved writes** (every write has a decision) are applied: for each `approved` write, `guardIds` runs again and then `WRITE_EXECUTORS[name].execute(input)`; each rejected write records a `{ declined: true }` tool result instead. Read + write results are appended and `remainingApprovals` is cleared (consumed once), so a resend cannot re-apply them.

### 1.4 Message assembly helpers

- `streamModelTurn(model, system, messages, emit)` - opens `anthropic.messages.stream()` with `{ model, max_tokens, system, tools, messages }`, translates its deltas into AG-UI `TEXT_MESSAGE_*` / `TOOL_CALL_*` events, and records a Langfuse **generation** (token counts from the response `usage`). Returns the assembled `finalMessage`.
- `streamWithFallback(system, messages, emit)` - wraps `streamModelTurn`: on HTTP `404`/`400` (likely an unknown model string) **and only if nothing has been emitted yet**, it retries **once** with `FALLBACK_MODEL`, so a mid-stream failure never double-emits.
- `toolResultBlock(id, content, isError)` - wraps a result as `{ type: 'tool_result', tool_use_id, content: JSON.stringify(content), is_error }`.
- `assistantTextOf(content)` - concatenates the `text` blocks of a model reply (used for the trace output).
- `argSummary(name, input)` - compact human string for the `ToolCallView` chips (arrays become `k=[n]`, objects `k={…}`). In the streaming design this lives **client-side** in [web-angular/src/app/core/chat-store.ts](../web-angular/src/app/core/chat-store.ts), which reassembles chips from streamed `TOOL_CALL_ARGS`; the formatting is mirrored so chips read identically.

### 1.5 Exit conditions

- **Normal:** model stops calling tools (`stop_reason !== 'tool_use'`) -> `RUN_FINISHED` (trace `finish_reason: completed`).
- **Pause:** unresolved writes -> `agent.pending` CUSTOM event + `RUN_FINISHED` (trace `finish_reason: awaiting_approval`).
- **Cap:** the `for` loop exhausts `MAX_ITERATIONS` -> streams a graceful "This request got too involved... narrow it down" message, then `RUN_FINISHED` (trace `finish_reason: iteration_cap`). This is a normal completion, not a failure.
- **Error:** a genuine failure (Anthropic API error, a tool executor throwing) surfaces as `RUN_ERROR`, not `RUN_FINISHED`.

### Diagram A - handling one tool call inside an iteration

```mermaid
flowchart TD
    TU["tool_use block"] --> Kind{"read or write?"}

    Kind -- "read" --> GR["guardIds(input)"]
    GR -- "error" --> RErr["tool_result: ToolError (is_error=true)"]
    GR -- "ok" --> Exec["READ_EXECUTORS[name](input)"]
    Exec --> Dig["modelDigest -> tool_result"]
    Exec --> DS{"dataset produced?"}
    DS -- "yes" --> Coll["collect into datasets (client only)"]
    DS -- "no" --> Skip["(no dataset)"]

    Kind -- "write" --> Dec{"approval decision present?"}
    Dec -- "no" --> Card["build PendingWrite card -> emit agent.pending -> PAUSE (RUN_FINISHED)"]
    Dec -- "approved" --> GW["guardIds(input)"]
    GW -- "error" --> WErr["tool_result: ToolError"]
    GW -- "ok" --> WExec["WRITE_EXECUTORS[name].execute(input)"]
    WExec --> WRes["tool_result: write outcome"]
    Dec -- "rejected" --> Declined["tool_result: { declined:true }"]
```

---

## Section 2 - Guardrails

The design goal is "wrong cheaply, never expensively": bad inputs, hallucinated IDs, oversized requests, and runaway loops are all caught before they cost tokens or corrupt data.

### 2.1 ID-integrity guard (`guardIds`)

[server/src/tools/index.ts](../server/src/tools/index.ts). Before any tool runs, validates every referenced identifier against the DB:

- `args.animal_id` -> must exist, else `{ error: 'unknown_animal', animal_id }`.
- `args.group` -> must exist, else `{ error: 'unknown_group', group }`.
- `args.vendor_id` -> must exist, else `{ error: 'unknown_vendor', vendor_id }`.
- `args.delivery_id` -> must exist, else `{ error: 'unknown_delivery', delivery_id }`.
- every `args.entries[].animal_id` (used by `log_milking`) -> must exist.

Returns a `ToolError | null`. It runs for **reads** and **again for each approved write** just before execution, so an approval cannot smuggle a bad id past the guard.

### 2.2 Structured read errors (never throw)

Read executors ([server/src/tools/reads.ts](../server/src/tools/reads.ts)) return an error *digest* instead of throwing, so the model receives an `is_error` `tool_result` it can read and retry:

- `missing_scope` - `get_milk_yield` called with neither `animal_id` nor `group`.
- `missing_range` - `get_milk_yield` missing `from`/`to`.
- `unknown_animal` / `unknown_group` - scope resolves to zero animals.
- `unknown_vendor` - `get_vendor` / `get_deliveries` given a `vendor_id` that doesn't exist.
- `missing_query` - `search_animals` called with an empty query.
- `missing_range` - `get_deliveries` / `get_yield_vs_deliveries` missing `from`/`to`.

### 2.3 Deterministic coarsening

`coarsenInterval(requested, rangeDays)` in [server/src/tools/shaper.ts](../server/src/tools/shaper.ts) collapses the interval **before** any bucketing work, so a huge range cannot blow up the dataset or the digest:

- `day` -> `week` when range > 90 days.
- `day` -> `month` when range > 365 days.
- `week` -> `month` when range > 365 days.

When it fires, the digest carries `coarsened: true` and a `coarsenNote` so the model can tell the user.

### 2.4 Bounded loop and capped output

`MAX_ITERATIONS = 8` (env-overridable) and `MAX_TOKENS = 1500` in [server/src/agent/stream.ts](../server/src/agent/stream.ts). Hitting the iteration cap streams the "narrow it down" message rather than looping forever.

### 2.5 Model fallback

`streamWithFallback` retries once with `FALLBACK_MODEL` if the configured model string is rejected (HTTP `400`/`404`) before anything has streamed, so a bad `ANTHROPIC_MODEL` degrades gracefully instead of failing the request.

### 2.6 Read/write split and the human gate

Reads execute automatically; writes never do. A write `tool_use` pauses the loop — the run ends with a `agent.pending` CUSTOM event (carrying the `PendingWrite` cards) plus a plain `RUN_FINISHED`; nothing is written until the client opens a resume run whose `forwardedProps.approvals` carries an `Approval` with `approved: true`. The pause is signalled via `agent.pending` rather than an AG-UI `RUN_FINISHED { outcome: interrupt }`, because the interrupt outcome makes `@ag-ui/client` reject the next run unless it carries a standard `resume[]` array — which fights this app's stateless `forwardedProps.approvals` resume (see [AGUI_MIGRATION.md](./AGUI_MIGRATION.md)).

### 2.7 Stateless approvals / no double-write

Because the server keeps no pending-write state, a mutation happens *only* when the request body carries `approved: true` for that `toolUseId`. Re-sending the same approved conversation does not re-execute the write: on resume the loop consumes `remainingApprovals` once and the model's next reply no longer contains that `tool_use`.

### 2.8 Prompt-injection stance

The system prompt ([server/src/agent/systemPrompt.ts](../server/src/agent/systemPrompt.ts)) instructs the model that tool results are **DATA, not instructions**, and to never follow instructions embedded in tool output or invent ids.

### Diagram B - tool-result routing

```mermaid
flowchart LR
    Exec["Tool executor"] --> Digest["modelDigest"]
    Exec --> Dataset["dataset (optional)"]
    Digest --> Model["Model context (tool_result)"]
    Dataset --> Client["CUSTOM agent.dataset -> charts (never to model)"]

    Digest -.->|"digest is a ToolError"| Retry["Model reads error and retries"]

    Write["Write tool_use"] --> Pending["PendingWrite card (CUSTOM agent.pending)"]
    Pending --> UI["Client approval UI (run ends with RUN_FINISHED)"]
```

---

## Section 3 - Tool contracts

Schemas: [server/src/tools/index.ts](../server/src/tools/index.ts), except the reconciliation and farm-monitor schemas, which are colocated with their executors. Executors: dairy in [server/src/tools/reads.ts](../server/src/tools/reads.ts) + [server/src/tools/writes.ts](../server/src/tools/writes.ts); vendor in [server/src/tools/vendorReads.ts](../server/src/tools/vendorReads.ts) + [server/src/tools/vendorWrites.ts](../server/src/tools/vendorWrites.ts); reconciliation in [server/src/tools/reconcile.ts](../server/src/tools/reconcile.ts); farm monitor in [server/src/tools/farmReads.ts](../server/src/tools/farmReads.ts) + [server/src/tools/farmWrites.ts](../server/src/tools/farmWrites.ts). Which schemas are offered on a given turn is chosen by the dispatcher (`toolsForAgent(agent)`): the dairy set, the vendor set, or all + `get_yield_vs_deliveries` for `both`. The three farm-monitor tools are **agent-agnostic** and appended to every branch (Cycle 5; see [FARM_MONITOR.md](FARM_MONITOR.md) Decision 6). Shared types: [shared/src/types.ts](../shared/src/types.ts).

### 3.1 Plumbing types

```ts
interface ReadToolResult { modelDigest: unknown; dataset?: Dataset }
interface ToolError { error: string; [key: string]: unknown }

type Approval = { toolUseId: string; approved: boolean };

type PendingWrite = {
  toolUseId: string;
  toolName: string;
  summary: string;                                   // one-line human summary
  details: { label: string; value: string }[];       // card rows
  rows?: { tag: string; name?: string; value: string }[]; // optional table (log_milking)
};

type ToolCallView = { toolUseId: string; name: string; status: 'done' | 'error'; argSummary: string };

// AG-UI wire contract (POST /api/agent/run). History + approvals travel UP inside
// the run input's forwardedProps; datasets, updated history, and pending writes
// travel DOWN over CUSTOM events named by these constants.
type AgentRunForwardedProps = {
  messages: AnthropicMessage[];  // opaque history the client stores and resends
  approvals?: Approval[];        // approval decisions on a resume run
};

type AgentKind = 'dairy' | 'vendor' | 'both';  // which agent the dispatcher picked

const AGENT_DATASET_EVENT = 'agent.dataset';     // value: Dataset      (chart only)
const AGENT_MESSAGES_EVENT = 'agent.messages';   // value: AnthropicMessage[]
const AGENT_PENDING_EVENT = 'agent.pending';     // value: PendingWrite[]
const AGENT_SELECTION_EVENT = 'agent.selection'; // value: AgentKind (emitted at RUN_STARTED)
```

A read executor returns a **`modelDigest`** (small, enters the model context) and optionally a **`dataset`** (full, streamed to the client over `agent.dataset` only). A write executor exposes `buildCard()` (the `PendingWrite`) and `execute()` (the mutation).

### 3.2 Read tools

Every read returns `{ modelDigest }`; only `get_milk_yield` also returns a `dataset`.

| Tool | Input schema | `modelDigest` shape | Error codes |
|---|---|---|---|
| `list_animals` | `{ group?, status? }` | `{ count, animals: [{ id, tag, name, species, status, group_name }] }` | - |
| `get_animal` | `{ animal_id }` (required) | `{ animal, recentAvgDailyLitres, lastMilkingDate, openHealthEvents }` | `unknown_animal` |
| `get_milk_yield` | `{ animal_id? , group?, from, to, interval }` (`from/to/interval` required; one of `animal_id`/`group`) | `ShapeDigest` (see 3.3) **+ `dataset`** | `missing_scope`, `missing_range`, `unknown_animal`, `unknown_group` |
| `search_animals` | `{ query }` (required) | `{ count, tooMany, totalMatches, animals: [{ id, tag, name, breed, status, group_name }] }` (top-K = 8) | `missing_query` |
| `get_feed_status` | `{}` | `{ items: [{ feed_type, quantity_kg, daily_consumption_kg, reorder_threshold_kg, belowThreshold, daysRemaining }], anyBelowThreshold }` | - |
| `get_health_events` | `{ animal_id?, due_within_days? }` | `{ count, events: [{ id, animal_id, tag, name, date, type, notes, next_due_date }] }` | `unknown_animal` |

Vendor / reconciliation reads (offered when the dispatcher selects `vendor` or `both`):

| Tool | Input schema | `modelDigest` shape | Error codes |
|---|---|---|---|
| `list_vendors` | `{ status? }` | `{ count, vendors: [{ id, name, status, price_per_litre }] }` | - |
| `get_vendor` | `{ vendor_id }` (required) | `{ vendor, outstandingBalance, unpaidDeliveries, totalDeliveries, totalLitresDelivered, lastDeliveryDate, recentDeliveries }` | `unknown_vendor` |
| `get_deliveries` | `{ vendor_id?, from, to }` (`from/to` required) | `{ scope, from, to, count, totalLitres, totalValue, unpaidValue, byVendor: [...] }` | `missing_range`, `unknown_vendor` |
| `get_yield_vs_deliveries` | `{ from, to }` (required; `both` only) | `{ from, to, producedLitres, deliveredLitres, discrepancyLitres, discrepancyPct, tolerancePct, flagged }` | `missing_range` |

Farm-monitor reads (Cycle 5; offered on **every** dispatcher selection). Dates are farm-local `YYYY-MM-DD`, converted to UTC instant bounds via `FARM_TZ`:

| Tool | Input schema | `modelDigest` shape | Error codes |
|---|---|---|---|
| `get_farm_events` | `{ start, end, zone?, identity? }` (`start/end` required) | `{ start, end, farm_tz, count, byEventType, byCamera, flaggedCount, unclassifiedCount, tooMany, events: [...] }` (top-K = 50) | `missing_range`, `invalid_range` |
| `summarize_daily_activity` | `{ date }` (required) | `{ date, farm_tz, events_examined, newly_classified, severities: { routine, notable, urgent }, flagged: [...], attendance: { enrolled, seen, absent }, cameras: [...], silence_threshold_minutes }` | `missing_date` |

`summarize_daily_activity` classifies the day's unexamined rows as a side effect, then reconciles. It returns structured findings only — no prose and no nested model call, because `runReads()` executes read tools **synchronously** and could not await one. Narration is instructed in `farmSection()` of [systemPrompt.ts](../server/src/agent/systemPrompt.ts), the same division `get_yield_vs_deliveries` uses.

### 3.3 `get_milk_yield`: digest vs dataset

The single most important contract for "display data is not reasoning data" ([server/src/tools/shaper.ts](../server/src/tools/shaper.ts)). `shapeMilkYield` produces two outputs from one query:

**Digest (to the model) - `ShapeDigest`:**

```ts
{
  datasetId, scopeLabel, interval, requestedInterval,
  coarsened, coarsenNote?,            // set when the range forced a coarser interval
  from, to,
  bucketCount,
  totalLitres, meanBucketLitres,
  min: { periodStart, litres } | null,
  max: { periodStart, litres } | null,
  first: { periodStart, litres } | null,
  last:  { periodStart, litres } | null,
  periodOverPeriodPct: number | null   // second half vs first half of buckets
}
```

**Dataset (to the client only) - `Dataset`:**

```ts
{ datasetId, kind: 'timeseries', scopeLabel, interval, points: DatasetPoint[] }
// DatasetPoint = { periodStart, totalLitres, avgPerAnimal }
```

The `points` array (every bucket) is the full time series. It is streamed to the client over a `agent.dataset` CUSTOM event and rendered by `ChartCard`; it **never enters the model's context**. The model only ever sees the digest stats.

### 3.4 Write tools

All writes are confirmation-gated. `buildCard()` shapes the `PendingWrite`; `execute()` performs the mutation and returns a small result that becomes the model's `tool_result` after approval.

- **`log_milking`** - input `{ date, session, entries: [{ animal_id, yield_litres (0..40) }] }` (all required). Card includes `details` (Date, Session, Animals, Total) and `rows` (one per animal: tag [+ name], value in L). `execute` inserts one `milkings` row per entry -> `{ inserted, totalLitres, date, session }`.
- **`add_animal`** - input `{ tag, species, status }` required; `name?, breed?, date_of_birth?, group_name?` optional. `execute` inserts an `animals` row -> `{ created: true, id, tag }`.
- **`log_health_event`** - input `{ animal_id, date, type }` required (`type` in vaccination | vet_visit | treatment | breeding); `notes?, next_due_date?` optional. `execute` inserts a `health_events` row -> `{ created: true, id }`.
- **`update_feed_inventory`** - input `{ feed_type, quantity_kg (>=0) }` required. `execute` runs `UPDATE feed_inventory SET quantity_kg=? WHERE feed_type=?` -> `{ updated, feed_type, quantity_kg }`.
- **`schedule_health_event`** - input `{ animal_id, type, next_due_date }` required; `notes?` optional. `execute` inserts a `health_events` row dated today with the future `next_due_date` -> `{ created: true, id, next_due_date }`.

Vendor writes ([server/src/tools/vendorWrites.ts](../server/src/tools/vendorWrites.ts)), same confirmation-gated pattern:

- **`register_vendor`** - input `{ name, price_per_litre }` required; `contact?, status?` optional (`status` whitelisted to `active`/`inactive`, default `active`). Validates a non-empty name and a finite `price_per_litre >= 0`. `execute` inserts a `vendors` row -> `{ created: true, id, name }`.
- **`record_delivery`** - input `{ vendor_id, date, litres }` required. The `price_per_litre` is captured from the vendor at call time (a later vendor price change never rewrites past deliveries). Validates a finite `litres > 0`. `execute` inserts a `deliveries` row (`paid = 0`) -> `{ created: true, id, litres, price_per_litre, value }`.
- **`mark_delivery_paid`** - input `{ delivery_id }` required. `execute` runs `UPDATE deliveries SET paid = 1 WHERE id = ?` -> `{ updated, delivery_id }`.

Farm-monitor write ([server/src/tools/farmWrites.ts](../server/src/tools/farmWrites.ts)), same confirmation-gated pattern:

- **`flag_anomaly`** - input `{ event_id, severity, reason }` all required (`severity` in notable | urgent). Manual override for something the automatic classification pass missed, or a correction to its severity. Last-write-wins: no flag history and no unflagging path in this cycle. `execute` calls `setFarmEventFlag()` -> `{ updated, event_id, severity, reason }`.

> **The automatic classification path is not a write executor.** `classifyEvent()` calls the `setFarmEventFlag()` DB helper directly, with no card and no approval, because a pass over a day's camera rows must not prompt per row. `flag_anomaly` is the human-approved entry point onto the same `UPDATE`. Two entry points, one statement - see [FARM_MONITOR.md](FARM_MONITOR.md) Decision 6.

Card label helpers: `tagLabel(animalId)` renders `TAG (name)` when a name exists, otherwise just the tag - so with the current name-less seed, cards read by tag (e.g. `B-001`). Vendor cards use `vendorLabel(vendorId)` (the vendor's name). Farm cards use `eventLabel(eventId)`, which renders the event as `event_type on camera (zone) at YYYY-MM-DD HH:MM` in **farm-local** time.

---

## Section 4 - Constants and config quick reference

| Setting | Value | Location |
|---|---|---|
| Default model | `ANTHROPIC_MODEL` env or `claude-sonnet-4-6` | [server/src/agent/stream.ts](../server/src/agent/stream.ts) |
| Fallback model | `claude-sonnet-4-5` (on HTTP 400/404) | [server/src/agent/stream.ts](../server/src/agent/stream.ts) |
| Max tokens / call | `1500` | [server/src/agent/stream.ts](../server/src/agent/stream.ts) |
| Max iterations / turn | `AGENT_MAX_ITERATIONS` env or `8` | [server/src/agent/stream.ts](../server/src/agent/stream.ts) |
| Coarsen day->week | range > 90 days | [server/src/tools/shaper.ts](../server/src/tools/shaper.ts) |
| Coarsen ->month | range > 365 days | [server/src/tools/shaper.ts](../server/src/tools/shaper.ts) |
| Inline catalog threshold | `300` animals | [server/src/agent/systemPrompt.ts](../server/src/agent/systemPrompt.ts) |
| `search_animals` top-K | `8` | [server/src/tools/reads.ts](../server/src/tools/reads.ts) |
| Reconcile tolerance | `5` % of production | [server/src/tools/reconcile.ts](../server/src/tools/reconcile.ts) |
| `get_farm_events` top-K | `50` rows | [server/src/tools/farmReads.ts](../server/src/tools/farmReads.ts) |
| Farm timezone | `Asia/Karachi` (also pinned as `TZ` on the farm scripts) | [server/src/farm/classify.ts](../server/src/farm/classify.ts) |
| Farm work hours | `04:00`–`20:00` farm-local (start inclusive, end exclusive) | [server/src/farm/classify.ts](../server/src/farm/classify.ts) |
| Restricted zones | `feed_store` (provisional) | [server/src/farm/classify.ts](../server/src/farm/classify.ts) |
| Confident face match | `>= 0.85`, `face_match` rows only | [server/src/farm/classify.ts](../server/src/farm/classify.ts) |
| Unknown-cluster urgency | notable at occurrence `1`, urgent at `3`, `21`-day event-relative lookback | [server/src/farm/classify.ts](../server/src/farm/classify.ts) |
| Camera-silence threshold | `15` minutes | [server/src/farm/classify.ts](../server/src/farm/classify.ts) |
| Server port | `PORT` env or `4000` | [server/src/index.ts](../server/src/index.ts) |
| Web dev port | `4200` (Angular `ng serve`, proxies `/api` -> 4000) | [web-angular/proxy.conf.json](../web-angular/proxy.conf.json) |
| Registry harness port | `4100` by default — **pass `--port=4000`** to reach it through the proxy | [server/src/registry/harness.ts](../server/src/registry/harness.ts) |
| Calf age threshold | `18` months (provisional) — the scheme's **only** age threshold; every other life-stage boundary is event-driven | [server/src/registry/project.ts](../server/src/registry/project.ts) |
| Double-entry window | `60` days (provisional) | [server/src/registry/calving.ts](../server/src/registry/calving.ts) |
| Gestation floor | `310` days — a biological constant, **not** provisional and with no override | [server/src/registry/calving.ts](../server/src/registry/calving.ts) |
| Milk: recent-mean window | `7` measured rows, **same session only** — morning and evening are never pooled | [server/src/registry/milking.ts](../server/src/registry/milking.ts) |
| Milk: out-of-band hint | `0.5` (±50% of her recent mean), provisional; a warning, never a refusal | [web-angular/src/app/registry/milking-roster.ts](../web-angular/src/app/registry/milking-roster.ts) |
| Farm timezone | `Asia/Karachi` — **three deliberate copies**, none importing the others: the classifier, the registry server, and the browser | [classify.ts](../server/src/farm/classify.ts), [registry/time.ts](../server/src/registry/time.ts), [registry/today.ts](../web-angular/src/app/registry/today.ts) |
| Tracing | opt-in Langfuse (no-op if keys unset) | [server/src/instrumentation.ts](../server/src/instrumentation.ts) |
| Env vars | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `PORT`, `AGENT_MAX_ITERATIONS`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, plus `RUN_REGRESSION` (regression gate), `FARM_BASE_URL` + `FRIGATE_MQTT_URL` + `DEEPSTACK_URL` (farm scripts), and `TZ` / `NODE_ENV` | `server/.env`, loaded by `dotenv/config` — **cwd-relative, and dotenv does not search parents**, so a repo-root `.env` is invisible to the server. `.env.example` explains both destinations |

See [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) for the request lifecycle, architecture, and data-model diagrams.
