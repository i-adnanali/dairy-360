# Angular acceptance continuation — 5–6 October 2026

Acceptance remains partial. This run fixed one confirmed Health upload-status defect and exercised additional browser races, conflict recovery, genuinely empty lists, and actual Safari print export. It does **not** close native-device, spoken screen-reader, or all reused-route/session acceptance gaps.

## Scope and environment

- Baseline: `6e7925d`, following original remediation `0d0cc25` and [previous browser acceptance](../angular-acceptance-2026-10-04/ACCEPTANCE.md).
- Node **22.22.3**, installed dependencies, final production Angular bundle. No dependency updates, commits, pushes, deployment, or publication.
- Fresh documented registry harness started with `--empty` on port 6510; guarded fault proxy on 6511; production static frontend on 6512. Harness and helper verify memory storage. No persistent database or live model API was used.
- Empty-list checks preceded synthetic seeding. IDs were rediscovered from this harness. See [initial empty storage](empty-harness.json), [seed log](seed.txt), and fixture JSON files in this directory. The same ephemeral process spanned the date rollover; most fixtures are dated 5 October, while final browser checks are dated 6 October.
- Browser interactions used the supported in-app browser at 1440×1000. Actual macOS Safari print preview and Save as PDF were operated through Computer Use. Prior restrictions on Codex native UI were respected; this run did not attempt to bypass them.
- Original audit read from `/Users/adnanali/personal/audits/angular-2026-10-02/audit.md`, together with repository development/testing guides and prior remediation evidence.
- Existing untracked `docs/reviews/` files were preserved. [Initial hashes](preserved-reviews.json) and [verification](preservation-check.json) record the comparison.

## Acceptance checklist

