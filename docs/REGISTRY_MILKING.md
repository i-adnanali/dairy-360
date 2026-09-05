# Registry milk logging — design decisions

Status: **built.** Migration 3, the write boundary, the `/milking` roster, invariants 14–17, the
`/check` completeness panel and the harness fixture all landed together. Server 480 tests, frontend
210 across 22 files *at the time this landed* — counts move; a run is the authority.

**Extended since, by [REGISTRY_SALES.md](REGISTRY_SALES.md).** Three claims in here were changed by
it and each is annotated where it appears: the `source_form` CHECK in §7 (the block was stale from
the start), the DELETE-scope rule in §8, and the bulk-tank deferral in §11. Milk yield itself is
unchanged. What is NOT built is listed in §11 and §13; the lactation curve on
`/animals/:id` (build item 6) is the one piece of §9 still outstanding.

Written against `v0.15.0-5-g1391524` and verified by execution rather than by reading — the finding
in §2 that changed the recorded plan is a run, not an argument, and both halves of it are now
regression tests (`registry.milking.test.ts`, "FINDING 1" and "FINDING 2").

**This document covers per-animal milk yield only.** Feed, treatment, weight and body condition are
named in the reserved list and are not step 4. Breeding events are step 5 and are the more valuable
gap; see §11.

---

## 1. Why this exists, and what changes when it lands

The farm currently measures a single animal's yield **only when someone notices her output has
dropped**. The intent here is the opposite: every milking animal, every session, so that the drop is
visible in the data before it is visible to a person, and so that a year of rows can be asked
questions the current practice cannot answer.

That is a change in **farm practice**, not only a feature. The application can make full-roster entry
cheap; it cannot make anyone measure. §7 says how the record stays honest when they do not.

This is the first piece of §9 of `REGISTRY_ENTRY_UX.md` — "Direction: the daily workflow" — arriving.
Two of the three shifts §9 predicted apply immediately:

- **The provenance model inverts.** `direct_entry` becomes the dominant source rather than the rare
  one, `observed_by` becomes a primary field rather than a nearly-unused one, and **today's date
  becomes a legitimate default, because today is a fact rather than a guess.** That is the single
  place the no-default rule relaxes, and it relaxes for a stated reason rather than by being
  forgotten.
- **New event types** — but *not* as events. See §3.

The third shift, the device constraint, **does not apply**: entry is in the application, online,
daily. Offline and mobile are explicitly out of scope. Note the consequence rather than hiding it —
the milking happens at the animals and the entry happens at a laptop, so there is a gap between
observation and record that this design does not close, and `observed_by` is the only thing that
records who was actually there.

`§5.3 Day sheet mode` was **dropped** in the entry-UX doc because no paper daily sheet exists on this
farm and a screen mirroring a nonexistent artifact has no purpose. That reasoning does not carry
here and the shape returns for the opposite reason: this screen does not transcribe a daily record,
it **is** the daily record.

---

## 2. The finding: the lactation id is not a stable foreign key

**Three places record the plan that yield rows carry `lactation_id` as a foreign key**
— `events.ts:55`, `verify.ts:124`, `REGISTRY.md:196` — justified by the lactation id being derived
from an immutable calving event rather than from a sequence number.

The derivation does solve the problem it was designed for: a later-discovered *earlier* calving no
longer renumbers its siblings, which a sequence-encoded `BD-0042-L3` would. **It does not survive
correcting the calving that opened the lactation**, and that is a first-class operation with a CLI
command, an HTTP route and a UI form.

`correctCalving` mints a new event id and supersedes the old event (`calving.ts:559`).
`projectLactations` derives the row id from the *effective* calving (`project.ts:222`), so the id
changes, and `rebuildAnimals` deletes the old projection row and inserts a new one.

Demonstrated rather than argued, on a dam with no other history:

```
1. calving recorded on 2024-03-15
   calving event   aevt_e440a967-0a62-471d-a46c-e4300bf6c734
   LACTATION ID    lact_e440a967-0a62-471d-a46c-e4300bf6c734
   started_on      2024-03-15

   -- a year of yield rows would now carry lactation_id = lact_e440a967-...

2. date corrected to 2024-04-15 (a supported, routine operation)
   calving event   aevt_3f07b0d4-666b-4652-8b96-cacdc4e42dae <- new id, supersedes the old
   LACTATION ID    lact_3f07b0d4-666b-4652-8b96-cacdc4e42dae
   started_on      2024-04-15

3. VERDICT
   lactation id changed          true
   old lactation row survives    false
   lactation rows for this dam   1 (still ONE lactation -- the same one)
```

Same lactation, new key, old row gone. Every yield row pointing at the first id would reference a row
that does not exist — and a calving date correction is exactly what backfill reconciliation produces,
*after* a season of yield has been attached to it.

### The worse case, where nothing is corrected at all

The dangling reference above is the visible failure. This is the one that decides the question,
because **no correction occurs** — a calving is simply entered a few days after it happened, which is
the ordinary case once yield is logged daily:

```
1. after her first calving (2024-01-01)
   lact_4ee9afcd…  2024-01-01 -> OPEN

2. yield is logged daily. On 2025-03-05 the only open lactation is
   lact_4ee9afcd-4678-4c51-978a-0b7954c97627
   -- an FK captured at entry time would freeze THAT id onto the row.

3. her second calving is entered (occurred 2025-03-01)
   lact_4ee9afcd…  2024-01-01 -> 2025-03-01
   lact_ad84ea87…  2025-03-01 -> OPEN

4. VERDICT for a yield row dated 2025-03-05
   FK captured at entry time    : lact_4ee9afcd… (lactation 1)
   lactation it ACTUALLY sits in: lact_ad84ea87… (lactation 2)
   first lactation now ends     : 2025-03-01
```

A lactation's end date is not a property of the calving that opened it — `projectLactations` closes
each one at the *next* calving. So recording any calving silently re-cuts the boundary of the
previous lactation, and every yield row already written into the overlap changes which lactation it
belongs to.

The FK does **not dangle** here, so no foreign-key constraint fires. Both rows exist, so **no
invariant can see it**. The yield is simply attributed to a lactation that ended four days earlier —
not inconsistent, merely false, which is the failure this codebase has now found four times.

**And this is the case a rewrite-on-correction cannot fix**, because nothing was corrected. Keeping
the FK correct would require fanning out from *every* calving write into the yield table, coupling
the calving transaction to a table it has no business knowing about, in order to maintain a cached
copy of a date range that is already computable.

### The principle underneath, which is more general than the bug

`registry_lactations` is a **projection table**. It is in `REGISTRY_PROJECTION_TABLES`, and the
standing claim in the decision document is that projection tables can be dropped and recreated at any
time. `registry_milkings` is a **record** — a source of truth, like the event log.

> **A record must never carry a foreign key into a projection.**

The recorded plan pointed a permanent measurement at a row the rebuild deletes. That is the defect,
and the id-derivation scheme merely made it non-obvious.

### Decision

**Yield carries no `lactation_id`.** It is keyed on `(animal_id, occurred_on, session)` and its
lactation is **derived at read time** by date range against that animal's lactation rows.

Nothing dangles, the rebuild cannot orphan anything, and a corrected calving date silently
re-attributes its yield to the correct lactation — which is the right answer, not a workaround. The
cost is a range join instead of a key lookup, on a herd of about twenty animals.

**To correct in the existing docs:** `events.ts:55`, `verify.ts:124` and `REGISTRY.md:196` all state
the FK plan. The *id-stability* argument in those comments stays true and worth keeping — a
sequence-encoded id really would be worse. Only the "yield rows will carry it as a foreign key"
clause is wrong.

---

## 3. Storage: a table, not an event type

`milking` is in `RESERVED_EVENT_TYPES` and rejected at the write boundary. `REGISTRY.md:42` already
decides step 4 gets **`registry_milkings`**, because the demo `milkings.animal_id` has a foreign key
to the demo `animals` table that `seed()` drops. That decision stands, and there is a second reason
the doc does not give.

