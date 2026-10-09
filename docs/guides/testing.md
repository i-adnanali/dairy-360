# Testing and evidence

Use synthetic data and injected memory databases. Never run fixture loaders against farm records. This guide distinguishes source/test coverage, browser execution and external acceptance.

## Local verification

After [installation](development.md), run from the repository root:

```bash
npm run build:shared
npm run check:docs
npm run check:templates
npm run typecheck
npm test -w server
npm test -w web-angular -- --watch=false
npm run check:contrast
npm run build:angular
```

Expected result: each command exits successfully. Template checking runs before compilation to identify malformed templates directly. Server test directories are deliberately enumerated so unit runs do not import live-model suites or open the persistent singleton. Do not broaden that glob without preserving the boundary.

For compiler-only frontend checks, use `--noEmit` to avoid writing JavaScript beside TypeScript sources:

```bash
web-angular/node_modules/.bin/ngc -p web-angular/tsconfig.app.json --noEmit
web-angular/node_modules/.bin/tsc -p web-angular/tsconfig.spec.json --noEmit
```

Frontend tests use Vitest/jsdom. A missing jsdom canvas implementation is not browser chart acceptance; verify rendered charts separately. Keep calculations/invariants in meaningful tests rather than treating screenshot appearance as proof.

## Synthetic browser workflows

Run `harness:app` for the standard herd/feed/health walkthrough or `harness:analytics` for 30 dams, 30 calves, multi-month records and paging/coverage examples. Both use memory-only storage. Their controls are documented in [development](development.md). For production-bundle checks, build first and serve against an independent memory harness.

For changed workflows, exercise desktop/mobile widths, light/dark themes, narrow and long content, keyboard/focus, labels/errors, cancellation, drafts, refusals and recovery. Record the actual route/state, dimensions, source baseline, bundle and fixture mode. Capture before/after where useful. Do not claim a native-device or screen-reader check from a desktop viewport.

Editable sheets need hidden-row validation and whole-session saves. Feed/Health need revision conflict and exact-retry checks. Assistant receipts need authorization distinguished from result. Exhaustive fault injection is separate from representative workflow checks.

## Live-model regression

```bash
npm run test:regression -w server
```

This calls the live model, needs `ANTHROPIC_API_KEY`, can spend tokens and is not part of ordinary isolated unit validation. Core, cap, fallback and registry-precision scripts are defined in [server/package.json](../../server/package.json). Missing credentials can skip tests; a skip is not a pass. Review setup/data access before running these suites.

CI gates the live suite on credential availability and manual/tag execution; ordinary pushes must not silently enable model spending. [Original regression design](../records/REGRESSION.md) preserves rationale and historical scenarios. It is not a fresh live acceptance result.

## Documentation verification

`check:docs` checks repository Markdown local targets and heading anchors, HTML image references, repository-relative source citations and the current screenshot manifest. It does not fetch external URLs or certify prose accuracy. A small self-test suite exercises broken links, anchors, fenced/inline code handling and image checks. Preserved local reviews remain outside the tracked-document check.

## Evidence ownership

Dated suite totals, warnings, screenshots and remaining gates belong in [latest implementation evidence](../implementation/angular-acceptance-2026-10-07/ACCEPTANCE.md). Current guides link there instead of repeating moving counts. [Current README images](../images/current/README.md) document appearance and provenance, independently of interaction testing.

[Acceptance status](../reference/ui/acceptance-status.md) records the completed browser/PDF checks and the 9 October decision to skip remaining alternative-print, Firefox/additional-report, spoken-reader and native-mobile checks for this remediation. A skipped check is not a pass. Other deferred items in [OPEN](../OPEN.md), including real-farm and live executor acceptance, are unchanged.
