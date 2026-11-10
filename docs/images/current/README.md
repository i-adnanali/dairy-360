# Screenshot gallery

Captured **10 November 2026** from the production build of the source at the commit recorded in [manifest.json](manifest.json), after the November restructure of every section, the shared selection language and the Check rework. All records are synthetic, from the memory-only harness; nothing was saved.

| Image | Route / state | Theme | Viewport |
|---|---|---|---|
| [Today](today-light.jpg) | `/`, the work board with nothing being recorded | Light | 1440×1000 |
| [Milking](milking-light.jpg) | `/milk/milking` while recording: three answered, three still amber, unsaved | Light | 1440×1000 |
| [Check](check-light.jpg) | `/check` after a completed check | Light | 1440×1000 |
| [Analytics](analytics-dark.jpg) | `/analytics`, the current week, both sessions | Dark | 1440×1000 |
| [Herd](herd-dark.jpg) | `/animals`, on the farm, sorted by serial | Dark | 1440×1000 |
| [Health](health-mobile-light.jpg) | `/animals/health`, To do | Light | 390×844 |
| [Today, phone](today-mobile-dark.jpg) | `/` at phone width | Dark | 390×844 |

Each image has a sibling JSON with its URL, accessibility snapshot and geometry; the manifest records the source commit, loaded bundle and image hashes, and `npm run check:docs` verifies them. The phone captures are a narrow desktop browser, not native-device acceptance. Long pages continue below the viewport.

## Refresh

1. `npm run harness:app` (registry on 6400), then `npm run build:angular` and `npm run harness:serve` (production build on 6430).
2. Capture each route above at its theme and viewport after the page settles, at device scale 1, as JPEG. For the milking image, start recording (adnan, Direct entry), type a litre figure for the first animal, then `m` and `n` for the next two, and scroll the sheet to its heading.
3. Write each image's JSON (`url`, `snapshot`, `geometry`) and update `manifest.json` with the new commit and SHA-256 hashes. Fixture dates follow farm today, so dates in the images change between refreshes.

Screenshots document appearance only; [acceptance status](../../reference/ui/acceptance-status.md) records behavioral checks.
