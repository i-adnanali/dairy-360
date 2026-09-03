# Local Setup, Build, Test & Run

*Every command below was run on 2026-09-03 against commit `a6c4842` on macOS
(darwin 25.3.0), node 22.22.3, npm 10.9.8. The fresh-clone section was verified
in an actual throwaway clone, not reasoned about. Four things could not be run
here and are marked **UNVERIFIED** where they appear — there is no other kind of
claim in this document.*

Checked against `package.json` (root, `server/`, `web-angular/`, `shared/`),
`.nvmrc`, `web-angular/proxy.conf.json` and `web-angular/angular.json`. Where
this document and those files disagree, they are right and this is stale.

---

## 1. Prerequisites — do this first

**Node `22.22.3`**, pinned in [`.nvmrc`](../.nvmrc).

```bash
nvm use            # or: nvm install
node -v            # -> v22.22.3
npm -v             # -> 10.9.8
```

**Why it is pinned, and what ignores it.** `@angular/core` 22.0.5 declares
`engines.node: ^22.22.3 || ^24.15.0 || >=26.0.0`, and the Angular CLI *enforces*
it — below the floor, `ng serve`, `ng build` and `ng test` all refuse before
doing any work:

```
Node.js version v22.3.0 detected.
The Angular CLI requires a minimum Node.js version of v22.22.3 or v24.15.0 or v26.0.0.
npm error code 3
```

It is an **Angular CLI floor, not a repo-wide one.** Measured under node 22.3.0:
`npm test -w server` still passes in full, and the server itself runs. So a
too-old node produces a confusing split — the backend works, the frontend will
not start, and `npm test -w web-angular` refuses before running a single spec.
A green server suite next to a frontend suite that never executed reads exactly
like the regression-skip trap in § 5. Run `nvm use` first and the question never
arises.

npm 10.9.8 ships with that node. Any npm 7+ works; the repo only needs
workspace support.

---

## 2. Install

One install at the repo root. It is an npm-workspaces monorepo (`shared`,
`server`, `web-angular`), so **do not** install per package.

```bash
npm install
```

Took **8.7 s** in a fresh clone: `better-sqlite3` resolved a prebuilt binary for
this platform rather than compiling. On a platform with no prebuild it compiles
the native binding, which is slower. `npm install` reports 19 known
vulnerabilities in the dependency tree (3 low, 6 moderate, 10 high) — this is a
local single-operator demo, and none is addressed here.

### Then build `shared/` — the step that is easy to skip

```bash
npm run build:shared
```

**Required before any server command.** `server/src/db.ts` imports `@dairy/shared`
at runtime, and the package resolves to `shared/dist/`, which does not exist in a
fresh clone. Skipping it fails like this:

```
Error: Cannot find module '.../node_modules/@dairy/shared/dist/types.js'
```

`npm run dev:angular` and `npm run typecheck` already chain `build:shared`.
**`npm run dev -w server` does not** — that is the one entry point where you have
to have built it yourself.

---

## 3. Configure — two `.env` files, not one

```bash
cp .env.example server/.env    # the SERVER reads this one
cp .env.example .env           # docker compose reads this one
# then put your key in server/.env:  ANTHROPIC_API_KEY=sk-ant-...
```

**Copying it to the repo root only leaves the server keyless.** `dotenv/config`
resolves `.env` against the **current working directory** and does not search
parent directories (measured: a parent `.env` is invisible from a subdirectory).
Every server command runs with cwd = `server/` — `npm run dev -w server`, and
every `registry:*` and `verify:*` script. So a root-only `.env` yields a server
that starts fine and reports `anthropicKey: false`.

The file nonetheless lives at the root because **docker compose** auto-loads
`.env` from beside the compose file, and
[`docker-compose.frigate.yml`](../docker-compose.frigate.yml) interpolates
`FRIGATE_CAM_*` from it with `${VAR:?}` fail-fast. Moving it into `server/` would
break the camera stack. Both paths are gitignored; the header of
[`.env.example`](../.env.example) says the same thing.

