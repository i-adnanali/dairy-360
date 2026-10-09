# README screenshot gallery — 1 October 2026

Captured **1 October 2026** from the production build of **`a56400a`**. At capture time, the application source matched the [screen-specific source manifest](../../implementation/geist-screen-evidence/SOURCE_SHA256.txt). [Capture manifest](manifest.json) records the commit, loaded bundle, routes, dimensions and image hashes.

| Image | Route / state | Theme | Viewport |
|---|---|---|---|
| [Today](today-light.jpg) | `/`, seeded work board | Light | 1440×1000 |
| [Analytics](analytics-dark.jpg) | `/analytics`, September 2026 monthly review, all sessions | Dark | 1440×1000 |
| [Health](health-mobile-light.jpg) | `/animals/health`, task board | Light | 390×844 |

These are unedited browser screenshots from the stated baseline, predating the Angular remediation through `cb94fe9`. They are not captures of the latest source. The narrow viewport was a desktop-browser capture, not native-mobile acceptance. Each has a sibling JSON rendered snapshot and geometry record. No document-level horizontal overflow was observed. Long pages continue below the viewport.

The built frontend at `localhost:6512` used the existing synthetic memory-only registry harness on 6510. This capture pass browsed only; it did not write records or open a farm database. The existing fixture includes disposable records from the preceding UI validation. Screenshots show the browsing state, and clinical examples are synthetic.

To reproduce against disposable data, build the app, start `npm run registry:harness -w server -- --port=6510`, then `npm run harness:serve -- --port=6512 --api=http://localhost:6510`. Open the routes above, choose the stated themes/viewports, and capture after the page settles. Fixture dates follow farm today, so future values and date labels will differ. Update this manifest when refreshing the README images.

This gallery documents appearance only. The [acceptance status](../../reference/ui/acceptance-status.md) separately records later tests and skipped checks. Historical [Phase 7](../phase7/README.md), [Feed](../feed/README.md) and [analytics](../analytics/README.md) galleries retain their original evidence.

Documentation was reorganized on 2 October 2026. These captures retain their original 1 October source/bundle provenance; later behavior/style fixes are described in the [remediation ledger](../../implementation/angular-remediation-2026-10-02.md). The files and capture manifest retain their original provenance. Current presentation contracts are in [the UI reference](../../reference/ui/design-system.md).
