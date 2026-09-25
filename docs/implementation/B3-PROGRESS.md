# Dairy 360 — Batch B3

**B3 implemented and verified; stopped for review before B4.** Baseline: `450045c13e8bedbcb6f17dea67eb1223116a9007`. Implementation/browser checks: 2026-09-23; handoff finalized 2026-09-25. No applicable AGENTS.md found. Existing `docs/reviews/` artifacts preserved. Commit and push authorized by the user after the B3 review handoff.

## Completed

| Finding | B3 outcome |
|---|---|
| F08 | Milking and Dispatch use one control tree that reflows into cards below 768px. Desktop columns, explicit alternatives, raw drafts, pagination and shortcuts remain. Payroll now has desktop table/mobile cards, named pagination and a first-unanswered action. Full-collection progress/totals stay independent of paging. |
| F09 | Explicit 720px entry, 1400px review and 1100px report measures replace implicit first-child width rules. Inline editors have explicit entry measures. Create actions belong to pages; the shell retains section views, session actions and Recheck, with no empty ready-Analytics band. Route headings receive focus, including asynchronously loaded headings. |
| F11 | Health presents status counts/filters, ordered task cards, completion versus status-change actions, visible withdrawal groups, open cases and record browsing. Server standing remains authoritative; order is standing, due date/time, stable ID. Completed/cancelled tasks expose no completion action. Milk/meat instructions stay separate, unknown ends require clarification, and original source records open in saved view. |

Mobile fields/buttons are at least 44px tall on the changed entry sheets; text fields use 16px text. Save bars show progress and the primary action; totals/blockers/first-unanswered remain above them. Focused input/select/textarea releases sticky positioning so entry stays unobstructed. Browsing-mode save notices remain in normal flow. Numeric entry replaces a selected nonnumeric alternative; toggling the selected alternative clears the answer.

## Verification

- **418 frontend tests in 41 files pass**; **778 server tests pass**, no skips. Production build, server/shared typecheck, template/host checks and `git diff --check` pass.
- Contrast: **6 exact held resting-border failures, 0 unexpected failures**. Existing bundle/CommonJS and jsdom canvas warnings remain; the unused Payroll SummaryBar warning is removed because it is now used.
- Browser: **40 combinations** covering Milking, Dispatch, Payroll and Health at **360/390/768/1024/1440px**, light/dark. No document overflow, offscreen writable fields or duplicate field data-role hooks in these renders. Long names and 101-row entry fixtures included. Representative desktop/mobile screenshots accompany measured geometry.
- Keyboard/drafts: Milking m/row traversal and page-spanning first-unanswered; Payroll first-unanswered reaches row 76/page 4; Dispatch Tab/Shift+Tab; raw incomplete entries/focus survive resizing; Health status-action draft survives Keep editing and discards only when requested. A reduced 390×450 viewport keeps the focused Payroll input visible with no summary overlap.
- Health overdue/due/upcoming/completed/cancelled states, visible unknown/known-end instructions, source saved-view navigation and action guards checked. Unit tests cover identical source/revision deduplication and retention of distinct references/revisions or missing revisions.
- Protected comparison: animal/calving control invocation count/order/attributes and adjacent date treatment unchanged; both forms measure 720px at desktop. Write-log markup/tokens and resting borders unchanged. Shared precision/draft/write-lock/request helpers are byte-identical to B2. Life report print/export handlers unchanged.

[Evidence and fixture details](b3-evidence/README.md), [exact changed files](b3-evidence/CHANGED_FILES.txt), [source fingerprints](b3-evidence/SOURCE_SHA256.txt), [protected checks](b3-evidence/protected-constraints.txt).

## Decisions and remaining acceptance

- Cards reflow the existing semantic table rows instead of mounting a second responsive form. This keeps a single draft/control identity and tab sequence during resizing.
- Sticky positioning is released while a field is focused, prioritizing reachability in a reduced viewport. Native software-keyboard behavior remains an actual-device acceptance check.
- Withdrawal deduplication requires both a source record and revision. The existing API omits revision on some notice payloads; those notices remain distinct rather than being guessed duplicates. Original instructions/source links remain available. No clinical clearance is inferred.
- Operator walkthrough, native screen-reader, real-phone keyboard and actual browser zoom remain unverified. B3 workflow release still requires the representative operator trial or an explicit recorded decision to ship without it. No such decision was made here.
- Actual print/PDF and live assistant behavior remain unverified. Assistant geometry/interaction redesign, report adapters and financial/clinical calculations were not changed; B4/B5 have not started. No persistent drafts or new dependencies were added.
