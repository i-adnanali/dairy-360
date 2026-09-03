# Animal Registry — Decision Document: Build Steps 1 & 2

**Repo:** `dairy-agent` · **Precedes:** implementation cycle for the registry layer
**Scope:** Animals, parentage, status projection (step 1); lactations and calvings, backfilled (step 2)
**Status:** Written without repo access. Validate before implementing — see §14.

---

## 1. What this cycle builds

A registry layer that holds **real animals from the real farm**, structured as an append-only event log with rebuildable projections over it.

In scope:

- `animals` table and permanent serial allocation
- `animal_events` append-only log with date-precision and provenance on every row
- `lactations`, `parentage`, `animal_status` as **projections** — stored, but derived and rebuildable
- The atomic calving transaction
- Backfill of the known herd and known calving history
- A rebuild command and a verification script
- Calving-interval derivation, with measured and approximate intervals reported separately

Out of scope for this cycle, deliberately: yield capture, breeding/heat events, null-observation records, sheet transcription, vision, agent tools over the registry, auth, multi-user, hosting, the pedigree tree view, and the two visualisations. Each is addressed in §13 with the reason.

---

## 2. Resolved: synthetic and real data coexistence (open question 1)

**Decision: one schema, two databases, selected at boot by an environment variable. Not a row-level flag.**

```
DAIRY_DATASET=real       -> data/dairy.real.db
DAIRY_DATASET=synthetic  -> data/dairy.synthetic.db   (default)
```

Both files run the identical migration set. A `dataset_meta` table holds exactly one row naming the dataset; on boot the app asserts that row matches `DAIRY_DATASET` and **hard-fails on mismatch**, so a misconfigured process cannot write real animals into the synthetic file or vice versa. Every CLI command prints the resolved dataset name as a banner before doing anything.

### Why not a row-level flag

A `is_synthetic` column on every table is the soft-delete failure mode: correctness depends on every query in the codebase remembering to filter, forever, including queries written a year from now by a tired person. The failure is silent — you get a number that is 120 animals instead of 20 and nothing errors. `get_farm_events`, `scoreEvent`, `summarize_daily_activity` and the whole 12-scenario regression suite would all have to grow a filter they currently don't have, and each is a place to forget it.

File-level separation makes the mistake structurally impossible instead of merely discouraged. There is no legitimate query that spans both datasets, so the thing you lose by separating them is not a thing you want.

### Why not delete the synthetic set

The 100 synthetic buffaloes are load-bearing: they feed the six-scenario generator, the Farm Monitor classification path, and the regression suite that has run 12/12 twice. Deleting them trades a working test corpus for nothing.

### Migration of what exists today

Everything currently in the database is synthetic. So: rename the existing DB file to `dairy.synthetic.db`, stamp it `dataset = 'synthetic'`, and create `dairy.real.db` empty. This is the honest cut — it does not reclassify anything, it just names what is already true.

Later, the synthetic dataset can grow its own registry by having the generator emit a synthetic herd through the **same** schema and the same write path. That keeps the registry code exercised at 100-animal scale without any of it touching real records.

**Consequence to accept:** two DB files means migrations must be applied to both. Make that automatic at boot rather than a manual step, or the files drift and the drift is discovered by a confusing test failure.

---

## 3. Resolved: relationship to `farm_events` (open question 2)

**Decision: two tables. `farm_events` is not modified. Animal-life events go in a new `animal_events` table.**

The two producers differ on every axis that a schema cares about:

| | `farm_events` (camera) | `animal_events` (life) |
|---|---|---|
| Volume | thousands/day | ~10/week |
| Subject | camera + zone, identity is a guess | a known animal, always |
| Time | exact machine instant | fuzzy local date, often no time |
| Recording lag | milliseconds | days to weeks, and it matters |
| Payload | vendor-shaped blob | closed, tightly typed taxonomy |
| Provenance | the webhook | a named person and a named paper sheet |
| Read pattern | recent window, all animals | one animal, whole lifetime |

Merging them behind a discriminator would force `date_precision`, `observed_by`, `source_form` and `supersedes_id` onto camera rows where they are permanently null and meaningless, and would put a table that gets thousands of inserts a day in the hot path of a table that needs to stay small, readable and hand-auditable. It would also drag `get_farm_events` and the classification path into a schema change they get no benefit from — the exact kind of coupling that makes the next cycle slower.

