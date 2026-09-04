# Animal Registry — Decision Document: Build Steps 1 & 2 (revision 2)

**Repo:** `dairy-360` (named `dairy-agent` when this was written) · **Supersedes:** revision 1 · **Baseline tag:** `v0.10.0`
**Scope:** Animals, parentage, status projection (step 1); lactations and calvings, backfilled (step 2)
**Status:** Revised against the validation report. Ready to implement, with three re-checks named in §16.

---

## 0. Disposition of the validation report

Every item, with what happens to it. Revision 1 was wrong in ways that changed the shape of the cycle; the two-database decision is withdrawn.

| Item | Disposition |
|---|---|
| **B1** existing `animals` table, dropped by `seed()` | **Accepted, and it changes the cycle.** Revision 1 never saw this table. See §2. |
| **B2** `data/` doesn't exist | **Moot.** The two-file split is withdrawn; no new directory. |
| **B3** `DAIRY_DATASET` invisible to non-server entrypoints | **Moot for now, recorded as a prerequisite.** See §2, deferred trigger. |
| **B4** no `applySchema(db)` seam, no second handle | **Accepted as a named deliverable.** See §4. |
| **B5** rename isn't a repo change; "byte-identical to tag" uncheckable | **Accepted.** Restated as a source diff in §15. |
| **B6** 14 animals, not 100; they don't feed the generator or `scoreEvent` | **Accepted. My error.** See §3. |
| **B7** `farm_events.is_synthetic` already exists | **Accepted as fact, rejected as evidence.** See §2.3. |
| **B8** status vocabulary collision | **Accepted.** See §9. |
| **D1** two databases | **Withdrawn.** Taking option (b) — separate table names, one file — plus the migration runner from (a)'s critique. See §2. |
| **D2** two event tables | **Agreed, and strengthened** with the `IF NOT EXISTS` argument the report supplies. See §3. |
| **D3** ULID premise | **Accepted.** Full `randomUUID()`, sortability claim dropped. See §5. |
| **D4** constants module doesn't exist | **Accepted. My error.** See §9. |
| **D5** `verify:*` precedent doesn't fit | **Accepted, resolved differently.** Both a test and a script over shared pure invariant functions. See §10. |
| Invariant 1 "byte-identical" | **Accepted.** Restated as row-set identity under canonical ordering. |
| "No fabricated exact dates" checkbox | **Accepted.** Replaced by a precision histogram. See §11. |

Three of revision 1's errors — the 100 buffaloes, the constants module, the generator coupling — share one cause: I treated a handover summary as repo evidence and inferred structure that wasn't there. That is what the validate-first step exists to catch, and it caught all three. No change to the working pattern is needed; it worked.

---

## 1. What this cycle builds

A registry layer holding **real animals from the real farm**, structured as an append-only event log with rebuildable projections over it, living alongside the existing demo tables without touching them.

In scope: registry schema and a migration runner; permanent serial allocation; the append-only event log with date-precision and provenance on every row; `lactations`, `parentage`, `animal_status` as rebuildable projections; the atomic calving transaction; backfill of the known herd and calving history; a rebuild command; invariant verification as both a test and a script; calving-interval derivation with measured and approximate intervals reported separately.

Out of scope, with reasons, in §13.

---

## 2. Withdrawn: the two-database split (replaces revision 1 §2)

**Decision: one database file. Registry tables are named `registry_*` and are disjoint from the demo tables. A migration runner is a prerequisite deliverable of this cycle.**

### 2.1 What revision 1 got wrong

Revision 1 proposed `DAIRY_DATASET` selecting between `dairy.real.db` and `dairy.synthetic.db`. It was written without knowing that `animals` already exists — 14 rows, dropped and recreated by `resetSchema()` on every `seed()`, which the regression suite calls in `beforeEach`.

That single fact defeats the mechanism. With `DAIRY_DATASET=real`, one `npm run seed -w server` destroys the real herd, and `dataset_meta` does not catch it because the process is configured correctly — the *command* is wrong. A guard that only catches misconfiguration cannot defend against a correctly-configured destructive command.

### 2.2 What replaces it

Separate table names in one file:

```
registry_animals            registry_lactations        registry_serial_counter
registry_animal_events      registry_parentage         registry_animal_status
```

