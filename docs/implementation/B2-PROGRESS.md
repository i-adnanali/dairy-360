# Dairy 360 — Batch B2

**B2 implemented and verified; stopped for review before B3.** Baseline: B1 commit `9227928`. Completed 2026-09-23. This report accompanies the B2 implementation commit. Existing untracked `docs/reviews/` artifacts are preserved. No applicable AGENTS.md was found; implementation follows specification v1.1 and the latest revalidation.

## Completed

| Finding | B2 outcome |
|---|---|
| F01 | Every rendered writer participates in shared draft checks: animal/calving/event/correction, Milking/Dispatch/Payroll, people/engagement/payment/closing, buyers/rates/payments, Feed and Health. Route, reused date/session/period, in-place replacement and session changes check before mutation. Raw incomplete entries remain in memory; reverting becomes pristine; local pagination is excluded. Stale responses cannot replace a newer context. |
| F05 | PrecisionDate initializes only on reset generation, verifies exact day/month/year/estimated round-trip, clears hidden time, and blocks incompatible/incomplete values. Health historical trios and precision-capable crop dates use it. Exact purchase/expense/planned/business dates keep their existing schema. |
| F06 | Feed and Health saved records open in view; correction is explicit. Historical metadata is separate from proposed provenance. Unchanged/reverted corrections cannot save. Original revision, latest record and local draft stay separate; loading latest requires explicit discard. |
| F15 | Shared request snapshots freeze endpoint/body/key across unknown outcomes, suppress duplicates and lock editing until retry resolves. Refusals retain inputs and original prose. Shared confirmation identifies destructive targets and preserves history/reason semantics. Editor/error/return focus and busy states are wired. |

All write calls now use the shared request snapshot path, including Health attachment and vaccination-round writes. Failed upload selection remains in memory for retry; successfully stored attachments are explicitly described as needing the record save to link them. A started Payroll day or Health round row cannot silently disappear from a submitted batch. Health visit purpose and correction reason use distinct form names.

## Verification

- **414 frontend tests in 40 files pass**, including the 13-writer route matrix, raw/revert/discard behavior, exact retry body/key and duplicate suppression, precision initialization/reset/time rules, Feed/Health provenance/conflicts/no-op corrections, attachment retry and partial-row guards. Existing B1 navigation, stale-read, session and pagination regressions pass.
- **778 server tests pass**, no skips. Server/shared typecheck and Angular production build pass. Template/host checks and `git diff --check` pass.
- Contrast gate: **6 exact held resting-border failures; 0 unexpected failures**. No token values changed.
- Protected source comparison: animal/calving field/control invocation count, order and attributes are identical to B1. Their adjacent date treatment and invocation defaults remain identical. Styles, write-log component and Life report are byte-identical to B1, preserving border values, write-log prominence and print/export handling.
- Browser checks cover Feed saved/edit/review and cancelled navigation; crop month save/reopen and mobile light/dark; Health saved/correct/void cancellation and focus return; Dispatch date/session guards; Payroll period, Back and recorder-change guards. Final built assets were reloaded and saved Health history checked without a recording session.

[Evidence and browser details](b2-evidence/README.md), [protected comparison](b2-evidence/protected-constraints.txt), and [final source fingerprints](b2-evidence/SOURCE_SHA256.txt). Verification used Node 22.22.3 and an isolated in-memory backend on 6460/UI on 6462. No real farm records were changed.

## Remaining acceptance and scope decisions

- B3–B5 layouts, mobile cards, report/Check adapters and assistant redesign have not started. F07/F08/F09/F10/F11/F12/F13/F14/F16 later-batch work remains as specified; B1's clipping repair is retained.
- Operator trial, native screen-reader and real-phone keyboard/zoom acceptance remain release checks. Automated/browser evidence does not claim full accessibility conformance. Actual print/PDF output and live assistant/tool behavior remain unverified; their implementation was not changed.
- Native unload warnings remain browser-dependent; drafts and unresolved request snapshots are memory-only. A forced reload/crash is not recoverable draft persistence.
- Health rounds are atomic in the existing server transaction. A refused row retains the whole draft; there are no partial committed rows to retry selectively. B2 preserves that domain contract rather than inventing partial-success behavior.
- Health/Feed comparison disclosures retain full structured saved details. Broader human-readable domain presentation remains later-batch work.
- Existing warnings remain: initial bundle budget, shared-package CommonJS and unused Payroll SummaryBar import; jsdom canvas capability warning. Build/server fixtures required reviewed sandbox escalation; no approval rejection occurred.

## Changed files

Application changes are confined to routes, shared write/draft/date helpers and their writer consumers/tests. Exact source list:

- `web-angular/src/app/app.routes.ts`
- `web-angular/src/app/registry/animal-detail.ts`
- `web-angular/src/app/registry/animal-form.ts`
- `web-angular/src/app/registry/calving-form.ts`
- `web-angular/src/app/registry/correction-form.ts`
- `web-angular/src/app/registry/destination-detail.ts`
- `web-angular/src/app/registry/destinations-list.ts`
- `web-angular/src/app/registry/dispatch-sheet.ts`
- `web-angular/src/app/registry/draft-registry.ts`
- `web-angular/src/app/registry/event-form.ts`
- `web-angular/src/app/registry/feed-daily.ts`
- `web-angular/src/app/registry/feed-editor.ts`
- `web-angular/src/app/registry/feed-page.ts`
- `web-angular/src/app/registry/feed.spec.ts`
- `web-angular/src/app/registry/form-state.ts`
- `web-angular/src/app/registry/health-page.ts`
- `web-angular/src/app/registry/health.spec.ts`
- `web-angular/src/app/registry/milking-roster.ts`
- `web-angular/src/app/registry/payroll-run.ts`
- `web-angular/src/app/registry/payroll.spec.ts`
- `web-angular/src/app/registry/people-list.ts`
- `web-angular/src/app/registry/person-detail.ts`
- `web-angular/src/app/registry/precision-date.spec.ts`
- `web-angular/src/app/registry/precision-date.ts`
- `web-angular/src/app/registry/write-lock.ts`
- `web-angular/src/app/registry/write-safety.spec.ts`
- `web-angular/src/app/registry/writer-draft.ts`
- `web-angular/src/app/registry/writer-matrix.spec.ts`
- `docs/UI_SYSTEM.md`
- `docs/implementation/B2-PROGRESS.md` and `docs/implementation/b2-evidence/*`
