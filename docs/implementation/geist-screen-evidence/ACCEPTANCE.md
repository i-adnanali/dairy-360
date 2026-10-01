# Screen-specific implementation evidence — 1 October 2026

Starting commit: `a70aa1e`. Changes remain uncommitted. The untracked `docs/reviews/` audit tree was preserved. [Source hashes](SOURCE_SHA256.txt) and [built asset hashes](BUILD_SHA256.txt) identify the final implementation. The [recommendation ledger](../GEIST-IMPLEMENTATION.md) separates source completion from acceptance.

## Automated validation

| Check | Result | Evidence |
|---|---|---|
| Frontend | 458 tests / 44 files passed (starting baseline 454) | [Log](frontend-tests.txt) |
| Server/domain | 779 passed, 0 failed or skipped; no server/shared source changed | [Log](server-tests.txt) |
| Production build | Passed; existing 500 kB initial-bundle warning and shared CommonJS warning remain | [Log](build.txt) |
| Typecheck | Passed | [Log](typecheck.txt) |
| Templates | 89 files; 29 non-routed block hosts, 22 routed hosts | [Log](templates.txt) |
| Contrast | 122 graded checks; 0 held and 0 unexpected failures | [Log](contrast.txt) |
| Whitespace | `git diff --check` passed | Final working tree |

Node 22.22.3 was used. One test run encountered Vitest environment-teardown failures in two suites; the isolated rerun and subsequent final run passed all 458 tests. Unit-test canvas warnings reflect jsdom's missing canvas implementation; browser chart/data checks are separate. Contrast is a token/consumer gate, not certification of every rendered pixel or blend.

New or strengthened tests cover precision-aware acquired birth summaries and correction comparisons, Health explanation retention, analytics URL/selected-option synchronization, Today order/payment wording, unknown-route recovery, and outcome-specific assistant fallback copy. Existing suites retain the write-lock, draft, revision, retry, calculation and domain contracts. No backend model, API, money calculation, date parser, recipient snapshot or historical-rate implementation was changed.

## Browser execution

[Matrix](browser-matrix.json): 144 unique captured states, with sibling JSON snapshots/geometry and PNG viewport images. No captured document exceeded its viewport width. This is representative changed-workflow execution, not all 25 routes reaccepted in every state. Screenshots preserve scroll/focus position; JSON contains the rendered document. Editable mobile text controls measured 16px and at least 44px high in the captured workflows; native checkbox glyphs are smaller and are not text-input measurements.

The production app on 6512 used the seeded memory-only registry on 6510. Recorder: `synthetic-audit`. A deliberately long synthetic person was created after a duplicate-identifier refusal; disposable milking corrections were saved in memory. Assistant transport on 6516 used the isolated [B5 fixture](../b5-evidence/assistant-fixture.mjs) on 6490, with no database, model, upstream or live executor. No real farm data was used.

Each four-way family below has `-1440-light`, `-1440-dark`, `-390-light`, `-390-dark` siblings. Links select one JSON; matching PNGs are available beside them.