This achieves the actual goal of revision 1 §2 — no query can silently mix real and synthetic animals — structurally rather than by discipline, because the tables have different names and no legitimate query spans them. Zero filters to forget, which was revision 1's own test for a good solution. Zero new infrastructure, no `data/` directory, no `dotenv` change, no second file to keep migrated.

`resetSchema()` drops only the six demo tables. Registry tables are not in its DROP list and never will be. Belt and braces, because this is the failure that loses real records: **a test that reads `resetSchema()`'s DROP list and asserts no `registry_` table appears in it.** Cheap, permanent, and it fails loudly the day someone adds one.

The prefix goes on all five tables, not only the colliding `animals`. *(Seven as of step 4 — `registry_milkings` and `registry_animal_status` joined later.)* The set is the unit; a consistent prefix makes the boundary legible at a glance and makes any future rename mechanical.

### 2.3 On `farm_events.is_synthetic`

The report is right that the column exists and that nothing filters on it, and right that revision 1 asserted a cost the repo appears to disprove. But the inference does not hold: **all 26 rows are `is_synthetic = 1`.** A flag that has never had to separate mixed data has not been shown to work — it has never been exercised. Absence of failure in a table that has never held both kinds is not evidence the flag holds under mixing. This is structurally the same as the Cycle 5 camera-silence finding: absence of signal is not signal of absence.

So the argument against row-level flags stands, but it was not the load-bearing argument, and revision 1 should not have cited the classification path as a victim of it (see §3). The decision changes for B1's reason, not this one.

The inconsistency the report names is real and should be documented rather than hidden: `farm_events` separates synthetic from real in-row, the registry separates by table name. Note it in `REGISTRY.md`. If `farm_events` ever holds real camera rows alongside synthetic ones, that column has to start being enforced or the table has to split — a Cycle 7 problem, not this one.

### 2.4 Migration runner (new deliverable)

`FARM_SCHEMA` uses `CREATE TABLE IF NOT EXISTS`, which is why Cycle 5's four nullable columns required every developer to drop a live table by hand. The registry schema is expected to change at steps 3, 4 and 5. Repeating that pattern would guarantee the same manual drop, on the one set of tables that holds unrecoverable-in-software data.

Build a minimal runner:

- `PRAGMA user_version` as the version marker; current value is 0 and existing tables are **not** retrofitted into it — version 0 means "the schema as it stands at `v0.10.0`".
- An ordered array of migration functions. Apply every migration above `user_version`, each inside a transaction, bumping `user_version` in the same transaction.
- Registry tables are migration 1. The runner is global, not registry-specific; the registry is simply its first customer.
- Called at `db.ts` module load, and callable against any handle — see §4.

### 2.5 The fork, and where it merges

Two animal tables in one database is a fork. Name its end explicitly so it does not drift:

- Step 4 (yield) will hit this. `milkings.animal_id` FKs the demo `animals`, so real yield cannot go there. Step 4 gets `registry_milkings`. Expect the fork to widen before it closes. **(Built. Volume turned out to be a second, independent reason for a separate table — see [REGISTRY_MILKING.md](REGISTRY_MILKING.md) §3.)**
- **The merge point is the tools cycle** (open question 3). When the agent gets `get_animal` / `get_lactation_history` over the registry, the demo `animals` table becomes redundant: `list_animals`, `search_animals`, `add_animal` and `guardIds()` get repointed, the demo fixtures move to `registry_*` seed data or are deleted, and the regression suite's assertions are rewritten once. Do that as one deliberate cycle, not incrementally.
- Until then, the demo tables are **fixtures for a scripted demo, not a record of anything**. Say that in `REGISTRY.md`, because it is the fact that makes the fork tolerable.

### 2.6 When the file split comes back

Defer, with a concrete trigger rather than a vague "later". Revisit two files when either happens:

- the database ships to the farm as a deployed artifact, or
- backup or retention policy differs between real and demo data.

At that point the prerequisites the report identified become mandatory and should be built together: `import 'dotenv/config'` as the first line of `db.ts` (four entrypoints currently lack it, so `seed.ts` would silently write the wrong file), `mkdirSync` before `new Database`, a rename runbook covering the `-wal` and `-shm` sidecars, and the migration runner applied to both files at boot. The runner is being built now, so that list shrinks by one.

---

## 3. Two event tables — confirmed and strengthened (replaces revision 1 §3)

