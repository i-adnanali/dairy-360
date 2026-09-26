# B4 verification evidence

Baseline `75f9eed`; implementation and checks performed 2026-09-25–26. `SOURCE_SHA256.txt` identifies final changed source. The in-app browser API did not expose its browser version.

## Isolation and reproduction

Node **22.22.3**. Fresh registry harness on **6480**, confirmed `:memory:` by both startup and seed. The B2 `fixture-clock.mjs` preloader fixes backend and seed dates to 2026-09-17T12:00Z. The frontend retains its real clock. No real database was opened or changed.

Build the app, then start `npm run registry:harness -w server -- --port=6480 --empty` with `NODE_OPTIONS=--import /absolute/repo/docs/implementation/b2-evidence/fixture-clock.mjs`. Seed with the same preloader and `HARNESS_URL=http://localhost:6480 node scripts/harness-seed.mjs`. Serve the production bundle with `node scripts/serve-built.mjs --port=6482 --api=http://localhost:6480`.

`large-fixture.mjs` starts a read-only adapter on **6483**, checks that upstream is the memory harness and refuses all non-GET methods. Serve the same bundle on **6484** with `--api=http://localhost:6483`. It supplies 101 synthetic measured milk rows with unknown future fields, and independent 101-delivery/26-payment collections. Statement totals are coherent full-collection fixtures (101 × 10 L at Rs 100/L, 26 × Rs 100 payments), not derived from UI pages. Record IDs and repeated dates are presentation fixtures, not a farm chronology. Processes may no longer be running.

## Results

- `frontend-tests.txt`: 443 passing tests. Includes complete JSON Blob comparison, all-row print DOM from page two and page restoration, empty domains, corrections/unknown fields, all five advisory contexts, zero currency, independent statement pagination, Analytics semantics/filter matrix and Check failure states. Shared pager boundary matrix remains passing.
- `server-tests.txt`: 779 passing tests, zero skips. All five structured contexts and fallback currency/prose verified; all nine Analytics combinations have pinned numeric/coverage assertions over an in-memory database.
- `build.txt`, `typecheck.txt`, `templates.txt`, `contrast.txt`, `diff-check.txt`: required command results. Six exact held border exceptions; zero unexpected contrast failures. Existing bundle/CommonJS/canvas warnings remain.
- `measurements.json`: final four-workflow × five-width × two-theme matrix. Both document and main match viewport width. Table scrolling regions include client/scroll widths and tabindex; hidden Show data tables have zero dimensions and no tab stop.
- `analytics-combinations.json`: all nine period/session controls and their preserved URLs/full-period summaries.
- `analytics-accessibility.txt`: final rendered accessible names, including **No measurements** rather than the generic No record label.
- `statement-pagination.json`: delivery page two while Payments stays on page one, independent payment page two, 100→25 page-size changes, unchanged full-period totals.
- `keyboard-and-output.txt`: additional keyboard/contents/output observations and explicit limits.
- `protected-constraints.txt`: baseline source comparisons; `CHANGED_FILES.txt` and `SOURCE_SHA256.txt`: exact source scope.

## Captures

Each workflow has 390px and 1440px captures in light/dark (`analytics-*`, `statement-*`, `life-*`, `check-*`). These are viewport captures, not full-page stitching. Additional images show the Analytics chart table and Life report correction history. Main-page screenshots were visually inspected for hierarchy/wrapping; geometry measurements cover all requested widths. This is not an operator trial or native assistive-technology assessment.

## Output limitation

Print / Save as PDF was clicked in the actual in-app browser, but it returned to the page without an inspectable PDF/preview. Export complete JSON was clicked with corrections enabled, but the download-event wait timed out and returned no inspectable file. Consequently **actual PDF/print output and native downloaded-file completion are not verified**. The unit test's print spy verifies DOM completeness at print invocation, and its Blob comparison verifies complete serialization; neither is substituted for native output acceptance. No truncation defect was claimed.
