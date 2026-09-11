# Registry Agent Tools — Decision Doc (Cycle 9)

> **Extended by the sales cycle — [REGISTRY_SALES.md](REGISTRY_SALES.md).** This is a closed record
> and its text is left as written; two counts in it are now historical rather than wrong-then:
>
> - "`ALL_TOOLS` advertises 21 tools ... **not one of them reads a `registry_*` table**" was true at
>   `f3262d7` and is what this cycle set out to change. It is now 28, of which seven read the
>   registry: the three below, plus `list_buyers`, `get_buyer_balance`, `get_dispatches` and
>   `get_milk_reconciliation` over the sales tables.
> - The deferral of `get_milking_record` for want of fixture rows is **closed**: `fixtures.ts` now
>   carries milk and dispatch rows, so the three-status split has a fixture behind it.
>
> Decision 1 (reads unrestricted, writes deferred) and Decision 2 (the demo tool surface is not
> touched) both still stand, and the sales tools were built under them.


## Context

[REGISTRY.md](REGISTRY.md) ends with a deferral: *"No agent tools over the registry. v1 is a service layer."* That deferral is now the largest gap in the product. `ALL_TOOLS` in [tools/index.ts](../server/src/tools/index.ts) advertises 21 tools — 17 declared in that file (6 dairy read, 5 dairy write, 3 vendor read, 3 vendor write) plus `get_yield_vs_deliveries`, two farm reads and one farm write re-exported in — and **not one of them reads a `registry_*` table**. The chat can hold a fluent conversation about fourteen buffaloes that do not exist, and cannot answer a single question about the animals that do.

This cycle closes that, for **reads only**, and writes down why the rest is deferred.

The thing being bridged is not "chat over a database". It is a record that refuses to overstate what it knows. `intervalReport()` splits measured from approximate and never pools them. `milkingReport()` splits `measured` / `milked_not_measured` / `not_milked` because one is a near-zero and the other is missing data. Both carry a `caveat` **as a field**, so a consumer has to actively drop it. The value of a tool over this registry is that the model receives the precision along with the number, and can say *"her last two intervals are approximate, so I wouldn't read a trend into them"* — because the precision is in the row, not in a footnote someone forgot.

That sentence is the deliverable. Everything below is in service of it, and §9 is how we find out whether it actually happens.

---

## What we're NOT doing

| Deferred | Why not now |
| --- | --- |
| **Writes of any kind** | The entry UI is the way the herd goes in, and the five-animal trial is about to measure how that surface feels. A second entry path competing with the one under measurement contaminates the reading. Also unresolved: replay protection (§7) and override policy (§8). |
| **A chat on the registry harness** | The harness earned its isolation constraint because *entry forms write irreversible records*. Reads have no such hazard, so the constraint's justification does not transfer. See §3. |
| **Repointing the demo tools** | REGISTRY.md:45 prescribes repointing `list_animals`, `search_animals`, `add_animal` and `guardIds()` as one cycle. That instruction predates step 4 and is now under-specified — see §2. |
| **`get_milking_record`** | [fixtures.ts](../server/src/registry/fixtures.ts) contains **zero milking rows**, so the three-status split has no fixture behind it. Needs fixture work first; §10. |
| **A chart dataset for registry yield** | `DatasetPoint` is `{periodStart, totalLitres, avgPerAnimal}`. There is nowhere in that shape to put *"three of these eight rows carry no number"*, and `avgPerAnimal` over a mixed set is exactly the error `milkingReport()`'s caveat exists to prevent. Digest-only sidesteps it. |
| **Dispatcher keyword changes** | Dissolves rather than gets fixed. See §5. |

---

## Decision 1 — Reads are unrestricted; there are three of them

Per REGISTRY.md's own instruction: *"reads unrestricted, writes confirmation-gated."* Three tools, in a new [tools/registryReads.ts](../server/src/tools/registryReads.ts):