**Decision unchanged: `farm_events` is not modified. Animal-life events go in `registry_animal_events`.**

Revision 1 argued from column nullability and coupling. Two corrections and one stronger argument:

**Correction (B6).** Revision 1 claimed the synthetic animals feed the six-scenario generator and the Farm Monitor classification path. They do not. There are 14 of them, not 100; the scenario library's subjects are employees, the owner, `unknown_a1`, cameras and zones; `scoreEvent` scores on zone, event type, confidence, identity and time, never on an animal. They feed the regression suite only.

This makes the separation case *stronger*, not weaker: the registry's blast radius on the camera path is not "small", it is **zero**. Nothing in `farm/` reads `animals`.

**The stronger argument the report supplies.** `farm_events` is `CREATE TABLE IF NOT EXISTS`, so it cannot be altered in place at all. Adding `date_precision`, `observed_by`, `source_form` and `supersedes_id` to it would require a manual drop of a live 26-row table and would leave a schema with no evolution path. Its two CHECK constraints would also have to widen, against the documented rule reserving CHECKs for externally-arriving webhook bodies — which animal events are not.

**`event_links` stays deferred**, and the report gives the decisive reason: `farm_events.identity` holds people (`employee_1`, `owner`, `unknown_a1`), never animals. There is nothing to link to yet.

The read-time merge (`getAnimalTimeline`) also stays deferred to the cycle that has both sides.

---

## 4. Source of truth, projections, and the schema seam

**The rule (unchanged):** `registry_animal_events` is the sole source of truth. `registry_lactations`, `registry_parentage`, `registry_animal_status`, and projection columns on `registry_animals` are stored derived state, reproducible by `registry:rebuild`, and `verify:registry` proves a rebuild reproduces what is stored.

**Enforcement (unchanged):** projections are written only by `rebuild.ts`. The calving transaction calls the rebuild for affected animals rather than hand-patching rows. Pure functions in `registry/project.ts` (events in, projections out, no DB), DB shell in `registry/projectStore.ts` — the shape the report confirms matches `classify.ts` / `classifyStore.ts`.

**New deliverable (B4).** The rebuild-and-diff verification needs a second handle with the schema applied. `db.ts` exports a module-level singleton created at import, with no factory and no `close()`. Rather than refactor that:

- `registry/schema.ts` exports `applyRegistrySchema(db: Database)` and the migration list.
- `db.ts` calls it at module load against the singleton. One added import line; the singleton design is untouched.
- Tests and the rebuild-diff call it against `new Database(':memory:')`.

Use `:memory:` rather than temp files. `:memory:` appears nowhere in the repo today, but it keeps the property the report flags as worth preserving deliberately: **`npm test -w server` still never writes to disk.** CI gains DB-exercising tests without gaining filesystem state.

---

## 5. Identifiers (revises revision 1 §5)

### Animal serial — unchanged

`BD-0001`. Permanent, never reused, zero-padded, allocated from `registry_serial_counter` inside the same transaction as the insert. Post number and ear tag are attributes, not identity.

Worth noting: this does not collide with the demo table's `animal_<8hex>` ids, so if the tables are ever merged at the tools cycle, the two id spaces remain unambiguous.

### Event id — changed

**`aevt_` + full `randomUUID()`.** Revision 1 said "ULID (or UUIDv7) as TEXT" and claimed sortability. The report is right on both counts:

- The repo has no ULID or UUIDv7 library, and adding one is a real new runtime dependency.
- The repo convention, at eight sites, is `randomUUID().slice(0, 8)`. Following it here would be actively wrong: 32 bits gives a birthday collision around 77k rows and non-trivial risk far below that, and a collision means a lactation id silently points at the wrong lactation — reintroducing the exact failure §5 exists to prevent, through the id format instead of the numbering scheme.

So: keep the type prefix convention, drop the truncation, add no dependency. Creation order is recoverable from `recorded_at`, which §6 makes `NOT NULL` and exact, so the sortability property is not needed. **The sortability claim in revision 1 is withdrawn.** Note in the code that the 8-char convention is deliberately not followed here, and why.

### Lactation id — unchanged in substance

**`lact_` + the UUID portion of the opening calving event's id.** Stability comes from deriving it from an immutable event, not from the id format, so nothing here depended on ULID.

