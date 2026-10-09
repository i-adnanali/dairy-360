# Health and lifetime reports

Current reference for the delivered visits, cases, plans, administrations, vaccination rounds and reports. The original per-entity-table proposal is superseded by the revisioned record implementation below. [Shared rules](shared-rules.md) apply.

## Using it

Open **Herd → Health** (`/animals/health`). Browsing is available without a recording
session. Writing uses the existing source/recorder session. The vet, prescriber,
actual administrator and recorder are separate values.

1. Start a veterinary visit, identifying its date/precision, doctor and purpose.
2. Use **Examine animal** on the visit to capture an animal's findings and suspected
   or confirmed diagnosis. Link a case when the problem spans multiple visits.
3. Record actual medicine/vaccine administrations; optionally link them to the visit,
   examination, case, plan and scheduled task. Capture product, amount/unit, route,
   administrator, lot/expiry and veterinary withdrawal instructions.
4. Create a treatment/vaccination plan and individual scheduled tasks. These do not
   assert doses were given. Use dose/series labels where helpful. Schedules are
   entered from veterinary instructions; no clinical schedules are invented.
5. Complete an administration task with an administered-dose record, or a recheck/test
   task with a matching result. Defer, miss or cancel with a reason. Plan completion
   requires all tasks accounted for; missed/cancelled work remains distinguishable.
6. Review case outcomes and active plans before closing a case. Reopen with a recorded
   correction when necessary. Closing a visit never completes a course automatically.

**Vaccination round** records shared product details and explicitly selected animal
outcomes. Given rows create doses, deferred rows create audited rescheduled tasks,
and not-given rows create cancelled tasks. The submitted batch commits entirely or
not at all. Per-animal clinical variations can be entered through individual dose
forms; the round API also accepts row overrides.

The board shows overdue, due and upcoming work, open cases and recorded withdrawal
instructions requiring review. Today links to that board. Milking roster warnings
preserve actual measured production; they do not zero milk or claim that pooled
milk dispatch can identify individual animal contributions.

Open an animal and choose **Life report / vaccination card**. The report combines
registry life events, identity, parentage, calvings/lactations, milk records, health,
feed participation and directly attributed health costs. The vaccination card and
current outstanding instructions retain all-history/current context; occurrence-date
filters apply to historical sections. Approximate dates remain marked, and year/month
records overlap date ranges rather than disappearing due to their stored first-day
convention. Estimated history remains visible because its bounds are uncertain.

The report includes full JSON export and measured pages for browser Save as PDF. Use A4 portrait at 100% scale. Each sheet repeats the animal identity; wrapped names reduce the available body height instead of overlapping content. Chrome and Safari exports were verified against complete synthetic audit content. Alternative paper/orientation/scale can split sheets without repeated identity; broader support was skipped by decision, not verified.
Long sections use local pagination with 25, 50 or 100 records per page. Print/export includes
all loaded records. Source fields remain available separately from readable record
content. New structured weight, movement, breed, breeding/pregnancy and discarded-milk
capture is **not included**: these are stage 3, explicitly identified as gaps.
No individual consumption, pooled revenue or animal profitability is inferred.

## Persistence and audit

The migration adds five source tables:

- `registry_health_records`: stable identities, entity kind, registry animal FK,
  current revision and JSON data for visits, examinations, cases, products, plans,
  tasks, administrations, results and costs.
- `registry_health_revisions`: append-only before/after states, operation, correction
  reason, recorder/source provenance and timestamp. Task actions use this same audit
  stream instead of a separate task-action table.
- `registry_health_requests`: durable successful request keys, method/path/body
  binding and saved JSON response. Failed transactions consume no key.
- `registry_health_attachments`: immutable JPEG/PNG/PDF bytes, checksum, name and
  recording information; at most 10 MiB/file.
- `registry_health_attachment_links`: immutable record/revision links to attachments.

