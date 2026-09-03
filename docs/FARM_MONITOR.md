# Farm Monitor Agent — Decision Doc (Cycle 5)

*Status: complete — Phases 00–05, tagged `v0.8.0`. All six scenarios classify
and reconcile green via `verify:classify`, with Cycle 4's `verify:farm` still
passing unchanged. Validated against the merged `v0.7.0` state of the repo, not
the pre-review draft. Prerequisite: [FARM_EVENTS.md](FARM_EVENTS.md) (Cycle 4)
complete and tagged `v0.7.0`.*

## Context

Cycle 4 built the plumbing: a `farm_events` table, real-shape ingestion from
Frigate/Double Take, a six-scenario synthetic generator, and a verification
script. Nothing in Cycle 4 reads those rows for meaning — it only proves they
land correctly.

Cycle 5 adds the first layer of meaning: a classifier that reads `farm_events`
and decides which rows are routine, notable, or urgent, plus a reconciliation
pass that reasons across a day's events the way `get_yield_vs_deliveries`
reasons across a day's production and deliveries. This is scoped as
**classification core only** — see *What we're NOT doing*.

## What we're NOT doing

- **No vision captioning.** None of the six Cycle 4 scenarios need an image
  to classify correctly — `night-visitor-unknown` resolves from zone + time +
  identity alone, `low-confidence-match` resolves from a confidence number.
  Building captioning now would be inventing a producer for a need nothing
  has demonstrated yet, the same pattern `camera_offline` was cut for in
  Cycle 4. It belongs in a later cycle, once a real scenario exists that
  structured fields can't resolve.
- **No AG-UI streaming, no Telegram.** More honestly motivated once real
  events are flowing continuously — a dashboard watching a burst-mode
  synthetic replay finish in milliseconds doesn't prove much. Revisit once
  hardware exists, or if the blog demo specifically wants a playback
  experience — a deliberate call, not a default.
- **Cluster recurrence is a weighted signal, not a fact.** Cycle 4's fidelity
  notes are explicit that Double Take does not cluster faces — the fixed
  `unknown_a1`-style ids are a synthetic simplification, not a promise about
  what Cycle 7's real ids will behave like. The classifier must not treat "N
  prior sightings of this cluster id" as ground truth the way it treats a
  confirmed `face_match` identity; it's a count that raises severity, nothing
  more. Decision 8's priority order encodes this: a restricted-zone/off-hours
  fact outranks any recurrence count.
- **No unflagging / no flag history.** `flag_anomaly` is last-write-wins on a
  given event. Multiple classification passes overwriting each other's
  verdict, or a human correcting a false flag, are real needs eventually —
  not needed for six scenarios on synthetic data now.
- **No scheduling.** Whether `summarize_daily_activity` runs on a cron versus
  only when the orchestrator is asked is a real product decision, but nothing
  in this cycle depends on the answer. Left open.

## Decision 1 — Classification is deterministic, not model-invoked

The obvious design is "ask Claude to classify each event." The actual design
is a plain rule-based function, for the same reason Cycle 3 kept the
regression suite's assertions deterministic where possible: a threshold
comparison is testable and free; a model call per event is neither, and none
of the six scenarios need judgment a rule can't express — they need a
confidence number compared to a threshold, a zone checked against a set, a
timestamp checked against a window, and (for one scenario) a count of prior
sightings.

So: `classify.ts` is a pure scoring function — event in, `routine` /
`notable` / `urgent` out — using the constants in Decision 3 and the priority
order in Decision 8. It is not an agent tool and does not call the Anthropic
SDK.

### The structural precedent is `reconcile.ts`, not `dispatch.ts`

The draft of this doc claimed the shape mirrored "a dispatcher that
routes/decides, and a reconciliation pass that narrates." Validation against
the merged code showed that description was wrong in both halves:

- [`agent/dispatch.ts`](../server/src/agent/dispatch.ts) is a keyword-matching
  **agent selector** (`dairy` | `vendor` | `both`) whose only job is choosing
  which tool set is advertised for a turn. It never classifies a record and
  never decides an action. It is not a precedent for scoring events.