The reason remains: a sequence-encoded id (`BD-0042-L3`) renumbers every later lactation for an animal when an earlier calving is discovered during backfill, which will happen. The display sequence number is computed at read time, where being wrong is visible and harmless.

> **Corrected at step 4.** This said yield rows would then point at the wrong lactation, i.e. that they would carry the lactation id as a **foreign key**. They do not. The derived id is stable enough to be an identifier and not stable enough to be a key — correcting a calving supersedes it and the id changes, and with no correction at all, recording a calving re-cuts the *previous* lactation's `ended_on` so yield in the overlap silently belongs elsewhere. Yield is keyed on `(animal_id, occurred_on, session)` and derives its lactation by date range. Both failures are demonstrated by execution in [REGISTRY_MILKING.md](REGISTRY_MILKING.md) §2. The general rule: `registry_lactations` is a projection the rebuild drops and recreates, so a record must never carry a foreign key into it.

### Canonical ordering

Wherever event order matters — the rebuild above all — order deterministically:

```sql
ORDER BY occurred_on, COALESCE(occurred_time, '00:00'), recorded_at, id
```

Untimed events sort before timed ones on the same day. Arbitrary, but stable across rebuilds, which is the property that matters.

---

## 6. Time, precision, and provenance (unchanged from revision 1)

Confirmed by the report: `FARM_TZ = 'Asia/Karachi'`, no DST, matching `classify.ts`.

### Three times, three columns

- `occurred_on` — farm-local calendar date, `YYYY-MM-DD` TEXT.
- `occurred_time` — farm-local `HH:MM`, **nullable**. Present when known, null when not.
- `recorded_at` — exact UTC instant of transcription. Always present.

Do not collapse the first two into one timestamp with a qualifier: that forces you to invent an hour for a date known only to the month, and the invented hour reads as real downstream. Nullable time makes "unknown" the stored value.

Farm-local dates, not UTC instants, and say so in a comment so nobody "fixes" it. Every operational fact — the 05:00/12:00/17:00/22:00 rounds, AM/PM milking, the daily sheet — is expressed in local days, and UTC would move the 22:00 round to the previous day.

### `date_precision`

`day` | `month` | `year` | `estimated`. `NOT NULL`, **no default**.

- `month` → stored as the 1st of that month. `year` → stored as January 1.
- `occurred_time` must be `NULL` unless `date_precision = 'day'`. Enforced by CHECK.
- Surface precision everywhere a date is displayed: "March 2024 (month)", "~2021 (estimated)". Never a bare date.

### Provenance

`source_form` (`daily_herd_sheet` | `cycle_card` | `direct_entry` | `import` | `recall`), `source_ref`, `observed_by` (nullable), `recorded_by` (`NOT NULL`).

`recall` is first-class, not a fallback. Most of the step-2 backfill will be `recall` + `month` precision or worse. If recall rows are indistinguishable from sheet rows, the first calving-interval number is unfalsifiable.

### Corrections

`supersedes_id`, nullable, self-referencing, with a partial unique index so two events cannot claim to replace the same one. Projections ignore superseded events. Nothing in `registry_animal_events` is ever `UPDATE`d or `DELETE`d.

The report confirms partial unique indexes, append-only triggers and JSON1 all work on the bundled SQLite 3.49.2, and that a trigger would be the repo's first. Use one, and note it in `REGISTRY.md`.

---

## 7. Event taxonomy (unchanged from revision 1)

Live in this cycle — six types:

| Type | Subject | Payload |
|---|---|---|
| `birth` | the calf | `{ dam_id, sire_ref?, calving_event_id, sex, outcome }` |
| `acquired` | the animal | `{ from?, estimated_birth_on?, estimated_birth_precision?, notes? }` |
| `calving` | the dam | `{ calf_id, calf_sex, outcome: 'live' \| 'stillborn' \| 'died_within_24h', assistance?, notes? }` |
| `dry_off` | the dam | `{ reason?, notes? }` |
| `departure` | the animal | `{ reason: 'sold' \| 'died' \| 'culled' \| 'lost', to?, cause?, notes? }` |
| `note` | any animal | `{ text }` |

Reserved, rejected by the write boundary: `heat_observed`, `insemination`, `pregnancy_check`, `abortion`, `treatment`, `vet_visit`, `null_observation`, `milking`, `weight`, `body_condition`.

