# Cycle 7, Step 1 — Live Camera Validation: Context Handover

**Purpose of this doc:** hand this to Claude Code with a validate-first kickoff prompt (see bottom). It should inspect the real dairy-agent repo before implementing anything, confirm or correct the assumptions below, and report back blocking issues and open decisions — per our usual working pattern.

## Project context

- dairy-agent monorepo. Cycles 1–6 complete/in-progress; relevant here is **Cycle 4 (v0.7.0)**: the farm-events layer (`FARM_EVENTS.md`) — SQLite schema, real-shape Frigate/Double Take webhook ingestion, six-scenario synthetic generator, verification script.
- Known fidelity gap going into this slice: **the real Frigate/Double Take payload shapes were sourced from public docs and never checked against a live instance.** That's exactly what this slice exists to fix.
- Cycle 5 (v0.8.0) added the Farm Monitor Agent's deterministic classification core. Relevant constants: `WORK_HOURS` 04:00–20:00, `FARM_TZ` Asia/Karachi, `RESTRICTED_ZONES` currently just `{feed_store}` (provisional).

## Goal of this slice

Validate the documented Frigate/Double Take webhook payload shapes in `FARM_EVENTS.md` against a live instance, using a real WiFi camera (Yoosee A10) as the RTSP source. Output is a **deltas list** — confirmation the assumptions were right, or a concrete correction list.

**Scope note given camera placement:** the validation camera does not overlook any farm area. That's fine and deliberate for this slice — the goal is purely pipeline/schema mechanics (does a real payload match the documented shape, does it flow end-to-end into the existing endpoint), not farm-event semantic content. A view of passing traffic gives a steady, realistic stream of motion/person/vehicle detections to exercise the pipeline — it's just not a source of real farm data and shouldn't be treated as one.

## Explicitly out of scope for this slice

- Double Take / face clustering / identity enrollment — deferred, not needed to validate Frigate's payload shape alone.
- Camera watchdog / health monitoring.
- Any permanent decision on where the detection pipeline runs long-term (see "compute placement" below — this pass is throwaway/local).
- Validating farm-specific event *semantics* (restricted-zone logic, animal-related classification) — this camera doesn't view farm areas, so it can prove pipeline mechanics but not farm-specific correctness.
- **Sequencing note:** this slice starts before Cycle 6 (live-model tool-selection/narration testing) has wrapped. That's a deliberate, acknowledged choice — the two are independent — not default drift.

## What's been validated so far (real-world, outside the repo)

- Yoosee A10 WiFi camera: RTSP/NVR export enabled via the in-app toggle (Settings → NVR Connection → **Enable Connection**).
- Camera, laptop, and the Yoosee mobile app are confirmed on the same LAN/WiFi network.
- Camera's local IP and RTSP credentials obtained (held locally — not included in this doc, see security note below).
- RTSP stream successfully connected and played in VLC — **tested on an Android VLC client**, confirmed working.
- Camera placement confirmed as **outside any farm area**, which is what makes this a pipeline-mechanics test rather than a farm-semantics one. Deliberately not more specific: this repo is public, and enumerating which parts of a real property a camera does and does not cover is not something a schema-validation doc needs to record.

## Camera probe results (2026-08-26) — three open items closed

Probed directly from the laptop, before standing Frigate up. All three of the
previously-open camera items are now answered with evidence, and the probe turned
up one blocking defect nobody had anticipated.

**1. Laptop-side RTSP: CONFIRMED** (previously only the Android VLC test had
passed). A manual RTSP handshake from macOS gets `OPTIONS → 200 OK` advertising
`DESCRIBE, SETUP, TEARDOWN, PLAY, PAUSE`, and an authenticated `DESCRIBE → 200
OK` with a full SDP. Auth is **Digest**, realm `HIipCamera`; the credentials in
`.env` are correct as written.

**2. Stream path: RESOLVED — use `/onvif1`.** Both paths exist and authenticate.
Resolutions decoded from each stream's SPS:

| Path | Resolution | Codec | Audio |
| --- | --- | --- | --- |
| `/onvif1` (main) | **1280×720** | H.264 Baseline, level 3.1 | PCMA/16000 |
| `/onvif2` (sub) | 320×180 | H.264 Baseline, level 2.0 | none |

`/onvif2`'s 320×180 is too small for reliable person/car detection at street
distance, and 720p at 5 fps is comfortable for a CPU detector — so the main
stream is the right choice here, despite the sub-stream being the lighter option
in the abstract. Neither stream signals a framerate in its VUI, so `detect.fps`
is ours to set rather than something to match.

**3. Stability: the camera sleeps, and a capture window must expect it.** The
first probe round got **100% packet loss and port 554 closed**; minutes later,
with nothing changed, the same address answered ping cleanly with 554 open and a
valid ARP entry. This is a WiFi camera dropping off and coming back. The
"extended stability" item is therefore not merely unvalidated — intermittency is
**confirmed present**, which matters for a multi-hour window: expect gaps, and do
not read a quiet stretch in the capture as a pipeline failure.

### BLOCKING DEFECT — the camera's SDP misdeclares its codec

**The camera advertises `a=rtpmap:96 H265/90000` but actually sends H.264.**

The SDP supplies `sprop-parameter-sets`, which is H.264 SDP syntax (H.265 uses
`sprop-vps` / `sprop-sps` / `sprop-pps`). Decoding that parameter set settles it:

- First byte `0x67` → `nal_unit_type 7` = **H.264 SPS**. Read as H.265 the same
  byte is type 51, which is not a parameter set at all.
- `profile_idc 0x42` = 66 = **H.264 Baseline**.

Consequence: plain ffmpeg trusts `rtpmap`, sets up an HEVC depacketiser,
receives H.264, and dies with `Invalid data found when processing input`.
Reproduced against this camera on **every** transport — `tcp`, `udp`,
`udp_multicast`, `http`, and ffmpeg's default. Only `tcp` even got far enough to
report an RTSP-layer error (`Nonmatching transport in server reply`), so the
camera is fussy about transport on top of the codec mislabel.

**Fix applied to the config:** the camera is no longer an ffmpeg input directly.
It goes through a **go2rtc restream** (`go2rtc.streams` → camera; the camera's
ffmpeg input points at `rtsp://127.0.0.1:8554/test_street_cam`), because go2rtc
probes the actual bitstream instead of trusting the SDP. If go2rtc also chokes,
the documented fallback is to let it re-encode rather than copy
(`ffmpeg:rtsp://...#video=h264`), which costs CPU but sidesteps the mislabel
entirely. **CONFIRMED WORKING** against the live camera: Frigate 0.17.2 ran the
full window through this restream with no ffmpeg errors and detected real
`person` / `car` objects. The re-encode fallback was never needed.

### Two smaller corrections

- **`FRIGATE_CAM_HOST` carries its own `:554`.** The config template originally
  appended a hardcoded `:554`, which would have produced `host:554:554/onvif1`.
  The port is no longer hardcoded; ffmpeg defaults to 554 when none is given.
- **The RTSP password contains an `@`.** Correct Digest clients handle this, and
  the manual probe proves the credential works — but it makes the URL's userinfo
  ambiguous for naive parsers, so it is worth knowing if a future tool fails to
  authenticate where ffmpeg or go2rtc succeeds.
- Unrelated but noted: the camera also has **port 5000 open**. No conflict with
  the `5000:5000` mapping for Frigate's UI (that publishes on the host), but the
  coincidence is confusing while debugging.

## Validation findings (repo-evidence pass, 2026-08-26)

Validation-only pass against the repo at `a59225f`. No Frigate config, webhook
wiring, or integration code written. Each numbered item below answers the
corresponding codebase question from the original draft of this section.

### 1. Ingestion endpoint contract — CONFIRMED, with one gap the doc didn't ask about

