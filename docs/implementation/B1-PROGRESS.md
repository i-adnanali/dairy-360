# Dairy 360 — Batch B1

**B1 implemented; stopped for review. B2 has not started.** Implementation baseline: `f3c237361644e40622733efda8a42f50ed512092`. This report accompanies the B1 implementation commit. Existing untracked `docs/reviews/` artifacts were preserved. No applicable AGENTS.md was found.

## Completed

| Finding | B1 outcome | Later work |
|---|---|---|
| F01 | Shared DraftRegistry, accessible discard dialog, deduplicated route/query guards; Milking and Health pilots; guarded session application/explicit clearing; dirty-only unload warning; stale reads ignored | Every remaining writer and full correction/outcome handling: B2 |
| F02 | Dam associated with select; Milking/Dispatch quantities and choices name subjects; Payroll amounts name person/role; required ChipGroup labels; help separated from names with unique IDs; Milking validation error association | Continue accessibility acceptance for later redesigned workflows |
| F03 | Health select/textarea appInput frames; valid Health/LifeReport border tokens; valid Pagination surface | No remaining undefined styles in these consumers |
| F04 | Meaningful subtle/absent/no-record text and certainty rule contrast repaired; disabled text consumers explicitly audited | Exactly six held resting-border pairs remain |
| F07 | Collection-labelled sparse pagination, native disabled styling and disabled selector, clamping; size choice retained for totals over 25 | Buyer statement collections split: B4 |
| F08 | Local horizontal scrolling, overflow-only keyboard stop, visible cue; quantity column reachable at narrow widths | Mobile cards and full mobile workflow acceptance: B3 |
| F10 | Contextual identifier guidance; no duplicated Payroll label; concise session recorder name | Domain prose and structured Check data: B4 |
| F15 | Shared busy/danger/disabled actions, activation suppression, shared draft modal, Health initial/return focus, pending transition block | Full writer view/edit/review/conflict/void state rollout: B2 |

Milking compares raw row entries and observer to its baseline, including partial input. Pagination preserves the whole draft. Reverting becomes pristine. Health covers editor, vaccination round and task-action drafts; local read-only filtering does not replace them. While a save is pending, Milking entry/observer controls and Health editor/round/action fields are locked so late edits cannot be erased by the successful reload. Existing save guards, revision fields, idempotency keys, write log and server refusals remain. No new dependency or UI library was installed; the dialog uses the already-installed Angular CDK.

## Verification

- Frontend: **386 tests passed across 38 files**, including new draft-pilot navigation/context/cancellation/discard, pending duplicate submit, observer/no-reload, stale responses, session attribution, unload, pagination boundaries and shared action tests.
- Server: **778 tests passed**. Typecheck, Angular production build, template/host checks and `git diff --check` passed.
- Contrast: **122 graded checks; 6 held border failures; 0 unexpected failures**. The command now gates unexpected failures and unreviewed disabled-text consumers. The disabled-control exemption is not applied to missing information.
- Protected constraints: source comparison confirms animal/calving/precision-date field count, order, roles, labels and placeholders unchanged; both border-default values and all six write-log values unchanged. Dam association changes only label linkage. Life-report printing pagination bypass, disclosure expansion and full JSON export code remain unchanged.
- Browser: isolated fresh backend **6450**, UI **6452**; storage and seed both confirmed `:memory:`. Only synthetic fixture data was used. UI drafts were typed and discarded, not saved into farm records.
- Milking: route cancellation, Escape, Morning/Evening cancellation, date cancellation with restored native date control/URL, session attribution Keep/Discard, final discard navigation; 360/390/768/1024/1440px geometry. Document width equals viewport throughout; quantity fields can be scrolled/focused into view at 390px. Region is tabbable only at overflowing widths.
- Health: create focus, Close/Keep, route/Escape, browser Back/Keep, discard and focus return; Tab/Shift+Tab modal trap. Select/textarea frames measure 1px in light/dark, with held resting colours `rgb(203,201,195)` / `rgb(58,57,52)`. At 390px the document does not overflow.
- Shared controls: accessible snapshots confirm Dam, Payroll, Dispatch and recorder names; native pager disabled appearance checked in both themes; 31 records at size 50 keep the size selector and hide page buttons. Final dialog reports `aria-modal=true`.