| Changed workflow | Actual browser evidence |
|---|---|
| People task actions, immutable-ID help, balance-first table | [Final four-way](final-people-390-dark.json); [duplicate refusal, associated error and focus at 320px](people-refusal-320-dark.json); [long-name recovery/save](people-long-save-320-dark.json). Add person keyboard activation focused its identifier. |
| Person payment before history and signed adjustment | [Four-way](person-payment-390-light.json); adjustment draft and [safe-focus navigation dialog](person-draft-dialog-390-dark.json), Keep/Discard exercised. |
| Feed overview and disclosures | [Four-way](feed-overview-390-light.json); keyboard opening of [supply disclosure](feed-supply-disclosure-390-dark.json). |
| Crops list/filter/lifecycle and focused entry | [List four-way](crop-list-390-light.json); [no-match reset](crop-empty-filter.json), [archived filter](crop-archived-filter.json); [saved lifecycle four-way](crop-detail-390-light.json); [new entry four-way](final-crop-new-390-light.json). |
| Purchase groups and pricing modes | [Focused new entry four-way](final-purchase-new-390-light.json); [agreed rate](purchase-rate-fields.json) and [known total](purchase-total-fields.json) controls exercised; cancelled without saving. |
| Feeding history navigation/status | [Four-way](feeding-history-390-light.json). Saved-recipient/nested-purchase semantics were retained in source and existing tests; not newly fault-injected here. |
| Herd identity and animal history/correction | [Final Herd four-way](final-herd-390-light.json); [precision-aware history four-way](final-animal-history-390-light.json); [correction before/after four-way](animal-correction-390-light.json). Keep editing retained exact raw `May 2023`; then explicitly discarded. |
| Today task order and wages/payment distinction | [Four-way](today-390-light.json). Fixture had recorded milk sessions; outstanding-first ordering also has a source regression test. |
| Milking receipt and Dispatch continuation | [Four-way](milking-390-light.json); [successful memory-save receipt](milking-save-receipt.json). Final-bundle continuation reached `/milk/dispatch?on=2026-10-01&session=morning`. [900×600 keyboard focus](milking-desktop-focus.json) remained visible after inner scrolling. |
| Dispatch buyer maintenance and draft guard | [Four-way](dispatch-390-light.json); maintenance opened a new buyer tab and retained exact raw `2.` in the original sheet ([capture](dispatch-maintenance-draft-retained.json)); [leaving guard](dispatch-draft-guard.json) focused Keep editing. Disposable draft then discarded. |
| Payroll entry-table pattern | [Four-way](payroll-390-light.json). Desktop header computes sticky; two-row fixture did not require vertical overflow. |
| Health grouping, exceptions and draft wording | [Final aligned four-way](final-health-aligned-390-light.json); [exception values retained after toggling](health-exceptions-retained.json), [320px](health-exceptions-320.json); [human draft description](final-health-draft-copy.json). Keep editing retained `Synthetic unsaved dose`; then discarded. |
| Analytics inspector, table and filter recovery | [Final selected inspector four-way](final-analytics-inspector-390-light.json); [equivalent table](analytics-inspector-data.json); [committed no-match filter](analytics-empty-filter-committed.json) and reset. Previous/Next preserved month/date scope. Final DOM selected value was `2026-09-01|all`, matching URL/detail. |
| Assistant presentation | [Empty four-way](assistant-empty-390-light.json), [pending four-way](assistant-pending-390-light.json), [chart data/explicit zero](assistant-chart-data.json), [rejection](assistant-rejected.json), [simulated successful result](assistant-simulated-recorded.json), [long-response four-way](assistant-long-390-light.json) and [320px](assistant-long-320.json), [connection error](assistant-connection-error.json), [new-read recovery](assistant-recovered.json). |
| Navigation and unknown-route recovery | [Complete menu at 320px](navigation-menu-320.json); Escape from Payroll link returned focus to Menu · Today. [Final recovery four-way](final-not-found-390-light.json); Go to Today activated with Enter and reached `/`. |
| Current type/state specimen | [Standalone specimen](ui-specimen.html), [desktop](specimen-1440-light.json), [390px](specimen-390-dark.json), [320px](specimen-320-dark.json), both themes. Presentation only; no Angular state-machine acceptance implied. Regenerate after a production build with `python3 docs/implementation/geist-screen-evidence/generate-specimen.py`. |

Visual inspection found and corrected: stretched Health grid controls, a split Herd serial, excess review content on new Feed forms, missing recovery-action spacing, specimen root overflow, and the analytics selector failing to reflect its URL. Earlier captures remain to document the progression. Prefer `final-health-aligned` over `health-dose`/`final-health-dose`, `final-herd` over `herd`, `final-people` over `people`, `final-purchase-new` over `purchase-new`, and `final-not-found` over `not-found`. `analytics-empty-filter` contains uncommitted input; only `analytics-empty-filter-committed` proves filtering. The final global field alignment was verified in Health and the specimen; earlier captures of other consumers predate that alignment-only fix.

Some navigation attempts during rebuild used removed lazy chunks; reloading the completed bundle resolved them. The final continuation was executed successfully after that reload. These development-server transitions are not claimed as application recovery tests. Desktop entry headers are sticky within their local scroll regions, not globally pinned below the application shell; the tested focused row remained clear. No pinned identity column was introduced: the tested entry sheets fit horizontally at desktop and use the existing single-control-tree cards on mobile.

## Remaining acceptance — explicitly open

- **Exhaustive fault injection:** every writer × refused/invalid/409 revision conflict/pending/lost response/unknown outcome × route, query, tab, session, Back/Forward and nested navigation. Representative checks and automated tests do not close this matrix. Exact-request retry, pending locks, preserved raw drafts and successful-execution receipts need separate browser assertions in each case.
- **Accessibility/device:** full keyboard-only completion of every workflow, screen-reader announcements, native phone keyboard/safe areas/orientation, native 200% zoom and text-spacing overrides were not performed. Viewport resizing and DOM association checks are narrower evidence.
- **Outputs:** native print/PDF and downloaded JSON artifact comparison, including long paginated reports, were not performed.
- **Assistant:** live integrated executor, approved-awaiting-result timing, unknown write and exact live retry were not browser-tested here. Synthetic immediate success is not proof of execution. Awaiting/unknown distinctions have source/test coverage only in this pass.
- **Operator/scale:** representative operator walkthroughs, task timing/error/uncertainty interpretation, empty registry, large datasets, permissions and all sticky-header/long-row permutations remain open.

Screen presentation implementation is complete for the reconciled recommendations; comprehensive release acceptance remains partial. Nothing was deployed, published, merged, committed or pushed.