- [`tools/reconcile.ts`](../server/src/tools/reconcile.ts) is the actual
  precedent, and a closer one than the draft claimed: a pure deterministic
  function, an exported named threshold (`RECONCILE_TOLERANCE_PCT = 5`), and a
  `modelDigest` carrying both totals, the gap, the tolerance, and a `flagged`
  boolean. It returns **numbers, not prose.**

Narration is pushed one layer up, into the system prompt. `reconcileSection()`
in [`agent/systemPrompt.ts`](../server/src/agent/systemPrompt.ts) tells the
model to "explain the likely causes rather than just stating the number." That
is where the model earns its keep: classification and reconciliation are
mechanical, synthesis is instructed.

This matters beyond style. `runReads()` in
[`agent/stream.ts`](../server/src/agent/stream.ts) is **synchronous** —
`READ_EXECUTORS[r.name](input)` is called and its `modelDigest` consumed
inline. A read executor physically cannot `await` an SDK call without making
`runReads` async and reworking the tool loop. A tool that "writes the digest"
by calling the model is not a stylistic preference to be traded off; it does
not fit the harness.

## Decision 2 — Flags persist as additive columns on `farm_events`

Considered a separate `farm_event_flags` table; rejected because the
relationship is 1:1 and a join buys nothing at this scale. (The draft cited an
`is_synthetic`-over-a-side-table precedent from Cycle 4 — that debate does not
appear in FARM_EVENTS.md, which justifies `is_synthetic` as avoiding a *later*
schema change. The 1:1 argument stands on its own; the citation is withdrawn.)

```sql
classified_at   TEXT,     -- ISO-8601 UTC; NULL = not yet examined
flagged         INTEGER NOT NULL DEFAULT 0,
flag_severity   TEXT,     -- 'notable' | 'urgent'; NULL when flagged = 0
flag_reason     TEXT      -- NULL when flagged = 0
```

`classified_at` matters on its own: without it, a routine event (`flagged =
0`) is indistinguishable from an event nobody has looked at yet. Every row
the classifier touches gets `classified_at` set, whether or not it ends up
flagged.

`flagged` follows the `deliveries.paid` / `farm_events.is_synthetic`
precedent: stored `0`/`1`, normalized to a boolean by `toFarmEvent()`.

### The schema gap, stated accurately

`farm_events` uses `CREATE TABLE IF NOT EXISTS`, so adding columns to
`FARM_SCHEMA` does **nothing** to a `dairy.db` that already has the table.
Validation confirmed this is real and not hypothetical: the table exists in
`server/dairy.db` with the exact Cycle 4 DDL.

What the draft got wrong is the data side. That table holds **zero rows**,
because [`verify.ts`](../server/src/farm/verify.ts) calls `resetFarmEvents()`
on exit by design — "leave the table clean rather than with the last
scenario's rows in it." So there is nothing to lose and nothing to recover.
This repo has no migration system and Cycle 5 shouldn't introduce one for four
nullable columns; the resolution is simply to **drop the local table and let
`FARM_SCHEMA` recreate it** at module load. Documented here so it reads as a
decision, not a bug report, when someone's local `verify:farm` starts failing
with a missing-column error.

> **Superseded in part by Cycle 8.** "This repo has no migration system" was
> true when written and is the reason for the decision above; it is no longer
> true. [REGISTRY.md](REGISTRY.md) Decision 2 built one — `PRAGMA user_version`,
> global rather than registry-specific, applied at `db.ts` load — and cites
> *this section* as its motivation: `IF NOT EXISTS` doing nothing to an existing
> table is tolerable for four nullable columns on a table that holds zero rows
> by design, and intolerable for the one set of tables whose rows cannot be
> regenerated from software.
>
> Nothing here changes. `farm_events` is still `CREATE TABLE IF NOT EXISTS` and
> still not retrofitted into migration history — a migration claiming to have
> created it would be a lie — so the drop-and-recreate step remains what a
> pre-Cycle-5 `dairy.db` needs. What changed is that a *future* column addition
> has somewhere to go.

### Standing rule — classification-aware population resets per scenario

`simulate:farm --all` replays all six scenarios cumulatively into one table at
one anchor, with no reset between them
([`simulate.ts`](../server/src/farm/simulate.ts) loops `replayScenario` and
never clears). For Cycle 4's ingestion-only purpose that is correct and
remains supported.

