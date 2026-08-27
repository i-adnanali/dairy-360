# Cycle 7 — tracked follow-ups

Findings that came out of Cycle 7 step 1 (live camera payload validation) and
were **deliberately not fixed in that slice**, with enough detail that none of
them has to be re-derived from scratch.

A separate file rather than a section inside
[cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md): that
document is a record of one completed slice and should stay closed. These items
outlive it and will be picked up by different slices, so they need a home that
is not "the doc about the thing we already did".

Each entry carries the dataset it was measured on. Where that dataset is a local
capture artifact, the artifact is **gitignored and will not survive a clean
checkout** — the numbers recorded here are the durable part, which is the whole
reason they are written out rather than referenced.

| ID | Finding | Urgency | Blocks |
| --- | --- | --- | --- |
| [FU-1](#fu-1) | `confidence` underestimates detection score on `detection` rows | Non-urgent | Any future rule that thresholds detection confidence |
| [FU-2](#fu-2) | Multi-zone payloads still unverified against real data | Non-urgent | Confidence in `zone` denormalization |
| [FU-3](#fu-3) | Double Take payload shape still docs-only | Non-urgent | Face-match / `unknown_cluster` fidelity claims |

---

## FU-1

### `farm_events.confidence` systematically underestimates the detection score

**Status:** open, non-urgent, deferred by decision. Do not bundle into an
unrelated slice — changing what `confidence` means has its own blast radius.

### The finding

[`ingest.ts`](../server/src/farm/ingest.ts) resolves confidence as
`asNumber(after.top_score) ?? asNumber(after.score)`. That preference exists
because [FARM_EVENTS.md](FARM_EVENTS.md) documents `top_score` as *"best over
event lifetime"* — so preferring it should yield the strongest evidence the event
produced.

**Live data contradicts that for `new` events, which are the only type ever
persisted.**

Measured on 250 real `frigate/events` messages from Frigate 0.17.2:

| Comparison | Count |
| --- | --- |
| `top_score` **>** `score` (all types) | 141 / 250 |
| `top_score` **<** `score` (all types) | 93 / 250 |
| `top_score` **==** `score` (all types) | 16 / 250 |
| `top_score` **<** `score` — **`new` events only** | **18 / 21** |

So in aggregate `top_score` broadly behaves as documented. Restricted to `new`
events it does not: on an event where the object has *just* appeared and the two
values ought to be equal, `top_score` is lower in 18 of 21 cases.

**Net effect on stored data: 20 of the 21 persisted rows carry a `confidence`
lower than the highest score present in their own payload, by a mean of 0.050 on
the 0..1 scale.**

### What `top_score` is not

Ruled out on this dataset — worth recording so nobody re-tests them:

- **Not** `max(score_history)`: matched in only 2 of 38 payloads carrying a
  `score_history`.
- **Not** `median(score_history)`: also 2 of 38.

Frigate 0.17.2 emits `score_history[]` (one of the 41 undocumented fields the
capture surfaced), so the value is presumably derived from a longer window than
the ~3 entries retained in the payload. **Its actual derivation is undetermined**
and is not worth guessing from 21 events — establishing it needs either a larger
capture or a read of Frigate's tracker source, which is the first task of
whatever slice picks this up.

### Why it is non-urgent today

Nothing currently thresholds detection confidence:

- `CONFIDENCE.MATCH_CONFIDENT` (0.85) in
  [`classify.ts`](../server/src/farm/classify.ts) is **gated to
  `event_type === 'face_match'`** and never applies to a `detection` row. That
  gating is deliberate and load-bearing for its own reasons — the comment there
  explains an ungated comparison would flag `normal-weekday`'s 0.76 yard
  detection and break "every row lands routine".
- No other rule reads `confidence` at all. Rules 1, 2 and 4 do not, and rule 3
  is the `face_match` gate above.
- A 0.05 shortfall therefore changes **no** Cycle 5 verdict, and the live capture
  passed 7/7 of its definition-of-done checks with these values.

Also note: **Double Take confidence is unaffected.** It arrives on a 0-100 scale
and is normalized by `percentToUnit()`, a completely separate path that has
nothing to do with `top_score`.

### When it becomes blocking

The moment any cycle introduces a rule that scores `detection`-row confidence —
a "low-confidence detection" severity, a per-camera quality metric, a
detector-drift check. At that point every threshold would be calibrated against
a value that is silently ~0.05 pessimistic, and the calibration would then
encode the bug.

### Shape of the fix

Small, but it is a **semantic** change to a stored column, which is why it wants
its own slice rather than a drive-by commit:

1. Determine what `top_score` actually is in the pinned Frigate version (source
   read or larger capture) — do not skip this and assume.
2. Decide the preference. Most likely `max(after.score, after.top_score)`, or
   `max(...after.score_history, after.score)` if `score_history` proves
   trustworthy. Either is a one-line change in `ingest.ts`.
3. Correct the `top_score` row in FARM_EVENTS.md's normalization table and the
   claim in its Frigate shape section.
4. Decide what happens to **already-stored rows**. There is no migration
   framework (FARM_EVENTS.md Decision 3) and `farm_events` survives
   `resetSchema()`, so existing rows keep the old semantics unless explicitly
   handled. For synthetic scenario data this is irrelevant; for any real capture
   that has been persisted it is not.
5. Re-run `verify:farm` and `verify:classify` — the scenario expectations pin
   exact confidences (e.g. `0.93`, `0.76`) from the generator's own `score` /
   `top_score`, which the generator sets **equal** to each other
   ([scenarios.ts](../server/src/farm/scenarios.ts)), so those expectations
   should be unaffected. Verify rather than assume.

### Dataset

- **Capture:** 250 messages, Frigate 0.17.2, camera `test_street_cam`,
  2026-08-26 07:38:11Z–07:56:58Z. 21 `new`, 21 `end`, 208 `update`.
- **Artifact:** `server/captures/live-window-1.jsonl` — **gitignored**, present
  only on the machine that ran the capture.
- **To regenerate:** the runbook in
  [cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md) § *To
  run the capture*. A fresh capture will not reproduce these counts exactly, but
  the `new`-event direction should reproduce readily — it held in 18 of 21 cases.
- **To re-measure:** `npm run verify:payload -w server -- --capture=<file>`
  reports the shape deltas; the score comparison above was a separate ad-hoc
  pass over the same file and is **not** part of that script. Adding it as a
  check is a reasonable first step for the slice that takes this on.

---

## FU-2

### Multi-zone payloads are still unverified against real data

**Status:** open, non-urgent. Pre-existing gap (FARM_EVENTS.md Decision 3), but
the live capture changed what it would take to close.

`normalizeFrigate` denormalizes zones to one indexed column, preferring
`entered_zones[0] ?? current_zones[0]`. The validation camera had **no zones
configured** — deliberately, so that `zone = NULL` made classification rule 1
structurally unreachable for the test camera. Consequence: real payloads arrived
with `entered_zones: []` and `current_zones: []`, so the capture confirmed the
**nullable-zone** path and left the **multi-zone** path exactly as unverified as
before.

Closing it needs a Frigate camera with zones defined, which means a camera
covering a farm area rather than the validation camera used here. Only
[`ingest.test.ts`](../server/src/farm/ingest.test.ts) covers the preference rule
today, against synthetic input.

---

## FU-3

### Double Take payload shape is still docs-only

**Status:** open, non-urgent. Explicitly out of scope for Cycle 7 step 1.

Cycle 7 step 1 verified the **Frigate** half of FARM_EVENTS.md Decision 2 against
a live instance. Double Take was deferred and never stood up, so every Double
Take claim on that page — the `matches`/`misses`/`unknowns` arrays, the 0-100
confidence scale, the singular `match` topic shape, `counts`, per-face
`filename` — remains sourced from upstream documentation alone.

This matters more than it looks, because the Double Take side is where Cycle 4
found its *worst* fidelity gap (a mock that was wrong by 100× on confidence). It
is also a prerequisite for closing the `unknown_cluster` gap, which has no real
producer without it.
