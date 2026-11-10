# Acceptance status

Updated **10 November 2026**, for the source at `659dc3f` (the November section restructure, the shared selection language and the Check rework). This page holds the latest recorded results and the checks skipped by decision. It is not a claim of exhaustive platform or accessibility certification.

## Latest recorded results

Run on 10 November 2026 against `659dc3f`:

| Check | Result |
|---|---|
| Frontend tests (`npm test -w web-angular -- --watch=false`) | 621 passed in 64 files, exit 0, no unhandled errors (rerun after the Health and Monitor deferred-scroll fix) |
| Server tests (`npm test -w server`) | 793 passed, 0 failed, 0 skipped |
| Typecheck, `check:templates`, `check:contrast`, `check:docs` | Pass |
| Production build (`npm run build:angular`) | Builds. Warnings: initial bundle 712.03 kB against the 500 kB budget; four component stylesheets over the 4 kB budget (Health, Analytics, Today, life report); two unused-import notices (`Card` in HealthPage, `IdentifierLink` in PeopleList); the shared CommonJS notice. |

Each restructured section was also clicked through in Chrome at laptop and phone widths, in light and dark. The Impeccable design detector found nothing on Check at 1280, 1440 and 390 px; older nested-card findings remain on the milking sheet's withdrawal box and session toggle. Live assistant runs were not part of this work; assistant-facing server text was deliberately left unchanged.

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