No key is needed for anything in this document except the agent chat and the
regression suite. The registry, the seed, both test suites and every build work
without one.

---

## 4. Build

```bash
npm run typecheck            # shared + server, tsc --noEmit
npm run build -w server      # tsc emit -> server/dist/ (gitignored)
npm run build:angular        # build:shared + ng build -> web-angular/dist/
```

All three ran clean. How to tell each worked:

| Command | Success looks like |
|---|---|
| `npm run typecheck` | no output after the two `tsc` banner lines; exit 0. Any type error prints and exits non-zero |
| `npm run build -w server` | silent, exit 0; `server/dist/index.js` exists |
| `npm run build:angular` | `Output location: .../web-angular/dist/web-angular` as the last line |

**Two warnings are expected and pre-existing** on the Angular build — do not
treat them as failures:

```
▲ [WARNING] bundle initial exceeded maximum budget. Budget 500.00 kB was not met by 11.67 kB ...
▲ [WARNING] Module '@dairy/shared' used by 'src/app/core/chat-store.ts' is not ESM
```

The budget was already exceeded by 7.57 kB before the last cycle; the CommonJS
notice is about `shared/` emitting CJS.

---

## 5. Test

```bash
npm test -w server           # 410 tests, node:test via tsx
npm test -w web-angular      # 106 tests, Vitest (jsdom) via @angular/build:unit-test
```

Both green on a fresh clone, and both need **no database file and no API key** —
the registry suites run against `new Database(':memory:')` and the suite as a
whole writes nothing to disk.

| Suite | Expected | Notes |
|---|---|---|
| `npm test -w server` | `# tests 410 / # pass 410 / # fail 0 / # skipped 0` | Enumerated dirs: `src/`, `src/farm/`, `src/registry/`, `src/tools/` |
| `npm test -w web-angular` | `Test Files 16 passed / Tests 106 passed` | Prints `Not implemented: HTMLCanvasElement's getContext()` — jsdom noise from the chart component, not a failure |

**`npm test -w web-angular` needs the node version `.nvmrc` pins** — the Angular CLI refuses below
its floor and runs nothing, so `nvm use` first. See § 1; the failure mode is a green server suite
beside a frontend suite that never executed, which deserves the same suspicion as a skipped
regression run below.

### Two spec conventions worth following

Both were established the hard way while building the registry entry surface, and both cost real
debugging time before they were written down.

**Name the date a spec typed. Never assert its pattern.** A `precision-date` bug had the control
emitting a fabricated `2026-01-01`, and the suite was green because seven form specs asserted the
*shape* of the result rather than its value:

```ts
expect(req.request.body.acquired_on).toMatch(/^\d{4}-01-01$/);   // true of ANY fabricated year
```

Those specs had entered no date at all. A pattern is right for a value the test cannot know — a
generated id, a `recorded_at` stamp. For a date the test itself supplied, it is a way of not
looking. See [REGISTRY.md](REGISTRY.md) § "The defaults rule".

**`fixture.whenStable()` is not enough for a promise chain started in a constructor.** Angular
component specs need a macrotask tick first, or the DOM has not caught up:

```ts
async function settle(fixture) {
  await new Promise((r) => setTimeout(r, 0));   // let the .then() run
  await fixture.whenStable();
  fixture.detectChanges();
}
```

`CalvingForm` requests its dam list in its constructor. With `whenStable()` alone the form still
renders its "no females in the registry yet" empty state, and every `querySelector` returns `null` —
which surfaces as `TypeError: Cannot set properties of null`, several layers away from the cause.
The helper lives in `web-angular/src/app/registry/forms.spec.ts`.

**The server suite deliberately does not glob.** `src/**/*.test.ts` is expanded by
`sh`, where `**` is not globstar, so it silently meant one level deep;
`src/testWiring.test.ts` now asserts the directory listing is complete, so a test
file placed somewhere unlisted fails loudly instead of never running. See
[REGISTRY.md](REGISTRY.md) § "How `npm test` finds these tests".