| Scenario | Actual result | Evidence / remaining boundary |
| --- | --- | --- |
| Genuinely empty memory lists | **PASS, sampled lists.** Today showed no expected records; People showed “Nobody on file yet”; Buyers showed “No destinations yet”, with empty search. | [Empty Today](empty-today.txt), [People](empty-people.txt), [Buyers](empty-buyers.txt), [screenshot](empty-buyers.png). This is a zero-record database, not a no-match search. Other empty list types were not exhaustively inspected. |
| Buyer identity with overlapping route reads | **PASS, exercised race.** From Ali, command-palette navigation to Bashir started an 18-second delayed GET. Loading cleared the old identity/payment UI. Navigating back to Ali before completion kept Ali after the obsolete response. A synthetic Rs 1 payment targeted Ali. | [Loading](buyer-reuse-loading.txt), [final identity](buyer-reuse-final.txt), [request log](requests.jsonl). Used Angular route navigation through the actual UI; no component state injection. |
| Person identity with out-of-order failure | **PASS, exercised race.** Imran → Abdul started a delayed 503. Navigation back to Imran completed first; the obsolete Abdul error did not replace Imran. A synthetic Rs 1 payment targeted Imran. | [Loading](person-reuse-loading.txt), [final identity](person-reuse-final.txt), [payment result](person-payment-after-race.txt), request log. |
| Feed daily editor overlapping reads | **PASS, exercised delayed-success race.** In the 5 October editor, changing date to 4 October started a delayed read and cleared the editor. Browser Back returned to 5 October before completion. The late 4 October response did not replace the 5 October review. | [Loading](daily-overlap-loading.txt), [final](daily-overlap-final.txt). Obsolete-failure and comparison-context combinations remain covered by automated tests rather than this browser run. |
| Feed item conflict adoption | **PASS.** A concurrent memory write advanced Silage's revision. A stale local save produced a conflict. Compare latest → discard confirmation → adopt restored the newer record, and a subsequent edit saved successfully. | [Concurrent write](concurrent-item.txt), [adopted editor](item-adopted.txt), [save after adoption](item-after-adoption-save.txt). |
| Feed purchase conflict adoption | **PASS.** Same real revision conflict path. Adoption converted `transport_minor: 15000` to Rs 150 in the editor, preserved 400 kg / Rs 2000 per 40 kg, and allowed a subsequent successful save. | [Concurrent write](concurrent-purchase.txt), [adopted editor](purchase-adopted.txt), [save after adoption](purchase-after-adoption-save.txt). |
| Feed expense conflict adoption | **PASS.** Same conflict/confirmation/adoption path. Concurrent `amount_minor: 160000` appeared as Rs 1600, then saved successfully. | [Concurrent write](concurrent-expense.txt), [adopted editor](expense-adopted.txt), [save after adoption](expense-after-adoption-save.txt). Crop adoption was exercised in earlier acceptance, not repeated here. |
| Health attachment type rejection | **PASS.** Unsupported text file received the server's JPEG/PNG/PDF rejection. | [Visible rejection](attachment-unsupported.txt), [synthetic file](unsupported.txt), request log. |
| Health attachment size rejection | **PASS.** A 10 MiB + 1 byte file was rejected by the client; no corresponding upload POST. | [Visible rejection](attachment-oversize.txt), [reproduction size](oversize-fixture.txt). Large disposable payload removed from evidence. |
| Health uncertain attachment response | **DEFECT FIXED.** Proxy forwarded the upload, then dropped its response. Fields locked and exact retry remained available, but the attachment status incorrectly said “Upload failed.” It now says “Upload outcome unknown” and instructs recovery before linking. | [Before](attachment-uncertain.txt), [final-build after](attachment-fixed-uncertain.txt), [screenshot](attachment-fixed-uncertain.png). |
| Health exact upload retry and linkage | **PASS.** Retry sent identical endpoint, body and idempotency key, recovered the stored attachment, then a saved synthetic veterinary visit linked it. Final production replay also recovered successfully. | [Original exact retry](attachment-exact-retry.json), [linked visit](attachment-linked.txt), [final exact retry](attachment-final-exact-retry.json), [final recovered state](attachment-fixed-recovered.txt). Final verification draft was discarded, not saved. |
| Draft dialog and restored focus | **PASS, DOM/AX only.** Closing the recovered unsaved visit opened “Discard unsaved changes?” with Keep editing focused. Discard restored focus to Start vet visit. | [Dialog snapshot](attachment-discard-dialog.txt). Read-only activeElement inspection confirmed the restored button. This is not spoken-output acceptance. |
| Rendered print/export | **PARTIAL; confirmed layout defects remain.** Native Safari print preview and exported PDFs were inspected. All 30 synthetic rows printed, including rows beyond the screen's 25-row page. Navigation was hidden. Identity header repetition and a heading/first-record page break remain defective. | Details below. |
| Session target changes while draft confirmation is pending | **UNTESTED in browser.** Existing automated coverage was not replaced with a native scenario. No ordinary UI path to trigger the target probe while this exact confirmation remained pending was established. | Do not infer acceptance from changing recording-session fields or from component tests. A dedicated browser test driver or suitable controllable target transition remains necessary. |
| Health query-parameter source changes on reused route, including cancellation | **UNTESTED in browser.** Inline source actions are not equivalent to changing the `record` query parameter on the reused route. No supported interaction sequence for the exact transition was completed here. | Existing integration coverage remains distinct. Full-page navigation/reload was not counted as route-reuse acceptance. |
| Actual screen-reader speech | **UNTESTED.** No VoiceOver/NVDA spoken-output session was performed; available DOM and native accessibility trees do not prove announcements. | Accessible naming, error associations/announcements, loading announcements and focus behavior still need an actual screen reader. |
| Native mobile keyboard/layout | **UNTESTED.** No real mobile device was available; `xcrun simctl list devices booted` could not locate `simctl`. | Desktop browser dimensions are not native-device acceptance. No native keyboard claim. |

## Confirmed fix and regression

