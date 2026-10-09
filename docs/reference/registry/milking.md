# Milking

Current reference for `/milk/milking` and animal yield history. [Shared rules](shared-rules.md) apply.

## Recorded states

| State | Meaning |
|---|---|
| No row | No answer recorded; not a measured zero |
| `measured` | Milk was measured; a numeric yield is present |
| `milked_not_measured` | Milking occurred without a measured quantity |
| `not_milked` | An explicit exception with its reason |

Records identify animal, farm-local date and morning/evening session. Measurements refer to stable animal/date identity, not derived lactation IDs. Historical correction of calving can change grouping without deleting the measurement.

Actual clock time is optional and never defaulted. Morning/evening windows vary, so same-session series may be compared while an inferred equal-interval morning-versus-evening comparison is unsupported. A daily total can sum recorded sessions while retaining completeness qualifications.

## Entry and calculations

The roster derives eligible animals for the selected date/session. Partial answers can be retained without converting untouched rows to explicit states. Locally paged session sheets retain the entire draft, validate hidden rows and save the intended collection atomically. Invalid fields are brought into view. Successful saving offers continuation to matching Dispatch.

The recorded milker is separate from recorder and may have per-row overrides. A recent-mean hint uses measured rows from the same session; unusual values produce warnings rather than invented replacements. Health withdrawal instructions remain warnings alongside actual production, not reasons to set measured milk to zero.

The owner has specified measuring each animal every milking. Historical and exceptional unmeasured/missing records remain representable. [Analytics](analytics.md) defines coverage and qualified totals.

## Persistence and correction

Migration 3 introduced `registry_milkings`, unique by animal/date/session. Effective records can be updated or removed under domain validation; this domain does not have Feed/Health-style immutable revisions. HTTP retries use the older process-local mechanism. Preserve exact pending requests and do not promise replay protection across restarts.

## Interfaces and evidence

[milking.ts](../../../server/src/registry/milking.ts), [routes.ts](../../../server/src/registry/routes.ts) and [milking-roster.ts](../../../web-angular/src/app/registry/milking-roster/milking-roster.ts) own calculations, validation and entry. [Screen acceptance](../ui/acceptance-status.md) records executed checks. [Original design and schema](../../records/REGISTRY_MILKING.md) retain historical reasoning, not a requirement to restart the build sequence.