**Validation, revised for the repo (Q3).** There is no Zod and no validation library; boundary validation today is hand-rolled `guardIds()` plus `String(args.x)` coercion, with JSON-Schema enums enforced by the model rather than by code. Do not add a dependency for this cycle. Write one hand-rolled `assertEventPayload(type, payload)` in `registry/events.ts`, exhaustive over the discriminated union, throwing on unknown keys and on reserved types. It is six payload shapes; a schema library would be a dependency added for less code than it saves.

If a later cycle wants a validation library, that is a repo-wide decision, not a registry one.

Payloads stored as JSON TEXT. **Origin invariant:** exactly one `birth` or `acquired` per animal; no other event (except `note`) dated before it.

---

## 8. The calving transaction (unchanged from revision 1)

One function, one `BEGIN IMMEDIATE` transaction, all-or-nothing. This is the most important code in the cycle: the failure it prevents — orphaned calves, a pedigree of disconnected nodes — surfaces much later and cannot be repaired from the data.

`recordCalving({ dam_id, occurred_on, occurred_time?, date_precision, calf: { sex, name?, outcome }, sire_ref?, provenance })`

1. **Validate.** Dam exists, female, no `departure` on or before this date, no existing `calving` within a plausibility window (warn and require an explicit override during backfill; never silently accept).
2. **Allocate** the next serial from the counter.
3. **Insert** the calf's `registry_animals` row, `origin = 'born_on_farm'`.
4. **Insert** the `calving` event on the dam.
5. **Insert** the `birth` event on the calf — **same date, same precision** as the calving. Same physical fact from two sides; if the dates can diverge, the timeline lies.
6. **Rebuild** projections for dam and calf.

`stillborn` and `died_within_24h` still perform steps 2–5, plus a `departure` event with reason `died` on the calf. A stillbirth opens a lactation and counts toward parity and calving interval, so the calf must exist as a node. Suppressing it corrupts the metric this cycle exists to produce.

**Closing the previous lactation.** If a `dry_off` exists, the lactation ended there. If not, close it at the calving date with `end_reason = 'inferred_at_next_calving'`. Do not reject — backfilled history routinely has calving dates and no dry-off dates, and rejecting forces the operator to invent a date to satisfy a constraint. The marker records that the boundary is a derivation, not an observation.

---

## 9. Status projection (revises revision 1 §9)

### Vocabulary (B8)

The registry defines its own type, `RegistryAnimalStatus`, in `registry/types.ts`. It does **not** extend or modify `AnimalStatus` in `shared/src/types.ts`, and it does **not** touch the two tool `input_schema` enums. Those belong to the demo domain and changing them is a breaking change to tool schemas for no benefit this cycle.

Where the vocabularies can agree at zero cost, they should: use **`lactating`**, not `milking`. Gratuitous divergence in a small codebase is a tax paid at every future read.

`pregnant` is deliberately absent: it requires breeding events, which are step 5. At step 5 it gets added and the two vocabularies converge except for `heifer`, `male` and `departed`, which the demo type does not have.

### Rules — first match wins

1. `departed` — a `departure` event exists. Terminal.
2. `calf` — birth date known and age < `CALF_MAX_AGE_MONTHS`.
3. `lactating` — parity ≥ 1 and an open lactation exists.
4. `dry` — parity ≥ 1 and no open lactation.
5. `heifer` — female, parity 0.
6. `male` — male, parity 0.

`parity` = count of non-superseded `calving` events. If birth date is unknown, rule 2 cannot fire and the animal falls to `heifer`/`male`; the fix is to enter an estimated birth date, which the precision qualifier makes safe.

### Constants (D4)

Revision 1 said to put the threshold "in the same constants module as `FARM_TZ`, `WORK_HOURS`, `RESTRICTED_ZONES`". **There is no constants module.** Those three are exports of `farm/classify.ts`, whose DB-freedom is a load-bearing property asserted by its own test, and whose subject is cameras and people. Putting a calf-age threshold there would couple the registry to the camera classifier for nothing.

The convention the repo actually has is: **named, exported, commented constants at the top of the module that owns the rule**, with the comment stating the value's origin and whether it is provisional — `classify.ts`'s `RESTRICTED_ZONES` even documents which scenario breaks if it changes.