### The regression suite is env-gated, and a skip is not a pass

```bash
npm run test:regression -w server        # all three, live model, costs tokens
npm run test:regression:core -w server
npm run test:regression:cap -w server
npm run test:regression:fallback -w server
```

Gated on `RUN_REGRESSION=1` (set by the scripts themselves) **and** an
`ANTHROPIC_API_KEY`. Without a key the whole `describe` skips — its seeding hooks
never run. Measured, with no key present:

```
ok 1 - regression suite (live model) # SKIP ANTHROPIC_API_KEY not set — live regression suite skipped
# tests 0
# pass 0
# fail 0
```

**Exit code 0.** Read that carefully: `ok`, nothing failed, and *nothing ran*.
Ten scenarios did not execute. Never record a skipped regression run as a pass —
check `# tests` is 12, not just that the command succeeded.

**Not run here**, deliberately: the live suite makes real API calls against the
configured model, and its `beforeEach(seed)` re-seeds `dairy.db`. **UNVERIFIED:**
the 12/12 live result. The last recorded clean pass is at `v0.6.0`
([REGRESSION.md](REGRESSION.md) § 04-verification).

---

## 6. Running it — two loops, and knowing which one you are in

Both serve the same routes on the same port. The difference is which database is
behind them, and that is not visible from the UI unless you look.

### Harness loop — fixture data, safe

```bash
npm run registry:harness -w server -- --port=4000    # in-memory fixture herd
npm start -w web-angular                             # app on :4200, proxies /api
```

**`--port=4000` is not optional.** The harness defaults to **4100**;
[`proxy.conf.json`](../web-angular/proxy.conf.json) targets **4000**. Omit the
flag and the app cannot see the harness — it reaches whatever else holds 4000,
which if `npm run dev -w server` is up is the **real `dairy.db`**. That mismatch
is what made these docs wrong for a cycle, and it fails in the dangerous
direction: the harness terminal sits there printing its fixture herd, which reads
as confirmation, while the forms write real records.

Putting the harness on the proxy's port makes the two **mutually exclusive** —
the second process to start dies immediately:

```
Error: listen EADDRINUSE: address already in use :::4000
code: 'EADDRINUSE'   npm error code 1
```

Verified end to end: 13 fixture animals reachable at
`http://localhost:4200/api/registry/animals`, `storage: ":memory:"`. Add
`-- --empty` for the empty-herd state (`0 animal(s)  [--empty]`).

### Real loop — writes to `server/dairy.db`

```bash
npm run dev -w server        # remember build:shared first; or use dev:angular
npm start -w web-angular
```

Or both together, which also builds `shared/`:

```bash
npm run dev:angular          # [server] :4000 + [angular] :4200
```

### Which one am I on?

```bash
curl localhost:4000/api/registry/storage
# harness -> {"storage":":memory:","memory":true}
# real    -> {"storage":"/…/server/dairy.db","memory":false}
```

In the app, the gate at the entry UI states the target before a session opens and
**will not open a session against a real database until you acknowledge it**; the
harness is deliberately exempt. The amber harness banner's *absence* is not by
itself the signal — an absence cannot distinguish the real server from an
unreachable one, which is why `/storage` exists. See [REGISTRY.md](REGISTRY.md)
§ "Which database am I writing to".

**UNVERIFIED:** the gate and banner behaviour above is covered by 13 specs in
`web-angular/src/app/registry/target.spec.ts` and the endpoint was checked by
`curl` on both servers, but nobody has clicked through it in a browser. Layout
and pointer input are what the specs cannot reach.

---

## 7. Registry CLI

Every command takes `--help`, and every date-bearing one **requires an explicit
`--precision`** — it is never defaulted. The rules behind these are in
[REGISTRY.md](REGISTRY.md); this is the invocation reference only.