Final field-lock changes were verified again on 2026-09-22: all 386 frontend tests, production build, template and contrast checks pass; the rebuilt browser fixture loads successfully.

Evidence: [screenshots and measurements](b1-evidence), [source fingerprints](b1-evidence/SOURCE_SHA256.txt), and command outputs in that directory. Captures use the Codex in-app browser; its underlying browser version was not exposed by the supported read-only browser API. One stale lazy-chunk error occurred when an older open tab crossed a production rebuild; reloading the final assets cleared that verification interruption. It was not a farm/API failure.

## Limits and justified scope decisions

- Browser fixtures use **2026-09-21**, matching the supplied latest revalidation and the date-relative harness. Unit regression fixtures explicitly use 2026-09-17/18/19. The application clock and seed semantics were not changed just for captures.
- No operator trial, native screen-reader assessment, real-phone software keyboard or actual 200% browser-zoom acceptance is claimed. Automated certainty tests retain all ten non-colour distinctions; physical/assistive acceptance remains release verification.
- Full conflict/indeterminate-write outcome UX and all non-pilot writers remain B2. Native Health **void** confirmation is preserved; the new dialog covers draft loss. No assertion is made that an uncertain operation can safely be edited into a new operation.
- Actual print/PDF output and live assistant streaming/tool behavior remain unverified and outside B1. Their code paths were not redesigned.
- Build warnings remain: initial bundle over the existing 500kB budget, existing CommonJS shared-package warning and unused Payroll SummaryBar import. jsdom emits its existing canvas warning. Sandbox restrictions required the build/server test runner and local fixture servers to run with reviewed escalation; no approval rejection occurred.

## Changed files

See the exact list below. Most review-page edits only supply the required collection label; they do not implement B3/B4 layouts.
- `docs/UI_SYSTEM.md`
- `package.json`
- `scripts/check-contrast.mjs`
- `web-angular/src/app/app.routes.ts`
- `web-angular/src/app/registry/analytics-page.ts`
- `web-angular/src/app/registry/calving-form.ts`
- `web-angular/src/app/registry/calvings-list.ts`
- `web-angular/src/app/registry/chip-group.spec.ts`
- `web-angular/src/app/registry/chip-group.ts`
- `web-angular/src/app/registry/destination-detail.ts`
- `web-angular/src/app/registry/destinations-list.ts`
- `web-angular/src/app/registry/dispatch-sheet.ts`
- `web-angular/src/app/registry/draft-registry.spec.ts`
- `web-angular/src/app/registry/draft-registry.ts`
- `web-angular/src/app/registry/event-list.ts`
- `web-angular/src/app/registry/feed-page.ts`
- `web-angular/src/app/registry/health-page.ts`
- `web-angular/src/app/registry/herd-list.ts`
- `web-angular/src/app/registry/identifier-input.spec.ts`
- `web-angular/src/app/registry/identifier-input.ts`
- `web-angular/src/app/registry/life-report.ts`
- `web-angular/src/app/registry/milking-roster.ts`
- `web-angular/src/app/registry/payroll-run.ts`
- `web-angular/src/app/registry/people-list.ts`
- `web-angular/src/app/registry/person-detail.ts`
- `web-angular/src/app/registry/session-bar.ts`
- `web-angular/src/app/registry/session-gate.ts`
- `web-angular/src/app/registry/url-state.ts`
- `web-angular/src/app/registry/verification-panel.ts`
- `web-angular/src/app/ui/button.spec.ts`
- `web-angular/src/app/ui/button.ts`
- `web-angular/src/app/ui/certainty.spec.ts`
- `web-angular/src/app/ui/certainty.ts`
- `web-angular/src/app/ui/input.ts`
- `web-angular/src/app/ui/local-pagination.ts`
- `web-angular/src/app/ui/pagination.spec.ts`
- `web-angular/src/app/ui/pagination.ts`
- `web-angular/src/app/ui/scroll-region.ts`
- `web-angular/src/styles.css`
- `web-angular/tailwind.config.js`
- `docs/implementation/B1-PROGRESS.md` and `docs/implementation/b1-evidence/*`
