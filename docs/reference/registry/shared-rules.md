# Shared registry rules

Current reference. These rules apply across the registry with explicit domain exceptions below. Sources: [schema](../../../server/src/registry/schema.ts), [routes](../../../server/src/registry/routes.ts), [idempotency](../../../server/src/registry/idempotency.ts), [backup](../../../server/src/registry/backup.ts) and the domain modules linked from this directory.

## Identity and storage

Registry identities are independent of demo data. Animal serials are user-facing identifiers; database IDs and event IDs are stable internal identities. Derived lactations/status/parentage are projections, not independent observations. Do not attach durable measurements to a projection identity that can change after corrections.

Source tables and projections share SQLite with other app domains. Migrations are ordered by `PRAGMA user_version`. Backup enumeration is derived from the registry table lists; it includes Feed and Health revisions, request bindings and attachment bytes. [Backup/restore](../../guides/backup-restore.md) owns operational procedures.

## Time, uncertainty and provenance

Use farm-local `Asia/Karachi` calendar dates for operational days, and UTC instants for transcription timestamps. Event occurrence and recording time are separate. Do not construct farm dates by truncating a UTC ISO instant.

Date precision is explicit where supported. A stored first-of-month/year representation must display only the recorded precision. Unknown and estimated values remain qualified. Defaults may express an established factual prior; they may not silently assert the operator's knowledge, precision, source or witness.

Recorder/source provenance is not authentication. Witness, milker, prescriber and administrator remain independent values. Older domains expose different source-reference fields; do not invent a common persisted field merely for UI consistency. Payroll and milk operational dates use their own exact-date contracts rather than inheriting animal-history precision fields.

## Corrections and retry guarantees

| Domain | Correction model | HTTP request replay |
|---|---|---|
| Animal lifecycle events | Append-only supersession; calving corrections maintain coupled records and rebuild projections | Existing process-local request handling |
| Milking, dispatch/sales and payroll | Effective rows updated/removed under domain rules; no generic immutable before/after revision history | Existing process-local request handling |
| Feed | Atomic replacement plus immutable before/after revisions; expected revision/date conflicts | Durable successful request keys bound to route/body/provenance |
| Health | Atomic record/revision/result transaction; expected revision and correction reason | Durable successful keys bound to method/path/body and saved response |
| Assistant demo writes | Separate executor model | No cross-request replay guarantee |

Writing registry routes require request keys and provenance as defined by their API. An exact retry must retain endpoint, payload and key. A changed request needs a new key. Durable Feed/Health failed transactions do not reserve a successful result. A server restart can invalidate process-local replay knowledge in older domains; do not advertise exactly-once behavior across that boundary.

Pending/unknown UI writes lock edits and preserve the original request. Expected revisions reject stale Feed/Health edits with 409; the user explicitly reconciles their draft with the latest record. Rendering an approval, disabling a button or receiving a normal stream ending does not prove a mutation succeeded.

## Amounts and quantities

Money uses integer minor units. Rates retain the unit/lot size of the agreement. Dispatch rates are captured with saved rows; later agreements do not rewrite prior transactions. Payroll earned amounts, payments and in-kind benefits have different meanings. Feed preserves original units; only supported mass conversions are automatic. Null/unknown is not zero.

## Verification and limitations

Integrity violations, advisory review work and coverage gaps are separate outputs. An empty registry can pass invariants vacuously. Missing observations are valid uncertainty, not necessarily corruption. CLI verification is described in [registry CLI](../../guides/registry-cli.md).

Current limits include no authentication/tenancy, no revision history for the older mutable money/milking domains, and independently deferred operator/device acceptance. [Open work](../../OPEN.md) indexes these without changing their status. The original shared design is preserved in [the registry record](../../records/REGISTRY.md).
