# Acceptance status

Updated **23 November 2026**, for branch `breeding` (see *Breeding stage 4* below). The previous full run, 11 November against `12a5735` on branch `farm-born-unknown-mother`, covered the Add animal *Born here, mother not known* path. The run before that, 10 November against `659dc3f`, covered the November section restructure, the shared selection language and the Check rework. This page holds the latest recorded results and the checks skipped by decision. It is not a claim of exhaustive platform or accessibility certification.

## Latest recorded results

Run on 16 November 2026 against branch `breeding-stage-1` (base `2be39a4`), Node 22.22.3 (the Angular CLI refuses the machine default 22.3.0):

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular -- --watch=false`) | 632 passed in 66 files, exit 0, no unhandled errors |
| Server tests (`npm test -w server`) | 841 passed, 0 failed, 0 skipped |
| `check:docs`, `build:shared`, `check:templates`, typecheck | Pass |
| Production build (`npm run build -w web-angular`) | Builds. Warnings: initial bundle 712.12 kB against the 500 kB budget; four component stylesheets over the 4 kB budget (Health, Analytics, Today, life report); two unused-import notices (`Card` in HealthPage, `IdentifierLink` in PeopleList); the shared CommonJS notice. |

## Breeding stage 4

Run on 23 November 2026 against branch `breeding` at `b7634db`, Node 22.22.3.

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular`) | 709 passed in 69 files. The timing-flaky `farm-monitor.spec.ts` test did not fail in this run. |
| Server tests (`npm test -w server`) | 999 passed, 0 failed |
| `check:docs`, `build:shared`, `check:templates`, typecheck | Pass (docs: 77 files, 0 errors; templates: 106 files) |
| Production build | Builds, with the stage 3 warnings (initial bundle 713.07 kB against the 500 kB budget, two unused imports, the shared CommonJS notice) and five component stylesheets over 4 kB, now including `breeding-page.css` (4.22 kB) |

- **One full case through the pilot, harness only.** On Shehzadi (BD-0009) a service dated 20 August 2025 was entered from the Breeding page (the no-heat-sign warning showed and was saved over), then an ultrasound check, Pregnant, dated 1 October 2025 (day 42). Her calving already on record for 1 June 2026, 285 days after the service, closes that case: on Herd figures (`All on record`) it counts as held and her row shows Confirmed on day 42. **This full case has passed through the pilot only in the harness. It has not happened on the real herd.**
- **A loss.** On Heer (BD-0007) an ultrasound Pregnant on 10 November 2026 and an ultrasound Not pregnant on 20 November made her Lost (worked out); her Breeding tab then offered `Record a loss`, which opened an empty form (no date, no observer, no time field, button `Save loss`). Saving a loss dated 18 November made her Lost (recorded), and Losses on Herd figures read 1 of 8.
- **A calving before the window.** On Sohni (BD-0001), `Record calving` opened the calving form already set to her; a calving dated 4 September 2026, 280 days after her service of 28 November 2025, showed "This calving is 280 days after the earliest possible conception … The calving window opens at day 285 …" once, with focus on it and the button `Save over this check`. Saving over it wrote the calving with the override `calving_before_window`, and her state read Calved.
- **Herd figures.** The tab showed all eight figures, counts with no percentage (every figure is under 10 cases in the harness herd), the "Why some figures are rough" lines and the By animal table.
- **Flag off:** a harness without `--breeding` answers `GET /api/registry/breeding/figures` with 404 and the animal response has only `animal`, `status` and `events`. That harness herd has no services, so the "a calving writes with no window warning when the flag is off" case was checked by the server test, not in the browser.
- **Migration rehearsal:** `server/dairy.db` was copied byte for byte outside the repository (same SHA-256) and only the copy was migrated and verified: version 11 to 13 (migrations 12 and 13 applied), events 0 before and 0 after, 0 violations. The real file's timestamp is unchanged (16 November, 21:02). `npm run registry:backup` was not run, because on this branch it would migrate the real database. The nightly backup job stays unloaded.
- **Not checked:** no owner walkthrough on the real herd; the real farm's pilot list is not chosen; `REGISTRY_BREEDING` is not turned on for the real registry; the Herd figures layout was checked at desktop width only; "Confirmed by day 60" and the By animal "Confirmed" column count held cases only, so a pregnancy confirmed and then lost (Heer) shows a dash there.

## Breeding stage 3