It is **not** safe for anything classification-aware, because
`UNKNOWN_CLUSTER_A1` appears in *two* scenarios — once in
`night-visitor-unknown` and three times in `recurring-unknown-visitor`. Replay
them into one table and that cluster has four sightings in one lookback
window: `night-visitor-unknown`'s "first sighting" is no longer first, and
`recurring-unknown-visitor`'s occurrence numbers shift. Running the command
twice doubles the counts again.

**Standing rule for this cycle and everything built on it: any
classification-aware population of `farm_events` — Phase 05 verification, any
local demo, any future eval — calls `resetFarmEvents()` before each scenario,
the way `verify.ts` already does per scenario. `simulate:farm --all` is for
ingestion checks only and must never be the basis for a recurrence
assertion.**

## Decision 3 — Thresholds and windows

Explicit named constants, not magic numbers, following the
`ENROLLED_IDENTITIES` precedent:

```typescript
export const CONFIDENCE = {
  /** face_match at/above this is treated as a confident identification.
   * Gated to event_type === 'face_match' ONLY -- see Decision 8. */
  MATCH_CONFIDENT: 0.85,
};

export const RECURRENCE = {
  NOTABLE_AFTER: 1,   // occurrence 1+ of an unknown cluster -> notable
  URGENT_AFTER: 3,    // occurrence 3+ within the lookback window -> urgent
  LOOKBACK_DAYS: 21,
};

export const RESTRICTED_ZONES: ReadonlySet<string> = new Set(['feed_store']);

export const WORK_HOURS = { start: '04:00', end: '20:00' }; // farm-local
```

### `MATCH_CONFIDENT = 0.85` — checked against the scenarios

The separating band across all six scenarios is `(0.386, 0.901]`: the highest
low-confidence face is `0.386` (`low-confidence-match`), the lowest confident
match is `0.901` (`absent-employee`). `0.85` sits comfortably inside it.

**The threshold must be gated to `event_type === 'face_match'`.** Detection
rows carry Frigate's object-detection score in the same `confidence` column,
ranging `0.72`–`0.93` across the library. Applied unconditionally,
`normal-weekday`'s `0.76` yard detection would flag notable and break that
scenario's "every row lands routine."

### `RECURRENCE` — compared on occurrence number, not prior count

`scoreEvent` receives `priorSightingCount`. Comparing that directly against
these constants is off by one in both directions: occurrence 1 has
`priorSightingCount = 0` (`0 < NOTABLE_AFTER` → never notable) and occurrence
3 has `priorSightingCount = 2` (`2 < URGENT_AFTER` → never urgent), which
contradicts Decision 6's table outright.

The fix is the comparison, not the values:

```typescript
const occurrenceNumber = priorSightingCount + 1;
if (occurrenceNumber >= RECURRENCE.URGENT_AFTER) return 'urgent';
if (occurrenceNumber >= RECURRENCE.NOTABLE_AFTER) return 'notable';
```

Which yields exactly the intended gradient: occurrence 1 → notable, 2 →
notable, 3+ → urgent.

### `LOOKBACK_DAYS = 21` — and the window is event-relative

The lookback is measured **backwards from the event being classified**, not
from wall-clock now: prior sightings are those with the same `identity` and
`occurred_at` in `[event.occurred_at - LOOKBACK_DAYS, event.occurred_at)`. This
is the natural reading of "prior sightings within the lookback window," and it
makes classification deterministic regardless of when the pass runs — the
house rule Cycle 4 set with `mulberry32` re-seeding and Cycle 3 followed with
`daysAgo()`-derived windows.

`recurring-unknown-visitor`'s three `unknown_cluster` rows sit at offsets
`2500ms`, `DAY + 2500ms`, and `2 * DAY + 2500ms` from its `01:40:00` start, so
the widest event-relative span the window must cover is **2 days** — a 19-day
margin at `LOOKBACK_DAYS = 21`.

