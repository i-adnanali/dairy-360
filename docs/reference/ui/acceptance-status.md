# Acceptance status

Updated **16 November 2026**, for branch `breeding-stage-1` (see *Breeding stage 1* below). The previous full run, 11 November against `12a5735` on branch `farm-born-unknown-mother`, covered the Add animal *Born here, mother not known* path. The run before that, 10 November against `659dc3f`, covered the November section restructure, the shared selection language and the Check rework. This page holds the latest recorded results and the checks skipped by decision. It is not a claim of exhaustive platform or accessibility certification.

## Latest recorded results

Run on 16 November 2026 against branch `breeding-stage-1` (base `2be39a4`), Node 22.22.3 (the Angular CLI refuses the machine default 22.3.0):

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular -- --watch=false`) | 632 passed in 66 files, exit 0, no unhandled errors |
| Server tests (`npm test -w server`) | 841 passed, 0 failed, 0 skipped |
| `check:docs`, `build:shared`, `check:templates`, typecheck | Pass |
| Production build (`npm run build -w web-angular`) | Builds. Warnings: initial bundle 712.12 kB against the 500 kB budget; four component stylesheets over the 4 kB budget (Health, Analytics, Today, life report); two unused-import notices (`Card` in HealthPage, `IdentifierLink` in PeopleList); the shared CommonJS notice. |

## Breeding stage 1

All seven gates above passed on this branch. The build warnings are all in files this branch does not touch (the same notices as the 11 November run below); they were not compared byte for byte against a build of `main`.

- **Badge:** checked in a browser on synthetic data only, the harness sample herd (11 cows and 12 male calves). No real-herd breeding event has been entered, and the `REGISTRY_BREEDING` flag is not turned on for the real registry. The page does not forward `?as_of`, so it shows today's state; the pinned dates were read from the API.
- **Flag off:** the animal response has no reproduction key, the page header is unchanged, and no screenshot needs refreshing.
- **Correction path:** added after review on 16 November: `recordBreedingEvent` takes `supersedes_id` and `registry:breed` takes `--supersedes` (same animal, same type, once per event; no retraction, OPEN-064). Tested in memory only; the CLI flag was checked by a unit test of its parser, and `registry:breed` was not run against any database.
- **Migration 10:** rehearsed on a copy of a backup taken from `main`. Version 9 to 10, 0 verification violations, events 0 to 0, every row count unchanged. The real registry holds no events yet, so the rehearsal proves the schema step on real data but copies no event rows; row copying is covered by the in-memory migration test.

## Previous recorded results (11 November 2026)

Run on 11 November 2026 against branch `farm-born-unknown-mother` (base `12a5735`). Kept for comparison; superseded by the latest results above.

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular -- --watch=false`) | 626 passed in 64 files, exit 0, no unhandled errors |
| Server tests (`npm test -w server`) | 806 passed, 0 failed, 0 skipped |
| Typecheck, `check:templates`, `check:contrast`, `check:docs` | Pass |
| Production build (`npm run build:angular`) | Builds. Warnings: initial bundle 712.12 kB against the 500 kB budget; four component stylesheets over the 4 kB budget (Health, Analytics, Today, life report); two unused-import notices (`Card` in HealthPage, `IdentifierLink` in PeopleList); the shared CommonJS notice. |

On 11 November the Add animal form's *Born here, mother not known* path was clicked through against the memory harness (desktop width, light): the saved record, its timeline and its life report. The 10 November run clicked each restructured section through in Chrome at laptop and phone widths, in light and dark. The Impeccable design detector found nothing on Check at 1280, 1440 and 390 px; older nested-card findings remain on the milking sheet's withdrawal box and session toggle. Live assistant runs were not part of this work; assistant-facing server text was deliberately left unchanged.

## Print

Chrome and Safari native PDF exports of animal lifetime reports and buyer statements were verified in October 2026. Use **A4 portrait at 100% scale**: it is the verified configuration. Safari US Letter landscape at 80% split the A4 sheets and lost repeated identity on continuation pages; do not infer equivalent support for other formats or reports.

## Checks skipped by decision

On 9 October 2026 the owner chose to skip:

- Alternative paper, orientation and scale support.
- Firefox/Gecko and additional report print coverage beyond buyer statements.
- Spoken screen-reader names, announcements and focus transitions.
- Native mobile keyboard, forms, scrolling and layout on a real device or simulator.

These are scope exclusions, not passes. Real-farm operator trials, live assistant evaluation and other deferred items remain in [OPEN](../../OPEN.md).

## Screenshots

The [gallery](../../images/current/README.md) shows appearance at the commit in its manifest. A screenshot does not prove keyboard, screen-reader, native-device, print or live-service behavior.
