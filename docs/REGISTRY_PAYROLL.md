# Labour: people, engagements, packages and the wage ledger — design decisions

Status: **built.** Migrations 6 and 7, `people.ts`, `payroll.ts`, `wages.ts`, `overview.ts`,
fourteen HTTP routes, invariants 23–28 and four report lines, the `/labour/payroll`,
`/labour/people` and `/labour/people/:id` screens, the `/check` panel and the fixtures. The same
cycle also made two decisions this feature forced rather than caused: the URL structure and the
landing page (§12.3–§12.6). Server 726 tests, frontend 281 across 26 files *at the time this
landed* — counts move; a run is the authority. What is NOT built is §11
and §15; §16 records what building it changed.

Written against `v0.15.0-20-gbe05a2e`. Two of its decisions rest on answers from the farm, quoted in
§2 and §4.3; the rest are derived from what is already in the repo, and the places where neither
applies are marked **unknown — ask the farm** rather than guessed at.

Verified by execution, and §16 is the part worth reading twice: eight things building it changed
about the plan. Two of them are the same failure in different clothes — a figure that was
arithmetically correct and false on screen — and neither would have been caught by any test that was
written, because both were about data the tests did not have.

**This document covers the people who work on the farm, what they are paid, and what they are owed.**
Milk leaving the bulk is [REGISTRY_SALES.md](REGISTRY_SALES.md); per-animal yield is
[REGISTRY_MILKING.md](REGISTRY_MILKING.md). This touches the first of those in exactly one place
(§4.6) and the second not at all.

---

## 1. Why this exists, and what changes when it lands

The farm employs people. Nothing about that is recorded anywhere — not who works here, not what they
are paid, not what they are owed, and not what else they take as part of the package. Three questions
follow from the gap, and the third is the one worth building for:

- **"What do we owe them?"** Today it is in somebody's memory, settled by conversation. This is the
  same problem the dodhi's notebook posed, and [REGISTRY_SALES.md §2](REGISTRY_SALES.md) has already
  solved it once.
- **"What were they on in March?"** A salary that is a single mutable number is a salary with no
  history, and a raise silently rewrites what last year cost.
- **"What does labour actually cost?"** Cash is the visible half. Milk, flour, quarters and
  utilities are the other half, and a farm that counts only the cash figure understates its own
  labour cost by whatever the package is worth — which is precisely the number nobody has.

