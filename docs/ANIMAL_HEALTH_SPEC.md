# Animal health management and lifetime report specification

Status: **Original specification; stages 1–2 implemented with refinements on 2026-09-15.**
Current behavior, refinements and remaining stage-3 scope are documented in
[REGISTRY_HEALTH.md](REGISTRY_HEALTH.md). The original baseline findings below describe
the pre-implementation codebase.

Baseline: `b5a7064fe2758e877cc750e4b3a01f1fcd55a659`, inspected 2026-09-14.
The working tree was clean before this documentation change. Validation is static
source inspection, not a live farm-data audit, runtime acceptance test, or clinical
validation. This document defines software behavior; veterinary instructions are
entered as records, never generated from a built-in treatment protocol.

## 1. Outcome and scope

The farmer must be able to answer, for any real registry animal:

- What did the vet observe, diagnose, prescribe, and actually administer?
- Which visit, illness episode, vaccine series, person, and product batch explain it?
- What remains due, overdue, unresolved, or subject to recorded withdrawal instructions?
- What happened across this animal's recorded life, and where does each fact come from?

A visit is an encounter, a case is a continuing problem, a plan is an instruction,
and an administration is evidence that a product was actually given. These are
separate records. Neither a prescription nor a scheduled task counts as a dose.

The first release includes visits, examinations, cases, product references,
administrations, treatment/vaccination plans, follow-ups, attachments, health
history, a vaccination card, and a lifetime report over supported domains.
Missing lifetime domains are visible as coverage gaps, not silently invented.
Further structured lifetime capture is staged in section 11.

Not included: automatic diagnosis/dose selection, pharmacy stock accounting,
automatic medicine purchasing, billing/payroll for vets, external messaging,
new authentication/roles, or automatic attribution of pooled milk revenue to an
animal. Existing recording provenance is not an authenticated signature.

## 2. Codebase validation and corrections to the initial proposal

| Finding | Inspected code | Design consequence |
|---|---|---|
| `health_events` refers to demo `animals`; its fields are date, type, notes, next due date | [db.ts](../server/src/db.ts), [shared types](../shared/src/types.ts), [health writes](../server/src/tools/writes.ts) | Do not extend this table for real animals or import its seeded history automatically |
| Demo health reads use a future date window which excludes already overdue entries | [reads.ts: getHealthEvents](../server/src/tools/reads.ts) | New registry task status must explicitly include overdue work |
| Real records use `registry_animals`, independent of demo resets | [schema.ts](../server/src/registry/schema.ts) | All health animal references target registry identity; no demo foreign keys |
| Animal event types are constrained to birth, acquired, calving, dry_off, departure, note | [schema.ts](../server/src/registry/schema.ts), [types.ts](../server/src/registry/types.ts) | Health is a separate domain; do not squeeze plans into note payloads or casually widen the event enum |
| Animal events are append-only, corrected through supersession; status/parentage/lactations are projections | [schema.ts](../server/src/registry/schema.ts), [reads.ts](../server/src/registry/reads.ts) | Health facts need equivalent auditable corrections; permanent references must not point into lactation projections |
| Current animal detail contains identity, status and animal events, not a cross-domain life report | [reads.ts: AnimalDetail](../server/src/registry/reads.ts), [animal-detail.ts](../web-angular/src/app/registry/animal-detail.ts) | Add a composed report read model and profile sections |
| Real milkings distinguish measured, milked-not-measured, not-milked, and absent row | [types.ts](../server/src/registry/types.ts), [milking.ts](../server/src/registry/milking.ts) | Preserve completeness; do not turn missing yield into zero |
| Feed stores confirmed recipient snapshots and shared quantities/costs | [feed.ts](../server/src/registry/feed.ts), [schema.ts](../server/src/registry/schema.ts) | Show participation; do not present shared consumption/cost as measured per-animal consumption |
| People can represent non-employees; provenance strings are not identity foreign keys | [types.ts: PersonRow](../server/src/registry/types.ts), [people.ts](../server/src/registry/people.ts) | Reuse people optionally for vets; snapshot the recorded identity; no employment requirement |
| General route idempotency is in memory; feed adds durable request binding and revisions | [idempotency.ts](../server/src/registry/idempotency.ts), [routes.ts](../server/src/registry/routes.ts) | Health uses durable idempotency and revision conflict checks from the start |
| Eight migrations currently exist; source table lists drive backup selection | [schema.ts](../server/src/registry/schema.ts), [backup.ts](../server/src/registry/backup.ts) | Append migrations; register every health source table; test restore and verification |
| Today composes domain read models with an explicit date | [overview.ts](../server/src/registry/overview.ts) | Add health standing using the same server-side calculation as the health board |
| Registry chat tools are separate from demo health tools | [registryReads.ts](../server/src/tools/registryReads.ts), [catalog.ts](../server/src/agent/catalog.ts) | New registry health/report tools need registry serial guards and explicit routing |
| No dedicated health routes, uploaded-document subsystem, or lifetime PDF exporter was found in application source | [app.routes.ts](../web-angular/src/app/app.routes.ts), [routes.ts](../server/src/registry/routes.ts), [server package](../server/package.json) | These are new features, not integration switches |

