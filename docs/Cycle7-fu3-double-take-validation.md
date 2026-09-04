# Cycle 7, FU-3 — Double Take Live Validation: Context Handover

> **Naming note (2026-09-04):** this repository was renamed `dairy-agent` →
> `dairy-360`, and the Langfuse compose project with it. The `dairy-agent`
> references below are left **verbatim on purpose** — they are volume names that
> were actually observed. Rewriting them would falsify the record, and in this
> case they are also still accurate: `dairy-agent_frigate_data` and
> `dairy-agent_frigate_media` both still exist, still 0 B, still unattached.
> (The five `dairy-agent_langfuse_*` volumes are gone — migrated to
> `dairy-360_langfuse_*` and the originals deleted once verified.)

*Status: **FU-3 COMPLETE (2026-08-28), tagged `v0.10.0`.** Double Take v1.13.2 + DeepStack stood
up against the live Frigate 0.17.2 stack; payload shape verified with **zero
breaking deltas**, definition of done **12/12**, and the 0-100 confidence scale
**confirmed** at 77.86-100. Deliverable in
[§ DELIVERABLE](#deliverable--the-deltas-list-live-capture-2026-08-28); durable
shape findings folded into [FARM_EVENTS.md](FARM_EVENTS.md). Stack torn down
with `down -v`; all four volumes destroyed. `npm test -w server` 105/105,
typecheck clean, `dairy.db` mtime byte-identical across the whole session.*

> **One thing this did NOT establish, and it is important:** the validation
> camera resolved **no faces at all** from street traffic across the capture
> window. The verified payloads came from a synthetic enrolled subject driven
> through Double Take's own API, not from passers-by. The payload *contract* is
> validated; whether this camera can produce real face events is not — see
> [§ What this run did NOT validate](#what-this-run-did-not-validate-and-why).
> Two upstream Double Take defects were also found, one of which weakens a
> privacy control this slice relied on.

> **Note on this document's shape.** It began as a pre-implementation handover
> written before any of the work was done, and now also carries the results of
> the validate-first pass. The early sections are therefore stated as
> assumptions-to-be-checked. Where an early claim turned out wrong it has been
> struck through or corrected in place rather than quietly deleted, so the record
> of what was believed going in stays legible — same convention as
> [cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md).

**Purpose of this doc:** hand this to Claude Code with a validate-first kickoff prompt (see bottom), same pattern as the Frigate pass. Inspect the real repo before implementing, confirm or correct the assumptions below, report back blocking issues and open decisions before writing integration code.

## Project context

- This is [FU-3](cycle-7-followups.md#fu-3) from the Cycle 7 step 1 follow-ups: Double Take's payload shape in `FARM_EVENTS.md` is still sourced from upstream docs alone, never checked live. Cycle 4's worst fidelity gap was a Double Take confidence mock wrong by 100×, and this is also the prerequisite for giving `unknown_cluster` a real producer.
- The Frigate half of this same validation (Cycle 7 step 1) is done: zero breaking deltas against a live Frigate 0.17.2 instance, full writeup in [cycle-7-live-camera-validation.md](cycle-7-live-camera-validation.md). Reuse what that pass built rather than re-deriving it — `captureMqtt.ts`, `payloadShape.ts`, the two-baseline diff approach (doc-parsed + generator), the go2rtc restream that fixed this camera's codec mislabel, and the `docker-compose.frigate.yml` stack are all already proven against this exact camera.
- Camera is `test_street_cam` — the Yoosee A10 at the main gate, facing street traffic. Same camera as before; see the decision below on why that's not just a convenience.

## Goal of this slice

Validate Double Take's documented payload shape against a live instance: the `matches`/`misses`/`unknowns` arrays, the 0–100 native confidence scale (normalized in `ingest.ts` via `percentToUnit()`), the singular `match` MQTT topic shape, `counts`, and the per-face `filename`/`confidence`/`match`/`box`/`type`/`duration`/`detector` set — same clone-and-diff-against-known-good discipline as FU-1, output is a deltas list.

> **CORRECTED by finding 7.** Roughly half of that goal is **unreachable under
> this doc's own no-enrollment constraint**. With an empty gallery, Double Take
> emits `matches: []` and `misses: []` for every payload, and every unknown face
> carries a hardcoded `confidence: 0`. So the `matches`/`misses` per-face shape,
> the singular `match` topic, and — most importantly — **the 0–100 confidence
> scale, the exact claim Cycle 4 got wrong by 100×** — cannot be exercised at all.
> Only the envelope and the `unknowns[]` subtree get real coverage. This is the
> central tension in the slice as drafted; open decision 1 is how to resolve it.

**This is explicitly a bounded technical demo, not a permanent deployment.** The interest is in how the implementation holds up (clustering behavior, confidence semantics, embedding quality) and what transfers once more cameras are added — not in standing up an ongoing face-recognition system. That framing should drive every sizing decision below toward the minimum footprint that still answers the technical question, not toward production robustness.

> **Sizing verdict (finding 8): the framing is right, the estimate is not.** This
> is not "one more container next to Frigate". Double Take ships no face
> recognizer and **refuses to process anything with no detector configured**
> ([recognize.controller.js:72](https://github.com/jakowenko/double-take/blob/master/api/src/controllers/recognize.controller.js#L72)),
> so the minimum stack is Frigate + Mosquitto + Double Take **+ a separate
> recognition service**. On this machine that detector choice is itself a
> blocking issue — see BL-1.

## Decision: reuse this camera, deliberately scoped down

Confirmed with the project owner: use the existing street-facing camera rather than waiting for a farm camera. Reasoning — it's the only camera currently deployed, and the infrastructure to run it (Frigate, go2rtc, capture harness) already works against it. Multi-camera, multi-zone, and real farm-context validation are deliberately deferred to when more cameras exist (this mirrors FU-2, which is already open for the same reason on the Frigate side).

**This decision carries a privacy constraint that's part of the scope, not an afterthought:** a street-facing camera means Double Take will process faces of members of the public who have no relationship to the farm and have not consented to biometric processing. The validation must be built so it never crosses from "shape validation" into "identifying strangers":

- **No enrollment gallery.** Do not seed Double Take with any known/named faces to match against. It should only ever produce `unknowns` for this pass — that's sufficient to validate payload shape and does not require attaching a real identity to a real stranger.
  - **CONFIRMED mechanically, and it is stronger than the doc claims.** With an
    empty gallery, `matches` and `misses` are *provably* always empty: a match
    needs `confidence >= 60` and a miss needs `name !== 'unknown'`, and both are
    unreachable when there is no subject to compare against (finding 7). It is
    also **not sufficient for payload-shape validation** — see the correction
    under *Goal* above.
- **No durable retention of biometric artifacts.** The capture window should be the minimum needed to get a usable shape diff (FU-1's ~19-minute/250-message window is the reference point — confirm a comparable window is sufficient here, likely shorter given lower face-match event volume than motion events). Once the diff is produced, the harness itself — not a manual step — deletes raw face crops/snapshots and any stored embeddings. Keep the schema/shape findings; do not keep the biometric data that produced them.
  - **CORRECTED on two counts (findings 6 and 9).** ~~likely shorter~~ → the
    window is likely **much longer**, possibly unbounded, because Double Take
    publishes at most one message per person-labelled Frigate event that
    actually yields a detected face — orders of magnitude below Frigate's motion
    volume. And "the harness deletes the crops afterwards" is the wrong shape:
    the crops live inside Double Take's container, not in anything the harness
    writes. The enforceable version is **never produce them** (`detect.*.save:
    false`) plus capture-time redaction. See finding 6.
- **Size everything for a bounded demo, not a production system.** This is deliberately not going to run indefinitely — it's a one-time technical exploration of clustering behavior and payload shape, with results meant to inform decisions once more cameras are added. Don't over-build durability, retries, or monitoring here; the mitigations above (no enrollment, minimal window, mechanical deletion) are the actual requirements, not production hardening.
- This mirrors decision 1 from FU-1 (mechanically enforced isolation, not a note in a doc): whatever guards this, put it in code/tests the way `captureIsolation.test.ts` guards the DB-isolation decision, not just a comment.
  - **CONFIRMED enforceable, at three layers, with one honest limit** — finding 6.

## Explicitly out of scope for this slice

- Face enrollment / identifying real individuals — see decision above, and open decision 1, which revisits *whether a single non-real or self-consented enrollment* is the only way to meet the stated goal.
- Multi-zone or multi-camera validation (remains FU-2's scope, unresolved).
- Cycle 7 step 2 (real end-to-end HTTP wiring / MQTT-to-webhook bridge) — still deferred; this stays MQTT-capture-and-diff, same as FU-1's approach.
- The FU-1 confidence-semantics fix (`top_score` preference) — unrelated, stays deferred to its own slice.
- **Added by this pass:** any change to `ingest.ts`. Finding 3 turns up a real
  unguarded failure mode in `percentToUnit()`, but fixing it is a semantic change
  to a stored column and belongs in its own slice, exactly as FU-1 was split out.
  This slice's job is to *detect* it in the definition of done.

## What's already validated / reusable (real-world + repo, from FU-1)

- Camera, Frigate 0.17.2, go2rtc restream, and the MQTT capture harness are all proven working against this exact hardware.
- `/onvif1` (1280×720 H.264) is the working stream path; the codec-mislabel issue is already solved by the committed go2rtc config.
- The camera has confirmed intermittency (unreachable on first probe, recovered minutes later) — build the capture window with that in mind, same as before.
- **Added:** the Frigate stack is currently **torn down**. No `frigate-capture` or
  `frigate-mosquitto` container exists; the `ghcr.io/blakeblackshear/frigate:stable`
  image is still pulled locally (so the 4.57 GB download does not repeat), and two
  pre-`name:`-fix orphan volumes survive (`dairy-agent_frigate_data`,
  `dairy-agent_frigate_media`) — harmless, but they are not the stack.
  `frigate/config.yml` exists locally and is gitignored.

## Not yet validated — open items

- ~~**Is Double Take even deployed anywhere yet?**~~ → **ANSWERED: no, nowhere.** See finding 1.
- ~~Whether Double Take produces enough real match/unknown events in a short window~~ → **ANSWERED, and worse than feared.** See finding 9 and BL-3.

---

## Validation findings (repo-evidence pass, 2026-08-28)

Validation-only pass against the repo at `248ebfb`, plus a source read of
[jakowenko/double-take@master](https://github.com/jakowenko/double-take). No
Double Take deployed, no config written, no integration code. `dairy.db`'s mtime
was byte-identical before and after; the probes below ran against the pure
modules only (`ingest.ts`, `payloadShape.ts`, `scenarios.ts`), never `../db`.

Findings 1–5 answer the five numbered codebase questions this doc originally
posed. Findings 6–9 are the things it did not think to ask.

### 1. Double Take is deployed nowhere — this slice stands it up from scratch, and it is a four-service stack

**CONFIRMED, and the scope is larger than the doc assumes.**

| Evidence | Result |
| --- | --- |
| Compose services | Only `docker-compose.langfuse.yml` and `docker-compose.frigate.yml` exist. Neither mentions Double Take. |
| Containers / images | No Double Take container, volume, or image on this machine. |
| Config | No `double-take/` directory, no config file, no `.gitignore` entry for one. |
| Env | `.env.example` carries `FRIGATE_CAM_*` and `FRIGATE_MQTT_URL` only — nothing for Double Take or a detector. |
| Code | Everything named "Double Take" in the repo is the *consumer* half: [`normalizeDoubleTake`](../server/src/farm/ingest.ts#L212), [the route](../server/src/farm/routes.ts#L75), [the generator's `doubleTake()` builder](../server/src/farm/scenarios.ts#L157), tests. Nothing produces or connects to a real instance. |

**The stack is not one container.** Double Take ships no recognizer of its own —
it orchestrates an external one and returns `400 no detectors configured` before
doing any work if none is set
([recognize.controller.js:72](https://github.com/jakowenko/double-take/blob/master/api/src/controllers/recognize.controller.js#L72)).
Supported detectors in v1.13.2 are CompreFace, DeepStack, Facebox and AWS
Rekognition. So the minimum footprint is:

```text
Frigate 0.17.2  →  Mosquitto  →  Double Take  →  <recognition service>
   (exists)       (exists)        (new)             (new)
```

Two things that make the wiring *easier* than expected, both worth recording:

- **Frigate's port 5000 is the internal, unauthenticated API port**, documented
  as "intended to be used within the docker network for services that integrate
  with Frigate and do not support authentication"
  ([Frigate auth docs](https://docs.frigate.video/configuration/authentication)).
  Double Take calls Frigate with plain axios and has no auth support at all
  ([frigate.util.js](https://github.com/jakowenko/double-take/blob/master/api/src/util/frigate.util.js#L83-L94)),
  so this would otherwise have been a hard blocker. Point Double Take at
  `http://frigate:5000`, container-to-container.
- **Double Take reads `frigate/events` off the same broker Frigate already
  publishes to** (`mqtt.topics.frigate` default), so `mosquitto` needs no change.

Upstream health, since "is this thing maintained" governs whether it is worth
standing up: `jakowenko/double-take` is **not archived**; v1.13.1 shipped
2022-10-27 and a single maintenance release **v1.13.2 on 2025-08-18** (an XSS fix
and dependency lock) is the only activity since. There is a more actively pushed
community fork, `skrashevich/double-take` (last push 2026-08-17, last tagged
release 2024-01). Treat upstream as *effectively frozen at a 2022 feature set* —
which is exactly why the payload shape is worth measuring rather than assuming.

### 2. The `/api/webhooks/double-take` contract — permissive/strict in the same shape as Frigate, but with a *harder* required core

**CONFIRMED that it exists and is symmetric with the Frigate handler; the
"strict or permissive" framing resolves the same way FU-1 found — permissive
about unknown fields, strict about a small required core — but the core is
larger, and one of its rules is a live rejection risk.**

Path and transport are identical to the Frigate endpoint (finding 1 of FU-1
applies verbatim): `POST /api/webhooks/double-take`, defined at
[routes.ts:75](../server/src/farm/routes.ts#L75), mounted at
[index.ts:29](../server/src/index.ts#L29), `application/json` only, 2 MB body
limit, `201`/`202`/`400`, `is_synthetic` from `X-Synthetic-Source`, and **no auth
of any kind**. Both handlers are the same `handler(normalize)` closure, so
nothing here is Double-Take-specific.

Required core — anything missing is a `400`
([ingest.ts:212-257](../server/src/farm/ingest.ts#L212-L257)):

| Rule | Failure |
| --- | --- |
| body is an object | `400 invalid_payload` |
| `id` non-empty string | `400 missing_field` |
| `camera` non-empty string | `400 missing_field` |
| `timestamp` non-empty string, and `new Date()`-parseable | `400 missing_field` / `400 invalid_timestamp` |
| at least one of `matches` / `misses` / `unknowns` (array) or `match` (object) | `400 invalid_payload` |
| **every entry in every face array is an object with a non-empty `name`** | `400 missing_field` / `400 invalid_payload` |

Everything else is ignored and the whole body is preserved verbatim in
`raw_payload`. Probed with a real-shaped unenrolled payload carrying `checks[]`,
`personCount` and other undocumented fields: **`201`, no complaint.** So pointing
a real Double Take at this endpoint is safe from a rejection standpoint, with one
exception:

> **The nameless-face rule is a whole-payload reject, not a dropped row.** One
> face entry without a `name` fails the *entire* POST with
> `400 missing_field, field: "unknowns[0].name"`
> ([ingest.ts:257](../server/src/farm/ingest.ts#L257), pinned by
> [ingest.test.ts:324](../server/src/farm/ingest.test.ts#L324)). That is a
> deliberate choice — better than silently dropping a face — but it means a
> single malformed entry loses the other faces in the same message. **Verified
> not to fire in practice:** real Double Take always sets `name`, to the literal
> string `'unknown'` when nothing matched (finding 5). Recorded because it is
> the endpoint's only sharp edge against real traffic.

**Silent-acceptance modes — three, one more than the Frigate side:**

| Mode | Where | Result |
| --- | --- | --- |
| `confidence` absent → `NULL` | [ingest.ts:270](../server/src/farm/ingest.ts#L270) | `201`, `confidence: null`, no warning. The exact analogue of FU-1's `after.score` bug. Pinned by [ingest.test.ts:338](../server/src/farm/ingest.test.ts#L338). |
| `confidence` on the **wrong scale** → silently ÷100 again | [ingest.ts:112-114](../server/src/farm/ingest.ts#L112-L114) | See finding 3. Not caught by anything. |
| `zones` absent or `[]` → `zone: NULL` | [ingest.ts:247](../server/src/farm/ingest.ts#L247) | Desirable here (keeps classification rule 1 unreachable), and **confirmed to be what real Double Take sends** for a zone-less camera: it copies `after.current_zones` from the Frigate event ([recognize.controller.js:61](https://github.com/jakowenko/double-take/blob/master/api/src/controllers/recognize.controller.js#L61)). |

**Consumer path beyond the synthetic generator: none.** `normalizeDoubleTake` has
exactly two callers — the route, and `ingest.test.ts`. The generator
([simulate.ts:31](../server/src/farm/simulate.ts#L31)) POSTs the six scenarios at
it over real HTTP, and [verify.ts:240-244](../server/src/farm/verify.ts#L240-L244)
probes five of its rejection paths. Nothing has ever sent it a payload that did
not come out of `scenarios.ts`.

### 3. `percentToUnit()` — no silent-null of its own, but an unguarded silent-100× that nothing in the FU-1 playbook catches

**The doc asks the right question and gets a worse answer than expected.**

[`percentToUnit`](../server/src/farm/ingest.ts#L112-L114) is three lines:
`Math.round((percent / 100) * 10000) / 10000`. It is total, never throws, and has
**no range check, no clamp, and no warning**. The null-handling lives one level up
at [ingest.ts:270](../server/src/farm/ingest.ts#L270) —
`percent === null ? null : percentToUnit(percent)` — so the function itself never
sees a bad value; `asNumber` has already filtered non-finite input.

Probed directly:

| Input | Output | Verdict |
| --- | --- | --- |
| `91.4` | `0.914` | correct — documented behaviour |
| `100` | `1` | correct |
| `0` | `0` | correct, **and dangerous** — see below |
| `0.914` (0..1 input) | **`0.0091`** | **silent 100× error** |
| `250` | `2.5` | out of range, accepted |
| `-5` | `-0.05` | negative, accepted |

Three consequences, in order of how much they matter to this slice:

1. **The inverse of Cycle 4's 100× bug is unguarded and undetectable by an
   FU-1-style definition of done.** A payload carrying `confidence: 0.914`
   produces a stored `0.0091` and a `201`. FU-1's DoD check *"every confidence
   is inside 0..1"* **passes** on `0.0091`. So the single defect this whole
   follow-up exists to guard against — a confidence off by 100× — would slip
   through the DoD inherited from the Frigate side. The DoD must assert on the
   **pre-normalization native value**, not just the normalized one. See open
   decision 4.
2. **`confidence: 0` is a silent-zero, and it is what an unenrolled run
   actually produces** (finding 7). It is non-null and inside 0..1, so it passes
   *both* FU-1 DoD checks while carrying no information at all. A DoD that only
   asks "non-null, in range" would report 7/7 PASS on a capture in which every
   single confidence is a hardcoded zero.
3. The missing-`confidence` → `NULL` mode is real and is the direct analogue of
   FU-1's `after.score` finding, but is **unlikely to fire**: both supported
   detectors always emit a numeric `confidence`
   ([compreface.js](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/compreface.js),
   [deepstack.js](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/deepstack.js)).
   Keep the check as a regression guard, the way FU-1 kept its `top_score` one.

### 4. `payloadShape.ts` generalizes structurally, then produces a misleading report — the extraction logic is Double-Take-specific

**The doc's question is "does the differ generalize". The honest answer is: the
*differ* does, unchanged; the *diff* it produces is both noisy and blind, and
fixing that is not a change to `payloadShape.ts`.**

`shapePaths` walks arbitrary JSON, so per-face objects collapse correctly —
probed against a real-shaped payload, it produces `unknowns[]`,
`unknowns[].name`, `unknowns[].box.top`, `unknowns[].checks[]` and so on, exactly
as wanted. `diffShapes`'s `only` parameter is a plain prefix filter and simply
goes unused here (unlike Frigate, `FARM_EVENTS.md` documents the whole Double
Take envelope, so there is no `before` branch to exclude). **No change to
`payloadShape.ts` is needed, and none is warranted.**

But run the real no-enrollment payload against the documented shape and the
report is this:

```text
[type_changed] matches:   documented array,       real empty-array
[type_changed] unknowns:  documented empty-array, real array
[only_in_real] unknowns[].name / .confidence / .match / .box{4} /
               .type / .duration / .detector / .filename / .base64 / .checks[]
[only_in_real] personCount
```

Two failure modes, both caused by the same asymmetry — **the doc's example
populates `matches` and leaves `unknowns` empty; an unenrolled instance does
exactly the reverse**:

- **16 false `only_in_real` deltas.** Every `unknowns[].*` field is reported as
  undocumented, when in fact all but `checks` are documented — under `matches[]`.
  A reader of that report would conclude the doc missed sixteen fields it did not
  miss.
- **Zero coverage of the documented `matches[].*` paths.**
  [`impliedByEmptyAncestor`](../server/src/farm/payloadShape.ts#L241-L245)
  correctly suppresses them as implied by `matches: []` — the same mechanism that
  collapsed `entered_zones` on the Frigate side. Correct behaviour, and it means
  the per-face shape claim goes **entirely unexercised**.

**What is actually needed** is a Double-Take-aware extraction step in the verify
script, not in the differ: pull face entries out of `matches ∪ misses ∪ unknowns`
on *both* sides, aggregate them into one "face object" shape, and diff that
separately from the envelope (with the three arrays' contents excluded from the
envelope diff). That turns 18 misleading deltas into two useful ones —
`face.checks` is undocumented, `personCount` is undocumented — and it makes the
per-face claim testable from whichever array happens to be populated.

`verifyPayloadShape.ts` itself does **not** generalize and needs a sibling
(`verifyDoubleTakeShape.ts`, `verify:payload:dt`). It is Frigate-hardwired in
five places:

| Location | Why it breaks |
| --- | --- |
| [`documentedFrigateShape`](../server/src/farm/verifyPayloadShape.ts#L85) | regex `/^###\s+Frigate\b/`. The Double Take heading is `### Double Take — camera event payload`, with a `json` fence directly under it — so the same doc-parsing trick works, with a different regex. |
| [`generatorFrigateShape`](../server/src/farm/verifyPayloadShape.ts#L114) | filters `e.source === 'frigate'`. A `double_take` sibling exists in `normal-weekday`. **Trap:** the generator's payload has **no `timestamp` key** (`simulate.ts` stamps it), so baseline B must inject one or `timestamp` reports as a spurious `only_in_real`. |
| [`loadCapture`](../server/src/farm/verifyPayloadShape.ts#L165) | gates on `typeof payload.type === 'string'`. **A Double Take payload has no root `type`** (probed: `undefined`) — every message would be counted as a `nonEvent` and silently dropped. |
| [`normalizeAll`](../server/src/farm/verifyPayloadShape.ts#L206) | calls `normalizeFrigate`, tallies `skipped: update/end`. Double Take's only skip reason is `no_faces`. |
| [`dodChecks`](../server/src/farm/verifyPayloadShape.ts#L255) | asserts Frigate-shaped things and, per finding 3, is **not strong enough** as-is. |

`captureMqtt.ts` is closer to reusable: `--broker`, `--topic`, `--minutes`,
`--max` and `--out` are all already flags, so `--topic='double-take/#'` works
today. What is Frigate-specific is cosmetic and one line each — the
`frigate-events-` filename prefix
([captureMqtt.ts:67](../server/src/farm/captureMqtt.ts#L67)) and the progress
summary reading `p.type` / `p.after.camera`
([captureMqtt.ts:173-176](../server/src/farm/captureMqtt.ts#L173-L176)). **But it
must not be reused as-is** — see finding 6, which puts a redaction step on the
write path.

### 5. `unknown_cluster` has a real, wired consumer — and real Double Take feeds it a value that breaks it

**CONFIRMED it is a live integration point, not aspirational. Also the most
consequential finding in this pass.**

The chain is complete and reachable today:

1. [`db.ts:110`](../server/src/db.ts#L110) — `event_type` CHECK admits it.
2. [`classify.ts:251-263`](../server/src/farm/classify.ts#L251-L263) — rule 2
   fires on `unknown_cluster` by occurrence number:
   `NOTABLE_AFTER: 1`, `URGENT_AFTER: 3`, `LOOKBACK_DAYS: 21`
   ([classify.ts:41-53](../server/src/farm/classify.ts#L41-L53)).
3. [`classifyStore.ts:27-35`](../server/src/farm/classifyStore.ts#L27-L35) — the
   *only* rule that costs a query, counting priors by `identity`.
4. [`db.ts:481`](../server/src/db.ts#L481) `countPriorSightings` — filters on
   `identity` and `event_type` **only. No camera filter. No `is_synthetic`
   filter.**
5. [`farmReads.ts:227`](../server/src/tools/farmReads.ts#L227) — `summarize_daily_activity`
   classifies every unclassified row in the farm-local day, unfiltered.
6. [`farmReads.ts`](../server/src/tools/farmReads.ts#L259) — `get_farm_events`
   documents an `identity` filter as *"an enrolled name or an unknown cluster id"*.
7. [`systemPrompt.ts:86`](../server/src/agent/systemPrompt.ts#L86) — the agent is
   told `recurring_unknown_cluster` is a flag reason it will see.

**And here is what real Double Take actually supplies as `identity`:**

> Every unknown face is named the literal string **`'unknown'`**. Not a cluster
> id, not a per-face id — one global constant.

Established from source, not inferred: both detectors emit
`name: … ? subject : 'unknown'`
([compreface.js `normalize`](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/compreface.js),
[deepstack.js `normalize`](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/deepstack.js)),
and `recognize.util.js` builds `unknowns` by filtering exactly
`obj.name === 'unknown'`
([recognize.util.js:59](https://github.com/jakowenko/double-take/blob/master/api/src/util/recognize.util.js#L59)).

Consequence, if such rows ever reach `farm_events`:

- `countPriorSightings(identity: 'unknown')` treats **every unknown face ever
  seen, on every camera, over 21 days** as sightings of one recurring individual.
- Occurrence 1 → `notable`. Occurrence 3 → `urgent`, and every one thereafter.
  On a street camera that is the third face of the window and then permanently.
- Because there is no camera filter, street-camera unknowns would also **inflate
  the occurrence number of a genuine farm-camera unknown cluster**, corrupting a
  real classification rather than merely adding noise.

This is a materially stronger argument for FU-1's decision 1 (never write to the
shared `farm_events` during the window) than the Frigate side had, where the
damage was limited to digest truncation and inflated `silence_minutes`. Here it
would corrupt farm-camera verdicts.

It also sharpens what `FARM_EVENTS.md` § *Known fidelity gaps* records. That page
says the generator's stable `unknown_a1` id is "a simplification, not a fidelity
claim", and warns cluster ids will not be this stable. **The reality is not
"unstable ids" — it is no ids at all.** There is no clustering layer in Double
Take whatsoever; `unknown_cluster` as an event type is grounded, but its
`identity` column has no real producer and rule 2's occurrence counting has
nothing meaningful to count. That is a correction `FARM_EVENTS.md` should carry
once this slice runs.

### 6. Retention enforcement — enforceable at two of three layers, with two limits worth stating plainly

**The doc's requirement is largely enforceable in the `captureIsolation.test.ts`
/ `captureStack.test.ts` mould. But the mechanism it proposes — "the harness
deletes the crops after the diff" — is aimed at the wrong artifact.**

> **Heading corrected after the live run.** This finding originally read
> *"enforceable at three layers, with one limit"*. Layer (b) turned out to be
> only partially effective, because Double Take ignores `detect.match.save` —
> see the correction inside (b) below, and [FU-6](cycle-7-followups.md#fu-6).

Where biometric artifacts can actually exist, traced through Double Take's source:

| Artifact | Where | Controlled by |
| --- | --- | --- |
| `base64` face image **inside the MQTT payload** | the payload itself, one per face | `detect.match.base64` / `detect.unknown.base64`, default **`false`** |
| Saved crop `…/media/matches/<uuid>.jpg` (a full frame) | Double Take's `.storage` volume | `detect.unknown.save` / `detect.match.save`, default **`true`**, purge 8 h / 168 h |
| `…/media/latest/unknown.jpg`, `latest/<camera>.jpg` | same volume | written by [`recognize.util.js save.latest`](https://github.com/jakowenko/double-take/blob/master/api/src/util/recognize.util.js#L4) whenever a crop was saved |
| Match rows in Double Take's own SQLite | same volume | `database.create.match`, same `save` gate |
| Transient frames `…/tmp/<id>-<type>-<uuid>.jpg` | same volume | always written, deleted per iteration ([process.util.js:82-83](https://github.com/jakowenko/double-take/blob/master/api/src/util/process.util.js#L82-L83)) |
| Embeddings | the detector's own store | only ever created by **enrollment**. With no enrolled subject, none exist. |
| Frigate snapshots | `frigate_media` named volume | `snapshots.enabled`, currently `true` with `retain.default: 1` |

So the three enforceable layers, each with a concrete test:

**(a) Nothing biometric enters the capture artifact — redact on the write path.**
The strongest guarantee available, because it is entirely ours. The Double Take
capture must pass every message through a pure redactor before `appendFileSync`,
replacing any `base64` value. Unit-testable exactly like `payloadShape.test.ts`,
plus a static source assertion (the `captureIsolation.test.ts` pattern) that the
raw message is never written un-redacted.

> **Design constraint the naive version gets wrong:** the redaction must be
> **shape-preserving**. Deleting the key, or nulling it, would corrupt the very
> deliverable — the differ would then report `base64` as absent or as
> `type_changed`, which is a finding about our redactor, not about Double Take.
> Replace the value with a short sentinel **string**, so the recorded type stays
> `string` and a real `base64: null` still diffs as `null`.

**(b) The crops are never produced — config guard.** ~~`detect.unknown.save: false`
and `detect.match.save: false` mean `this.save()` is never called, so no crop
file and no match row is ever written.~~

> ### CORRECTED BY MEASUREMENT — this claim was half wrong, and the conclusion drawn from it was too strong
>
> **`detect.match.save: false` is silently ignored by Double Take.** The save
> condition in
> [process.util.js:67](https://github.com/jakowenko/double-take/blob/master/api/src/util/process.util.js#L67)
> is `if (foundMatch || (UNKNOWN.SAVE && totalFaces))` — **`MATCH.SAVE` is never
> consulted at all.** So any face that clears the match threshold gets its crop
> written regardless of the setting.
>
> Measured during the live run: **7 face crops in `/.storage/matches/` and 3 in
> `/.storage/latest/`, with both `save` keys set to `false`.**
>
> Only `detect.unknown.save` genuinely suppresses writes, and only for results
> with no match. So layer (b) is **partially effective**, not effective:
>
> | Setting | Actually does what it says? |
> | --- | --- |
> | `detect.unknown.save: false` | **Yes** — but see the second defect: it also breaks MQTT publishing for faces-but-no-match results. |
> | `detect.match.save: false` | **No — silently ignored.** |
> | `detect.*.base64: false` | **Yes** — 0 base64 values reached the capture artifact. |
>
> **The "confirmed enforceable" verdict at the head of this finding was
> therefore too strong** and is corrected accordingly: what is mechanically
> enforced is (a) the capture artifact, (c) the gallery precondition, and volume
> destruction on `down -v`. Preventing crops from being *written in the first
> place* is **not** enforced for matched faces, and no config setting available
> to us makes it so.
>
> This run was safe because street faces never resolved, so the only crops were
> of the synthetic subject, and all were destroyed by `down -v`. That is a
> property of this camera, not of the mitigation — a better-placed camera with a
> live gallery would write crops of real people while the config said otherwise.
> Tracked as [cycle-7-followups.md](cycle-7-followups.md) § FU-6.

A `doubleTakeStack.test.ts` in the `captureStack.test.ts` mould reads the
committed `double-take/config.example.yml` and asserts all four `save`/`base64`
keys are `false`, that no `detectors.rekognition` block exists (that would ship
strangers' faces to AWS), and that `.storage` is a **named volume, never a bind
mount into the repo**. `captureStack.test.ts` already proves this style of
file-reading guard works and is non-vacuous.

**That test still earns its place, but it must not be read as proof that no crop
is written** — it proves the config *says* so, and for `match.save` upstream
disagrees. The test now carries a comment saying exactly that, so the next
reader does not inherit the stronger claim.

**(c) No embedding of a real person can exist — precondition check.** Have the
capture script query the detector's subject list at startup and **refuse to run**
unless it is empty (or contains only an allowlisted synthetic subject, per open
decision 1). That is a live guard, not a config claim, and it is the one that
actually enforces "no enrollment gallery".

**The honest limits — two of them, not one.**

What these layers do give: nothing biometric in the artifact we keep, no
embedding of a real person, and a volume that `down -v` destroys.

1. **A test cannot prove the volume was actually reaped.** No assertion can
   check the state of a torn-down Docker volume. Same class as the `-p` flag
   caveat in `docker-compose.frigate.yml`: a loud comment and a runbook step,
   stated as a limit rather than papered over.
2. **Crops of matched faces are written regardless of config** (the correction
   in (b)). Since `MATCH.SAVE` is ignored upstream, the only levers that
   actually prevent a real person's crop from being written are: a gallery that
   cannot match them, a camera that cannot resolve them, or a patched/forked
   Double Take. For FU-3 the second held by accident. **For any real deployment
   it would not**, which is why FU-6 is framed as a pre-deployment gap rather
   than a cleanup.

### 7. With an empty gallery, `confidence` is a hardcoded `0` — and half the slice's stated goal is unreachable

**This is the finding that reshapes the slice, and it is the one the doc has no
version of.**

Traced through
[`compreface.js normalize`](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/compreface.js):

```js
const [face] = obj.subjects;                                  // [] when nothing is enrolled
const confidence = face ? parseFloat((face.similarity * 100).toFixed(2)) : 0;
name: face && confidence >= UNKNOWN.CONFIDENCE ? face.subject.toLowerCase() : 'unknown'
match: confidence >= MATCH.CONFIDENCE && …                     // MATCH.CONFIDENCE = 60
```

DeepStack's normalizer has the same structure. So with **no enrolled subject**:

- `confidence` is **always exactly `0`** — there is no subject to be similar to.
- `name` is always `'unknown'` → `misses` (which filters `name !== 'unknown'`) is
  **always empty**.
- `match` requires `confidence >= 60` → `matches` is **always empty**.
- Every entry additionally carries `checks: ["confidence too low: 0 < 40"]`
  ([actions/index.js](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/actions/index.js)) —
  an undocumented field, and the one genuinely new thing this configuration
  reveals.

What that leaves testable, and what it does not:

| Claim under test | Testable with an empty gallery? |
| --- | --- |
| Envelope shape (`id`/`duration`/`timestamp`/`attempts`/`camera`/`zones`/`counts`) | **Yes** |
| `matches`/`misses`/`unknowns` are arrays, `counts` object | **Yes** |
| Per-face object shape | **Partly** — from `unknowns[]` only |
| `filename` non-empty per face | **Yes** (`filename` is generated regardless of `save`) |
| **0–100 native confidence scale** | **NO — it is a constant 0** |
| `misses` = named identity below threshold | **NO — always empty** |
| Singular `match` topic (`double-take/matches/<name>`) | **NO — never published without a match** |

The 0–100 scale is *the* thing Cycle 4 got wrong by 100×, and it is precisely
what the no-enrollment constraint makes unmeasurable. This is not a reason to
abandon the constraint — it is the substance of **open decision 1**.

Two further shape facts worth recording now, both from
[`mqtt.util.js recognize()`](https://github.com/jakowenko/double-take/blob/master/api/src/util/mqtt.util.js#L155-L200):

- The real `double-take/cameras/<camera>` payload carries **`personCount`**
  (undocumented, duplicates `counts.person`) and, only when Double Take's own
  `auth` is enabled (default off), a `token`. Everything else matches the
  documented envelope.
- The unknown topic is **`double-take/matches/unknown`**, and its payload is
  `{…base, unknown: unknowns[0], unknowns}` — a **singular `unknown` key** the
  normalizer does not know about. Harmless: `unknowns` is present alongside it,
  so [ingest.ts:233-235](../server/src/farm/ingest.ts#L233-L235) produces the
  right rows and ignores the singular (probed: 1 row, correct). Worth knowing
  because it is *not* symmetric with the singular `match` key the normalizer
  does handle.

### 8. Sizing — the "bounded demo" framing is right; the resource estimate is not

The demo framing survives scrutiny: no enrollment gallery, a defined window, no
retries, no monitoring, no watchdog, nothing left running. Every one of those is
consistent with what the endpoint and the deliverable need. Three corrections to
what "minimum footprint" actually costs:

- **Two new services, not one** (finding 1). Double Take is small; the recognizer
  is not. CompreFace's own compose is four services.
- **The recognizer is the real cost, and on this machine it is a blocker** — BL-1.
- **Disk:** 59 GiB free. Frigate's 4.57 GB image is already pulled. Double Take
  adds a few hundred MB; a detector adds 1–3 GB. Comfortable, but not free.

One genuinely *smaller* than the doc assumes: `snapshots` can be turned **off**
on the Frigate side. Double Take polls both `latest.jpg` and `snapshot.jpg`
independently (`frigate.attempts.latest` / `.snapshot`), so setting
`attempts.snapshot: 0` and `snapshots.enabled: false` removes Frigate-side face
image retention entirely and costs only one of two image sources. That is a
retention win the doc does not claim.

### 9. Event volume — expect single digits, possibly zero, and not for the reason the doc gives

The doc reasons "face-match volume < motion volume, so a shorter window". The
mechanism is right, the magnitude is badly off, and the conclusion inverts.

Double Take publishes **one** `double-take/cameras/<camera>` message per Frigate
event that survives *all* of:

1. `type !== 'end'` ([mqtt.util.js:70](https://github.com/jakowenko/double-take/blob/master/api/src/util/mqtt.util.js#L70));
2. `label` ∈ `frigate.labels` — default `['person']`, so **every `car` event is
   discarded**;
3. not already processed, and not concurrent with an in-flight request
   (`PROCESSING` is a single global — Double Take processes **one event at a
   time**, and drops `update`s that arrive while busy);
4. at least one face actually detected in the fetched frame — nothing is
   published when `matches`, `misses` and `unknowns` are all empty.

Measured against FU-1's own capture as the best available prior: 250 messages in
18m47s, of which **21 were `new`**, spread across `person` *and* `car`. So the
input to Double Take is on the order of ten person-events in twenty minutes,
before the face-detection filter — and a 1280×720 camera pointed at street
traffic from a gate may resolve no usable face at all.

**A 19-minute window is very likely to yield zero payloads.** This is BL-3, and
open decision 2 is what to do about it.

---

## BLOCKING ISSUES

### BL-1 — the only mature detector is amd64-only, on an arm64 machine

This machine is an **Apple M2 Pro**; `docker version` reports server arch
`arm64`. Image support for every detector Double Take v1.13.2 supports:

| Detector | Latest image | Architectures |
| --- | --- | --- |
| **CompreFace** (`exadel/compreface`, `-core`) | 1.2.0, 2023-08-17 | **`linux/amd64` only** |
| **DeepStack** (`deepquestai/deepstack`) | 2022-01-16 | `:latest`/`:cpu` amd64; **`:arm64` exists** |
| **Facebox** (`machinebox/facebox`) | 2020-12-01 | amd64 only; defunct, needs a licence key |
| **AWS Rekognition** | cloud | n/a |

CompreFace — the detector the repo's own fixtures name (`detector: 'compreface'`
in [scenarios.ts:172](../server/src/farm/scenarios.ts#L172) and in
`FARM_EVENTS.md`'s documented example) — **has no arm64 image**. Under Docker
Desktop it would run through qemu emulation, which for a TensorFlow face-
recognition service is slow enough to be a real risk of not working at all.

`deepquestai/deepstack:arm64` is the only native option, and it is a 2022 image
built for Raspberry Pi / Jetson. **It needs a ten-minute smoke test before
anything else is built on it** — enrol nothing, POST one image to
`/v1/vision/face/recognize`, confirm a 200 with `predictions`.

**AWS Rekognition must be ruled out explicitly**, not merely not-chosen: it would
transmit the faces of non-consenting members of the public to a third-party cloud
service. That is categorically incompatible with this slice's premise, and it
should be asserted absent in the config guard (finding 6b) rather than left to
judgement.

*Resolution needed before implementation.* See open decision 3.

### BL-2 — image handoff between Frigate 0.17.2 and a 2022-era Double Take is unproven

Double Take fetches frames from two Frigate endpoints
([config.js:147-150](https://github.com/jakowenko/double-take/blob/master/api/src/constants/config.js#L147-L150)):

```text
GET {frigate}/api/{camera}/latest.jpg?h=500
GET {frigate}/api/events/{id}/snapshot.jpg?h=500&crop=1
```

Both still exist in current Frigate. **The risk is not the path, it is the
`Content-Type`.** `isValidURL` accepts only `image/jpg`, `image/jpeg` or
`image/png`, and on anything else it logs `url validation failed` and **skips
processing entirely — silently, from the payload's point of view**
([process.util.js:177-203](https://github.com/jakowenko/double-take/blob/master/api/src/util/process.util.js#L177-L203)).
Frigate has upstream reports of both a snapshot endpoint returning `image/webp`
([#12027](https://github.com/blakeblackshear/frigate/discussions/12027)) and a
latest-frame endpoint setting an invalid `Content-Type`
([#19553](https://github.com/blakeblackshear/frigate/discussions/19553)).

Neither is confirmed against 0.17.2 — that needs one `curl -I` against a running
Frigate, which this pass deliberately did not do. But this is the **most likely
first failure**, and it fails in the worst possible way: Frigate is healthy,
Double Take is connected, MQTT is subscribed, and no message is ever published.

*Mitigation:* the smoke test in the runbook must `curl -I` both URLs and assert
the content type **before** a window is spent, and Double Take's log must be
checked for `url validation failed` rather than only checking that the capture
file is growing.

### BL-3 — the deliverable may be empty, and the DoD as drafted would not say so

Per finding 9, a short passive window against street traffic can plausibly
produce **zero** Double Take messages. `verifyPayloadShape.ts` handles this
gracefully for Frigate — it prints "nothing to diff" and exits 1 — but the DoD as
this doc drafts it ("non-null confidence in the correct range, correct array
structure, non-empty `filename`") is written for a non-empty capture and says
nothing about sufficiency.

Worse, per finding 3, a capture of `N` payloads that are *all* `confidence: 0`
would pass a naively-ported DoD at 7/7. **The definition of done must include a
sufficiency floor** — a minimum payload count, and at least one *non-zero* native
confidence — or a green run will mean nothing. See open decision 4.

---

## Corrections to the proposed engineering next steps

- ~~Stand up Double Take pointed at the existing Frigate instance~~ →
  **Double Take plus a recognition service**, and the recognizer choice is
  blocked on BL-1. Frigate needs no change except pointing Double Take at
  `http://frigate:5000` (the internal unauthenticated port) — but see BL-2.
- ~~Extend or sibling the existing `captureMqtt.ts` to also subscribe to Double
  Take's `match` topic~~ → **subscribe to `double-take/cameras/#`**, not the
  match topic. The singular `match` topic is never published without an
  enrolled identity (finding 7); the camera topic is the one that carries the
  full `matches`/`misses`/`unknowns` envelope this slice is validating. Add
  `double-take/matches/unknown` if the singular-shape variant is wanted too.
  **And it must be a sibling, not a straight reuse** — finding 6a puts a
  redaction step on the write path, which the Frigate capture has no business
  carrying.
- ~~Build the retention-cleanup step into the harness itself~~ → **the harness
  cannot clean up what it never sees.** The crops live in Double Take's volume.
  Replace "cleanup" with "never produce, and redact what does reach us" —
  finding 6, layers (a), (b), (c).
- ~~a Double-Take-aware extension of `verifyPayloadShape.ts` or a sibling script
  if item 3 says the differ doesn't generalize~~ → **a sibling, unconditionally**
  (finding 4). `payloadShape.ts` needs no change; `verifyPayloadShape.ts` is
  hardwired in five places, one of which (`loadCapture`'s root-`type` gate) would
  silently discard every Double Take message.
- **New:** `.gitignore` covers `frigate/config.yml` but nothing for Double Take.
  A `double-take/config.yml` would hold the detector's API key and the MQTT
  host, so it needs an explicit entry alongside a committed
  `config.example.yml` — same split the Frigate config already uses.
- **New:** adding Double Take + detector as services **inside
  `docker-compose.frigate.yml`** is the right call, despite the file's name.
  A separate compose file would land in a separate project and network (its own
  `name:`, per [`captureStack.test.ts`](../server/src/farm/captureStack.test.ts)),
  and Double Take would then have no service-name route to Frigate or the broker
  — cross-project docker networking is exactly the complexity a bounded demo
  should not buy. The existing project-isolation guard then covers the whole
  capture stack for free.

## Revalidation approach / definition of done — corrected

- Deltas list comparing real Double Take payloads against `FARM_EVENTS.md`'s documented shape, same two-baseline approach as FU-1 (doc-parsed at runtime + synthetic generator).
  - **Still right, with the finding-4 caveat:** the envelope and the *face
    object* must be diffed as two separate aggregates, or the report is 16 false
    deltas and one real one. And baseline B must stamp a `timestamp` into the
    generator payload, which omits it.
- ~~DoD asserts on values, not just HTTP status/acceptance — non-null confidence in the correct 0–100 native range pre-normalization, correct array structure, non-empty `filename` where documented.~~
  - **The instinct is right and the FU-1 lineage is right, but as written this
    passes on garbage.** Per finding 3 and BL-3 it must additionally assert:
    **(i)** a minimum payload count (sufficiency floor); **(ii)** at least one
    **non-zero** native confidence — otherwise an all-zeros unenrolled run scores
    7/7; **(iii)** the native pre-normalization value is `> 1` wherever non-zero,
    which is the *only* check that catches the 0..1-scaled 100× inversion, since
    the normalized value would be `0.0091` and pass an "inside 0..1" test;
    **(iv)** `camera_id === 'test_street_cam'` and `zone IS NULL`, carried over
    from FU-1 unchanged and confirmed reachable (Double Take copies
    `after.current_zones`, which is `[]` on this zone-less camera).
- Success is either "zero deltas, assumptions confirmed" or a corrected `FARM_EVENTS.md` Double Take section — same bar as FU-1.
  - **"Zero deltas" is already known to be unattainable**, and that is fine.
    `checks[]` and `personCount` are confirmed-real undocumented fields, and the
    `matches` ⇄ `unknowns` emptiness inversion is structural. Success is a
    *correct* deltas list plus a corrected `FARM_EVENTS.md`, not an empty one.
    `FARM_EVENTS.md` will also need the finding-5 correction about `identity`.
- Additional, non-negotiable success condition specific to this slice: **no raw face crop or embedding from a real, unconsented individual survives the capture window** — verified mechanically, not asserted by description.
  - **CONFIRMED achievable** via finding 6's three layers, each with a real test
    in an existing repo pattern — **with the stated limit** that no unit test can
    prove a torn-down Docker volume is gone. That last step is a runbook
    obligation with a loud comment, in the same way
    `docker-compose.frigate.yml` handles the `-p` flag it cannot test.

---

## Blocking-issue smoke tests (2026-08-28)

Run before any implementation, per the sequencing decision. The Frigate stack was
brought up unchanged from its committed config, probed, and **torn down with
`down -v` immediately afterwards** — there was no reason to keep recording street
footage during the reporting pause. `frigate-capture_*` volumes were removed and
the Langfuse containers were untouched, so the project-isolation guard held in
practice again.

### BL-2 — RESOLVED, PASSES — both image endpoints return `image/jpeg`

Live against **Frigate 0.17.2-3d4dd3a**, probed with exactly the requests Double
Take issues:

| Probe | Result |
| --- | --- |
| `GET /api/version` (Double Take's `frigate.status()` gate) | `200`, `0.17.2-3d4dd3a`, **no credentials** |
| `GET /api/test_street_cam/latest.jpg?h=500` | `200`, **`Content-Type: image/jpeg`**, 2304×1296, 325 KB |
| `GET /api/events/<id>/snapshot.jpg?h=500&crop=1` | `200`, **`Content-Type: image/jpeg`**, 2304×1296, 321 KB |

**The webp / invalid-Content-Type risk does not materialise on 0.17.2 for either
path.** Double Take's `isValidURL` accepts both, so the silent
skip-all-processing failure mode BL-2 was written to catch will not occur.

**The auth question is settled, and the answer is better than the config
suggests.** Frigate 0.17.2 reports `auth.enabled: true` — auth *is* on by default
— and every request above still succeeded unauthenticated, because the compose
file publishes only port **5000**, the internal unauthenticated port. Port 8971
(the authenticated one) is not published. So Double Take needs no auth support and
Frigate needs no `auth.enabled: false`. Nothing to change.

#### Two new findings this probe turned up

**(a) Double Take's `?h=` resize parameter is silently ignored by Frigate 0.17.2 —
the parameter was renamed to `height`.** Measured on the same endpoint:

| Request | Returned |
| --- | --- |
| `?h=500` | 2304×1296, 323 KB — **parameter ignored** |
| `?height=500` | 888×500, 68.7 KB — honoured |
| *(no params)* | 2304×1296, 323 KB |

Double Take hardcodes `h=${image.height}`
([config.js:147-150](https://github.com/jakowenko/double-take/blob/master/api/src/constants/config.js#L147-L150)),
so it will pull **full-resolution ~320 KB frames instead of the ~69 KB it intends
— on every attempt, up to 10 attempts × 2 endpoints per event.** Roughly a 4.7×
bandwidth and decode cost per attempt, and larger images into the detector, which
matters on a CPU-only arm64 detector.

**Not a blocker, and fixable in config with no patching:** the same lines show
`image.snapshot ||` and `image.latest ||`, so Double Take's
`frigate.image.latest` / `frigate.image.snapshot` keys override the whole URL.
Set them explicitly with `height=500`.

**(b) The camera's stream is now 2304×1296, not the 1280×720 FU-1 recorded.**
Frigate auto-detected `detect: {width: 2304, height: 1296, fps: 5}`, and
`latest.jpg` decodes at 2304×1296. FU-1's doc and `.env.example` both state
`/onvif1` is 1280×720 H.264 Baseline. **Those notes are now stale.** Cannot tell
from here whether the camera's profile changed (firmware, or a settings change in
the Yoosee app) or whether FU-1's SPS decode read a different stream — worth one
line of correction in `.env.example` either way. The go2rtc H265 codec mislabel is
**still present** (`media: video, recvonly, H265`) and the restream workaround
still handles it, exactly as FU-1 documented.

Also minor, recorded so the next prober does not misread it: **`curl -I` (HEAD)
returns `405 Method Not Allowed` with `allow: GET`** on these endpoints. Double
Take uses GET, so this is a probing artifact rather than a finding — but a HEAD
probe looks like a broken endpoint.

### BL-3 — materially de-risked: ~95 person events per 20 minutes, not ~10

Measured on the live instance during the BL-2 window: **23 `person` events in
4.8 minutes — 4.8/min, ≈95 per 20 minutes**, all 23 with `has_snapshot: true`,
and zero `car` events in that sample.

This **overturns finding 9's projection**, which extrapolated ~10 person-events
per 20 minutes from FU-1's 21 `new` events across person *and* car in 18m47s.
The likeliest cause is finding (b) above: at 2304×1296 rather than 1280×720,
Frigate resolves people who previously went undetected.

Consequences:

- The decision-2 rate probe is very likely to succeed on the first pass, so
  consented walk-bys may not be needed at all.
- The remaining unknown is **face yield**, not event volume: how many of those
  ~95 frames contain a face large enough for the detector. That is now the only
  open question BL-3 leaves, and it cannot be answered without the detector
  running.
- **A new constraint appears at this rate:** Double Take processes **one event at
  a time** (`PROCESSING` is a single module-level global) and discards events that
  arrive while it is busy. At 4.8 events/min with up to 20 image attempts each, it
  will be saturated and will drop most events. That is *fine* — the slice needs a
  handful of payloads, not coverage — but it means **payload count is not a
  measure of camera activity**, and the sufficiency floor in the DoD should be set
  low (single digits) rather than scaled to event volume.

### BL-1 — RESOLVED, PASSES — DeepStack runs natively on arm64

`deepquestai/deepstack:arm64` pulled clean (1.42 GB compressed / 42 layers,
**2.81 GB on disk**, image dated 2022-01) and `docker image inspect` reports
**`linux/arm64`** — native, no qemu emulation. It started and registered every
face endpoint: `/v1/vision/face`, `/face/recognize`, `/face/register`,
`/face/match`, `/face/list`, `/face/delete`.

Probed with a **locally generated gradient image** — deliberately not a frame from
the camera, which contains real people, and not any photo of a real person:

| Probe | Result |
| --- | --- |
| `POST /v1/vision/face/recognize` (Double Take's exact call, empty gallery) | `200` `{"success":true,"predictions":[],"duration":0}` |
| `POST /v1/vision/face/register` with a faceless image | `400` `{"success":false,"error":"no face detected"}` |
| `POST /v1/vision/face/list` | `200` `{"success":true,"faces":[]}` |

**The register probe is the strongest result.** `predictions: []` from `recognize`
would be equally consistent with a stub that never loaded a model; *"no face
detected"* means the detector **actually executed on arm64** and correctly
concluded there was no face. Combined with the `200` response shape matching
exactly what
[`deepstack.js normalize`](https://github.com/jakowenko/double-take/blob/master/api/src/util/detectors/deepstack.js)
reads (`data.success`, `data.predictions`), BL-1 is answered.

**Decision 3 resolves to DeepStack.** No fallback to emulated CompreFace needed.
Consequence to record in the deltas list: the observed per-face `detector` field
will be **`'deepstack'`**, not the `'compreface'` that
[scenarios.ts:172](../server/src/farm/scenarios.ts#L172) and `FARM_EVENTS.md`'s
documented example both assume. That is a legitimate delta, not a defect.

`/face/list` returning `{"faces":[]}` is exactly the endpoint finding 6(c)'s
gallery precondition check needs, and a failed register leaves the gallery empty —
so the guard has a clean signal to assert on.

#### Residual limit, stated plainly

This proves the model runs and the endpoints behave. It does **not** prove
DeepStack *finds* a face in a real frame — that needs a face image, which is
blocked on the synthetic portrait (open decision 1). Face yield therefore remains
the one genuinely open question, as BL-3 also concluded.

#### The measurement that most changes sizing: ~3.4 s per recognize call

| Call | Wall time |
| --- | --- |
| first (cold, model load) | 4.97 s |
| warm ×3 | 3.44 / 3.46 / 3.77 s |
| **full-res 2304×1296, 131 KB** | **3.28 s** |

Two consequences, the second of which corrects a finding above:

- **Double Take's default `attempts` are unaffordable here.** Defaults are
  `attempts.latest: 10` + `attempts.snapshot: 10` = up to **20 sequential
  recognize calls per event**, and `stop_on_match: true` only short-circuits on a
  *match* — which, with an empty or synthetic-only gallery, never happens. So
  every event burns all 20 attempts: **~68 s per event**, against ~4.8 person
  events/min arriving, processed **one at a time**. In a 20-minute window that is
  roughly **17 events processed** and the rest dropped. `attempts` must be turned
  down hard (`latest: 2`, `snapshot: 1` is a sane starting point) or the window is
  spent on redundant detector calls. Detector timeout is 15 s by default, so the
  3.4 s call has comfortable margin.
- **CORRECTION to BL-2 finding (a).** That finding claimed the ignored `?h=`
  parameter "matters on a CPU-only arm64 detector". Measured: **it does not.**
  DeepStack resizes internally and takes the same ~3.3 s on a 131 KB full-res
  frame as on a 10 KB 400×400 one. The `h=` → `height=` fix is a bandwidth and
  decode saving only, **not** a throughput fix — so it drops to a nice-to-have
  rather than something to fix before the window.

---

## OPEN DECISIONS — all five RESOLVED 2026-08-28

Recorded with the reasoning intact, because the implementation encodes them and
the reasoning is not recoverable from the code. The resolution is stated at the
head of each; the options are kept below it.

| # | Resolution |
| --- | --- |
| 1 | **Enrol exactly one synthetic face** — AI-generated or otherwise clearly non-real. **Not** Double Take's bundled `lenna.jpg`, and no other photo of an identifiable person: Lenna is a real person, and using her would substitute one non-consenting individual for another. *Sourcing this is the one item still blocking implementation — see the note under decision 1.* |
| 2 | **20-minute passive rate probe first.** If it yields enough payloads, use that capture. If not, move to consented close-range walk-bys rather than extending the passive window for hours. |
| 3 | **DeepStack arm64**, per BL-1's smoke test — it passed, so no fallback to emulated CompreFace. **Rekognition is excluded categorically**, and its absence is asserted in the config guard (no `detectors.rekognition` block). |
| 4 | **Tightened DoD confirmed as drafted** — sufficiency floor on payload count, at least one non-zero native confidence, native pre-normalization value asserted `> 1` wherever non-zero, plus the `camera_id` / `zone` checks carried over from FU-1. |
| 5 | **Opened as [FU-4](cycle-7-followups.md#fu-4)**, same treatment as FU-1's deferred `top_score` fix — and written up explicitly as a live bug to pick up *before any real farm-facing camera runs this path*, not an eventual cleanup. |

> **STILL BLOCKING — the synthetic portrait for decision 1 does not exist yet.**
> Attempted from this environment and failed at the connection level:
> `thispersondoesnotexist.com` and the Wikimedia Commons API (other hosts —
> GitHub, Docker Hub — resolve fine, so this looks like egress filtering rather
> than the sites being down). `randomuser.me` *did* return a JPEG but serves
> **photographs of real people**, so it falls under decision 1's exclusion for
> exactly the reason `lenna.jpg` does, and was rejected.
>
> This is the last thing gating implementation. It also gates the only residual
> question BL-1 and BL-3 both leave open — whether the detector actually resolves
> a face at this camera's distance — because that cannot be tested without a face
> image. Whatever image is chosen, its **provenance should be recorded next to
> it**, since "this is synthetic" is the entire basis on which enrolling it is
> acceptable.

### 1. Does the gallery stay strictly empty, accepting that the confidence claim goes unvalidated? *(RESOLVED — option (a), one synthetic face)*

Finding 7: an empty gallery means `confidence` is a hardcoded `0`, `matches` and
`misses` are always empty, and the 0–100 scale — the exact claim Cycle 4 got
wrong by 100× — cannot be measured. Options:

- **(a) Enrol one synthetic face.** A generated or public-domain portrait of no
  real person (Double Take even ships `lenna.jpg` as its own test image). Every
  stranger then receives a genuine similarity score against it, so `confidence`
  spans a real 0–100 range and the scale becomes measurable. No real person is
  enrolled, so no stranger can be identified as anyone. Strangers still land in
  `unknowns` unless a similarity happens to clear 40, which would produce a
  `misses` row naming the synthetic subject — harmless, and it exercises the
  `misses` path the empty-gallery run cannot reach at all.
- **(b) Enrol the project owner's own face,** with their own consent. Same
  measurement benefit; adds a real (self-consented) biometric enrolment, and a
  stranger clearing threshold would be mislabelled as the owner.
- **(c) Keep the gallery empty** and record the confidence-scale claim as
  explicitly unvalidated, the way FU-2 records multi-zone. Cheapest, most
  conservative, and leaves the slice's headline goal unmet.

**Recommendation: (a).** It is the only option that meets the stated goal without
enrolling any real person's biometrics, and it strictly dominates (b) on privacy.
If (c) is chosen, the doc and `FARM_EVENTS.md` must both say plainly that the
0–100 scale remains docs-only after this slice — otherwise the follow-up looks
closed when it is not.

### 2. How is the window sourced — passive street traffic, or consented close-range walk-bys? *(RESOLVED — probe first, then walk-bys if needed)*

Finding 9 says a short passive window may yield nothing. Options:

- **(a) Consented walk-bys.** The project owner walks past the camera at close
  range a handful of times during a short, quiet window. Guarantees payloads,
  and — because the window can then be minutes rather than hours at a quiet time
  of day — **processes fewer strangers, not more**. Better on both axes.
- **(b) A long passive window** (hours), accepting more stranger processing and
  an uncertain yield.
- **(c) A short passive probe first** to measure the real rate, then decide.

**Recommendation: (c) then (a)** — spend twenty minutes measuring the rate, then
force the deliverable with consented walk-bys rather than buying volume with
hours of street footage. Note this is a decision about whose faces get processed,
which is why it is listed as blocking rather than as an implementation detail.

### 3. Which detector, given BL-1? *(RESOLVED — DeepStack arm64; smoke test passed)*

`deepquestai/deepstack:arm64` is the only native-arm64 option and is a 2022
image. CompreFace is the detector the repo's fixtures and `FARM_EVENTS.md`
already name (`detector: 'compreface'`), but is amd64-only and would run
emulated.

**Recommendation: smoke-test DeepStack arm64 first** (ten minutes, one image,
one HTTP call). If it works, use it, and record that the observed `detector`
field will be `'deepstack'` rather than the `'compreface'` the fixtures assume —
which is itself a legitimate delta to report, not a problem. Fall back to
emulated CompreFace only if DeepStack fails.

### 4. Confirm the tightened definition of done *(RESOLVED — confirmed as drafted)*

Per finding 3 and BL-3, the DoD inherited from FU-1 is **not strong enough here**
and would report 7/7 PASS on an all-zeros capture, and would also miss a
0..1-scaled 100× inversion. The corrected list is in *Revalidation approach*
above — sufficiency floor, at least one non-zero native confidence, and a
native-value `> 1` assertion. This changes what "done" means for the slice, so it
needs explicit confirmation, exactly as FU-1's open decision 4 did.

### 5. Does the `unknown_cluster` correction land in this slice or its own? *(RESOLVED — its own, as FU-4)*

Finding 5 establishes that real Double Take supplies `identity: 'unknown'` for
every unknown face, and that `countPriorSightings` would therefore treat all
unknown faces everywhere as one recurring individual — flagging `urgent` from the
third sighting onward and corrupting genuine farm-camera occurrence counts.

Nothing breaks *during* this slice, because decision 1 (inherited from FU-1)
keeps these rows out of `farm_events` entirely. But it is a real defect in a
shipped classification rule, discovered here.

**Recommendation: record it, do not fix it here** — open it as FU-4 alongside
FU-1's deferred `top_score` fix, for the same reason: changing what
`unknown_cluster.identity` means is a semantic change to a stored column with its
own blast radius. This slice's deliverable is the measurement.

---

## DELIVERABLE — the deltas list (live capture, 2026-08-28)

**Verdict: the Cycle 4 Double Take payload-shape assumption HOLDS. Zero breaking
deltas. The ingestion contract works against real Double Take v1.13.2 with no
code change — 14 rows created, 0 rejected, 0 skipped.**

**And the headline claim is confirmed: confidence really is on a 0–100 native
scale**, observed 77.86 – 100 across 15 faces, every value non-zero and ≥ 1
pre-normalization. Cycle 4's 100× mock error was a genuine mock bug, not a
misreading of the upstream shape.

Stack: Frigate 0.17.2 → Mosquitto → Double Take **v1.13.2** → DeepStack
(`deepquestai/deepstack:arm64`, native). Camera `test_street_cam`, gallery
holding exactly one synthetic subject.

Reproduce with:
`npm run verify:payload:dt -w server -- --capture=<path>`

### Definition of done — 12/12 PASS

| Check | Result |
| --- | --- |
| sufficiency: ≥3 recognition payloads | 14 |
| rows created | 14 |
| every row non-null `confidence` | 14/14 |
| every stored `confidence` inside 0..1 | 14/14 |
| **at least one NON-ZERO native confidence** | **15/15 faces** |
| **every non-zero native confidence ≥ 1 (0–100 scale)** | **15/15, max 100, min 77.86** |
| every `occurred_at` inside the window | 14/14 |
| every row non-empty `source_event_id` | 14/14 |
| every row has a `snapshot_ref` | 14/14 |
| every `camera_id` is `test_street_cam` | 14/14 |
| `zone` NULL on every row (rule 1 unreachable) | 14/14 |
| no inline image data survives the capture | 0 base64 values in the artifact |

The two checks in bold are the ones FU-1's list could not express, and they are
the reason the tightened criterion was worth adopting: **an empty-gallery run
would have scored 10/10 on FU-1's checks while every confidence was a hardcoded
zero.** The sufficiency floor is also proven non-vacuous — it *failed* on a
second, smaller capture (2 payloads), which is what it is for.

By `event_type`: `face_match` 12, `unknown_cluster` 2. Identities: `synthetic_1`
12, `unknown` 2.

### Deltas vs FARM_EVENTS.md

**`only_in_documented`: NONE.** Every field the doc documents — and every field
`ingest.ts` reads — is present in the real payload. That is the result that
matters.

**Per-face object — one delta, and it is genuinely useful:**

| Path | Type | Note |
| --- | --- | --- |
| `checks` / `checks[]` | `array` / `string` | Present when the face failed a threshold, e.g. `"confidence too low: 77.86 < 90"`. Undocumented; states which threshold rejected the face and against what value. |

Everything else in the documented per-face set — `name`, `confidence`, `match`,
`box{top,left,width,height}`, `type`, `duration`, `detector`, `filename`,
`base64` — matched exactly, from both `matches[]` and `unknowns[]`.

**Envelope — 4 `only_in_real`, 2 `type_changed`, none breaking:**

| Path | Documented | Real | Why |
| --- | --- | --- | --- |
| `personCount` | absent | `number` | Undocumented; duplicates `counts.person`. Camera topic only. |
| `match` | absent | `object` | The singular `double-take/matches/<name>` topic shape. Documented in prose, not in the JSON block. |
| `unknown` / `unknowns[]` | absent / — | `object` | The singular `double-take/matches/unknown` topic shape. |
| `matches` | `array` | `array \| empty-array` | Empty when nothing cleared the match bar. |
| `unknowns` | `empty-array` | `array \| empty-array` | The doc example simply shows a match. |
| `counts` and children | always | **7/14 payloads** | The `matches/*` topics carry no `counts`. Not read by the normalizer. |

**The finding-4 fix worked.** Diffing whole payloads would have produced ~16
false `only_in_real` deltas (every `unknowns[].*` field reported as
undocumented, when all but `checks` are documented under `matches[]`) and zero
coverage of the per-face claim. Splitting envelope from pooled face objects
reduced that to **one real per-face delta**.

### What this run did NOT validate, and why

Stated plainly, because the number of PASSes above could otherwise be read as
more than it is.

- **Street traffic produced zero faces.** Over ~20 minutes of live capture with
  real person events arriving, DeepStack detected **no face at all** — `counts:
  {person: 0, match: 0, miss: 0, unknown: 0}` on every Frigate-triggered event,
  and 0 faces in a directly-probed live frame. At this camera's distance from
  the street, faces are not resolvable. **So none of the payloads above came
  from a passer-by.** They came from the synthetic subject, injected through
  Double Take's own `/api/recognize` endpoint — the same controller, normalizer,
  MQTT publisher and topic shapes that a Frigate-triggered recognition uses.
  What is validated is the payload contract; what is *not* validated is that
  this camera can ever produce face events.
- **`misses[]` was observed but not captured over MQTT.** A real `misses` entry
  (`name: 'synthetic_1'`, `confidence: 77.86`, `match: false`, with `checks`)
  was produced and read from Double Take's HTTP response, confirming the
  documented shape and the "named identity below threshold" semantics. It never
  reached MQTT, because of upstream defect 2 below.
- **`type` was `'manual'`, not `'latest'`/`'snapshot'`.** A consequence of
  driving recognition through the API rather than a Frigate event. The field's
  presence and type are confirmed; its Frigate-path values are not.
- **`id` was a UUID, not a Frigate event id**, for the same reason. On the
  Frigate path it is the Frigate event id — confirmed by the one
  Frigate-triggered payload that did publish.
- Consented close-range walk-bys (decision 2's fallback) were **not** run — that
  needs a person at the camera, which is the open item below.

### Two upstream defects found while configuring retention

Neither affects payload shape; both affect anyone standing this up, and the
first one weakens a privacy control this slice relied on.

**1. `detect.match.save: false` is silently ignored.** Double Take's save
condition is `if (foundMatch || (UNKNOWN.SAVE && totalFaces))` — it never
consults `MATCH.SAVE`. **Measured: 7 face crops written to `/.storage/matches/`
and 3 to `/.storage/latest/` with both `save` keys set to `false`.** So finding
6's layer (b) is only *partially* effective: `detect.unknown.save` works,
`detect.match.save` does not. In this run the crops were all of the synthetic
subject (no real face ever resolved), and all were destroyed by `down -v` — but
the control did not do what the config said. **Tracked as
[cycle-7-followups.md](cycle-7-followups.md) § FU-6**, and finding 6(b) above is
corrected in place rather than rewritten, so the over-strong original conclusion
stays legible.

**2. `detect.unknown.save: false` breaks MQTT publishing for any
faces-but-no-match result.** `recognize.util.js`'s `save.latest()`
unconditionally `copyFileSync`s the crop that `save: false` prevented from
existing; the ENOENT is masked by an `ERR_HTTP_HEADERS_SENT` in Double Take's
error middleware, and `mqtt.recognize()` never runs. **So the privacy-correct
configuration silently suppresses exactly the `unknowns` payloads FU-3 exists to
capture.** The `unknowns` payloads above were obtained by setting
`unknown.save: true` for that step only — defensible here because street faces
never resolve, so the sole face in play was the synthetic one.

Both are recorded in [FARM_EVENTS.md](FARM_EVENTS.md) § *Double Take — measured
against a live instance*.

### `unknowns[].name` is the literal string `'unknown'` — CONFIRMED LIVE

Predicted from source in finding 5, now measured: **`name: "unknown"`,
`confidence: 77.86`**. Not a cluster id. `farm_events.identity` is that constant
on every `unknown_cluster` row, so rule 2's per-identity occurrence counting has
nothing to distinguish visitors with. Tracked as
[cycle-7-followups.md](cycle-7-followups.md) § FU-4, which was written before
this measurement and is now confirmed rather than predicted.

### What was built

| File | Role |
| --- | --- |
| [`farm/redact.ts`](../server/src/farm/redact.ts) | PURE shape-preserving biometric redaction. No fs, no net, no db. |
| [`farm/redact.test.ts`](../server/src/farm/redact.test.ts) | 11 tests, including a negative control on the detector itself. |
| [`farm/doubleTakeGuards.ts`](../server/src/farm/doubleTakeGuards.ts) | PURE preconditions: retention config, gallery contents, recognition actually working. |
| [`farm/doubleTakeGuards.test.ts`](../server/src/farm/doubleTakeGuards.test.ts) | 13 tests, including the restart trap. |
| [`farm/doubleTakeStack.test.ts`](../server/src/farm/doubleTakeStack.test.ts) | 7 config/compose guards, negative-controlled. |
| [`farm/enrollSynthetic.ts`](../server/src/farm/enrollSynthetic.ts) | `enroll:synthetic` — enrol, **restart**, verify. |
| [`farm/captureDoubleTake.ts`](../server/src/farm/captureDoubleTake.ts) | `capture:doubletake` — preflight, subscribe, redact, append JSONL. |
| [`farm/verifyDoubleTakeShape.ts`](../server/src/farm/verifyDoubleTakeShape.ts) | `verify:payload:dt` — envelope + per-face diffs, two baselines, tightened DoD. |
| [`double-take/config.example.yml`](../double-take/config.example.yml) | Throwaway config; every privacy setting annotated in place. |
| [`double-take/enroll/README.md`](../double-take/enroll/README.md) + `PROVENANCE.txt` | Why one synthetic subject, and how its origin is made checkable. |

`payloadShape.ts` was **not changed** — finding 4 was right that the differ
generalises. `captureIsolation.test.ts` was extended to cover all five new
modules.

Test suite: **105/105** (was 74). `npm run typecheck` clean. **`dairy.db`'s
mtime was byte-identical across the entire session** — decision 1 held in
practice, not just in the unit test.

### Teardown, verified

`docker compose -f docker-compose.frigate.yml down -v` removed all four volumes
— `frigate_media`, `frigate_data`, **`deepstack_data`** (the embedding) and
**`doubletake_data`** (the 7 crops) — plus every container and the network. The
Langfuse stack was untouched, so the compose-project isolation guard held in
practice again. The synthetic enrolment image remains on disk, gitignored; it is
machine-generated, so it is not a biometric artifact of any person.

### To run the capture

```bash
# 1. Camera address + RTSP credentials in .env (see .env.example), as for FU-1.
# 2. Local configs from the committed examples
cp frigate/config.example.yml frigate/config.yml
cp double-take/config.example.yml double-take/config.yml
# 3. A SYNTHETIC portrait as double-take/enroll/synthetic_1.jpg,
#    with its origin recorded in PROVENANCE.txt. See double-take/enroll/README.md
#    — it must not be a photo of a real person, Lenna included.
# 4. Bring the stack up
docker compose -f docker-compose.frigate.yml up -d
#    Confirm http://localhost:5000 decodes the feed before spending a window.
# 5. Enrol the one synthetic subject. This ALSO restarts the detector and
#    verifies recognition — DeepStack only loads its gallery at process start,
#    so without the restart every face returns unknown/0 and the window is wasted.
npm run enroll:synthetic -w server
# 6. Capture. Refuses to start unless the gallery holds exactly synthetic_1,
#    recognition resolves it, and the live config has retention disabled.
npm run capture:doubletake -w server -- --minutes=20
# 7. Produce the deltas list
npm run verify:payload:dt -w server -- --capture=server/captures/double-take-<stamp>.jsonl
# 8. Tear down — it must not outlive the window. This destroys deepstack_data
#    (embeddings) and doubletake_data (any crops) along with everything else.
docker compose -f docker-compose.frigate.yml down -v
```

A short `--minutes=2 --max=5` run first confirms Double Take is publishing
before committing to a window. If nothing arrives, check
`docker logs frigate-double-take` for `url validation failed` (image fetch),
`no detectors configured`, or `counts: {person: 0...}` — the last means the
pipeline is healthy and simply found no face, which is what this camera does.

**Do not raise `detect.*.save` to work around silence** without reading the two
upstream defects above: `match.save` does nothing, and `unknown.save: false` is
what suppresses `unknowns` publishing.

## Security / privacy note

Inherited from FU-1 and extended: RTSP credentials and the camera's local IP stay
in gitignored `.env`. A Double Take config additionally holds the detector's API
key and must be gitignored the same way (see *Corrections* above).

Beyond secrets, this slice processes the faces of people who have not consented.
The mitigations that make that defensible are **not** the doc's original
framing ("delete the crops afterwards") but: no enrolment of any real person, no
crop or embedding ever written (`save: false`), no image bytes in the capture
artifact (redaction on the write path), the shortest window that yields a
deliverable, and a stack that is destroyed with `down -v` and not left running.
Each of the first three is mechanically asserted; the last is a runbook step that
cannot be, and is stated as such.

## Kickoff prompt for Claude Code — ✅ done

The validate-first pass this prompt asked for is complete; results are in
[§ Validation findings](#validation-findings-repo-evidence-pass-2026-08-28).
**Implementation has not started, and should not until BL-1 and open decisions
1–4 are resolved.**

> Before implementing anything, read docs/Cycle7-fu3-double-take-validation.md and validate its assumptions against this actual repo — same validate-first pass as Cycle 7 step 1 for the Frigate side (see docs/cycle-7-live-camera-validation.md for that precedent). Do not deploy Double Take, write capture code, or touch any config yet — this pass is validation only. Confirm or correct: whether Double Take is deployed anywhere; the real contract of POST /api/webhooks/double-take; percentToUnit()'s exact behaviour and whether it has a silent-failure mode; whether payloadShape.ts's differ generalizes to Double Take's shape; how unknown_cluster is actually consumed downstream today; and a concrete, testable mechanism for enforcing that no face crop or embedding from a real, unconsented individual survives past the shape-diff step. Also confirm sizing is appropriate for a bounded technical demo. Report back which assumptions are confirmed, which are wrong, blocking issues, and open decisions.
