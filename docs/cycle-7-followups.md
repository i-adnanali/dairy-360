# Cycle 7 — tracked follow-ups

Findings that came out of Cycle 7 — step 1 (live camera payload validation) for
FU-1 to FU-3, FU-3's validate-first pass for FU-4 and FU-5, and FU-3's live run
for FU-6 — and were **deliberately not fixed in the slice that found them**, with
enough detail that none of them has to be re-derived from scratch.

A separate file rather than a section inside
[cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md): that
document is a record of one completed slice and should stay closed. These items
outlive it and will be picked up by different slices, so they need a home that
is not "the doc about the thing we already did".

Each entry carries the evidence it rests on. Where that is a local capture
artifact, the artifact is **gitignored and will not survive a clean checkout** —
the numbers recorded here are the durable part, which is the whole reason they are
written out rather than referenced. FU-5 rests on no measurement at all — it is
design-stage — and says so in place.

| ID | Finding | Urgency | Blocks |
| --- | --- | --- | --- |
| [FU-1](#fu-1) | `confidence` underestimates detection score on `detection` rows | Non-urgent | Any future rule that thresholds detection confidence |
| [FU-2](#fu-2) | The validation camera closes neither gap — no zones, and **no resolvable faces** (FU-3) | Non-urgent | `zone` denormalization; any operational face-recognition claim; [FU-5](#fu-5) |
| [FU-3](#fu-3) | Double Take payload shape still docs-only | **CLOSED 2026-08-28** | — |
| [FU-4](#fu-4) | Real Double Take labels every unknown face `'unknown'`, collapsing rule 2's per-identity counting into one global bucket | **Not "eventually" — before any farm-facing camera runs this path** | Correctness of `recurring_unknown_cluster` on any real camera |
| [FU-5](#fu-5) | No mechanism exists to distinguish individual unfamiliar visitors — proposed fix via self-bootstrapping enrollment | Non-urgent, design-stage | Any real per-individual use of `unknown_cluster` |
| [FU-6](#fu-6) | `detect.match.save: false` is silently ignored upstream — face crops are written anyway | **Not "eventually" — before any real deployment with a live gallery** | Any claim that face crops are not persisted |

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

### The validation camera cannot close the remaining gaps — multi-zone, and now faces

**Status:** open, non-urgent. Pre-existing gap (FARM_EVENTS.md Decision 3),
**widened by Cycle 7 FU-3**: two independent slices have now hit the same wall,
which is the camera itself rather than either slice's design.

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

### And the same camera cannot resolve faces at all (added by FU-3)

FU-3 stood up Double Take + DeepStack against this camera and **measured zero
faces across the whole capture window**:

- Every Frigate-triggered recognition returned
  `counts: {person: 0, match: 0, miss: 0, unknown: 0}` — Frigate saw people,
  the face detector found no face in the frames it pulled.
- A live frame probed directly against DeepStack's detection endpoint returned
  `predictions: []`.
- The detector is not at fault: the same DeepStack instance detects a face in a
  portrait at confidence 0.899 and matches it at 1.0. It is the **pixel size of
  a face at street distance from the gate** that is the limit.

Two things worth recording so this is not re-derived:

- **Frame resolution is not the lever.** The camera now decodes at 2304×1296
  (not the 1280×720 FU-1 recorded — see below), and DeepStack costs the same
  ~3.4 s at any input size, so there is nothing to trade. Frigate's
  `snapshot.jpg?crop=1`, which would have returned just the person's bounding
  box and made the face a far larger fraction of the image, is **ignored by
  0.17.2** — every query parameter on that endpoint is.
- **FU-1's recorded stream facts are stale.** `/onvif1` decodes at 2304×1296,
  not 1280×720; `.env.example` and
  [cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md) both
  still say 720p. Cannot tell from here whether the camera's profile changed or
  the original SPS decode read a different stream. The H.265-mislabel bug is
  still present and the go2rtc restream still handles it.

So FU-3's payload-contract deliverable is complete and **not** blocked by this —
it was closed using a synthetic enrolled subject driven through Double Take's own
API. What is unanswered is whether this camera can ever produce a real face
event. **Deliberately not pursued** (consented close-range walk-bys were
considered and dropped): the answer would tell us about this camera's placement,
not about the pipeline, and the pipeline is what Cycle 7 is validating.

### What closing this actually needs

One camera that satisfies both, which is why they now share an entry:

| Requirement | Why |
| --- | --- |
| Frigate **zones configured** | the multi-zone denormalization path above |
| Faces at a **usable pixel size** — closer, or a tighter field of view | any real face-recognition claim, and any per-individual `unknown_cluster` work |
| Covers a **farm area** | farm-event semantics, which the street camera cannot exercise at all |

Until such a camera exists, treat every face-recognition capability claim in
this repo as validated at the **contract** level and unvalidated at the
**operational** level. [FU-5](#fu-5) in particular should not be started against
this camera: a mechanism for distinguishing individual unfamiliar visitors
cannot be evaluated on a camera that resolves no faces.

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

**CLOSED 2026-08-28.** Double Take v1.13.2 + DeepStack was stood up against the
live Frigate 0.17.2 stack and its payload shape verified: 14 payloads, 15 faces,
**zero breaking deltas**, definition of done 12/12, and the 0-100 confidence
scale confirmed at 77.86-100. Full record in
[Cycle7-fu3-double-take-validation.md](Cycle7-fu3-double-take-validation.md);
the durable shape findings are folded into
[FARM_EVENTS.md](FARM_EVENTS.md) § *Double Take — measured against a live
instance*. FU-4 and FU-5 below came out of that slice.

**What it did not close:** the validation camera resolves **no faces at all** at
street distance, so the payloads came from a synthetic enrolled subject driven
through Double Take's own API rather than from passers-by. Whether this camera
can ever produce real face events is unanswered, and is the reason FU-2's
"needs a different camera" argument now applies to face work too.

---

## FU-4

### Real Double Take labels every unknown face `'unknown'`, so rule 2 counts all strangers as one person

**Status:** open, and **confirmed against a live instance** (see *Evidence*).
**Not a low-priority cleanup** — see *When it becomes blocking*
below. Deferred out of FU-3 by decision, for the same reason FU-1 was deferred out
of step 1: changing what a stored column *means* has its own blast radius and
wants its own slice. Do not bundle it into an unrelated one.

### The finding

[`classify.ts`](../server/src/farm/classify.ts#L251-L263) rule 2 escalates an
`unknown_cluster` row by **occurrence number**, counted per `identity` by
[`countPriorSightings`](../server/src/db.ts#L481):

| Constant | Value | Effect |
| --- | --- | --- |
| `RECURRENCE.NOTABLE_AFTER` | 1 | occurrence 1 → **notable** |
| `RECURRENCE.URGENT_AFTER` | 3 | occurrence 3+ → **urgent** |
| `RECURRENCE.LOOKBACK_DAYS` | 21 | window, measured back from the event |

The design assumes `identity` distinguishes individuals. **Real Double Take
supplies a single constant instead.**

Established by source read, not inference. Both supported detectors emit
`name: <subject> or 'unknown'`, and with no matching subject the fallback is the
literal string:

- [`compreface.js normalize`](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/compreface.js) —
  `name: face && confidence >= UNKNOWN.CONFIDENCE ? face.subject.toLowerCase() : 'unknown'`
- [`deepstack.js normalize`](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/deepstack.js) —
  same structure
- [`recognize.util.js:59`](https://github.com/jakowenko/double-take/blob/master/api/src/util/recognize.util.js#L59) —
  the `unknowns` array is built by filtering exactly `obj.name === 'unknown'`

So `normalizeDoubleTake` writes `identity = 'unknown'` on **every**
`unknown_cluster` row, and there is no clustering layer anywhere in Double Take to
supply anything better.

### What that does to classification

`countPriorSightings` filters on `identity` and `event_type` **only — no camera
predicate, no `is_synthetic` predicate** ([db.ts:481](../server/src/db.ts#L481)).
Therefore, once real Double Take rows exist in `farm_events`:

- Every unknown face ever seen, **on every camera, across the 21-day window**,
  counts as a prior sighting of one recurring individual.
- The first unknown face lands `notable`. The **third** lands `urgent` — and so
  does every one after it, permanently.
- Because there is no camera predicate, unknowns from one camera **inflate the
  occurrence number of a genuine unknown cluster on another**. That corrupts a
  real farm-camera verdict, rather than merely adding noise beside it.

The verdict `recurring_unknown_cluster` therefore means "this is at least the
third unrecognised face anywhere in three weeks", not "this individual has been
here before" — which is what
[`systemPrompt.ts:86`](../server/src/agent/systemPrompt.ts#L86) tells the agent it
means, and what
[FARM_MONITOR.md](FARM_MONITOR.md) Decision 8 reasons about.

### This also corrects FARM_EVENTS.md

[FARM_EVENTS.md](FARM_EVENTS.md) § *Known fidelity gaps* says the generator's
stable `unknown_a1` id is "a simplification, not a fidelity claim", and warns
that real cluster ids will not be this stable. **The reality is not unstable ids
— it is no ids at all.** The event type is grounded (Double Take genuinely emits
`unknowns[]`), but its `identity` column has no real producer, and rule 2's
occurrence counting has nothing meaningful to count. That page's wording should
be corrected when this is picked up.

Note the gap is *narrower* than it looks in one respect, which is why nothing is
broken today: FU-3's capture keeps these rows out of `farm_events` entirely
(decision 1, inherited from step 1), and the six synthetic scenarios supply
`unknown_a1` from the fixtures, so `verify:classify` exercises the rule as
designed. **The bug is latent in the code path, not present in the data.**

### When it becomes blocking

**The first time a farm-facing camera runs this code path against a real Double
Take instance** — which is the next real deployment step after FU-3, not a distant
hypothetical. At that point:

- `summarize_daily_activity` ([farmReads.ts:227](../server/src/tools/farmReads.ts#L227))
  classifies every unclassified row in the day, unfiltered, so the misfire needs
  no special trigger — one agent question about "anything unusual today" is enough.
- The failure is **silently plausible**: a stream of `urgent /
  recurring_unknown_cluster` flags looks like a working anomaly detector, not like
  a broken counter. Nobody will notice it as a defect from the output alone.

So this should be considered for pickup **before** any real camera deployment,
not merely "eventually". It is listed as non-urgent nowhere in this file.

### Shape of the fix

There is no correct value to substitute for `'unknown'` — the information does not
exist upstream. So the fix is a decision about what rule 2 should do in its
absence, not a one-line change:

1. **Decide the semantics.** Options, roughly in increasing cost: stop counting
   recurrence when `identity` is a known-degenerate label; scope
   `countPriorSightings` by `camera_id` so cross-camera contamination at least
   stops; or give `unknown_cluster` a real per-individual identity, which is
   [FU-5](#fu-5).
2. **Do not fix it by rewriting `identity` at ingestion.** Synthesising a
   per-row id (e.g. from `source_event_id`) would make every sighting occurrence 1
   and silently disable rule 2 while looking like a fix. If rule 2 is to be
   disabled for real data, disable it *visibly*.
3. **Correct FARM_EVENTS.md** § *Known fidelity gaps* per the section above.
4. **Re-run `verify:classify`.** The scenario expectations pin exact severities
   from the fixtures' `unknown_a1`, so they should be unaffected by a change
   scoped to degenerate labels — verify rather than assume.

### Evidence

- **Source read**, not a capture: `jakowenko/double-take@master` (v1.13.2, the
  current release) at the three files linked above. Re-derivable from the links;
  no local artifact needed.
- **Repo evidence**: `classify.ts`, `classifyStore.ts`, `db.ts`,
  `farmReads.ts`, `systemPrompt.ts` at `248ebfb`.
- **Probed**: a real-shaped no-enrollment payload through the real
  `normalizeDoubleTake` yields `identity: 'unknown'`, `event_type:
  'unknown_cluster'`, `confidence: 0`. Full probe output in
  [Cycle7-fu3-double-take-validation.md](Cycle7-fu3-double-take-validation.md)
  § *Validation findings*, finding 5.
- **CONFIRMED LIVE (2026-08-28).** This entry was written from source before
  FU-3's capture ran; the capture has since measured it directly. Real payload
  from Double Take v1.13.2 + DeepStack: `unknowns[0] = {name: "unknown",
  confidence: 77.86, match: false, checks: ["confidence too low: 77.86 < 90"]}`,
  normalising to `identity = 'unknown'`, `event_type = 'unknown_cluster'`. The
  prediction held exactly.

---

## FU-5

### Self-bootstrapping unknown-face enrollment, scoped to the capture window only

**Status:** open, non-urgent, design-stage — proposed during discussion, not yet
built or scheduled. Unlike FU-1/FU-2/FU-3/FU-4, this entry documents intent,
not a live capture measurement — there is no dataset behind it yet.

**Blocks:** any real use of `unknown_cluster`'s `identity` column as a
per-individual counter. Directly related to [FU-4](#fu-4): FU-4 documents that
today's `identity` is always the flat string `'unknown'`; FU-5 is the proposed
fix — not a patch to the string, but giving `unknown_cluster` a real
per-individual identity for the first time.

### The idea

Double Take already supports enrolling a face under a name via its own
training/enrollment mechanism — that's what "enrollment" means everywhere else
in this project's docs. Instead of relying on Double Take's flat unknown
bucket, the first time an unfamiliar face is seen, auto-enroll it under a
generated name (`unknown_1`, `unknown_2`, ...). On a later appearance, Double
Take's existing matching pipeline compares the new face against that
enrollment and returns a real match, with a real confidence score, against
`unknown_N`. No new embedding or clustering code is needed — this reuses the
enrollment/matching machinery Double Take already has, aimed at faces without
real names rather than known ones.

This is what would let `countPriorSightings` (see FU-4) work as originally
designed: per-`identity` occurrence counting only means something once
`identity` actually distinguishes individuals from one another.

### Why this needs its own decision, separate from FU-3's scope

FU-3 was built around a "no enrollment gallery" rule specifically to avoid
durably fingerprinting real strangers. This feature does that on purpose, for
every unfamiliar face — it crosses from "detect a face" to "build a
persistent, re-identifiable profile of a specific real individual and
recognize them on return." That is a materially bigger step than FU-3's scope
and must not be treated as a quiet extension of it.

**Recommended constraint if/when this is picked up:** enrollments are
session-scoped only — created at the start of a capture/demo window, deleted
when it ends. This validates real within-session repeat-detection (does the
mechanism correctly recognize the same unfamiliar face twice in one window)
without building a system that recognizes the same person across separate
days or weeks. Cross-session persistent recognition is a distinct, heavier
decision and should never be a silent default extension of this feature.

### Sequencing

- Do not start before FU-3's base validation pass (the current live-capture
  slice) actually produces its deltas list — this is new scope on top of a
  slice that has not yet closed.
- Logically follows FU-4: FU-4 documents the current-state bug given today's
  flat identity label; FU-5 replaces the mechanism that bug lives in. Write
  up FU-4 first, before starting FU-5.

---

## FU-6

### `detect.match.save: false` is silently ignored — Double Take writes face crops anyway

**Status:** open, **measured live**. **Not a low-priority cleanup** — see *When
it becomes blocking*. This is a defect in a **privacy control**, and the control
is one FU-3's design leaned on, so it is corrected in place there rather than
quietly dropped ([Cycle7-fu3-double-take-validation.md](Cycle7-fu3-double-take-validation.md)
§ finding 6(b)).

### The finding

Double Take's decision to persist a face crop is
[process.util.js:67](https://github.com/jakowenko/double-take/blob/master/api/src/util/process.util.js#L67):

```js
if (foundMatch || (UNKNOWN.SAVE && totalFaces)) {
  await this.save(event, results, filename, ...);
}
```

**`MATCH.SAVE` does not appear.** `detect.unknown.save` is honoured;
`detect.match.save` is read from config, merged into the effective config, and
then never consulted. So **any face that clears `detect.match.confidence` has
its crop written to disk regardless of the setting.**

`save()` writes two things: the frame to `/.storage/matches/<uuid>.jpg`, and a
row into Double Take's own SQLite. `recognize.util.js`'s `save.latest()` then
copies it again to `/.storage/latest/<name>.jpg` and
`/.storage/latest/<camera>.jpg`.

**Measured, not inferred.** With `detect.match.save: false` AND
`detect.unknown.save: false` in the effective config the container was running:

| Location | Files after the FU-3 window |
| --- | --- |
| `/.storage/matches/` | **7** |
| `/.storage/latest/` | **3** (incl. `synthetic_1.jpg`, `test_street_cam.jpg`) |

### What still works, and what does not

| Control | Honoured? |
| --- | --- |
| `detect.unknown.save: false` | **Yes** — but it breaks MQTT publishing for faces-but-no-match results (see *Related* below) |
| `detect.match.save: false` | **No — silently ignored** |
| `detect.match.base64` / `detect.unknown.base64` | **Yes** — 0 base64 values reached the capture artifact across the whole window |
| Named volume destroyed by `down -v` | **Yes** — verified: all four volumes removed |

So the FU-3 retention posture is intact at the layers that matter for a
*throwaway* window — nothing biometric survived — but it is intact partly by
accident, and one of its three layers does not do what its config says.

### Why FU-3 was safe anyway, and why that does not generalise

The validation camera **resolved no faces at all** at street distance, so the
only face ever processed was the synthetic enrolled subject. The 7 crops were
all of that machine-generated face, and `down -v` destroyed them.

**That is a property of this camera, not of the mitigation.** Reverse either
condition — a better-placed camera, or a gallery holding a real person — and the
same configuration writes crops of real people to disk while the config file
says it does not.

### When it becomes blocking

**Before any real farm-camera deployment that runs a live gallery** — the same
bar as [FU-4](#fu-4), and for the same reason: the failure is silent and looks
like success. Specifically:

- The config file, the committed example, and `doubleTakeStack.test.ts` all
  assert crops are off. **A reviewer reading any of the three would conclude no
  crop is written.** Only the container's filesystem says otherwise.
- Crops persist until Double Take's own purge (`detect.match.purge`, default
  **168 hours**), so on a permanent deployment they accumulate for a week
  rather than dying with the window.
- It interacts badly with [FU-5](#fu-5): self-bootstrapping enrolment would make
  *every* recurring visitor a match, so every one of them would have crops
  written despite `save: false`.

It is **not** blocking for another throwaway window on a camera that cannot
resolve faces, which is the only configuration proven so far.

### Shape of the fix

No config change can fix this — the setting is ignored, so there is nothing to
set. The options are all structural, roughly in increasing cost:

1. **Treat the storage volume as hostile and destroy it on a schedule**, rather
   than relying on `save: false`. Cheapest, and it is what `down -v` already
   does for a bounded window. Does nothing for a long-running deployment.
2. **Keep the gallery empty or synthetic-only**, so `foundMatch` can never be
   true for a real person. This is FU-3's accidental protection made
   deliberate — but it is directly incompatible with FU-5 and with any real
   face-recognition use.
3. **Patch or fork.** The fix upstream is one clause:
   `if ((MATCH.SAVE && foundMatch) || (UNKNOWN.SAVE && totalFaces))`. Upstream
   is effectively frozen (one maintenance release since 2022), so this means
   carrying a patch or moving to the
   [`skrashevich` fork](https://github.com/skrashevich/double-take), which is
   more actively pushed. Check whether the fork has already fixed it before
   writing a patch.
4. **Mount `/.storage/matches` and `/.storage/latest` as `tmpfs`**, so crops
   exist only in memory and never reach disk. Cheap, container-level, needs no
   upstream change — and worth testing first, because it may break
   `save.latest()`'s `copyFileSync` the same way `unknown.save: false` does.

Whichever is chosen, **correct `doubleTakeStack.test.ts`'s framing** so the test
stops implying a guarantee it cannot give. It already carries a comment saying
so; that comment is the interim mitigation.

### Related

The same code path produced a second defect, recorded in
[FARM_EVENTS.md](FARM_EVENTS.md) § *Double Take — measured against a live
instance*: **`detect.unknown.save: false` breaks MQTT publishing entirely** for
any faces-but-no-match result, because `save.latest()` unconditionally
`copyFileSync`s a crop that was never written and the resulting ENOENT is masked
by an `ERR_HTTP_HEADERS_SENT` in Double Take's error middleware. The two
together mean **there is no configuration in which `save` behaves as documented
for both arrays at once.**

### Evidence

- **Source:** `jakowenko/double-take@master` (v1.13.2),
  `api/src/util/process.util.js:67` and `api/src/util/recognize.util.js:4-38`.
- **Measured:** Cycle 7 FU-3 live run, 2026-08-28 — Double Take v1.13.2 +
  DeepStack, effective config confirmed inside the container
  (`grep save /.storage/config/config.yml` → `save: false` twice), 7 + 3 files
  present on the storage volume immediately before teardown.
- **Artifact:** none — the volume was destroyed by `down -v`, which is the
  correct outcome and the reason the file counts are recorded here instead.