**Correction to the earlier discussion:** the basic vaccination log is a demo
capability, not a foundation of real-animal health history. Reuse registry
infrastructure and patterns instead. Also, a full report cannot presently promise
structured weight, movement, pregnancy-check, or per-animal profitability histories.

## 3. Operational workflows

### 3.1 Vet visits and immediate treatment

1. Start a visit from Health, Today, or an animal profile. Select the date and vet;
   record visit reason and source. A multi-animal visit has a shared header.
2. Add animals explicitly. Each has its own examination: observations, optional
   measurements with units, diagnosis text and certainty (suspected/confirmed),
   tests, recommendations, and links to existing/new cases.
3. Record each administered product separately with actual animal, date/time
   precision, product snapshot, amount/unit, route, administrator, and available
   batch information. Unknown values remain explicitly unknown.
4. Add future instructions as a plan with dose tasks and/or recheck tasks. Save a
   visit without a plan when the vet has given no further instructions.
5. Review and finalize the visit. Saved administrations remain facts even if a
   visit is still open; visit closure never completes its pending treatment tasks.

Example (software fixture, no clinical dosing guidance): BD-0001 has reduced
appetite. Visit V1 records a suspected condition and one actual administration of
Product A. Plan P1 records a vet-directed subsequent dose and a recheck. Next day,
staff complete the dose by entering an administration linked to P1's task. At the
recheck the vet records the outcome. The animal report traces each step back to V1.

### 3.2 Treatment across visits

A case belongs to exactly one animal and can span visits. One examination can
address several cases; its findings/administrations must specify the applicable
case(s). Closing a case requires an outcome and explicit handling of its open
plans: leave active, cancel remaining tasks with a reason, or finish a fully
accounted plan. Reopening is an audited action, not overwriting the old outcome.
A new unrelated illness starts a new case.

### 3.3 Vaccination round and card

Choose product and batch, then confirm a date-specific list of registry animals.
For each selected animal explicitly record given, not given, or deferred. Shared
values prefill the form but do not assert that all selected animals received it.
Review individual exceptions before an atomic batch submission. A validation
error saves none of that submitted batch; the UI retains entries for correction.
A later additional batch can join the same visit/round.

Each given row creates an individual administration. Not-given/deferred entries
are task actions with reasons, never administrations. The vaccination card shows
vaccine/product, indication if recorded, actual date/precision, amount/unit,
batch, administrator, linked series/dose label, upcoming instruction, and source.
Print from the animal profile; include animal serial/tag and report generation
stamp. Unknown prior vaccination history is visible. Never label an animal
"fully vaccinated" merely because recorded tasks are complete.

### 3.4 Daily staff work