What changes when it lands is that all three become countable, and one open question closes as a
side effect. [REGISTRY_SALES.md §15](REGISTRY_SALES.md#15-still-open) asked *"Does home use split into
household and staff milk? […] which way the farm thinks about it is unknown."* It is no longer
unknown — the farm's answer is quoted in §4.6a, the split is real, and staff milk is part of a salary
arrangement rather than consumption.

### This is a third axis, not step 5

[REGISTRY_SALES.md §1](REGISTRY_SALES.md#this-is-not-step-5-and-the-numbering-should-not-absorb-it)
made this argument once for buyers: the registry's step numbering is about the animal record, and the
sales tables were *"the first registry tables with no `animal_id` at all"*. The same holds here and
one step further — these tables hang off neither an animal nor a counterparty, but off a person the
farm employs. Sales was the second axis; labour is the third. Filing it as a step would imply it
competes with breeding events for a slot, and it does not.

---

## 2. The finding: people are already in the registry, as free text, in ten columns

`observed_by` is on four record tables — [registry_animal_events](../server/src/registry/schema.ts),
`registry_milkings`, `registry_dispatches`, `registry_payments`. `recorded_by` is on those four plus
`registry_destinations` and `registry_destination_prices`. Ten columns, every one of them a person,
every one of them free text.

That was a deliberate choice and it is still the right one for those columns.
[identifier-input.ts:6-15](../web-angular/src/app/registry/identifier-input.ts#L6-L15) argues it:

> Free text typed across a hundred records produces `abdul`, `Abdul` and `abdul_r` — three
> identifiers for one person. […] A `<datalist>` is the right shape because it is a SUGGESTION and
> not a constraint: the second occurrence of a name becomes a pick instead of a retype, while a
> genuinely new name stays typeable with no friction at all. A `<select>` would force every new
> person through an "add new" flow, which is how an operator ends up typing a name into the wrong
> field to get past it.

[identifierValues()](../server/src/registry/reads.ts#L186) mines those columns for the datalist, and
its comment is already worrying about the milker *"who has been named on a thousand rows"* and about
`imran` and `Imran` becoming two people *"on the table where 'everything Imran milked' is a question
worth being able to ask"*.

**So the drift problem is known, the mitigation is built, and what is missing is a referent.** There
is nothing anywhere that says `imran` is a person, let alone that they are employed, on what,
since when.

### This must not become a foreign key, and there are two independent reasons

**1. Those columns hold people who are not employees.** `acquired_from` is whoever sold you an
animal. `sire_ref` is a bull that belongs to somebody else. `observed_by` on a `note` event might be
the vet. Constraining any of them to a staff table would refuse a legitimate entry, which is how a
mandatory field becomes a reflex — [REGISTRY_SALES.md §4.1a](REGISTRY_SALES.md#41a-standing--the-column-the-farms-answer-added-and-the-sessions-column-it-refused)'s
argument, arriving from a different direction.

**2. It is not possible for the event log anyway.** `registry_animal_events` has two append-only
triggers ([Decision 7](REGISTRY.md#decision-7--append-only-and-the-pragma-it-depends-on)). Historical
`observed_by` values cannot be rewritten to point at anything, so a foreign key could only ever
cover rows written after this lands — a constraint that is true of some rows and not others, which is
worse than no constraint at all.

**The link is therefore by value, not by reference.** `registry_people.identifier` holds the same
string that goes in `observed_by`, `UNIQUE COLLATE NOCASE` so that `abdul` and `Abdul` collide *in
the person table* even though both may exist in history. The datalist is unchanged. Nothing is
constrained. And an identifier used on a record that matches no person becomes a **`/check` report
line, not a violation** — the same move [invariants.ts](../server/src/registry/invariants.ts) makes
for *"dispatches on a day with no milking rows"*, and for the same reason: it will fire on legitimate
rows, so it is information rather than a failure.

> `COLLATE NOCASE` folds ASCII A–Z only. Every identifier on this farm is Latin-script transliteration,
> so this works; it would not survive a Perso-Arabic identifier, and that is a real limit rather than
> an oversight.

---

## 3. Storage: a person, a stint, and a package — three things, not one

The obvious table is `registry_employees`, with a salary column and a start date. It is wrong in
three separate ways, and each of the three is a table.

**A person is not an employment.** People leave and come back. The farm's answer, verbatim:

> there are genuine cases where some former employee also returned for another stint

A single row with `started_on` / `ended_on` cannot hold two stints, and the repair — a second person
row — makes "everything Imran milked" unanswerable again, which is the whole problem §2 exists to
fix. So identity and employment separate: `registry_people` holds who somebody is, and
`registry_engagements` holds each period they worked, exactly as `registry_animals` holds identity
while `registry_lactations` holds the dated periods that open and close.

**An employment is not a package.** A raise is a new agreement on the same engagement, and last
month's pay must not move when it happens. This is
[REGISTRY_SALES.md §4.2](REGISTRY_SALES.md#42-prices-effective-dated-agreement-captured-on-the-dispatch)
without a single change of argument: `registry_pay_terms` is effective-dated, a change is a new row
and never an UPDATE, and the term in force on a date is the latest row at or before it.

**A package is not a number.** Cash is one line of it. Milk, flour, accommodation and utilities are
the rest, and a column per benefit is a migration per benefit. So `registry_pay_benefits` holds them
as rows — the same reasoning that made *"calves and spoilage a row, not a schema change"* in
[REGISTRY_SALES.md §3](REGISTRY_SALES.md#3-storage-a-disposition-not-a-sale--and-home-use-is-what-decided-it).

Six tables in all:

```
registry_people          identity, and the referent §2 is missing
registry_engagements     one per stint: kind, role, active range
registry_pay_terms       effective-dated package — cash amount and the period it covers
registry_pay_benefits    the in-kind lines of a term
registry_wage_periods    the debit side: what was agreed for one settlement period
registry_wage_payments   the credit side: money handed over
```

### Why `registry_people` and not `registry_employees`

Because [REGISTRY_SALES.md §2](REGISTRY_SALES.md)'s finding was that *"a name that is nearly right
survives a long time before anyone pays to fix it"* — `vendors` held rows that buy, and the word had
been wrong since Cycle 2. The table here holds a referent for `observed_by`, and `observed_by` holds
the vet, the AI technician and the man who sold you a buffalo. Most rows will be employees. Not all
of them are, and the ones that are not are exactly the rows a name like `registry_employees` would
quietly discourage anyone from adding.

Employment is what `registry_engagements` says. A person with no engagement is a person the farm
knows and does not employ, which is a legitimate and useful row.

---

## 4. The data model

### 4.1 People

Identity and nothing else. **No dates on this table** — every date lives on an engagement, which is
what makes multiple stints expressible.

`identifier` is the load-bearing column: the stable string that also appears in `observed_by`,
`UNIQUE COLLATE NOCASE`, required and non-blank. `name` is the display name and is nullable, because
the identifier is the thing that has to be right; a person entered as `imran` with no display name
is still fully useful.

Amendable in place, like `registry_destinations` and unlike `registry_animals`. A corrected phone
number is an ordinary UPDATE; nothing is derived from this row.

**Changing `identifier` after records exist is the one edit that must be refused at the write
boundary.** It would silently orphan every historical `observed_by` that matched it — the link is by
value (§2), so the value is not free to move. A person whose identifier was typed wrong is corrected
by adding the right one and closing the wrong one, not by editing in place.

### 4.2 Engagements: loose on purpose, and the one thing that stays strict

Identity plus an **active range**, the same shape and the same argument as
[REGISTRY_SALES.md §4.1](REGISTRY_SALES.md#41-destinations): membership on a past date is a range
test, which is what lets the payroll run open last March and show who was employed **then**.
`ended_on` is inclusive and nullable; an open-ended engagement is the normal state.

The farm asked for this to be flexible, and flexible has to mean something specific or it means
nothing. It means these four are **not constrained, and are `/check` report lines instead**:

| Not enforced | Why not |
|---|---|
| Overlapping engagements for one person | On a small farm somebody can be milker and night watchman at once |
| More than one open engagement | Same |
| A wage period dated outside its engagement's range | A final settlement paid two weeks after somebody leaves is real |
| Gaps between engagements | That is the feature — a stint is a stint |

The third has direct precedent. Invariant 20 flags dispatches outside a destination's range rather
than rejecting them, because *"closing a buyer at the end of last month, when the last delivery was
on the 2nd of this one, leaves rows outside the range that were legitimate when made."* Employment
ends the same way: messily, and dated afterwards.

**Invariant 8 is deliberately not copied.** `one-open-lactation` is a hard violation because an
animal can only be lactating once; a person can hold two jobs, so the equivalent here is a report
line. Named because a reader who knows the lactation code will look for it.

**And exactly one thing stays strict: a wage period must name its engagement.** That is the whole
reason `registry_engagements` exists as a table rather than a range on the person row. Without it,
a term lookup for a returning worker walks back past the gap and finds their *pre-departure* salary —
a bug that is silent, arrives months later, and looks exactly like a correct answer. Scoping terms
to an engagement makes it structurally impossible rather than something a query has to remember.

It also resolves the ambiguity the looseness creates. If two engagements are open, "which one is
this month's pay against?" is answered by the operator picking, not by the system guessing.

`kind` is `permanent | daily`; `role` is free text and nullable; `end_reason` is free text, because
the vocabulary of why somebody left is not one this repo should be inventing.

### 4.3 `kind` — and why one wage table serves both

The farm's answer on dihari, verbatim:

> usually when an employee is on leaves, or the workload is more than usual for certain days so we go
> for additional dihari support as well

Two things follow. Dihari is **supplementary rather than a parallel workforce** — it is cover for
absence and surge capacity, which means it is occasional by nature. And it is **per-day**.

That is the standing/occasional split from
[REGISTRY_SALES.md §4.1a](REGISTRY_SALES.md#41a-standing--the-column-the-farms-answer-added-and-the-sessions-column-it-refused),
arriving unchanged:

| | `permanent` | `daily` |
|---|---|---|
| Here | the salaried staff | dihari hired for cover or surge |
| On the monthly run | yes — one row each, must be answered | no — not a row until they worked a day |
| Untouched on the run | **blocks the save** | not applicable |
| Settlement | monthly | usually same day, in cash |

**And `registry_wage_periods` needs no branch for the two**, because a wage period carries `from_on`
and `to_on` rather than a month:

```
permanent   2026-09-01 → 2026-09-30   Rs 25,000    (term: Rs 25,000 / month)
dihari      2026-09-14 → 2026-09-14   Rs  1,200    (term: Rs  1,200 / day)
```

A dihari day is a period of one day. Same table, same capture rule, same ledger, same statement.

The timing difference falls out of the ledger with no special case at all: a dihari paid in cash at
the end of the day is a wage period and a payment on the same date, so their balance is zero, while
the salaried worker's balance runs for a month. That is `earned − paid` doing the work, and it is the
second time [ledger.ts](../server/src/registry/ledger.ts)'s refusal to have a `paid` column has paid
for itself.

**The case flexible engagements unlock, which is not merely re-hiring:** a dihari who works out
becomes permanent. That is how a farm this size actually hires, and it is two engagements of
different `kind` for one person — something a single range on a person row cannot express at all.

### 4.4 Pay terms: effective-dated agreement, the default at entry

`registry_pay_terms (engagement_id, effective_from, cash_minor, cash_period)`. A change is a new row;
the term in force on a date is the latest row at or before it; `UNIQUE (engagement_id,
effective_from)`, because a second term on the same date is not a raise, it is a typo, and which one
won would be silent.

**A rate is two values, as it is for milk** — `cash_minor` and the period it covers. Rs 25,000 per
month is `(2500000, 'month')` the way Rs 7,000 per 40 L is `(700000, 40)`.

**But `cash_period` is an enum where `price_unit_litres` is a number, and that divergence is the
point.** A month is not a fixed quantity of days. Storing "per 30 days" to keep the shapes identical
would assert something the agreement does not say and would be wrong eight months a year — the same
refusal as the `sessions` column in §4.1a, and the same refusal as never defaulting a date precision.
`month | day` covers what this farm actually agrees; a weekly or fortnightly arrangement is a value
added to the enum, which is a rebuild, and that cost is accepted rather than pre-empted with a
speculative number of days.

`cash_minor` may be zero. A package that is entirely in kind — food and quarters, no cash — is
unusual but not nonsense, and refusing it would push it into a fiction somewhere else.

**No append-only triggers on this table**, and it is safe for the same reason the price table is
safe: a term is only the *default offered at entry*. What was actually paid is on the wage period
(§4.6), so a term typed wrong and caught immediately is corrected in place and rewrites no history.

### 4.5 Benefits: rows, not columns — and no value column at all

`registry_pay_benefits (term_id, kind, quantity, unit, period, note)`, with `kind` one of
`milk | flour | accommodation | other`.

**The vocabulary is the farm's, not a guess.** Asked before the migration was written; the answer was
milk, flour or wheat, and accommodation. **`utilities` was in the draft and has been removed** — a
value nobody files anything under is the `farm_events.is_synthetic` failure in miniature, a
discriminator whose correctness is never exercised. If the farm ever subsidises electricity it is an
`other` line with a note, which costs nothing and carries more information than a bare enum value
would; making it first-class later is a rebuild, and that price should be paid when somebody is
actually paying the bill.

**They hang off the term, not the engagement**, because a raise usually moves the milk allowance too.
Effective-dating the package as a unit means "what were they on in March" is one lookup, and it means
the parts cannot drift out of step with the whole.

Three CHECKs, in the three-layer habit: a quantity and a unit are both present or both absent; a
quantity carries a period; and `other` must carry a note — an unlabelled benefit is prose about
something nobody can price later, the same argument as
`an_adjustment_explains_itself` on `registry_payments`. Accommodation has no quantity, no unit and no
period, and passes all three cleanly.

**There is no `valued_minor` column, and its absence is a decision rather than an omission.**
[REGISTRY_SALES.md §15](REGISTRY_SALES.md#15-still-open) already ruled on this from the other side:
*"a rupee figure needs a reference price with no transaction behind it […] if it is built, it is an
imputed figure in a report, never a row in the ledger."* A column would be summed. Not summed
maliciously — summed by the next person to write a balance query, because it is right there and it
looks like money. Leaving it out makes the mistake unrepresentable rather than discouraged, which is
the standard this repo has held to since `deliveries.paid`.

The value of the package is a **report line** (§12.1), computed from an explicitly named reference
price, labelled as imputed, and never added to anything.

### 4.6 Wage periods: the debit side, and the captured rate that is deliberately absent

`registry_wage_periods (engagement_id, kind, from_on, to_on, amount_minor)`.

**The agreed figure is the transaction, and it is stored directly.** A month in which somebody took
four days' leave is settled by conversation, not by arithmetic. A system that computes Rs 25,000
because the calendar says a month elapsed is inventing a number nobody agreed to — and a system that
computes Rs 21,667 because it decided leave is deductible is worse, because it is inventing a policy
too. So the operator enters what was agreed, and the term supplies the default.

**Whoever reads `registry_dispatches` first will look for a captured rate here and not find one.**
This is where it went: a dispatch captures `price_minor` and `price_unit_litres` because its amount
is *derived* from them (`litres × rate`), and money must never be recomputed from a lookup that can
move underneath it. A wage period's amount is not derived from anything — it is the stored figure —
so there is nothing to capture. Whether it matched the term is answered by looking up the term in
force, and a difference is legitimate (§13's report lines), not a violation.

`kind` is `wage | bonus`. A bonus has no range in any meaningful sense, so it is stored with
`from_on = to_on` and needs no term behind it, which §13's invariant 23 exempts. It is a debit like
any other, and giving it a kind keeps the sign positive on both sides of the ledger — a bonus filed
as a negative payment would be arithmetically correct and unreadable on the statement handed to the
person it is for.

A **deduction** goes the other way and is an `adjustment` payment (§4.7), because it reduces what the
farm owes, which is exactly what the credit side is for. Debits are wage periods; credits are
payments; nothing is signed except an adjustment.

`UNIQUE (engagement_id, from_on)` stops two September rows. It does **not** stop overlapping ranges —
a SQLite CHECK cannot see another row — so overlap is invariant 24 and is a hard violation rather
than a report line. This is the one place the looseness of §4.2 does not extend: two overlapping wage
periods is double payment, which is an error and not a shape of employment.

### 4.6a Milk as part of the package — one destination per staff member

The farm's answer, and the reason this subsection exists:

> sometime a staff member can also be allocated milk portion as part of the salary arrangement. so
> that distinction is also needed

**Milk taken as pay stays where milk already lives.** It is a `registry_dispatches` row, not a column
on the pay term — the litres are already a fact in a table built to hold them, and a second copy on
the package would be two numbers that can disagree. Payroll **cites** those rows and never copies
them.

**But it is one destination per staff member, not a single `staff` row**, and that follows from the
dispatch key rather than from taste. `registry_dispatches` is `UNIQUE (destination_id, occurred_on,
session)`, so a shared destination can hold exactly one row per session — the aggregate — and whose
milk it was is unrecoverable from it. Three staff on an allowance need three destinations, each
naming its person.

[REGISTRY_SALES.md §3](REGISTRY_SALES.md#3-storage-a-disposition-not-a-sale--and-home-use-is-what-decided-it)
anticipated exactly this and left room for it — the schema carries the note that there is deliberately
no unique index pinning a single non-billable destination, *"so splitting home use into household and
staff milk, or adding calves or spoilage, must not cost a migration"*. That room is what makes each
staff member an INSERT.

**Two things it did not leave room for, and both are migration 7 (§9):**

- **`kind` has no `staff` value.** It is `dodhi | household | shop | home | other`, so as things stand
  staff milk can only be filed as `home` — which is the household, or `other` — which says nothing.
  This document's first draft asserted `kind = 'staff'` and was simply wrong about what the schema
  can hold. Adding an enum value is a CHECK change, and a CHECK change is a table rebuild.
- **Nothing links a destination to a person.** A nullable `person_id` is needed, with a partial unique
  index so one person cannot have two milk destinations — the same shape as
  `idx_registry_events_supersedes`, and for the same reason: the overwhelming majority of destinations
  have no person and must not be forced unique.

The two are held together by `CHECK ((kind = 'staff') = (person_id IS NOT NULL))` — the biconditional
shape of `taken_has_litres` — plus `billable = 0`, in the same three-layer habit as
`home_is_never_billable`.

**Staff destinations are `standing`, and block the save.** An allowance is taken daily, so the
argument [REGISTRY_SALES.md §3](REGISTRY_SALES.md#3-storage-a-disposition-not-a-sale--and-home-use-is-what-decided-it)
makes for home use arrives unchanged and is if anything stronger: milk that leaves in a jug for
somebody who works here is *more* forgettable than the household's, because nobody in the house is
tracking it either. It also passes that section's own warning — do not seed a destination that reads
zero every day — because this one does not.

**Allowance and taken are separate facts, and the gap is the point.** The pay term's `milk` benefit
is the entitlement (2 L a day); the dispatch rows are what was actually collected. Per-person
destinations make that comparison exact rather than aggregate, and it is the first line of §12.1's
package report.

**Milk taken above the allowance is a wage-ledger adjustment, never a priced dispatch.** The schema
already refuses the alternative — invariant 19's `unbillable_dispatch_priced` fires on a non-billable
dispatch carrying a price — and the refusal is right. Making the destination billable would give one
person two balances, a buyer balance and a wage balance, settled separately; the farm nets it against
pay. So the excess is an `adjustment` payment with a note (§4.7), because the counterparty is an
employee rather than a buyer, and it belongs in the ledger that settles with them.

This answers [REGISTRY_SALES.md §15](REGISTRY_SALES.md#15-still-open)'s *"Does home use split into
household and staff milk?"* — it does, the farm has said so, and the reason it is worth doing is that
it moves milk out of household consumption and into labour cost, where it changes what the farm
believes about both.

### 4.7 Payments: the same ledger, and the one asymmetry

```
balance(person) = Σ amount_minor over wage periods, across all their engagements
                − Σ amount_minor over wage payments
```

Positive means the farm owes them. `method` is `cash | bank | adjustment`, with the same two CHECKs
as `registry_payments`: cash and bank are strictly positive, and **`adjustment` is the only signed
kind and must carry a note**. Derived on every read, never cached.

**The asymmetry: a wage period names an engagement, a payment names a person.** Earning is
per-engagement because the terms are; paying is per-person because one cash handover settles whatever
is outstanding, and because an advance paid between two stints belongs to the man, not to either job.
It is also how the farm thinks — the question is "what do I owe Rashid", never "what do I owe
Rashid's second engagement".

#### Advances (peshgi)

**There is no advance table, no advance flag and no recovery schedule, and this is not a simplification
— it is what the ledger already does.** An advance is money handed over before it was earned, so it is
an ordinary payment dated when it happened, and the balance goes negative. [ledger.ts](../server/src/registry/ledger.ts)
says so for buyers already: *"negative means they are in credit, which is an ordinary state for a
buyer who paid ahead and needs no special case."*

Recovery is then not an operation at all. The next wage period is a debit, and the balance walks back
towards zero on its own. A recovery schedule would be a second representation of arithmetic the
ledger already does, and the two could disagree.

What is genuinely open is **wording**, and it is the same open question §15 already carries for
buyers: whether the statement should say "Rs 8,000 in advance" rather than showing a minus sign.
Answer both the same way, whenever the first one comes up.

#### Opening balances

**Unknown — ask the farm.** For buyers there were none and
[REGISTRY_SALES.md §4.4](REGISTRY_SALES.md#opening-balances) recorded that as a piece of luck that
*"will not come round again"*. It very likely does not hold here: a farm that has employed people for
years and is starting this table today has outstanding advances, or a month part-paid.

If there are any, the mechanism is already built and needs no screen: **one `adjustment` payment,
signed and dated, with a note saying what it carries forward.** Do not build an "opening balance"
field. A wrong one is corrected by a second adjustment and never by editing the first.

---

## 5. Money: one new function, and nothing else

[money.ts](../server/src/registry/money.ts) is reused as it stands. Minor units, the single rounding
rule, `formatMinor`. Payroll adds **no arithmetic at all** — there is no litres-times-rate step,
because §4.6 stores the agreed amount directly — so `amountMinor()` is not called from anywhere in
this feature.

One function is added, and only for display:

```ts
/** A package rate as it was agreed — "Rs 25,000.00 / month". */
export function formatPeriodRate(cashMinor: number, period: CashPeriod): string
```

The sibling of `formatRate`, for the same reason: the statement is a document handed to the person it
is about, and it has to print what was agreed rather than a conversion of it.

---

## 6. Time

Farm-local calendar dates throughout, `YYYY-MM-DD`, with the same GLOB CHECKs as every other registry
table. `recorded_at` is the UTC instant of transcription.

**No `date_precision` anywhere in this feature.** Precision exists because an animal's birth date is
often recalled rather than known. A pay date is not recalled — it is the date somebody was paid, and
if it is genuinely unknown then the row should not be written. Adding the column "for consistency"
would create a fourth vocabulary nobody needs and would put `estimated` on a wage.

**No `occurred_time`.** Nothing here happens at an hour.

---

## 7. Provenance

`recorded_by` on all six tables, `NOT NULL`, from the session as everywhere else.

`observed_by` on `registry_wage_periods` and `registry_wage_payments` only — who witnessed the
handover — nullable, and **never defaulted**, per [routes.ts:139](../server/src/registry/routes.ts#L139).

`source_form` on `registry_wage_periods`, matching `registry_dispatches`; **not** on
`registry_wage_payments`, matching `registry_payments`. The realistic values are `direct_entry` for
live entry and `recall` for whatever history gets entered from the khata. **No new source form is
added** — a payroll-specific value would have to be learned by every existing consumer of
`SOURCE_FORMS` for no gain.

---

## 8. Corrections

**Update in place, and the reasoning is [REGISTRY_SALES.md §8](REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle)'s
recommendation (a), inherited rather than re-argued.** Money is derived from these rows and there is
a counterparty, so the milking answer does not carry on its own — but the sales cycle already decided
that update-in-place plus a revisions table is the shape, and payroll must not invent a third answer.

Whatever `registry_sale_revisions` ends up being, wage periods and wage payments use the same
mechanism. **Do not build a payroll-specific revisions table**, and do not build this before the
sales one exists — two audit trails with different shapes for the same problem is worse than one late
one.

**Until it exists, the honest position is that a corrected wage figure leaves no history**, which is
already on [OPEN.md](OPEN.md) for dispatches and payments and now covers three more tables.

A **DELETE path** is implied and stated rather than discovered, as narrow as the milking and dispatch
ones: a wage period entered against the wrong engagement is repaired by removing it and re-entering,
because `UNIQUE (engagement_id, from_on)` means the wrong row keeps holding the slot. Per row, never
a range. It must be reachable for a wage payment too — a payment typed against the wrong person moves
money between two people's balances and has no other repair, exactly as
[deletePayment()](../server/src/registry/ledger.ts) already argues.

---

## 9. Schema (migrations 6 and 7)

**Two migrations, not one, and they are kept apart deliberately.** Migration 6 is six plain
`CREATE`s; migration 7 rebuilds `registry_destinations`. That is precisely the split
[REGISTRY_SALES.md §9](REGISTRY_SALES.md#9-schema) made between migrations 4 and 5 — *"this one
rebuilds a table with foreign keys off and those are plain CREATEs. Putting both behind one review is
what REGISTRY.md refused at migration 3."* The same reasoning, the same order of operations, and
migration 6 must go first because migration 7's new foreign key points at `registry_people`.

### Migration 6 — the six tables

Nothing existing is touched, so no `rebuildsTables` and no foreign-keys relaxation — the cheap kind,
like migrations 3 and 5.

All six go in `REGISTRY_TABLES` and none in `REGISTRY_PROJECTION_TABLES`, by the test that decides it:
nothing here is derivable from the event log. The rebuild must never touch them. They are backed up
with nothing to remember, because
[SOURCE_OF_TRUTH_TABLES](../server/src/registry/backup.ts#L90) is computed as the difference rather
than listed.

`RegistrySnapshot` and [snapshot()](../server/src/registry/store.ts#L163) gain all six, or `/check`
verifies nothing about them.

```sql
CREATE TABLE registry_people (
  id          TEXT PRIMARY KEY,
  -- The referent §2 is missing. The same string that appears in observed_by,
  -- linked BY VALUE and never by foreign key -- see §2 for the two reasons.
  -- COLLATE NOCASE so `abdul` and `Abdul` collide HERE even though history
  -- holds both. ASCII-only folding, which is a real limit.
  identifier  TEXT NOT NULL COLLATE NOCASE UNIQUE,
  name        TEXT,
  contact     TEXT,
  note        TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,

  CONSTRAINT a_person_has_an_identifier CHECK (length(trim(identifier)) > 0)
);

-- One row per STINT. NO unique constraint pinning one engagement per person and
-- no overlap constraint: people come back, and somebody can hold two jobs on a
-- farm this size. Overlap is a /check report line (§13), deliberately.
CREATE TABLE registry_engagements (
  id          TEXT PRIMARY KEY,
  person_id   TEXT NOT NULL REFERENCES registry_people(id),
  kind        TEXT NOT NULL CHECK (kind IN ('permanent','daily')),
  role        TEXT,
  started_on  TEXT NOT NULL,
  ended_on    TEXT,
  end_reason  TEXT,
  note        TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,

  CONSTRAINT started_on_is_a_date
    CHECK (started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT ended_on_is_a_date
    CHECK (ended_on IS NULL OR ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT the_range_runs_forwards
    CHECK (ended_on IS NULL OR ended_on >= started_on)
);
CREATE INDEX idx_registry_engagements_person ON registry_engagements(person_id, started_on);

-- The AGREEMENT. Effective-dated: a raise is a new row, never an UPDATE.
-- Scoped to the ENGAGEMENT, not the person -- that is the whole reason
-- engagements are a table (§4.2). No append-only triggers, safe because the
-- wage period holds what was actually paid.
CREATE TABLE registry_pay_terms (
  id             TEXT PRIMARY KEY,
  engagement_id  TEXT NOT NULL REFERENCES registry_engagements(id),
  effective_from TEXT NOT NULL,
  cash_minor     INTEGER NOT NULL CHECK (cash_minor >= 0),
  -- An ENUM, not a number of days: a month is not a fixed quantity of days and
  -- storing one would assert something the agreement does not say (§4.4).
  cash_period    TEXT NOT NULL CHECK (cash_period IN ('month','day')),
  recorded_by    TEXT NOT NULL,
  recorded_at    TEXT NOT NULL,
  note           TEXT,

  CONSTRAINT effective_from_is_a_date
    CHECK (effective_from GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT one_term_per_engagement_per_day
    UNIQUE (engagement_id, effective_from)
);
CREATE INDEX idx_registry_pay_terms_engagement
  ON registry_pay_terms(engagement_id, effective_from);

-- The in-kind half of the package. ROWS, NOT COLUMNS -- a column per benefit is
-- a migration per benefit.
--
-- NOTE THE ABSENT `valued_minor`. A rupee figure for milk or flour needs a
-- reference price with no transaction behind it, and a column would be summed
-- by the next person to write a balance query. The value of a package is a
-- REPORT line, computed from a named reference price and labelled imputed.
-- Leaving the column out makes the mistake unrepresentable (§4.5).
CREATE TABLE registry_pay_benefits (
  id       TEXT PRIMARY KEY,
  term_id  TEXT NOT NULL REFERENCES registry_pay_terms(id),
  -- The farm's own list (§4.5): milk, flour or wheat, accommodation. `utilities`
  -- was in the draft and was removed rather than carried unused.
  kind     TEXT NOT NULL CHECK (
             kind IN ('milk','flour','accommodation','other')
           ),
  quantity REAL,
  unit     TEXT,
  period   TEXT CHECK (period IS NULL OR period IN ('day','month')),
  note     TEXT,

  CONSTRAINT quantity_is_positive
    CHECK (quantity IS NULL OR quantity > 0),
  -- A figure without its unit is not a quantity, the same argument money.ts
  -- makes for a rate without its lot size.
  CONSTRAINT a_quantity_has_a_unit
    CHECK ((quantity IS NULL) = (unit IS NULL)),
  CONSTRAINT a_quantity_has_a_period
    CHECK (quantity IS NULL OR period IS NOT NULL),
  -- An unlabelled benefit is prose about something nobody can price later.
  CONSTRAINT other_says_what_it_is
    CHECK (kind <> 'other' OR (note IS NOT NULL AND length(trim(note)) > 0))
);
CREATE INDEX idx_registry_pay_benefits_term ON registry_pay_benefits(term_id);

-- The DEBIT side. from_on/to_on rather than a month, which is what lets one
-- table serve a salaried month and a single dihari day (§4.3).
--
-- NO CAPTURED RATE, unlike registry_dispatches, and §4.6 says where it went:
-- a dispatch derives its amount from the rate, a wage period stores the agreed
-- amount directly, so there is nothing to capture.
CREATE TABLE registry_wage_periods (
  id            TEXT PRIMARY KEY,
  engagement_id TEXT NOT NULL REFERENCES registry_engagements(id),
  kind          TEXT NOT NULL CHECK (kind IN ('wage','bonus')),
  from_on       TEXT NOT NULL,
  to_on         TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL CHECK (amount_minor >= 0),
  observed_by   TEXT,
  recorded_by   TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  source_form   TEXT NOT NULL CHECK (
                  source_form IN ('daily_herd_sheet','cycle_card','direct_entry','import','recall')
                ),
  note          TEXT,

  CONSTRAINT from_on_is_a_date
    CHECK (from_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT to_on_is_a_date
    CHECK (to_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT the_range_runs_forwards
    CHECK (to_on >= from_on),
  -- A bonus is a moment, not a period.
  CONSTRAINT a_bonus_is_one_day
    CHECK (kind <> 'bonus' OR to_on = from_on),
  -- Stops two September rows. Does NOT stop overlapping ranges -- a CHECK
  -- cannot see another row -- so overlap is invariant 24, and it is a hard
  -- violation rather than a report line: two overlapping wage periods is double
  -- payment, which is an error and not a shape of employment (§4.6).
  CONSTRAINT one_period_per_engagement_per_start
    UNIQUE (engagement_id, from_on)
);
CREATE INDEX idx_registry_wage_periods_engagement
  ON registry_wage_periods(engagement_id, from_on);
CREATE INDEX idx_registry_wage_periods_date ON registry_wage_periods(from_on, to_on);

-- The CREDIT side. Keyed on the PERSON, not the engagement: one cash handover
-- settles whatever is outstanding, and an advance paid between two stints
-- belongs to the man rather than to either job (§4.7).
--
-- No `paid` column, no advance flag, no recovery schedule. An advance is an
-- ordinary payment that makes the balance negative, and the next wage period
-- walks it back to zero on its own.
CREATE TABLE registry_wage_payments (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES registry_people(id),
  occurred_on  TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  method       TEXT NOT NULL CHECK (method IN ('cash','bank','adjustment')),
  reference    TEXT,
  observed_by  TEXT,
  recorded_by  TEXT NOT NULL,
  recorded_at  TEXT NOT NULL,
  note         TEXT,

  CONSTRAINT occurred_on_is_a_date
    CHECK (occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT cash_and_bank_are_positive
    CHECK (method = 'adjustment' OR amount_minor > 0),
  CONSTRAINT an_adjustment_explains_itself
    CHECK (method <> 'adjustment'
           OR (amount_minor <> 0 AND note IS NOT NULL AND length(trim(note)) > 0))
);
CREATE INDEX idx_registry_wage_payments_person
  ON registry_wage_payments(person_id, occurred_on);
```

### Migration 7 — `staff` destinations, alone

Two changes to `registry_destinations`, both required by §4.6a, and the first of them forces a
rebuild: SQLite has `ALTER TABLE ADD COLUMN` but no `ADD CONSTRAINT`, so widening the `kind` enum
means create-copy-drop-rename. Since the table is being rebuilt anyway, `person_id` goes in the same
pass rather than as a separate cheap `ALTER` — one rebuild, not a rebuild plus an alter.

`rebuildsTables: true`, therefore, with everything
[migration 2](../server/src/registry/schema.ts#L212) had to get right and one thing it did not.
`registry_destinations` is the target of foreign keys from `registry_destination_prices`,
`registry_dispatches` and `registry_payments` — three of them, where migration 2 dealt with a single
self-reference. Dropping it registers deferred violations that recreating it does not clear, so this
needs `foreign_keys` OFF around the transaction and the runner's `PRAGMA foreign_key_check` before
commit. Dropping the table also drops `idx_registry_destinations_active`, which must be recreated.

```sql
CREATE TABLE registry_destinations_new (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- NEW in migration 7: 'staff'. Milk allocated as part of a salary arrangement
  -- is neither the household ('home') nor unlabelled ('other'), and one
  -- destination per staff member is what the dispatch key requires -- see §4.6a.
  kind        TEXT NOT NULL CHECK (
                kind IN ('dodhi','household','shop','home','staff','other')
              ),
  billable    INTEGER NOT NULL CHECK (billable IN (0,1)),
  standing    INTEGER NOT NULL CHECK (standing IN (0,1)),
  contact     TEXT,
  started_on  TEXT NOT NULL,
  ended_on    TEXT,
  note        TEXT,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,

  -- NEW in migration 7. Nullable, because almost no destination is a person.
  person_id   TEXT REFERENCES registry_people(id),

  CONSTRAINT started_on_is_a_date
    CHECK (started_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT ended_on_is_a_date
    CHECK (ended_on IS NULL OR ended_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CONSTRAINT the_range_runs_forwards
    CHECK (ended_on IS NULL OR ended_on >= started_on),
  CONSTRAINT a_destination_is_named
    CHECK (length(trim(name)) > 0),
  CONSTRAINT home_is_never_billable
    CHECK (kind <> 'home' OR billable = 0),
  -- NEW. Biconditional, the shape of taken_has_litres: a staff destination names
  -- a person and a destination naming a person is staff milk. Neither half is
  -- useful without the other.
  CONSTRAINT staff_names_a_person
    CHECK ((kind = 'staff') = (person_id IS NOT NULL)),
  -- NEW. Milk that is part of somebody's pay must never reach a balance -- the
  -- structural half of §4.6a's argument, not merely the legible half.
  CONSTRAINT staff_is_never_billable
    CHECK (kind <> 'staff' OR billable = 0)
);

INSERT INTO registry_destinations_new
  SELECT id, name, kind, billable, standing, contact, started_on, ended_on, note,
         recorded_by, recorded_at, NULL
    FROM registry_destinations;

DROP TABLE registry_destinations;
ALTER TABLE registry_destinations_new RENAME TO registry_destinations;

CREATE INDEX idx_registry_destinations_active
  ON registry_destinations(started_on, ended_on);

-- PARTIAL, so the overwhelming majority of destinations (person_id NULL) are not
-- forced unique -- the same shape and the same reason as
-- idx_registry_events_supersedes. One person cannot hold two milk destinations,
-- because then "what did they take" would have two answers.
CREATE UNIQUE INDEX idx_registry_destinations_person
  ON registry_destinations(person_id)
  WHERE person_id IS NOT NULL;
```

**No data migrates.** Every existing destination gets `person_id = NULL` and keeps its kind; the
farm's three buyers and its home row are untouched. Staff destinations are created afterwards through
the ordinary screen, one per person on an allowance.

### Both migrations have been run, in sequence, against the real schema

Not against a hand-built database: `applyRegistrySchema()` was called on `new Database(':memory:')`
to migrate 0 → 5 through the repo's own runner, real-shaped rows were inserted into all four sales
tables, and then migration 6 and migration 7 were applied the way `runMigrations()` applies them —
6 inside a plain transaction, 7 with `foreign_keys` OFF *around* the transaction and
`PRAGMA foreign_key_check` before commit.

**Migration 7 is the one that needed proving, and it passes.** `registry_destinations` is the target
of foreign keys from three tables; the rebuild reported **0 violations**, row counts were preserved
across all four tables, `idx_registry_destinations_active` came back, and both pre-existing
destinations came through with `person_id = NULL` and their original kinds.

Twenty-eight constraint cases in all. Every one behaved as this document claims. The six worth
naming, because each is a claim made in prose above:

- `Abdul` is **refused** after `abdul` — §2's `COLLATE NOCASE` does what it says.
- A **second, overlapping engagement** for the same person is **allowed**. This is the flexibility
  the farm asked for, demonstrated rather than asserted.
- A benefit with a quantity but no unit, and one with a quantity but no period, are both **refused**;
  accommodation with none of the three is **allowed**. §4.5's three CHECKs hold together.
- A **bonus spanning a range** is refused; a **one-day dihari period** is allowed. §4.3's claim that
  one table serves both shapes is true at the schema.
- A **second milk destination for the same person** is **refused** while **two dodhis with no person
  are allowed** — §4.6a's partial unique index is genuinely partial. `kind='staff'` with no person,
  a person on a non-staff kind, and a *billable* staff destination are all refused.
- **Overlapping wage periods are allowed by the schema** — Sept 15–Oct 15 alongside Sept 1–30. That
  is not a hole, it is §4.6's stated limit: a CHECK cannot see another row, which is exactly why
  invariant 24 exists and why it is a hard violation rather than a report line.

What this still does **not** prove is anything above the schema. No module, route, screen or invariant
in this document has been written, and
[REGISTRY_SALES.md §17](REGISTRY_SALES.md#17-what-building-it-changed) records that two of its seven
findings were only visible by rendering a screen. Expect the same here.

---

## 10. Modules

The pure core / DB shell rule, and the same split as sales — **three modules for the six tables**,
because `destinations.ts` already sets the precedent of holding an identity table and its
effective-dated agreement together. `overview.ts` is a fourth and owns no table at all.

| Module | Role |
|---|---|
| `money.ts` | **pure** — unchanged, plus `formatPeriodRate` (§5) |
| `people.ts` | DB shell + pure core — people, engagements, `engagedOn()`, the write boundary |
| `payroll.ts` | DB shell + pure core — terms, benefits, wage periods, the run read model |
| `wages.ts` | DB shell — payments, `wageBalanceMinor()`, the statement read model |
| `overview.ts` | DB shell — the day board (§12.4). Composes the milking, dispatch and payroll read models; belongs to the landing page rather than to labour, and is listed here because it landed in the same cycle |

`engagedOn(e, on)` and `termInForce(terms, on)` are **pure** and mirror
[activeOn()](../server/src/registry/destinations.ts#L88) and
[priceInForce()](../server/src/registry/destinations.ts#L105) exactly, so the same functions serve the
write boundary, the read models and the invariants.

> **These four functions are near-duplicates of the destination pair, and that is accepted rather
> than abstracted.** A shared `activeOn` over a structural type would couple destinations to
> engagements so that the next change to either has to be right for both, and the two ranges mean
> different things — a buyer's range is who is on the sheet, an engagement's range is who is
> employed. Two twelve-line functions is the cheaper of the two costs. Recorded so it reads as a
> decision and not as duplication nobody noticed.

### Routes

Added to `registryRouter(db)`, every write carrying `Idempotency-Key`:

```
GET  /people?as_of=                 list, with the balance and whether a stint is open
POST /people                        (key)
GET  /people/:id?as_of=             the statement: stints, package, periods, payments, balance
POST /people/:id                    (key)  amend name/contact -- never identifier (§4.1)
POST /people/:id/engagements        (key)
POST /engagements/:id               (key)  amend role, close the stint
GET  /engagements/:id/terms                the package history for one stint, benefits included
POST /engagements/:id/terms         (key)  a new package, with its benefits
POST /terms/:id/correct             (key)  a figure typed wrong and caught immediately (§4.4)
GET  /payroll/run?from=&to=&as_of=  the derived run
POST /payroll/run                   (key)  all rows or none
POST /payroll/run/delete            (key)  narrow, per section 8
POST /wage-payments                 (key)
POST /wage-payments/:id/delete      (key)
```

Fourteen. `GET /today` — the day board of §12.4 — is a fifteenth route added in the same cycle and is
counted separately, because it belongs to the landing page rather than to labour.

> The canonical route table is [REGISTRY.md § HTTP surface](REGISTRY.md#http-surface), and a test
> now diffs it against the router rather than trusting either. This list is the labour slice of it.

> [routes.ts:35](../server/src/registry/routes.ts#L35) enumerates the keyed write routes in prose and
> has now been wrong twice, which its own comment says: *"if it disagrees with the router below, the
> router is right."* Twelve more will make it wrong a third time. **Delete the enumeration in the same
> commit** rather than correcting it — the comment has already earned that.

---

## 11. Leave: named, deferred, and cheap to add later

The farm's answer in §4.3 describes a causal link this schema does not model: a dihari is hired
*because* somebody is on leave. The pair is a report nobody can produce today — what absence actually
costs in cover — and it is a genuinely good question.

**It is still not built in the first pass**, and the deferral is honest rather than convenient
because it costs nothing later. Two things would be needed:

- `registry_absences (engagement_id, on, kind, paid, note)` — a **new table**, referencing an existing
  one, touching nothing. A plain `CREATE`, the cheap migration.
- An optional `covering_for` on the dihari's wage period — a **nullable column with no CHECK**, which
  is `ALTER TABLE ADD COLUMN`. [Migration 2's own comment](../server/src/registry/schema.ts#L212)
  records the distinction that makes this cheap: *"SQLite has ALTER TABLE ADD COLUMN but no ADD
  CONSTRAINT"*. Migrations 3 and 5 were plain; 2 and 4 were rebuilds precisely because they added
  CHECKs.

So the sequencing is: build payroll, and when the cover-cost question is actually asked, it is one
table and one nullable column.

**One thing does have to be decided now, because §4.6 depends on it: a leave day must not reduce a
salary by computation.** The wage period stores the agreed figure. If somebody took four days and was
paid in full anyway, that is what the row says. When absences do land, they record *what happened*,
and the pay consequence stays a decision somebody made — which is the same separation as
`registry_dispatches` capturing what was taken while `registry_payments` records what was settled.

---

## 12. Screens

### 12.1 `/labour/payroll` — the run

The sibling of [dispatch-sheet.ts](../web-angular/src/app/registry/dispatch-sheet.ts), and it should
feel like it, with one difference: the period is a month rather than a session, so this is opened
monthly rather than twice a day.

**Header.** The period — a month by default, with explicit `from` / `to` so a part-month or a stint
can be run.

**Body, in two parts, per §4.3.**

*Permanent engagements* are one row each, derived and never picked, with the term's figure pre-filled
and editable, the previous period's figure beside it, and what is currently owed. Untouched blocks
the save. The pre-fill is a default and the operator is expected to change it — that is the whole
argument of §4.6, so the field must not look read-only.

*Dihari* are **not rows until they worked a day.** They sit below the divider as a single "add a day"
line: pick a person, a date, an amount defaulted from their term. The visual order is not cosmetic —
everything above the divider must be answered, nothing below it must, and an operator should be able
to see whether the run is saveable without reading it.

**A plain form, deliberately — no recently-used shortlist and no two-click path.** Asked before the
build: dihari are hired **a few times a month**. At that cadence an accelerator optimises a motion
performed a handful of times, and it would cost a shortlist that has to be derived, ranked and kept
honest. This is the same measurement the sales cycle made before cutting the batch price change
([REGISTRY_SALES.md §12.2](REGISTRY_SALES.md#122-milkbuyers--destinations-and-prices)) — *"written before
the farm was counted"*. Build the accelerator if the cadence turns out to be weekly.

**Footer.** Cash total, and beside it the **package report**: for each person with a `milk` benefit,
the allowance from their term against the litres actually dispatched to them in the period (§4.6). A
difference is information, not an error. This is the one line that turns six tables into an answer,
and it is the reason §4.6 cites dispatch rows rather than copying them.

**The imputed value of in-kind benefits appears here and only here**, labelled as imputed, against a
named reference price, and added to nothing (§4.5).

**Save** is one transaction with an `Idempotency-Key`. A half-saved run is the failure this must make
impossible.

### 12.2 `/labour/people` and `/labour/people/:id`

`/labour/people` is the list with each person's current engagement, the term in force, and their balance —
the sibling of [destinations-list.ts](../web-angular/src/app/registry/destinations-list.ts). People
with no open engagement are shown, dimmed, because they are still the referent for historical rows
and may well come back.

`/labour/people/:id` is the statement: engagements as a timeline, the package as it stands and as it stood,
wage periods, payments, running balance. The payment form lives here rather than on a route of its
own, for [REGISTRY_SALES.md §12.3](REGISTRY_SALES.md#123-milkbuyersid--the-statement)'s reason — a payment
is always *to somebody*, and a standalone form would open with a dropdown this screen has already
answered.

**Grouped by month with a subtotal**, like the buyer statement, and for the same reason: it is a
document handed to the person it is about.

**The package is shown as its lines, never as a single number.** "Rs 25,000 / month, 2 L milk daily,
20 kg flour monthly, quarters" is the agreement. A total would require valuing the in-kind lines,
which §4.5 refuses.

### 12.3 Navigation and URL structure — the change that forced both decisions

The shell nav was seven items and
[REGISTRY_SALES.md §12.4](REGISTRY_SALES.md#124-navigation-pressure-noted-rather-than-solved) already
said it was over the line, deferring the grouping *"until the seventh item exists and is being used,
not predicted from six"*. Payroll takes it to nine and the day board to **ten**. The condition was met
twice over, and two separate decisions came out of it — they are separate because **a nav entry and a URL do different jobs.**

#### The original nav grouped by ACTIVITY

**Superseded by UI phase 7:** the current header has Today, Herd, Milk, Labour
and Check; each section owns its views and actions. See [UI_SYSTEM.md §12](UI_SYSTEM.md#12-the-shell--built-in-phase-7).
The following records the earlier activity grouping.

**Record** (Add animal, Record calving, Milking, Dispatch, Payroll) versus **Review** (Herd, Buyers,
People, Check), with **Today** first and ungrouped because it is not a subject — it is the answer to
"what now", and filing it under either group would make it look like one screen among several.

Not alphabetical, not by subject, not by frequency: only *what you came here to do* tells you where
to look when you arrive holding a number you need to enter. `Herd` sits under review even though
`/animals/new` and `/animals/calvings/new` write animals, because the list is a lookup and the two
writing screens are already named for what they write.

#### The URLs group by SUBJECT

```
/                          the day board
/animals                   herd list
/animals/new               add an animal
/animals/calvings           calving history (added in UI phase 7)
/animals/calvings/new       record a calving
/animals/:id               one animal
/milk/milking              session roster
/milk/dispatch             daily sheet
/milk/buyers               destinations and prices
/milk/buyers/:id           the buyer statement
/labour/payroll            the monthly run
/labour/people             staff list
/labour/people/:id         the wage statement
/check                     verification
/chat                      the agent
```

**The original divergence from the nav was deliberate.** A URL names a *thing*; encoding the activity —
`/record/milking` — would put one subject in two places and mean nothing to whoever received the
link. The three prefixes are the three axes these documents already argue for and are not invented
for the router: the animal record ([REGISTRY.md](REGISTRY.md)), milk and its counterparties
([REGISTRY_SALES.md §1](REGISTRY_SALES.md#this-is-not-step-5-and-the-numbering-should-not-absorb-it)),
and the people the farm employs (§1 here).

**Milking and dispatch sit under ONE prefix**, which is the only non-obvious placement. Filing them
by foreign key would put production under `/animals` (because `registry_milkings` has an `animal_id`)
and disposition under `/buyers` — separating the two screens that are done minutes apart by the same
person, that reconcile against each other, and that
[REGISTRY_SALES.md §15](REGISTRY_SALES.md#15-still-open) asks whether to merge. They are both milk.

`/check` verifies all three axes, so it belongs to none of them and stays at the top level.

**What the depth buys:** step 5's breeding events, treatment and weight land under `/animals`;
quality-based pricing lands under `/milk`; absences (§11) land under `/labour`. A flat space was
right at five screens and would have needed this same restructure again at fifteen.

**Literal routes must precede the parameter route:** `animals/new` and
`animals/calvings` must precede `animals/:id`, or the router matches the literal as an id and the add form becomes unreachable —
silently, by rendering the detail screen for an animal called "new".

### 12.4 `/` — the day board, and why it is not the herd list

The root used to redirect to `/herd`, and the reason was on the record: *"this build exists to enter a
herd, and the entry surface being one click deep would cost a click ~35 times in the first session."*

That was an argument about the **backfill**, which [OPEN.md](OPEN.md) still records as not having
run — and there are now three subsystems, so landing on any one of them privileges it arbitrarily.

`/` now answers **"what still needs recording?"**: the two milking sessions, the two dispatch
sessions, and the payroll. Each line is either *recorded* or a link to the screen that clears it,
carrying the exact date and session in its query string.

**Every line is actionable or it is not on the page.** No herd count, no litres this month, no
revenue. Those are interesting and they are not what somebody opens the app holding — and a landing
page of figures nobody acts on is one people stop reading, which takes the lines that *do* need
acting on down with it.

**`?on=` opens another day, and there is deliberately no date control for it** — the same call
§12.6 makes for `/check`. A picker would turn the landing page into a history browser and make
"nothing outstanding" ambiguous about which day it meant; the parameter exists so a day can be
reproduced from a link.

**It is assembled on the server** (`overview.ts`), not by six client round trips. "Is this session
done" is one rule, and a client that re-derived it would be a second implementation that drifts from
the screen that records it.

Two judgements inside it that are easy to get wrong:

- **The payroll line prompts about LAST month, not this one.** The current month is outstanding for
  the whole of it, so flagging it would make the line amber every day from the 1st to the 30th —
  and a line that is always amber is one nobody reads by the 3rd. This month is stated in passing
  and never flagged; last month unanswered *is* a prompt, and it disappears the moment it is settled.
- **An empty farm reads as done.** `0 of 0` must not render as a task, or a fresh clone opens on a
  page of work that does not exist.

And one thing it must never say: **"nothing outstanding" while last month is unpaid.** That is the
single line somebody would trust without checking, so `allClear` includes the payroll and a test
pins it.

### 12.5 Reads are free; the gate moved to the forms

The shell used to wrap the entire router outlet in `@if (session.ready())`, so **no route rendered
at all** until a source form and a name were declared. Looking at a balance, checking the herd, or
opening `/check` all required announcing a transcription session you were not about to have.

[session.ts](../web-angular/src/app/registry/session.ts) states the rule correctly and the code was
stricter than its own prose: *"the app REFUSES to show any **FORM** until both are set."* A form. The
implementation gated every screen, and the cost fell on the commonest thing anybody does here, which
is look something up.

**What changed.** The outlet and the nav always render. Two routes are pure write surfaces —
`/animals/new` and `/animals/calvings/new` — and there is nothing on them to browse, so they declare
`data.writes === true` and the shell shows the gate in their place. Every other screen renders, and
its submit control is replaced by `<app-session-required>`: *"Recording is off, so a payment cannot
be saved yet — Start recording."*

**Replaced, not disabled.** A disabled submit with no explanation is the shape that makes people
reload the page looking for a bug. And a hidden-but-present submit inside a `<form>` is still
reachable with Enter, which is why this is an `@if` at each call site rather than a wrapper that
projects its content.

**The gate opens ABOVE the screen, and the screen stays mounted.** Swapping the outlet for it would
destroy the routed component and take any half-typed figure with it — precisely the moment somebody
reaches for the button that opens it.

**The session bar states the browsing case rather than showing nothing.** It used to be absent with
no session, which was fine when nothing else rendered either. Now an operator can be three screens
deep with no provenance set, and *"Browsing — nothing is being recorded"* is exactly the kind of fact
[target.ts](../web-angular/src/app/registry/target.ts) argues must never be communicated by an
absence.

**The guarantee is now distributed across twelve call sites, so it is checked.** A component that
calls `session.provenance()` must either render `<app-session-required>` or sit on a route declaring
`writes: true`; a source-level test asserts it, and names the two exceptions so the list cannot rot
silently. `provenance()` throwing is the backstop, and the server refusing a body with no
`recorded_by` is the one after that.

### 12.6 Screen state in the URL

Every dated screen used to hold its date and session in a plain signal seeded from `farmToday()`. So
`/milking` **always** opened on today and the guessed session: yesterday evening's roster was
unlinkable, a refresh lost your place, and "look at this session" was unsendable.

The server had been ready the whole time — `on`, `session`, `from`, `to` and `as_of` are all accepted
query params, and the read models take them as **parameters rather than reading a clock**. Only the
client was missing. `url-state.ts` closes it for `/milk/milking`, `/milk/dispatch`,
`/labour/payroll` and `/check`.

**A bare URL means "now", and defaults are never written into it.** `/milk/milking` opens today's
likely session and stays bare; changing either puts it in the query string, at which point the URL
names that specific sheet. Stamping today's date in on load would freeze every bookmark on the day it
was made, which is the opposite of what somebody bookmarking a daily sheet wants.

**The session is validated, not cast.** `?session=lunch` is a URL somebody can type, and passing it
through would produce a server refusal on a screen with no field to attach it to.

**`/check` takes `as_of` but has no date control**, deliberately. It answers "how does it look", and
a date picker would invite treating it as a history browser, which it is not. The parameter exists so
a violation can be reproduced from a link somebody sent.


---

## 13. Invariants 23–28

Numbered continuing from the sales block at
[invariants.ts](../server/src/registry/invariants.ts); all pure, snapshot in, violations out, added to
`checkSnapshot()` as `checkLabour(s)`. `RegistrySnapshot` gains the six new tables; invariant 28 also
reads `destinations`, which it already holds.

23. **Terms are unambiguous and present.** No two term rows share an `(engagement_id,
    effective_from)`, and every wage period of kind `wage` has a term in force on its `from_on`.
    Bonuses are exempt — they have no term behind them by design (§4.6). The mirror of invariant 21.
24. **Wage periods do not overlap within an engagement.** The one hard rule in a deliberately loose
    model (§4.6): overlap is double payment.
25. **Benefit lines are well formed.** Quantity and unit both present or both absent; a quantity
    carries a period; `other` carries a note. Enforced by CHECK and checked again here, because a
    constraint only defends rows written after it existed — invariant 11's reasoning.
26. **Nothing references an unknown person or engagement.** Every engagement names a known person;
    every term, benefit and wage period names a known engagement; every payment names a known person.
27. **Only `adjustment` wage payments are signed**, and a signed one carries a note.
28. **Staff destinations and people agree.** Every `kind = 'staff'` destination names a known person
    and is non-billable; no person has two of them; and no destination names a person without being
    `staff`. Enforced by CHECK and by the partial unique index of §4.6a, and checked again here for
    invariant 11's reason — a constraint only defends rows written after it existed, and every
    destination in the live database predates migration 7.

### Deliberately report lines, not invariants

Each of these fires on rows that are legitimate, so making it a violation would train people to
ignore `/check` — which is the cost invariant 13's comment is guarding against from the other
direction.

- **An `observed_by` or `recorded_by` identifier matching no person** (§2). It will fire on the vet,
  on the man who sold you a buffalo, and on every name entered before this table existed.
- **Overlapping engagements, or more than one open engagement, for one person** (§4.2). The farm
  asked for this to be possible.
- **A wage period dated outside its engagement's range** (§4.2). A final settlement after departure.
- **A wage period whose amount differs from the term in force.** This is the *expected* case for any
  month with leave or an adjustment, and the direct analogue of §4.2's report on a dispatch whose
  captured price differs from the agreement — a deliberate deviation looks identical to a mistake, so
  it is reported and never rejected.

---

## 14. Build order

Everything needs migration 6. **Items 2 through 5 ship together or not at all**, for
[REGISTRY_SALES.md §15](REGISTRY_SALES.md#15-still-open)'s reason arriving unchanged: items 2–4 alone
produce a total that only ever grows, and anything labelling it "owed" would be false. Item 4 is the
satisfying half and is therefore the one most likely to be taken on its own.

| # | Item | Size | |
|---|---|---|---|
| 1 | Migration 6: six tables + `formatPeriodRate` (§5, §9) | S | **done** |
| 1b | Migration 7: `staff` destinations, alone — a rebuild, its own review (§9) | S | **done** |
| 2 | People and engagements: write boundary, `/labour/people` (§4.1, §4.2, §12.2) | M | **done** |
| 3 | Terms and benefits: effective-dated, with the package form (§4.4, §4.5) | M | **done** |
| 4 | `/labour/payroll` run: transactional save, idempotency, the derived roster (§12.1) | M | **done** |
| 5 | Wage payments, balance, `/labour/people/:id` statement (§4.7, §12.2) | M | **done** |
| 6 | Invariants 23–28 and the four report lines (§13) | S | **done** |
| 7 | The nav grouping decision, now unavoidable (§12.3) | S | **done** |
| 8 | Fixtures: people, engagements, terms, a run | S | **done** |

**Item 8 is synthetic and must stay that way — more strictly than anywhere else in the repo.**
Fixture people get invented names and invented salaries. The standing rule that nothing synthetic
touches `dairy.db` cuts both ways, and here the second direction is the important one: **a real
person's salary must never appear in a fixture file that a test can load**, and real people belong in
the live database, entered by the farm, through §12.2's screen. The screens are the deliverable; the
data is the farm's.

**No agent tools in this cycle, and the reason is not
[REGISTRY_TOOLS.md](REGISTRY_TOOLS.md) Decision 1.** Sales stopped at reads because writes are a
writes-cycle decision. Payroll stops at *nothing*, because every tool surface so far reads animals
and buyers, and salaries are the first data in this repo where "who is allowed to ask the chat panel
this" is a real question. The chat panel has no notion of who is using it. Answer that before
`get_person_balance` exists, not after.

---

## 15. Still open

- **Are there opening balances?** — **unknown, ask the farm** (§4.7). Outstanding advances or a
  part-paid month are likely, and the answer decides whether the first month is verifiable end to
  end. The mechanism needs no building either way.
- **Is leave deductible?** The schema is deliberately agnostic — the wage period stores what was
  agreed — but §11's absence table needs the answer before its `paid` column means anything.
- **How is a corrected wage figure given a history?** Blocked on
  [REGISTRY_SALES.md §8](REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle)'s
  revisions table. Do not invent a second answer here.
- **Is milk above the allowance actually charged?** §4.6a says the mechanism is an `adjustment`
  payment on the wage ledger rather than a priced dispatch, which is right whichever way the farm
  behaves. Whether it is charged at all — and at which rate if so — is **unknown, ask the farm**.
- **What reference price values in-kind milk?** §12.1's package report needs one, and the honest
  candidates — the dodhi rate, the household rate, a cost-of-production figure that does not exist —
  give materially different answers. It is a report figure and never a ledger row (§4.5), so getting
  it wrong is cheap; picking it silently is not.
- **Does a benefit ever need its own effective date, independent of the term?** Today a change to the
  milk allowance is a new term with the same cash figure, which is one extra row and reads correctly
  on the timeline. If benefits start moving independently and often, this becomes wrong.
- **Should the statement say "in advance" rather than showing a minus sign?** The same wording
  question §15 already carries for buyers in credit. Answer both together.
- **`registry_wage_payments` has no `source_form`**, matching `registry_payments`, so backfilled
  payroll history is indistinguishable from live entry. Acceptable if there is no backfill; revisit
  with the opening-balance answer above.
- **Attendance from the cameras is not built and should not be.** The seam is real — a nullable
  `enrolled_identity` on `registry_people` would link to
  [farm_events.identity](../server/src/db.ts#L114), which is indexed, and would make the attendance
  digest name a person instead of `employee_3`. Two reasons to leave it: real Double Take labels
  every unknown face `'unknown'` ([FU-4](cycle-7-followups.md#fu-4)), and camera attendance driving
  somebody's pay is a trust problem well past a data problem.

---

## 16. What building it changed

Ten things. Two of them are the same failure in different clothes — a number that was
arithmetically correct and false on screen — and neither would have been caught by any test that was
written, because both were about data the tests did not have. §16.1 is a fixture; §16.7 is the live
harness, and it is the one worth reading twice.

### 16.1 A standing staff destination broke the fixture, silently

`addLabour()` creates the milk destination as **standing**, per §4.6a. `staffedHerd()` was written
the obvious way — `tradingHerd()` for the herd and its sales, then labour on top.

That produces a database whose two weeks of dispatch sessions were written **before** the staff
destination existed, so none of them names it. Nothing refuses this: `saveDispatchSession()` guards
the session it is writing, and those sessions were already written. Every test passed.

What it would have produced on screen is a package report reading **0 L taken against a 2 L/day
allowance** — a number that is arithmetically correct, looks like a serious operational problem, and
is entirely a fixture artefact. The sales fixtures hit this shape twice
([REGISTRY_SALES.md §17](REGISTRY_SALES.md#17-what-building-it-changed)), which is the only reason it
was looked for here.

The fix is an ORDER, not a patch: `staffedHerd()` deliberately does not reuse `tradingHerd()`, and
`addDispatches()` grew an `alsoStanding` parameter so the allowance rides along in every session.
Four fixture tests now pin the states that must be on screen — a current month outstanding, one
balance open, one settled, one in advance, and a milk figure to compare.

### 16.2 The invariant caught a fixture bug on its first run — in the *sales* fixture

Invariant 28 fired on the clean labour snapshot. The cause was not in the labour code: the sales
test's `dest()` helper builds destinations without a `person_id`, so the field was `undefined`, and
`undefined !== null` reads as "this destination names a person".

The fixture was wrong, not the invariant — a real row out of SQLite has `person_id === null` — so the
helper now sets it explicitly with a comment saying why. Recorded because the temptation was to make
the check tolerant of `undefined` instead, which would have masked a genuinely missing field
everywhere else.

### 16.3 A backtick inside a template literal, for the THIRD time

[REGISTRY_SALES.md §17.4](REGISTRY_SALES.md#174-a-backtick-inside-a-template-literal-twice) records
hitting this twice. Writing `` `Herd` `` inside `registry-shell.ts`'s component template — itself a
template literal — closed the string and produced three syntax errors pointing at the wrong lines.

Two cycles have now paid for this and it is still only recorded rather than prevented. The prevention
would be a lint rule against a backtick inside a `template:` string; noting it here so the next
occurrence is the one that builds it.

### 16.4 The route enumeration was deleted, on its own advice

[routes.ts](../server/src/registry/routes.ts) carried a prose list of every keyed write route. It had
said "three", then "six", then "thirteen", and its own comment conceded that *"if it disagrees with
the router below, the router is right"*.

Twelve more routes would have made it wrong a fourth time. It is gone, replaced by the rule it was
trying to illustrate — every `router.post` goes through `write()`, and `/rebuild` is the one
documented exception — plus a route test that asserts each labour write refuses a request with no
`Idempotency-Key`. A list of route paths beside the list of route paths is not documentation, it is a
second copy.

### 16.5 The version tripwires worked exactly as designed

`registry.schema.test.ts` asserts `TARGET_VERSION` against a **literal**, with a comment saying the
test is *"meant to fail when a migration is added"*. It failed, along with the two migration-sequence
tests and the backup table-classification test — four failures, each naming precisely what a new
migration has to state.

Worth recording as a success rather than a finding: the four tests that broke are the four that
should have, and none of them broke for a reason that needed thinking about.

### 16.6 Angular's required inputs are a BUILD error, not a typecheck error

`IdentifierInput` has a required `label` input. Both new screens omitted it, `tsc --noEmit` passed
clean on all three, and the failure appeared only when `ng test` compiled the templates.

Template type checking is a separate pass from `tsc`, so **a green typecheck says nothing about a
component template**. Anything that renders a component has to be built or tested, not merely
typechecked — which is the mechanical version of what
[REGISTRY_SALES.md §17.1](REGISTRY_SALES.md#171-the-two-that-only-rendering-could-find)'s two
findings said about the sales screens.

### 16.7 The allowance read as a 46 L shortfall mid-month — found by opening the harness

The first thing the harness showed on `/labour/payroll`, with everything green: **"60 L due, 14 L taken"**
against a 2 L/day allowance.

Both figures were correct. The run defaults to the whole current month, the harness clock said the
7th, and 2 L × 30 days is 60 — so the report described a 46 L shortfall consisting almost entirely of
days that had not happened yet. Every server test passed, every frontend test passed, and the screen
was false.

`payrollRun()` now takes `asOf` — a **parameter, never a clock read**, the same rule projections
follow — and a per-day expectation is clipped to `from_on .. min(to_on, asOf)`, with `through_on` and
`partial` on the row so the screen can say *"14 L due to date (through 2026-09-07)"*. A settled month
is unaffected: `asOf` past `to_on` makes the clip a no-op.

**A MONTHLY allowance is deliberately not clipped.** 20 kg of flour a month is not 4.6 kg by the 7th,
and prorating it would be the system inventing exactly the kind of figure §4.6 refuses to invent for
salaries. Only a per-day entitlement accrues daily.

This is the fourth time in three cycles that the finding was *"the code was right and the screen was
wrong"*, and the second where only running the thing exposed it. It is the strongest argument in the
repo for the harness existing at all.

### 16.8 The URL rename nearly rewrote the API documentation

Moving the screens under `/animals`, `/milk` and `/labour` meant rewriting ~84 path references across
twelve documents. The obvious find-and-replace would have been wrong twice over, and both failures
are silent:

- **Screen paths and API paths collide.** `/milking` is a screen; `POST /milking/session` is a route.
  `/dispatch` is a screen; `/dispatch/sheet` is a route. A blind rename produces
  `POST /milk/milking/session`, which documents an endpoint that does not exist. Guarded with a
  negative lookahead for a further path segment, plus skipping fenced code blocks entirely — the
  route tables all live in fences.
- **File paths look like screen paths.** `registry/calving.ts` contains `/calving`, and the lookahead
  did not exclude a following `.`, so the first pass turned the link
  `calving.ts -> ../server/src/registry/calving.ts` into
  `../server/src/registry/animals/calvings/new.ts` — a dead link to a file that has never existed.
  Nine of them, across five documents.

Both were caught by checking afterwards rather than by getting the regex right first: every
`](../…)` link in `docs/` is now resolved against the filesystem, which is a check worth keeping
whatever the next rename is. **The screen and API namespaces have now genuinely diverged** — the API
stays at `/api/registry/people` while the screen is `/labour/people` — and that is fine, but it is
the kind of thing that reads as a mistake to whoever finds it next, so it is written down here.

### 16.9 The session gate was stricter than the rule it cited, and nobody could browse

The shell wrapped the whole router outlet in `session.ready()`, so the app rendered **nothing** — not
the herd, not a statement, not `/check` — until a source form and a name were declared.

The code that says why says something narrower: *"the app REFUSES to show any FORM until both are
set."* A form. The gate had been written for the backfill, where every screen visit really was about
to write something, and it stayed that way through two cycles that added nine read-only surfaces.

Nobody noticed because nobody browses their own fixture. It took opening the app to look around.

§12.5 has the change. The part worth keeping from it: the guarantee moved from **one place that was
free** (an outlet nobody could reach) to **twelve call sites that are not**, so it is now checked by
a source-level test rather than by construction. That is a strictly worse position to be in and it is
the price of the screens being usable — the check is what stops it decaying.

### 16.10 A backtick inside a template literal, for the FOURTH time — now guarded

§16.3 recorded this as the third occurrence and said *"noting it here so the next occurrence is the
one that builds it"*. The next occurrence was ninety minutes later, in the same session, in
`registry-shell.ts`, writing a comment about `@if (session.ready())`.

There is now a test that reads every component source in `registry/` and fails on a backtick inside a
`template:` literal, with a second test that proves the check FIRES on a deliberately broken sample —
the same shape as every invariant having a test that corrupts a fixture. `import.meta.glob` reads the
sources, because the browser-targeted tsconfig the specs compile under has no node types and moving
the check into the server workspace would put it in the wrong place.

[OPEN.md](OPEN.md) carried this as a standing item across two cycles. It is closed.
