# Angular acceptance — 7–8 October 2026

Baseline: `9b154cd` on main. This continuation uses a new disposable in-memory harness and the production Angular build. No commit, push, deployment, persistent database, production service or live model API was used. Dates in fixture responses remain 7 October although execution continued on 8 October (Asia/Karachi).

Read alongside the [6 October acceptance](../angular-acceptance-2026-10-06/ACCEPTANCE.md), [5 October acceptance](../angular-acceptance-2026-10-05/ACCEPTANCE.md), [remediation ledger](../angular-remediation-2026-10-02.md), [development guide](../../guides/development.md), and [testing guide](../../guides/testing.md). The original audit read was `/Users/adnanali/personal/audits/angular-2026-10-02/audit.md`.

## Outcome

Feed comparison-context races passed in Chrome. Fixed long animal identity overlapping print content, Chromium's blank trailing print page, and incomplete buyer statement printing. Actual spoken screen-reader and native-mobile acceptance remain unavailable. Alternative paper/orientation/scale is a documented failing configuration, so the overall acceptance gate remains open.

## Isolated setup and reproduction

Use Node 22.22.3 from `/Users/adnanali/.nvm/versions/node/v22.22.3/bin`. In separate task-owned terminals from the repository root:

```sh
export PATH=/Users/adnanali/.nvm/versions/node/v22.22.3/bin:$PATH
CI=true NG_BUILD_MAX_WORKERS=1 npm run build:angular
npm run registry:harness -w server -- --port=6510 --empty
```

Read `http://127.0.0.1:6510/api/registry/storage` and require `memory: true` before any fixture write. [storage.json](storage.json) records `:memory:`. Seed only this harness with `HARNESS_URL=http://127.0.0.1:6510 node scripts/harness-seed.mjs`. The [seed log](seed.txt) contains the synthetic load result. Then start:

```sh
node docs/implementation/angular-acceptance-2026-10-07/fault-proxy.mjs
node scripts/serve-built.mjs --port=6512 --api=http://127.0.0.1:6511
```

The task-only [proxy](fault-proxy.mjs) verifies memory at startup and only forwards registry/harness paths to loopback 6510. [memory-api.mjs](memory-api.mjs) verifies memory before each read/concurrent write. Neither helper belongs to production code. [requests.jsonl](requests.jsonl) records request arrival, captured delay/failure rules and synthetic write bodies; it does not log response completion. Set rules in [faults.json](faults.json); the first matching method/path wins. Rules are captured at request arrival, so changing the file permits a newer request to finish first. Recreated harness IDs differ: discover items/daily rows/buyers from the fresh harness rather than reusing this run's IDs for writes. Saved fixtures can be used for rendering only.

Initial sandboxed harness launch failed on the local tsx IPC pipe; the approved local execution succeeded. An old open tab encountered a missing lazy chunk after rebuilding; reloading the production page resolved that harness artifact. Neither is counted as a product regression.

## Feed browser scenarios

Chrome 154.0.8037.98, production UI, recording as `acceptance_fixture`, Direct entry. Each conflict used a real concurrent revision in the memory harness, followed by a stale browser save returning 409. Comparison reads went through the fault proxy. Draft transitions were performed through the visible confirmation dialog.