Run on 17 November 2026 against branch `breeding` at `07b15ee`, Node 22.22.3.

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular`) | 686 passed in 68 files. The timing-flaky `farm-monitor.spec.ts` test ("brings the linked event into view without CSS.escape", untouched by this branch) did not fail in this run; it failed in some task runs and passed alone each time. |
| Server tests (`npm test -w server`) | 931 passed, 0 failed |
| `check:docs`, `build:shared`, `check:templates`, typecheck | Pass (docs: 76 files, 0 errors; templates: 105 files) |
| Production build | Builds, with the same warnings as stage 2 (initial bundle 712.98 kB against the 500 kB budget, four component stylesheets over 4 kB, two unused imports, the shared CommonJS notice) |

- **Browser walk, harness only** (sample herd, pilot `BD-0007, BD-0009`, farm date 17 November 2026):
  - Heer (BD-0007): a heat (standing, no time) on 16 November, then an AI on 17 November saved with no warning: a heat the day before counts when a time is missing.
  - Shehzadi (BD-0009): an AI on 17 November with no heat showed the no-heat-sign sentence once, with focus on it; Save over this check wrote it, and the Timeline shows "Written over the no_heat_sign check". A second AI the same day showed both the earlier-service sentence and the no-heat-sign sentence and the button `Save over these checks`; it wrote one event, and the Timeline shows "Written over the ambiguous_service and no_heat_sign checks".
  - Herd › Breeding: To do listed 8 past their limit and 4 due now with Overdue and Due pills, each with its day and its red day; Bulbul's month-precision bull exposure read "Day 95 to 169" marked month. Cases listed all 11 breeding females. `Record calving` opens the calving form on the animal and `Record dry-off` opens the animal's Add an event tab.
  - Today listed the breeding tasks under "Needs you now" and "Also open"; Moti's (BD-0006) animal page listed her two overdue tasks with "Open in Breeding".
  - At 375 px the To do rows stack (animal and pill, then the task, then the action at full width) with no sideways scroll.
- **Flag off:** a harness without `--breeding` answers `GET /api/registry/breeding/board` with 404, `/today` has no `breeding` key, the animal response has only `animal`, `status` and `events` (each event carries `override_checks` and `override_reason`), and the nav has no Breeding item.
- **Migration 12 rehearsal:** `npm run registry:backup` was not run, because on this branch it would migrate the real database (it loads `db.ts`, which applies pending migrations); the owner chose a plain file copy instead. `server/dairy.db` was copied byte for byte outside the repository (same SHA-256 as the original) and only the copy was migrated and verified: version 11 to 12, one migration applied, events 0 before and 0 after, 0 violations. The real file's timestamp is unchanged (16 November, 21:02). The nightly backup job was unloaded on 17 November at the owner's request, so it cannot migrate the real database while this branch is checked out.
- **Not checked:** no owner walkthrough on the real herd; the real farm's pilot list is not chosen; `REGISTRY_BREEDING` is not turned on for the real registry; the panel heading keeps the button's name ("Record heat") after the kind is changed inside the form.

## Breeding stage 2

Run on 17 November 2026 against branch `breeding` at `cac82ff`, Node 22.22.3.

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular`) | 650 passed in 67 files. One earlier full run failed one test, `farm-monitor.spec.ts` "brings the linked event into view without CSS.escape" (a `setTimeout(0)` scroll check this branch does not touch). It failed in 2 of 4 full runs and passed 3 of 3 runs on its own: a timing flake that predates this branch. |
| Server tests (`npm test -w server`) | 873 passed, 0 failed |
| `check:docs`, `build:shared`, `check:templates`, typecheck | Pass (docs: 75 files, 0 errors) |
| Production build | Builds, with the same warnings as stage 1 (initial bundle 712.23 kB against the 500 kB budget, four component stylesheets over 4 kB, two unused imports, the shared CommonJS notice) |

- **Browser walk, harness only:** on the harness sample herd with the pilot `BD-0007, BD-0009`. Shehzadi (BD-0009): an AI service saved from the Breeding tab, and the badge changed from Open to Bred. Heer (BD-0007): a check by hand, Pregnant, dated 13 Nov 2026 showed "A check by hand is not relied on before day 46. This one is on day 35."; Save over this check wrote it, and the Timeline then showed "Written over the early_check check — no reason recorded". Moti (BD-0006): the tab showed the pregnancy and "Breeding entry is open only for the animals in the pilot.", with no form.
- **Timeline override line:** the walk found that the animal response never carried `override_check` or `override_reason`, so the Timeline's "Written over" line had never shown, for calving overrides either (the same on `main`). Fixed on this branch: every event in the animal response now carries both fields, flag on or off.
- **Flag off:** a harness without `--breeding` answers `POST /api/registry/breeding/events` with 404, and the animal response has only `animal`, `status` and `events`.
- **Migration 11 rehearsal:** a backup taken on 17 November was copied outside the repository and migrated and verified there. The copy was already at version 11, so nothing was applied: version 11 to 11, events 0 to 0, 0 violations. The real database had already been migrated from 9 to 11 on 16 November at 21:02 by the nightly backup job, which runs `registry:backup` from this checkout while `breeding` was checked out (`registry:backup` loads `db.ts`, and `db.ts` applies pending migrations). The registry's record tables were empty, so no record was affected; a build of `main` (target version 9) can no longer open that database until it is restored from a version-9 backup or this branch is merged.
- **Not checked:** no owner walkthrough on the real herd; the real farm's pilot list is not chosen; `REGISTRY_BREEDING` is not turned on for the real registry.

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
