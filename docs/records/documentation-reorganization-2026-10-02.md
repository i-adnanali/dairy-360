# Documentation reorganization — 2 October 2026

Baseline: `43438b1`. Documentation and citation changes; no domain model, calculation, API behavior, deployment or acceptance-gate changes.

## Delivered structure

The root docs directory now contains the task-oriented index, active backlog and one UI-system compatibility pointer. Maintained material is under `guides/`, `architecture/` and `reference/`. `decisions/README.md` indexes established decisions without inventing retrospective approvals. Twenty-nine original root documents are preserved in `records/`; earlier archive and implementation evidence remain available.

[The relocation/ownership map](documentation-map.json) records each original path and current owner. Historical text remains baseline-scoped, with relative links rebased. Original specifications, incidents, measured payloads and delivery evidence were retained rather than merged into current instructions.

## Content ownership

- Unified current UI roles and separated application-wide navigation, Today, sessions, drafts and recovery from payroll history.
- Separated system/frontend/assistant/protocol explanations and tool contracts.
- Added shared registry rules with explicit per-domain correction and replay differences; retained separate Animals, Milking, Sales, Payroll, Feed, Health and Analytics references.
- Consolidated confirmed Feed practice and shipped Health behavior without requiring readers to apply proposal deviations.
- Extracted development, testing, CLI, backup/restore, camera capture/operations and tracing guides.
- Established stable identifiers in OPEN and retained camera FU identifiers/evidence. Deferred acceptance remains open. Removed the already-superseded contrast-failure and filename-housekeeping claims.

## Executable documentation and checks

`check:docs` checks Markdown targets/anchors, HTML images, source citations and screenshot hashes/dimensions/snapshot consistency. Focused checker tests cover broken references, duplicate/Unicode headings, code exclusion and manifest drift. CI invokes this gate after dependency installation.

Registry route-table tests now read the maintained HTTP reference. Camera shape validators still read the preserved original payload baseline intentionally. Their paths were updated; normalization and classification were not changed. Other source changes update citations, including SQL/HTML comments and diagnostic text.

Validation: all 779 server tests passed, including route-table and payload-baseline consumers. The documentation gate passed all 3 checker tests and 1,429 local links across 91 Markdown files, including screenshot hash/dimension checks. Template checks passed for 89 components and whitespace checks passed. Frontend unit suites and production build were not rerun for the documentation/citation-only changes. No live camera/model, persistent database, native-device, screen-reader, zoom, print/export, deployment or operator acceptance was performed.

The 367 local review artifacts were preserved byte-for-byte. Existing README screenshots and their original image hashes/bundle provenance were retained because their rendered workflows are unchanged. No new UI acceptance is inferred from this documentation work.
