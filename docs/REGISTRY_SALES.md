# Milk sales, home use and the buyer ledger — design decisions

Status: **built.** Migrations 4 and 5, `money.ts`, the three domain modules, thirteen HTTP routes,
invariants 18–22, the `/milk/dispatch`, `/milk/buyers` and `/milk/buyers/:id` screens, the `/check` reconciliation
panel, the fixtures and four read tools all landed together. Server 622 tests, frontend 233 across
24 files *at the time this landed* — counts move; a run is the authority. What is NOT built is §13 and §15; §17 records what building it changed.

Written against `v0.15.0-17-ge53acf3` and, unlike its first revision, **verified by execution** —
the schema is applied to the live database, the screens are rendered, and two of the findings in §17
are things that looked right on the page and were wrong in the data, or the reverse.

**This document covers milk leaving the bulk and the money that follows it.** Per-animal yield is
[REGISTRY_MILKING.md](REGISTRY_MILKING.md); it is the input this reconciles against and is otherwise
untouched. Feed, treatment, weight and breeding are elsewhere and unaffected.

---

## 1. Why this exists, and what changes when it lands

The farm sells milk twice a day to a handful of buyers — **dodhis** who collect and resell, and
neighbouring **households** who buy for themselves — at prices that differ per buyer. Some milk is
kept for the house. None of that is recorded anywhere, and two questions follow from the gap:

- **"What is owed?"** Today it lives in the dodhi's notebook and in somebody's memory. Whoever
  remembers harder wins the disagreement.
- **"Where did the milk go?"** [REGISTRY_MILKING.md](REGISTRY_MILKING.md) landed the production half.
  Without the disposition half, a day's yield is a number with no counterpart, and nothing can tell
  a bad measurement from real spoilage.

