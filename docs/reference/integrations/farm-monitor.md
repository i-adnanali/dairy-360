# Farm event classification

Current reference for deterministic classification and daily reconciliation. [classify.ts](../../../server/src/farm/classify.ts) owns pure rules; tool executors supply history and persistence. Classification is not a model-generated assessment.

## Rules and time

`FARM_TZ` is `Asia/Karachi`. Work hours are 04:00 inclusive to 20:00 exclusive. The provisional restricted zone set contains `feed_store`. Priority is:

1. Restricted-zone activity outside work hours is urgent, regardless of identity.
2. An unknown cluster becomes notable at its first occurrence and urgent at the third; history uses an event-relative 21-day lookback, counting the current occurrence once.
3. A named face match below 0.85 confidence is notable. This threshold does not classify generic detection confidence.
4. Remaining events are routine.

Camera silence uses a 15-minute threshold in the relevant period. Attendance/reconciliation is based on recorded observations and known windows, not proof that an unobserved person was absent.

## Tool and persistence contract

Farm-monitor tools are offered independently of dairy/vendor routing. Classification supplies severity/reason from deterministic rules; `summarize_daily_activity` may persist flags directly as part of its assessment. `flag_anomaly` is the separate human-approved entry point to flag mutation. Therefore the general statement that every assistant read is side-effect-free must not be applied blindly to the monitoring summarizer.

Repeated summarization can reclassify rows. Scheduling, unflagging/history and deployment policy remain explicit follow-ups. Model-facing output is a digest, not a raw capture archive.

## Known fidelity limits

Double Take's literal `unknown` label can pool distinct visitors into a global recurrence bucket. That cannot support a per-person recurrence claim on real hardware. Detection confidence and zone normalization also have recorded limits. These issues remain in [OPEN](../../OPEN.md), with detailed evidence in [Cycle 7 findings](../../records/cycle-7-followups.md).

## Verification and operation

[Camera operations](../../guides/camera-operations.md) explains scenario isolation and destructive verification boundaries. [Original monitor decisions](../../records/FARM_MONITOR.md) preserve reasoning and historical evidence. No live hardware acceptance was performed by the documentation reorganization.