Health board: overdue, due today, upcoming, follow-ups, open cases, and withdrawal
instructions requiring attention. Filter by animal, task type, assigned person,
and date. Today shows actionable counts linking to these same filtered lists.
No unsolicited external notifications are introduced by this release.

Complete a dose only by linking/creating an actual administration for the same
animal and compatible task. Record missed, deferred, or cancelled with a reason.
Deferral preserves the previous due date and records a replacement due date.
Changing a plan affects future tasks only and preserves already given doses.

### 3.5 Historical entry and corrections

Support prescription/card transcription using existing source-form values plus
source_ref and attachments. Preserve day/month/year/estimated date precision.
Historical product, amount, vet or batch can be unknown without preventing entry;
show an incomplete-details flag. Do not silently default date, doctor, dose or
witness. Duplicate-looking entries prompt review but can be explicitly confirmed
as distinct administrations. Corrections and voids retain the original, reason,
author and timestamp; they are not physical deletes.

## 4. Proposed domain/storage contract

Names below are proposed tables, **not existing code**. Use `registry_health_`
prefixes and stable UUID record identities; all animal IDs reference
`registry_animals.id`. New domain functions accept a supplied `Db` handle.

| Entity | Minimum content and relations |
|---|---|
| visits | ID, occurred date/precision and optional time, vet person ID optional + identity snapshot/unknown, reason, open/closed status, provenance |
| examinations | ID, visit ID, animal ID, findings, measurements with units, diagnosis and certainty, recommendations; explicit case links |
| cases | ID, animal ID, title/problem, opened date/precision, open/resolved/closed status, outcome; links to examinations |
| products | ID, name, vaccine/medicine/other kind, formulation/strength when known, active flag; catalog revisions |
| plans | ID, animal ID, examination/case link when applicable, treatment/vaccination kind, prescriber snapshot, instruction text, active/completed/stopped status |
| tasks | ID, plan ID optional, animal ID, administration/recheck/test kind, due date and optional time, assignee optional, product/instruction snapshot where relevant |
| task_actions | Append-only action ID, task ID, previous revision, action, reason, replacement due date if deferred, linked administration/result ID if completed, provenance |
| administrations | ID, animal ID, visit/examination/case/plan/task links as applicable, product ID optional plus immutable product text snapshot, actual date/precision/time, amount/unit, route, administrator snapshot, lot/expiry, withdrawal instructions, provenance |
| results | ID, animal ID, examination/case/task links, test or follow-up type, result text, optional structured value/unit and certainty, date/precision, attachments |
| attachments | ID, validated MIME type, original filename, size, checksum, immutable bytes; link records identify owning health record and revision |
| costs | ID, visit or administration link, amount in minor currency units or explicitly unknown, currency, direct animal attribution or unallocated shared visit cost, provenance |
| revisions | Append-only before/after representation, stable entity ID, revision, operation, correction/void reason, provenance; all changed entities covered |
| requests | Durable idempotency key, canonical method/path/body hash, exact successful response/status |

Use current entity tables plus append-only revisions, following the feed precedent.
Every create/change/void records a revision in the same transaction. Add database
triggers preventing revision UPDATE/DELETE/REPLACE, enable registry pragmas, and
verify current rows match replayed revisions. Entity foreign keys reference stable
identities, not revision IDs or regenerable projections. A void leaves the identity
present. Histories expose both effective state and correction history.

Common provenance: recorded_by, recorded_at (UTC), source_form, source_ref,
observed_by where applicable. Actual administrator/prescriber is distinct from
recorder. Optional person IDs do not rewrite historic identity snapshots when a
person's contact/name changes. Known current administration details require a
positive amount with a unit; unknown historical values carry an explicit unknown
marker/reason, never zero. Clinical interpretation of a prescription remains with
the veterinarian; software validates form consistency, not medical correctness.