| Scenario | Reproduction and observed result | Evidence |
|---|---|---|
| Item delayed success | Edit Silage revision 1; concurrent helper advances it to 2. Save draft to trigger conflict. Delay comparison GET 45 seconds. Choose Khall; Keep editing preserves the Silage draft. Retry, discard and enter `CURRENT-KHALL-DRAFT`. Late Silage success does not replace current data, draft or comparison. | [pending](item-success-context-pending.txt), [final](item-obsolete-success-final.txt), [concurrent revision](concurrent-item.txt) |
| Item delayed failure | Repeat with a 45-second 503 comparison. Discard into Khall and enter `KHALL-AFTER-OBSOLETE-FAILURE`. No stale error appears; current draft survives. | [pending](item-failure-context-pending.txt), [final](item-obsolete-failure-final.txt) |
| Overlapping comparison | On the same conflicted Silage draft, start an older 30-second 503, clear its rule, then compare again successfully. After the old failure, revision 2 comparison and `SAME-CONTEXT-DRAFT` remain. | [pending](item-overlap-pending.txt), [final](item-overlap-final.txt) |
| Daily delayed success | Edit 7 October revision 1; concurrent update advances to 2. Conflict, Load latest alongside my draft, delayed GET 45 seconds. Date change to 6 October: Keep editing restores date and draft; retry/discard loads 6 October. Enter `CURRENT-DAY-06-DRAFT`. Old success cannot replace it. | [cancelled transition](daily-context-cancelled.txt), [pending](daily-success-context-pending.txt), [final](daily-success-context-final.txt) |
| Daily delayed failure | Concurrent update of 6 October revision 1 triggers real conflict. Comparison GET delayed 45 seconds, then 503 `OBSOLETE-DAY06-FAILURE`. Change date/discard into 7 October revision 2 and enter `DAY07-AFTER-OBSOLETE-FAILURE`. After delay expires, current date/revision/draft survive with no stale error. | [pending](daily-failure-context-pending.txt), [final](daily-failure-context-final.txt), [screenshot](daily-final.png) |

No feed defect was found in these cases; existing sequence/context guards held. This is browser evidence in addition to the existing race regression coverage, not a replacement for it.

## Print defects and fixes

1. **Long identity overlap:** the repeated animal header had fixed height, so a roughly 450-character name overwrote report content. Header now grows naturally; the content area receives the remaining sheet height. The paginator's empty-page probe uses that actual remaining height. A regression models a wrapped header reducing capacity from 250 to 75 pixels and verifies complete content without overflow.
2. **Trailing blank page:** Chromium emitted a final blank sheet at the named-page boundary. Standard A4 page rules eliminate the transition. Final Chrome export has 60 content pages and no blank page; Safari has 56 and no blank page.
3. **Buyer statement incomplete:** native Safari printing originally exported one viewport with only three delivery markers, navigation and pagination controls, omitting the rest. Printing now expands deliveries, payments and rate history synchronously, generates measured pages with repeated buyer identity and column context, preserves monthly totals, excludes navigation/payment forms, and restores the original screen pagination afterward. Regression checks 101 deliveries/26 payments in the print DOM and restoration of screen page 2 with unchanged totals.

The final statement fixture has 35 deliveries and 30 payments with long notes. Its final Safari PDF contains all 65 distinct row markers, monthly carried balance and agreed rates, with identity on all 13 pages. The intermediate CSS-only export restored rows but Safari failed repeated headers and row grouping; it is retained as diagnostic evidence, not a passing result.

| Export | Settings and result |
|---|---|
| [Chrome baseline](chrome-long-identity-before.pdf) | Long name overlaps body; 55 pages including trailing blank. |
| [Chrome final](chrome-a4-final.pdf) | A4 portrait, default scale, headers off/backgrounds on. 60 pages. All 36 unique fixture UUIDs and complete technical audit retained; identity repeated on every page. No blank page/navigation. |
| [Safari final](safari-a4-final.pdf) | A4 portrait, 100%, browser headers/footers on, backgrounds off. 56 pages, all identities and complete audit retained. Browser preview count sometimes differs from exported PDF; acceptance uses the actual PDF. |
| [Safari alternative](safari-letter-landscape-80.pdf) | US Letter landscape, 80%. 90 pages; identity absent on 34 continuation pages. All UUID markers and audit ending remain, but this **fails** repeated-identity acceptance. Fixed A4 sheets do not adapt to an arbitrary physical page override. The animal report now explains A4 portrait/100% settings. Alternative formats remain an open product limitation. |
| [Buyer baseline](statement-before.pdf) | A4 portrait/100%, one clipped viewport including navigation. |
| [Buyer final](statement-a4-final.pdf) | A4 portrait/100%, 13 pages. All delivery/payment markers, monthly total and rates retained; buyer identity on every page; navigation and payment-entry controls absent. |