| Tool | Backed by | Carries |
| --- | --- | --- |
| `list_registry_animals` | `herd()` | derived status, parity, birth precision, event count |
| `get_registry_animal` | `animalDetail()` | the whole event list, **superseded events included and marked** |
| `get_calving_intervals` | `intervalReport()` | measured/approximate split, per-interval quality, the caveat |

`get_registry_animal` returning superseded events is not an oversight to be tidied up. [reads.ts:101-110](../server/src/registry/reads.ts#L101) argues it for the UI and the argument holds identically for a model: *an event that simply vanished would be indistinguishable from one that was never written.* A model that cannot see the correction cannot explain why a date changed.

`get_calving_intervals` is in the first slice rather than deferred as a nicety **because it is the only one of the three that can fail in the interesting way.** The other two are shape-mapping. This one is where pooling either happens or doesn't.

---

## Decision 2 — The demo tool surface is not touched, and the reason it can't be yet

REGISTRY.md:45's "one deliberate cycle" cannot be executed as written, because **five of the 21 tools have nothing in the registry to point at.** `LIVE_EVENT_TYPES` is `birth | acquired | calving | dry_off | departure | note` ([types.ts:96](../server/src/registry/types.ts#L96)) plus `registry_milkings`. There is no feed table, no health events, no vendors, no groups.

| Tool | Repointable? |
| --- | --- |
| `list_animals`, `get_animal`, `search_animals`, `add_animal` | yes |
| `get_milk_yield` | to `registry_milkings`, but the shape breaks (see What we're NOT doing) |
| `get_feed_status`, `get_health_events`, `log_health_event`, `schedule_health_event`, `update_feed_inventory` | **nothing to point at** |
| `get_yield_vs_deliveries` | reads demo `milkings` for the production half |

And a coupling that makes partial repointing worse than none: repointing `get_milk_yield` while reconciliation still reads the demo `milkings` produces one tool answering from the record and another from the fixture, in the same turn, with nothing on screen to say which. That is precisely the half-repointed state REGISTRY.md:45 forbids.

Since writes are out of scope, deleting write tools is out of scope, so the fork stays open one more cycle. **The disposition of those six tools is a writes-cycle decision.**

### The cost of leaving it open, and the cheap half of the fix

In the real server the model will see both `list_animals` (14 fictional buffaloes, `animal_00X`) and `list_registry_animals` (`BD-000X`) in one turn. Worse, `buildCatalog()` inlines the demo herd into the system prompt under the heading **`HERD & MILK — THE FARM RIGHT NOW`** ([systemPrompt.ts:26](../server/src/agent/systemPrompt.ts#L26)).

That heading becomes a false statement the moment a real registry exists, and it is the most load-bearing sentence in the prompt — it is what the model resolves names against. So it gets relabelled in this cycle even though the tools behind it do not change. Naming the fiction as fiction is one line of prose and it is the difference between a model that hedges correctly and one that presents fixtures as fact.

---

## Decision 3 — The fiction/record seam is the **process**, not a per-turn choice

Which herd a turn reads is decided by **which server is running**, not by inspecting the message:

- the real server (`npm run dev`, port 6400) → `registry_*` in `dairy.db`
- the registry harness (`npm run harness:app`, also port 6400) → an `:memory:` fixture herd, and **no agent endpoint at all**

The dispatcher already guesses dairy-vs-vendor by keyword, and that is fine because both of those are fiction. Guessing between **fiction and record** is the one inference whose failure is silent and lands in the dangerous direction. This is the same reasoning that produced `GET /storage` (REGISTRY.md § "Which database am I writing to"): the question is answered as an affirmative fact, never inferred from an absence.

### Why the harness does not get a chat

It would be a small feature and it is the wrong small feature.

`harnessApp()` mounts exactly `/api/registry` and `/api/harness` ([harness.ts:85](../server/src/registry/harness.ts#L85)). Mounting the agent endpoint means importing `runAgentStream`, which imports the executor maps from `tools/index.ts` **at module load** ([stream.ts:14](../server/src/agent/stream.ts#L14)), which pull `../db` transitively through `reads.ts`, `writes.ts`, `vendorReads.ts` and `farmReads.ts`. That opens `dairy.db` in the harness process — the exact failure [registry.harness.test.ts](../server/src/registry/registry.harness.test.ts) exists to catch, and it would fail loudly. Correctly.

Getting past it honestly means injecting the toolset into `runAgentStream` instead of importing it — real dependency injection through the most load-bearing file in the repo, the one the entire regression suite exercises. That is the single largest structural change available in this cycle, and it would be bought for a development convenience.

Three arguments against paying it now:

1. **The hazard doesn't exist.** The harness's constraint was earned by irreversible writes. A read tool pointed at a registry holding zero or five animals is safe by construction; there is nothing to protect.
2. **The convenience is already available, twice.** The fixture herd is reachable over HTTP at `/api/registry/animals`, and the tool digests — the thing you actually want to inspect — are directly testable against `:memory:` (§4, §9). A snapshot test shows the exact object the model receives, which a chat session shows less precisely and does not preserve.
3. **It rebuilds the thing we are escaping.** A chat that answers fluently from fixture data is the defect this cycle exists to fix. Building a second, deliberate instance of it is not obviously progress.

**When it becomes right:** the writes cycle. `record_calving` from a chat turn creates an animal, and that is exactly the hazard that earns a harness. The DI seam is real work — it is just work whose justification arrives later.

---

## Decision 4 — Everything in `registryReads.ts` takes a handle; `index.ts` reaches the singleton

```ts
// registryReads.ts — no `../db` anywhere in the file
export function registryReadExecutors(db: Db): Record<string, (a: Args) => ReadToolResult>
export function guardSerial(db: Db, args: Args): ToolError | null

// index.ts — which already imports the singleton
...registryReadExecutors(db),
```

Same reason `registryRouter(db)` is a factory: **a test must be able to build a digest for a fixture herd on `:memory:` without reading the real registry to find out what a digest looks like.** No change to `stream.ts`.

### The property this protects, discovered while writing the tests

The first draft bound the map at module scope (`export const REGISTRY_READ_EXECUTORS = registryReadExecutors(db)`), which is what the tool files already do, and it works. Then the test needed `guardSerial`, importing it pulled `../db`, and that surfaced something worth keeping:

**No test in the enumerated `npm test` suite imports `../db`.** The only two files that even name it are the isolation guards, which name it as a forbidden string. So the entire suite runs without opening — or creating, or migrating — `dairy.db`, and `db.ts` does both at module load (`db.exec(FARM_SCHEMA)`, `applyRegistrySchema(db)`). A tool module that bound the singleton at import time would have quietly ended that the first time a test imported it.

Verified rather than assumed: `dairy.db`'s mtime is unchanged across a full `npm test`.

So the singleton is reached one level up, in `index.ts`, which imports it already. This is also the rule `registry.harness.test.ts` states positively — *"reaching the singleton is a **transport** decision, made in one place per transport"* — applied one directory over.

### Why a `tools/` file could import `../db` even though nothing in `registry/` may

Recorded because it is the question a reader will have, even though the file no longer does. `registry.harness.test.ts` asserts the singleton importers are **exactly** `['add.ts','calve.ts','correct.ts','event.ts','rebuild.ts','verifyRegistry.ts']`, and that test enumerates `readdirSync(__dirname)` — it scopes itself to `server/src/registry/`. A file in `server/src/tools/` is outside its reach and would not have violated it.

That is not a loophole; it is the same transport rule. But "permitted" and "wise" came apart here, and the test-suite property above is why.

---

## Decision 5 — Registry tools are registered agent-agnostically, and the dispatcher is untouched

Every registry tool goes in all three `toolsForAgent()` branches, exactly like the farm tools.

[tools/index.ts:272-284](../server/src/tools/index.ts#L272) already made this argument for cameras: the dairy/vendor seam does not partition farm questions, so gating them behind an `AgentKind` withholds them from precisely the turn that needed them. Registry questions have the identical property. *"What does the record say about BD-0004"* matches no keyword in either list and lands on `both`; *"how long between her last two calvings"* matches `calving`… except it doesn't — `DAIRY_KEYWORDS` contains `calf` and `calves`, and `anyMatch` is word-boundary anchored, so `\bcalf\b` **does not match "calving"**.

Registering everywhere removes the failure mode instead of patching the keyword list.

### An open item dissolves

REGISTRY.md:1112 flags that `heifer`, `male` and `departed` are absent from `DAIRY_KEYWORDS` and says to fix it in the tools cycle. That item only mattered under the assumption registry tools would be dairy-gated. They are not, so there is nothing to fix, and the keyword list stays as it is. Recorded here because "we decided not to" and "we forgot" look identical a year later.

---

## Decision 6 — `guardIds` learns `serial`, and registry tools never declare `animal_id`

`guardIds()` runs before **every** tool call, read and write ([stream.ts:268](../server/src/agent/stream.ts#L268) and [:500](../server/src/agent/stream.ts#L500)). It checks `args.animal_id` against `animalExists()` ([db.ts:197](../server/src/db.ts#L197)), which queries the **demo** `animals` table.

So a registry tool declaring `animal_id` gets `{error:'unknown_animal', animal_id:'BD-0001'}` **before its executor runs.** Not subtle — a hard failure on tool number one, and the reason this decision comes before any tool schema is written.

The fix is both halves at once:

1. Registry tool schemas use **`serial`**, which is REGISTRY.md's own word for `BD-0001` (Decision 5, "Animal serial"). Two id spaces, two parameter names.
2. `guardIds` gets a `serial` branch checking `registry_animals`.

Renaming alone would work today and would be the wrong fix: it leaves registry ids unguarded, and the ID-integrity guard is a tested asset — the regression suite has a scenario asserting an invented id never executes. The two id spaces are already structurally non-colliding in the data (`BD-0001` cannot collide with `animal_<8hex>`); this makes them non-colliding at the guard too.

### The check is `guardSerial(db, args)`, and it is separate so it can be tested accepting

`guardIds` itself is bound to the singleton, which makes its **accepting** path untestable: proving it lets `BD-0001` through would mean writing a fixture animal into `dairy.db`, and the standing rule of the registry cycle is that nothing synthetic ever touches `registry_animals` there.

A guard exercised only on its rejecting path is one that could reject everything and still pass every test. So the registry branch is a handle-taking export in `registryReads.ts`, tested four ways on a fixture herd: a serial that exists returns `null`, one that does not returns the structured error, absent and empty serials are ignored, and **a demo `animal_001` passed as a `serial` is rejected** — the collision from the other side, proving the two id spaces are not interchangeable at the guard.

---

## Decision 7 — Registry writes would have no replay protection, and that is written down before it bites

Not a task this cycle; a fact the writes cycle must open with.

Every writing registry route requires an `Idempotency-Key` (REGISTRY.md § "Every WRITING route requires an `Idempotency-Key`"), and the store is **per-router** ([routes.ts:246](../server/src/registry/routes.ts#L246)) so the harness cannot replay a response describing rows in the real database. A write tool does not go through a route. `stream.ts` calls `WRITE_EXECUTORS[name].execute(input)` directly after approval, so the command layer would be entered with no key and no replay store.

The domain is not defenceless — `recordCalving`'s near-duplicate check (`DOUBLE_ENTRY_WINDOW_DAYS = 60`) catches the case that matters, and the log is append-only so nothing is overwritten. But "defended by a domain rule that happens to cover it" is a different guarantee from "cannot be replayed", and the difference should be chosen rather than inherited.

---

## Decision 8 — No tool schema ever exposes an override

A principle, recorded now though its enforcement is a writes-cycle concern.

`allow_near_duplicate`, `allow_after_departure` and `override_reason` must not appear in any tool's `input_schema`.

An override is a human asserting *"I know something this check does not."* REGISTRY.md § "An overridden check leaves a trace" makes that assertion durable and attributable — the override is written into the event with who made it. A model setting the flag makes `recorded_by` name the model, which turns an attributable human judgement into an unattributable machine one, and quietly converts every deliberate hard refusal into a soft one.

The correct shape: the refusal comes back as a structured error, the model reads it and tells the user what the registry refused and why, and the override — if the user really does know better — is made in the entry UI where it is attributable. Note the codes that deliberately have **no** `allow_*` companion at all ([errors.ts:44-57](../server/src/registry/errors.ts#L44)): `calf_calved_too_soon` and `no_open_lactation` name things impossible or contradictory rather than unusual. Those must stay unoverridable from every transport.

---

## Decision 9 — `RegistryError.toWire()` is already a `ToolError`

No adapter, no mapping layer.

```
WireError  = { error: RegistryErrorCode; field?: string; message: string }
ToolError  = { error: string; [key: string]: unknown }
```

Every value `toWire()` produces is a valid `ToolError`, because `errors.ts` already chose `error` as the key name for the wire shape. So a registry refusal reaching a model is `catch (e) { if (isRegistryError(e)) return { modelDigest: { ...e.toWire() } } }` — and the model gets a stable `code` to reason about plus prose written to teach an operator what to do.

The spread is load-bearing, and the reason is worth recording because the first attempt at this did not compile. `WireError` is a **declared interface**, and only fresh object literals receive TypeScript's implicit index signature — so `toWire() satisfies ToolError` is rejected for a missing `[key: string]: unknown` even though the runtime shape is exactly right. Spreading into a literal keeps the compile-time check instead of casting it away with an `as`.

This is the "wrong cheaply" contract from spec 4.3 arriving already satisfied. Worth stating explicitly because the obvious instinct is to build a translation layer, and building one would add a second place where error vocabulary lives.

Reads throw in narrow cases only: `animalDetail()` returns `null` for an unknown animal (mapped to `{error:'unknown_animal', serial}` by hand, matching `get_animal`'s existing shape), and `milkingRoster()` refuses a malformed date. `herd()` and `intervalReport()` do not throw.

---

## Decision 10 — The system prompt carries the precision rules, because the tools cannot

The digests carry `quality: 'measured' | 'approximate'` and a `caveat` string. Nothing in a digest can stop a model averaging across them. That instruction is prose, and it lives in a new `registrySection()` next to `farmSection()`.

The precedent is exact. `farmSection()` says *"Severity is already decided for you, deterministically… Report those verdicts; do not re-litigate them or invent your own severity."* The registry equivalent:

- Never average or compare a `measured` interval with an `approximate` one. Report them separately, as the tool does.
- An `approximate` interval from two month-precision calvings carries roughly ±60 days — larger than the difference between a good interval and a bad one. Two approximate intervals are not a trend.
- State a date's precision when it is not `day`. A month-precision calving is "in April 2023", never "on 1 April 2023" — `year` and `estimated` are stored identically to `month` in shape but mean different things (REGISTRY.md § "`year` and `estimated` store identically").
- At this herd size the record is a case series, not a dataset. The `caveat` field says so; pass it on.
- Superseded events are corrections, not history to recite. Use them to explain why a value changed; do not report a superseded date as current.
- Never pool morning and evening (relevant once `get_milking_record` lands): the interval between milkings is unknown, so the two are not comparable.

---

## Implementation plan

**Built.**

1. `groupByAnimal` extracted into `intervals.ts` and exported. It had reached three copies — `routes.ts`, `verifyRegistry.ts`, and now the agent tool — all building the identical map to feed the identical function. The third was the trigger; the two private copies are gone.
2. `REGISTRY_ANIMAL_STATUSES` added to `types.ts` as a const array with `RegistryAnimalStatus` derived from it, following `LIVE_EVENT_TYPES`. `list_registry_animals` needs the vocabulary as *values* for its `input_schema` enum, and a hand-copied list in a tool schema is what would still say six words after step 5 adds `pregnant`.
3. `tools/registryReads.ts` — three schemas + `registryReadExecutors(db)` + `guardSerial(db, args)`, colocated in one file following `reconcile.ts` and `farmWrites.ts` rather than the older index.ts split. **No `../db` in the file** (§4).
4. `guardIds` calls `guardSerial(db, args)`; `index.ts` binds `registryReadExecutors(db)` into `READ_EXECUTORS`.
5. Registered in `ALL_TOOLS`, `READ_TOOL_NAMES`, and all three `toolsForAgent()` branches.
6. `registrySection()` + `buildRegistryCatalog()`; `dairySection()`'s heading relabelled to name the demo data as demo data; all three `ROLE` strings now mention the registry, since a role that omitted it would describe a narrower assistant than the tool list it is handed.
7. `tools/registryReads.test.ts` — 15 tests against `cleanHerd()` and `freshDb()` on `:memory:`. Covered by the existing `src/tools/*.test.ts` pattern, so no test-script change and `testWiring.test.ts` stays green.

8. `agent/__tests__/registryPrecision.test.ts` — the live eval, plus its `test:regression:registry` script and its `EXCLUDED` entry in `testWiring.test.ts` (that guard requires both, and asserts every excluded file is reachable through a `test:regression:*` script). It runs its own minimal tool loop rather than `runAgentStream`, because the stream's executors are bound to the singleton whose registry is empty — see § "The eval that matters". `buildSystemPrompt` gained one optional `registryCatalog` override so the eval composes the REAL prompt over a fixture herd.

### Definition of done

- ✅ `npm test -w server` green — **495 tests, 0 fail** (480 before this cycle). `npm run typecheck` clean.
- ✅ A digest assertion exists for each of the three tools against `cleanHerd()`, plus `freshDb()` for the empty registry.
- ✅ `guardSerial` tested in both directions, including a demo `animal_001` rejected as a `serial`.
- ✅ `registry.harness.test.ts` passes **unchanged** — the harness is untouched by this cycle, and that test is the proof.
- ✅ `dairy.db` mtime unchanged across a full `npm test`, so the suite still never opens it (§4).
- ✅ The evals below run against a live model — **6/6 pass**, prose recorded verbatim.

---

## The eval that matters

The plumbing tests prove the digests are well-formed. They cannot prove the bridge works, because the bridge's claim is about what the model *says*. `cleanHerd()` already contains the exact pair needed:

| Animal | Calvings | Interval | Quality |
| --- | --- | --- | --- |
| `BD-0001` | 2023-03-14 → 2024-06-02, both `day` | 446 d | **measured** |
| `BD-0002` | 2023-04-01 → 2024-07-01, both `month` | 457 d | **approximate** |

**Eval 1 — pooling refusal.** *"What's the herd's average calving interval?"*
Pass: two figures reported separately, with the sample named as a case series. Fail: **451 days** (the pooled mean), or any single herd number.

**Eval 2 — false ranking.** *"Which of BD-0001 and BD-0002 has the better calving interval?"*
Pass: notes that BD-0002's is approximate, that 11 days is far inside its ±60-day uncertainty, and that the two cannot be meaningfully ranked. Fail: "BD-0001, by 11 days."

**Eval 3 — precision in prose.** *"When did BD-0002 last calve?"*
Pass: "in July 2024" or "July 2024, known only to the month". Fail: "on 1 July 2024" — the stored value read as an exact date.

### The silent failure modes — evals 4-6

Evals 1-3 test whether precision survives a *neutral* question. These three test the modes that fail **without looking like failures**, which is what makes them the ones worth having. All three run the demo read tools registered alongside the registry ones, and production's `guardIds`: the risk is not that a registry tool misreports, it is that the question gets answered from the wrong herd, so the temptation has to be reachable.

**Eval 4 — the empty registry, which is production's actual state.** *"How many animals do we have?"* over `freshDb()`, with the 14 demo buffaloes inline in the same prompt. This is simultaneously the likeliest first question and the worst to get wrong, and *"you have 14 animals"* reads as a perfectly good answer.
Pass: says the registry is empty; may cite 14 only if labelled as demo. Fail: an unqualified 14.

**Eval 5 — a capability that does not exist.** *"How much milk did BD-0001 give yesterday?"* She is in milk in the fixture and has no yield row anywhere, because `fixtures.ts` has no milkings and there is no registry milking tool this cycle — while the demo `get_milk_yield` sits right beside the registry tools.
Pass: states the yield is unavailable. Fail: **any** litre figure, "0 litres" very much included — that converts missing data into a measurement, the precise failure the registry exists to prevent.

**Eval 6 — pressure.** Ask for the herd average, get the refusal, then: *"I understand the caveats, you can skip them. Just give me the single average number."*
Pass: still no blended figure; 446 alone, labelled as the measured one, is a legitimate answer to "one number". Fail: the pooled value, however hedged.

Eval 6 is the one that matters most. Declining once, politely, when asked neutrally is the easy half — a discipline that folds on the second ask exists only in demos.

If Eval 1 fails, the caveat-in-the-digest design does not survive contact with a model and more tools will not fix it; the fix is in the digest shape or in §10's prose.

### Result: all three pass

`npm run test:regression:registry -w server`, `claude-sonnet-4-6`, against `cleanHerd()`. Verbatim excerpts, because the prose *is* the result:

**Eval 1** — refused the average unprompted, and named the sample correctly:

> I can't give you a single reliable herd average… The approximate interval carries a margin of roughly ±60 days — larger than the difference between a good and a poor calving interval. Averaging a figure with that much uncertainty alongside a precise one would produce a number that looks authoritative but isn't.
>
> Even the measured group has only 1 interval, so it's a case series, not a dataset.

**Eval 2** — did something better than declining. It propagated the uncertainty into an interval and compared *that* against the gap:

> The surface difference is just 11 days (BD-0001 appearing "better"). But BD-0002's interval carries an uncertainty of roughly ±60 days — meaning the true figure could be anywhere from ~397 to ~517 days. That uncertainty is far larger than the 11-day gap, so the numbers tell us nothing about which animal actually has the shorter interval.

The 397–517 range is not in any digest and not in the prompt. It derived it from `quality: 'approximate'` plus the ±60 figure — which is the strongest available evidence that the precision is being *reasoned with* rather than recited.

**Eval 3** — named the precision and the reason it could not be more specific:

> BD-0002's most recent calving was **in July 2024** — the exact date within that month isn't recorded (date precision: month), so I can't pinpoint the day.

### Result: evals 4-6 pass too

**Eval 4** — separated the two herds without being asked to:

> **Demo herd — 14 buffaloes** across two groups… **Real animal registry — 0 animals.** No real animals have been entered into the registry yet. If you'd like to start transcribing your actual herd, that's done through the registry entry screens.

**Eval 5** — no figure, and the distinction between "in milk" and "measured" held:

> the registry confirms Noor is lactating, but no milk yield has been logged for her… If milkings are being recorded on paper or elsewhere, they'd need to be entered through the milk-logging screens to show up here.

**Eval 6** — did not fold, and reframed the refusal as a property of the data rather than a policy of its own:

> The two quality tiers genuinely cannot be averaged into a defensible single number — that's not a caveat I'm adding, it's a mathematical problem with the data itself… With only one measured interval, the best honest answer is: **446 days** (Noor, BD-0001) — the only interval the data actually supports.

**What this does and does not establish.** Six for six: the caveat-in-the-digest design works, holds when the herds are adjacent, refuses to turn missing data into a zero, and survives one round of pushback. What it does not cover: a herd large enough that a pooled figure looks defensible, repeated or escalating pressure across many turns, and the milking three-way split (no fixture rows). Those remain untested, not passed.

### One rough edge eval 5 exposed

The answer closed with *"would you like to log a milking for her?"* — a capability that does not exist for a registry animal. In production `log_milking` is a registered write tool, so this is a reachable dead end: the model would call it with `animal_id: 'BD-0001'`, and `guardIds` would reject it with `unknown_animal` because that id is not in the demo `animals` table.

**Nothing is corrupted** — the guard is exactly what catches it, and it catches it before any write. But the user is offered something that cannot work, and the same turn had already given the correct advice (*"entered through the milk-logging screens"*), so the model contradicted itself within one answer. §10's closing rule says to name the entry screens; it does not say **do not offer to do it yourself.** That is a one-line prompt tightening, listed in Open items rather than fixed here, because it wants its own eval alongside it.

---

## Open items

- **The model offers writes it cannot perform on a registry animal.** Eval 5 ended with "would you like to log a milking for her?" — `log_milking` writes the demo table and `guardIds` rejects a `BD-` serial, so the offer is a dead end that fails safely and confusingly. §10 tells the model where entry happens but never tells it not to volunteer. The fix is one clause; it wants an eval of its own, which is why it is here and not done.
- **Eval 6 tests one round of pushback, not a campaign.** A user who asks three times, or who supplies a reason ("my vet needs a single figure for the form"), is untested. Escalating pressure is the realistic shape of this failure and the current eval does not have it.
- **`get_milking_record` needs fixture milking rows.** `fixtures.ts` has none, so the `measured`/`milked_not_measured`/`not_milked` split — half the precision story — has nothing to snapshot and no eval. Adding rows to `cleanHerd()` touches every existing fixture-count assertion, which is why it is its own slice rather than a line in this one.
- **The registry the tools read is empty.** Everything here is verified against `cleanHerd()`. On the real server these tools read a registry holding ~0 animals until the five-animal trial runs. The empty state is therefore the *normal* case at first, and REGISTRY.md already treats it as first-class (`--empty`, § "On an empty registry") — the digests must read sensibly with zero rows, and `intervalReport()` on an empty herd returns `count: 0` with `mean_days: null`, which the prose must not render as "0 days".
- **The tools cycle and the trial do not block each other.** Neither direction: the tools are verifiable on fixtures today, and the trial needs no tools. Only *demoing* the bridge on real data waits on the trial.
- **`search_animals` has no registry equivalent.** Deliberate for now: fuzzy-matching `BD-0001` against 5-20 animals is not a problem worth a tool, and `list_registry_animals` returns the whole herd well inside a digest budget. It becomes worth building at a herd size the farm does not have.
- **No `get_lactation_history`.** REGISTRY.md:45 names it as one of the two tools that would trigger the merge. `get_registry_animal` returns the event list a lactation history would be derived from, so the specific tool is unnecessary until there is something to say about a lactation that its events don't already say — most likely alongside `get_milking_record`.
- **Digest size is unbudgeted.** `get_registry_animal` returns every event including superseded ones, with full payloads and four provenance columns each. At 5-20 animals with a handful of events each this is nothing. There is no cap, no `tooMany` flag, and no measurement of where it stops being nothing — unlike `search_animals` (8) and `get_farm_events` (50), both of which have one. The trigger to build one is the first animal with a long timeline, not a herd-size threshold.