**Where they do meet: at read time, not in storage.** The ground-truth question ("did the camera see restlessness on the night we recorded a first sign?") is a join across two sources over a time window. Build that later as a read model — a `getAnimalTimeline(animalId, from, to)` function that merges both into one display shape — and, when it is time to record an actual asserted correspondence, a thin `event_links(animal_event_id, farm_event_id, relation, confidence)` table.

Nothing in this cycle's schema blocks that. Explicitly **do not** build `event_links` now: there are no camera-identified real animals yet, so it would have zero rows and would be designed against imagination.

---

## 4. The architectural rule that governs everything below

The handover states the core decision: the animal record is a projection over an event stream, not a row with mutable columns. Taken literally that would mean computing lactations on every read, which is unpleasant and makes foreign keys impossible.

**The rule this document adopts instead:**

> `animal_events` is the sole source of truth. `lactations`, `parentage`, `animal_status`, and the projection columns on `animals` are stored derived state. Any stored derived state must be reproducible from the event log by `registry:rebuild`, and `verify:registry` must prove that a rebuild produces output identical to what is stored.

This keeps the benefits — corrections are new events, derived state cannot contradict history, transcription is a mapping not a reconciliation — while allowing ordinary indexed queries and foreign keys. It also converts "is the projection logic correct?" from a code-review question into a script that either passes or fails.

Two consequences to enforce:

- **No code path other than the projection rebuild may write to a projection table.** Enforce by module boundary: projections are written only by `rebuild.ts`; the calving transaction calls the rebuild for the affected animals rather than hand-patching rows.
- **Projection tables can be dropped and recreated at any time without data loss.** If that ever stops being true, something has been stored that isn't derived, and it belongs in an event.

Follow the Cycle 5 structural precedent: pure functions in `registry/project.ts` (event list in, projection objects out, no DB), DB shell in `registry/projectStore.ts`. Same split as `classify.ts` / `classifyStore.ts`. This is also what makes agent tools cheap to add later (§13).

---

## 5. Identifiers

### Animal serial (open question 5)

**Format: `BD-0001`** — fixed prefix, hyphen, zero-padded 4-digit sequence.

- Permanent. Never reused, including after a mistaken entry — a wrong animal is voided by a superseding event, not deleted.
- Not derived from post position, ear tag, name, or species. Those all change; the serial does not.
- Allocated from a counter row inside the same transaction as the insert, so a rolled-back calving does not burn a number. Gaps are acceptable and expected; reuse is not.
- 4 digits is 9,999 animals, roughly five centuries at this farm's rate. If it ever overflows, widen the padding — the format is left-padded so sort order survives.
- Human-speakable on a phone call, which matters because the keeper will read it aloud.

Post number and ear tag, where they exist, are **attributes on the animal, not identity**. If the repo needs them now, add `post_no` and `tag_no` as nullable columns; both are expected to change over an animal's life.

### Event id

ULID (or UUIDv7) as TEXT. Sortable by creation, no coordination needed, and it gives lactation ids stability — see below.

### Lactation id

**`L-<calving_event_id>`.** Not `<animal>-L<n>`.

This matters more than it looks. If lactation ids encode a sequence number, then discovering an earlier calving during backfill — which will happen — renumbers every later lactation for that animal, and any yield row (step 4) pointing at `BD-0042-L3` now points at the wrong lactation, silently. Deriving the id from the immutable calving event means the id is stable under rebuild and under new historical discoveries. The display sequence number ("3rd lactation") is computed at read time, where being wrong is visible and harmless.

---

## 6. Time, precision, and provenance

### Three distinct times, three columns

- `occurred_on` — the farm-local calendar date the thing happened. `YYYY-MM-DD` TEXT.
- `occurred_time` — the farm-local clock time, `HH:MM`, **nullable**. Present when known (a first-sign time from the heat-watch grid), null when not (a calving remembered as "sometime around March").
- `recorded_at` — the exact UTC instant the row was written. Always exact, always present.

Do not collapse `occurred_on` + `occurred_time` into a single timestamp column with a qualifier. A timestamp column forces you to invent an hour for a date you only know to the month, and the invented hour then reads as real to everything downstream. Nullable time makes "unknown" the actual stored value.