> The herd goes in through the **UI**, not through these. They remain the
> scriptable path and the thing the domain core was extracted out of.

All six ran successfully against a throwaway clone's `dairy.db` — real rows, then
a real correction, then a non-vacuous `verify:registry`. None was run against the
repo's own `dairy.db`, whose registry is still empty by design.

```bash
# an animal that arrived from elsewhere -> BD-0001
npm run registry:add -w server -- --sex=female --name=Noor \
  --acquired-on=2019-01-01 --precision=year \
  --birth-on=2017-01-01 --birth-precision=year \
  --source-form=recall --recorded-by=adnan

# a calving: dam event + calf + birth event + parentage + lactation, one txn
npm run registry:calve -w server -- --dam=BD-0001 --on=2023-04-01 --precision=month \
  --calf-sex=female --outcome=live --source-form=recall --recorded-by=adnan

# dry_off | departure | note on an existing animal
npm run registry:event -w server -- --animal=BD-0001 --type=dry_off \
  --on=2024-01-01 --precision=month --source-form=recall --recorded-by=adnan

# re-date a calving -- writes BOTH halves (dam's calving + calf's birth)
npm run registry:correct-calving -w server -- --event=aevt_f9097976-… \
  --on=2023-05-01 --precision=month --source-form=recall --recorded-by=adnan

# projections only, recomputed from the event log
npm run registry:rebuild -w server
npm run registry:rebuild -w server -- --animal=BD-0001
npm run registry:rebuild -w server -- --as-of=2026-03-01

# invariants + precision histogram + calving intervals. Writes nothing
npm run verify:registry -w server
```

`--event=` for `correct-calving` is the **currently effective** calving event id,
printed by `registry:calve` and listed by `verify:registry`.

On an empty registry, `verify:registry` says so rather than reporting a
misleading green:

```
0 animal(s), 0 event(s), 0 lactation(s)
NOTE: the registry is EMPTY, so every invariant passes vacuously.
```

---

## 8. Fresh clone, start to finish

Verified in a real clone with no `dairy.db`, no `.env` and no `node_modules`.

```bash
git clone <repo> dairy-agent && cd dairy-agent
nvm use                        # 22.22.3 -- before anything else
npm install                    # ~9 s here
npm run build:shared           # required; server imports @dairy/shared at runtime
cp .env.example server/.env    # add ANTHROPIC_API_KEY (chat only)
npm run seed -w server         # creates the 6 demo tables
npm run dev:angular
```

**What creates the database.** Nothing in `git`: `server/dairy.db` is gitignored.
It is created the first time **any** process imports `server/src/db.ts` — the
server, a `registry:*` command, `seed`. `new Database(DB_PATH)` creates the file,
then `FARM_SCHEMA` and the migration runner apply.

**Migrations run automatically**, at module load, no command needed. Immediately
after the first server start, before any seed:

```
user_version = 2
tables: farm_events, registry_animal_events, registry_animal_status,
        registry_animals, registry_lactations, registry_parentage,
        registry_serial_counter
```

Both registry migrations applied; the six `registry_*` tables exist and are
empty. Note what is **absent**: `animals`, `milkings`, `vendors`, `deliveries`,
`feed_inventory`, `health_events`. Those are `resetSchema()`'s tables and only
`seed()` creates them.

This even happens on a *failed* start — the crash from a missing
`shared/dist` left a valid `dairy.db` at `user_version = 2` behind, because
`db.ts` finishes its work before the import that fails.

**Is `seed` needed?** For the agent, yes. For the registry, no.

| Before `seed` | State |
|---|---|
| `GET /api/health` | `503 {"status":"unseeded","message":"The database has not been seeded yet…"}` |
| `POST /api/agent/run` | streams `RUN_STARTED` then `RUN_ERROR` `unavailable` with the same message |
| `GET /api/registry/storage` | **works** — names the file |
| `GET /api/registry/animals` | **works** — `{"animals":[]}` |

