# Local Setup, Build, Test & Run

*Every command below was run on 2026-09-03 against commit `a6c4842` on macOS
(darwin 25.3.0), node 22.22.3, npm 10.9.8. The fresh-clone section was verified
in an actual throwaway clone, not reasoned about. Four things could not be run
here and were marked **UNVERIFIED** where they appeared. Later verification
updates are listed below; the original environment measurements are historical.*

Checked against `package.json` (root, `server/`, `web-angular/`, `shared/`),
`.nvmrc`, `web-angular/proxy.conf.json` and `web-angular/angular.json`. Where
this document and those files disagree, they are right and this is stale.

**Scope, against the README.** This document owns setup, the two run loops, the
test suites (including the four live-model regression splits), the registry CLI
and backups — with the *why* and the failure modes. The README's
[Command reference](../README.md#command-reference) owns the operational surface
this one does not cover: farm-event ingestion and classification, the live-camera
captures, and the Langfuse stack. Neither file is a superset of the other, and
neither should grow into one.

**Re-run on 2026-09-03 at `06034d9`:** § 6's new one-command subsection in full,
plus `npm install`, `build:shared`, `typecheck`, `build -w server`,
`build:angular` and both test suites — which is what corrected the two test
counts in § 5 (410 → **450**, 106 → **196**) and the budget overrun in § 4
(11.67 → **16.53 kB**). Those three numbers were true at `a6c4842` and had gone
stale; nothing else in this document was re-measured, so anything not listed
here still carries its original `a6c4842` verification.

**Re-run on 2026-09-04:** `typecheck`, both test suites and `build:angular`,
twice. The defect fixes moved § 5 to 458/198 and § 4's overrun to 16.72 kB; milk
logging then moved them again — § 5 is now **480** server and **210** frontend
across **22** files, and § 4's overrun **17.46 kB**. Same caveat both times:
nothing else was re-measured.

**Phase 7 verification — 2026-09-09:** 726 server tests, 339 frontend tests
across 32 files, typecheck, template checks and the Angular production build pass.
The initial bundle was 584.58 kB. These are historical Phase 7 measurements;
earlier timings, install audit counts and environment observations remain dated.

**Feed verification — 2026-09-10:** 742 server tests and 347 frontend tests across
33 files pass, with typecheck, template checks and the production build. Initial
bundle: 596.16 kB. These are the latest runs in §§4–5. The first server run exposed
a pre-existing CLI usage import that opened the live database and applied additive
migration 8; the imports and isolation regression are fixed. Subsequent full tests
leave the checksum unchanged. [Incident and verification](REGISTRY_FEED.md#database-preservation-incident-and-fix).

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
the native binding, which is slower. That install reported 19 known
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

**Three warnings are present** on the Angular build — do not
treat them as failures:

```
▲ [WARNING] bundle initial exceeded maximum budget. Budget 500.00 kB was not met by 96.16 kB ...
▲ [WARNING] Module '@dairy/shared' used by 'src/app/core/chat-store.ts' is not ESM
▲ [WARNING] NG8113: SummaryBar is not used within the template of PayrollRunScreen
```

The 2026-09-10 feed build is 596.16 kB against the 500 kB warning budget.
The budget already warned at the Phase 7 baseline of 584.58 kB.
The CommonJS notice is about `shared/` emitting CJS.

---

## 5. Test

```bash
npm test -w server           # 742 tests, node:test via tsx
npm test -w web-angular      # 347 tests across 33 files, Vitest (jsdom)
```

Both passed during feed verification on 2026-09-10 in the working checkout. They need **no database file and no API key** —
registry fixtures use `new Database(':memory:')`. Backup tests also write
snapshots in temporary directories and clean them up; the suite does not use
the live database after the CLI-import isolation fix documented above.

| Suite | Latest measured result (2026-09-10) | Notes |
|---|---|---|
| `npm test -w server` | `# tests 742 / # pass 742 / # fail 0 / # skipped 0` | Enumerated dirs: `src/`, `src/farm/`, `src/registry/`, `src/tools/` |
| `npm test -w web-angular` | `Test Files 33 passed / Tests 347 passed` | Prints `Not implemented: HTMLCanvasElement's getContext()` — jsdom noise from the chart component, not a failure |

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
npm run test:regression -w server        # all four suites, live model, costs tokens
npm run test:regression:core -w server
npm run test:regression:cap -w server
npm run test:regression:fallback -w server
npm run test:regression:registry -w server
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
The skipped suite executed no scenarios. Never record that as a pass. The
original core/cap/fallback set contains 12 scenarios in total; the registry
suite adds six precision evals. Check each subprocess summary, not only the
aggregate exit code.

**Not run here**, deliberately: the live suite makes real API calls against the
configured model, and its `beforeEach(seed)` re-seeds `dairy.db`. **UNVERIFIED:**
the 12/12 live result. The last recorded clean pass is at `v0.6.0`
([REGRESSION.md](REGRESSION.md) § 04-verification).

---

## 6. Running it — two loops, and knowing which one you are in

Both serve the same routes on the same port. The difference is which database is
behind them, and that is not visible from the UI unless you look.

### Just want to see it work? One command

*Added 2026-09-03 at `06034d9`; every command and every number in this
subsection was run.*

```bash
nvm use
npm install                # first time only
npm run harness:app
```

Then open <http://localhost:6420>. You land on the **day board** over an
**in-memory** herd of 31 animals — plus the buyers, prices and dispatch sessions
the sales screens need, and the three staff the labour screens need — and
`server/dairy.db` is never opened by any process this command starts.

It is not a fourth run loop — it is the harness loop below, with the two
terminals collapsed into one and a readable herd seeded into it:

```
build:shared
  ├─ harness   registry:harness --port=6400 --empty
  ├─ seed      scripts/harness-seed.mjs --wait=90
  └─ angular   ng serve
```

**`--empty` is why the seed exists and why it must stay an HTTP client.** The
harness started *without* `--empty` serves `staffedHerd()` plus `addFeedFixtures()` —
a smaller fixture built in-process from `fixtures.ts` and `feed-fixtures.ts`, with
different records and serials. The two are not interchangeable, and the seed's own guard says so by
name if it finds the wrong one.

The seed is an **HTTP client, not a fixture module**, and every row goes in
through the real write path — so it cannot express a herd the production code
would refuse. Measured, not asserted: its first milk version computed a yield
from `id.charCodeAt(8)`, which is `NaN` on a seven-character serial like
`BD-0001`; it serialized to `null` and the write boundary refused it by name.

`concurrently` does not order its processes, so the seed polls for the harness
rather than assuming it won. Measured from cold: the seed logged
`http://localhost:6400/api/registry` before the harness had bound the port,
waited, and then printed `target :memory: (memory: true) -- harness confirmed`.

What lands, and why each row is there:

| What | Why it is in the seed |
|---|---|
| 31 animals, 70 events, 17 lactations | zero invariant violations at `as_of` today |
| all six statuses | `katti` · `choti` · `majj · in milk` · `majj · dry` · `male` · `departed` |
| `BD-0011 Bhoori` | 15 months old **and** parity 1 → reads `majj`, not `katti`. The §7.1 rule-order case |
| `BD-0009 Guddi` | ~8 years, parity 0 → `choti`. The other side of the same boundary |
| `BD-0006 Chandni` | no birth date at all → `choti` despite her age, and ranked **first** in the calf picker |
| `BD-0003 Kali` | carries a pre-applied **paired** date correction — superseded rows on her timeline and her calf's |
| `BD-0014 Reshma` | entered as `acquired`, then **linked**: her origin event is superseded and her birth date sharpens from *estimated 2018* to *2018-06 (month)* |
| `BD-0008 Zeba` | an **overridden** write with its reason, plus a note dated after her departure |
| `BD-0002 Sohni` | calvings typed out of order — her daughters' serials are not chronological |
| dates | `day`, `month`, `year` and `estimated`, across `recall`, `cycle_card` and `daily_herd_sheet` |
| names / post nos. / ear tags | close enough to trip the near-duplicate warning by typing `Kali`, `Noor`, post `3` or tag `pk-4412` |
| intervals | 2 `measured` (523, 538 d) and 5 `approximate` (487–550 d), reported separately |
| milk | 5 sessions over the last 3 days across the 6 animals in milk — **one deliberately incomplete** (4 of 6 recorded) and one `not_milked` with a reason, so `/check`'s completeness panel has something other than a green wall to show |
| milkers | `abdul` on mornings, `imran` on evenings, so `observed_by` on a milk row reaches the datalist |
| 4 destinations | one dodhi, two households, and **home** — `/milk/dispatch` is unusable without a home row, because kept milk would otherwise vanish into the reconciliation gap |
| `standing` both ways | the dodhi and home are answered **every session** and block the save; the two households appear only when they came. Seeding that backwards would make the sheet demand ~1,400 "took nothing" answers a year |
| prices in 40-litre lots | Rs 7,000 / 40 L wholesale, Rs 9,000 / 40 L retail — so the rate renders as the farm agrees it and a per-litre slip is visible |
| 5 dispatch sessions | over the same days as the milk, so `/check`'s reconciliation has production on one side and dispatch on the other |
| one `none` row | the dodhi did not come one evening — and the neighbours took far more that session, which is the households working as a surplus outlet |
| a **part** payment | Rs 5,000 against a larger balance, so the statement shows a running carried-forward figure. This is the case the demo `deliveries.paid` boolean cannot express at all |
| 3 staff | two salaried and one dihari. `imran` carries all three benefit kinds, `abdul` carries **none** — a package screen developed against only one of those shapes gets the empty state wrong |
| `imran`'s milk allowance | a `staff` destination naming him, so the run can compare 2 L/day against what actually left the bulk. **Not `standing` in the seed**, because the dispatch sessions above were already written without it; on a live farm it should be |
| last month paid, this month not | the current month is outstanding for the whole of it, so a seed that settled it would open `/labour/payroll` on the completed state and hide the one the screen exists for |
| `imran` paid **less** than his agreement | four days' leave, so `/check` has a real `amount_differs_from_term` line rather than an empty report |
| three balance states at once | `abdul` settled, `imran` open, `rashid` **in advance** — the negative balance needs no flag anywhere, and is on screen from the first render |

**This is not the same dummy data as `npm run seed`, and the two are
deliberately separate systems.** Confusing them is the likeliest first mistake:

| | `npm run harness:app` | `npm run seed -w server` |
|---|---|---|
| Writes to | an in-memory database, discarded on exit | **`server/dairy.db`**, on disk |
| Fills | `registry_*` — herd, milk, sales, labour and feed fixtures | the six demo tables (`animals`, `milkings`, `vendors`, …) |
| Feeds | Today and the registry routes under `/animals`, `/milk`, `/feed`, `/labour`, plus `/check` | the **agent chat** at `/chat` |
| Needs an API key | no | for the chat to answer, yes |
| Repeatable | yes — and it never touches a real record | yes, by dropping and recreating those six tables |

So under `harness:app` the **chat panel at `/chat` will not work** — and not for
the reason you would guess. It is not the `unseeded` message from § 9: the
harness mounts **only** `/api/registry` and `/api/harness` (`harnessApp()`), so
every other `/api` path is simply absent. Measured:

```
/api/registry/storage    -> 200
/api/harness             -> 200
/api/health              -> 404
/api/agent/run           -> 404
/api/farm/events         -> 404
```

That is correct behaviour, not a broken build — the harness exists to serve the
registry over `:memory:` and nothing else, and giving it the agent surface would
mean giving it `db.ts`, which is the one thing it must never import. If you want
the chat, you want the real loop below plus `npm run seed -w server` and a key.

Two supporting commands:

```bash
npm run harness:seed         # re-seed a harness that is already running
npm run harness:serve        # serve the PRODUCTION bundle instead of ng serve
```

`harness:seed` is **re-runnable**: every write carries a fixed
`Idempotency-Key`, so a second run against the same running harness replays the fixture writes
and changes nothing. Verified — two consecutive runs both ended at 31 animals /
70 events / 17 lactations.

Feed additionally uses durable successful-key/body binding: changed content with a
successful feed key refuses instead of creating another feed record. The following
sharp edge still applies to the older-domain keys, keyed on `(key, **body**)`, so
**editing `scripts/harness-seed.mjs` invalidates the replay** — the bodies no
longer match, the writes are processed as new, and `dry_off` and `note` have no
uniqueness guard, so they append a second time. It fails by *compounding*, not
by erroring. The script now refuses when the herd size does not match what it
produces, and names the only reset there is: restart the harness. The log is
append-only and the harness has no persistence, by design.

`harness:serve` exists because `RegistryApi` addresses the backend at a
**relative** path (`BASE = '/api/registry'`), and a production bundle has no dev
server and therefore no proxy — so `ng build` output on a plain static host
answers `/api/registry/animals` with its own 404 and the app renders "no server
answered", which reads like a broken backend rather than a missing proxy. It
serves `web-angular/dist/web-angular/browser` with a `/api` reverse proxy and an
SPA fallback (`/animals` and `/animals/BD-0003` are client routes with no such
files, so a hard reload 404s without it). Run `npm run build:angular` first.

Unlike the seed it **refuses nothing** — serving the built app against the real
registry is a legitimate thing to want, and the app's own gate already asks. It
states which database is behind `/api` at boot instead, in both directions.

### Harness loop — fixture data, safe

```bash
npm run registry:harness -w server -- --port=6400    # in-memory fixture herd
npm start -w web-angular                             # app on :6420, proxies /api
```

Add `--empty` and `npm run harness:seed` to get the herd above instead of the
injected `staffedHerd()` plus feed fixtures. The HTTP walkthrough has its own
serials and richer named-animal entry cases; do not layer it over the injected set.

**`--port=6400` is not optional.** The harness defaults to **6410**;
[`proxy.conf.json`](../web-angular/proxy.conf.json) targets **6400**. Omit the
flag and the app cannot see the harness — it reaches whatever else holds 6400,
which if `npm run dev -w server` is up is the **real `dairy.db`**. That mismatch
is what made these docs wrong for a cycle, and it fails in the dangerous
direction: the harness terminal sits there printing its fixture herd, which reads
as confirmation, while the forms write real records.

Putting the harness on the proxy's port makes the two **mutually exclusive** —
the second process to start dies immediately:

```
Error: listen EADDRINUSE: address already in use :::6400
code: 'EADDRINUSE'   npm error code 1
```

Verified end to end: 13 fixture animals reachable at
`http://localhost:6420/api/registry/animals`, `storage: ":memory:"`. Add
`-- --empty` for the empty-herd state (`0 animal(s)  [--empty]`).

### Real loop — writes to `server/dairy.db`

```bash
npm run dev -w server        # remember build:shared first; or use dev:angular
npm start -w web-angular
```

Or both together, which also builds `shared/`:

```bash
npm run dev:angular          # [server] :6400 + [angular] :6420
```

### Which one am I on?

```bash
curl localhost:6400/api/registry/storage
# harness -> {"storage":":memory:","memory":true}
# real    -> {"storage":"/…/server/dairy.db","memory":false}
```

And from the other end — confirming the real file was not written to. The
durable check opens no database at all, so it has no failure mode:

```bash
stat -f '%Sm  %z bytes' server/dairy.db && shasum -a 256 server/dairy.db
```

For row counts, use **`immutable=1`, not `-readonly`:**

```bash
sqlite3 'file:server/dairy.db?immutable=1' 'select count(*) from registry_animals'
```

`sqlite3 -readonly` **is not reliable here, and fails in a confusing way.**
`dairy.db` is in WAL mode (§ 7 of [REGISTRY.md](REGISTRY.md)), a WAL reader needs
the `-shm` file, and a read-only connection cannot create one — so with the
sidecars absent, which is their normal state once the last connection closes,
you get:

```
Error: in prepare, unable to open database file (14)
```

Measured both ways from a clean state: `-readonly` fails, `immutable=1` answers
and creates **no** `-wal` or `-shm`, with the main file's checksum unchanged. A
plain `sqlite3 server/dairy.db` also answers, but opens read-write and leaves
both sidecars behind — harmless (they are gitignored, and the data file is
untouched) but it makes "was anything written?" harder to eyeball. `immutable=1`
assumes no writer is active, which is exactly the state this check asserts.

Do not confuse either with editing rows: the append-only guarantee is
**per-connection**, and a `sqlite3` CLI session does not have it. Read only.

In the app, the gate at the entry UI states the target before a session opens and
**will not open a session against a real database until you acknowledge it**; the
harness is deliberately exempt. The header storage chip explicitly distinguishes
`harness · in memory`, `registry` (with its path on hover/focus), and
`target unknown`, using `/storage`. See [REGISTRY.md](REGISTRY.md)
§ "Which database am I writing to".

The target and gate behavior is covered by `target.spec.ts`. Phase 7 browser
checks exercised harness session setup and editing without losing unfinished
input. They do not establish a real-database browser walkthrough; the earlier
endpoint checks used `curl` on both servers.

---

## 7. Registry CLI

Every command takes `--help`, and every date-bearing one **requires an explicit
`--precision`** — it is never defaulted. The rules behind these are in
[REGISTRY.md](REGISTRY.md); this is the invocation reference only.

> The herd goes in through the **UI**, not through these. They remain the
> scriptable path and the thing the domain core was extracted out of.

The first six ran successfully against a throwaway clone's `dairy.db` — real rows,
then a real correction, then a non-vacuous `verify:registry`. None was run against
the repo's own `dairy.db`. The dated checks below found no animal records;
that is an observation, not a rule that the persistent registry must stay empty.

**`registry:backup` and `verify:registry --db` were added later and verified
differently** (2026-09-04): `registry:backup` was run against the repo's own
`dairy.db` — it only reads — and `verify:registry --db` against the snapshot it
produced, with `dairy.db` confirmed byte-identical either side. Because that
registry is empty, the round trip on *populated* data was proven separately, in
process, against a temp file database carrying a superseded correction chain. See
§ 8.

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

# verify a BACKUP instead of the live database. Read-only, never migrated
npm run verify:registry -w server -- --db=backups/dairy-2026-09-04T163125.db

# snapshot + text dump of the record tables -> server/backups/
npm run registry:backup -w server
```

`--event=` for `correct-calving` is the **currently effective** calving event id,
printed by `registry:calve` and listed by `verify:registry`.

`--db=` paths are resolved from **`server/`**, not the repo root — npm runs
workspace scripts with the workspace as cwd. So the path you read off a repo-root
listing needs one segment fewer. Getting it wrong is caught and named:

```
verify:registry: no such database '/…/server/server/backups/dairy-….db'.
  --db was given 'server/backups/dairy-….db', resolved against cwd /…/server.
```

On an empty registry, `verify:registry` says so rather than reporting a
misleading green:

```
0 animal(s), 0 event(s), 0 lactation(s)
NOTE: the registry is EMPTY, so every invariant passes vacuously.
```

---

## 8. Backups — the one database you cannot re-create

Everything else in this repo regenerates. The demo tables come back from
`npm run seed`, `farm_events` from a webhook replay, and the registry's three
projection tables from `registry:rebuild`. The registry's **eight record tables**
come back from nothing:

| Table | Regenerable? |
|---|---|
| `registry_animal_events` | **No** — the sole source of truth |
| `registry_animals` | **No** — identity, not projection |
| `registry_milkings` | **No** — a measurement; derivable from nothing |
| `registry_serial_counter` | **No** — allocation position |
| `registry_destinations` | **No** — who milk goes to, and their active range |
| `registry_destination_prices` | **No** — what was agreed, and from when |
| `registry_dispatches` | **No** — a transaction with a counterparty |
| `registry_payments` | **No** — money that changed hands |
| `registry_people` | **No** — identity, and the referent for every `observed_by` |
| `registry_engagements` | **No** — one row per stint |
| `registry_pay_terms` | **No** — what was agreed, and from when |
| `registry_pay_benefits` | **No** — the in-kind lines of an agreement |
| `registry_wage_periods` | **No** — what was settled for a period |
| `registry_wage_payments` | **No** — money that changed hands |
| `registry_animal_status`, `registry_lactations`, `registry_parentage` | Yes — `registry:rebuild` |

That table is not maintained by hand: `SOURCE_OF_TRUTH_TABLES` in
[backup.ts](../server/src/registry/backup.ts) is `REGISTRY_TABLES` minus
`REGISTRY_PROJECTION_TABLES`, so a record table added by a future migration is
backed up without anyone remembering to add it. **Demonstrated rather than
claimed:** the four sales tables were added by migration 5, the six labour
tables by migration 6, and all ten appeared in the backup with no change to
`backup.ts` at all — only the row list above had to be written out for a human
to read.

### Taking one

```bash
npm run registry:backup -w server
npm run registry:backup -w server -- --out=~/Dropbox/dairy-backups
npm run registry:backup -w server -- --no-dump      # snapshot only
```

Two files land in `server/backups/`, stamped with the farm-local instant:

```
dairy-2026-09-04T163125.db      VACUUM INTO snapshot, integrity-checked after writing
registry-2026-09-04T163125.sql  deterministic text dump of the record tables
```

They fail differently, which is why there are two. The `.db` is exact and
restores instantly but is opaque — you cannot see what changed between Tuesday
and Wednesday. The `.sql` is ordered by primary key with a stable column list, so
two of them `diff` to exactly the rows that changed, which is what makes *"when
did this animal's birth date change?"* answerable.

**Do not `cp dairy.db`.** It is in WAL mode, so committed transactions can sit in
the `-wal` sidecar until a checkpoint: copying the main file alone gives you a
snapshot that opens cleanly and is missing yesterday. `VACUUM INTO` needs no
downtime and writes a consistent, fully-checkpointed file. Its output is **not**
in WAL mode, so unlike `dairy.db` a backup reads fine from a plain read-only
open — the `immutable=1` trap in § 6 does not apply to these.

### Versioned history — running. Off-machine — not yet.

Two different protections, and only one of them is in place. Stated separately
because conflating them is how a backup gets trusted for something it does not do.

| | |
|---|---|
| Backup repo | `~/dairy-registry-backups` — a **local** git repo, **no remote** |
| Script | [`scripts/backup-daily.sh`](../scripts/backup-daily.sh) |
| Schedule | `com.dairy-360.registry-backup`, daily at 21:00 Asia/Karachi |
| Log | `~/Library/Logs/dairy-registry-backup.log`, append-only |

**What this protects against today:**

- a bad migration (the pre-migration hook, below)
- a mistaken `DELETE`, a wrong correction, a bad rebuild — anything where you need
  yesterday's records back, which the git history gives you per-day
- `rm server/dairy.db`

**What it does NOT protect against:** losing the machine. Disk failure, theft, a
wiped laptop. `~/dairy-registry-backups` is on the same disk as `dairy.db`, so
that one failure takes both. This is a known, accepted gap — not an oversight.

The job says so on every run, rather than leaving it to be inferred:

```
[backup-daily] WARNING: no 'origin' remote — the backup is local only
```

**To close it**, create a private repo and point the local one at it — the script
picks up the remote with no change:

```bash
cd ~/dairy-registry-backups
git remote add origin git@github-personal:i-adnanali/dairy-registry-backups.git
git push -u origin main
```

It must be **private**, and on the personal account. The dumps hold real herd
records, and `i-adnanali` is where this project lives — a work profile is the
wrong home for a farm's records. (An earlier attempt put it on the wrong account;
that repo has been deleted, and it only ever held dumps of an empty registry.)

```bash
scripts/backup-daily.sh                     # run it by hand, any time
scripts/backup-daily.sh /some/other/dest    # or into a different repo
launchctl kickstart -p gui/$(id -u)/com.dairy-360.registry-backup
```

Git is the mechanism even while there is no remote, because the dumps are text:
it is what gives you the per-day history, the audit trail and a real diff between
any two days. A synced folder — the obvious alternative once a remote is added —
would give you a mirror instead, and a mirror faithfully replicates your
mistakes.

**What is tracked, and what is not.** `registry.sql` in that repo is the tracked
file and is **overwritten every run** — safe precisely because git keeps every
version, and it is what makes the history readable:

```bash
cd ~/dairy-registry-backups
git log -p registry.sql            # every change to the herd, newest first
git diff HEAD~1 -- registry.sql    # what the last run changed
```

Verified: an added animal and a corrected name show up as exactly two lines.

The stamped `.db` snapshots are **untracked**, in
`~/dairy-registry-backups/snapshots/` and gitignored there — so they stay on this
machine even after a remote is added. A 460 kB binary committed daily would bloat
the repo forever and give no readable history, which is the one thing git is here
for.

A commit lands on every run, including runs where nothing changed — the
provenance header carries the timestamp, so the history doubles as proof the job
actually ran, and the commit message carries the row counts.

`server/backups/` is **gitignored on purpose, and should stay that way**, for two
reasons in this order:

1. **A backup must not share a fate with the thing it backs up.** A force-push, a
   bad `reset` or a lost account should not take the herd records with it. This
   reason does not depend on a setting anyone can change.
2. This repository is public, and the dumps hold real herd records.

The order matters: if this repo ever goes private, the second reason stops
applying and the first still decides it.

At the current size — the whole database is well under a megabyte and a real
herd's dump will be tens of kilobytes of text — **keep every snapshot**. Rotation
logic costs more than the disk it saves, and backups are never overwritten:
`VACUUM INTO` refuses an existing target, and `runBackup` checks first so the
message names the collision.

### `launchd`, and the node version it will pick for you

`launchd` rather than `cron`: cron does not fire for the interval a laptop spent
asleep, and launchd runs a missed `StartCalendarInterval` job shortly after wake.
For a machine that is closed more often than open, that is the difference between
a daily backup and an occasional one.

**The trap, measured rather than reasoned about.** launchd runs no login shell —
no `PATH`, no `nvm`. The obvious fix is to source `nvm.sh` and take what you get,
which selects nvm's `default` **alias**: node 16 on this machine. better-sqlite3's
binding is compiled for node 22's ABI, so the job failed with

```
Error: … better_sqlite3.node was compiled against a different Node.js version
using NODE_MODULE_VERSION 127. This version of Node.js requires 93.
```

It failed *safely* — `set -e` aborted before the commit step and the backup repo
was untouched — but it failed silently and daily, which is the worst property a
backup job can have. An interactive run never reproduces it, because a login
shell has already put a usable node on `PATH`.

So the script `cd`s to the repo first and then runs `nvm use`, honouring
`.nvmrc`, and falls back to the highest installed node ≥ 22 if that pin is not
installed. It refuses to run rather than proceed on a node that cannot load the
binding. Confirmed under launchd: `last exit code = 0`, on `v22.22.3`.

Both the plist and the script exist to be read — the plist explains why
`RunAtLoad` is deliberately absent (every login would take a backup and commit
it), and the script explains the ordering of its three steps.

### What keeps real records out of a public repo

This repository is public and will be running on real herd data. Those two facts
coexist because **the data never enters the repo**, which is a boundary worth
stating rather than rediscovering. Verified with `git check-ignore` and
`git ls-files`:

| Path | Status |
|---|---|
| `server/dairy.db` (+ `-wal`, `-shm`) | ignored by `*.db*` |
| `server/backups/` | ignored — snapshots and dumps |
| `server/captures/` | ignored — live camera capture artifacts |
| `.env`, `server/.env` | ignored |
| `frigate/config.yml`, `double-take/config.yml` | ignored — LAN address, RTSP credentials. Only `.example` is tracked |
| `double-take/enroll/*` | ignored — **face images of real people**. Only `README.md` and `PROVENANCE.txt` are tracked |

**The one path that is not covered is `docs/images/`,** and it is not covered on
purpose — those screenshots are documentation. It is also the likeliest way real
records ever get published, because a screenshot of the app is the natural thing
to put in a blog post or a decisions doc.

**So screenshot the harness, not the real herd.** `npm run harness:app` serves the
31-animal fixture herd from § 6 — real-shaped, with the date precisions, the
correction chain and the incomplete milking session that make a screenshot worth
looking at, and not one real animal in it. That is what the fixture herd is for.

### The automatic one: before every migration

`applyRegistrySchema` runs at **module load** in [db.ts](../server/src/db.ts), so
a pending migration fires the moment anything imports the singleton — including a
one-off script. Migration 2 already rebuilds `registry_animal_events` by
create-copy-drop-rename with foreign keys off. So `db.ts` wires a
`beforeMigrate` hook that snapshots first:

```
[registry] migration 3 -> 4 pending. Backed up {…} to …/backups/dairy-…-pre-v4.db
```

**A failed backup aborts the migration and the boot.** If the snapshot cannot be
written, not migrating is the safe action. The override is explicit:

```bash
REGISTRY_SKIP_PREMIGRATION_BACKUP=1 npm run dev -w server
```

The hook skips when there is nothing to protect — no record tables yet, or all of
them empty. That is the state of every clean clone and of CI, and it is the state
`dairy.db` is in until a herd is entered.

### Restoring

From the `.db` snapshot — the fast path:

```bash
# stop the server first; then, from the repo root
mv server/dairy.db server/dairy.db.before-restore
cp server/backups/dairy-2026-09-04T163125.db server/dairy.db
rm -f server/dairy.db-wal server/dairy.db-shm    # stale sidecars of the old file
npm run registry:rebuild -w server
npm run verify:registry -w server
```

From the `.sql` dump — into a database that has been migrated but holds no
registry rows. The dump is **data only**; the schema is the `MIGRATIONS` array:

```bash
sqlite3 server/dairy.db < server/backups/registry-2026-09-04T163125.sql
npm run registry:rebuild -w server
npm run verify:registry -w server
```

`registry:rebuild` is required in both cases, because the projection tables are
deliberately not in the dump. `verify:registry` is what makes the restore
trustworthy rather than hopeful — it runs invariants 0–28 plus feed integrity check 29 when feed tables are present, so it reports that the
restored data is *semantically* valid and not merely readable.

**Verify a backup without restoring it**, which is the check worth running before
you need it:

```bash
npm run verify:registry -w server -- --db=backups/dairy-2026-09-04T163125.db
```

Opened read-only and never migrated. Verified: the live `dairy.db` is
byte-identical before and after. If the backup predates the current schema you
are told, because a violation may then be the schema gap rather than the data:

```
NOTE: …/dairy-….db is at user_version 3; this build targets 4.
```

The whole loop — populated registry → backup → restore from the `.sql` → rebuild
→ invariants — is exercised end to end, including a superseded correction chain,
and the projections come back identical.

### Scheduling it

The local daily job is documented earlier in this section under “Versioned
history — running. Off-machine — not yet.” Additional destinations or an off-machine schedule are not configured
by these instructions. For a separate macOS job, use absolute executable paths
and an explicit destination. Its command is:

```
npm run registry:backup -w server -- --out=<your private destination>
```

Note that `launchd` runs no login shell: give it absolute paths and expect no
`PATH`. `--out=` expands a leading `~` itself, for exactly this reason.

---

## 9. Fresh clone, start to finish

Verified in a real clone with no `dairy.db`, no `.env` and no `node_modules`.

```bash
git clone <repo> dairy-360 && cd dairy-360
nvm use                        # 22.22.3 -- before anything else
npm install                    # ~9 s here
npm run build:shared           # required; server imports @dairy/shared at runtime
cp .env.example server/.env    # add ANTHROPIC_API_KEY (chat only)
npm run seed -w server         # creates the 6 demo tables
npm run dev:angular
```

**What creates the database.** Nothing in `git`: `server/dairy.db` is gitignored.
It is created the first time a process imports `server/src/db.ts` — for example
the persistent server, a registry write command or `seed`. The harness and isolated unit tests must not import it. The four herd write CLI
modules now defer that import until command execution, so importing their usage
constants or asking for their help no longer opens the database. `new Database(DB_PATH)` creates the file,
then `FARM_SCHEMA` and the migration runner apply.

**Migrations run automatically**, at module load, no command needed. Immediately
after the first server start, before any seed:

```
user_version = 8
tables: farm_events, registry_animal_events, registry_animal_status,
        registry_animals, registry_destination_prices, registry_destinations,
        registry_dispatches, registry_engagements, registry_lactations,
        registry_milkings, registry_parentage, registry_pay_benefits,
        registry_pay_terms, registry_payments, registry_people,
        registry_serial_counter, registry_wage_payments, registry_wage_periods,
        registry_feed_items, registry_feed_crops, registry_feed_expenses,
        registry_feed_purchases, registry_feed_daily, registry_feed_lines,
        registry_feed_sources, registry_feed_recipients, registry_feed_revisions,
        registry_feed_requests
```

The current schema applies eight migrations; the 27 `registry_*` tables exist
with no farm records. `registry_serial_counter` alone has its initial allocator row. Note what is **absent**: `animals`, `milkings`, `vendors`, `deliveries`,
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

## 10. Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `The Angular CLI requires a minimum Node.js version of v22.22.3…`, `npm error code 3` | node below the Angular floor. Only CLI commands care — the server suite still passes, which makes it confusing | `nvm use` |
| `Cannot find module '@dairy/shared/dist/types.js'` | `shared/` not built. `npm run dev -w server` does not build it | `npm run build:shared` |
| `Error: listen EADDRINUSE: … :::6400`, `code: 'EADDRINUSE'` | Two things want 6400 — usually the harness and the real server. **This is the good failure**: it is what makes "harness or real, never both" true | Kill the other: `lsof -tiTCP:6400 -sTCP:LISTEN \| xargs kill` |
| `/api/*` returns **500** through `:6420` while the page itself loads (`GET /` is 200) | Nothing is listening on 6400. The dev server proxies `/api` to a target that is not there | Start a backend — harness or real |
| `/api/registry/*` answers but with the **wrong** data (fixture herd when you wanted real, or the reverse) | Something else holds 6400 — including a stray `tsx watch` from another checkout. Observed during this write-up: the proxy silently served *another clone's* real `dairy.db` | `curl localhost:6400/api/registry/storage` and read the path |
| `anthropicKey: false`, or the chat returns `ANTHROPIC_API_KEY is not set` | Key is in the root `.env`, not `server/.env` | § 3 |
| `503 {"status":"unseeded"}`, or the chat says "run `npm run seed` first" | Demo tables not created. The registry is unaffected | `npm run seed -w server` |
| The entry UI's gate will not open — a checkbox asking you to confirm the database | Working as intended: the target is real (or could not be determined from a server that *is* answering), and the session needs one deliberate act. The harness never asks | Read the path it names. Tick it, or point at the harness |
| Registry commands refuse with `--precision is required` | Not a bug. Precision is never defaulted; a missing one is an error | `--precision=day\|month\|year\|estimated` |
| Regression suite "passes" instantly | It skipped. No API key | Check each suite’s executed-test count and skip count |
| `sqlite3 -readonly server/dairy.db` → `Error: in prepare, unable to open database file (14)` | WAL mode needs a `-shm`, and a read-only connection cannot create one. Normal whenever the sidecars are absent, so this fails *intermittently* depending on what last opened the file | `sqlite3 'file:server/dairy.db?immutable=1' '…'`, or just checksum it — see § 6 "Which one am I on?" |
| `npm run harness:app` → the chat at `/chat` does nothing, `/api/health` is 404 | Working as intended. The harness mounts only `/api/registry` and `/api/harness`; it must never import `db.ts`, which is where the agent surface lives | For the chat, use the real loop plus `npm run seed -w server` and a key |

---

## 11. What was not run

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

## Feed development (2026-09-10)

Feed is included in the injected registry harness and guarded HTTP harness seed. Run `npm run harness:app` for disposable development; never run root `seed` for feed testing. The HTTP seed verifies harness identity before writes and can be replayed. Feed fixtures include unknown-date crops, expenses, original-unit purchases, mixed daily supply and partial accounts. [Implementation, checks and the corrected CLI-import isolation defect](REGISTRY_FEED.md). Use the feed [gallery](images/feed/README.md) alongside Phase 7 captures.