The draft's `14` was rejected for a second reason worth recording, since it
bites on the wall-clock reading too. `startTime` is composed against a
local-noon-anchored `daysAgo()`, so a `01:40` scenario start lands roughly
`anchor + 0.37` days in the past. At the `--days-ago=14` that
[README.md](../README.md) documents as the canonical `--all` invocation, the
oldest sighting is `14.37` days old — **outside** a 14-day window, leaving
only 2 of 3 sightings and making urgent unreachable. Measured against the live
clock, `21` holds at every anchor up to `--days-ago=18`:

| Anchor | In-window | Oldest age | Margin at 21d |
| --- | --- | --- | --- |
| `--days-ago=4` (what `verify.ts` computes) | 3/3 | 4.37d | 16.63d |
| `--days-ago=14` (what README documents) | 3/3 | 14.37d | 6.63d |
| `--days-ago=18` | 3/3 | 18.37d | 2.63d |

### `RESTRICTED_ZONES` and `WORK_HOURS`

`WORK_HOURS = 04:00–20:00` is confirmed farm fact. It places every scenario
unambiguously: `05:30` (`normal-weekday`, `absent-employee`), `06:00`
(`camera-dropout`) and `19:20` (`low-confidence-match`) inside; `02:14`
(`night-visitor-unknown`) and `01:40` (`recurring-unknown-visitor`) outside.
The `19:20` placement matters — under the draft's `19:00` end, that scenario's
plain detection row would have picked up an off-hours flag it is not expected
to have.

`RESTRICTED_ZONES = { 'feed_store' }` is a **working default, not settled
fact** — see *Open items*. The reasoning:

- `feed_store` is the only zone with repo evidence:
  [`scenarios.ts`](../server/src/farm/scenarios.ts) annotates it "Restricted
  after hours — the zone `night-visitor-unknown` fires in."
- **`gate` must be excluded, and this is load-bearing.**
  `recurring-unknown-visitor` fires in `gate` at `01:40`, which is off-hours.
  Were `gate` restricted, occurrence 1 would escalate straight to urgent via
  Decision 8's rule 1, collapsing the notable→urgent gradient that is the
  entire point of treating recurrence as a weighted signal.
- `barn` and `yard` have no evidence either way and appear only during work
  hours, so including them would change nothing today while building ahead of
  the evidence.

## Decision 4 — `FARM_TZ = 'Asia/Karachi'`

Cycle 4 left this open, noting it becomes load-bearing "the moment the Cycle 5
agent reasons about night or off-hours in text" — that's exactly `WORK_HOURS`
and the off-hours check. Confirmed as `Asia/Karachi` (UTC+5, no DST),
consistent with FARM_EVENTS.md's own open item, which already proposed a
`FARM_TZ` const at UTC+5 on the evidence of the `+92` vendor contacts in
`seed.ts`. Nothing elsewhere in the codebase asserts a different farm
timezone.

**`classify.ts` converts `occurred_at` into `FARM_TZ` explicitly and never
trusts host-local time.** The generator does not have this property:
`scenarioStartMs()` composes `daysAgo(n) + 'T' + startTime` with no zone
designator, which JS parses as host-local. On this machine the two agree — a
`01:40` local start stamps as `20:40Z` and converts back to `01:40` — so the
coupling is invisible. On a UTC runner the generator would stamp `02:14Z`,
which converts to `07:14` Karachi and silently puts `night-visitor-unknown`
*inside* work hours, failing the flag it exists to produce.

Explicit conversion makes `classify.ts` machine-independent even though the
generator isn't. `TZ=Asia/Karachi` is pinned on both the `simulate:farm` and
`verify:farm` scripts to close the remaining gap.

## Decision 5 — `classify_event` needs history, so it isn't fully pure

`recurring-unknown-visitor` requires counting prior sightings of the same
cluster id within `RECURRENCE.LOOKBACK_DAYS` — that's a DB read `classify.ts`
alone can't do. Split it:

- **`scoreEvent(event, priorSightingCount)`** — pure, no DB, no Express.
  Takes the count as a parameter. This is what `classify.test.ts` exercises
  directly with `node:test`, the same pure-core pattern `ingest.ts` already
  established in Cycle 4.
- **`classifyEvent(event)`** — the impure shell: queries prior sightings for
  the event's identity within the event-relative window, calls `scoreEvent`,
  and writes `classified_at` / `flagged` / `flag_severity` / `flag_reason`
  back to the row through the shared DB helper in Decision 6.

