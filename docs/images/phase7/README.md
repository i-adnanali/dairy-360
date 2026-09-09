# Application screenshot gallery

All 15 application routes are represented below, with one light and one dark desktop capture each. Parameterized routes use one representative fixture record. Session setup and the two shell overlays are listed separately.

Captured on 2026-09-09 from the Phase 7 production build against an isolated in-memory harness. These are 1440×900 viewport captures: long pages continue below the image, and inline editing/validation states are not an exhaustive interaction catalogue. Fixture records are not real-farm trial evidence.

| Screen | Route | Light | Dark |
|---|---|---|---|
| Today | `/` | [View](today.light.png) | [View](today.dark.png) |
| Animals | `/animals` | [View](herd.light.png) | [View](herd.dark.png) |
| Animal detail | `/animals/:id` | [View](animal-detail.light.png) | [View](animal-detail.dark.png) |
| Add animal | `/animals/new` | [View](animal-new.light.png) | [View](animal-new.dark.png) |
| Calvings | `/animals/calvings` | [View](calvings.light.png) | [View](calvings.dark.png) |
| Record calving | `/animals/calvings/new` | [View](calving-new.light.png) | [View](calving-new.dark.png) |
| Milking | `/milk/milking` | [View](milking.light.png) | [View](milking.dark.png) |
| Dispatch | `/milk/dispatch` | [View](dispatch.light.png) | [View](dispatch.dark.png) |
| Buyers | `/milk/buyers` | [View](buyers.light.png) | [View](buyers.dark.png) |
| Buyer detail | `/milk/buyers/:id` | [View](buyer-detail.light.png) | [View](buyer-detail.dark.png) |
| People | `/labour/people` | [View](people.light.png) | [View](people.dark.png) |
| Person detail | `/labour/people/:id` | [View](person-detail.light.png) | [View](person-detail.dark.png) |
| Payroll | `/labour/payroll` | [View](payroll.light.png) | [View](payroll.dark.png) |
| Check | `/check` | [View](check.light.png) | [View](check.dark.png) |
| Standalone assistant | `/chat` | [View](chat.light.png) | [View](chat.dark.png) |
| Recording session setup | `Shell state` | [View](session-setup.light.png) | [View](session-setup.dark.png) |
| Command palette | `Shell overlay` | [View](palette.light.png) | [View](palette.dark.png) |
| Contextual assistant | `Shell overlay` | [View](assistant-panel.light.png) | [View](assistant-panel.dark.png) |

## Representative checks

Mobile captures use 390×844. Grayscale images are desaturated copies of the saved calvings screenshots, selected to compare exact/approximate dates and effective/superseded badges; they are not a separate live `--grey` run.

- [Mobile table](herd-mobile.dark.png)
- [Mobile session form](session-setup-mobile.light.png)
- [Mobile palette](palette-mobile.dark.png)
- Calving states in grayscale: [light](calvings.light.grey.png), [dark](calvings.dark.grey.png)