So `CALF_MAX_AGE_MONTHS = 12` goes at the top of `registry/project.ts`, next to the rules that consume it, in that style, commented as provisional and awaiting the farm's own usage. Extracting a shared constants module is a separate small change and only `FARM_TZ` would qualify for it.

---

## 10. Rebuild and verification (revises revision 1 §10)

### Both a test and a script (D5)

The report is right that the `verify:*` precedent does not transfer: both existing verify scripts are scripts *because* they replay through HTTP against a running server, which is the stated reason they are not `*.test.ts`. Registry verification runs entirely in-process, so that reason does not apply.

But picking one is wrong, because the two callers need different data:

- The **invariants must run against real data**, which CI will never have.
- The **projection logic must run in CI**, against fixtures, on every push.

So: the invariants live as pure functions in `registry/invariants.ts` (events + projections in, violations out), with two callers.

- **`registry.invariants.test.ts`** — builds an `:memory:` DB via `applyRegistrySchema`, seeds fixture herds including the nasty cases (superseded events, stillbirth, calving with no dry-off, month-precision backfill), asserts zero violations, and asserts each invariant fires on a deliberately corrupted fixture. Runs in CI. Writes nothing to disk.
- **`npm run verify:registry -w server`** — runs the same functions against the live `dairy.db`, plus the rebuild-diff, plus the precision histogram (§11). Follows the repo CLI convention: `npm run verify:registry -w server` → `tsx`, `process.argv.slice(2)` hand-parsed as `--flag=value`, `if (require.main === module)` guard. `--animal=BD-0001` fits that convention exactly.

### `npm run registry:rebuild -w server [-- --animal=BD-0001]`

Recomputes all projection tables from the event log. Idempotent.

### Invariants

**0. Idempotence** — running the rebuild twice produces identical projection row-sets. (New, per the report.)

**1. Rebuild fidelity** — rebuilding into a fresh `:memory:` DB produces projection row-sets **identical to what is stored, compared as multisets under the canonical ordering of §5.** Revision 1 said "byte-identical", which is wrong: SQLite files differ in page layout, freelists and WAL state for identical content. Use the multiset-matching approach `verify.ts` already uses. Anyone implementing a file hash here will get failures that mean nothing.

2. Lactation ids unchanged across rebuild. **This gets its own dedicated test**, not just a script line — the failure it guards is silent and permanent.
3. Exactly one origin event per animal.
4. No event except `note` dated before its animal's origin event, allowing for precision.
5. No event except `note` dated after a `departure`.
6. Every `calving` names an existing `calf_id` with `origin = 'born_on_farm'` and a `birth` event of the same date and precision.
7. Every `born_on_farm` animal has a `dam` parentage edge.
8. No animal has two open lactations.
9. No superseded event contributes to any projection.
10. No duplicate serials; counter ≥ max issued serial.
11. `month`-precision rows dated to the 1st; `year`-precision rows to Jan 1.
12. `occurred_time` null wherever `date_precision != 'day'`.
13. `resetSchema()`'s DROP list contains no `registry_` table. (New, per B1. Lives with the other invariants but is a source-level check.)

The `dataset_meta` invariant from revision 1 is deleted with the two-file split.

**Implementation strengthened three of these; [REGISTRY.md](REGISTRY.md) carries the current wording.** Invariant 6 also checks the calf's **sex** and a matching back-reference, not only date and precision; invariant 8 also checks that every lactation id derives from its opening calving; invariant 13 checks the `SCHEMA` const as well as `resetSchema()`'s DROP list. A spec being narrower than what was built is fine — but read the invariants from REGISTRY.md, not from here.

---

## 11. Backfill policy (revises revision 1 §11)

Steps 1 and 2 can be populated with real data immediately, which is why they come first. Rules, blocking:

- **Precision is never defaulted.** The backfill input requires an explicit precision per date; missing precision is an error, not `day`.
- **`source_form = 'recall'`** for anything reconstructed from memory. `recorded_by` is whoever remembered it; `observed_by` null unless they saw it.
- **Do not enter a date you do not have.** `estimated 2021` beats a fabricated `2021-04-12`, because only the first can be corrected without someone first discovering it was wrong.
- **Two passes.** Animals with origin events first; then calvings, oldest first, so `recordCalving` creates farm-born calves that pass one may already have entered as `acquired`. Correct the overlap by superseding event, never by delete-and-re-add.
- ~20 animals and 10–20 historical calvings is small enough to enter by hand and check by eye. Do that once, carefully, rather than building an importer.

