# Signup and login — brainstorming handoff

> **Historical handoff, superseded as the active task.** Later farm/feed decisions
> retained a local single-operator application and explicitly deferred authentication,
> tenancy and billing. No authentication design was approved or implemented. Do not
> restart this brainstorm without a new user request. The application snapshot and
> verification figures below describe the pre-feed baseline; current feed behavior
> is in [REGISTRY_FEED.md](REGISTRY_FEED.md).

Status at the time of this handoff: planning only. The user wants to brainstorm signup and login before implementation. No authentication design has been approved. Baseline: `e7fc20e` on `main`, pushed to origin on 2026-09-09.

## User intent

Design how signup and login should look and work in Dairy 360. Start with the product model and access boundaries, then choose the implementation. Do not begin coding or install an identity provider until the user asks for implementation.

The first question is whether this is one farm inviting its staff, or a product where anyone can sign up and create a separate farm. That decision affects onboarding, memberships, data isolation and account recovery; it cannot be inferred from a request for login screens.

## Current application

- Repository: `/Users/adnanali/personal/dairy-360`. Angular 22, standalone components, signals, zoneless change detection; Express and TypeScript backend; SQLite through `better-sqlite3`.
- UI phase 7 is built: Today, Herd, Milk, Labour and Check sections, command palette, contextual assistant, light/dark themes. All 15 routes have screenshots in `docs/images/phase7/README.md`.
- Animals, milk sales and labour are separate domain areas. Payroll contains salary, benefit and payment information.
- Registry animal events are append-only. Corrections append superseding events; other domains have their own update and idempotency rules. Read the domain documents before extending them.
- The agent uses AG-UI/SSE at `/api/agent/run`. Registry agent tools are read-only for herd and milk sales. There are no payroll agent tools. Demo write tools remain confirmation-gated, but lack cross-request replay protection.
- The fixture harness is a separate in-memory server, with no agent responses. It must remain distinguishable from persistent storage. Never seed the live database for UI testing.

## Authentication is currently absent

`server/src/index.ts` mounts the registry and webhook routers without user authentication and uses `cors()` without an explicit origin allowlist. The code was designed for a local single-operator application. Do not describe it as ready for public hosting merely because login pages exist.

The Angular `registry/session.ts` service is **recording provenance, not authentication**. It holds `sourceForm` and a freely entered `recordedBy` string; it intentionally resets on reload. Reads need no recording session today, and writes require provenance. This says nothing about who is authorized to read or write.

Keep these concepts separate in the design:

- authenticated actor: the account making a request;
- farm membership and permission: what that actor may access;
- source of knowledge: recall, paper sheet, cycle card, direct entry, import;
- `observed_by`: an optional witness, not automatically the signed-in person;
- historical `recorded_by`: existing attribution must not be silently rewritten into an account identity.

An account is also not automatically a payroll person. Staff records can exist without login access, and users such as owners or accountants may need access without being employees.

## Decisions to brainstorm

1. One farm with invitations, or public signup with farm creation? Are multiple farms a requirement now?
2. Who uses the app: owner, manager, recorder, accountant, read-only visitor? Which operations and payroll details should each see?
3. Shared laptop or personal devices? Session duration, account switching and unfinished forms need deliberate behavior.
4. Email, phone, or another identifier? Passwords, one-time links/codes, or a managed identity service? Choose based on actual access, hosting and recovery needs.
5. What does signup create: account only, first owner and farm, or acceptance of an existing invitation?
6. How are existing records attached to the first farm, and how are old provenance strings related to accounts without changing historical assertions?
7. What happens when membership is revoked or a session expires during entry or an agent turn?

## Candidate UX to discuss, not an approved design

Use the existing neutral visual system, compact forms, explicit labels and both themes. Reuse primitives rather than introducing a separate visual language.

Potential flow: sign in → establish membership or accept invitation → Today. First-owner setup and invited-member onboarding should have distinct copy and requirements. Account recovery, expired invitations, sign-out and expired sessions are part of the feature, not follow-up polish.

Account identity belongs in the header, separate from recording-source controls and the storage chip. Decide whether the recorder field becomes server-derived, mapped, or separately retained; do not quietly default source or witness information.

## Implementation subjects for the eventual design

Verify current primary documentation before recommending specific libraries or identity services. Compare managed identity against application-owned authentication in the context of hosting and maintenance constraints.

Cover server enforcement on every applicable API, cookie/session or token lifecycle, request protections, recovery and verification, login abuse controls, migration/bootstrap, and permission tests. Angular route guards are a UX layer, not the authorization boundary. Webhook producers need their own authentication story. If farm tenancy is selected, scope both reads and writes, including agent tools and history, on the server.

Do not treat these as authorization to implement or as a preselected architecture.

## Existing constraints and evidence

- The real five-animal entry trial has not run. Phase 7 was explicitly authorized before it; `UI_SYSTEM.md §3.4` records the fourth contamination. Further changes to entry behavior must be documented honestly.
- The user explicitly held the resting `--border-default` token. Do not change it as incidental auth work.
- Keep field-order/date-precision and write-log decisions intact unless revisited explicitly.
- Baseline verification: 339 frontend tests in 32 files, 726 server tests, typecheck, template checks and build passed. Thirty contrast failures remain; the initial bundle is 584.58 kB against a 500 kB warning budget.
- A documentation sweep corrected stale UI claims and distinguished historical records from current references. Preserve that distinction.

## Read first

- [UI_SYSTEM.md](UI_SYSTEM.md): current UI and unresolved questions.
- [Screen gallery](images/phase7/README.md): all routes and representative overlays.
- [DEVELOPMENT.md](DEVELOPMENT.md): local setup, harness isolation and testing.
- [REGISTRY.md](REGISTRY.md), [REGISTRY_ENTRY_UX.md](REGISTRY_ENTRY_UX.md): provenance and entry rules.
- [REGISTRY_PAYROLL.md](REGISTRY_PAYROLL.md): sensitive labour data and the deferred agent-access question.
- [TECHNICAL.md](TECHNICAL.md): agent request lifecycle and approval limits.
- [OPEN.md](OPEN.md): outstanding work.

Start the conversation with a small number of product questions, led by single-farm invitations versus public signup. Explain the tradeoffs in plain language, then work toward a concrete proposal the user can review.
