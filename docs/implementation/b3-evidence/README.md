# B3 verification evidence

Application baseline `450045c`; final B3 source is identified by `SOURCE_SHA256.txt`. Browser and test runs were performed on 2026-09-23; handoff documentation finalized 2026-09-25. The browser version was not exposed by the supported in-app browser API.

## Isolation and reproduction

API **6470** was a fresh registry harness, explicitly reporting `:memory:`. Production UI **6472** proxied to it. The existing B2 `fixture-clock.mjs` froze backend and seed processes at 2026-09-17T12:00Z; the frontend used its real clock. Health/Milking historical contexts were explicitly selected. Only synthetic data was seeded; browser checks did not submit record writes.

`large-fixture.mjs` is a verification-only read adapter on **6473**, refusing non-GET requests and checking that its upstream is the memory harness. UI **6474** displayed its 101-row Milking/Dispatch/Payroll payloads, including long names/identifiers. These are presentation fixtures, not new farm records. Cloned Milking row identifiers differ from the original synthetic withdrawal source identifiers retained in the adapter; screenshots test layout, not associations in a real roster. Health uses the unchanged harness response.

To reproduce with Node 22.22.3: build the app; start `npm run registry:harness -w server -- --port=6470 --empty` with the B2 clock preloader in `NODE_OPTIONS`; run `scripts/harness-seed.mjs` with the same preloader and `HARNESS_URL=http://localhost:6470`; serve the production build with `scripts/serve-built.mjs --port=6472 --api=http://localhost:6470`. Start this directory's `large-fixture.mjs`, then serve the same build on 6474 with API origin 6473. Processes may no longer be running. Never point the seed/adapter at farm storage.

## Results

- `measurements.json`: 40 final renders, four workflows × five widths × two themes. All document widths equal viewport widths; writable fields fit horizontally and field data-role hooks are unique. This checks rendered geometry, not native screen-reader behavior.
- `keyboard-and-actions.txt`: raw draft/focus retention, shortcuts, first-unanswered page jumps, reduced-height entry, Health actions and shell ownership checks.
- `frontend-tests.txt`, `server-tests.txt`, `build.txt`, `typecheck.txt`, `templates.txt`, `contrast.txt`: final passing command outputs and held warnings.
- `protected-constraints.txt`: comparison against B2's protected fields, tokens and write helpers.
- `seed.txt`: synthetic seed and storage confirmation.

## Captures

| Workflow | Desktop | Mobile |
|---|---|---|
| Milking | [Light](milking-desktop-light.png) | [Dark](milking-mobile-dark.png) |
| Dispatch | [Dark](dispatch-desktop-dark.png) | [Light](dispatch-mobile-light.png) |
| Payroll | [Light](payroll-desktop-light.png) | [Dark](payroll-mobile-dark.png) |
| Health | [Dark](health-desktop-dark.png) | [Light](health-mobile-light.png) |

The matrix measures both themes at every requested width; representative screenshots show opposite themes at desktop/mobile. Captures are viewport images rather than unreliable full-page stitching. Mobile entry captures are scrolled to controls. No operator performance, native mobile keyboard, actual browser zoom, screen-reader conformance, print/PDF completeness or live assistant behavior is claimed.