### Precision histogram replaces the honesty checkbox

Revision 1's DoD line "no fabricated exact dates" is not machine-checkable — invariants 11 and 12 catch *inconsistent* precision, not *dishonest* precision. Replace it with a reported artifact: `verify:registry` prints a table of event counts by `date_precision` × `source_form`.

A backfill that comes out 90% `day`-precision `recall` is the signal you want, and only the histogram shows it. Read it, don't assert on it.

---

## 12. The one metric to derive now (unchanged)

**Calving interval.** Consecutive `calving` events per animal, ordered by `occurred_on`, interval in days.

- `measured` — both endpoints `date_precision = 'day'`
- `approximate` — either endpoint is `month`, `year` or `estimated`

**Report separately, with counts. Never average across them.** An approximate interval from two `month`-precision calvings carries roughly ±60 days, larger than the difference between a good interval and a bad one; blending produces a number that looks precise and means nothing.

Output is a small table — per animal: parity, each interval, its quality, current status. Not a chart. Five or six milking animals is a case series, not a dataset; phrase the output that way.

---

## 13. Deferred, with reasons

| Item | Reason |
|---|---|
| **Agent tools over the registry** | v1 is a service layer. Pure-core / DB-shell (§4) makes wrapping mechanical later. **This is also the fork's merge point (§2.5)** — when tools arrive, the demo `animals` table is retired in the same cycle. Reads unrestricted, writes confirmation-gated `WRITE_EXECUTOR`; `record_calving` must be gated, it creates an animal. |
| **Sheet transcription** | Out of v1. It is the first real justification for vision and reuses the confirmation gate, but it should be built against a schema that has survived manual entry of a real herd. |
| **Yield capture** | Step 4, as `registry_milkings` — `milkings.animal_id` FKs the demo table (§2.5). **Built; see [REGISTRY_MILKING.md](REGISTRY_MILKING.md).** It does *not* hang off `registry_lactations.id` — that plan was wrong and §5's correction note says why. |
| **Breeding, heat, cycle prior** | Step 5. Also seasonally gated: most heats fall September–January, so anything built now is evaluated against an empty season. |
| **Null-observation events** | Belongs with transcription (step 3); the source is the signed round on the daily sheet. Reserved in the taxonomy. Cite the Cycle 5 camera-silence finding when it is built — same insight, human domain. |
| **`event_links` / `getAnimalTimeline`** | `farm_events.identity` holds people, never animals. Nothing to link to. |
| **Auth, multi-user, hosting** | Not needed while entry is weekly transcription from a laptop. **Stay in that mode deliberately** — phone-in-the-shed means offline-first with sync conflict resolution, an order of magnitude harder, and a decision to make on purpose rather than drift into. |
| **Postgres** | SQLite is sufficient for one farm and a few users, and paper remains the system of record, so the DB is a queryable derivative. |
| **Two DB files** | Withdrawn with a named trigger (§2.6). |
| **Validation library** | Repo-wide decision, not a registry one (§7). |
| **Pedigree tree, the two visualisations** | Render a handful of nodes until there is history. Revisit when a farm-born heifer has her own first calf. |

---

## 14. Still open, for the user

Repo-evidence questions are all answered by the validation report. These remain, and they are now the bottleneck — the schema is cheap, the herd history is not:

1. Every animal: sex, name, rough birth date **with honest precision**, born-on-farm or acquired.
2. Known calving history: dam, roughly when, precision, calf sex, whether the calf survived, and whether the calf is in list 1.
3. Dam links where known; `unknown` certainty where not.
4. Animals that have left — sold, died, culled — and roughly when.
5. Stable identifiers for the `recorded_by` / `observed_by` people.
6. Confirm the `BD-` serial prefix.
7. Confirm `CALF_MAX_AGE_MONTHS = 12`, or supply the threshold matching how the farm actually talks about the animals.

---

## 15. Definition of done

