# Local development

Use this guide to install, run and troubleshoot the app. Commands run from the repository root unless stated otherwise. [Architecture](../architecture/system.md) explains data boundaries; [testing](testing.md), [registry CLI](registry-cli.md) and [backup/restore](backup-restore.md) own their procedures.

## Prerequisites and installation

Install Git and nvm, then use the Node version pinned by `.nvmrc` (currently 22.22.3). Run:

```bash
nvm install
nvm use
npm ci
npm run build:shared
```

Expected result: workspace dependencies and `shared/dist` are available. A Node ABI error from SQLite usually means dependencies were installed under another Node version; switch to the pin and reinstall. A missing `@dairy/shared` build requires `build:shared` before running workspace commands directly.

## Run with disposable records

```bash
npm run harness:app
```

Open http://localhost:6420. The registry backend uses in-memory data on port 6400. Fixture writes disappear when the process stops. No farm database or API key is needed. The assistant is not served by this registry-only harness. Stop with Ctrl+C.

For larger analytics fixtures, stop the first harness and run:

```bash
npm run harness:analytics
```

Open `/analytics`. Both commands share ports with the persistent app and cannot run simultaneously on their default ports. [Testing](testing.md) documents independent harness/build ports.

## Run the persistent app

```bash
cp .env.example server/.env
# Set ANTHROPIC_API_KEY for assistant calls.
# Leave Langfuse keys empty unless tracing is configured.
npm run dev:angular
```

This opens `server/dairy.db` and starts the Angular dev server. Confirm the storage target before recording data. Browsing needs no recording session; writes require recorder/source. Never use persistent storage for UI fixtures.

If you explicitly need assistant demo data, `npm run seed -w server` resets the demo tables and preserves registry records. It does not load a registry fixture. Do not mistake `seed`, `harness:app` and `dev:angular` for interchangeable startup choices.

The server loads `server/.env` because npm workspace commands run in `server/`. A root `.env` is only needed for optional camera Compose settings; dotenv does not search parent directories. See [observability](observability.md) and [camera operations](camera-operations.md).

## Build and serve the production frontend

```bash
npm run build:angular
```

Output: `web-angular/dist/web-angular/browser`. The root command builds shared types first. To inspect that bundle against disposable data, use two terminals:

```bash
npm run registry:harness -w server -- --port=6510
```

```bash
npm run harness:serve -- --port=6512 --api=http://localhost:6510
```

Open http://localhost:6512. Rebuild after source changes before treating captures as current. `harness:serve` serves static output; it does not compile changed source. Record the source baseline and loaded bundle with screenshots.

## Troubleshooting

| Symptom | Check / recovery |
|---|---|
| Frontend rejects Node while server tests run | `nvm use`; the Angular CLI enforces its own Node floor |
| Port already in use | Stop the other harness/persistent process or choose explicit matching ports |
| Angular dependency-cache errors after dependency changes | Stop dev server; `npm run clean:web-deps-cache`; restart |
| macOS cache-enabled production build aborts in the native LMDB addon | The recorded workaround is `CI=true NG_BUILD_MAX_WORKERS=1 npm run build:angular`; see the [investigation](../implementation/angular-remediation-2026-10-02.md#production-build-abort-investigation). This bypasses the local Angular cache; it does not repair the addon |
| Missing shared exports | `npm run build:shared` before running an individual workspace |
| Assistant unavailable in harness | Expected: the registry fixture harness does not serve model responses |
| Assistant fails in persistent app | Check server env/credentials and the surfaced error; do not blindly replay uncertain writes |
| Wrong backup path | `--db` paths in workspace commands resolve relative to `server/` |
| Write refused | Inspect field errors, provenance, target and revision conflict; retain the draft |

## Validation and records

Use [testing](testing.md) for the verification sequence. Historical install timings, audit counts, test totals and machine-specific runtime observations are in the [development record](../records/DEVELOPMENT.md), not current environment guarantees. This guide does not assert that backup jobs or external services are running.