**Volume.** `herd()` calls `effectiveEvents(allEvents(db))` — every event in the database, loaded
into JavaScript, on every herd render. `checkSnapshot` runs over a whole-registry snapshot. The herd
today is 31 animals and 70 events. Two sessions × roughly a dozen milkers is **~9,000 rows a year**.
In `registry_animal_events` that would make every herd page and every `/check` run scale with milking
history, for rows no projection reads.

**And the reserved list conflates two kinds of thing**, which is worth recording because it will
recur at steps 5 and 6:

| Sparse life events — belong in the event log | Repeating measurements — belong in their own tables |
|---|---|
| `heat_observed`, `insemination`, `pregnancy_check`, `abortion`, `treatment`, `vet_visit` | `milking`, `weight`, `body_condition` |
| change what the animal *is*; have derived consequences (parity, lactations, pedigree) | describe what the animal *did*; aggregate, and derive nothing |

`milking` stays in the reserved list — removing it would let a loose `milking` event through the
boundary, which is the opposite of what the list is for.

---

## 4. The data model: four row states, and why three is not enough

This is the correctness problem of the daily workflow, and it stands where date precision stands in
the backfill. A session where 14 of 18 animals were recorded leaves four rows absent, and **absence
is ambiguous** across at least four different facts.

The distinction that matters most, and the one easiest to collapse by accident:

- **Not milked** — sick, under treatment, away, dried off that day. *No milk was taken.* For a daily
  total this behaves like zero.
- **Milked, not measured** — an ordinary milking that nobody weighed. *Milk exists; the quantity is
  unknown.* This is missing data.

Pool those two and every per-animal mean is dragged down by milkings that did happen — which corrupts
precisely the drop-detection this feature exists for. Given the farm's current practice is to measure
only on a noticed drop, `milked_not_measured` will be the **majority state** in the first months, so
getting it wrong is not an edge case.

| Row state | Stored | Means |
|---|---|---|
| measured | `status='measured'`, `yield_litres = N` | the number |
| milked, not measured | `status='milked_not_measured'`, `yield_litres` NULL | milk taken, quantity unknown |
| not milked | `status='not_milked'`, `yield_litres` NULL, `reason` | no milk taken |
| untouched | no row | **blocks save**, naming the animal |

### A partial session must be saveable, and that is not a weakening

Untouched blocks the save, so no animal can be omitted by accident. But `milked_not_measured` is one
keystroke away, so an animal can be omitted **deliberately** and the omission is recorded as one.

If the only way to save were a number, an operator on a session they did not measure would type a
plausible one — the same failure as requiring prose to clear a guard and getting `"yes"`. **A
fabricated yield is worse than a recorded gap**, because a gap is visible to whoever reads the row
later and a fabrication is visible to nobody. This is the same argument as the optional override
reason and as `estimated` dates, and it is why the four states exist rather than a required field.

---

## 5. Session and time

`session` is `'morning' | 'evening'` — a categorical, **not** derived from a clock time. Milking
times move with the season and with who is available; only a window is guaranteed. A stored clock
time would therefore usually be a reconstruction, so `occurred_time` is optional and **never
defaulted**, exactly as it is on events today.

**The consequence, stated so it is not discovered later:** yield depends on the interval since the
previous milking, and with variable times that interval is unknown. So **morning and evening figures
must never be pooled or compared to each other.** They are reported as separate series. A per-animal
*daily total* is legitimate, because it is the sum of a real day. "Morning average versus evening
average" is not a comparison this data supports, and the read models must not offer it.

This is the same discipline as `/check` reporting measured and approximate calving intervals
separately with `n` and a range, and never a pooled mean.

---

## 6. Provenance

- `recorded_by` — the application user, as everywhere else. Unchanged.
- `observed_by` — **the milker.** Two employees usually, occasionally someone else. Set once per
  session in the header, with a per-row override for a session that was split.
- `source_form` — `direct_entry`, which becomes the dominant value for the first time.

The identifier datalist matters more here than anywhere else in the application: thousands of rows
against two or three names, and an `abdul` / `Abdul` / `abdul_r` split would make *"everything Abdul
milked"* permanently unanswerable, with no way to repair it that is not a guess about the past.
`IdentifierInput` and `identifierValues()` already solve this; `identifierValues()` needs extending
to read `registry_milkings.observed_by` alongside the event log.

