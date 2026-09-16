# Markdown audits

## Current audit — 2026-09-16

Scanned all 39 repository-owned Markdown files for stale analytics, navigation,
pagination, harness and validation claims. Updated the root and Angular READMEs,
setup guide, documentation index, architecture/technical references, UI system,
registry domain docs, open work and analytics specification. Corrected a malformed
index row, the six-section navigation claim and obsolete life-report Show more
behavior. Historical records, baseline counts and dated galleries retain their
context; current extension notes identify superseding implementation.

Added a separate `harness:analytics` command and isolated scenario builder: 30
milked dams, 30 calves, three full months plus the current month, page boundaries,
complete comparisons, missing/pending sessions, unmeasured/not-milked answers,
explicit zero and both signs of production-minus-dispatch. Standard walkthrough
fixtures are unchanged. Analytics exports and server paging for composite histories
remain open, explicitly distinguished from delivered UI pagination.

Validation: 778 server tests pass, including fixture semantics and isolation;
server/shared typecheck passes. Checked 906 local Markdown file-link targets
(no missing files) and whitespace. A live HTTP smoke check confirmed isolated
storage, 60 animals, two destinations, monthly comparison and production page 2. Earlier frontend/build/browser results remain dated implementation
evidence in ANALYTICS_SPEC.md; this documentation/harness change does not alter
frontend code. External links, all heading anchors, running backup services and
real-farm data/practices were not revalidated. No persistent farm DB was opened.

## Historical audit — 2026-09-15

Scanned all 38 repository-owned Markdown files with targeted searches for stale
feature, schema, route, tool, backup and validation claims. Compared affected
references with registry schema/verification, health routes/read models, Angular
routes, agent prompts/tool schemas and package scripts.

Updated the READMEs and current references for migration 9 (32 registry tables),
health integrity check 30, durable health writes, veterinary/vaccination workflows,
lifetime reporting, and six herd/health assistant reads plus four sales reads.
Corrected the harness chat response, fresh-schema example, backup source scope and
Langfuse server environment-file instructions. Updated remaining-work entries and
marked original tool/spec findings as baseline history. Added the latest recorded
implementation validation without relabeling old measurements as fresh tests.

Validation: local Markdown file targets and `git diff --check`. Documentation-only
audit; no runtime tests rerun, live database inspection, deployment, camera/model
checks or verification of running backup services. Historical source-line citations
remain tied to their recorded baselines; they are not current line-number guarantees.

## Historical audit — 2026-09-11

Scanned all 35 repository-owned Markdown files present at the start of the sweep (17,745 lines), including the root, Angular, enrolment, archive and gallery READMEs. Dependency/generated files are outside this inventory. Compared current claims with package scripts, route/navigation definitions, schema and fixture code, agent approval handling, verification code and the recorded feed build/test outputs. This was a documentation-only pass; it did not rerun live-model/camera checks, inspect current backup services, or open the farm database.

## Corrections

- README and architecture references now include Feed, the six-section navigation and the separate galleries. Removed obsolete blanket claims that deletes and hardware integration do not exist.
- Fixed the false approval replay guarantee in README and TECHNICAL: consuming an approval within a run does not prevent a new request from repeating that write.
- Registry references now list 27 tables through migration 8, feed integrity check 29, HTTP 409 feed conflicts, and durable feed keys separately from older process-local replay handling.
- Development guidance uses the 2026-09-10 results: 742 server tests, 347 frontend tests in 33 files, and a 596.16 kB initial bundle. Older measurements retain their dates. Added the unused SummaryBar build warning to the existing budget/CommonJS warnings.
- Corrected default harness descriptions to `staffedHerd()` plus feed fixtures; retained the distinction from the guarded HTTP walkthrough. Fresh-schema guidance now acknowledges the serial allocator row.
- Resolved contradictory backup scheduling instructions by pointing to the recorded local job while keeping off-machine backup work separate. This does not assert that the job is running today.
- Feed specification is marked implemented, with its original handoff text preserved. Authentication handoff is marked historical and deferred rather than an instruction to restart brainstorming.
- Scoped missing source-reference capture and revision history to the older domains where they remain absent. Feed already provides both.

## Inventory and disposition

| Files | Disposition |
|---|---|
| `README.md`, `web-angular/README.md`, `docs/README.md` | Updated product coverage, navigation, galleries and document index |
| `docs/PROJECT_OVERVIEW.md`, `docs/TECHNICAL.md`, `docs/ANGULAR_PORT.md` | Corrected current architecture and approval claims |
| `docs/DEVELOPMENT.md`, `docs/REGISTRY.md`, `docs/UI_SYSTEM.md` | Updated current setup/schema/verification/harness guidance; preserved dated evidence |
| `docs/REGISTRY_ENTRY_UX.md`, `docs/REGISTRY_PAYROLL.md`, `docs/OPEN.md` | Clarified feed effects on current workflows and remaining work |
| `docs/FEED_SPEC.md`, `docs/AUTH_HANDOFF.md` | Added authoritative implementation/deferred status |
| `docs/images/phase7/README.md` | Explicitly scoped route coverage to the historical Phase 7 baseline |
| `docs/REGISTRY_FEED.md`, `docs/images/feed/README.md` | Checked against the completed implementation and captured evidence; no further change needed |
| `docs/REGISTRY_MILKING.md`, `docs/REGISTRY_SALES.md` | Historical feature counts and navigation proposals are already labelled; no rewrite needed |
| `docs/AGUI_MIGRATION.md`, `docs/OBSERVABILITY.md`, `docs/MULTI_AGENT.md`, `docs/REGRESSION.md`, `docs/REGISTRY_TOOLS.md` | Retained cycle records and existing later-change banners |
| `docs/FARM_EVENTS.md`, `docs/FARM_MONITOR.md`, `docs/cycle-7-followups.md` | Retained contracts, dated validation and unresolved follow-ups; no new live-device claims |
| `docs/cycle-7-live-camera-validation.md`, `docs/Cycle7-fu3-double-take-validation.md`, `double-take/enroll/README.md` | Retained recorded camera evidence and enrolment workflow |
| `PHASE5_PRECHECK.md` | Historical token measurements retained, not substituted for current contrast results |
| `docs/archive/README.md`, `docs/archive/ANIMAL_REGISTRY_DECISION_DOCUMENT.md`, `docs/archive/ANIMAL_REGISTRY_DECISION_DOCUMENT_V2.md`, `docs/archive/REGISTRY_UI_REFINEMENT.md` | Superseded proposals remain intact with their existing banners |

## Validation and limits

Checked local Markdown link targets and heading anchors, documented npm scripts against package manifests, current table/route coverage and whitespace. Historical command output, baseline test counts, source-line references and external/vendor claims remain evidence of their named versions, not newly verified current measurements. Runtime backup state, external links and real-farm trial results were not revalidated. The database-isolation incident remains explicitly documented in [REGISTRY_FEED.md](REGISTRY_FEED.md#database-preservation-incident-and-fix).