| Property | Actual |
| --- | --- |
| Paths | `POST /api/webhooks/frigate`, `POST /api/webhooks/double-take` |
| Defined | [routes.ts:74-75](../server/src/farm/routes.ts#L74-L75) |
| Mounted | [index.ts:29](../server/src/index.ts#L29) — `app.use('/api/webhooks', farmRouter)` |
| Method | POST only. No GET/PUT handler exists. |
| Content-Type | `application/json` required — `express.json()` is the only body parser ([index.ts:21](../server/src/index.ts#L21)), and it is strict, so the top level must be an object or array. |
| Body limit | `2mb`, shared with the chat endpoint. |
| Responses | `201 {inserted, ids}` / `202 {inserted: 0, reason}` / `400 {error, ...detail}` — as FARM_EVENTS.md § Responses documents. |
| `is_synthetic` | From the `X-Synthetic-Source` header, present-and-non-empty → 1 ([routes.ts:43-44](../server/src/farm/routes.ts#L43-L44)). Real webhooks omit it → 0. |
| Not behind the seed guard | Deliberate — ingestion works against an unseeded DB ([index.ts:26-29](../server/src/index.ts#L26-L29)). |

**Gap:** there is **no auth, no signature, no shared secret, no allowlist** —
on these routes or anywhere in the server. `cors()` is applied with no options
([index.ts:20](../server/src/index.ts#L20)), so it is fully permissive. Frigate
needs no credentials to POST here, which makes the wiring trivial; the flip side
is that anything on the LAN can write to `farm_events` for the duration of the
test window. See open decision 3.

### 2. Strict vs. permissive — the doc's binary framing is wrong

It is **permissive about unknown/extra fields and strict about a small required
core.** Verified by direct probe of the pure normalizer, plus
[ingest.ts:129-186](../server/src/farm/ingest.ts#L129-L186).

Frigate's required core — anything missing is a `400`:

- `type` ∈ `{new, update, end}`
- `after` is an object
- `after.id`, `after.camera`, `after.label` — non-empty strings
- `after.start_time` — a finite number in `(0, 4e10]`

Everything else is ignored and the full body is preserved verbatim in
`raw_payload`. A payload with a dozen unrecognised top-level and nested fields
was accepted `201` in the probe. **So pointing a real Frigate at this endpoint
is safe from a rejection standpoint before any code change.**

**But there are two silent-acceptance modes, and one of them is likely the
single most important delta this slice will find:**

- **`confidence` silently becomes `NULL` if `after.score` / `after.top_score`
  are absent.** [ingest.ts:179](../server/src/farm/ingest.ts#L179) reads only
  `asNumber(after.top_score) ?? asNumber(after.score)`. Probed with a payload
  carrying `after.data.score` / `after.data.top_score` and no top-level
  equivalents: result was **`201`, `confidence: null`** — no error, no warning.
  Frigate has been moving these fields under `after.data`; whichever version
  gets pinned needs checking, because if it reports them nested, every captured
  row lands with a null confidence *and the current definition of done would
  still call that a pass.* See open decision 4.
- **`zone` silently becomes `NULL`** when `entered_zones` and `current_zones`
  are both absent or `[]` ([ingest.ts:167](../server/src/farm/ingest.ts#L167)).
  For this slice that is desirable (see item 5), but it means the entered/current
  zone-preference rule goes unexercised by this camera.

Hard-reject modes to expect from a real feed: `after.label` null or absent →
`400 missing_field` (probed); a payload carrying only `frame_time` and no
`start_time` → `400 missing_field` (probed).

### 3. Ingestion is decoupled from `scoreEvent` at WRITE, coupled at READ

**The doc's specific `RESTRICTED_ZONES` fear is unfounded. A different, larger
contamination problem is real.**

Decoupled at write, definitively:
[routes.ts](../server/src/farm/routes.ts) imports only `insertFarmEvents`;
`scoreEvent` has exactly one caller, `classifyEvent` in
[classifyStore.ts:37](../server/src/farm/classifyStore.ts#L37); and
`insertFarmEvent` deliberately leaves the classification columns at their DB
defaults ([db.ts:356-371](../server/src/db.ts#L356-L371)). Landing a payload
scores nothing.

But `classifyEvents` has a production caller:
[farmReads.ts:226-227](../server/src/tools/farmReads.ts#L226-L227), inside the
`summarize_daily_activity` tool. It classifies **every unclassified row in that
farm-local day, unfiltered by camera and unfiltered by `is_synthetic`** —
[`farmEventsInRange`](../server/src/db.ts#L443) has no predicate for either. So
the first time anyone asks the agent "anything unusual today" for a date this
camera has events on, street traffic gets scored.

What that actually costs, in order of severity:

- **`RESTRICTED_ZONES` cannot fire — by construction, provided no Frigate zones
  are configured.** Rule 1 requires `event.zone &&` truthy
  ([classify.ts:242](../server/src/farm/classify.ts#L242)). `zone = NULL` makes
  it unreachable. The `feed_store` scenario the doc worried about is a non-issue.
- Every street `detection` row lands `routine` via rule 4 — `detection` rows
  cannot reach rule 2 (`unknown_cluster` only) or rule 3 (`face_match` only).
  Harmless.
- **The real damage is to `cameraFindings` and to digest truncation.**
  [`cameraFindings`](../server/src/tools/farmReads.ts#L134) measures each
  camera's trailing silence *against the last event on ANY camera*. A street
  camera firing all day becomes the day's `lastOverall`, which inflates
  `silence_minutes` for every genuine farm camera and can flip them all to
  `silence_flagged`. Separately, `get_farm_events` truncates at
  `MAX_ROWS = 50` ([farmReads.ts:27](../server/src/tools/farmReads.ts#L27)) —
  a busy street camera will exceed that on its own and push real farm rows out
  of the digest entirely.

This is a stronger argument for keeping the capture out of the shared database
than the one the doc makes. See open decision 1.

### 4. The `verify:*` pattern cannot be extended — a new script is needed

Two independent reasons:

- **Wrong axis.** [verify.ts](../server/src/farm/verify.ts) and
  [verifyClassify.ts](../server/src/farm/verifyClassify.ts) diff *persisted
  rows* against *declared expectations* (`scenario.expect`,
  `CLASSIFY_EXPECTATIONS`). Neither inspects a payload. `raw_payload` is the
  only place a payload survives, and verify.ts touches it solely to confirm it
  parses ([verify.ts:203](../server/src/farm/verify.ts#L203)).
- **BLOCKING: both scripts call `resetFarmEvents()`, which is an unscoped
  `DELETE FROM farm_events`** ([db.ts:415-417](../server/src/db.ts#L415-L417)) —
  per scenario, and again on the way out
  ([verify.ts:339](../server/src/farm/verify.ts#L339)). Running `verify:farm` or
  `verify:classify` at any point during the capture window **destroys every
  captured real payload.** There is one database and no test-DB split:
  `DB_PATH` is a hardcoded const ([db.ts:17](../server/src/db.ts#L17)).

Reusable pieces that do exist: `stampTimestamps` is exported
([simulate.ts:55](../server/src/farm/simulate.ts#L55)), and synthetic payloads
are reachable as `SCENARIOS[name].events[i].payload`. Note the `frigate()` and
`doubleTake()` builders in scenarios.ts are **module-private**
([scenarios.ts:108](../server/src/farm/scenarios.ts#L108),
[scenarios.ts:157](../server/src/farm/scenarios.ts#L157)) — a diff script either
reaches through `SCENARIOS` or those get exported.

**Proposed new script** (sibling to verify.ts, same "local command, not
`*.test.ts`" convention): `farm/verifyPayloadShape.ts` behind a
`verify:payload` npm script. Read `raw_payload` for the test camera's rows,
flatten both real and synthetic payloads to leaf-path sets, and report
`only-in-real` / `only-in-synthetic` / `type-changed`. That produces the deltas
list this slice exists to deliver, mechanically. Roughly 120 lines.

### 5. A distinct `camera_id` — yes, and it costs no code change

- `camera_id` is `after.camera` verbatim
  ([ingest.ts:147](../server/src/farm/ingest.ts#L147),
  [ingest.ts:172](../server/src/farm/ingest.ts#L172)), which is the camera key
  in Frigate's own `config.yml`. Naming it distinctly separates it by
  construction.
- It must **not** collide with `gate_cam` / `barn_cam` / `yard_cam`
  ([scenarios.ts:40-44](../server/src/farm/scenarios.ts#L40-L44)). Worth
  stating plainly because the camera is *physically at the gate*, so `gate_cam`
  is both the tempting name and the wrong one.
- **Define zero zones in the Frigate config.** That yields `zone = NULL`, which
  structurally disables classification rule 1. Cleanest available guarantee.
- **Caveat the doc misses:** `is_synthetic` will be **0** on these rows, because
  real webhooks omit `X-Synthetic-Source`. So they are indistinguishable from
  genuine farm data by the one flag that exists for exactly this purpose, and
  `camera_id` becomes the *only* separator — one that no read path filters on.
  Do **not** send the synthetic header to paper over this: that would falsely
  assert the payload was generator-produced, and defeats the point of capturing
  a real shape.

### Doc assumptions confirmed

- Endpoint paths, methods, response codes, and header-driven `is_synthetic` — all
  as documented in FARM_EVENTS.md § Decision 4.
- **The documented payload shape matches the generator field-for-field.**
  Checked both ways. `scenarios.ts`'s `frigate()` builder emits the documented
  envelope plus `motionless_count` / `position_changes` / `box` / `area` /
  `region` / `attributes` / `current_attributes` (the doc says "fields elided",
  so this is consistent, not a discrepancy). `doubleTake()` matches the
  documented example exactly, including the 0–100 native confidence scale and
  the per-face `name` / `confidence` / `match` / `box` / `type` / `duration` /
  `detector` / `filename` / `base64` set. The ÷100 normalization is real
  ([ingest.ts:112-114](../server/src/farm/ingest.ts#L112-L114)). **This is a
  sound diff baseline.**
- Cycle 5 constants as stated: `WORK_HOURS` 04:00–20:00, `FARM_TZ`
  `Asia/Karachi`, `RESTRICTED_ZONES = {feed_store}` and flagged provisional
  ([classify.ts:69-72](../server/src/farm/classify.ts#L69-L72),
  [classify.ts:86](../server/src/farm/classify.ts#L86)).
- One minor note, not a correction: the generator always sets `entered_zones`
  and `current_zones` to the *same* single-element array
  ([scenarios.ts:139-146](../server/src/farm/scenarios.ts#L139-L146)), so the
  scenario library never exercises the divergence the normalizer's preference
  rule exists to handle. `ingest.test.ts:153` covers it, so it is tested — just
  not by the six scenarios.

## Corrections to the engineering next steps

- ~~Add a new `docker-compose` service for Frigate (not touching dairy-agent's own services)~~ →
  **dairy-agent has no docker services to avoid touching.** The only compose
  file in the repo is `docker-compose.langfuse.yml` (Langfuse observability
  infra); the app itself runs via npm/tsx. So Frigate is a standalone compose
  file, and on macOS Docker Desktop it must reach the host server as
  `http://host.docker.internal:4000` — **not** `localhost:4000`.
- ~~Point Frigate's webhook config at the existing ingestion endpoint~~ →
  **CONFIRMED WRONG, and it reshaped the slice.** Frigate publishes events over
  MQTT (`frigate/events`); it exposes no generic outbound HTTP webhook for
  events. Verified in practice on 0.17.2: the live capture read `frigate/events`
  off a broker, and 250 messages arrived there. Reaching
  `/api/webhooks/frigate` would require an MQTT-subscriber bridge that this plan
  never budgeted for — so **decision 5 narrowed the slice to MQTT only**, and the
  HTTP path is deferred to Cycle 7 step 2. Nothing in this repo consumed MQTT
  before this slice.
- Frigate-only, single-camera, motion/object detection, no Double Take —
  unchanged, and consistent with what the endpoint needs.
- Compute placement on the laptop for a defined test window — unchanged.

## Revalidation approach / definition of done — as executed

Two corrections to the plan as originally drafted, both consequences of
decision 5:

- ~~"Capture N real webhook payloads **as they reach the existing ingestion
  endpoint**"~~ → payloads were captured off **MQTT**, and never reached
  `/api/webhooks/frigate`. Frigate has no outbound HTTP event webhook, so
  reaching the endpoint needs a bridge that this slice deliberately excluded.
  The real normalizer was still exercised — `verify:payload` runs
  `normalizeFrigate` over every captured payload in memory — but the **HTTP
  transport and the SQLite insert were not.** That is what Cycle 7 step 2 is for.
- ~~"a few hours is likely enough"~~ → **18m47s was enough.** 250 messages, and
  every field except one appears in all 250, so the shape proved stable far
  faster than budgeted. The one-field exception is
  `after.snapshot.path_data`'s children (202/250).

**Success criterion — CORRECTED, then met 7/7.** The original criterion, "N
events ingested with zero parse errors," was **too weak to detect the most likely
failure.** An absent score field makes the endpoint return `201` while silently
writing `confidence = NULL`, so a run in which every row had a null confidence
would have passed that criterion while the data was wrong. The criterion asserts
on **values, not HTTP status**: non-null `confidence`, `occurred_at` inside the
window, non-empty `source_event_id`, plus the camera-id and NULL-zone separation
checks. Implemented as `dodChecks()` in `verifyPayloadShape.ts`.

As it happens the failure that criterion was written to catch **did not occur** —
0.17.2 sends the score fields where the doc says. The check stays as a regression
guard for a future release that moves them. Full results in
[§ DELIVERABLE](#deliverable--the-deltas-list-live-capture-2026-08-26).

## Decisions taken (2026-08-26)

All five open decisions below were resolved. Recorded here because the
implementation encodes them, and the reasoning is not recoverable from the code.

1. **The shared `farm_events` table is never written during this window.**
   Captures land in gitignored JSONL under `server/captures/`, and payloads are
   run through the real `normalizeFrigate` in memory. **JSON dump over a temp
   SQLite file** because it is strictly less invasive: `ingest.ts` is already
   pure, so a flat file needs no database dependency at all, whereas a temp
   SQLite file would have meant either importing `../db` (which opens
   `dairy.db` at module load — the exact thing being avoided) or adding a
   `DB_PATH` override to production code for a throwaway pass.
2. **Test camera name: `test_street_cam`**, asserted by `verify:payload`.
3. **No auth**, accepted for this window on a trusted home network. The stack is
   not to be left running afterwards — `mosquitto.conf` and the compose file
   both carry that note.
4. **Tightened success criterion adopted**, replacing "zero parse errors"
   entirely. Implemented as `dodChecks()` in `verifyPayloadShape.ts`.
5. **Scope narrowed to MQTT.** No HTTP webhook, no bridge. The capture
   subscribes to `frigate/events` directly, which is Frigate's actual internal
   event schema unreshaped by any bridge layer — a more direct test of payload
   fidelity than going through the endpoint. End-to-end HTTP wiring becomes its
   own follow-up slice once shape fidelity is confirmed.

## What was built

| File | Role |
| --- | --- |
| [`farm/payloadShape.ts`](../server/src/farm/payloadShape.ts) | PURE shape extraction + diff. No db, no fs, no network. |
| [`farm/payloadShape.test.ts`](../server/src/farm/payloadShape.test.ts) | 17 unit tests for the differ. Runs in `npm test -w server`. |
| [`farm/captureMqtt.ts`](../server/src/farm/captureMqtt.ts) | `capture:frigate` — subscribes to `frigate/events`, appends JSONL. |
| [`farm/verifyPayloadShape.ts`](../server/src/farm/verifyPayloadShape.ts) | `verify:payload` — diffs a capture against two baselines, normalizes, asserts the DoD. |
| [`farm/captureIsolation.test.ts`](../server/src/farm/captureIsolation.test.ts) | Guards decision 1 mechanically. |
| [`docker-compose.frigate.yml`](../docker-compose.frigate.yml) | Throwaway Frigate + Mosquitto stack, isolated compose project. |
| [`frigate/config.example.yml`](../frigate/config.example.yml) | Frigate config; `config.yml` is gitignored. |
| [`mosquitto/mosquitto.conf`](../mosquitto/mosquitto.conf) | Anonymous broker for the window. |

**Capture is deliberately dumb** — it records payloads verbatim and does not
normalize. Normalization happens in `verify:payload`, reading the file back.
That keeps the capture lossless and re-analysable: when the normalizer changes,
the analysis re-runs against the same capture instead of the camera having to be
stood back up. Same clone-and-diff-against-known-good discipline the rest of the
project uses, applied to a capture artifact.

**Two baselines, not one.** `verify:payload` diffs the capture against both the
JSON block parsed out of FARM_EVENTS.md *at runtime* (the normative claim) and
the synthetic generator's payload (what the code actually produces). Parsing the
doc rather than copying it into the script is deliberate — a hand-copied
duplicate could drift and quietly make the diff meaningless.

### A trap worth recording

`verifyPayloadShape.ts` cannot reuse `stampTimestamps` from
[`simulate.ts`](../server/src/farm/simulate.ts), even though that is the obvious
helper for it. `simulate.ts` imports `daysAgo` from `../seed`, and
[`seed.ts`](../server/src/seed.ts) imports `db` **on its first line** — so that
one import would open `dairy.db` transitively and break decision 1. The stamping
is reproduced inline instead; the duplication is the point, not an oversight.
`captureIsolation.test.ts` pins this statically, by reading the source rather
than by importing the modules (a test asserting "we never touch the shared
database" must not itself touch it).

## DELIVERABLE — the deltas list (live capture, 2026-08-26)

**Verdict: the Cycle 4 payload-shape assumption HOLDS. Zero breaking deltas.
The ingestion contract works against real Frigate 0.17.2 with no code change.**

Capture: `server/captures/live-window-1.jsonl` — 250 messages over 18m47s
(07:38:11Z–07:56:58Z), single camera `test_street_cam`, Frigate **0.17.2**.
0 unparsed, 0 non-event. By type: **21 `new`, 21 `end`, 208 `update`**.

Reproduce with:
`npm run verify:payload -w server -- --capture=server/captures/live-window-1.jsonl`

### Definition of done — 7/7 PASS

| Check | Result |
| --- | --- |
| rows created | 21 |
| every row has non-null `confidence` | **21/21** |
| every `confidence` inside 0..1 | 21/21 |
| every `occurred_at` inside the capture window | 21/21 |
| every row has a non-empty `source_event_id` | 21/21 |
| every row's `camera_id` is `test_street_cam` | 21/21 |
| `zone` is NULL on every row (rule 1 unreachable) | 21/21 |

`normalizeFrigate` **rejected nothing** — 21 created, 229 correctly skipped
(`update`×208, `end`×21). No 400s against real traffic.

### Deltas vs FARM_EVENTS.md

**`only_in_documented`: NONE.** Every field the doc documents — and critically
every field `ingest.ts` reads — is present in the real payload. This is the
result that matters, and it **falsifies the prediction carried into this slice**
(see the correction below).

`type_changed` (3), all explained, none breaking:

| Path | Documented | Real | Why |
| --- | --- | --- | --- |
| `after.entered_zones` | `array` | `empty-array` | No zones configured — deliberate, decision 5. Rule 1 stays unreachable. |
| `after.current_zones` | `array` | `empty-array` | Same. |
| `after.end_time` | `null` | `null \| number` | Doc only showed a `new` event. `end` events carry a number. Not read by `ingest.ts`. |

`only_in_real` (41): Frigate 0.17.2 sends substantially more than Cycle 4
recorded. Ingestion is permissive about unknown fields and preserves the whole
body in `raw_payload`, so **none of these break anything** — but they are how the
documented shape gets brought up to date. Against baseline B (the synthetic
generator) the count is 32 rather than 41, because the generator already emits
the `box` / `area` / `region` / `attributes` fields the doc elides.

The complete list, with observed type and presence across the 250 payloads:

| Path | Type | Presence |
| --- | --- | --- |
| `after.snapshot` | `object` | 250/250 |
| `after.snapshot.frame_time` | `number` | 250/250 |
| `after.snapshot.box` / `.box[]` | `array` / `number` | 250/250 |
| `after.snapshot.area` | `number` | 250/250 |
| `after.snapshot.region` / `.region[]` | `array` / `number` | 250/250 |
| `after.snapshot.score` | `number` | 250/250 |
| `after.snapshot.attributes` | `empty-array` | 250/250 |
| `after.snapshot.current_estimated_speed` | `number` | 250/250 |
| `after.snapshot.velocity_angle` | `number` | 250/250 |
| `after.snapshot.path_data` | `array \| empty-array` | 250/250 |
| `after.snapshot.path_data[]` / `[][]` / `[][][]` | `array` / `number` / `number` | **202/250** |
| `after.snapshot.recognized_license_plate` | `null` | 250/250 |
| `after.snapshot.recognized_license_plate_score` | `null` | 250/250 |
| `after.score_history` / `[]` | `array` / `number` | 250/250 |
| `after.path_data` / `[]` / `[][]` / `[][][]` | `array` / `array` / `number` / `number` | 250/250 |
| `after.average_estimated_speed` | `number` | 250/250 |
| `after.current_estimated_speed` | `number` | 250/250 |
| `after.velocity_angle` | `number` | 250/250 |
| `after.recognized_license_plate` | `null` | 250/250 |
| `after.max_severity` | `string` | 250/250 |
| `after.pending_loitering` | `boolean` | 250/250 |
| `after.active` | `boolean` | 250/250 |
| `after.frame_time` | `number` | 250/250 |
| `after.ratio` | `number` | 250/250 |
| `after.area` | `number` | 250/250 |
| `after.box` / `.box[]` | `array` / `number` | 250/250 |
| `after.region` / `.region[]` | `array` / `number` | 250/250 |
| `after.motionless_count` | `number` | 250/250 |
| `after.position_changes` | `number` | 250/250 |
| `after.attributes` | `empty-object` | 250/250 |
| `after.current_attributes` | `empty-array` | 250/250 |

Two things worth pulling out of that table:

- **`after.snapshot.path_data`'s children are the only genuinely optional field
  in the set** (202/250). Everything else is present in every single payload, so
  the shape is stable rather than sporadic — which is what makes a 250-message
  window sufficient.
- **`after.snapshot` is metadata, not an image.** It carries the snapshot's box,
  region, score and path — no pixels. Verified across the whole capture: zero
  non-printable bytes, no string longer than 200 characters, largest whole record
  4,574 bytes. The image itself never enters the payload; `snapshot_ref` is a
  synthesized URL (`/api/events/<id>/snapshot.jpg`) pointing back at Frigate.

**This list has been folded into
[FARM_EVENTS.md](FARM_EVENTS.md) § *Frigate — measured against a live
instance*,** which is the durable home for it — this document is the record of
one slice, that one is the living schema reference.

### CORRECTION to the prediction carried into this slice

Finding 2 of the repo-evidence pass predicted that `after.score` /
`after.top_score` would have moved under `after.data`, yielding a silent
`confidence = NULL`. **That is wrong for Frigate 0.17.2.** Measured directly:
`after.score` and `after.top_score` are present at the top level and
**`after.data` is absent entirely**. Confidence lands non-null on all 21 rows.

The probe that produced the prediction was sound — an absent score really *does*
silently yield `201` + NULL confidence, and the tightened DoD really is needed to
catch it — but the premise that this Frigate version omits those fields did not
hold. Worth keeping the DoD check regardless: it is now a regression guard for a
future Frigate release that does move them.

### One real finding a shape diff alone would have missed

**`top_score` does not mean "best over event lifetime" on the events we
persist.** FARM_EVENTS.md documents it that way, and `ingest.ts` prefers it
(`after.top_score ?? after.score`) on that basis.

Measured across the 250 captured payloads, `top_score > score` 141 times and
`< score` 93 times — so in aggregate it broadly behaves as documented. But
restricted to **`new` events, the only type that is ever persisted, `top_score`
is lower than `score` in 18 of 21 cases** — on an event where the object has just
appeared and the two ought to be equal. Consequence: **20 of the 21 stored rows
carry a `confidence` lower than the best score present in their own payload, by
an average of 0.050** on the 0..1 scale.

It matches neither `max(score_history)` nor `median(score_history)`, so its
actual derivation is undetermined and not worth guessing from 21 events. What is
established is that the documented rationale for preferring `top_score` does not
hold for `new` events.

Not urgent — a 0.05 shortfall changes no Cycle 5 verdict, because
`CONFIDENCE.MATCH_CONFIDENT` is gated to `face_match` and never applies to a
`detection` row. But it is wrong in a way that will matter if a future rule ever
thresholds on detection confidence, and the fix is a one-line change of
preference order plus a doc correction. **Deferred to its own slice** rather than
bundled here: this pass was scoped to shape fidelity, and changing what
`confidence` means is a semantic change with its own blast radius.

**Tracked as [cycle-7-followups.md](cycle-7-followups.md) § FU-1**, which carries
the full measurement, the ruled-out hypotheses, the shape of the fix, and the
dataset reference so none of it has to be re-derived.

## Verification status

**The harness is built and proven, and the live capture has now run.**

Proven, mechanically:

- `npm test -w server` — **71/71 pass**, and the suite leaves `dairy.db`'s mtime
  byte-identical.
- `npm run typecheck` — clean.
- **Differ correctness in both directions.** Against a fixture matching
  FARM_EVENTS.md exactly: *"zero deltas — the documented shape matches the real
  payload."* Against a fixture shaped like a modern Frigate (score under
  `after.data`): it reports `after.score` and `after.top_score` as
  `only_in_documented` and fails the DoD with `0/3 — 3 NULL`. An instrument that
  under-reported would let a real mismatch through as a clean pass, so both
  directions are pinned.
- **End-to-end MQTT path**, against a real Mosquitto container: 5 published
  messages (including a deliberately non-JSON one) → captured → normalized →
  deltas + DoD verdict. The non-JSON message was recorded as `unparsed` rather
  than dropped.
- **Decision 1 holds**: neither capture module loads `db.ts`, `seed.ts`, nor
  `better-sqlite3` (asserted via the require cache), and `dairy.db` was
  untouched across every run.
- Compose file validates; the missing-credential guard fails with a named error;
  the stack runs under its own compose project so `down -v` cannot reach the
  Langfuse containers (it shared the `dairy-agent` project name before this was
  fixed, which would have reported them as orphans).

Also proven against the live camera:

- **Frigate 0.17.2 ran against the A10 for a real window** and published to MQTT;
  `capture:frigate` recorded 250 events; `verify:payload` produced the deltas list
  above and exited 0.
- **`dairy.db` mtime was byte-identical before and after the entire live run.**
  Decision 1 held in practice, not just in the unit test.
- The go2rtc restream workaround for the codec mislabel **works** — Frigate logged
  no ffmpeg errors and detected real street traffic (`person`, `car`).

Four defects were found and fixed while standing this up, all in my own config
rather than in the repo's existing code:

1. **`FRIGATE_CAM_HOST` carries its own `:554`**, so the template's hardcoded
   `:554` produced `host:554:554/onvif1`. Port no longer hardcoded.
2. **`version: 0.14` unquoted is a YAML float.** Frigate rejected it with "Input
   should be a valid string" and silently started in **safe mode** — no cameras,
   no MQTT, no events. Now `version: "0.17"`. Worth knowing because safe mode
   looks like a healthy startup unless you grep for it.
3. **The config was mounted `:ro`**, so Frigate could not migrate it in place
   and logged "Config file is read-only". Now read-write.
4. **The compose project shared the `dairy-agent` name with the Langfuse stack**,
   which reported the Langfuse containers as orphans and put them one stray
   `--remove-orphans` away from deletion. Now its own project, `frigate-capture`,
   asserted by [`captureStack.test.ts`](../server/src/farm/captureStack.test.ts)
   — see § *Compose project isolation* below for why a comment alone was not
   enough.

### Compose project isolation — what actually happened

Investigated after the collision appeared to recur. **It did not recur.** The
`name: frigate-capture` fix stayed in place and kept working; the second event
was a different failure with the same symptom, and the distinction matters
because the guard needed is different.

Evidence: `name: frigate-capture` appears exactly once,
unindented and uncommented, and never changed after being added. No
`COMPOSE_PROJECT_NAME` exists in `.env` or `.env.example`. `docker compose -f
docker-compose.frigate.yml config` resolves `name: frigate-capture` while the
Langfuse file resolves `name: dairy-agent` — distinct, as intended. The final
teardown removed `frigate-capture_*` volumes and left Langfuse running.

What the second event actually was: during cleanup I ran
`docker compose -p dairy-agent -f docker-compose.frigate.yml down` **on purpose**,
to reap the containers created *before* the fix existed — those genuinely lived
in the `dairy-agent` project. But `-p` outranks the file's `name:`, so that
command pointed this stack's teardown at Langfuse's project and tried to remove
its `dairy-agent_default` network. It failed only because the network was still
in use. Self-inflicted, and a near-miss rather than a recurrence.

So the real hazard is not drift — it is **precedence**. Compose resolves the
project name highest-first:

| Level | Source | Covered by the guard? |
| --- | --- | --- |
| 1 | `-p` / `--project-name` flag | **No — untestable.** Loud comment at the top of the compose file. |
| 2 | `COMPOSE_PROJECT_NAME` env var | Yes — asserted absent from `.env` and `.env.example`. |
| 3 | the file's `name:` | Yes — asserted present, and not equal to the directory name. |
| 4 | directory name | Yes — asserted no two compose files collide, modelling this fallback. |

Level 2 is worth guarding even though nothing sets it today: the capture runbook
sources `.env` into the shell before running compose, so one line in `.env` would
silently undo the isolation with nothing visible at the call site.

The guard was verified by negative control — commenting out `name:` makes two of
its three assertions fail, so it is not vacuous.

Environment notes, for whoever runs this next:

- **`ghcr.io` did not resolve from Docker's VM** while resolving fine from the
  host, and the Frigate image is 4.57 GB — the pull took a long time and needed
  retries. Budget for it; it is not a config error.
- Frigate is **not** on Docker Hub. An older `0.12`-era image would be worse than
  none for this purpose: it predates the `data.score` reshuffle, so it would
  produce a deltas list that describes a version nobody is going to run.

### To run the capture

```bash
# 1. Put the camera's LAN address + RTSP credentials in .env (see .env.example)
# 2. Local Frigate config from the committed example
cp frigate/config.example.yml frigate/config.yml
# 3. Bring up Frigate + the broker
docker compose -f docker-compose.frigate.yml up -d
#    Confirm the feed decodes at http://localhost:5000 before spending a window.
# 4. Capture a defined window
npm run capture:frigate -w server -- --minutes=120
# 5. Produce the deltas list
npm run verify:payload -w server -- --capture=server/captures/frigate-events-<stamp>.jsonl
# 6. Tear the stack down — it must not outlive the window (decision 3)
docker compose -f docker-compose.frigate.yml down -v
```

A short `--minutes=5 --max=20` run first is worth it: it confirms Frigate is
publishing on the expected topic before committing to a multi-hour window. For
topic discovery if nothing arrives, `--topic='frigate/#'`.

## Open decisions — resolved, retained for context

1. **Which database does the capture write to?** *(blocking — decide before
   capture starts)*. Finding 4 means any `verify:farm` / `verify:classify` run
   wipes the capture, and finding 3 means a busy street camera degrades
   `summarize_daily_activity` for real farm cameras on the same dates. Options:
   **(a)** accept both risks and simply don't run the verify scripts during the
   window; **(b)** add a `DAIRY_DB_PATH` env override — doesn't exist today,
   `DB_PATH` is a hardcoded const, so this is a small code change; **(c)** tee
   payloads to a file before they reach the DB and never persist them.
   **Recommendation: (c), falling back to (b).** (c) keeps the shared dev
   database completely untouched and still delivers the deltas list, which is
   the actual deliverable — persistence is incidental to it.
2. **Test camera name.** Suggest `test_street_cam`. Needs confirming because
   per finding 5 it becomes the *only* thing separating this data from real farm
   events, and it must not be `gate_cam`.
3. **Is unauthenticated LAN write access to `farm_events` acceptable for the
   test window?** Per finding 1 there is no auth of any kind. Frigate → host is
   fine; so is anything else on the WiFi.
4. **Confirm the tightened success criterion** in the section above — it changes
   what "done" means for this slice.
5. **Frigate → HTTP transport.** Per the corrections section: if Frigate has no
   generic HTTP event webhook, does the MQTT bridge come into scope for this
   slice, or does the slice narrow to "capture payloads off MQTT and diff them"
   without going through the endpoint at all? The second is cheaper and still
   answers the schema-fidelity question; it just doesn't prove the end-to-end
   flow.

## Security note

RTSP credentials and the camera's local IP are local-network secrets. Keep them out of committed config, docs, or this doc's future revisions — pass via env var or a local-only, gitignored config file.

Note that `.gitignore` already covers `.env` and `*.db`, so an env-var approach
is safe by default; a Frigate `config.yml` is **not** covered and would need an
explicit ignore entry or a `config.local.yml` substitution.

## Kickoff prompt for Claude Code — ✅ done

The validate-first pass this prompt asked for is complete; its results are in
[§ Validation findings](#validation-findings-repo-evidence-pass-2026-08-26)
above. All five open decisions were then resolved, the harness was built, and the
live capture ran — see [§ DELIVERABLE](#deliverable--the-deltas-list-live-capture-2026-08-26).
**This slice is closed;** what it deliberately left undone is tracked in
[cycle-7-followups.md](cycle-7-followups.md).

> Before implementing anything, inspect the real dairy-agent repo and validate the assumptions in this handover doc against it. Specifically: confirm the exact contract (path, method, auth, strict vs. permissive schema validation) of the Cycle 4 farm-events webhook ingestion endpoint, and confirm the current documented payload shape in FARM_EVENTS.md and the synthetic generator. Report back any blocking issues, incorrect assumptions in this doc, and open decisions — before writing the Frigate config or any integration code.
