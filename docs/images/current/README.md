# Current application screenshots

Captured **1 October 2026** from the production build of **`a56400a`**. The current application source matched the [screen-specific source manifest](../../implementation/geist-screen-evidence/SOURCE_SHA256.txt). [Capture manifest](manifest.json) records the commit, loaded bundle, routes, dimensions and image hashes.

| Image | Route / state | Theme | Viewport |
|---|---|---|---|
| [Today](today-light.jpg) | `/`, seeded work board | Light | 1440×1000 |
| [Analytics](analytics-dark.jpg) | `/analytics`, September 2026 monthly review, all sessions | Dark | 1440×1000 |
| [Health](health-mobile-light.jpg) | `/animals/health`, task board | Light | 390×844 |

These are fresh, unedited browser screenshots, not reused September galleries or mockups. Each has a sibling JSON rendered snapshot and geometry record. No document-level horizontal overflow was observed. Long pages continue below the viewport.

The built frontend at `localhost:6512` used the existing synthetic memory-only registry harness on 6510. This capture pass browsed only; it did not write records or open a farm database. The existing fixture includes disposable records from the preceding UI validation. Screenshots show the browsing state, and clinical examples are synthetic.

To reproduce against disposable data, build the app, start `npm run registry:harness -w server -- --port=6510`, then `npm run harness:serve -- --port=6512 --api=http://localhost:6510`. Open the routes above, choose the stated themes/viewports, and capture after the page settles. Fixture dates follow farm today, so future values and date labels will differ. Update this manifest when refreshing the README images.

This gallery documents appearance only. It does not close the [deferred acceptance gates](../../implementation/geist-screen-evidence/ACCEPTANCE.md#remaining-acceptance--explicitly-open). Historical [Phase 7](../phase7/README.md), [Feed](../feed/README.md) and [analytics](../analytics/README.md) galleries retain their original evidence.