Read-only [PDF checker](check-pdfs.py) and [results](pdf-checks.json) verify page counts, identity, content markers and navigation exclusion. For both final animal PDFs, the entire extracted technical audit equals the source fixture after removing repeated headers/browser furniture and whitespace (45,797 normalized characters). This checks complete audit content, beyond merely checking IDs. It does not prove every glyph is visually unclipped. Native preview, rendered first/transition/final pages and visual checks found no overlap or clipping in the passing configurations. [Animal first page](safari-a4-page-1.png) and [statement first page](statement-complete-page-1.png) illustrate the layouts. Statement transition page 8 keeps Payments with its first row; last page 13 retains the last payment and agreed rates. Generalized, exceptionally tall single table rows beyond a sheet and exhaustive visual inspection of every page remain unverified.

Run the checker with a Python environment containing `pypdf`; this run used the bundled workspace Python. PDFs are native browser exports, not generated substitutes. The original and intermediate PDFs remain so failures are reproducible. The final files are those linked in the table above.

## Environment gaps

[Environment probes](environment-check.txt) and [native app inventory](available-apps.json) record macOS 26.6.2, Chrome 154.0.8037.98 and Safari 26.6.2. Firefox is absent from `/Applications` and from the enabled browser/app surfaces; Gecko printing was not tested. No additional browser was installed.

VoiceOver and VoiceOver Utility are installed but were not running. Available tools provide native accessibility inspection and keyboard input, but no screen-reader speech capture/transcription endpoint; discovery for reader/audio-capture tools returned none. This run did not activate VoiceOver or certify its spoken output. Spoken names, live error/loading announcements and spoken focus transitions remain **not tested**. DOM/AX evidence in the race checks is not claimed as spoken-reader acceptance.

`xcrun simctl list devices booted` fails because `simctl` is unavailable; `/Applications/Xcode.app` is absent; `adb` is unavailable. No controllable mobile device/simulator surface is exposed. Native keyboard, forms, scrolling and layout remain **not tested**. Desktop resizing was not substituted. A sandboxed process-list probe was denied by the OS; the native app inventory supplied reader running-state evidence instead.

## Validation

- [Frontend](frontend-final.txt): 529 tests, 51 files, pass. Includes new reduced-print-height regression and expanded statement pagination regression.
- [Server](server-tests.txt): 779 pass, 0 fail, 0 skipped. No live-model regression suite invoked.
- [Root typecheck](typecheck-final.txt), [Angular compiler](angular-compiler-final.txt) and [spec TypeScript](spec-typecheck-final.txt): pass. Both compiler-only commands used `--noEmit`; no JavaScript emitted beside TypeScript.
- [Templates](templates-final.txt): pass; [contrast](contrast-final.txt): 122 graded checks, zero failures.
- [Production build](production-build-final.txt): pass with `CI=true NG_BUILD_MAX_WORKERS=1`. Existing initial-bundle and CommonJS warnings remain; budgets unchanged.
- Documentation and whitespace checks are recorded in [final checks](final-checks.txt).

## Remaining acceptance work

Spoken reader testing, native mobile testing, Gecko printing, alternative physical page settings, and other independent reports (for example wage statements) remain open. This run's independent-report fix and browser evidence cover buyer statements. It does not establish general print acceptance for every report. The measured A4 report design needs further work to support arbitrary paper/orientation/scale without lost repeated identity.

Cleanup and preserved review hashes are recorded in [cleanup](cleanup.txt). Task-owned tabs/processes were closed; fault rules were reset. No commit/push/deploy performed.