**The split is across two files, not one.** The draft put both in
`classify.ts`, which cannot satisfy DoD #6: a single module importing `../db`
opens `dairy.db` at module load, so merely importing `scoreEvent` in a unit
test drags a real database in — and creates one on a fresh clone. That is
precisely what `ingest.ts` staying DB-free exists to prevent. So:

- `farm/classify.ts` — constants, farm-local time helpers, `scoreEvent`,
  `lookbackStartIso`. No `../db` import. This is what `classify.test.ts`
  imports.
- `farm/classifyStore.ts` — `classifyEvent` and `classifyEvents`. Imports
  `../db` and `./classify`.

Same pure-core/shell division as `ingest.ts` / `routes.ts`, one file boundary
lower than the draft assumed.

## Decision 6 — Tool contract

Three tools, added to **every** `toolsForAgent()` result regardless of
`AgentKind`. Farm tools are agent-agnostic: no new `AgentKind`, no new
dispatcher keywords, no separate "farm agent" reasoning loop.

The draft assumed "the orchestrator's existing tool array." There isn't one —
[`tools/index.ts`](../server/src/tools/index.ts) holds five arrays partitioned
by `toolsForAgent(agent)` over `AgentKind = 'dairy' | 'vendor' | 'both'`.
Gating farm tools behind a selection would also have left a real hole: farm
vocabulary ("camera", "gate", "visitor") matches no dispatcher keyword and
falls through to `both`, but "who fed the animals last night?" matches
`animals` and `feed`, routes `dairy`, and would have had the farm tools
withheld from exactly the turn that needed them. Agent-agnostic registration
removes the failure mode rather than patching the keyword list.

```typescript
get_farm_events(start: string, end: string, zone?: string, identity?: string)
// READ. Reads farm_events directly. No classification side effect.

flag_anomaly(event_id: string, severity: 'notable' | 'urgent', reason: string)
// WRITE, confirmation-gated. Manual override for a person or the orchestrator
// to flag something the automatic pass missed.

summarize_daily_activity(date: string)
// READ. Classifies the day's unclassified rows, then reconciles, then returns
// STRUCTURED findings. No prose, no SDK call.
```

### The write path is split in two

Writes in this repo pause the run and wait for human approval:
`WRITE_EXECUTORS[w.name].buildCard(...)` emits a card, the run ends, and the
client resumes with approvals. `classifyEvent()` cannot go through that — an
automatic pass over a day's rows must not raise a confirmation card per row.

So there are two entry points onto one SQL statement:

- **`setFarmEventFlag(...)`** — a plain DB helper in `db.ts`, no card, no
  approval. Called directly by `classifyEvent()`.
- **`flag_anomaly`** — a registered `WRITE_EXECUTOR` with `execute` and
  `buildCard`, matching the shape of the vendor write executors, for the
  human-approval manual-override path. Its `execute` calls the same helper.

`event_id` is validated by a `farmEventExists()` check added to `guardIds()`,
following the convention that every tool's ids are checked before execution.

### `summarize_daily_activity` returns findings, not prose

It is a `READ_EXECUTOR` returning a `ReadToolResult`, shaped exactly like
`get_yield_vs_deliveries`:

- **attendance gaps** — `ENROLLED_IDENTITIES` that never appear on the date
  (the `absent-employee` signal)
- **camera-silence gaps** — per active camera, the longest gap between
  consecutive events and whether it exceeds the threshold (the
  `camera-dropout` signal, reusing Cycle 4's absence approach; no
  `camera_offline` event type needed)
- **flag counts** — routine / notable / urgent totals plus the flagged rows

Narration happens at the orchestrator level via a `farmSection()` addition to
`systemPrompt.ts`, parallel to the existing `reconcileSection()` instruction.

### Which scenario exercises which tool

Not all six go through `classifyEvent`:

