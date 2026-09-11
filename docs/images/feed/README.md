# Feed screenshot gallery

Captured 2026-09-10 from the production build on port 4310, backed by the isolated in-memory harness on 4110. Desktop captures are 1440×900; mobile captures are 390×844. Long pages continue below the viewport. These are fixture records and disposable browser entries, not real farm trial evidence. The [Phase 7 gallery](../phase7/README.md) remains the historical baseline.

| Screen | Route | Capture |
|---|---|---|
| Feed overview | `/feed` | [Light](overview.light.png), [dark](overview.dark.png) |
| Crops | `/feed/crops` | [Light](crops.light.png) |
| Add crop | `/feed/crops/new` | [Light, keyboard focus](crop-new.light.png) |
| Crop detail and expenses | `/feed/crops/:id` | [Light](crop-detail.light.png), [dark](crop-detail.dark.png) |
| Purchases | `/feed/purchases` | [Light](purchases.light.png) |
| Add purchase | `/feed/purchases/new` | [Light](purchase-new.light.png), [mobile](purchase-new.mobile.light.png) |
| Purchase detail | `/feed/purchases/:id` | [Light](purchase-detail.light.png) |
| Daily history | `/feed/daily` | [Recorded, partial, missing](history.light.png) |
| Daily review | `/feed/daily/:on` | [Light](daily-review.light.png), [dark](daily-review.dark.png), [mobile dark](daily-review.mobile.dark.png) |
| Today after correction | `/` | [Light](today.light.png) |

## Interaction checks

- Added an already-cutting crop with unknown dates/acreage, preserved its draft through provenance setup, and added an irrigation expense. Keyboard Tab moves from crop name to plot with the existing visible focus ring; cancelling new crop entry returns to the list.
- Saved a nested 400 kg silage purchase at Rs 2,000 per 40 kg plus Rs 100 transport. The daily notes and shortfall assessment remained, no feeding line was added implicitly, and cancelling the daily draft left the purchase reviewable at Rs 20,100.
- Corrected the fixture's daily account, reviewed it, saved and returned to Today. Its feed row reports the saved state; confirmed milking recipients and water-mixed khall remain intact.
- Extended history to include one missing day; it remains distinct from a partial account and a recorded account. The overview's mixed source count is not added twice to recorded days.
- Narrow review and purchase forms report document width 390px at a 390px viewport. Source and recipient text wraps; quantity uncertainty and coverage use words.
- The existing compact shell form width is applied to new feed entry routes and daily review. No new colour/border tokens were introduced.

The [implementation record](../../REGISTRY_FEED.md) lists automated validation, limitations, and the legacy CLI-import incident discovered during database preservation checks.
