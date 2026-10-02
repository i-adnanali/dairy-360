# Farm event ingestion

Current contract for optional camera ingestion. Sources: [ingest.ts](../../../server/src/farm/ingest.ts), [routes.ts](../../../server/src/farm/routes.ts), [shared types](../../../shared/src/types.ts) and [db.ts](../../../server/src/db.ts). Farm events are independent of registry animal lifecycle events.

## HTTP contract

| Endpoint | Input |
|---|---|
| `POST /api/webhooks/frigate` | Frigate's nested `type`, `before`, `after` event envelope |
| `POST /api/webhooks/double-take` | Recognition envelope with camera, timestamp and face result collections |

Normalization is pure and database writes are isolated in the router. Invalid payloads produce structured 400 errors. Valid skipped input yields 202 with a reason; inserted events yield 201 with count/IDs. `X-Synthetic-Source` marks synthetic records without changing upstream payload shape. It is fixture provenance, not authentication.

## Frigate

Only new events persist; update/end/false-positive inputs have documented skip outcomes. Epoch timestamps become ISO instants; camera, zone, object and available confidence are normalized. Confidence still prefers `top_score` over `score`: the measured new-event underestimation is a known deferred issue, not silently repaired by documentation.

## Double Take

Face collections are normalized into individual rows; empty face results can skip. Percent confidence is converted to the normalized unit interval. Unknown identity fields and absent details remain nullable. Real captures exposed differences from the original exemplar and literal `unknown` names that cannot identify an individual visitor.

## Persistence and boundaries

`farm_events` stores normalized facts, source payload context and synthetic/real distinction; additive classification fields do not replace the observation. [Classification](farm-monitor.md) applies deterministic rules. Camera silence is inferred over a period rather than fabricated as a received camera event.

The original JSON samples and measured deltas are retained in [the payload baseline](../../records/FARM_EVENTS.md#decision-2--real-payload-shapes-not-flattened-mocks). Payload-diff tools deliberately compare captures against that historical baseline and the generator; it is a fixture input, not a claim that every live version matches the original shape.

## Limitations and operation

Multi-zone denormalization, confidence fidelity, unknown-person recurrence and retention remain qualified by [open camera findings](../../OPEN.md). Synthetic success cannot certify face recognition or production hardware. Use [camera operations](../../guides/camera-operations.md) and [capture](../../guides/camera-capture.md) for commands and bounded validation.