What changes when it lands is that both become countable. The second is the one worth building for:
the sum of what left the bulk is a **second, independent measurement of the same milk**, taken by a
different person for a different reason (money), which is the strongest check on measurement quality
available without new equipment. [REGISTRY_MILKING.md §11](REGISTRY_MILKING.md#11-deferred-with-reasons)
deferred bulk-tank reconciliation because it "needs a second input the farm does not currently
record". This is a large part of that input arriving — not a tank dip, but the same shape of check.

### This is not "step 5", and the numbering should not absorb it

The registry's step numbering is about the animal record, and step 5 is breeding events. **These are
the first registry tables with no `animal_id` at all.** Every table in the registry so far hangs off
an animal; these four hang off a counterparty. Filing this as a step would imply it competes with
breeding events for the same slot, and it does not — it is a different axis, and the two can land in
either order.

---

## 2. The finding: this is already implemented, and its money model cannot represent the farm

`vendors` and `deliveries` exist in [db.ts:68-85](../server/src/db.ts#L68-L85), with six agent tools
over them (`list_vendors`, `get_vendor`, `get_deliveries`, `register_vendor`, `record_delivery`,
`mark_delivery_paid`). They are demo fixtures — `seed()` drops and recreates them — and four things
about them are wrong in ways that decide this design rather than merely embarrass the old one.

**1. `vendors` is a misnomer.** A vendor is a supplier. These rows *buy* — the seed fills them with
`Al-Karam Sweets` and `Shezan Dairy Traders` ([seed.ts:167](../server/src/seed.ts#L167)), which are
customers. The word has been wrong since Cycle 2 and has propagated into `shared/src/types.ts`, the
tool names, the dispatcher keywords and the system prompt. **This is the reason the new tables are
named for what they hold and not for the nearest familiar word**, and it is worth stating as a
finding rather than a preference: a name that is nearly right survives a long time before anyone
pays to fix it.

**2. `deliveries.paid INTEGER` cannot express settlement.** It is a per-row boolean. A dodhi who
hands over Rs 40,000 against three weeks of collections is paying against no row in particular, and
there is no combination of flag values that records it. Partial payment, overpayment, an advance,
and a running balance are all unrepresentable — not hard, *unrepresentable*. §5 replaces it with a
ledger for this reason and no other.

**3. `vendors.price_per_litre` is a mutable column.** Change it and the current price is the only
price that ever existed. [OPEN.md](OPEN.md) already carries this as a live item — *"per-delivery
`price_per_litre` capture needs confirming against real data (a later price change must never
rewrite delivery history)"* — so the hazard was seen and deferred, not missed. `deliveries` does
capture the price per row, which is the right half of the answer; what is missing is any record of
what the *agreement* was, which is what §4.2 adds.

**4. `get_yield_vs_deliveries` divides by an incomplete number.**
[reconcile.ts:33](../server/src/tools/reconcile.ts#L33) computes
`discrepancyPct = discrepancyLitres / producedLitres`. Against the demo tables that is fine: every
seeded milking carries a figure. Against `registry_milkings` it is not, because
`milked_not_measured` is a **first-class state that will be the majority state in the first months**
([REGISTRY_MILKING.md §4](REGISTRY_MILKING.md)). `producedLitres` is then a lower bound, the
percentage is computed against a denominator that is too small, and the tool reports a confident
number that is false in a direction nobody would guess. §11 is the replacement, and the reason it is
not simply a repointing.

### What this means for the demo tools

**Nothing, this cycle.** [REGISTRY_TOOLS.md §2](REGISTRY_TOOLS.md) already argues that the demo tool
surface cannot be partially repointed — one tool answering from the record while another answers
from the fixture, in the same turn, with nothing on screen to say which. Six vendor tools plus
`get_yield_vs_deliveries` join the list of things the writes cycle disposes of. The fork widens once
more before it closes, exactly as it did at step 4.

---

## 3. Storage: a disposition, not a sale — and home use is what decided it

The obvious table is `registry_sales`. Home use does not fit in it, and both ways of forcing it are
worse than the rename:

- **A sale at price zero to yourself.** A transaction row with no counterparty and no money, sitting
  in the table the buyer statement is generated from. A lie in the one table that must not contain
  any.
- **A separate `registry_home_use` table.** The same key, the same row states, a second save path, a
  second completeness count, and a reconciliation that sums three tables. Every future disposition —
  calves, spoilage — is then a third table.

The honest generalisation is that the row records **milk leaving the bulk to a destination in a
session**. Selling is the dominant disposition, not the only one, and money is a property of the
destination rather than of the act:

```
registry_destinations         buyers AND home — who milk goes to
registry_destination_prices   effective-dated agreements, billable destinations only
registry_dispatches           one row per (destination, date, session)
registry_payments             the credit half of the ledger
```

**The reason this earns the rename is not tidiness.** Home use becomes a row on the daily sheet that
**blocks the save when untouched**, exactly as an unrecorded animal blocks the milking roster
([REGISTRY_MILKING.md §4](REGISTRY_MILKING.md)). Home use is the most forgettable quantity on a dairy
— it leaves in a jug and nobody writes it down — and at month end it is the whole of the unexplained
difference. A destination row converts it from something an operator has to remember into something
the screen refuses to let them skip. An optional field or a separate screen would have left it
exactly as forgettable as it is now.

Two consequences fall out, and both are load-bearing:

- **The gap gets sharp.** `produced − sold` silently contains home use, so it is large, noisy and
  ignorable. `produced − (sold + home)` is spoilage, calves and measurement error — small enough
  that a change in it means something.
- **Calves and spoilage are a row, not a migration.** When the farm wants to record what the calves
  drink, it is an INSERT into `registry_destinations`. This is why §4.1 does **not** pin the herd to
  a single non-billable destination.

**Do not seed destinations that read zero every day.** A row that is always empty trains people to
stop reading the sheet, which costs more than the category is worth. Add one when it will carry real
numbers.

### The document is named for the dominant case; the tables are named for what they hold

`REGISTRY_SALES.md` describes `registry_dispatches`. That mismatch is deliberate and is the lesser of
two evils: filenames are load-bearing ([README.md § Conventions](README.md#conventions)) and "sales"
is what anyone will search for, while a table named `registry_sales` holding home-use rows would
reproduce the `vendors` mistake in §2 inside the same document that names it.

---

## 4. The data model

### 4.1 Destinations

Identity plus an **active range**, not a status flag. `started_on` is required, `ended_on` nullable.

Membership on a past date is then a range test, which is what lets the sheet open last Tuesday and
show the buyers who were buying **then**. This is the same argument [milking.ts:460](../server/src/registry/milking.ts#L460)
makes for deriving the roster from lactation rows rather than from `registry_animal_status`: a
current-status column answers "who buys now", and the screen needs "who bought then".

`kind` is `dodhi | household | shop | home | other`. `billable` is its own column rather than derived
from `kind`, with a CHECK that `kind = 'home'` implies `billable = 0` — both facts stored, one
constrained by the other, the same three-layer habit as the date conventions.

**Why `billable` is a column and not a filter on `kind`:** [REGISTRY.md](REGISTRY.md) records the
`farm_events.is_synthetic` failure — a discriminator column that exists and that nothing filters on,
whose correctness has therefore never been exercised. The defence here is structural rather than
disciplined: a non-billable destination has **no rows in the price table**, so it cannot produce an
amount, cannot appear in a balance, and cannot be invoiced. The absence of a price row is what makes
home milk unbillable; `billable` merely makes the intent legible and gives invariant 22 something to
check.

Unlike `registry_animals`, a destination row is **amendable in place** — a corrected phone number or
a closing date is an ordinary UPDATE. It is a record, not an event, and nothing is derived from it
but the sheet's membership.

### 4.1a `standing` — the column the farm's answer added, and the `sessions` column it refused

The question put to the farm was whether any buyer takes milk at only one milking, so that a
`sessions` column (`both | morning | evening`) could keep them off the other sheet. The answer was
better than the question:

> the dodhi comes both times, the households can vary. 1 household may take in the morning, the
> other might take in the evening. depends on how much milking animals are in that season and time
> of the month.

**So there is no `sessions` column**, and not because it is unnecessary — because it would be
**fiction**. It would encode a fixed pattern where the real rule is availability, and a column
asserting "this household takes mornings" would be wrong for half the year. This is the same refusal
as never defaulting a date precision: a schema must not state something more definite than what is
known.

What the answer reveals instead is that **the farm has two kinds of buyer, and only one of them is a
roster**:

| | Standing | Occasional |
|---|---|---|
| Here | the dodhi, and home | the two households |
| Every session | yes — the milk goes there or it demonstrably did not | no — they come when there is surplus |
| Untouched on the sheet | **blocks the save** | not on the sheet until they take something |
| A `none` row means | a real non-event: he did not come, nothing was kept | rarely written; absence carries it |

So `registry_destinations` gets `standing INTEGER NOT NULL`, and §12.1's mandatory roster applies to
standing destinations only.

**Why not simply leave the households on the sheet, since `none` is one click?** Because a household
that comes eight days a month would need an explicit "took nothing" on the other fifty-two sessions —
around 1,400 deliberate non-events a year — and [REGISTRY_MILKING.md §4](REGISTRY_MILKING.md)'s
argument for a mandatory roster does not reach them. That argument is that *every animal in milk is a
real expectation*, so her absence is a fact requiring an answer. An occasional household is not an
expectation on a session she was never coming to. Forcing the answer anyway is precisely how a
mandatory field becomes a reflex, and once it is a reflex it stops protecting the dodhi row too.

**The cost, stated rather than discovered: an occasional sale that nobody records is invisible in
this table.** Absence means "did not take", so there is no untouched state to block on. That is a
real hole and it is accepted for one reason — **§11 is the control**. Produced must equal dodhi plus
home plus households plus gap, so an unrecorded household sale does not vanish; it widens the
reconciliation gap, in the same month it happened. This is the first place the reconciliation stops
being a report and starts being load-bearing, and it is an argument for building §11 in the same pass
rather than after.

`standing` is amendable like every other column here. A household that starts coming daily in the
flush is flipped to standing, and flipped back. **Do not derive it from `kind`** — that is the
`billable` argument again, and `kind` describes who they are while `standing` describes how the sheet
treats them.

### 4.2 Prices: effective-dated agreement, captured on the dispatch

#### The rate is quoted per 40 litres, and it is stored that way

**This farm prices in 40-litre lots — "7,000 rupees per 40 litres", not "175 rupees a litre".** The
first draft of this section assumed a per-litre rate throughout and was wrong about the one thing a
price has to get right: what was actually agreed.

So a price is **two columns, not one** — `price_minor` (the amount) and `price_unit_litres` (the
quantity it covers). 7,000 PKR per 40 L is stored as `700000` and `40`, verbatim. The per-litre
figure is derived for display when it is wanted, and it is never what is stored.

**This is `date_precision` applied to money.** Rs 7,000/40 L and Rs 175.00/L are the same rate the way
"March 2024" and "2024-03-01" are the same date — except one of them is what the person actually
said. Normalising to per-litre on entry throws away the agreement and keeps a computation of it.

Three consequences, each of which would have been a defect:

- **Odd rates would not round-trip.** X rupees per 40 L is `X × 2.5` paisa per litre, so any odd
  rupee amount — 7,001 — is not a whole number of paisa per litre. Rates are round in practice, and
  "in practice" is not a storage guarantee.
- **The entry screen would demand mental arithmetic.** An operator who thinks in lots typing a
  per-litre figure divides by 40 every time, and a slip between 17.50 and 175.00 is invisible on a
  form that expects per-litre anyway. §12.2 therefore takes the rate in the farm's unit.
- **The statement would be uncheckable by the person it is for.** "1,840.5 L @ Rs 7,000/40 L" is
  arithmetic the dodhi can follow; "@ Rs 175.00/L" asks him to trust ours. For a document whose
  entire purpose is agreement between two parties, speaking his unit is the point, not a courtesy.

`price_unit_litres` is `NOT NULL` with **no default** — a lot size is a fact about the agreement, and
a silent `1` is how a per-lot rate gets recorded as a per-litre one, off by a factor of forty. A
buyer who genuinely quotes per litre stores `1`, and says so.

**No unit *name* column** (`man`, `maund`, `drum`). "Rs 7,000 / 40 L" is already unambiguous, and a
free-text name would collect `man` / `Man` / `maund` spellings for no gain — the same identifier-drift
argument as §7, applied before rather than after.

> **A different unit basis is out of scope and is a real seam.** The farm's first answer said "per 40
> kg" and was corrected to "per 40 litres". Milk is traded both ways, and a buyer quoting per kg
> would need a density factor rather than another unit row. Not built; recorded so that
> `price_unit_litres` is not quietly reused for a weight.

#### Two layers, because they answer different questions

`registry_destination_prices (destination_id, effective_from, price_minor, price_unit_litres)` is the
**agreement**: a price change is a new row, never an UPDATE to the old one. The price in force on a
date is the latest row at or before it.

The dispatch row carries its own `price_minor` **and its own `price_unit_litres`**, both **copied at
entry time**. The unit travels with the amount because a captured price must be self-contained — a
figure without its lot size is not a price, and re-deriving the unit from the agreement later would
reintroduce exactly the moving lookup this section exists to prevent. The agreement is only the
default. A one-off discount, a rounded cash figure, or an old rate honoured for a week is what
actually happened, and money must never be recomputed from a lookup that can move underneath it.

**The capture is also what makes the agreement table safely mutable.** A price typed wrong and caught
ten seconds later is corrected in place, and because every dispatch already captured its own figure,
correcting the agreement changes only the default offered to *future* entry — it rewrites no history.
That is why `registry_destination_prices` gets no append-only triggers while
`registry_animal_events` has two.

**Quality-based pricing is not built, and this is the seam it would use.** Milk is often bought on
fat or SNF rather than a flat per-litre rate. Asked of the farm before migration 5 was written; the
answer was *flat today, might change*, so `price_minor` is the whole of the price and the schema
above is what ships. If it does change, the shape is a nullable quality reading on the **dispatch**
row (the measurement) plus a rate basis on the **price** row (the agreement) — the same
agreement-versus-capture split this section already draws, applied one level down. It is one
migration and it does not disturb the ledger, which is why building flat now is not a bet.

The case that is not covered by that, stated so it is not discovered later: **a price row corrected
after dispatches have already used the wrong default.** Those rows carry the wrong captured price and
each has to be corrected individually. §11 is how they are found — `/check` reports dispatches whose
captured price differs from the agreement in force, which is a report and not a violation, because a
deliberate discount looks identical and is legitimate.

### 4.3 Dispatches: three row states, not four

| Row state | Stored | Means |
|---|---|---|
| taken | `status='taken'`, `litres = N` | the number |
| none | `status='none'`, `litres` NULL, `reason` | he did not come, or did not want any |
| untouched | no row | **blocks save**, naming the destination |

**There is no `taken_not_measured`, and the asymmetry with milking is the point.** A yield needs its
fourth state because a fabricated number is worse than a recorded gap and nobody is harmed by an
unweighed milking. A dispatch has a counterparty whose money depends on the figure, so an unmeasured
one is not a thing that happens — the litres *is* the transaction. Whoever copies the milking table
to build this will look for the fourth state; this row exists so they find out where it went.

`status`, `litres` and `price_minor` are held in agreement by CHECK constraints, at the write
boundary, and by invariant 19 — the same three layers as the date conventions, for the same reason.

**One rule reaches across tables and therefore gets only two of the three layers:** *a dispatch to a
billable destination captures a price, and a dispatch to a non-billable one does not.* SQLite CHECK
constraints cannot see another table, so this is enforced at the write boundary and by invariant 19,
and **not** by the schema. Said out loud because the pattern everywhere else in the registry is three
layers, and an unexplained two would read as an oversight.

### 4.4 Payments: a ledger, never a flag

```
balance(destination) = Σ amountMinor(litres, price_minor, price_unit_litres)
                         over taken, billable dispatches
                     − Σ amount_minor over payments
```

Positive means they owe the farm. `method` is `cash | bank | adjustment`; `cash` and `bank` are
strictly positive, and **`adjustment` is the only signed kind and must carry a note** — a write-off,
a rounding settlement, or a correction to an opening balance is a decision somebody made, and a
signed number with no sentence attached is unauditable a month later.

**No `paid` column anywhere.** §2 argues why. The balance is derived from two stored facts on every
read and is never cached; a stored balance is a number that can disagree with the rows it came from,
which is [REGISTRY.md](REGISTRY.md) Decision 4's rule applied to money.

### Opening balances

**As it happens, there are none — the farm is square with all three buyers today.** So the ledger
opens at a true zero, every balance it ever shows is the sum of rows it holds, and the first month is
verifiable end to end. That is a better starting position than this section assumed, and it is worth
naming because it will not come round again.

The mechanism stays documented for the case that does arrive — a buyer returning after a lapse, or a
figure agreed outside the system. It is **one `adjustment` payment, signed and dated, with a note
saying what it carries forward** — and **not** a screen, a wizard, or an "opening balance" field on
the destination form. Nothing should be built for it.

That is the `adjustment` kind doing exactly the job it was defined for, rather than a special
`opening_balance` column that would exist for one week and then be dead weight. It also stays honest:
the row is visibly an assertion somebody made rather than a sum of transactions, which is what a
carried-forward figure is. **A wrong one is corrected by a second adjustment, never by editing the
first** — the first is what the buyer agreed to, and overwriting it would erase the fact that the two
of you ever disagreed.

---

## 5. Money: integer minor units, and nothing stored that can be derived

**Money is `INTEGER` paisa. Never `REAL`.** `deliveries.price_per_litre REAL`
([db.ts:81](../server/src/db.ts#L81)) is the counterexample already in the repo. `litres` stays
`REAL` — it is a measurement, and its imprecision is honest.

**`amount` is never stored.** It is derived from three stored facts — litres, the rate, and the lot
size the rate covers (§4.2) — so it cannot drift from them. One rounding rule, in one pure module:

```
registry/money.ts   (pure — no ../db, no clock)
  MINOR_PER_UNIT = 100
  amountMinor(litres, priceMinor, unitLitres): number
      Math.round(litres * priceMinor / unitLitres)
  formatMinor(minor): string        "Rs 1,234.50"
  formatRate(priceMinor, unitLitres): string
      "Rs 7,000 / 40 L"   — the agreement, in the unit it was struck in
```

Worked, because a factor-of-forty error is the one this module exists to prevent: 12.5 L at Rs 7,000
per 40 L is `12.5 × 700000 / 40` = `218750` paisa = **Rs 2,187.50**.

Rounding happens exactly once, at the boundary between a measurement and money, and half-up because
that is what `Math.round` does for positive values and an undocumented convention is worse than a
plain one. **`unitLitres` is a parameter with no default.** A default of 1 would make every
forgotten argument a fortyfold overcharge that still looks like a price.

**The client duplicates the rule, and a test asserts they agree.** The dispatch sheet needs a live
running total as numbers are typed, so the browser has to compute an amount before the server sees
one. That is a genuine duplication with a drift risk, and the repo has the precedent for handling it:
`compareEvents()` in [project.ts:94](../server/src/registry/project.ts#L94) reimplements the SQL
canonical order for the pure core, and a test asserts the two agree on real rows. Same arrangement
here — the server's figure is authoritative, the client's is provisional, and a spec pins them
together on a fixture.

---

## 6. Session and time

**A dispatch is per session, confirmed against the farm: the dodhi collects morning and evening.**
This was the one open question in the plan that preceded this document, flagged as expensive to
reverse, and it is settled by the farm rather than by taste. `UNIQUE (destination_id, occurred_on,
session)` follows, and with it the same property the milking roster has — completeness is a countable
fact rather than an interpretation.

**Summing a session's bulk against that session's dispatches is legitimate, and this is not a
loophole in [REGISTRY_MILKING.md §5](REGISTRY_MILKING.md).** That rule forbids comparing one animal's
morning figure to her evening figure, because the interval between milkings is unknown and the two
are not the same kind of quantity. Comparing a session's total production to that session's total
dispatch compares two counts of **the same milk**. Different operation. Written down here because the
rule is stated forcefully enough that someone will read this as violating it.

`occurred_time` is optional and never defaulted, as everywhere else.

---

## 7. Provenance

The same four columns: `recorded_by` (NOT NULL), `recorded_at`, `source_form`, `observed_by`.
`observed_by` on a dispatch is **who handed the milk over** — the counterpart of the milker.

**`source_form` gains no new value, and there is a concrete reason.** A dodhi's khata is not one of
`daily_herd_sheet | cycle_card | direct_entry | import | recall`, and adding `sale_book` would mean
widening a CHECK on `registry_animal_events`, which is a create-copy-drop-rename rebuild of the one
irreplaceable table, for a label. Khata entry is `direct_entry`, and the notebook page goes in `note`.

> **A staleness finding, recorded because it changes the cost above.**
> [REGISTRY_MILKING.md §7](REGISTRY_MILKING.md#7-schema-migration-3)'s schema block shows
> `source_form TEXT NOT NULL` with no CHECK. The shipped migration 3
> ([schema.ts:375](../server/src/registry/schema.ts#L375)) *does* have one, listing all five values.
> So a new `source_form` value costs two CHECK changes, not one, and the cheaper-looking answer in
> the doc is not available. The doc is stale; the code is right.

**`identifierValues()` must learn about dispatches.** [reads.ts:197](../server/src/registry/reads.ts#L197)
already reads `registry_milkings.observed_by` alongside the event log, with a comment explaining
exactly why: thousands of rows against two or three names, and `imran` / `Imran` becoming two people
is unrepairable after the fact. Dispatch rows are the same shape and the same volume. Forgetting this
is silent and permanent.

---

## 8. Corrections: the one question this document does not settle

[REGISTRY_MILKING.md §8](REGISTRY_MILKING.md#8-corrections-update-in-place-not-supersession) permits
update-in-place on `registry_milkings` because *a measurement is not a claim about history* and
*nothing is derived from it*. **Neither clause holds here.** Money is derived from a dispatch row, and
a disputed balance is settled by pointing at the record. "Why is my total different from last week?"
is a question with a counterparty attached.

Two candidate answers, with the recommendation first:

**(a) Update in place, plus `registry_sale_revisions`, written in the same transaction.** The old row
is copied before every UPDATE. This is precisely the shape §8 named as the escape hatch — *"if an
audit trail is ever wanted it is a separate revisions table; do not build it now, and do not reach
for supersession by analogy"* — so it extends the existing reasoning rather than contradicting it.
Volume is trivial: a handful of destinations twice a day.

**(b) Freeze on settlement.** A dispatch row included in a settled statement becomes immutable, and
corrections after that point are `adjustment` payments. This is how real ledgers work and it is more
correct, but it needs a settlement concept — a "close the books to date D" act.

**And that act is not hypothetical here, which is a change from this section's first draft.** A
closing already exists in practice, so (b) describes something the farm does rather than a mechanism
the software would invent.

**But it is not one cadence, and that is the part that matters.** The farm's own words: payment is
*"at the end of the month usually, or if it's short stint of a few days, then at the end of last
date."* So the dodhi settles monthly and an occasional household settles when their run ends — the
same standing-versus-occasional split as §4.1a, showing up again in the money. A stored settlement
period would therefore have to be per-destination and per-run, not a calendar month, and **a
`month` column would be wrong for two of the three buyers.** That is an argument for (a) now and a
warning about how (b) must be shaped if it is ever built: the period is a property of an agreement
between two people, not of the calendar.

**Recommendation is still (a) first, and now for a sharper reason than "decide later".** Everything
(b) needs, (a) records: which row changed, to what, when, and by whom. Building (a) is therefore a
step *toward* (b) and not away from it, and it can be built before anyone has to define what
"settled" means, who declares it, and what happens to a month reopened by a disagreement — three
questions with no answers yet. Build (a); expect (b); do not model a settlement period until the
first month has actually been settled and the reopening question has a real answer.

Payments follow whichever rule dispatches get. Do not split them.

**A DELETE path is implied and must be stated rather than discovered**, exactly as it was for
milkings: a whole session entered against the wrong date is repaired by removing those rows and
re-entering them, because `UNIQUE (destination_id, occurred_on, session)` means the wrong date keeps
holding rows. It stays as narrow as the milking one — a date and a session, never a range, never a
bulk statement — and it must never become reachable for a payment row, where deletion would erase
money somebody handed over.

---

## 9. Schema

### Migration 4 — the `override` move, alone

[REGISTRY_ENTRY_UX.md:1198](REGISTRY_ENTRY_UX.md) carries a standing instruction: the `override`
record belongs in a column rather than the payload, **do not migrate for it alone**, bundle it into
whichever migration lands next. This is that moment, and it goes as **its own migration** rather than
riding along with §9's tables — it is `rebuildsTables: true` on `registry_animal_events`, and putting
a foreign-keys-off table rebuild behind the same review as four plain CREATEs is what
[REGISTRY.md](REGISTRY.md) refused twice already at migration 3.

`MIGRATIONS` is three entries at the commit named above ([schema.ts:430](../server/src/registry/schema.ts#L430)),
so these are 4 and 5.

### Migration 5 — the four tables

```sql
CREATE TABLE registry_destinations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('dodhi','household','shop','home','other')),
  billable    INTEGER NOT NULL CHECK (billable IN (0,1)),
  -- Section 4.1a. Standing destinations are on every sheet and block the save
  -- when untouched; occasional ones appear only when they took something.
  -- NOT derived from `kind`: kind is who they are, standing is how the sheet
  -- treats them, and a household moves between the two with the season.
  standing    INTEGER NOT NULL CHECK (standing IN (0,1)),
  contact     TEXT,
  started_on  TEXT NOT NULL,
  ended_on    TEXT,                    -- NULL = still buying
  note        TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,

  CONSTRAINT started_on_is_a_date
    CHECK (started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT ended_on_is_a_date
    CHECK (ended_on IS NULL OR ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT the_range_runs_forwards
    CHECK (ended_on IS NULL OR ended_on >= started_on),
  -- Home milk is never billed, and that is structural rather than a habit.
  CONSTRAINT home_is_never_billable
    CHECK (kind <> 'home' OR billable = 0)
);

-- NO unique index pinning a single non-billable destination. Splitting home use
-- into household and staff milk, or adding calves, must not cost a migration --
-- see section 3.

CREATE TABLE registry_destination_prices (
  id             TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES registry_destinations(id),
  effective_from TEXT NOT NULL,
  -- The rate AS QUOTED, and the lot it covers (section 4.2). Rs 7,000 per 40 L
  -- is (700000, 40). NOT normalised to per-litre: odd rupee amounts do not
  -- round-trip, and the statement has to show the dodhi the rate he agreed to.
  price_minor       INTEGER NOT NULL CHECK (price_minor >= 0),
  price_unit_litres REAL    NOT NULL CHECK (price_unit_litres > 0),
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  note           TEXT,

  CONSTRAINT effective_from_is_a_date
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- One agreement per destination per day. A second price on the same date is
  -- not a price change, it is a typo -- and the ambiguity would be silent.
  CONSTRAINT one_price_per_destination_per_day
    UNIQUE (destination_id, effective_from)
);
CREATE INDEX idx_registry_destination_prices_dest
  ON registry_destination_prices(destination_id, effective_from);

CREATE TABLE registry_dispatches (
  id             TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES registry_destinations(id),
  occurred_on    TEXT NOT NULL,          -- farm-local calendar date
  session        TEXT NOT NULL CHECK (session IN ('morning','evening')),
  status         TEXT NOT NULL CHECK (status IN ('taken','none')),
  litres         REAL,
  -- Captured, not looked up -- and the LOT SIZE travels with the amount, because
  -- a figure without its unit is not a price (section 4.2).
  price_minor       INTEGER,
  price_unit_litres REAL,
  reason         TEXT,                   -- why nothing was taken; NULL otherwise
  occurred_time  TEXT,                   -- optional, never defaulted
  observed_by    TEXT,                   -- who handed the milk over
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  source_form    TEXT NOT NULL CHECK (
                   source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                 ),
  note           TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT occurred_time_is_hh_mm
    CHECK (occurred_time IS NULL OR occurred_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  CONSTRAINT taken_has_litres
    CHECK ((status = 'taken') = (litres IS NOT NULL)),
  CONSTRAINT litres_is_not_negative
    CHECK (litres IS NULL OR litres >= 0),
  CONSTRAINT reason_only_when_none
    CHECK (reason IS NULL OR status = 'none'),
  CONSTRAINT price_only_when_taken
    CHECK (price_minor IS NULL OR status = 'taken'),
  CONSTRAINT price_is_not_negative
    CHECK (price_minor IS NULL OR price_minor >= 0),
  -- Both halves of a price or neither. A rate with no lot size is unpriceable
  -- and a lot size with no rate is meaningless.
  CONSTRAINT a_price_is_both_halves
    CHECK ((price_minor IS NULL) = (price_unit_litres IS NULL)),
  CONSTRAINT price_unit_is_positive
    CHECK (price_unit_litres IS NULL OR price_unit_litres > 0),
  -- Section 6. What makes a session's completeness countable.
  CONSTRAINT one_row_per_destination_per_session
    UNIQUE (destination_id, occurred_on, session)
);
CREATE INDEX idx_registry_dispatches_dest ON registry_dispatches(destination_id, occurred_on);
CREATE INDEX idx_registry_dispatches_date ON registry_dispatches(occurred_on, session);

CREATE TABLE registry_payments (
  id             TEXT PRIMARY KEY,
  destination_id TEXT NOT NULL REFERENCES registry_destinations(id),
  occurred_on    TEXT NOT NULL,
  amount_minor   INTEGER NOT NULL,
  method         TEXT NOT NULL CHECK (method IN ('cash','bank','adjustment')),
  reference      TEXT,                   -- cheque no., transfer ref, khata page
  observed_by    TEXT,                   -- who took the money
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  note           TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Only an adjustment may be signed, and it must say why. A signed number with
  -- no sentence attached is unauditable a month later.
  CONSTRAINT cash_and_bank_are_positive
    CHECK (method = 'adjustment' OR amount_minor > 0),
  CONSTRAINT an_adjustment_explains_itself
    CHECK (method <> 'adjustment'
           OR (amount_minor <> 0 AND note IS NOT NULL AND length(trim(note)) > 0))
);
CREATE INDEX idx_registry_payments_dest ON registry_payments(destination_id, occurred_on);
```

**All four are records; none is a projection.** They go in `REGISTRY_TABLES` and stay out of
`REGISTRY_PROJECTION_TABLES`, by the test that decides the question: nothing in them is derivable
from the event log. The rebuild must never touch them. Because
[backup.ts:90](../server/src/registry/backup.ts#L90) computes `SOURCE_OF_TRUTH_TABLES` as
`REGISTRY_TABLES` minus the projections rather than listing it, **they are backed up with nothing to
remember** — which is that design paying for itself for the first time.

Ids are `dst_` / `prc_` / `dsp_` / `pay_` plus a full `randomUUID()`, following `mlk_` and the
argument in [REGISTRY.md](REGISTRY.md) Decision 5 against 8 hex characters.

---

## 10. Modules

The split follows the pure core / DB shell rule. `milking.ts` is deliberately one module for one
feature; this is four tables, two write surfaces and a ledger, so it is four:

| Module | Role |
|---|---|
| `money.ts` | **pure** — minor units, the one rounding rule, formatting |
| `destinations.ts` | DB shell — destinations and prices, write boundary and reads |
| `dispatch.ts` | DB shell + pure core — the sheet write, the roster read model, the completeness report |
| `ledger.ts` | DB shell — payments, balance, the statement read model |

Every function takes an explicit `db` handle. The reconciliation of §11 is **pure** and lives in
`dispatch.ts`: rows in, report out, no handle — the same arrangement as `milkingReport()`, so it runs
in CI against fixtures and against the live database from `verify:registry`.

### Routes

Added to `registryRouter(db)`, all writes carrying `Idempotency-Key`:

```
GET  /destinations                       list, with the price in force today
POST /destinations                       (key)
GET  /destinations/:id                   the statement: dispatches, payments, running balance
POST /destinations/:id/prices            (key)  one destination
POST /prices                             (key)  batch change, effective from a date
GET  /dispatch/sheet?on=&session=         the derived sheet
POST /dispatch/session                   (key)  all rows or none
POST /dispatch/session/delete            (key)  narrow, per section 8
POST /payments                           (key)
GET  /reconcile?from=&to=                section 11
```

> [routes.ts:35](../server/src/registry/routes.ts#L35) enumerates the keyed write routes — *"Six of
> them: POST /animals, /events, /calvings, /calvings/:id/correction, /milking/session and
> /milking/session/delete"*. That comment already survived one undercount (it used to say "three")
> and will silently become wrong again here. Update it in the same commit.

---

## 11. Reconciliation — the number this feature exists to make honest

This replaces `get_yield_vs_deliveries` for the registry. It does not repoint it; §2.4 is why.

```
produced_measured    Σ yield_litres where status = 'measured'
not_measured_rows    count where status = 'milked_not_measured'
not_milked_rows      count where status = 'not_milked'
expected_rows        animals with a lactation covering the date
missing_rows         expected_rows − recorded_rows

dispatched_sold      Σ litres over taken dispatches to billable destinations
dispatched_home      Σ litres over taken dispatches to non-billable destinations
dispatched_total     sold + home
untouched_rows       active destinations with no row

gap_litres           produced_measured − dispatched_total
```

**`gap_pct` is `null` whenever `not_measured_rows > 0` or `missing_rows > 0`, and a
`gap_pct_withheld_because` field says which.**

This escalates past `milkingReport()`'s caveat-as-a-field, on purpose. A caveat can be dropped by a
consumer; a `null` cannot be quoted. The escalation is justified by the audience: this number ends up
in front of a dodhi, and a percentage computed against a denominator that is quietly a lower bound is
the exact failure §2.4 found in the code this replaces.

**This section is a control, not only a report, and §4.1a is why.** Occasional destinations have no
untouched state, so a household sale nobody wrote down leaves no hole in `registry_dispatches` to
find. The gap is the only place it surfaces. That raises the stakes on this section from "a number to
read" to "the one thing that catches an unbilled sale", and it is the reason item 7 must not be
allowed to slip past items 4 and 5 in the build order.

It also means the gap has **two populations mixed into it** — unmeasured production (§11's first
half) and unrecorded occasional sales — pulling it in opposite directions. They cannot be separated
from the data, so do not try: report the gap, report the not-measured count, and let a person read
both. A single "efficiency" figure computed from them would be two unknowns dressed as one answer.

**A negative gap is the normal state early on, and must not be styled as an alert.** More milk going
out than was recorded as produced is what `milked_not_measured` *means* — the milk existed, nobody
weighed it. An alert on a negative gap would fire every day for months and be trained away, taking
the real signal with it. Report the number, report the not-measured count beside it, assert nothing.

**Also reported, and also asserting nothing:** dispatches whose captured `price_minor` differs from
the agreement in force on that date. A deliberate discount and a stale default look identical from
here, so this is a list to read, never a violation. It is how §4.2's uncovered case gets found.

`/check` gets this as a section, directly parallel to the precision histogram and the milking
completeness panel.

---

## 12. Screens

### 12.1 `/milk/dispatch` — the daily sheet

The whole feature is this screen; the rest is reading. A sibling of
[milking-roster.ts](../web-angular/src/app/registry/milking-roster.ts), and it should feel like the
same motion, because it is done by the same person minutes later.

**Header.** Date defaulting to today, session inferred from the clock but shown and changeable,
"handed over by" via `IdentifierInput`.

**Body, in two parts, per §4.1a.**

*Standing destinations* — the dodhi and home — are one row each, derived and never picked. Litres, or
`none` with an optional reason. Untouched blocks the save. Each row carries the same session
yesterday and the price in force, so a wrong-destination entry is visible before it is saved.

*Occasional destinations* — the households — are **not rows until they took something.** They sit
below the standing block as one line each, and adding one is a single click that turns it into a row
with the same fields. Nothing is required of them, because on most sessions they were never coming.

The visual order is not cosmetic: everything above the divider must be answered, nothing below it
must. An operator should be able to see whether the sheet is saveable without reading it.

**Footer, and this is the part that earns its place:** litres out, amount billed, "6 of 6" — beside
**this session's measured production and its not-measured count**. That puts the reconciliation in
front of the operator at the moment it is cheapest to fix, and it makes the two sheets reinforce each
other: entering dispatch is what makes the holes in milking visible. Showing the not-measured count
alongside the difference is what stops it reading as an alarm.

**Save** is one transaction with an `Idempotency-Key`. A half-saved session is the failure this must
make impossible.

**There is no backfill mode, and that is a decision rather than an omission.** Asked of the farm
before the build: enter the khata's history, or start from the day it lands? The answer was **start
from today**. So the sheet's date control — today by default, changeable to catch a missed session —
is the whole of the date story, and none of the transcription apparatus the animal backfill needed
(`recall` provenance, precision, a per-buyer card layout) is built here. The history that already
exists arrives as an opening balance instead (§4.4).

Recorded because the alternative was considered and priced, not overlooked: without this note the
absence of a backfill path reads as a gap, and somebody eventually builds one nobody asked for.

### 12.2 `/milk/buyers` — destinations and prices

The list, with each destination's current price, and a per-destination price change effective from a
date. Non-billable destinations appear with no price and no price control.

**The price control takes the rate in the farm's unit — an amount and the litres it covers — and
never a per-litre figure.** Two inputs side by side, reading `Rs [7000] per [40] litres`, with the
derived per-litre rate shown back underneath as a check the operator can read but not type. That is
the same parse-then-show-back contract as `PrecisionDateControl`, for the same reason: the operator
enters what they know, the system shows what it understood, and the difference between the two is
where a factor-of-forty error becomes visible instead of silent.

**The batch price change was cut from the first pass**, and the reason is a measurement rather than a
preference. It was justified here as "a seasonal rise moves every dodhi at once, and per-buyer
editing would make that five forms and four chances to miss one" — written before the farm was
counted. **The farm has one dodhi and two households.** Three forms and two chances to miss one, and
the wholesale and retail rates do not move together anyway, so the batch screen would mostly be used
to change one row. Build it if the buyer list grows past about six, or if a single rise is ever
observed moving every rate at once.

### 12.3 `/milk/buyers/:id` — the statement

Dispatches, payments, running balance, price history. This is the screen you hand to a dodhi, which
is the whole reason §8 is unsettled rather than copied from milking. The payment form lives here
rather than on a route of its own — a payment is always *from someone*, and a standalone form would
start with a dropdown that this screen has already answered.

**Grouped by calendar month, with a subtotal per month, because the farm settles monthly.** That is
the fact that shapes this screen and it was not known when the first draft of this section was
written. A month between payments is around sixty dispatch rows per buyer, and a flat list of sixty
rows is not a thing anyone hands over. What gets handed over is one line —

```
September   1,840.5 L  @ Rs 7,000/40 L    Rs 321,875    paid Rs 321,875    settled
```

— with the rows underneath it for anyone who wants to check. The daily detail is the evidence; the
monthly line is the artifact.

**The rate is printed as it was agreed, per §4.2** — `Rs 7,000/40 L`, not `Rs 175.00/L`. The line has
to be arithmetic the buyer can do in his head against his own khata, and converting his rate into
ours is the one edit that would stop him being able to.

**The month is a display grouping and nothing more.** No stored period, no closing flag, no row that
says "September". The subtotals are computed from the dispatch and payment rows on every read, for
the same reason the balance is (§4.4): a stored monthly total is a cached number that can disagree
with the rows it came from. §8 is where that would change, and it should change deliberately.

### 12.4 Navigation pressure, noted rather than solved

> **Resolved by the labour cycle.** The grouping was made rather than deferred a fourth time — see
> [REGISTRY_PAYROLL.md §12.3](REGISTRY_PAYROLL.md#123-navigation-and-url-structure--the-change-that-forced-both-decisions),
> which also restructured the URLs. The paragraph below is what was true at
> `v0.15.0`; the counts in it are historical.

The shell nav is five items ([registry-shell.ts](../web-angular/src/app/registry/registry-shell.ts));
this makes it seven. That is over the line where a flat row stops working, and the grouping decision
— probably *record* versus *review* — is real but should be made when the seventh item exists and not
predicted now.

---

## 13. Invariants 18–22

Numbered continuing from the milking block at
[invariants.ts:578](../server/src/registry/invariants.ts#L578); all pure, snapshot in, violations out.
`RegistrySnapshot` and `snapshot()` gain the four tables, or `/check` verifies nothing about them.

18. **One row per `(destination, date, session)`.** Enforced by UNIQUE, checked here so a row written
    before the constraint existed is still reported.
19. **Status, litres and price agree.** `taken` iff `litres` is not null; a captured price iff the
    destination is billable **and** the row is `taken`; and a captured price is **both** halves —
    amount and lot size — never one (§4.2). The cross-table half of this is the rule §4.3 says the
    schema cannot reach.
20. **Nothing outside a destination's active range.** No dispatch and no payment dated before
    `started_on` or after `ended_on`. The counterparty equivalent of invariant 5.
21. **Prices are unambiguous and present.** No two price rows share a `(destination_id,
    effective_from)`, and every billable destination that dispatched on a date has a price in force
    on that date.
22. **Nothing bills a non-billable destination.** No price row and no payment row references one, and
    only `adjustment` payments are signed.

**"Dispatches on a day with no milking rows" is deliberately not an invariant.** It would fire on
every day of the backfill and on every day the milking sheet is skipped, which is many of them. It is
a §11 report line.

---

## 14. Build order

Everything needs migration 5, so ordering is by value rather than by that constraint. **Items 2
through 5 ship together or not at all** — see §15's first entry.

**Item 7 belongs inside that set too, and it is the one most likely to be deferred as polish.** Once
occasional destinations have no untouched state (§4.1a), the reconciliation is the only thing that
can surface a household sale nobody recorded. Shipping items 4 and 5 without it means running the
ledger for a month with the one control switched off — and a month is exactly how long it takes for
the first missing sale to become an argument.

| # | Item | Size | |
|---|---|---|---|
| 1 | Migration 4: `override` to a column (§9), alone | S | **done** |
| 2 | Migration 5: four tables + `money.ts` (§5, §9) | S | **done** |
| 3 | Destinations + effective-dated prices: write boundary, `/milk/buyers` (no batch change — §12.2) | M | **done** |
| 4 | `/milk/dispatch` sheet: transactional save, idempotency, the derived roster | M | **done** |
| 5 | Payments, balance, `/milk/buyers/:id` statement | M | **done** |
| 6 | Invariants 18–22 (§13) | S | **done** |
| 7 | `/check` completeness + reconciliation (§11) | S | **done** |
| 8 | Fixtures: dispatches **and milkings** (see below) | S | **done** |
| 9 | Read-only agent tools: `list_buyers`, `get_buyer_balance`, `get_dispatches`, `get_milk_reconciliation` | M | **done** |

**Item 8 is synthetic and must stay that way.** Fixture destinations get invented names and
invented rates. Not because real ones are unavailable — because the standing rule for this cycle is
that nothing synthetic touches `dairy.db` and the harness serves `:memory:`, which cuts both ways:
real buyers belong in the live database via §12.2's screen, entered by the farm, and never in a
fixture file that a test can load. The screens are the deliverable; the data is the farm's.

**Item 8 also closes a recorded gap as a side effect.** [fixtures.ts](../server/src/registry/fixtures.ts)
contains **zero milking rows** — verified at the commit above, and the reason
[REGISTRY_TOOLS.md](REGISTRY_TOOLS.md) defers `get_milking_record`. Dispatch fixtures without milking
fixtures would leave §11's reconciliation with nothing to reconcile, so both get built, and
`get_milking_record` becomes buildable.

**Item 9 follows [REGISTRY_TOOLS.md](REGISTRY_TOOLS.md) Decision 1: reads only.** Write tools are a
writes-cycle decision, and a second entry path competing with a screen under measurement contaminates
the reading.

---

## 15. Still open

- **Do not ship dispatches without payments.** Items 2–4 alone produce a total that only ever grows,
  and anything labelling it "owed" would be false. They are two migrations but one cycle, and this is
  the sequencing risk most likely to be taken on its own because item 4 is the satisfying half.
- **The corrections model (§8)** — update-in-place plus a revisions table, or freeze-on-settlement.
  Recommended (a); decide against the first real dispute.
- ~~**Does home use split?**~~ **Answered.** It does. The farm allocates a milk portion to staff as
  part of the salary arrangement, so household milk and staff milk are different facts and the second
  is a cost of labour. §9's schema was right that adding a destination is an INSERT — but wrong that
  it costs no migration at all: `kind` has no `staff` value and nothing links a destination to a
  person, and one shared row cannot say whose milk it was, because the dispatch key is one row per
  destination per session. See [REGISTRY_PAYROLL.md §4.6a](REGISTRY_PAYROLL.md#46a-milk-as-part-of-the-package--one-destination-per-staff-member)
  and its migration 7.
- **Should home use be valued?** Litres is a fact; a rupee figure needs a reference price with no
  transaction behind it. Deferred until somebody asks what the household is costing — and if it is
  built, it is an imputed figure in a report, never a row in the ledger.
- **Advances.** A dodhi paying ahead makes the balance negative, which the ledger handles with no
  special case. Whether the statement should *say* "in credit" rather than showing a minus sign is a
  wording question for the first time it happens.
- **Whether the dispatch sheet and the milking roster should become one screen.** They are the same
  motion by the same person minutes apart. Do not merge them now — the footer link in §12.1 is the
  cheap version of the idea, and merging before either has been used for a month would be designing
  from symmetry rather than from use.

---

## 16. An incidental finding, unrelated to sales but blocking §13 — **fixed**

[invariants.ts](../server/src/registry/invariants.ts) contained **two literal NUL bytes** — a `\0`
map-key separator typed as a raw character rather than an escape. It was the only tracked `.ts` file
in the repo that contained one.

The consequence was that `grep` and `git grep` classified the file as binary and **skipped it
silently** — no match, no error. That mattered more here than it would in most repos: invariant 13 is
itself a source-text check, `registry.harness.test.ts` asserts on source text, and §13 adds five
invariants to this exact file. Anyone grepping `invariants.ts` for them would have concluded they
were not there.

Fixed before item 6, as one character: the raw byte became the `\0` escape, which compiles to the
same string. Verified by `file` reporting UTF-8 text where it previously said `data`, and by a node
one-liner confirming the key is byte-identical.

---

## 17. What building it changed

Seven things the design got wrong or left unsaid. Recorded because a plan that
survives contact unamended usually means nobody checked.

### 17.1 The two that only rendering could find

**The fixture stopped four days before the harness's today, and every screen was correctly empty.**
`tradingHerd()` ended at the frozen `AS_OF` while the harness reads the real clock, so `/milk/dispatch`
opened onto a session with no data: no yesterday column, no production, an empty footer. Nothing was
broken and everything looked broken — the worst kind of fixture, because the instinct is to go
debugging the screen. `lastOn` is now a parameter defaulting to `AS_OF` (tests need frozen dates)
with the harness passing `farmToday()`. **Found by opening the page, not by reading the code.**

**The dodhi was taking more milk than the herd produced.** The first fixture had him on 30–39 L a
session against a herd of three animals giving about 22, which reconciled to a gap of −454 L over two
weeks. Every number on the reconciliation panel was computed correctly from data that could not
happen. Scaled to 12–17.9 L, the gap is now +21 L over two weeks — the right order of magnitude for
spoilage and calves, and small enough that a change in it would mean something. **Found by reading
the reconciliation output, which is the thing the reconciliation is for.**

Both are the lesson [REGISTRY_MILKING.md §9.1](REGISTRY_MILKING.md) already recorded about the
same-session comparison: *the check that caught it was rendering the thing, not re-reading the doc.*

### 17.2 SQLite names a violated CHECK and does not name a violated UNIQUE

A named CHECK surfaces as `CHECK constraint failed: one_row_per_destination_per_session`. A named
UNIQUE surfaces as `UNIQUE constraint failed: registry_dispatches.destination_id, ...` — **the
constraint name is not in the message at all.**

That is why the write boundary produces its own refusal for every uniqueness rule rather than letting
the database's message reach an operator, and it is asserted in `registry.money.test.ts` so the next
person does not spend the same twenty minutes on it.

### 17.3 Adding the sales modules introduced a require cycle, and the fix moved two functions

`snapshot()` needs the dispatch and payment rows; `ledger.ts` reaches `dispatch.ts` → `milking.ts` →
back to `store.ts`. The cycle resolved at runtime (CommonJS live bindings, and nothing calls across
it at module load) and every test passed — which is exactly why it is worth naming: it would have sat
there until something moved a call to the top level.

`allDispatches()` and `allPayments()` are plain SELECTs and now live in `store.ts` beside
`allMilkings()`, which is what they are. The import graph is acyclic and a scan for cycles is cheap
enough to re-run.

### 17.4 A backtick inside a template literal, twice

Migration 5's SQL is a template literal, and three SQL comments quoted identifiers as
`` `sessions` ``, `` `milked_not_measured` ``, `` `paid` `` — terminating the literal and producing
three baffling TypeScript syntax errors a hundred lines away. The identical mistake then happened in
an Angular component template quoting `` `milked_not_measured` `` in an HTML comment.

Both were prose about the code, inside the code, using the punctuation the code reserves. Worth a
line here because the failure looks nothing like its cause.

### 17.5 `milking.ts` was never in the harness's no-database list

`registry.harness.test.ts` enumerates the modules that must not import `../db`. `milking.ts` was
missing from it — not because it reaches the singleton (it does not) but because the list is
maintained by hand and step 4 did not add to it. Adding the four sales modules is what surfaced the
gap. All five are in it now, and the enumeration remains the weakness: a list of files kept in step
with a directory by memory.

### 17.6 Migration 4 had to rewrite payloads in JavaScript, not with `json_remove()`

The rebuild-diff compares stored payload TEXT, so a payload rewritten by SQLite's JSON functions must
be byte-identical to what `appendEvent` would produce — an assumption, not a guarantee. And a
migration must be frozen: calling the live `stableStringify` would mean a future edit to that helper
silently changing what migration 4 did to databases migrated after the edit.

So the serializer is **inlined into the migration**, with a comment forbidding its replacement by an
import, and a test asserts the rewritten payload has sorted keys.

### 17.7 The doc was stale about `source_form` before this cycle started

[REGISTRY_MILKING.md §7](REGISTRY_MILKING.md)'s schema block shows `source_form TEXT NOT NULL` with
no CHECK. Migration 3 as shipped has one. That changed the cost of §7's decision here — adding a
`source_form` value costs two CHECK changes, not one, and one of them rebuilds the irreplaceable
table — so the cheaper-looking answer the doc implied was never available. Corrected in that document.