| Scenario | Exercises |
| --- | --- |
| `normal-weekday` | `classifyEvent` — every row lands routine |
| `night-visitor-unknown` | `classifyEvent` — all three rows urgent (restricted zone, off-hours) |
| `recurring-unknown-visitor` | `classifyEvent` across the lookback window — notable at occurrence 1, urgent by 3 |
| `low-confidence-match` | `classifyEvent` — the `face_match` row notable, its detection routine |
| `absent-employee` | `summarize_daily_activity` only — no per-event flag, surfaces as a roster gap |
| `camera-dropout` | `summarize_daily_activity` only — no per-event flag, surfaces as a silence gap |

## Decision 7 — Expectations live in a new file, not inside Cycle 4's

`scenarios.ts` stays ingestion-only truth. A new
`server/src/farm/classify.expectations.ts` maps each scenario name to its
expected classification outcome (per-row severities for the four
`classifyEvent` scenarios; digest content for the two
`summarize_daily_activity` scenarios), mirroring the registry-map pattern
`scenarios.ts` already uses.

## Decision 8 — `scoreEvent` priority order

Checked in order, first match wins. Restricted-zone-and-off-hours is checked
first and overrides everything else:

1. `zone ∈ RESTRICTED_ZONES` **and** off-hours → **urgent** (any `event_type`)
2. `event_type === 'unknown_cluster'` → **notable** / **urgent** by occurrence
   number (Decision 3)
3. `event_type === 'face_match'` **and** `confidence < MATCH_CONFIDENT` →
   **notable**
4. otherwise → **routine**

Rule 1 applying to any `event_type` settles a granularity question the draft
left open. All three rows of `night-visitor-unknown` sit in `feed_store` at
`02:14`, but two are `detection` rows with `identity: null`. They all flag
urgent: a person in the feed store at 02:14 is the anomaly whether or not a
face resolved.

Rule 1 preceding rule 2 is what keeps recurrence a weighted signal rather than
a certainty — a restricted-zone fact wins over any occurrence count, and an
occurrence count can only ever raise severity within rule 2.

Traced across the library:

| Scenario | Rows | Verdict |
| --- | --- | --- |
| `normal-weekday` | 3 detection, 2 face_match (0.942, 0.91) | 5 routine |
| `absent-employee` | 2 detection, 2 face_match (0.935, 0.901) | 4 routine |
| `night-visitor-unknown` | 2 detection, 1 unknown_cluster — all `feed_store` @ 02:14 | 3 urgent (rule 1) |
| `recurring-unknown-visitor` | 3 detection, 3 unknown_cluster — `gate` @ 01:40 | 3 routine, 2 notable, 1 urgent (rule 2) |
| `camera-dropout` | 6 detection — `barn`/`gate` @ 06:00 | 6 routine |
| `low-confidence-match` | 1 detection (0.72), 1 face_match (0.386) @ 19:20 | 1 routine, 1 notable (rule 3) |

## Implementation plan

| Phase | Scope | Status |
| --- | --- | --- |
| `farm-monitor/00-decisions` | This doc, validated against `v0.7.0`. Constants confirmed with Adnan, not guessed. Moved from `docs/images/` to `docs/`. | ✅ |
| `farm-monitor/01-schema` | Four additive columns on `farm_events`; `flagged` normalized in `toFarmEvent()`; shared `FarmEvent` type extended; local table dropped so `FARM_SCHEMA` recreates it (Decision 2). | ✅ |
| `farm-monitor/02-classify` | `farm/classify.ts` — constants, `FARM_TZ` conversion, `scoreEvent` (pure, no `../db`); `farm/classifyStore.ts` — `classifyEvent`/`classifyEvents` (DB shell); `classify.test.ts` against `scoreEvent` directly. | ✅ |
| `farm-monitor/03-tools` | `tools/farmReads.ts`, `tools/farmWrites.ts`, registration in `tools/index.ts` across every `toolsForAgent()` branch, `farmEventExists` in `guardIds`, `farmSection()` in `systemPrompt.ts`. | ✅ |
| `farm-monitor/04-expectations` | `farm/classify.expectations.ts` — six scenarios' expected outcomes per Decision 8's table. | ✅ |
| `farm-monitor/05-verification` | `farm/verifyClassify.ts` + `verify:classify` script: per-scenario reset, replay, classify, reconcile, assert. `TZ=Asia/Karachi` pinned on the farm scripts. README updated. Tag `v0.8.0`. | ✅ |

