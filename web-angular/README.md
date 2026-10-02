# Dairy 360 Angular frontend

Current frontend: Angular 22, standalone components, signals and zoneless change
detection. It includes the animal, health, milk, feed and labour registry, the analytics dashboard, and the assistant.

Run the commands below from the **repository root**, using the Node version in
[`.nvmrc`](../.nvmrc). Install dependencies once with `npm ci`.

## Run locally

```bash
npm run harness:app   # in-memory fixture registry + Angular, no API key needed
```

Open `http://localhost:6420/`. To use the persistent server and agent instead,
follow [DEVELOPMENT.md](../docs/guides/development.md); `npm run dev:angular` starts that
pair. The fixture harness does not provide agent responses.

## Build and verify

```bash
npm run build:angular
npm test -w web-angular -- --watch=false
npm run check:docs
npm run check:templates
npm run check:contrast
```

Build output is `web-angular/dist/web-angular/browser`. The contrast gate fails on unexpected failures and unreviewed disabled-text consumers. Dated results are in [acceptance evidence](../docs/implementation/geist-screen-evidence/ACCEPTANCE.md). This token/consumer check is not full accessibility certification.
No `ng e2e` target is configured. Browser capture tooling and its limits are
covered in [testing guide](../docs/guides/testing.md).

## Read next

- [Current UI reference](../docs/reference/ui/design-system.md): current contracts and state specimen.
- [Application interactions](../docs/reference/ui/application-interactions.md): navigation, drafts and recovery.
- [Current gallery](../docs/images/current/README.md): fresh screenshots of `a56400a`.
- [Screen-specific acceptance](../docs/implementation/geist-screen-evidence/ACCEPTANCE.md): dated test results, changed-workflow browser evidence and remaining gates.
- [Phase 7 gallery](../docs/images/phase7/README.md): historical routes and shell states.
- [Feed gallery](../docs/images/feed/README.md): historical September feed/Today captures and mobile checks.
- [Feed implementation](../docs/reference/registry/feed.md): daily entry, purchases, crops and corrections.
- [Frontend architecture](../docs/architecture/frontend.md): chat state and component architecture.
- [Entry UX](../docs/reference/ui/application-interactions.md): form behavior and the outstanding farm trial.

Health entry and due work live at `/animals/health` within Herd. Animal profiles
link to `/animals/:id/report` for the life report and vaccination card. Report
sections use local pagination (25/50/100 rows); JSON export and browser print include all loaded
records. See [Health implementation](../docs/reference/registry/health.md).

The standard harness seeds these health screens as well: due work, visits, doses,
round outcomes, follow-up results and vaccination-card history are ready to browse.

## Analytics dashboard and demo data

Run `npm run harness:analytics` from the repository root, then open
`http://localhost:6420/analytics`. This starts an isolated in-memory backend on
6400 and Angular on 6420; stop `dev` or `harness:app` first because they share
those ports. No API key is needed, and fixture writes are discarded on exit.

The dedicated scenario has 30 milked dams plus 30 calves, two milk destinations,
three completed calendar months and the current month through farm today.
It exercises comparisons, 25-row pagination, missing and pending sessions,
unmeasured and not-milked answers, explicit zero yield, home use, and positive
and negative production-minus-dispatch differences. The CLI prints scenario dates.
The regular `harness:app` remains the broader animal/feed/health/labour walkthrough.

See [analytics specification](../docs/reference/registry/analytics.md) for formulas, coverage, API contracts,
implementation limits and the scenario review checklist. Analytics and main lists
use server pagination; composite histories and editable session sheets page their
already-loaded data. Analytics exports and scheduled reporting are future work.

[Analytics screen gallery](../docs/images/analytics/README.md): daily, weekly and monthly reviews,
light/dark themes, production pagination, reconciliation and mobile captures
from the dedicated fixture harness (2026-09-16).

## Screen-specific audit delivery — 1 October 2026

Commit `a56400a` completes People/Feed task and form/table improvements, precision-aware animal history and correction comparisons, operational continuation/draft context, Health exception groups, analytics inspector synchronization, assistant outcome receipts and unknown-route recovery. Native controls, domain calculations, API contracts, snapshots, historical rates, guards and exact-request retries are preserved. See the [reconciliation ledger](../docs/implementation/GEIST-IMPLEMENTATION.md). The separate native/device/operator and exhaustive fault-injection gates remain open.