---

## 7. Schema (migration 3)

```sql
CREATE TABLE registry_milkings (
  id            TEXT PRIMARY KEY,
  animal_id     TEXT NOT NULL REFERENCES registry_animals(id),
  occurred_on   TEXT NOT NULL,          -- farm-local calendar date
  session       TEXT NOT NULL CHECK (session IN ('morning','evening')),
  status        TEXT NOT NULL CHECK (
                  status IN ('measured','milked_not_measured','not_milked')
                ),
  yield_litres  REAL,
  reason        TEXT,                   -- why not milked; NULL otherwise
  occurred_time TEXT,                   -- optional, never defaulted
  observed_by   TEXT,                   -- the milker
  recorded_by   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  -- CORRECTED. This block said `source_form TEXT NOT NULL` with no CHECK for
  -- the whole of this document's life; migration 3 as shipped has one, listing
  -- all five values. The difference is not cosmetic: adding a source_form value
  -- costs TWO check changes, not one, and the other is on
  -- registry_animal_events -- a rebuild of the irreplaceable table. Found while
  -- writing REGISTRY_SALES.md §7, which had reasoned from the cheaper number.
  source_form   TEXT NOT NULL CHECK (
                  source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                ),
  note          TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- The storage convention of §4, enforced at the database rather than trusted
  -- to every caller -- the same three-layer approach as date precision.
  CONSTRAINT measured_has_a_number
    CHECK ((status = 'measured') = (yield_litres IS NOT NULL)),
  CONSTRAINT yield_is_not_negative
    CHECK (yield_litres IS NULL OR yield_litres >= 0),
  CONSTRAINT reason_only_when_not_milked
    CHECK (reason IS NULL OR status = 'not_milked'),

  -- One row per animal per session. This is what makes a session's
  -- completeness a countable fact rather than an interpretation.
  UNIQUE (animal_id, occurred_on, session)
);

CREATE INDEX idx_registry_milkings_animal ON registry_milkings(animal_id, occurred_on);
CREATE INDEX idx_registry_milkings_date   ON registry_milkings(occurred_on, session);
```

**No `lactation_id`** (§2). **Not a projection table** — the rebuild must never touch it, and it must
not appear in `REGISTRY_PROJECTION_TABLES`.

**The `override`-to-column move was NOT bundled in, against the original plan here.** It rebuilds
`registry_animal_events` while this only creates a table, so bundling them would have put two
unrelated schema changes behind one review for no shared work. `REGISTRY_ENTRY_UX.md` §11's rule is
unchanged — do not migrate for it alone — and it now waits for migration 4.

---

## 8. Corrections: update in place, not supersession

The event log is append-only because an event is a **claim about history** with derived consequences —
parity, lactations, pedigree — and because a correction that erased the mistake would erase the fact
that a mistake was made about the past.

A yield is a **measurement**. Nothing is derived from it but aggregates that recompute from scratch,
and a wrong number is a mis-reading rather than a false claim about what happened. Superseding
measurements would double the table over a year for no recoverable information, and would put ~9,000
rows a year through a chain-walk that exists to protect pedigree.

So: **update in place**, refreshing `recorded_at` and `recorded_by`. If an audit trail is ever wanted
it is a separate revisions table; do not build it now, and do not reach for supersession by analogy.

**This implies a DELETE path, and that must be stated rather than discovered.** A whole session
entered against the wrong date is repaired by removing those rows and re-entering them — there is no
superseding event to write, and `UNIQUE (animal_id, occurred_on, session)` means the right date is
free but the wrong one still holds rows. So `registry_milkings` permits `DELETE`, and it is the first
registry table that does.

That is a real divergence from `registry_animal_events`, whose two triggers make deletion impossible,
and it needs to be visible in the schema rather than inferred from the absence of a trigger. It is
justified by the same distinction as the paragraph above — a measurement is not a claim about
history — but the guard that keeps it honest is scope: the delete path is per-row and per-session
from the roster screen, never a bulk statement.

