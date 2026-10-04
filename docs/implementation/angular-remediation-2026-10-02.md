# Angular audit remediation — 2–3 October 2026

Baseline: `d021d81`. Each reported behavior was checked against current source before changes. No finding was dismissed as obsolete. Existing untracked `docs/reviews/` was preserved. All checks used installed dependencies and Node **22.22.3**. No production endpoints, live models, persistent database, dependency upgrades, deployment or push were used.

Work proceeded in separate logical batches: payment/session correctness with focused tests; asynchronous/error/context fixes; mechanical component relocation; bounded health/typing/lifecycle improvements. The component move manifest is in [evidence](angular-remediation-evidence/component-moves.json). No unrelated working-tree changes were discarded.

| Finding | Remediation | Validation |
|---|---|---|
| F01 | Buyer/person statements clear across identity changes; payment eligibility and payload use the loaded statement identity. Read generations guard errors and successes. Engagement closing participates in draft protection and resets with identity. | `payment-identity.spec.ts`: delayed/failed B, obsolete A failure, blocked writes and adjustment submissions; existing writer/draft suites. |
| F02 | A checked reduction sends a positive buyer payment adjustment. The form previews decrease/increase direction; zero and missing notes are refused. Ledger conventions unchanged. | Both signs, zero and note requirements in payment regression tests; sales suite. |
| F03 | Target exposes pending state; setup cannot commit until probing finishes and rechecks eligibility after draft confirmation. A newly reachable target invalidates a session started offline. | Pending real-target probe and offline-to-real regression tests; full target suite. |
| F04 | Dedicated signed parser is used only for wage adjustments. Cash/bank remain unsigned and positive; adjustments require a note and nonzero amount. | Signed decimal/parser tests and actual payment payload assertions; payroll suite. |
| F05 | Affected forms render every refusal in a summary. WriteLock provides a focused, associated fallback for unknown/dynamic fields when no renderer exists, and ignores obsolete queued errors. | Tests cover all reported field names, native association/focus and unknown nested fields; 83 focused tests passed. |
| F06 | Candidate loading/loaded/failed state invalidates old results, exposes retry and gates the picker/save. Dam lookup failures have a separate visible retry. | Deferred failed lookup regression verifies there is no empty-match conclusion; existing calving/picker tests. |
| F07 | Accepted asynchronous feed comparison and error paths explicitly notify zoneless change detection. | Delayed conflict failure is rendered after stabilization without forced detection; feed suite. |
| F08 | Feed entity wire types and an explicit editor normalization function separate missing entity fields from editor defaults. Conflict adoption initializes monetary controls from normalized data. | Separate item/crop/expense/purchase adoption cases prove hidden money stays finite or null; exact-retry tests retained. |
| F09 | Today and animal/detail reads use generations for both outcomes; old errors are cleared. Duplicate lookups invalidate on empty input/cleanup; read generations invalidate on destruction. Health guards obsolete load errors. | Delayed Today failure, duplicate-clear regression, payment read tests and existing async suites. |
| F10 | Life report observes route parameters with owned cleanup; Health observes source query changes and uses its existing draft transition before editing. | Reused A→B report and second Health source-link regression tests. |
| F11 | Table, loading, errors and empty/search state use the same paged result. Buyer full-list request removed. People selector retains its separate collection and error destination. | Populated collection/empty page regression, sales/payroll suites and engagement refusal test. |
| F12 | Independent MilkingSessionCompleteness and DispatchSessionCompleteness contracts replace accidental declaration merging. | Typed representative endpoint fixtures and strict compilation. |
| F13 | All **51 components**, including App and the separated DraftDialog, own TS/HTML/CSS folders using templateUrl/styleUrl. Style-free components have comment-only companions. Existing local CSS and global encapsulation stay unchanged. Imports, lazy routes, dedicated tests, documentation paths and TS/HTML scanners updated. | Full frontend suite, compiler, production bundle, external-companion/host gate, amber/contrast scans and docs checks. |
| F14 | Incremental health refactor: typed board/tasks, revisions, vaccination state, dynamic editor draft and discriminated entity read contracts. Extensible fields use unknown. Vaccination validation/payload rows, attachment reading/limits and revision presentation are extracted into health-workflows. The page remains the single draft/write/retry owner. | Health workflow unit tests and health integration tests, including revisions, drafts, attachments, partial rounds and reused source links; strict compiler. |
| F15 | strictNullChecks and noImplicitAny enabled; strictTemplates explicit. All 19 post<never> calls now name actual response DTOs. Payment requests typed; feed entity and health read/editor contracts strengthened incrementally. | Angular app compilation, test-source TypeScript compilation, root typecheck and production build all pass. |
| F16 | Small validators check consumed dataset, pending-card/detail/row and agent-selection fields. Malformed known events set a visible stream error without replacing previous state; unknown future names remain separately reported. | Malformed null/card/chart/agent fixtures and ChatStore preservation tests; existing chat suite. |
| F17 | Theme and Shortcuts remove their exact browser listener on injector destruction. | Listener removal and post-destruction shortcut tests, plus existing service tests. |
| F18 | “Viewing …” explicitly says location is not sent and asks users to include record identity. Animal IDs come from the matched parameterized route; Health is a location label. Misleading pronoun-resolution comments removed. No server/model expansion. | Assistant label and existing free-text/transport tests; compilation of matched-route context. |

