# Assistant tools

Current reference. [Assistant architecture](../../architecture/assistant.md) owns routing/execution and [protocol](../../architecture/protocol.md) owns transport. Registry HTTP forms and assistant executors are separate mutation paths.

## Registry reads

All dispatcher branches offer registry reads. Serial guards resolve registry identity, and precision/coverage remain visible in model digests. The demo `get_health_events`, `log_health_event` and `schedule_health_event` continue to address demo tables.

| Tools | Scope |
|---|---|
| `list_registry_animals`, `get_registry_animal`, `get_calving_intervals` | Herd identity, effective history and qualified intervals |
| `get_registry_health`, `get_registry_health_board`, `get_registry_life_report` | Actual clinical records, tasks, withdrawal instructions and life snapshot |
| `list_buyers`, `get_buyer_balance`, `get_dispatches`, `get_milk_reconciliation` | Registry sales and dispatch reads |

These are read-only. Feed/payroll assistant writes are not introduced by the direct workspace. Tool schemas must not expose domain override controls as a way for the model to bypass invariants. [Shared registry rules](../registry/shared-rules.md) explain provenance and domain replay differences.

## Executor contracts

Schemas: [server/src/tools/index.ts](../../../server/src/tools/index.ts), except the reconciliation, farm-monitor and registry schemas, which are colocated with their executors. Executors: dairy in [server/src/tools/reads.ts](../../../server/src/tools/reads.ts) + [server/src/tools/writes.ts](../../../server/src/tools/writes.ts); vendor in [server/src/tools/vendorReads.ts](../../../server/src/tools/vendorReads.ts) + [server/src/tools/vendorWrites.ts](../../../server/src/tools/vendorWrites.ts); reconciliation in [server/src/tools/reconcile.ts](../../../server/src/tools/reconcile.ts); farm monitor in [server/src/tools/farmReads.ts](../../../server/src/tools/farmReads.ts) + [server/src/tools/farmWrites.ts](../../../server/src/tools/farmWrites.ts). Which schemas are offered on a given turn is chosen by the dispatcher (`toolsForAgent(agent)`): the dairy set, the vendor set, or all + `get_yield_vs_deliveries` for `both`. The three farm-monitor tools are **agent-agnostic** and appended to every branch (Cycle 5; see [FARM_MONITOR.md](farm-monitor.md) Decision 6). Shared types: [shared/src/types.ts](../../../shared/src/types.ts).

## Plumbing contracts

[shared/src/types.ts](../../../shared/src/types.ts) owns `Approval`, `PendingWrite`, `ToolCallView`, `Dataset` and forwarded run props. Do not copy a partial interface here and treat it as an exhaustive type definition. Read executors return `modelDigest` and optionally a display `dataset`; write executors expose card-building and execution separately. [Protocol](../../architecture/protocol.md) owns event names and resume behavior.

## Read tools

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

`summarize_daily_activity` classifies the day's unexamined rows as a side effect, then reconciles. It returns structured findings only — no prose and no nested model call, because `runReads()` executes read tools **synchronously** and could not await one. Narration is instructed in `farmSection()` of [systemPrompt.ts](../../../server/src/agent/systemPrompt.ts), the same division `get_yield_vs_deliveries` uses.

### `get_milk_yield`: digest vs dataset

The single most important contract for "display data is not reasoning data" ([server/src/tools/shaper.ts](../../../server/src/tools/shaper.ts)). `shapeMilkYield` produces two outputs from one query:

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

### Write tools

All writes are confirmation-gated. `buildCard()` shapes the `PendingWrite`; `execute()` performs the mutation and returns a small result that becomes the model's `tool_result` after approval.

- **`log_milking`** - input `{ date, session, entries: [{ animal_id, yield_litres (0..40) }] }` (all required). Card includes `details` (Date, Session, Animals, Total) and `rows` (one per animal: tag [+ name], value in L). `execute` inserts one `milkings` row per entry -> `{ inserted, totalLitres, date, session }`.
- **`add_animal`** - input `{ tag, species, status }` required; `name?, breed?, date_of_birth?, group_name?` optional. `execute` inserts an `animals` row -> `{ created: true, id, tag }`.
- **`log_health_event`** - input `{ animal_id, date, type }` required (`type` in vaccination | vet_visit | treatment | breeding); `notes?, next_due_date?` optional. `execute` inserts a `health_events` row -> `{ created: true, id }`.
- **`update_feed_inventory`** - input `{ feed_type, quantity_kg (>=0) }` required. `execute` runs `UPDATE feed_inventory SET quantity_kg=? WHERE feed_type=?` -> `{ updated, feed_type, quantity_kg }`.
- **`schedule_health_event`** - input `{ animal_id, type, next_due_date }` required; `notes?` optional. `execute` inserts a `health_events` row dated today with the future `next_due_date` -> `{ created: true, id, next_due_date }`.

Vendor writes ([server/src/tools/vendorWrites.ts](../../../server/src/tools/vendorWrites.ts)), same confirmation-gated pattern:

- **`register_vendor`** - input `{ name, price_per_litre }` required; `contact?, status?` optional (`status` whitelisted to `active`/`inactive`, default `active`). Validates a non-empty name and a finite `price_per_litre >= 0`. `execute` inserts a `vendors` row -> `{ created: true, id, name }`.
- **`record_delivery`** - input `{ vendor_id, date, litres }` required. The `price_per_litre` is captured from the vendor at call time (a later vendor price change never rewrites past deliveries). Validates a finite `litres > 0`. `execute` inserts a `deliveries` row (`paid = 0`) -> `{ created: true, id, litres, price_per_litre, value }`.
- **`mark_delivery_paid`** - input `{ delivery_id }` required. `execute` runs `UPDATE deliveries SET paid = 1 WHERE id = ?` -> `{ updated, delivery_id }`.

Farm-monitor write ([server/src/tools/farmWrites.ts](../../../server/src/tools/farmWrites.ts)), same confirmation-gated pattern:

- **`flag_anomaly`** - input `{ event_id, severity, reason }` all required (`severity` in notable | urgent). Manual override for something the automatic classification pass missed, or a correction to its severity. Last-write-wins: no flag history and no unflagging path in the current implementation. `execute` calls `setFarmEventFlag()` -> `{ updated, event_id, severity, reason }`.

> **The automatic classification path is not a write executor.** `classifyEvent()` calls the `setFarmEventFlag()` DB helper directly, with no card and no approval, because a pass over a day's camera rows must not prompt per row. `flag_anomaly` is the human-approved entry point onto the same `UPDATE`. Two entry points, one statement - see [FARM_MONITOR.md](farm-monitor.md) Decision 6.

Card label helpers: `tagLabel(animalId)` renders `TAG (name)` when a name exists, otherwise just the tag - so with the current name-less seed, cards read by tag (e.g. `B-001`). Vendor cards use `vendorLabel(vendorId)` (the vendor's name). Farm cards use `eventLabel(eventId)`, which renders the event as `event_type on camera (zone) at YYYY-MM-DD HH:MM` in **farm-local** time.

---

## Limits and history

Unknown IDs return structured errors. Model instructions treat tool output as data, not authority. Registry precision evals and live-model gates are in [testing](../../guides/testing.md). The [Cycle 9 record](../../records/REGISTRY_TOOLS.md) retains why writes were deferred; its old tool totals are historical.
