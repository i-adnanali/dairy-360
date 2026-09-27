# Dairy 360 — Batch B5

**B5 implemented and verified with synthetic assistant traffic; stopped before B6. Commit and push authorized by the user after review.** Baseline: `a7a4589f3905e1f4b850cd1a6a398871aa465ef6`. Work/evidence: 2026-09-26–27. No applicable AGENTS.md found. Existing untracked `docs/reviews/` was preserved.

## Changes

- Dairy 360 assistant naming is consistent across the trigger, panel, standalone chat and empty state. The trigger controls a stable panel ID and reflects expanded state.
- At ≥1280px the shell reserves a 360px nonmodal grid column, with no dim/backdrop and usable main content. Below 1280px the same panel becomes a full-viewport modal with a visible title/Close, inert background and focus trap. Opening focuses the composer, closing restores the trigger, and higher modal layers own Escape/Tab. A palette already open during resize retains focus; Search cannot open underneath the narrow modal.
- One shared memory draft and conversation survive close/reopen, route/dock handoff and breakpoint changes. `/chat` retains shell/session controls and yields its chat view while the dock is active. No duplicate composer is mounted. Busy composers stay focusable/read-only with a visible reason; sending remains guarded. Textarea height follows its content up to a local scroll limit.
- Shared Input/Button/Card/Cell/Badge/ErrorPanel/ScrollRegion primitives cover assistant controls and states. Markdown remains sanitized, long text/arguments wrap, and oversized tables scroll locally. Shared ScrollRegion now remeasures streamed child replacement and disconnects obsolete size observations. Readers away from the conversation tail are not force-scrolled by streaming. Charts expose exact semantic data tables and explicit no-data text; dates remain unbroken.
- Tools say Running, Awaiting approval, Success or Error and retain failure/denial reasons. Confirmations show the server's original operation/target/details/rows. Approve/Reject resolve once; multi-card decisions are collected before a single complete resume. Resolved cards and unknown execution outcomes stay visible, and focus lands on the card just resolved. No retry automatically replays approval or writes. Server authorization/execution code is unchanged.
- A standalone database-free AG-UI fixture exercises empty, long/streaming, error, tool running/success/failure, chart/no-data and pending/approved/rejected states through the actual production components. It refuses registry writes and has no live assistant connection.

## Verification

- **450 frontend tests in 42 files pass; 779 server tests pass, zero server skips.** Production Angular build, server/shared typecheck, template/host checks and `git diff --check` pass using Node 22.22.3 and `NG_BUILD_MAX_WORKERS=2`.
- Contrast gate: **six exact held resting-border failures; zero unexpected failures**. No tokens changed. The obsolete composer disabled-text exemption was removed because its busy read-only text remains readable. Existing bundle-budget, shared CommonJS and jsdom canvas warnings remain.
- A18 browser matrix: standalone and dock, light/dark, **360/390/768/1024/1279/1280/1440px**. Recorded 56 empty/rich-state renders plus 28 pending-state renders, followed by final-build geometry/state checks. Document width stays within viewport, one composer is active, the desktop dock is 360px, and narrow panels fill the viewport. Multiline drafts survive repeated 1279↔1280 crossings.
- Keyboard/browser checks cover initial/return focus, Tab/Shift+Tab wrapping, Escape, palette ownership through resize, a real nested draft confirmation, chart data access, approval/rejection focus, failure reasons and local table overflow. The protected form's synthetic draft survived nested Escape and was then explicitly discarded without saving.
- Baseline comparisons confirm protected animal/calving/date controls, draft/write-safety helpers, write log, operational pages, B4 report pages and server assistant execution are unchanged. Existing regression suites preserve the B1–B4 contracts; this is not a repeat of B6's full manual workflow matrix.

[Reproduction instructions, outputs and captures](b5-evidence/README.md). Evidence is tied to final source fingerprints rather than a new commit. Browser version was not exposed by the available in-app browser API. Only isolated synthetic data was used; no real farm data changed.

## Limits and handoff

- Native print/PDF output remains unverified.
- Actual browser JSON download completion remains unverified; complete Blob serialization was successfully tested in B4.
- Operator walkthrough, native screen-reader, real-phone keyboard, actual browser zoom and live assistant checks remain outstanding. Browser viewport resizing and synthetic streaming do not substitute for those checks.
- Conversation, decisions and draft remain memory-only; forced reload/crash can lose them. An uncertain approved operation is not automatically retried; users must check records before another explicit proposal. B5 does not introduce server-side write idempotency or change the existing approval boundary.
- B6 owns the full release-verification matrix. No release-readiness claim is made. Reviewed sandbox escalation was needed for the production build/local fixture servers/server tests; no automatic approval rejection occurred.