Attachment decision: store immutable, size-limited JPEG/PNG/PDF bytes in SQLite
for the first release, so existing consistent database snapshots include them.
Default proposed limit: 10 MiB/file and 10 files/upload. Validate file signatures,
serve through a dedicated download route with safe content headers, and never
execute or automatically fetch attached content. Uploads produce staged IDs; only
linked attachments appear in records. Retain linked bytes across corrections.
Exclude staged unlinked files from reports; provide an explicit cleanup policy
for unlinked files older than seven days. Test backup size/restore; a future move
to filesystem/object storage requires a manifest-based backup design first.

## 5. Integrity, time and lifecycle rules

- A linked visit examination, case, plan, task, result and administration must
  agree on animal identity. Visit headers may span animals; case IDs may not.
- Actual administrations cannot be future-dated. Historical records outside the
  recorded ownership interval require a reason and show as external history;
  do not change presence or lactation projections.
- Tasks use exact farm-local due dates; optional due times are not fabricated.
  Imprecise historic doses cannot automatically anchor a precise booster date.
- Resolve states with an explicit farm-local `as_of` date/time: outstanding tasks
  before their due point are upcoming; at the due day they are due; after the
  day/time they are overdue. Date-only tasks become overdue on the following day.
- Completed, cancelled and missed are explicit terminal task dispositions.
  Missed tasks remain visible in history; rescheduling creates a linked new task.
  Deferred tasks stay outstanding at the replacement date with preserved actions.
- A plan can finish only when all tasks are terminal. Display "completed with
  exceptions" if any were missed/cancelled; do not equate it with doses received.
- One task has at most one effective completing administration. Additional doses
  get separate tasks or unscheduled entries. Correcting/voiding a completing
  administration reopens the task unless an explicit replacement is linked.
- Departed/deceased animals stay searchable. Outstanding work is marked needs
  review rather than automatically administered/completed or silently discarded.
- Every update requires expected_revision. A stale update returns 409 with current
  revision and preserves entered values for review. No silent last-write-wins.
- Successful idempotency keys bind to method/path/body durably, including across
  restart. Changed payload with a successful key returns 409; failed transactions
  do not consume keys. Domain writes, audit rows and request result commit together.

Withdrawal instructions have separate milk and meat states: unknown, explicitly
none per recorded instruction, or specified. Preserve instruction text and issuer.
A specified duration needs an explicit anchor and unit, or a vet-entered end
instant. Without a sufficiently precise anchor show "end requires clarification";
never invent a safe release time. Combine applicable known intervals without
shortening one; retain unknown/unresolved instructions alongside known ones.
Correcting a dose recomputes derived restrictions with audit visibility. Surface
recorded restrictions on the animal and milking roster. Do not change measured
milk to zero or presume discarded milk was not produced. No automatic sales-block
claim: dispatch records bulk milk and cannot trace individual animal contributions.
Structured per-animal discarded-milk recording is a separate stage-3 extension.

## 6. Lifetime profile and report contract

Add one server-side composer reused by UI, JSON export, printable view and assistant.
It must not synthesize real history from demo tables or infer a diagnosis from a
milk drop. Links to related records accompany every section and timeline item.

| Section | Existing coverage and delivery requirement |
|---|---|
| Identity/origin | Registry identity, origin events, dates/precision, parentage and exit; structured breed must be added if needed, not inferred from species |
| Reproduction | Existing calvings, parentage, parity, lactations and interval quality; breeding/pregnancy checks require new structured capture |
| Production | Existing milkings with completeness by session/date, measured totals and lactation context; no blended morning/evening averages |
| Health | New visits, cases, actual doses, vaccination card, plans, outcomes, documents and withdrawal instructions |
| Feed | Saved recipient participation and shared ration context; unknown recipients stay unknown; no equal-share consumption assumption |
| Growth/movements | No dedicated structured registry history found; identify as unsupported until stage-3 capture exists |
| Financial | New directly recorded health costs; shared visit costs remain separate. Feed/sales/payroll are not per-animal profit ledgers |