In [Health's write runner](../../../web-angular/src/app/registry/health-page/health-page.ts), attachment status now distinguishes an uncertain write from a confirmed failure using the existing write-state controller. No request, idempotency key, payload, attachment-linking, provenance, or recovery semantics changed.

The existing lost-response regression in [health.spec.ts](../../../web-angular/src/app/registry/health.spec.ts) now asserts the unknown-outcome wording in component and rendered output, in addition to its existing same-bytes/same-key and single-link checks. All 13 focused Health tests passed. Final production-browser replay reproduced the fault, displayed the corrected message, and recovered with the exact request.

Reproduce with the documented memory harness and [guarded proxy](fault-proxy.mjs): apply a POST `/health/attachments` rule with `drop: true`, upload [the synthetic PNG](synthetic-attachment.png), observe the locked uncertain state, clear the rule, then choose Retry same request. The proxy drops only the upstream response, after the memory server processes the request. [Memory helper](memory-api.mjs) was used only for concurrent revision writes against the verified memory server.

## Actual print findings

Safari used A4 portrait, 100% scale, browser headers/footers enabled and background printing disabled. The baseline [Noori PDF](baseline-noori.pdf) contains 55 exported pages; preview initially reported 57 before repagination. Its [text check](baseline-pdf-check.json) found every one of the 39 fixture record IDs. Baseline pages 1 and 2 were visually inspected: title, identity, vaccination content and record layout were readable, and application navigation was absent. The Timeline heading and explanatory note landed at the bottom of page 2, with the first record on page 3.

For the final production bundle, the guarded proxy returned [a renderer-only fixture](print-pagination-fixture.json) containing 30 production rows and long synthetic notes. This intentionally tests rendering, not totals calculation; report totals were not recomputed. The on-screen section showed 1–25 of 30. Native preview reported 71 pages; the actual [final exported PDF](final-pagination-30-rows.pdf) has **69** pages after repagination. [Extraction results](final-pdf-check.json) confirm all 30 IDs, row 30 on pages 19 and 52, hidden application navigation, and the custom identity header on page 1 only.

Final PDF pages [19](final-pdf-page-19.png), [52](final-pdf-page-52.png), and [69](final-pdf-page-69.png) were rendered with Poppler and visually inspected. Page 19 includes rows 29/30 and the next section; page 52 wraps the long synthetic notes in the audit appendix; page 69 includes the complete end of the response. These samples showed no clipped text or hidden-navigation leakage. **All 69 pages were not visually inspected**, and this is not a blanket clipping/table acceptance pass. The report's table-based presentation frame was observed, not an exhaustive matrix of independent tabular reports.

Two layout defects remain open:

1. Safari does not repeat the custom animal identity/generated-at header after page 1. The browser footer does include the animal ID in the URL, but that does not fulfill the custom repeated-header intent.
2. A section title plus explanatory note can be separated from its first record by a page break.

Fixed-header and print-layout CSS experiments did not resolve the native result. Their code changes were removed. [Unsuccessful header trial](unsuccessful-fixed-header-trial.pdf) and [layout trial](print-layout-trial.pdf) are diagnostic artifacts, **not accepted fixes**. No unverified print change is included in the final source diff. The remaining print risk is loss of context on separated pages and poor heading pagination, not demonstrated record omission.

## Validation and boundaries

| Check | Result / log |
| --- | --- |
| Focused Health tests | 13 passed — [log](health-focused.txt) |
| Full frontend | 525 passed, 50 files — [log](frontend-tests.txt) |
| Full server | 779 passed, 0 failed/skipped — [log](server-tests.txt) |
| Server/shared typecheck | Passed — [log](typecheck.txt) |
| Angular compiler | Passed — [log](angular-compiler.txt) |
| Spec TypeScript | Passed — [log](spec-typecheck.txt) |
| Template gate | Passed — [log](templates.txt) |
| Contrast gate | Passed — [log](contrast.txt) |
| Final production build | Passed with `CI=true NG_BUILD_MAX_WORKERS=1 npm run build:angular` — [log](final-build.txt) |

Known warnings remain: 674.38 kB initial bundle exceeds the 500 kB warning budget by 174.38 kB; `@dairy/shared` produces the existing CommonJS optimization warning. jsdom canvas warnings in frontend tests are not browser-rendering evidence. The known normal-cache LMDB allocator problem was not investigated. One stale lazy-chunk request occurred while replacing the local build during testing; reloading the browser resolved it and it was not treated as an application defect.

Documentation validation, final preservation checks and process cleanup are recorded in the completion files added alongside this checklist. No live-model regression, production access, operator trial, exhaustive race matrix, real screen-reader speech, or native mobile check was performed. Acceptance remains open for the explicit gaps above.
