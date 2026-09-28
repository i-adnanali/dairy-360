# Dairy 360 — Batch B6 release verification

**B6 verification work and in-scope fixes recorded; release acceptance remains incomplete. No commit or push.** Baseline: `26c95c0fdce36c7a71c401ccfb91506785ed3f2b`. Work: 27–28 September 2026. No applicable AGENTS.md was found. The intentionally untracked `docs/reviews/` directory was preserved.

## Changes

- People Identifier now has a concise explicit label, described help/error and invalid state instead of including its long help in its accessible name.
- Person-payment Handed over by no longer has a duplicated outer label or irrelevant purchase-observer help. Inline event observer help also describes its actual context.
- Route focus selects the first main h1/h2, fixing Analytics navigation that focused Measured production instead of Milk analytics.
- Event history keeps raw event/replacement IDs in a native Technical event details disclosure; summaries, historical provenance and superseded badge remain visible.
- Standalone ChatPanel tests explicitly close the dock, fixing six order-dependent assertions caused by persisted assistant posture.
- UI_SYSTEM current-state claims and section numbering were reconciled. Added the explicit A01–A18 matrix, workflow matrix, reproducible fixtures/commands, native-output comparator, human/device walkthrough, evidence and final-source fingerprints.

No financial/clinical calculations, server authorization, draft persistence, idempotency/conflict contracts, protected animal/calving form fields/dates, write-log styling or resting-border values changed.

## Verification

- 450 frontend tests across 42 files pass; 779 server tests pass, zero skips. Production Angular build, typecheck, template checks, contrast gate and diff whitespace checks pass with Node 22.22.3 and NG_BUILD_MAX_WORKERS=2.
- Contrast: exactly six held resting-border failures; zero unexpected failures. Existing bundle/CommonJS/canvas warnings remain.
- Fresh browser geometry: 120 renders across twelve workflow states, both themes and 360/390/768/1024/1440px, no document overflow or horizontally offscreen measured inputs. Assistant adds 14 final standalone combinations and ten open-dock crossings including 1279/1280; one composer and retained multiline draft.
- Browser checks cover Milking raw draft/same-route/palette/Back guards; Payroll recorder change; Feed saved/edit/review/provenance; protected forms; Health tasks/withdrawals and visit/round cancellation; inline event replacement; People/payment and buyer payment retention; independent 101/26 statement collections; Analytics/Check and Life contents focus.
- Fresh deterministic suites cover duplicate suppression, exact frozen retries after unknown outcomes, conflicts/refusals, stale responses, raw/incomplete data, local pagination, provenance, atomic batch contracts, attachment retry, assistant decisions and no silent replay. These are component/server evidence, not browser fault injection.
- All data is isolated synthetic/in-memory. Native print and JSON download were actually attempted but returned no inspectable artifacts. Zoom shortcut caused no observable native zoom; viewport resizing is not reported as zoom.

[Full acceptance and workflow matrix](b6-evidence/ACCEPTANCE.md), [evidence/reproduction](b6-evidence/README.md), [human/native acceptance steps](b6-evidence/HUMAN-ACCEPTANCE.md), [source fingerprints](b6-evidence/SOURCE_SHA256.txt).

## Unresolved release gates

Native PDF/page-break/identifier inspection and comparison of an actual completed JSON download remain OPEN. Operator walkthrough, native screen-reader, real-phone software keyboard and actual 200% zoom/reflow remain OPEN. Live assistant service integration is not verified by synthetic AG-UI traffic. Exhaustive browser state/navigation/error permutations not exercised are listed explicitly in the matrix, including dirty browser Forward permutations and per-writer fault injection.

**Not release-ready under the specification's all-consumer acceptance rule.** Passing implementation tests and the completed B6 checks do not close the above gates. No operator waiver or other ship decision was made. The six held border exceptions and memory-only crash-loss limitation remain unchanged. B6 is the final numbered batch; remaining work is acceptance follow-up against this matrix, not a newly invented batch.

Automatic browser approval review temporarily rejected an action because its reviewer hit a usage limit; it did not determine the action unsafe. Work resumed through the supported browser after the user's resume. Sandbox build/test IPC restrictions were resolved by reviewed escalation. No bypass was used.