Response envelope: schema_version, animal_id, generated_at, data_snapshot_at,
filters, current_snapshot, sections, timeline page/cursor, totals/completeness,
and coverage warnings. Section states: recorded, no_records, not_supported,
partial. No_records means no evidence entered, not "never happened".

Offer summary and full-detail views. Full export contains all requested effective
records, with an optional corrections appendix. UI pages large milk/feed histories;
export must process all pages without silent truncation. Preserve approximate dates
and source provenance in print, with repeated animal identity and page numbers.
Default report is all recorded life as known at generation; optional occurrence-date
filters do not claim to reconstruct the database as it existed on that date.
Use one consistent database read snapshot for the report. Initial PDF delivery is
printable HTML with browser Save as PDF; automated server PDF generation is not
assumed to exist. Retain an export generation stamp, not an assurance of immutable
historical report re-creation from mutable legacy milk/feed data.

## 7. Proposed API and UI integration

All paths in this section are proposed. HTTP paths are relative to `/api/registry`.

| Interface | Contract |
|---|---|
| GET `/health/board?on=...` | Shared task/withdrawal/open-case standing, paginated details |
| GET `/animals/:id/health` | Health history, card and active plans; registry identity only |
| GET `/animals/:id/life-report` | Composed section data and explicit coverage; cursor/date/detail options |
| GET `/health/visits/:id` and entity list/detail reads | Effective state with revision and history links |
| POST `/health/visits`, `/health/examinations`, `/health/cases`, `/health/plans`, `/health/administrations`, `/health/results`, `/health/products` | Validated creation using shared domain functions |
| POST `/health/rounds` | Atomic explicitly confirmed per-animal administration batch |
| POST `/health/:entity/:id/revise` or `/void` | Expected revision, reason, same transactional audit rules |
| POST `/health/tasks/:id/actions` | Complete/defer/miss/cancel with state checks and evidence |
| POST `/health/attachments`, GET `/health/attachments/:id` | New bounded upload/download contract; linked metadata in reads |

Writes require provenance and `Idempotency-Key`; known reference failures are 404,
invalid fields/transitions 400, stale revision or bound-key conflict 409, oversized
upload 413. Return stable error codes and field paths. Bulk errors identify the
animal row. Server validation applies regardless of UI or assistant caller.

Frontend: `/animals/health`, `/animals/health/visits/new`, visit/case detail routes,
profile health and vaccination sections, and `/animals/:id/report`. Put literal
`animals/health` routes before `animals/:id` in `app.routes.ts`. Add Record/Review
navigation links using existing UI components and session gating; reads remain
available without starting a recording session. Do not silently persist recorder
identity across reloads. Show unsaved changes and preserve inputs on save failure.

Assistant first release: registry-only read tools for animal health, due work and
life report, with serial guards and source record IDs. Update tool catalogs,
dispatch, prompt guidance and tool tests together; never route a registry animal
to demo `log_health_event`. Health writes initially use reviewed forms. Later
assistant writes must call the same domain commands and existing confirmation
flow, not execute SQL or generate independent treatment schedules.

## 8. Migration, backup and verification integration

Append migration(s) after the current eight; choose final numbers at implementation
so concurrent migrations are not overwritten. Never edit historical migrations.
Use the existing pre-migration backup hook. No demo data migration or fabricated
seed records in the real database. Historical import is explicit, provenance-rich,
and resolves each animal serial before writing.

Register all health source/audit/request/attachment/link tables in REGISTRY_TABLES
in dependency order. Only genuinely regenerable tables belong in
REGISTRY_PROJECTION_TABLES. Extend verification/replay and backup restore tests;
new health checks may follow `checkFeed`'s domain-specific pattern rather than
assuming the existing RegistrySnapshot already includes them. Do not make legacy
animal-event projection rebuilds delete health facts. A failed migration rolls
back and preserves the pre-migration snapshot; restore is rehearsed on a copy.

## 9. Acceptance scenarios