> **Status: steps 1 and 2 shipped.** Tagged `v0.11.0` (schema, migration runner,
> calving transactions with link mode, invariants, backfill CLI), `v0.11.1`
> (HTTP surface and the `:memory:` harness) and `v0.12.0` (entry UI, plus the
> storage gate). What was built — including where implementation departed from
> or strengthened this spec — is documented in [REGISTRY.md](REGISTRY.md), which
> is authoritative from here on.
>
> **The boxes below are deliberately left unticked.** Ticking them would assert
> a verification pass against this list, item by item, that nobody has run; the
> evidence that exists is the test suite, the tags, and REGISTRY.md. Three items
> are known to be genuinely open, and they are the herd-data ones rather than
> the code ones:
>
> - **Real herd backfilled with explicit precision on every date** — not
>   started. The registry holds zero rows; `GET /api/registry/animals` against
>   the live `dairy.db` returns `{"animals":[]}`.
> - **Histogram reviewed by hand** — nothing to review until the backfill runs.
> - **Regression suite recorded before and after** — not re-run for this cycle.
>   It is API-key and `RUN_REGRESSION=1` gated, and a skip is a skip, not a pass.

- [ ] Migration runner using `PRAGMA user_version`; existing tables not retrofitted; registry schema is migration 1; applied at `db.ts` load and callable against any handle.
- [ ] `registry/schema.ts` exports `applyRegistrySchema(db)`; `db.ts` singleton design otherwise untouched.
- [ ] Six `registry_*` tables created by migration. No demo table altered.
- [ ] Test asserting `resetSchema()`'s DROP list contains no `registry_` table.
- [ ] `git diff v0.10.0 -- server/src/db.ts server/src/tools/ server/src/farm/` shows **only** the `applyRegistrySchema` import and the migration runner. (Revision 2 named `server/src/farm/farmReads.ts`; that file is at `server/src/tools/farmReads.ts`, so the two directory paths cover it and every sibling.) No change to `guardIds()`, `add_animal`, `list_animals`, `search_animals`, `get_farm_events`, `scoreEvent`, `summarize_daily_activity`.
- [ ] `shared/src/types.ts` `AnimalStatus` unchanged; both tool `input_schema` enums unchanged.
- [ ] `date_precision` `NOT NULL`, no default; `occurred_time` null unless precision is `day`, enforced by CHECK.
- [ ] All four provenance columns; `recorded_by` and `recorded_at` `NOT NULL`.
- [ ] `supersedes_id` with a partial unique index; append-only trigger; projections exclude superseded events.
- [ ] Serial allocation transactional, monotonic, never reused.
- [ ] Event ids are `aevt_` + full `randomUUID()`, with a comment stating why the 8-char convention is not followed.
- [ ] Lactation ids are `lact_` + the calving event's UUID, with a **dedicated test** proving stability across rebuild.
- [ ] Payloads validated by a hand-rolled exhaustive `assertEventPayload`; reserved types rejected; no new dependency added.
- [ ] `recordCalving` is one transaction, with a test proving a forced failure at each of the six steps leaves zero rows written.
- [ ] Stillborn and died-within-24h calvings create the calf node and open the lactation.
- [ ] Prior lactation closed with `inferred_at_next_calving` when no `dry_off` exists.
- [ ] Projection logic split pure / DB-shell; only the rebuild writes projection tables.
- [ ] `registry.invariants.test.ts` runs in CI against `:memory:`, asserts zero violations on clean fixtures and that each invariant fires on a corrupted one. `npm test -w server` still writes nothing to disk.
- [ ] `npm run verify:registry -w server` passes invariants 0–13 against the live DB and prints the precision histogram.
- [ ] `registry:rebuild` idempotent (invariant 0).
- [ ] Real herd backfilled with explicit precision on every date; histogram reviewed by hand.
- [ ] Calving-interval report emits `measured` and `approximate` separately with counts; no blended average.
- [ ] `REGISTRY.md` in the style of `FARM_EVENTS.md` / `FARM_MONITOR.md`, documenting the schema, the projection rule, the precision conventions, the demo-vs-registry fork and its merge point, the `farm_events` flag-vs-table-name inconsistency, the first use of a trigger, and the known fidelity gaps.
- [ ] Regression suite: record the result before and after. A single differing tool path is reviewed by hand, not treated as a failure. It is API-key and `RUN_REGRESSION=1` gated and model-nondeterministic; a skip is a skip, not a pass.
- [ ] Verified by cloning and diffing against `v0.10.0`, not by reading commit messages.

---