> **"It must never be reachable for any other `registry_*` table" — that clause no longer holds, and
> was struck deliberately rather than quietly.** `registry_dispatches` permits `DELETE` for the same
> reason and with the same narrowness (a date and a session, never a range), and `registry_payments`
> permits it because a payment recorded against the wrong buyer has no other repair — correcting it
> in place would move money between two people's balances without either statement saying so. What
> survives from the original rule is the part that was load-bearing: **scope**. No registry table
> exposes a bulk delete, and the event log still exposes none at all. See
> [REGISTRY_SALES.md §8](REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle).

---

## 9. Screens

### 9.1 `/milking` — the session roster

One screen is one session. The whole feature is this screen; the rest is reading.

**Header.** Date, defaulting to today (§1). Session, inferred from the clock but **shown and
changeable** — the same parse-then-show-back contract as `PrecisionDateControl`, for the same reason:
an inference the operator cannot see is a default by another name. "Milked by", via
`IdentifierInput`.

**Body.** One row per animal with an open lactation. The roster is **derived, not picked** —
`status = 'lactating'` is already exactly this set, and `open_lactation_id` is already on the status
projection. No dropdown, no search, no way to leave an animal out of the list. In the harness herd
that is **6 of 31** (measured). The real herd is around twenty animals, so the roster is a single
screen with no scrolling — but how many of those are in milk at once has not been measured and is
not assumed here.

Each row carries three pieces of context that are free from existing data and do most of the
error-catching:

| Column | Source | Why |
|---|---|---|
| days in milk | `open_lactation.started_on` | the x-axis of every curve later, and the strongest predictor of what to expect now |
| yesterday, **same session** | the previous day's row for this session | a misplaced decimal is obvious against it |
| recent mean, **same session** | trailing measured rows for this session | the per-animal band for the soft guard below |

**Both comparisons are same-session, and that follows from §5 rather than being a
preference.** The first implementation used the chronologically previous milking
and pooled both sessions into the mean — which is exactly what §5 forbids, written
by the same hand a day later. Caught by looking at the rendered screen: an evening
figure sitting beside a morning one makes an ordinary evening read as a collapse,
and the mean it is measured against is an average of two things separated by an
unknown interval. Recorded because the rule was stated clearly and still got
implemented backwards; the check that caught it was rendering the thing, not
re-reading the doc.

**Footer.** Running herd total and a resolved count — "14 of 18". The total catches a ten-fold typo
that no per-row rule will, because the operator knows roughly what the herd gives.

**Keyboard.** Number, Enter, next row. A dozen numbers should be one continuous typing motion; the
post-write contract in `after-write.ts` already sets the standard.

**Soft guard.** A value far from that animal's own recent mean warns, with an override and an optional
reason, reusing `OverrideRecord`. **A warning, never a refusal** — a real collapse in yield is
precisely the row worth having, and refusing it would be the system inventing plausibility.

**Save** is one transaction with an `Idempotency-Key`, like every other write route. A half-saved
session is the failure this needs to be impossible.

### 9.2 `/animals/:id` — the lactation curve

Yield across the open lactation with days-in-milk on the x-axis, previous lactations behind it.
Gaps drawn as gaps, never interpolated — `milked_not_measured` is missing data and a line through it
would be the chart asserting something nobody recorded.

`ng2-charts` 10 and `chart.js` 4.5 are already dependencies, registered in `app.config.ts`, with a
`chart-card` component taking a `dataset`. **No new dependency.**

### 9.3 `/check` — session completeness

Sessions with a complete roster against sessions without, and the measured / not-measured / not-milked
split over a period. Directly parallel to the precision histogram: numbers to read, asserting nothing,
nothing branching on it.

This is the number that says whether a year of data is worth analysing, and it is the only place the
practice change in §1 becomes visible.

---

## 10. Invariants

Numbered continuing from the existing suite; all pure, snapshot in, violations out.

1. **Yield lies inside its lactation.** No milking row dated before its animal's lactation start or
   after its end. Catches the backdated `dry_off`, which will happen.
