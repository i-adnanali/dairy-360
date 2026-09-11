# Dairy 360 Angular frontend

Current frontend: Angular 22, standalone components, signals and zoneless change
detection. It includes the animal, milk, feed and labour registry, plus the assistant.

Run the commands below from the **repository root**, using the Node version in
[`.nvmrc`](../.nvmrc). Install dependencies once with `npm install`.

## Run locally

```bash
npm run harness:app   # in-memory fixture registry + Angular, no API key needed
```

Open `http://localhost:6420/`. To use the persistent server and agent instead,
follow [DEVELOPMENT.md](../docs/DEVELOPMENT.md); `npm run dev:angular` starts that
pair. The fixture harness does not provide agent responses.

## Build and verify

```bash
npm run build:angular
npm test -w web-angular
npm run check:templates
npm run check:contrast
```

Build output is `web-angular/dist/web-angular/browser`. Contrast currently runs
in report mode and includes documented failures; exit success is not an AA pass.
No `ng e2e` target is configured. Browser capture tooling and its limits are
covered in [UI_SYSTEM.md](../docs/UI_SYSTEM.md).

## Read next

- [UI system](../docs/UI_SYSTEM.md): shell, primitives, certainty, themes and verification.
- [Phase 7 gallery](../docs/images/phase7/README.md): historical routes and shell states.
- [Feed gallery](../docs/images/feed/README.md): new feed routes, updated Today and mobile checks.
- [Feed implementation](../docs/REGISTRY_FEED.md): daily entry, purchases, crops and corrections.
- [Angular port](../docs/ANGULAR_PORT.md): chat state and component architecture.
- [Entry UX](../docs/REGISTRY_ENTRY_UX.md): form behavior and the outstanding farm trial.