The registry is mounted outside the `isSeeded()` guard on purpose: an unseeded
database is the normal state for a machine that only enters herd records.

After `npm run seed -w server`:

```
Seeded dairy.db: { animals: 14, milkings: 1620, feed: 4, health: 6, vendors: 4, deliveries: 270 }
GET /api/health -> {"status":"ok","seeded":true,"anthropicKey":false}
13 tables; animals = 14; registry_animals = 0
```

`anthropicKey: false` there is the root-only-`.env` mistake from § 3, reproduced
on purpose — that clone had no `server/.env` at all.

**`seed` never touches the registry.** It drops and recreates only the six demo
tables; `registry_*` is absent from `resetSchema()`'s DROP list, enforced by
invariant 13 as a source-level check.

---

## 9. Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `The Angular CLI requires a minimum Node.js version of v22.22.3…`, `npm error code 3` | node below the Angular floor. Only CLI commands care — the server suite still passes, which makes it confusing | `nvm use` |
| `Cannot find module '@dairy/shared/dist/types.js'` | `shared/` not built. `npm run dev -w server` does not build it | `npm run build:shared` |
| `Error: listen EADDRINUSE: … :::4000`, `code: 'EADDRINUSE'` | Two things want 4000 — usually the harness and the real server. **This is the good failure**: it is what makes "harness or real, never both" true | Kill the other: `lsof -tiTCP:4000 -sTCP:LISTEN \| xargs kill` |
| `/api/*` returns **500** through `:4200` while the page itself loads (`GET /` is 200) | Nothing is listening on 4000. The dev server proxies `/api` to a target that is not there | Start a backend — harness or real |
| `/api/registry/*` answers but with the **wrong** data (fixture herd when you wanted real, or the reverse) | Something else holds 4000 — including a stray `tsx watch` from another checkout. Observed during this write-up: the proxy silently served *another clone's* real `dairy.db` | `curl localhost:4000/api/registry/storage` and read the path |
| `anthropicKey: false`, or the chat returns `ANTHROPIC_API_KEY is not set` | Key is in the root `.env`, not `server/.env` | § 3 |
| `503 {"status":"unseeded"}`, or the chat says "run `npm run seed` first" | Demo tables not created. The registry is unaffected | `npm run seed -w server` |
| The entry UI's gate will not open — a checkbox asking you to confirm the database | Working as intended: the target is real (or could not be determined from a server that *is* answering), and the session needs one deliberate act. The harness never asks | Read the path it names. Tick it, or point at the harness |
| Registry commands refuse with `--precision is required` | Not a bug. Precision is never defaulted; a missing one is an error | `--precision=day\|month\|year\|estimated` |
| Regression suite "passes" instantly | It skipped. No API key | Check `# tests` is 12, not 0 |

---

## 10. What was not run

- **The live regression suite** (`test:regression*` with a key) — real API calls,
  and it re-seeds `dairy.db`. Skip path verified; the 12/12 result is not.
- **A browser click-through** of the entry UI — specs and `curl` only.
- **The camera stack** (`docker-compose.frigate.yml`, `capture:frigate`,
  `capture:doubletake`, `enroll:synthetic`, `verify:payload*`) — needs the
  throwaway Frigate stack and a physical camera. See
  [cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md) and
  [Cycle7-fu3-double-take-validation.md](Cycle7-fu3-double-take-validation.md),
  where they were verified against live instances.
- **The Langfuse stack** (`docker-compose.langfuse.yml`) — pulls several GB of
  images. Tracing is a no-op with the keys unset. See
  [OBSERVABILITY.md](OBSERVABILITY.md).
- **`simulate:farm` / `verify:farm` / `verify:classify`** — need a running server
  and mutate `farm_events`. Verified at `v0.7.0` / `v0.8.0`.
- **Any platform other than macOS on node 22.22.3.** The `better-sqlite3`
  prebuild and the `lsof` invocations above are the platform-sensitive parts.