| ID | Scenario and required evidence |
|---|---|
| H01 | Visit with two animals and different findings produces separate histories under one visit |
| H02 | Three planned doses with one administration reports one received and two outstanding |
| H03 | Case spanning two visits shows its original diagnosis, revision and final outcome |
| H04 | Batch with given/deferred/not-given animals creates doses only for given rows; one invalid row rolls back the submitted batch |
| H05 | Same request replayed after restart returns the same IDs; changed body with successful key conflicts |
| H06 | Two writers revise one record; second stale revision conflicts, with no missing audit entries |
| H07 | Dose correction retains the original and reason; voiding task evidence reopens outstanding work |
| H08 | Month/estimated historic vaccination shows uncertainty and does not fabricate a precise due date |
| H09 | Board includes yesterday's overdue, today's due and later upcoming work using a fixed farm-local clock boundary |
| H10 | Withdrawal with unknown timing remains unresolved; concurrent instructions are not shortened; measured milk is preserved |
| H11 | Invalid registry ID or cross-animal case/task link is rejected; demo reset preserves all health records |
| H12 | Updated product/person names do not change historic dose/product/administrator snapshots |
| H13 | Card includes actual doses, batch/source and upcoming instructions; does not count prescriptions as vaccinations |
| H14 | Report preserves absent/unmeasured milk distinction, date precision, shared feed context and unsupported sections |
| H15 | Paginated lifetime UI and full print export have matching effective record totals and source links |
| H16 | Backup and restore include health audit and attachment bytes; checksums, replay, integrity and FK checks pass |
| H17 | Registry assistant answers use real serials, coverage and actual doses; no demo fallback and no treatment invention |
| H18 | Narrow-screen forms, session gate, retry/conflict input retention and multi-page report print are manually verified |
| H19 | Closing/reopening a case and departing an animal preserves pending-task review and explicit task outcomes |
| H20 | Staged uploads, invalid MIME/oversized files, download headers and linked-file retention are tested |

Implement focused domain/route tests in the existing in-memory harness. Add UI tests
for meaningful state transitions and routing, plus manual browser/print checks.
Run existing registry, feed, milking and tool tests and server/frontend typechecks
before merge. Never test migrations or fixtures against the live database.

## 10. Validation performed for this specification

Inspected schema, migration list, registry event/types/read models, backup table
selection, idempotency implementation and feed's durable wrapper, Today composer,
feed recipient handling, people/provenance model, Angular profile/routes/session,
and registry/demo assistant boundaries. Searched application source for vaccine,
health, upload, attachment and PDF support. No implementation files or databases
were changed. Documentation links and whitespace are checked with this change.

This establishes architectural fit and exposes missing infrastructure. It does not
establish runtime correctness of the proposed features; section 9 is the required
implementation acceptance plan, not a list of tests already passed.

## 11. Delivery stages and proposed defaults

1. **Clinical records and traceability:** health schema/audit/replay, visits/cases,
   examinations, catalog, actual administrations, attachments/costs, per-animal
   health history and historical transcription. Complete H01/H03/H05–H08/H11–H12/H16/H20.
2. **Active health management:** plans/tasks, group rounds, vaccination card,
   withdrawal display, Today integration, profile/lifetime composer and printable
   export over supported domains, plus assistant reads. Complete all remaining
   acceptance scenarios. Stage 1 alone is not the requested management feature.
3. **Expand lifetime capture:** structured breed, weight, movement, breeding,
   pregnancy checks and discarded milk, followed by explicitly attributable
   acquisition/exit costs if required. Each needs a focused schema/workflow addendum
   before implementation; a report heading alone does not implement a domain.

Proposed defaults for review: one farm; existing recorder session; vets may be
non-employees; manually entered veterinary schedules; unknown historical details
allowed; no external notifications; print-to-PDF; SQLite attachments with limits
above; shared costs shown unallocated. These are design proposals, not farm
practices confirmed by the user. The remaining scope decision is whether stage-3
capture must launch alongside health or can follow. No clinical protocol, vaccine
interval, or dose amount is assumed or required to implement this record system.
