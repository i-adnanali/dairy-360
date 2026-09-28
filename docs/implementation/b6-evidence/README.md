# B6 release-verification evidence

Baseline `26c95c0fdce36c7a71c401ccfb91506785ed3f2b`; work performed 27–28 September 2026. **Uncommitted working tree, no commit or push.** `SOURCE_SHA256.txt` fingerprints final application/test/config/fixture sources. `BASELINE.txt` records HEAD and changed scope; `protected-constraints.txt` records protected comparisons. `docs/reviews/` remains intentionally untracked and untouched.

Read [ACCEPTANCE.md](ACCEPTANCE.md) for A01–A18 and cross-workflow evidence levels, and [HUMAN-ACCEPTANCE.md](HUMAN-ACCEPTANCE.md) for outstanding release checks. This directory is evidence, not a blanket passing release certificate.

## Reproduce safely

From `/Users/adnanali/personal/dairy-360`, use separate terminals for long-running services:

```sh
export PATH=/Users/adnanali/.nvm/versions/node/v22.22.3/bin:$PATH
NG_BUILD_MAX_WORKERS=2 npm run build:angular
# Terminal 1; prints :memory: and explicitly does not open dairy.db:
NODE_OPTIONS='--import /Users/adnanali/personal/dairy-360/docs/implementation/b2-evidence/fixture-clock.mjs' npm run registry:harness -w server -- --port=6500 --empty
# After confirming the memory banner, seed only that new harness:
NODE_OPTIONS='--import /Users/adnanali/personal/dairy-360/docs/implementation/b2-evidence/fixture-clock.mjs' HARNESS_URL=http://localhost:6500 node scripts/harness-seed.mjs
# Terminal 2:
node scripts/serve-built.mjs --port=6502 --api=http://localhost:6500
# Terminal 3, read-only 101-record report / 101-delivery / 26-payment adapter:
node docs/implementation/b6-evidence/report-fixture.mjs
# Terminal 4:
node scripts/serve-built.mjs --port=6504 --api=http://localhost:6503
# Terminal 5, no database/upstream/model/write executor:
node docs/implementation/b5-evidence/assistant-fixture.mjs
# Terminal 6:
node scripts/serve-built.mjs --port=6506 --api=http://127.0.0.1:6490
```

Do not reuse an occupied port blindly. The report adapter checks upstream storage is memory and refuses non-GET requests. Seed refuses non-memory targets. These fixture scripts are never imported by the application. Backend and seed clock is 2026-09-17T12:00Z; browser clock was 27 September initially and 28 September after resumption. Health/report dates are selected explicitly. Generated UUIDs vary between fresh seeds; semantic fixture quantities and dates are deterministic, not byte-identical IDs.

The assistant fixture commands are `long`, `streaming`, `tools`, `chart`, `no data`, `error`, `confirm`; see B5 README. B6 used `long tools chart confirm`, rejected it, then `confirm` and approved, then `error`. Approvals are simulated messages with no executor. No real farm data was modified.

Required checks:

```sh
npm run test -w web-angular -- --watch=false
npm run test -w server
NG_BUILD_MAX_WORKERS=2 npm run build:angular
npm run typecheck
npm run check:templates
npm run check:contrast
git diff --check
```

## Results and files

- `frontend-tests.txt`: final 450 passing tests / 42 files. One earlier full run failed six ChatPanel assertions because standalone fixtures inherited persisted dock state. The fixture now explicitly closes the dock; final rerun passes. This was test isolation, not a passing run hidden by changing assertions.
- `server-tests.txt`: 779 passing tests, zero skips. No server/shared/domain source changed. API-key-gated live-agent regressions were not run and are not counted.
- Build, typecheck, templates, contrast and diff logs: required checks. Existing initial-bundle/CommonJS and jsdom canvas warnings remain. Six exact held border failures, zero unexpected failures.
- `measurements.json`: 120 browser renders, twelve workflow states × five widths × two themes. All recorded document widths equal observed viewport widths, and measured writable fields stay horizontally inside the viewport. Ten initial rows did not reach the requested size (People 390, Feed 1024, eight statement rows); exclude those rows as requested-size evidence. `viewport-rechecks.json` supplies settled replacements with observed width equal to requested width, including all ten statement theme/width pairs. This is geometry evidence, not exhaustive visual/keyboard acceptance or native zoom. Initial renders preceded the B6 small accessibility fixes; final changed surfaces were reloaded and checked separately. Untouched operational styles/templates remain byte-identical to B5.
- `navigation.json`: raw/context/palette/Back/inline/session/payment Keep observations. Explicit Discard transitions also exercised. Pristine browser Back/Forward between People and person detail passed without a prompt; dirty Forward permutations remain unverified.
- `calving-accessibility.txt`, `people-final.txt`, `person-payment-final.txt`, `health-board.txt`, `health-round.txt`, `feed-review.txt`, `check.txt`: actual browser snapshots, with the fixture and source phase described by their names and matrix.
- `analytics-final-focus.json`: final route focus is H1 Milk analytics. `analytics-combinations.json` captures immediate period/session transitions, not settled numeric equivalence; do not use its summaries as a numeric oracle.
- `statement-pagination.txt`: delivery page two while payments remain page one; full totals remain above collections. `life-corrections.txt`: 101-row report scope with corrections.
- `assistant-breakpoints.json`: ten open-dock crossings with one retained multiline composer; modal below 1280 and nonmodal above. `assistant-final.json`: 14 standalone theme/width renders. Decisions/error snapshots are synthetic traffic, never live verification.
- `native-output.json`: actual print/export attempts, neither yielded an inspectable native output. `zoom.txt`: native shortcut caused no observable zoom. These are OPEN cases.
- PNG captures show selected final event and assistant states. Screenshot inspection confirms visible hierarchy/wrapping, not every scrolled record. B1–B5 screenshot galleries remain prior evidence; no B1 evidence README exists, so its progress report and individual artifacts were used.

Browser: Codex in-app browser. Underlying browser version is not exposed by its supported API; no version is invented. Final source-to-evidence mapping: unchanged workflow renders use B5 application bytes plus B6 build; changed label/focus/event/payment surfaces were reloaded after the final respective build. The final manifest describes the working tree, not an unattested commit.

## Verification interruptions and limitations

Sandboxed server testing failed to create the tsx IPC socket, and the sandboxed build aborted. Reviewed escalation allowed both to pass. A browser action was auto-review rejected when approval review hit a usage limit on 27 September; no workaround was attempted. User resumed on 28 September and supported browser access recovered. A stale lazy chunk after rebuilding was cleared by reloading final assets. These interruptions are not farm/API defects.

Native PDF/JSON completion, actual 200% browser zoom, native screen reader, real phone/software keyboard, operator walkthrough and live assistant integration remain unverified. Some exhaustive browser writer/error-state combinations remain OPEN in the matrix despite passing component/server tests. Release readiness is therefore **not established**. No gate was silently waived.