## Final validation

- [Frontend tests](angular-remediation-evidence/frontend-tests.txt): **512 passed, 49 files**. jsdom canvas warnings remain; these do not validate chart pixels.
- [Server tests](angular-remediation-evidence/server-tests.txt): **779 passed, zero skips**. The documented enumerated suite excludes live-model regressions. Its local IPC socket needed sandbox permission; the retry passed.
- [Angular compiler](angular-remediation-evidence/angular-compiler.txt), [test-source TypeScript](angular-remediation-evidence/spec-typecheck.txt), and [root typecheck](angular-remediation-evidence/root-typecheck.txt): passed.
- [Production build](angular-remediation-evidence/production-build.txt): passed with `CI=true NG_BUILD_MAX_WORKERS=1 npm run build:angular`.
- [Template/host gate](angular-remediation-evidence/template-check.txt): passed, including every component's external companions.
- [Contrast gate](angular-remediation-evidence/contrast-check.txt): zero failures in light/dark, including external HTML consumers.
- [Documentation gate](angular-remediation-evidence/docs-check.txt): passed; preserved reviews excluded by the existing checker.
- `git diff --check`: passed.

## Production-build abort investigation

The ordinary cache-enabled build reproduced exit 134 / SIGABRT. The macOS crash report for the child Node process reported `BUG_IN_CLIENT_OF_LIBMALLOC_POINTER_BEING_FREED_WAS_NOT_ALLOCATED`, with native `node.napi.node` frames. The installed matching addon is `@lmdb/lmdb-darwin-arm64/node.napi.node`, used by Angular's persistent compiler cache. There was no Angular source diagnostic in that abort.

Setting `CI=true` bypasses the default local persistent cache; the production build then completes with the same pinned Node and installed dependencies. This isolates the failure to the native/local-cache path; it does not establish the underlying allocator defect or repair the addon. No cache directories or dependencies were deleted or upgraded. Use the recorded cache-bypassed command on this machine until that environment issue is resolved.

Existing warnings remain: initial bundle **674.24 kB** versus the 500 kB warning budget, and `@dairy/shared` CommonJS optimization bailout. Budgets were not weakened.

## Deliberate scope limits

Health refactoring is incremental: the page still orchestrates editing and owns draft/uncertain-write state. The new typed contracts/helpers remove concrete blind spots without a wholesale feature rewrite. Generic extensible feed/health transport methods remain; further endpoint-specific request typing and the broader TypeScript `strict` flag are future increments, not silently enabled with assertions.

No browser/device/screen-reader/print acceptance or live assistant behavior was claimed. Source/template tests preserve existing accessibility and date/provenance semantics, but do not replace those acceptance activities. The native cache abort remains an environment limitation with a verified production-build workaround.

## Second pass — 2026-10-04

Reviewed the remediation again and implemented these remaining correctness gaps:

| Findings | Additional changes | Regression coverage |
|---|---|---|
| F03 | Acknowledgement resets synchronously when storage identity, kind or reachability changes. Setup also refuses a changed provenance selection after awaiting draft confirmation. | Acknowledgement for one database cannot start a session against a newly probed database. |
| F06 | The calving submit handler itself requires a completed candidate lookup; the blocked reason explains pending/failed lookups. Existing uncertain-write retries remain exempt from fresh lookup eligibility. | Direct handler calls during pending/failed lookup do not write. |
| F07–F09 | Feed comparison/history reads clear previous results/errors and reject obsolete responses. Component destruction and route loads invalidate pending reads. Catalogue/suggestion/load failures cannot publish from an obsolete daily context. Conflict adoption rechecks context after the draft prompt. Untouched crop controls retain stored dates and precision before their first emission. | Overlapping editor comparisons, record replacement, stale daily history and adopted month-precision date payload. |
| F10 | Health consumes a source record link only after a successful edit transition. A cancelled transition can be retried; a superseded load cannot open its editor after a delayed draft decision. | Reused route opens successive records and retries a previously cancelled source link. |
| F16 | Dataset intervals require an actual string, preventing an array such as `['day']` from passing through string coercion. | Malformed interval fixture. |

Second-pass validation: **516 frontend tests pass in 49 files**; Angular app compiler, test-source TypeScript, root typecheck, template gate, contrast gate, documentation gate and whitespace check pass. Production build passes again with the documented cache-bypassed command; initial bundle warning is now **674.38 kB**, with the existing CommonJS warning. See [second-pass frontend results](angular-remediation-evidence/second-pass-tests.txt) and [second-pass build](angular-remediation-evidence/second-pass-build.txt). No server code changed in this pass; the prior 779-test server result remains the backend validation evidence.

Remaining work is unchanged: native cache allocator investigation beyond the verified workaround, browser/device/screen-reader/print acceptance, and optional further endpoint-specific typing/health decomposition. These are not claimed complete by the automated checks. No dependency changes, production access, persistent writes, deployment or push occurred.
