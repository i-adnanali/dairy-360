# B5 assistant verification evidence

Baseline: `a7a4589f3905e1f4b850cd1a6a398871aa465ef6`. Work performed 2026-09-26–27 with Node 22.22.3. Commit and push authorized by the user after the B5 review handoff. `SOURCE_SHA256.txt` identifies the final changed source; the existing untracked review directory remains untouched.

## Reproduce safely

Use Node from `/Users/adnanali/.nvm/versions/node/v22.22.3/bin` on PATH. From the repository root:

```sh
NG_BUILD_MAX_WORKERS=2 npm run build:angular
node docs/implementation/b5-evidence/assistant-fixture.mjs
# In a separate terminal:
node scripts/serve-built.mjs --port=6492 --api=http://127.0.0.1:6490
```

Open `http://localhost:6492/chat`. This fixture has **no database, upstream connection, API key or write executor**. Its storage response identifies a synthetic memory harness; non-GET requests other than `/api/agent/run` are refused. It exercises the actual production AG-UI client and components, not an alternate fixture UI. Session setup is frontend memory only. The protected form was typed and discarded for nested-dialog verification; no farm record was saved.

Send these commands through the composer:

| Input | Deterministic state |
|---|---|
| Fresh page | Empty state and supported prompt actions |
| `long` | Long unbroken reference, markdown table/code and many paragraphs |
| `streaming` | Long response followed by twelve timed segments |
| `tools` | Running then Success; Running then Error with a synthetic reason; long arguments in disclosure |
| `chart` | Two known periods, including zero, totals 0/12 L and averages 0/6 L |
| `no data` | Explicit no-data chart state |
| `error` | Terminal synthetic connection error, no automatic retry |
| `confirm` | Exact synthetic target SYN-001, 2026-09-17 morning, 6 L; Approve/Reject produce retained decisions/results without writes |

Commands can be combined (for example `long tools chart`). A fresh reload resets synthetic conversation/drafts. Open/closed posture and theme are existing preferences. The fixture intentionally implements only the storage/empty-read responses needed for assistant and draft-dialog checks; it is not a complete registry harness.

## Evidence files

- `frontend-tests.txt`: complete frontend suite, including once-only approvals, multi-card aggregation, unknown-outcome/no-replay, tool status/reasons, single composer/draft retention, chart equivalence/no-data, reader scroll position and resolved-card focus.
- `server-tests.txt`: 779 passing server regressions, zero skips. No agent executor or domain calculation changed.
- `build.txt`, `typecheck.txt`, `templates.txt`, `contrast.txt`, `diff-check.txt`: production build and required gates. Six exact held resting-border exceptions; no unexpected contrast failure. Composer is now a readable, focusable read-only field while busy, so its obsolete disabled-text exemption was removed.
- `measurements.json`: 56 empty/rich-response combinations: two modes × two themes × seven widths. `pending-measurements.json`: the additional 28 pending-confirmation combinations. `final-measurements.json`: final-build geometry/state verification after focus and composer sizing refinements. Requested widths: 360, 390, 768, 1024, 1279, 1280 and 1440.
- `nested-confirmation.json` and `keyboard-and-states.txt`: real browser focus/keyboard/state observations; `*-accessibility.txt` records the final rendered state vocabulary/data.
- PNG captures show representative 390px/1440px layouts in both themes. These are viewport captures; scrolling within the conversation reveals earlier text or later data.
- `protected-constraints.txt`, `CHANGED_FILES.txt`, `SOURCE_SHA256.txt`: baseline comparisons and precise changed-source scope.

The in-app browser exposed viewport, DOM, screenshots and keyboard controls, but not its underlying browser version. The synthetic backend date is 2026-09-17; the frontend clock is unchanged. Two fixture transport mistakes (missing result messageId and events emitted after terminal error) were fixed before the recorded successful state checks; they were fixture failures, not live service evidence.

## Limits carried forward

Native print/PDF output remains unverified. Actual browser JSON download completion remains unverified; B4's complete Blob serialization tests passed. Operator walkthrough, native screen-reader, real-phone keyboard, actual browser zoom and live assistant checks remain outstanding. Synthetic AG-UI traffic verifies UI handling, not real model behavior or production write execution. No release-readiness claim is made; B6 owns the full release-verification matrix.