Storing farm-local dates rather than UTC instants is safe here and should be stated in a comment so nobody "fixes" it: `FARM_TZ` is `Asia/Karachi`, Pakistan does not observe DST, and the offset has been fixed for the entire period any record covers. Local date ordering is therefore total and unambiguous. Every operational fact on the farm — the 05:00/12:00/17:00/22:00 rounds, AM/PM milking, the daily sheet — is expressed in local days. Converting to UTC would put the 22:00 round on the previous day and make every sheet reconciliation a puzzle.

### `date_precision`

`day` | `month` | `year` | `estimated`

- `day` — the date is known. (This replaces the handover's `exact`; "exact" invites confusion with clock time, which is now a separate field.)
- `month` — the month is known, the day is not. Store `occurred_on` as the **first day of that month**.
- `year` — the year is known. Store as **January 1** of that year.
- `estimated` — even the year is inferred, e.g. an age judged by dentition on a bought animal.

Constraints to enforce in the schema:

- `date_precision` is `NOT NULL`, with **no default**. Every write must state it. A default is how `day` gets applied to a guess.
- `occurred_time` must be `NULL` unless `date_precision = 'day'`. There is no such thing as knowing the hour but not the day.
- The stored-date conventions above are a documented invariant, checked by `verify:registry`, because a `month`-precision row dated the 14th means someone silently downgraded a known date.

Surface precision in the UI wherever a date is shown — "March 2024 (month)" or "~2021 (estimated)", never a bare date. The handover is right that hiding it manufactures confidence.

### Provenance

Four columns on every event:

- `source_form` — `daily_herd_sheet` | `cycle_card` | `direct_entry` | `import` | `recall`
- `source_ref` — which sheet or card: the sheet's date, the card's animal + lactation, a page number
- `observed_by` — who saw it (nullable: nobody observed a purchase record)
- `recorded_by` — who typed it (NOT NULL)

`recall` is a first-class source value, not a fallback. Most of the step-2 backfill will be `recall` — a calving history reconstructed from memory. Recording that honestly is the entire point; if `recall` rows are indistinguishable from `daily_herd_sheet` rows, the first calving-interval number is unfalsifiable. Expect and require that the backfill is mostly `source_form = 'recall'`, `date_precision = 'month'` or worse.

### Corrections

`supersedes_id`, nullable, self-referencing. A correction is a **new event** carrying the corrected values and pointing at the event it replaces. Projections ignore any event that is superseded. A unique partial index on `supersedes_id` prevents two events claiming to replace the same one, which would make the chain ambiguous.

Nothing is ever `UPDATE`d in `animal_events` and nothing is ever `DELETE`d. Enforce with a check in the verification script and, if the driver supports it cheaply, a trigger.

---

## 7. Event taxonomy for this cycle (open question 6)

**Live in this cycle** — six types, tightly typed payloads validated at the write boundary (Zod, if the repo already uses it):

| Type | Subject | Payload |
|---|---|---|
| `birth` | the calf | `{ dam_id, sire_ref?, calving_event_id, sex, outcome }` |
| `acquired` | the animal | `{ from?, estimated_birth_on?, estimated_birth_precision?, notes? }` |
| `calving` | the dam | `{ calf_id, calf_sex, outcome: 'live' \| 'stillborn' \| 'died_within_24h', assistance?: 'none' \| 'assisted' \| 'vet', notes? }` |
| `dry_off` | the dam | `{ reason?: 'scheduled' \| 'low_yield' \| 'health' \| 'other', notes? }` |
| `departure` | the animal | `{ reason: 'sold' \| 'died' \| 'culled' \| 'lost', to?, cause?, notes? }` |
| `note` | any animal | `{ text }` |

**Reserved, not implemented** — named here so the taxonomy is designed once rather than accreted: `heat_observed`, `insemination`, `pregnancy_check`, `abortion`, `treatment`, `vet_visit`, `null_observation`, `milking`, `weight`, `body_condition`.

Implementation guidance: one TypeScript discriminated union on `type`, one schema per variant, one `assertEventPayload(type, payload)` at the write boundary. Store the payload as JSON TEXT — SQLite JSON1 is enough for the query volume here, and a column-per-type schema would be rewritten twice before step 5. Reserved types must be rejected by the write boundary, not silently accepted with a loose payload.

**Origin invariant:** every animal has exactly one origin event, either `birth` or `acquired`, and no other event may be dated before it (modulo precision). This is what makes the timeline start somewhere real.

---

## 8. The calving transaction

One function, one SQLite transaction (`BEGIN IMMEDIATE`), all-or-nothing. This is the single most important piece of code in the cycle, because the failure mode it prevents — orphaned calves and a pedigree graph full of disconnected nodes — is only discovered much later and cannot be repaired from the data.

`recordCalving(input)` where input is:

```
{
  dam_id, occurred_on, occurred_time?, date_precision,
  calf: { sex, name?, outcome },
  sire_ref?,
  provenance: { source_form, source_ref?, observed_by?, recorded_by }
}
```

Steps, in order, inside one transaction:

1. **Validate.** Dam exists, is female, has no `departure` event dated on or before `occurred_on`, and has no existing `calving` event within a plausibility window of this date (guard against double entry during backfill — warn, require an explicit override flag, do not silently accept).
2. **Allocate** the next serial from the counter row.
3. **Insert** the calf's `animals` row with `origin = 'born_on_farm'`.
4. **Insert** the `calving` event on the dam.
5. **Insert** the `birth` event on the calf, same date and same precision as the calving. These two are the same physical fact seen from two animals; if their dates can diverge, the timeline lies.
6. **Rebuild** projections for the dam and the calf: lactations, parentage edges, statuses.

If `outcome` is `stillborn` or `died_within_24h`, steps 2–3 and 5 still happen and a `departure` event with reason `died` is written on the calf. A stillbirth still opens a lactation and still counts toward parity and calving interval, so the calf must exist as a node. Suppressing it would corrupt the metric this whole cycle exists to produce.

### Closing the previous lactation

If the dam has an open lactation when a calving is recorded, close it. Two cases:

- A `dry_off` event exists → the lactation ended there. Normal path.
- No `dry_off` event exists → close the lactation at the calving date with `end_reason = 'inferred_at_next_calving'`.

Do **not** reject the calving in the second case. Backfilled history frequently has calving dates and no dry-off dates, and rejecting would force the operator to invent a dry-off date — inventing precision to satisfy a constraint. The `inferred_at_next_calving` marker records that the boundary is a derivation, not an observation, and it is available to anything that later cares about dry-period length.

---

## 9. Status projection rules

Evaluated in order; first match wins.

1. `departed` — a `departure` event exists. Terminal.
2. `calf` — birth date known and age < 12 months.
3. `milking` — parity ≥ 1 and an open lactation exists.
4. `dry` — parity ≥ 1 and no open lactation.
5. `heifer` — female, parity 0.
6. `male` — male, parity 0.

Where `parity` = count of non-superseded `calving` events.

Notes:

- If the birth date is unknown, rule 2 cannot fire and the animal falls to `heifer`/`male`. Document this; the fix is to enter an estimated birth date, which the precision qualifier makes safe to do.
- The 12-month calf threshold is policy, not biology. Put it in the same constants module as `FARM_TZ`, `WORK_HOURS`, and `RESTRICTED_ZONES` — the repo already has the convention, and this is the second time a provisional threshold has needed a home.
- `bred`, `pregnant`, and `confirmed_pregnant` are deliberately absent. They require breeding events, which are step 5. Adding them now would mean writing derivation rules against an event type that does not exist.

---

## 10. Rebuild and verification

Two commands, following the existing `verify:classify` precedent.

**`npm run registry:rebuild [--animal=BD-0001]`** — recomputes all projection tables from `animal_events`. Idempotent. Safe to run at any time.

**`npm run verify:registry`** — snapshots the projection tables, rebuilds into a temporary database, diffs, and additionally asserts these invariants:

1. Projection rebuild is byte-identical to stored projections.
2. Lactation ids are unchanged across rebuild.
3. Every animal has exactly one origin event (`birth` or `acquired`).
4. No event (other than `note`) is dated before its animal's origin event, allowing for precision.
5. No event (other than `note`) is dated after a `departure` event.
6. Every `calving` names a `calf_id` that exists, has `origin = 'born_on_farm'`, and has a `birth` event with the same date and precision.
7. Every `born_on_farm` animal has a `dam` parentage edge.
8. No animal has two open lactations.
9. No superseded event contributes to any projection.
10. No duplicate serials; counter ≥ max issued serial.
11. `date_precision = 'month'` rows are dated to the 1st; `'year'` rows to Jan 1.
12. `occurred_time` is null wherever `date_precision != 'day'`.
13. `dataset_meta.dataset` matches `DAIRY_DATASET`.

Per the established verification methodology: clone and diff against the prior known-good tag, do not trust the commit messages or the report.

---

## 11. Backfill policy

Steps 1 and 2 can be populated with real data immediately — the animals, rough ages, and approximate calving histories are already known. That is the point of doing these two steps first, and it removes synthetic data from a meaningful part of the system without waiting for paper to accumulate.

Rules for the backfill, which exist because of the handover's caution and should be treated as blocking:

- **Precision is never defaulted.** The backfill CLI/CSV requires an explicit precision value per date. A missing precision is an error, not a `day`.
- **`source_form = 'recall'`** for anything reconstructed from memory. `recorded_by` is the person who remembered it. `observed_by` is null unless they actually saw it.
- **Do not enter a date you do not have.** Use `year` or `estimated`. An animal with a birth date of `estimated 2021` is more useful than one with a confident fabricated `2021-04-12`, because only the first can be corrected without anyone having to first discover it was wrong.
- **Backfill in two passes.** Pass one: all animals with origin events and no parentage. Pass two: calvings, oldest first, so `recordCalving` can create farm-born calves that pass one may already have created as `acquired`. Reconcile the overlap explicitly — a farm-born animal entered as `acquired` in pass one should be corrected by a superseding event, not by deleting and re-adding.
- Expect the herd to be roughly 20 animals with maybe 10–20 historical calvings. This is small enough to enter by hand and check by eye. Do that once, carefully, rather than building an importer.

---

## 12. The one metric to derive now

**Calving interval.** For each animal, consecutive `calving` events ordered by `occurred_on`; interval in days.

Classify every interval:

- `measured` — both endpoints have `date_precision = 'day'`
- `approximate` — either endpoint is `month`, `year`, or `estimated`

**Report the two sets separately and never average across them.** Show the count of each. An approximate interval built from two `month`-precision calvings carries roughly ±60 days of uncertainty, which is larger than the difference between a good interval and a bad one — averaging it into a herd figure produces a number that looks precise and means nothing.

Herd-level output for this cycle is a small table: per animal, parity, each interval, its quality, and the current status. Not a chart. The two visualisations in the handover are worth building, but they are worth building over data that exists, and after this cycle there will be perhaps 15 real events.

Sample size caveat, worth writing into the output itself: five or six milking animals is a case series, not a dataset. Design and phrase everything accordingly.

---

## 13. Deferred, with reasons

| Item | Reason |
|---|---|
| **Agent tools over the registry** (open q. 3) | v1 is a service layer, not tools. But write it as pure-function + DB-shell (§4), so wrapping `get_animal` / `get_lactation_history` as tools later is mechanical. When they are added, follow the existing precedent exactly: reads unrestricted, writes confirmation-gated `WRITE_EXECUTOR`. `record_calving` in particular must be gated — it creates an animal. |
| **Sheet transcription** (open q. 4) | Out of v1, confirmed. It is the first real justification for vision and it reuses the confirmation gate, which makes it a good future cycle, but it should be built against a schema that has already survived manual entry of a real herd. |
| **Yield capture** (open q. 7) | Step 4 by definition. Note that it will hang off `lactations.id` — which is why §5's id stability decision matters now rather than later. |
| **Breeding, heat, the cycle prior** | Step 5. Also seasonally gated: most heats fall September–January, so a summer month of zeros is expected and any detection logic built now would be evaluated against an empty season. |
| **Null-observation events** | Belongs with transcription (step 3), since the source is the signed round on the daily sheet. Reserved in the taxonomy. The Cycle 5 camera-silence finding is the same insight and should be cited when it is built. |
| **Auth and multi-user** (open q. 8) | Not needed while the entry mode is weekly transcription from a laptop. **Stay in that mode deliberately.** Phone-in-the-shed entry means offline-first with sync conflict resolution, which is an order of magnitude harder and is a decision to make on purpose, not to drift into. |
| **Postgres** | SQLite plus a replication layer is sufficient for one farm and two or three users, and paper remains the system of record, so the database is a queryable derivative and loss is recoverable. Do not pre-emptively buy operational overhead. |
| **Pedigree tree view** | Renders a handful of disconnected nodes until a farm-born heifer has her own first calf. |
| **`event_links` to `farm_events`** | Zero rows today; would be designed against imagination. §3 keeps the path open. |

---

## 14. Questions this document does not answer

Split by who can answer them, per the established working pattern.

### For Claude Code to resolve from repo evidence

1. What is the actual SQLite driver and is there a migration runner? If migrations are ad-hoc, the two-database decision (§2) needs one before anything else.
2. Where is the DB path resolved, and is it hardcoded anywhere — fixtures, tests, the generator, `verify:*` scripts? Enumerate every site before renaming `dairy.db`.
3. Does the repo already depend on Zod (or equivalent) for boundary validation, and on a ULID/UUIDv7 library? Reuse rather than add.
4. What is the existing test harness for DB-touching code, and does it use in-memory SQLite or a temp file? The rebuild-diff verification in §10 needs whichever pattern already exists.
5. Where do `FARM_TZ` / `WORK_HOURS` / `RESTRICTED_ZONES` live, and is that module the right home for the calf-age threshold?
6. Does `farm_events` have a schema/migration version marker, and will adding a second DB file break the regression suite's setup or teardown?
7. Is there an existing convention for CLI scripts (`npm run` entries, arg parsing) that `registry:rebuild` and the backfill tool should follow?
8. Confirm nothing currently assumes a single global DB handle in a way that makes `DAIRY_DATASET` switching unsafe.

### For the user to resolve from the real world

1. The list of animals: for each, sex, name, rough birth date **with an honest precision**, and whether born on the farm or acquired.
2. Known calving history: which dam, roughly when, precision, calf sex, whether the calf survived, and whether the calf is one of the animals in list 1.
3. Dam links for farm-born animals where known; `unknown` certainty where not.
4. Any animals that have left — sold, died, culled — and roughly when.
5. Who the `recorded_by` and `observed_by` people are, as stable identifiers.
6. Confirm the `BD-` serial prefix, or supply a different one.
7. Confirm the 12-month calf threshold, or supply the one that matches how the farm actually talks about the animals.

---

## 15. Definition of done

- [ ] `DAIRY_DATASET` resolves the DB path; `dataset_meta` exists and boot hard-fails on mismatch; every CLI prints the dataset banner.
- [ ] Existing DB renamed to `dairy.synthetic.db` and stamped; `dairy.real.db` created; migrations applied automatically to whichever is opened; regression suite still passes 12/12 against synthetic.
- [ ] `farm_events` is byte-identical to the prior tag — no columns added, no discriminator, no changes to `get_farm_events`, `scoreEvent`, or `toolsForAgent()`.
- [ ] `animals`, `animal_events`, `lactations`, `parentage`, `animal_status`, serial counter, and `dataset_meta` created by migration.
- [ ] `date_precision` is `NOT NULL` with no default; `occurred_time` null unless precision is `day`, enforced by CHECK.
- [ ] All four provenance columns present; `recorded_by` and `recorded_at` `NOT NULL`.
- [ ] `supersedes_id` present with a unique partial index; projections exclude superseded events.
- [ ] Serial allocation is transactional, monotonic, never reuses a number.
- [ ] Lactation ids are `L-<calving_event_id>` and provably stable across rebuild.
- [ ] Event payloads validated at the write boundary against a discriminated union; reserved types rejected.
- [ ] `recordCalving` is one transaction writing dam event, calf animal, calf birth event, parentage edge, lactation open/close — with a test proving that a forced failure at each step leaves zero rows written.
- [ ] Stillborn and died-within-24h calvings create the calf node and open the lactation.
- [ ] Prior lactation closed with `inferred_at_next_calving` when no `dry_off` exists.
- [ ] Projection logic split pure (`project.ts`) / DB shell (`projectStore.ts`); only the rebuild writes projection tables.
- [ ] `registry:rebuild` is idempotent; `verify:registry` passes all 13 invariants in §10.
- [ ] Real herd backfilled with explicit precision on every date and `recall` provenance where applicable; no fabricated exact dates.
- [ ] Calving-interval report emits `measured` and `approximate` sets separately with counts, never a blended average.
- [ ] `REGISTRY.md` written in the style of `FARM_EVENTS.md` / `FARM_MONITOR.md`, documenting the schema, the projection rule, the precision conventions, and — explicitly — the known fidelity gaps.
- [ ] Verified by cloning and diffing against the prior known-good tag, not by reading the commit messages.

---