> Historical foundation evidence. For the remaining screen-specific work after `a70aa1e`, use the [1 October acceptance ledger](../geist-screen-evidence/ACCEPTANCE.md) and [reconciled checklist](../GEIST-IMPLEMENTATION.md). The earlier route matrix does not establish full screen completion.

# Audit implementation acceptance — 30 September 2026

Implementation source began at `a1dd2a7` with no tracked changes. The pre-existing untracked `docs/reviews/` tree was preserved. Final uncommitted source is identified by [SOURCE_SHA256.txt](SOURCE_SHA256.txt). See the [implementation checklist](../GEIST-IMPLEMENTATION.md) for every route and finding, and [UI_SYSTEM §26](../../UI_SYSTEM.md#26-audit-implementation--30-september-2026) for the revised contract.

This is implementation verification, not a claim of complete native accessibility or release acceptance. PASS below applies only at the stated evidence level. No deployment, publishing, merge or real farm write was performed.

## Automated validation

| Check | Result | Evidence |
|---|---|---|
| Starting frontend baseline | PASS: 450 tests / 42 files | [baseline log](baseline-tests.txt) |
| Final frontend | PASS: 454 tests / 44 files | [test log](frontend-tests.txt) |
| Server/domain regression | PASS: 779 tests, 0 failed/skipped | [server log](server-tests.txt) |
| Production build | PASS; 673.31 kB initial bundle exceeds existing 500 kB warning budget; shared CommonJS warning remains | [build log](build.txt) |
| Typecheck | PASS | [typecheck log](typecheck.txt) |
| Contrast | PASS: 122 graded checks, 0 failures, 0 held exceptions; 102 decorative INFO rows | [contrast log](contrast.txt) |
| Templates and component hosts | PASS: 87 non-test files, 29 non-routed hosts block-level, 21 routed hosts | [template log](templates.txt) |
| Whitespace/errors | `git diff --check` passed | Run against final working tree |

Node 22.22.3 was used because the shell default 22.3.0 does not meet Angular's requirement. Build and local harness execution required sandbox approval. A temporary approval-service usage-limit failure blocked the assistant preview server; the same approved operation succeeded on resume. No bypass was used. Canvas warnings in the unit environment are not a browser chart failure; actual browser chart/data rendering was exercised separately.

Control-boundary ratios against page/raised/sunken are 3.97/4.26/3.67 in light and 5.03/4.69/4.34 in dark. Decorative borders are not graded as necessary control boundaries. The token gate does not certify every pixel, alpha blend or chart annotation.

## Actual browser execution

The [browser matrix](browser-matrix.json) contains 176 unique captures, each with a sibling PNG and JSON snapshot/geometry file. All 25 route definitions were opened at 1440×1000 and 390×844 in light/dark themes. Representative parameterized records were used; crop and purchase `new` states were additional captures. Route mapping and links are in the [checklist](../GEIST-IMPLEMENTATION.md#route-mapping). No captured document exceeded viewport width. Wide tables retain named local scroll regions; a 320px long-name People table intentionally scrolls locally.

Browser execution used the seeded memory-only registry on port 6500 through production static server 6502. The fixed backend clock was 17 September; browser dates were 29–30 September. One explicitly synthetic person was saved in disposable memory to exercise refusal/recovery/success. Assistant responses came from the isolated B5 synthetic service on 6490 through 6506: no database, model, upstream or real write executor.

Capture chronology matters: the full route sets precede the final shared-shell utility-row/Escape refinements. [Final shell](final-shell-390-light.json) has supplementary captures at 320/390/1440 in both themes; [final menu](final-navigation-menu-320.json) and [Escape result](final-navigation-escape-320.json) verify the final shared behavior. The purchase filter recovery was added after its route matrix and separately verified below. Earlier route captures continue to describe unchanged content but are not represented as final header screenshots. Some screenshots retain scroll/focus position rather than showing the page top; JSON covers the rendered document. Contact sheets `visual-sheet-1` through `visual-sheet-9` were inspected for mobile layout, together with full-size representative screenshots. They precede the final header refinement.

Theme changes were followed by rendered-style settling for matrix captures; final shell captures were taken in separate calls after transitions. Earlier hover/transition appearance in individual menu buttons is not claimed as a resting-state contrast measurement. Native theme/control behavior was preserved.

| Interaction family | Actual execution and outcome | Evidence examples | Limits |
|---|---|---|---|
| Navigation/session | Complete mobile hierarchy, source/recorder setup, route changes, Escape from Menu returns focus and closes it | `session-setup-*`, `final-navigation-*` | Not every navigation mechanism crossed with every writer |
| Field refusal/recovery/save | Duplicate `imran` refused; identifier focused with help/error IDs and `aria-invalid`; raw input retained; corrected synthetic person saved; persistent announcement observed | [refusal](people-duplicate-refusal.json), [success](people-save-success.json), [long name](people-long-name-320.json) | Only disposable memory record, not operator acceptance |
| Filter recovery | Purchase Khall filter produced no matches; Clear filters restored purchases | [empty](purchase-filter-empty.json), [reset](purchase-filter-reset.json) | Other filter permutations covered by source/tests and route renders |
| Draft dialogs | Milking raw `12.` retained after Keep/Escape; Tab reached Discard; explicit Discard navigated. Calving ambiguous date retained on Keep, Discard navigated. Feeding note retained exactly, then Discard reached Today | `milking-dirty-dialog`, `calving-dirty-dialog-320`, `feeding-dirty-dialog` | Native unload/crash recovery unverified; drafts remain memory-only |
| Precision/entity selection | Dam search Noori retained native selection; year feedback and ambiguous `06/07/2023` refusal; associated errors | `calving-year-search-320`, `calving-invalid-date-320` | Screen-reader speech not performed |
| People/Feed/Milk/payroll | New/edit/saved layouts, persistent labels, units, disabled/pristine saves; close-stint and buyer-rate consequence context opened/cancelled | Four-way route sets, `person-close-stint`, `buyer-rate-editor`, `feeding-editor-*` | Full per-writer successful/failed save matrix remains test evidence |
| Health | Board, grouped dose and round four-way matrix; all nine editor families opened at 320px; dose reference search; selected Noori stays visible while searching Sohni; round draft discard guard | `health-*`, `health-round-selected-search`, `health-round-dirty-dialog` | Not every create/correct/void/attachment failure executed in browser |
| Analytics/reports/checks | Daily empty/populated and monthly analytics; data table expansion, date/session inspector; populated lifetime report and invariant/advisory check views | `analytics-*`, [data inspector](analytics-data-inspector.json), `life-report-*`, `check-*` | Native print/PDF/download artifacts not inspected |
| Assistant presentation | Desktop Expand/Compact retained composer draft; mobile modal; long unbroken text, wide table, chart/data; read success/refusal; pending approval, rejection and settled synthetic success; connection failure | `assistant-expanded`, `assistant-mobile`, `assistant-rich-pending-*`, `assistant-chart-data`, `assistant-rejected`, `assistant-recorded`, `assistant-connection-error` | Successful fixture result is not real execution; unknown execution state covered by tests |

The final mobile header is 163.5px in the measured active-session 390px People fixture, with all four utilities sharing a row. Its section bar remains a separate surface. This does not assert that total chrome is shorter than the audit's differently composed 218px fixture. The concrete navigation improvement is the complete accessible hierarchy and reliable one-row utility layout.

## Source and test coverage, separately

New Field tests verify native association, unique IDs, verbatim error updates and retained raw input through recovery. WriteLock tests verify refusal focus and restoration of existing help/invalid attributes. Confirmation-card tests distinguish approval from execution outcome. The shell regression test covers Escape from the trigger and a navigation link.

Existing `writer-matrix.spec.ts` exercises 13 writer families with Keep, revert and Discard. `draft-registry.spec.ts` covers raw inputs, pending-save navigation, recorder/source guards, stale responses and Health cancellation. `write-safety.spec.ts` verifies frozen endpoint/body/idempotency key after a lost response, concurrent-submit suppression and editable recovery after a definite refusal. Feed/Health/Milk/sales/payroll suites retain revision, recipient-snapshot, money and domain contracts. `chat-store.spec.ts` verifies failed approval retains an unknown outcome without replay. These passing tests are not browser fault injection.

No backend data models, calculations, APIs or parser/idempotency contracts were modified. Missing, unknown, unmeasured, not performed and zero remain distinct. Date precision/provenance, historical billing rates, saved recipient snapshots, revision handling, write locks and exact-request retries remain intact.

## Remaining acceptance gaps

- Exhaustive browser navigation and injected refusal/conflict/unknown-outcome permutations for every writer, including Health attachment/correction/void flows. Representative browser checks and deterministic tests above do not close this exhaustive matrix.
- Real-phone keyboard/orientation/safe area, screen-reader announcements, native 200% zoom and user text-spacing overrides.
- Actual native print/PDF and downloaded JSON artifact comparison for the lifetime report.
- Live integrated assistant execution and ambiguous write recovery; the fixture proves presentation only.
- Representative operator walkthroughs, large-data/performance and permissions variants. No usability or accessibility certification is claimed.

These are explicit open acceptance items, not hidden passes or deployment authorization. The application still has no crash recovery for in-memory drafts. The bundle-budget warning remains technical debt.