### Definition of done

For every scenario in the library:

1. Every row the classifier touches has `classified_at` set, whether or not it
   ends up flagged — a routine row is distinguishable from an unexamined one.
2. Each row's severity matches Decision 8's traced table: `flagged` and
   `flag_severity` agree, and `flag_reason` names the rule that fired.
3. `recurring-unknown-visitor` produces the full gradient — notable at
   occurrence 1, urgent by occurrence 3 — from one replay, with prior counts
   measured event-relative.
4. `absent-employee` surfaces `employee_3` as an attendance gap through
   `summarize_daily_activity`, with no per-event flag anywhere in the scenario.
5. `camera-dropout` surfaces `barn_cam`'s silence gap through
   `summarize_daily_activity`, with a control camera still reporting, and with
   no per-event flag.
6. `scoreEvent` is exercised directly by `classify.test.ts` under
   `npm test -w server` — no DB, no API key, no running server.
7. Classification is reproducible: every scenario resets `farm_events` first,
   and re-running the pass on the same data yields the same verdicts.
8. `verify:classify` exits `0` for the full set, non-zero with a clear diff on
   any failed assertion.

Cycle 4's `verify:farm` must still pass unchanged — the additive columns are
invisible to it.

No AG-UI, Telegram, captioning, or scheduling work is required to call Cycle 5
complete.

## Open items

- **`RESTRICTED_ZONES` is provisional.** `{ 'feed_store' }` is the working
  default, adopted on the evidence in `scenarios.ts` plus the argument for
  excluding `gate` in Decision 3. It describes the real farm, so it needs the
  real farm's answer — whether `barn` or `yard` should also be restricted
  overnight is unresolved, and the set is trivially extensible when it is.
- **Idempotency of repeated `summarize_daily_activity` calls** — running it
  twice for the same date re-runs `classifyEvent` on already-classified rows.
  Harmless (deterministic given the same data, per DoD #7) but wasteful. Worth
  an `already-classified` skip once this matters; not blocking for six
  scenarios.
- **The generator is still host-local.** Decision 4 fixes `classify.ts` and
  pins `TZ` on the scripts, but `scenarioStartMs()` itself remains
  host-relative. A proper fix composes the instant *in* `FARM_TZ`; deferred
  because pinning the scripts covers every path that exists today.
- **The camera-silence finding is not unique to `camera-dropout`, and no
  threshold can make it so.** `CAMERA_SILENCE_MINUTES = 15` correctly flags
  `barn_cam`'s 20-minute gap, but `normal-weekday` also produces two flagged
  cameras: `gate_cam` and `barn_cam` each catch one moment early in a
  30-minute window and are quiet for the rest of it (30 and 20 minutes of
  trailing silence). Since normal-weekday's largest gap (30) *exceeds*
  camera-dropout's (20), raising the threshold kills the true positive before
  the false one — the two scenarios are not separable on trailing silence at
  any threshold.

  This is Cycle 4's documented limitation surfacing exactly as predicted: "a
  dropout is indistinguishable from a genuinely quiet camera." The
  implementation therefore reports the gap as **data** (`silence_minutes`,
  `silence_flagged`, `control_active`) and leaves the reading to the model,
  and `classify.expectations.ts` records normal-weekday's two findings as
  observed truth rather than hiding them. DoD #5 still holds — barn_cam's gap
  surfaces with a control camera reporting — it just isn't the only such gap
  in the library.

  A refinement that *would* separate them, if this becomes worth fixing before
  the Cycle 7 watchdog: only consider cameras that have demonstrated a
  sustained cadence, e.g. a median inter-event gap above a one-minute floor.
  That excludes every camera in the library whose events are one person's two
  frames seconds apart (normal-weekday's gate and barn, absent-employee's
  gate, low-confidence-match's gate, night-visitor's yard) while keeping
  camera-dropout's `barn_cam` (median gap 5 minutes). Deliberately not built
  now: it is a real mechanism, but nothing has yet demonstrated a need for it
  beyond making one fixture tidier.
- **Scheduling** — cron vs. on-demand, per *What we're NOT doing*. Deferred.
- **Unflagging / flag history** — deferred, per *What we're NOT doing*.
