# Markdown audit — 2026-09-11

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