This consolidates the specification's proposed per-entity tables into the same
revisioned JSON approach used by feed, with one shared health entity table. Animal
identity is enforced by a database FK; health entity relationships and matching
animal/type constraints are validated by the transactional domain layer. No health
record references demo animals or regenerable lactation IDs.

Every write, revision and successful request response commits in one transaction.
Revisions require an expected revision and a reason (`correction_reason`, with
`reason` accepted for API compatibility). A stale revision returns 409. The UI keeps
the draft, can compare the latest saved version, and requires an explicit choice
before applying it to the new revision. Navigation warns about unsaved changes.

Actual doses and follow-up results complete tasks through evidence IDs. Voiding or
unlinking completion evidence reopens its task and plan. Catalog edits do not rewrite
stored product or administrator text. Known administration details require a positive
amount/unit, route and administrator; incomplete historical records explicitly state
what is unknown and why. Similar doses require a distinguishing reason.

All five tables join the registry backup source list. SQLite bytes travel with binary
snapshots and logical dumps. `checkHealth` verifies revision continuity/current state,
completion evidence and attachment checksums, and participates in `/check` and
`verify:registry`. Projection rebuilds do not delete health records.

`cleanupHealthUploads(db, now)` removes only unlinked staged uploads older than seven
days; it is an explicit maintenance helper, not a new background scheduler. Linked
bytes remain retained across revisions/voids and cannot be replaced. Uploads are one
file per request, with at most ten attachments linked to a record. Download responses
use attachment disposition, `nosniff`, restrictive CSP and no-store caching.

## Interfaces

`health-routes.ts` mounts under the existing `/api/registry` router. Health writes use
`Idempotency-Key` and return 200 with the saved representation; invalid fields are 400,
missing references 404, stale revisions/key conflicts 409, oversized file payloads 413.

- `/health/board`, `/animals/:id/health`, `/animals/:id/life-report` are composed reads.
- `/health/:entity`, `/health/:entity/:id` provide entity reads/create.
- `/health/:entity/:id/revise`, `/void`, and `/revisions` provide audit operations.
- `/health/tasks/:id/actions` records completion/defer/miss/cancel actions.
- `/health/rounds` submits a confirmed vaccination batch.
- `/health/attachments` uploads a base64-encoded file; `/health/attachments/:id` downloads.

The UI is consolidated at `/animals/health` rather than introducing separate visit/case
routes for every action. Record selectors link the entities. The report lives at
`/animals/:id/report`. Report responses contain all records in one consistent read
snapshot; the UI pages these already-loaded records locally. See
[analytics and pagination](analytics.md) for the shared controls. Server pagination
is a scaling follow-up, and neither exports nor counts silently truncate history.

Assistant reads: `get_registry_health`, `get_registry_health_board` and
`get_registry_life_report`. They use registry serials and preserve source evidence and
coverage. Registry writes remain reviewed forms; the demo health tools are not reused.

## Entry and exception handling

The opened editor precedes the board. Dose fields are grouped by identity/date, administration, historical exceptions, withdrawal and evidence. Blank irrelevant explanation fields may be disclosed; existing values and errors remain visible. Search/round summaries support selection without changing the intended recipients or outcomes.

Actual administration, planned work and operator/veterinary instructions remain different facts. No built-in clinical schedule, efficacy claim or inferred withdrawal clearance is generated. Existing historical data can explicitly state unknown details and the reason; unknown is not permission to fabricate a complete administration record.

## Limits and evidence

Structured weight, movement, breed, breeding/pregnancy and discarded-milk capture remain deferred stage-3 scope. Clinical, real-farm and exhaustive print/export acceptance are not implied by the implemented report layout. [Acceptance status](../ui/acceptance-status.md) records performed checks and the owner-approved exclusions.

[Testing](../../guides/testing.md) describes the synthetic harness. [Original requirements](../../records/ANIMAL_HEALTH_SPEC.md) and [delivery record](../../records/REGISTRY_HEALTH.md) preserve original acceptance examples, deviations and dated measurements.