2. **No milking on an animal with no open lactation** at that date — a milking on a heifer or a dry
   animal is either a wrong animal or a wrong date.
3. **No milking after a departure.** The yield equivalent of invariant 5.
4. **One row per `(animal, date, session)`** — enforced by the UNIQUE constraint, checked here too so
   a historical row written before the constraint is still reported.
5. **Status and yield agree** — `measured` iff `yield_litres` is not null. Enforced by CHECK, checked
   here for the same three-layer reason as the date conventions.

---

## 11. Deferred, with reasons

**Anything derived from yield.** Persistency, projected 305-day totals, expected-versus-actual, feed
conversion. All of them need a season of real rows before their parameters mean anything, and a
number computed from three weeks of data is worse than no number because it looks like a finding.
Revisit after one full lactation is in.

**Bulk tank reconciliation** — comparing the sum of per-animal yields against what actually went into
the tank. This is the strongest available check on measurement quality and it is genuinely valuable,
but it needs a second input the farm does not currently record. Raise it when per-animal entry is
established, not before.

> **Partly answered since.** [REGISTRY_SALES.md](REGISTRY_SALES.md) records what LEAVES the bulk, and
> the sum of that is a second, independent measurement of the same milk — taken by a different person
> for a different reason (money). Not a tank dip, and it does not close this: dispatch measures what
> went out rather than what was there. But it is the same shape of check, and it is built.

**Feed, weight, body condition.** Named in the reserved list. Each is its own table by the §3 rule.
Not step 4.

**Breeding events — and this is the larger gap.** §9 of the entry-UX doc already says it: without
service dates a long calving interval can be observed but never explained. Yield answers *what is
happening*; heat, service and pregnancy check answer *why*. Step 4 is worth doing first because it is
daily and habit-forming, but step 5 is where the analysis the farm actually wants comes from.

---

## 12. Build order

Everything here needs migration 3, so the no-migration claim does not apply and the ordering is by
value rather than by that constraint.

| # | Item | Size |
|---|---|---|
| # | Item | Size | |
|---|---|---|---|
| 7 | Correct the FK claim in `events.ts`, `verify.ts`, `REGISTRY.md` (§2) | XS | **done** |
| 1 | Migration 3: `registry_milkings` (§7) | S | **done** |
| 2 | Write boundary + transactional roster save + idempotency (§7, §9.1) | M | **done** |
| 3 | `/milking` roster screen (§9.1) | M | **done** |
| 4 | Invariants 14–17 (§10) | S | **done** |
| 5 | `/check` completeness section (§9.3) | S | **done** |
| 6 | Lactation curve on `/animals/:id` (§9.2) | S | not built |

Item 7 went first, with or without the rest: it was a wrong claim in three places about a key that
does not hold, and it would have been read as a plan by whoever built this.

**The `override`-to-column move did NOT ride along, and that is a deviation from §7 above.** It is
orthogonal to milk yield, it rebuilds a different table, and bundling it would have put two
unrelated schema changes behind one review. The standing note in `REGISTRY_ENTRY_UX.md` §11 still
holds — do not migrate for it alone — so it now waits for migration 4 rather than migration 3.

---

## 13. Still open

- **Does the roster need a "same as last session" accelerator?** It would make full entry much faster
  and it is exactly how a plausible fabricated number gets one keystroke away. Decide against real
  entry, not in advance.
- **What happens to a session entered for the wrong date.** Update-in-place (§8) means no history, so
  a whole session on the wrong day is a delete-and-re-enter. Acceptable, or does the roster need a
  move?
- **Whether `not_milked` with reason `sick` should also write a `note` event** on the animal, so the
  health story is on the timeline rather than only in the yield table. There is a real seam here and
  it should not be crossed casually.
- **Interval bands for yield**, the equivalent of the calving-interval bands — deferred for the same
  reason: the numbers must come from this farm's data, not from a textbook.
- **Whether the trial's provenance lesson applies here.** The five-animal trial for the backfill
  screens has not run. Its finding about the round trip being the unit of cost, rather than the field
  count, is very likely to apply to a roster of a dozen rows — wait for it before hardening §9.1.

---
