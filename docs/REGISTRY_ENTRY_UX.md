# Registry entry UX — design decisions

Status: **passes 1, 2 and 3 are built** — items 0, 1 and 2 (`v0.13.0`); items 3, 4, B2 and 5
(`v0.14.0`); items 6a and 10 (`v0.15.0`). Items 7, 8, 9 and 6b are next and deliberately undecided:
**7 and 8 are gated on the five-animal trial**, which has not run — see §11. Everything below the
cut line is decided but unbuilt. Supersedes the kickoff brief, the validation reply, and the
Q5/Q6/calf-age addendum — those three can be deleted once this lands.

Baseline was verified at `42c0ad2` (`v0.12.0-2-g42c0ad2`): server 385 tests passing, typecheck
clean, 44 registry specs across 4 frontend files. At `v0.13.0` that was server 410 and frontend 106
across 16 files. **At the close of this document: server 458, frontend 198 across 21 files**, 10 of
them registry specs. Counts move with every cycle and a run is the authority — the milking, sales and
labour documents each record their own.

Test counts and tag references in this document go stale silently. When one disagrees with a run,
the run is right.

**The backfill gate is now open.** No herd data was to enter the real registry until item 5 landed
— a rule, not an intention, because both date bugs wrote something false that nothing downstream
could detect. Item 5 has landed; see §6.6.

This document covers the entry surface only — the screens through which real herd data goes into
the registry. It does not cover read models, the agent tooling, or the farm events layer.

---

## 1. Why this exists

The registry backend is built and the registry is empty. Every `registry_*` table is at 0 rows and
`next_serial` is 1. The entry UI is the thing standing between a working schema and actual herd
data, and it is also the real test of the schema — an entry form is where a data model finds out
whether it can express what a person actually knows.

The job it has to serve is transcription: a backfill of roughly twenty animals and their calving
histories, from cycle cards and from memory, typed on a laptop by one person over a small number
of sittings. Not a phone in the shed, not offline-first, not multi-user. That constraint is
deliberate and is not relaxed anywhere in this document.

---

## 2. What was wrong with the first design

The original screens were epistemically careful and ergonomically wrong. The care is real and is
preserved throughout: provenance hoisted to session level so it is asked once, no defaults on
knowledge-state questions, the permanence of the log stated up front, disabled-submit reasons shown
next to the button, and domain truths surfaced in the copy (a stillborn calf still creates an
animal, still opens a lactation, still counts toward parity).

Three structural problems sat underneath that.

**The UI was shaped like the schema, not like the source documents.** Navigation was one page per
event type — add animal, record calving — while the paper is organised per animal (the cycle card).
Entering one cow's history meant repeatedly leaving and re-entering a context the screen never held.

**Invariants the system could enforce were delegated to the operator.** `/animals/calvings/new` asked "is the
calf already in the registry?" as a yes/no, warning that a wrong answer creates an unrepairable
duplicate. That asks a person to recall the contents of a database that is one tab away, with an
irreversible penalty, at hour two of a transcription session. Likewise "enter calvings oldest
first" is an ordering constraint held in the operator's head that a layout could hold instead.

**Checks ran after the fact.** `/check` is a batch pass over the whole registry. By the time it
runs, the cycle card is back in the drawer.

---

## 3. Principles

These govern every decision below. Where a future change conflicts with one of these, the principle
is what needs re-arguing, not the change.

**The defaults rule.** Facts the operator knows with certainty may be defaulted where a strong
prior exists — sex defaults to female, calving outcome defaults to live. Questions about the
operator's *state of knowledge* — date precision, estimation, source — are never defaulted, because
a default is how "exact day" gets applied to a guess. When it is unclear which kind a field is, ask
whether a wrong value would be a mistake or a lie. Mistakes may be defaulted; lies may not.

This rule was followed in the code but stated nowhere, and only its restrictive half was documented
(in four separate places). Both halves are now in `docs/REGISTRY.md` under "The defaults rule".

**Corollary, learned the hard way: a date assertion that matches a pattern instead of naming an
exact expected value is suspect.** Item 0 found the control emitting a fabricated `2026-01-01`, and
the reason a green suite had never noticed was that seven of the fifteen specs in `forms.spec.ts`
asserted the *shape* of the result rather than its value:

```ts
expect(req.request.body.acquired_on).toMatch(/^\d{4}-01-01$/);   // true of ANY fabricated year
expect(req.request.body.occurred_on).toMatch(/-01$/);            // true of any January the 1st
```

Both pass whatever the current year happens to be, and neither spec had entered a date at all. A
pattern is the right tool for a value the test cannot know — a generated id, a `recorded_at` stamp.
For a date the test itself supplied, it is a way of not looking. **From here on, every spec names
the date it typed.** This applies to every spec in the repo, not only the entry surface.

**Second corollary, and the more transferable one: when a fix stops the system asserting something
false, check where the truth goes.** Item 0 stopped the date control fabricating a confident value.
It did not thereby make the record honest — on the *optional* birth date the fabrication became a
**disappearance**: the operator typed a year, the form sent `birth_on: null`, and the row became
indistinguishable from one where nothing was typed. Item 5 closed that, and it existed only because
item 0 had closed the other half.

The general shape is worth stating because it will recur. **A null flowing into an optional field is
a lie of omission wearing a legitimate shape** — legitimate precisely because null is the correct,
expected, frequently-right value there, which is what makes it invisible. A fabricated value at
least looks wrong to the next reader; an absent one looks like the truth.

So the question to ask after removing a false assertion is not "is it still asserting something
false?" but "what is it asserting *instead*, and can anyone tell that apart from the honest case?"
Where the answer is no, the fix is not finished.

**Third corollary: consistency checking cannot detect a wrong rule applied evenly.** Three findings
across three passes shared a shape, and the shape is the lesson.

| Finding | Pass |
|---|---|
| `2026-01-01` and `2019-01-01` fabricated at day precision | 0 |
| `0000-01-01` from clearing a year, because `+''` is `0` | 0 |
| A calved animal under the age threshold projecting as a `calf` | 10 |
| A **lactating dam accepted as a newborn calf** in link mode | walkthrough |

**Every one of them passed every invariant.** Not because the invariants were weak — because they
were answering a different question. The schema CHECKs, `assertDatePrecision()` and invariant 11 all
ask whether the data is *consistent with the rules*, and in each case the storage conventions were
satisfied exactly. `2026-01-01` is a valid day-precision date. `0000-01-01` is a valid January 1.
An 8-month-old is genuinely under 18 months. A dam linked as a calf had one origin, a birth event, a
dam edge and a calving dated after her birth. The rule itself was wrong, and it was wrong
*uniformly*, so nothing internal to the system had anything to compare against.

The fourth one sharpened the corollary, because it came with a **measurement of the limit rather
than an argument for it.** Link eligibility is evaluated in two modules, and there is now a test
asserting they agree over a whole herd — the obvious instrument for this class. Remove the gestation
floor from the shared predicate and that test stays **green**, while only the three rule-level tests
go red: the two implementations agree perfectly on the wrong answer. A seam test finds the side that
disagrees with its neighbour and is structurally blind to a column that is evenly false. Worth
knowing before reaching for one as protection against this class again.

It also found the bug the same way the other three were found — by printing a value and reading it,
on a herd built to be *read as a herd* rather than checked as a fixture. The animal was recognisable
as a milking buffalo, and that is the only instrument that measures this.

That is the general limit. A consistency check finds the row that disagrees with its neighbours; it
is blind to a whole column that is evenly false. Only **reading a value and knowing it is wrong**
finds those — which is why:

- **Executed demonstrations are the definition of done**, not an illustration of it. Every one of
  the three was found by printing a value and looking at it, and two of them were found by writing
  the demonstration *before* the fix. None was found by review, and one had survived several
  readings of the comment directly above it.
- **A value read off a screen by someone who knows the animal is worth more than a green suite.**
  The operator looking at a milking buffalo labelled `katti` has information no invariant can
  reach. That is not a fallback for weak tests; it is the only instrument that measures this class
  of error at all, and it is why the five-animal trial in §11 is a real check and not a formality.

**Recognition over recall.** Any question whose answer is in the database is a query, not a prompt.
Where the operator must choose, linking to something existing is the default path and creating
something new is the deliberate one.

**Honest dates.** A date is stored at the precision it is actually known to. The system's inference
is always shown back for confirmation, and stated knowledge beats computed inference.

**Checks at entry, in the operator's hands.** A warning is worth most while the paper is still open.
Warnings are non-blocking where the data could genuinely be unusual, and every override is recorded.

**The record explains itself.** Append-only means the log is the explanation. Anything that
influenced a write — its source, who typed it, who saw it, and any check that was overridden —
belongs in the record.

**One screen per source document.** The layout mirrors the artifact being transcribed, so ordering
and grouping constraints are structural rather than instructed.

---

## 4. Verified baseline

Established by inspection at `42c0ad2`. Several things assumed missing in the original brief were
already built; several assumed present were not.

### Already exists

| Thing | Where |
|---|---|
| Candidate search endpoint — `GET /link-candidates`, returns every animal marked eligible/ineligible with a server-computed reason, filtered by sex, applying `definitelyBefore` | `routes.ts:187`, `reads.ts:183` |
| Storage target classification — `GET /storage`, `Target` resolves `harness \| real \| unknown`, re-probed on every navigation | `target.ts` |
| Persistent session bar on every screen, with a Change button | `registry-shell.ts:15` |
| `source_ref` column, `Provenance` field, route body parser, event-list display — but no form sends it | schema + routes |
| Per-animal timeline — `animalDetail(db, animalId)` returns animal, status and every event oldest-first, including superseded ones with a computed `superseded_by_id` | `reads.ts:110` |
| Projected parity and lactation state — `registry_animal_status` carries `status`, `parity`, `birth_on`, `birth_precision`, `open_lactation_id` | projection |
| Animal detail route `/animals/:id` with an event timeline, composer and correction form | `app.routes.ts:40` |
| Correction pattern — `supersedes_id`, partial unique index, chain-aware `supersededIds()` | events + invariants |

### Does not exist

- Any `datalist` anywhere in the app.
- Any `<form>` element in the registry. Every button is `type="button"`; the only keydown handler in
  the whole app belongs to the chat composer. Enter does nothing on any screen. The
  `role="radiogroup"` controls have no key handling at all, so they are not keyboard-navigable in
  the way their ARIA role advertises. This is an accessibility defect as well as a speed one.
- Any date parsing utility or date library. `time.ts` has `farmToday()` only. Still true — §6.6
  adds the first one, as a pure sibling module rather than a dependency.
- ~~Server-side idempotency.~~ **Built in `v0.13.0` (§6.2.)** Double-submit was confirmed possible
  by execution, not inference: the same payload twice produced `BD-0001` and `BD-0002`; identical
  notes and dry-offs produced two events. The client disabled the button while submitting, which
  stops a fast double-click on one live form and nothing else. A refresh-and-resubmit or a second
  tab still produces a permanent duplicate — that hole is uncoverable by a server-side store and is
  answered by §6.2a instead. `/animals/new` is the dangerous one: it mints a fresh serial with no calving
  flow involved.
- Any persistence of overrides. `allow_near_duplicate` and `allow_after_departure` are transient
  input flags. After the fact, an overridden write is indistinguishable from one that never tripped
  a check. Still true — item 3 (§6.4).
- Any history beyond the last result — `FormState.result` holds one, per form instance, lost on
  navigation.

### Live bug found during validation — three fabrications, not one

`precision-date.ts` initialised its internal fields:

```
protected readonly year  = signal(new Date().getFullYear());
protected readonly month = signal(1);
protected readonly day   = signal(1);
```

Validation found one path. Writing the fix's specs first, and running them against the unfixed
control, found three:

| Action | Emitted |
|---|---|
| "Exact day", touch nothing | `2026-01-01` at **day** precision |
| "Exact day", type only `2019` | `2019-01-01` at **day** precision |
| "Year only", then *clear* the year | `0000-01-01` — because `+''` is `0` |

The second is worse than the first, because typing a year and stopping is a plausible thing to do
rather than an omission. The third is worse again: it needs no fabrication at all, only a
correction that the operator abandons halfway.

**None of the three is *inconsistent*, which is why all three enforcement layers waved them
through.** The month/year/estimated storage conventions were satisfied, so the schema CHECK,
`assertDatePrecision()` and invariant 11 each had nothing to say. They were merely false, and
nothing can detect a date more precise than the memory behind it. Only the "Will be recorded as"
preview stood between the first one and the log.

This is the defaults rule being violated by the very control built to enforce it, and it was the
most serious finding of the validation pass. Fixed in `v0.13.0`; see §6.1.

---

## 5. The screens

Navigation changes from `Add animal / Record calving / Milking / Herd / Check` to
`Roster / Milking / Herd / Check`,
with the animal workbench reached from either list.

### 5.1 Roster pass

A fast list-entry screen: one row per animal, name / post no. / ear tag / sex / arrival year. Enter
moves to the next row, Tab between fields, `Cmd+Enter` opens that animal's card.

The twenty names are the one thing known cold, and typing them should not cost twenty form
submissions. Dates are the expensive, error-prone part, and mixing full date entry into the fast
pass is what makes the fast pass slow. This also populates the dam list, which the calving flow
needs before it can do anything at all.

**The arrival date problem.** "No dates at all" is unrepresentable, and this was verified by
attempting it rather than reasoned about. Invariant 3 requires exactly one origin event per animal;
`occurred_on` and `date_precision` are both NOT NULL on the event. A dateless roster animal produces
`[3] one-origin-event: animal BD-9999 has no birth or acquired event` and `[1] rebuild-fidelity:
animal BD-9999 has no stored status row`, and breaks `findOrigin`, `projectStatus` and
`linkCandidates`. It is not a schema constraint on `registry_animals` — that table has no date
column at all — but the invariants are not negotiable.

**Decision: a per-row year field, empty by default, written at `estimated` precision.** A batch date
applied across the roster was considered and rejected: it is the same failure mode as the
`2026-01-01` bug, a plausible-looking default standing in for a guess, and it would be false about
most of the herd. Four keystrokes per row on a fact the operator plausibly knows is the honest
version. No prefill, no carry-down from the previous row.

If that makes the roster pass too slow to justify as a separate screen, drop the screen rather than
the honesty.

**Writes are per-row, not batched.** Every write is already its own `BEGIN IMMEDIATE` transaction
with its own incremental projection rebuild; one bad row in a batch of twenty would roll back
nineteen good ones. Per-row posting also gives per-row inline duplicate feedback, which the screen
needs anyway.

**Duplicate detection is a query.** There is no unique index on `post_no`, `tag_no` or `name`, and
correctly so — the forms themselves state that post number and ear tag are attributes, not identity,
and change over an animal's life. Detection fires inline on typing with same/different resolution in
place.

### 5.2 Animal workbench

The primary entry surface, and a restructuring of `/animals/:id` rather than a new screen. One
animal: header with identity and derived state, full event timeline oldest-first, and an inline
composer as the last row of that timeline. Appending adds the row above and resets the composer in
place. No navigation between events.

This mirrors the cycle card, which is the artifact being transcribed. It removes the "enter calvings
oldest first" *instruction* by making ordering visible — though note it does not remove the
constraint: `recordCalving` mints the calf, so a later-discovered earlier calving still arrives
after its own consequences. The recognition-over-recall argument only fully holds once candidate
search is in, which is why that ships first.

The header needs no new computation. `registry_animal_status` already carries everything it
displays.

**The real complexity is two endpoints behind one chip row.** `appendLifeEvent` explicitly refuses
calving (`entry.ts:205`) because a calving creates an animal; `POST /calvings` returns
`{ calf_id, linked, dam, calf }` and mutates a second animal's projections. The composer needs two
submit paths, and choosing "calving" expands inline into the calf question. That is the bulk of the
work in this item.

`/animals/calvings/new` needs no backend change to work with a fixed dam — `dam_id` is a body field, and
`damCandidates` only feeds a dropdown the workbench will not have.

### 5.3 Day sheet mode — dropped

Designed to mirror a signed paper daily round. No such sheets exist on the farm. A screen mirroring
a nonexistent artifact has no purpose, so this is removed from the plan rather than deferred.

What it becomes instead is covered in §9.

---

## 6. Change list

Each item: intent, what validation established, and the decision.

### 6.1 Empty date fields, and write down the defaults rule — BUILT (`v0.13.0`)

Year, month and day start empty. The control emits `null` until every part the chosen precision
*needs* has been typed, names the missing part where the preview would otherwise be
(`data-role="incomplete"`), and **retracts** if a part is later cleared. Empty numeric inputs parse
to `null`, not `0` — `+''` being `0` was the third fabrication. The `PrecisionDate` output contract
is unchanged, so §6.6 can replace the internals without touching any consumer.

Submit blockers now read "Say how well you know the *X* date, then enter it", which is accurate for
both the no-precision and half-entered states.

**Eight specs had encoded the old behaviour, and not the eight expected.** One of the 8
`precision-date` specs (it set only a *time* at day precision and read back a complete emission),
plus **seven of the fifteen in `forms.spec.ts`**, which clicked a precision and submitted with no
date at all. Two of those asserted a pattern rather than a value — see the corollary in §3, which
is the durable lesson from this item.

### 6.2 Server-side idempotency — BUILT (`v0.13.0`)

An `Idempotency-Key` header, stored per key, returning the original result on replay. Not in the
original brief and it should have been: it is the cheapest reduction of permanent-duplicate risk,
and it covers the `/animals/new` path that no amount of calving-flow care would protect.

**Four routes, not three.** `/animals`, `/events`, `/calvings` **and
`/calvings/:eventId/correction`** — the last appends a superseding calving, a superseding birth and
sometimes a departure. Replayed without a key it does not merely duplicate: it hits the partial
unique index on `supersedes_id`, which is a raw SQLite constraint error rather than a
`RegistryError`, so it surfaces as a **500**. Cheaper to protect than to explain. `/rebuild` is
deliberately unkeyed — it appends nothing, and idempotence is invariant 0.

A missing key is a **400 `missing_idempotency_key`**, not a pass-through, because a silently
unprotected write is the failure this closes. Nothing depended on keyless writes: the CLI does not
go through these routes at all.

**Keyed on `(key, body)`, not the key alone.** The client mints a key on first submit, reuses it
while a refusal is on screen, and clears it on success. So a retry after a network fault replays,
while failed-submit → edit → resubmit has a different body and is processed as new — no client
wiring, and no "you reused a key" error to explain. Only successes are remembered: a 400 wrote
nothing, and caching a transient failure would make it permanent for that key.

**Deriving the key from the payload was rejected, and this is the reason to keep rejecting it.** Two
identical bodies really can be two animals — no name, same sex, same arrival year is the roster pass
of §5.1, not a contrived case — and silently returning the first one's result is worse than a
duplicate, because a duplicate is visible and a missing animal is not.

#### The residual holes, and where they are not covered

Storage is an in-process `Map` (bounded LRU, 500 entries, no TTL — a TTL would only manufacture a
window in which a replay silently duplicates). No migration, which is what keeps the "everything
above the cut line lands without a schema migration" claim in §10 true. The trade was deliberate:
putting request plumbing into the schema holding the one set of unrecoverable records, to close a
window measured in seconds on a single-user localhost app, is a bad bargain.

What that leaves open:

1. **Keys die with the process.** A restart between a write and its replay loses the key.
2. **`npm run dev -w server` is `tsx watch`**, so the server restarts on *every file save*. Not a
   hazard mid-transcription — nobody edits source while typing a herd in — but real during
   development, and the most likely way to see a duplicate while working on this code.
3. **A page refresh, or a second tab, is uncoverable by any server-side store.** Both get a fresh
   `FormState` and therefore a fresh key. This is not a gap in the implementation; it is what a
   client-minted key cannot do, and the alternative that would cover it is the payload-derived key
   rejected above.

Hole 3 is the one that matters, because `/animals/new` is where it mints a permanent duplicate with no
calving flow involved — which is the risk that justified deferring merge (§8). It should not sit
open across the whole backfill, so it has an answer immediately below.

If this app ever grows a second writer or a real deployment, storage is the first decision to
revisit.

### 6.2a Near-duplicate detection on `/animals/new` — BUILT

The answer to hole 3. Idempotency cannot see a refresh-and-resubmit or a second tab; a **query
can**, because the duplicate it would create is sitting in the database by the time the second
submit happens.

**A soft warning, never a refusal.** Recently-added animals matching on some combination of name,
post no., tag no. and sex are surfaced at entry — "is this a new one?" — with a one-click way to
open the match and check.

**Soft is load-bearing, not a hedge.** The roster case is real: no name, same sex, same arrival
year, genuinely two animals. That must stay possible with no friction beyond acknowledging the
warning. A hard block here would force the operator to invent a distinguishing detail, which is the
same dishonesty the precision rules exist to prevent.

**Built where item §5.1 inherits it**, the way `calf-picker.ts` was built for §5.2. The roster pass
needs exactly this query for its inline duplicate detection, and writing it twice is how the two
drift.

#### The match rule

Any one of these makes an animal a candidate:

| Signal | Comparison | Sex must match? |
|---|---|---|
| `post_no` | equal, trimmed, case-insensitive | no |
| `tag_no` | equal, trimmed, case-insensitive | no |
| `name` | equal after normalising — lowercased, trimmed, internal whitespace collapsed | yes |
| `name` | near-equal: edit distance ≤ 1 on the normalised form, or one is a prefix of the other with at least 3 characters | yes |

**Why name matches require the same sex and identifier matches do not.** A shared name across sexes
is far more likely to be two animals than one duplicate — names repeat on a farm. A shared
`post_no` across sexes is not; it is either a duplicate or a real collision on a working
identifier, and both are worth surfacing. The near-equal rule is what catches `abdul` / `abdul_r`
and `Kali` / `kali`, which is the same free-text drift §6.5's `datalist` addresses from the other
end.

#### The recency window: none. Age is shown, not filtered on

**Match against the whole registry, with no cutoff.** The memory that actually fails is "did I
already enter this one?", and that fails across sittings rather than within minutes — so any cutoff
short enough to be called a window would miss the case worth catching.

This was originally specified as a *recency window*, with a number to be proposed. The window is the
wrong instrument: it filters on the axis that carries the information. Showing the age and letting
the operator read it keeps the same signal and discards nothing. At twenty to a couple of hundred animals a full scan is
free, and the query is bounded by the herd, not by time.

What is shown instead of filtered is **how long ago each match was typed**: "added 4 minutes ago",
"added yesterday". A match from minutes ago is almost certainly the refresh-and-resubmit this item
exists for; one from last week is a question worth a moment. The operator can tell those apart at a
glance, and neither is hidden.

The age comes from the animal's **origin event's `recorded_at`**, not from a column on
`registry_animals` — that table has no timestamp, deliberately, and `recorded_at` is the honest
source anyway: it is when the row was *typed*, which is what "recently added" means here, rather
than when the arrival happened.

Revisit only if the herd passes roughly 500 animals, at which point the name comparison wants an
index and the scan wants a cutoff. Noted in the code rather than pre-optimised for a herd size this
farm does not have.

#### As built

`GET /duplicate-candidates`, and `duplicate-warning.ts` as its own component so §5.1 inherits it —
it takes `excludeId` for the row being edited, which `/animals/new` does not need but the roster pass does
(without it, every keystroke would flag the row as a duplicate of itself). Demonstrated over HTTP:

```
--- the refresh-and-resubmit hole idempotency cannot see ---
first submit                  -> BD-0001
after a refresh, before saving -> warns about BD-0001 (same post no. '12')

--- the match rule ---
exact name + sex    -> BD-0001 via name_exact
case/space variant  -> BD-0001 via name_exact
one edit off        -> BD-0001 via name_near
prefix (abdul_r)    -> BD-0001 via name_near
same name, male     -> no warning
post no., male      -> BD-0001 via post_no
unrelated name      -> no warning
nothing typed       -> no warning

--- soft: two genuinely different animals are not obstructed ---
two nameless, same sex/year   -> BD-0002 BD-0003 | warnings: 0
```

The last block is the one that matters most. Two nameless animals of the same sex and arrival year
are entered with no warning and no friction, because there is nothing to match on — and even had
there been, nothing is blocked: no disabled submit, no checkbox to acknowledge.

**There is no dismiss button, and that is the anti-reflex-click principle rather than an omission.**
It is the same argument that keeps the target attestation off the harness (`target.ts`) and keeps
`/check` from having a badge that turns green: anything you clear by clicking becomes furniture, and
then it is not a warning. This one clears by the input ceasing to match — so the only way to make it
go away is to change what the registry is being told, which is the thing worth doing.

Two implementation notes worth keeping:

- **The prefix rule, not edit distance, is what catches `abdul` / `abdul_r`** — two characters were
  added, so the distance is 2. `MIN_PREFIX` is 3, or `a` would match every name starting with an a.
- **The recency tie-break is a DESCENDING serial.** `recorded_at` has millisecond resolution, and
  two animals from a double-submit land in the same millisecond often enough that a flaky test
  caught it — at which point an ascending serial put the *older* animal first, contradicting the
  whole ordering. Serials come from a monotonic counter that never reuses, so a higher serial is
  always the later one.

### 6.3 Candidate search replaces the yes/no binary — BUILT (`v0.13.0`)

`/link-candidates` already computed eligibility, the "dam is unset" condition, and `birth_on` /
`birth_precision` per candidate. What was missing was proximity ranking: `days_apart: number | null`
(signed, so a UI can say "3d earlier" / "3d later") and `within_match_window`.

`recordCalving` needed no change — link mode was already a first-class branch via
`calf.existing_id`, and the whole mint-birth-departure-projection sequence runs in one transaction
with test-only fault injection at six points.

**Match window, by the coarsest precision of the two dates:**

| Coarsest of the two precisions | Window |
|---|---|
| both day | ±7 days |
| either month | ±45 days |
| either year or estimated | same calendar year, ±1 year |
| candidate has no birth date | always in window, ranked first |
| outside the window | still returned; collapsed behind a visible count |

The windows widen with uncertainty because that is what uncertainty means: two month-precision dates
both stored on the 1st can be 30 days apart and describe the same week, so a day-grain window would
hide the right animal. The values are provisional in the sense `CALF_MAX_AGE_MONTHS` is, and chosen
generous — a candidate you scroll past costs nothing, one that never appears costs a duplicate.

**`estimated` is compared here, at year grain.** That is a deliberate divergence from
`definitelyBefore()`, which refuses to compare an estimated date at all. That function *proves* a
timeline violation, so a guess is not evidence and it declines; this one *suggests* a match, where a
guess is exactly what you want to act on. An animal recorded as "estimated 2019" is a fine candidate
for a 2019 calving. Same two dates, opposite correct answers, because proving and suggesting are
different jobs.

**Ordering — three keys, and eligibility is the first of them.**

1. **Eligible before ineligible.** An ineligible row at the top of a recognition list is a target
   the eye lands on and the hand cannot click. Ineligible animals stay in the list, with the
   server-computed reason, because "already has a birth event, so it already has a dam" teaches
   something that hiding the row does not — but they sit below the animals that can be picked.
2. **No birth date before any birth date.** An animal entered in the roster pass without one is the
   likeliest link target there is, and a proximity filter would rank it nowhere.
3. **Closest first**, by absolute `days_apart`. Then serial, so the order is total and two calls
   agree.

These are different populations and the sort does not conflate them: an *eligible* acquired animal
with no birth date still ranks top, which is the case the second key exists for.

**Nothing is hidden.** Out-of-window animals are returned by the endpoint and collapsed by the
client behind a count that is always on screen — "3 more, with birth dates further from this date".
An animal silently absent from a picker reads as data loss to the person entering the herd, who
stops and goes looking for it.

**The list lives in `calf-picker.ts` as its own component**, not as markup inside the calving form,
because §5.2's workbench needs the same list with the dam fixed by context. It does not re-sort —
the ranking is a server rule, the same argument as `ineligible_reason`.

The warning about unrepairable duplicates is **gone, not softened**. The list is the mitigation, and
a warning that no longer names a live risk trains operators to skim warnings — the same reason
`/check` has no badge that turns green.

**One consequence worth knowing before touching that form.** The list now has to *arrive on its
own*, driven by an effect on dam, date and calf sex, and a change to any of those invalidates the
selection. Both were implicit in the deleted click: the fetch was triggered by "yes — link to it",
and an unfetched list renders as "no animal in the registry has a birth date near this calving" —
a false statement about the herd, shown to exactly the person deciding whether to create a
duplicate. Expect the same class of surprise in §5.2, which deletes more triggers than this did.

### 6.4 Persist overrides — BUILT

`allow_near_duplicate` and `allow_after_departure` were transient, so an overridden write left no
trace of having been overridden. In an append-only log whose premise is that the record explains
itself, that was a provenance hole.

The effective event now carries `override: { check, reason }` in its payload — payload rather than a
column, which keeps the no-migration property; the reasoning is in `types.ts` and in
[REGISTRY.md](REGISTRY.md) § "An overridden check leaves a trace".

**The load-bearing detail is that it is recorded from the CONDITION, not from the flag.** A caller
passing `allow_*` unconditionally must not have every write claim an override, or the field carries
no information and the log is worse than when it said nothing. Demonstrated by execution:

```
flag + tripped    -> override: check=near_duplicate_calving reason="twin, confirmed…"
flag, no reason   -> override: check=near_duplicate_calving reason=null
flag, NOT tripped -> override: null
```

`reason` is optional and stays so: requiring prose to clear a guard makes it a wall, and the
operator types "yes", which looks like a reason and is worse than a blank. `note` has no override
field at all — it is always allowed after a departure, so there is no guard to step past. A
correction records its own override and does not inherit the superseded event's.

The UI captures the reason in the existing "Record it anyway" blocks and shows recorded overrides on
the timeline row, because a fact nobody reads is barely better than one never stored.

### 6.5 Smaller items — BUILT

- **`datalist` of previously-used values** on `observed_by`, `acquired_from` and `sire_ref`. Free
  text across a hundred records produces `abdul`, `Abdul` and `abdul_r` — three identifiers for one
  person, which makes "everything Abdul observed" unanswerable and cannot be repaired later without
  guessing which spelling was meant.

  `GET /identifier-values` reads them from the **event log**, not a lookup table, because the log is
  the only source of truth and a table would be a second one to keep in sync. Superseded events are
  included: a name on a corrected event is still a name in use on this farm. **Case variants are
  both listed** — collapsing `abdul` into `Abdul` would hide from the operator that two spellings
  are already in the log, which is precisely the thing worth seeing.

  A `datalist` rather than a `<select>`, because a select forces every new person through an "add
  new" flow, which is how a name ends up typed into the wrong field to get past it. The list is
  refreshed **after** each write, which is the whole point: a name typed on animal four has to be
  offered on animal five.

- **`observed_by` guidance unified.** It had three treatments across three forms — "leave blank
  unless someone actually saw it" on `/animals/new`, a bare "(optional)" on the other two — while
  `recorded_by` was the only field told to be a stable identifier and not a display name. That one
  piece of guidance is what prevents the `abdul`/`Abdul` split, and it was on none of them. All
  three fields now share `identifier-input.ts`, so the wording cannot drift again — the same
  argument as computing `ineligible_reason` on the server.

- **`/animals/calvings/new`'s empty state links out.** It was a dead end while `/animals`'s already had a CTA to
  `/animals/new`; the asymmetry was the bug — the same nothing-yet state, one screen offering the next step
  and the other not. Built rather than skipped: §5.2 folds `/animals/calvings/new` into the workbench composer
  rather than deleting the flow, and "no females exist yet" stays reachable on a fresh database
  however the herd gets entered, so a one-line link is cheaper than reasoning about whether a later
  item removes it.

- **The duplicated explainer.** An `explain` input on the shared control, defaulting **true** so a
  single-control form keeps the full text without asking. `/animals/new`'s second control sets it false.
  Only the one-sentence *rationale* is gated — the per-precision hints stay on every control,
  because "Stored as the 1st" is specific to the control it sits under and earns its place there.

### 6.6 Smart date field — BUILT

One text input. `2019` → year, `Mar 2019` → month, `6 Jul 2023` → day, plus ISO at both grains.
The parser is `date-parse.ts`, a pure sibling module with no dependency — the repo has no date
library and this adds none.

**Precision is read, not asked, and the old guarantee survives inverted.** The segmented control's
real property was that there is no way to type a full date and then downgrade the precision. That
still holds, for the simplest possible reason: the day is absent at month precision because you did
not type one. **The inference cannot be overridden upward** — there is no control anywhere that says
"treat this as an exact day", because one would rebuild the fabrication §6.1 closed. To get day
precision you type a day, and retyping is the only escape.

**The reading is always shown back**, since an inference the operator cannot see is a default by
another name: *"reading as month only — 2019-03, stored as the 1st"*.

**The "Estimated year" relabel became a checkbox**, which says the same thing more directly: "Even
the year is a guess", **disabled with its reason visible** on anything but a bare year — an estimate
stores January 1, so a specific day at estimated precision is the fabricated day the write boundary
rejects by name. A stale tick cannot alter a month or a day; the parser ignores it above a year.

**Ambiguous numeric dates are refused, uniformly.** `06/07/2023` and `25/12/2023` alike, because
accepting the unambiguous ones teaches a habit that breaks silently the first time the day is under
13. ISO is matched *before* the slash rule, so the escape the message offers is never itself
refused.

#### The half-entered OPTIONAL date — closed

§6.1 fixed the required date. The same class survived one step over, on an optional one, and worse:
§6.1 was a **fabrication**, this was a **disappearance**. The operator typed a birth year, the form
sent `birth_on: null`, and the record became indistinguishable from one where nothing was typed. A
fabricated date is at least visible to the next reader; a vanished one is visible to nobody, ever.

Worth stating plainly: **§6.1 is what created this.** Before it, a half-entered birth date was
fabricated into a confident value; after it, the control emitted `null` and the form sent nothing.
Fixing the fabrication converted it into a disappearance, which is why this had to follow.

The cause, in the code at `v0.13.0`:

```ts
canSubmit = computed(() => this.acquired() !== null && !this.state.submitting());
// ...
birth_on: b?.occurred_on ?? null,
```

`canSubmit` never consulted the birth date at all, and both "not started" and "not enough typed"
arrived as `null`.

**The fix is a three-state output** — `empty | incomplete | complete` — and one shared
`dateBlocker(entry, { label, required })`, so three forms cannot disagree about the one case each
would get wrong alone. `required` decides only whether **empty** blocks; **incomplete blocks either
way**. Demonstrated by execution:

```
  birth field ""                     -> birth_on=null birth_precision=null
  birth field "2017"                 -> birth_on="2017-01-01" birth_precision="year"
  birth field "06/07/2023"           -> BLOCKED — nothing sent
                                        The birth date is not understood yet — finish it or clear it.
  birth field "sometime in spring"   -> BLOCKED — nothing sent
                                        The birth date is not understood yet — finish it or clear it.
```

Row one is the honest null: nothing typed, nothing claimed. Row two is the value surviving. Rows
three and four are the disappearance closed.

#### The backfill can start

**This was the last gate.** The two date bugs both wrote something false that nothing downstream
could detect, and both lived in the one control every entry surface goes through. §6.1 closed three
paths through it; this closes the fourth and replaces the mechanism, so the rule in the header is
discharged: real herd data can now go into the real registry.

### 6.7a Keyboard retrofit on the existing screens — BUILT

`<form>` elements, Enter-submit, one tab stop per chip group, and a post-submit contract.
**Row navigation is not here** — Enter-to-advance between rows belongs inside §5.1's own design,
because it is that screen's premise rather than a retrofit onto it.

**There was no `<form>` element anywhere in the registry**, and every button was `type="button"`,
so Enter did nothing on any screen. All five surfaces are forms now, submitting on the **native**
`submit` event with `preventDefault()`. Not `(ngSubmit)`: that is an output on FormsModule's
`NgForm` directive, so without importing FormsModule it binds to nothing and the form falls through
to a real browser submission that reloads the page. Caught by the specs, which saw zero requests.

**`chip-group.ts` replaces five hand-rolled radiogroups.** They carried `role="radiogroup"` with no
key handling at all, which *advertised* arrow-key navigation to anything reading the ARIA and
delivered a row of independent tab stops instead — an accessibility defect as much as a speed one.
One component now: roving tabindex so a group is **one** tab stop, arrows that move and select
together, Home/End, and **digit accelerators that are printed on the chips** — a shortcut nobody can
see is a shortcut nobody uses. First-letter selection too, but only where it is unambiguous;
guessing between two labels sharing a letter moves the selection somewhere nobody asked for.

Item 5 shrank this item considerably by deleting the four-way precision control, which was the
largest radiogroup, and collapsing four date inputs into one.

#### The post-submit contract, and why it is the interesting part

**Twenty animals through a form is not twenty times eight fields — it is twenty round trips:**
submit, wait, read the result, clear the fields, put the cursor back, scroll up. A list is one
continuous typing motion. The field count was the wrong measure.

So the round trip is what this collapses. After a write:

1. **The per-animal fields clear.** `sex` deliberately survives — strong prior, and consecutive
   animals in a backfill are usually the same sex. On `/animals/calvings/new` **the dam survives**, because a
   cycle card is one animal's whole history and the next calving entered is almost always hers.
2. **Focus returns to the first field** of the next record, deferred a frame — focusing before the
   clearing render lands on an element Angular is about to replace, and focus falls to
   `document.body`.
3. **The write is announced** by serial, in an `aria-live="polite"` region and a persistent line in
   the shell. A cleared form is *ambiguous*: it looks exactly like one never filled in. Polite
   rather than assertive because it must not interrupt typing, which is the whole activity.

None of the three happened before: `/animals/new` kept the last animal's values, left focus on the submit
button, and reported success only in a panel below the fold. Submitting twice in a row would have
produced a near-duplicate — now also caught by §6.2a, but a form that invites the mistake is not
fixed by a warning about it.

### 6.7b Keyboard pass, remainder — NOT BUILT

Whatever the five-animal trial shows is still missing. Deliberately left open rather than guessed.

### 6.8 Session band

Two of the three original bullets survive.

- **In-place source and `recorded_by` change.** The Change button currently clears the session and
  returns to the gate; make it editable in place.
- **`source_ref` capture.** The column, the `Provenance` field, the route parser and the event-list
  display all exist. Only the capture UI is missing. Without it, provenance records that something
  came from *a* cycle card rather than *this* one, and in eighteen months it cannot be re-checked
  against the paper.

**Rejected: replacing the gate attestation with an ambient colour band.** The original argument was
that a one-time checkbox becomes a reflex click. True, but the counter is stronger and the repo had
already made it (`target.ts:18-24`, `session-bar.ts:8-11`): a permanent alarm colour becomes
furniture, which is also why `/check` has no green badge. The decisive detail is the asymmetry —
the attestation is deliberately *not* shown on the harness, so it cannot become a habit that gets
clicked through. Keep the gate acknowledgement and the plain statement in the band, and add the
sheet reference to the gate.

---

## 7. Domain model

### 7.1 Terminology and life stage — FEMALE SIDE BUILT

Local terms and their boundaries:

- **katti** — female calf, from birth
- **choti** — grown female that has not yet calved
- **majj / bhains** — female that has calved

These map exactly onto calf / heifer / cow, so the existing status enum was already correct. Two
boundary rules were not.

**1. `CALF_MAX_AGE_MONTHS` is 18, not 12.** It is the scheme's **only** age threshold; every other
boundary is derived from events the registry already holds.

**2. Parity is checked BEFORE age, and the opposite order was a live bug.** The cow boundary is
`parity >= 1` and nothing else — a choti becomes a majj by calving, and no amount of age does it.
The age rule used to be evaluated first, so an animal that **had calved** projected as a `calf`
whenever its recorded age fell under the threshold. Measured before the fix, at the old 12:

```
 8 months old, parity 0              -> calf
 8 months old, parity 1 (HAS CALVED) -> calf     <-- wrong
```

And after, at 18:

```
 8 months old, parity 1 (HAS CALVED)  -> lactating
15 months old, parity 0              -> calf
 5 years old, parity 0 (old maiden)  -> heifer
```

Buffalo gestation is about 310 days, so that combination is unreachable by biology. It is very
reachable by a **birth-year typo during a backfill**, which is exactly what this application is for
— and raising the threshold to 18 *widened* the window. The consequence was a milking animal
displayed as a katti, which is the kind of wrong that makes an operator distrust the whole screen.

Note the case most likely to expose an age-contaminated cow boundary — an animal old enough to look
like a majj who has never calved — was **always right**, because rules 2 and 3 cannot fire at parity
0. The bug ran the other way.

**The local terms are displayed; the stored enum does not move.** `RegistryAnimalStatus` is what
every projection and invariant is written against and two of its values are baked into demo tool
`input_schema`s, so renaming it would be a repo-wide breaking change to achieve a UI improvement.
`life-stage.ts` is a display mapping, and the stored value is on the element's `title` so the screen
never hides it from anyone debugging.

**`lactating` and `dry` are both `majj`**, shown as "majj · in milk" and "majj · dry": she has
calved either way, and drying off does not undo that. The stage and the milking state are different
facts and neither replaces the other.

**The male side is deliberately untouched.** katta / jhota is unconfirmed, and on a dairy where
bulls leave young it may not need a boundary at all. A guessed local term is worse than the English
one, because it reads as authoritative to the next person. Still open.

**The age boundary remains overridable in principle and is not built.** The real katti→choti
transition is physical — she gains weight and features — not arithmetic. 18 months is the default
inference; an explicit override event is an open item, as is how boundary ambiguity should surface
when birth precision is year-only or estimated.

**Anyone with stored projections must run `registry:rebuild`** after this change: status is
`asOf`-dependent and the rule order moved. Moot today — the registry is empty — but it is a real
invariant-1 violation if it is skipped.

### 7.2 Calving interval bands

Buffalo gestation runs about 310 days, so an interval under roughly 330 days is impossible rather
than implausible, and a plausible minimum is gestation plus realistic days-open. Nili-Ravi intervals
in smallholder systems commonly run 450–550 days and often longer, so a long gap is not by itself
suspicious. For a backfill from recall, the error actually produced is an *omitted* calving, not a
compressed one — which makes the long-gap check the valuable one and the short-interval check nearly
dead code.

| Band | Behaviour |
|---|---|
| < 60 days | Hard refusal, unchanged — but relabel it. It is a double-entry guard, not a biology rule |
| 60–340 days | Warn: shorter than a buffalo gestation, so one of these two dates is likely wrong |
| 340–380 days | Note: unusually short but possible |
| 380–700 days | Normal, no message |
| > 700 days | Warn: a calving may be missing from this animal's record |

All four non-refusal bands are provisional. Mark them as such the way `CALF_MAX_AGE_MONTHS` is
marked, and keep them in one named constant block so they can be retuned without hunting call sites.

Note that the existing mechanism is hard-refusal-with-explicit-override
(`DOUBLE_ENTRY_WINDOW_DAYS = 60`, `calving.ts:37`), not soft warning. These bands introduce a second
mechanism alongside it; the bands are chosen not to overlap so each rule has exactly one behaviour.

---

## 8. Deferred, with reasons

**Inline soft checks and the dry-run endpoint.** `/check` runs `checkSnapshot(snapshot(db), asOf)`,
a pure batch pass over the whole registry, with all rules in the backend and zero frontend
duplication — which is deliberate (`form-state.ts:4-15`). Reusing them per-record needs per-animal
rule variants plus a dry-run endpoint that validates a proposed event without writing it. That is
the clean shape, and it is more work than it first appeared. `/check` covers this today, worse but
adequately. The override-persistence half of this item was split out and promoted (§6.4).

**Merge / supersede.** Large, and it does not go first. The existing `supersedes_id` pattern does
not fit — invariant 9 explicitly rejects supersession across animals, so merge needs its own event
type. What breaks: invariant 3 (a survivor absorbing a duplicate's events has two origins);
`registry_animal_status.status` has no "merged" value while invariant 1 requires a stored status row
for the loser; `registry_parentage.parent_ref` may name the loser as a dam, which still resolves and
so passes invariant 7 while reporting the wrong dam. The expensive one is that the projection's unit
of aggregation changes from animal to merge cluster — a calving on the loser now closes a lactation
opened on the survivor — so every `rebuildAnimals(db, { animalIds: [id] })` call site must fan out or
silently produce a stale survivor. One piece of luck: lactation ids derive from the opening calving
event id, so they stay stable across a merge.

The decisive argument for deferring is recovery cost. With the registry tables at zero rows, a bad duplicate
in session one is repaired by dropping the file and re-entering twenty animals — an evening. Merge
becomes worth its size when re-entry costs more than building it. Until then, prevention (§6.2,
§6.3, §6.5) is the cheaper protection.

**Splitting precision from estimation.** Rejected. `estimated` stores January 1 identically to
`year` (`schema.ts:274`), so it already *is* estimated-year, and the help text describing it was
accurate. The two axes are genuinely distinct — `year` means the year is known, `estimated` means it
is a guess — but the schema supports that pairing only at year granularity, and the only missing
cell is estimated+month. Splitting would loosen a constraint added one migration ago and argued for
by name (`events.ts:389`: "A specific day at estimated precision is a fabricated day wearing a
humility label"), and it buys nothing for the invariants, since `definitelyBefore` treats estimated
dates as non-comparable (`invariants.ts:74`).

**Decision: relabel the option "Estimated year".** One line, no migration, no loosening. Revisit only
with a real transcription case that needs estimated+month.

---

## 9. Direction: the daily workflow

The intended end state is the app generating the daily record rather than transcribing one. This is
a later cycle and is explicitly out of scope now — a daily round needs a populated herd to attach
anything to. Recording the direction here so the current work does not foreclose it.

Three things change when that line is crossed:

**The device constraint.** A daily round happens at the animals. Either the app goes mobile and
offline-capable, or the round is captured on paper at the shed and typed in the evening — which is
transcription again, and puts a paper daily sheet back into existence. This is a deliberate choice,
not a drift: does the app replace paper, or ingest it? A farm with staff who do not use apps usually
wants the second.

**The provenance model inverts.** `direct entry` becomes the dominant source instead of the rare
one, `observed_by` becomes the primary provenance field rather than a nearly-unused one, and today's
date becomes a legitimate default — because today is a fact, not a guess.

**New event types.** Milk yield per animal per session, feed, health and treatment, and above all
heat, service and pregnancy check. Breeding events are the significant gap: without service dates a
long calving interval can be observed but never explained.

Two constraints to respect in the meantime: keep `source_form` and `source_ref` genuinely per-event
rather than session constants in disguise, and do not simplify away `observed_by` on the grounds
that it is currently always blank.

---

## 10. Build order

Everything above the cut line lands without a schema migration. **This claim survived pass 1** —
idempotency keys live in an in-process `Map` precisely to keep it true (§6.2).

**Pass 1, done — tagged `v0.13.0`:**

| # | Item | Size est. | Actual |
|---|---|---|---|
| 0 | Empty date fields + defaults rule in docs (§6.1) | XS | XS to fix, S with the spec fallout |
| 1 | Server-side idempotency keys (§6.2) | S | S |
| 2 | Candidate search replaces the binary (§6.3) | S | **M** — see below |

**Pass 2, in order:**

| # | Item | Size |
|---|---|---|
| 3 | Persist override flags (§6.4) | S |
| 4 | Smaller items — datalists, `observed_by` wording, empty-state link, explainer (§6.5) | S |
| B2 | Near-duplicate detection on `/animals/new` (§6.2a) | S |
| 5 | Smart date field + "Estimated year" relabel + the half-entered optional date (§6.6) | M |

**Pass 3, done:**

| # | Item | Size |
|---|---|---|
| 6a | Keyboard retrofit on existing screens + the post-submit contract (§6.7a) | M |
| 10 | Life stage, female side: 18 months, parity-driven cow boundary, katti/choti/majj (§7.1) | S |

**Next, and deliberately undecided:**

| # | Item | Note |
|---|---|---|
| 7 | Roster pass (§5.1) | **Gated on evidence.** Five animals through the retrofitted `/animals/new` first — see §11 |
| 8 | Animal workbench + last-five-written strip (§5.2) | Treat its M as optimistic; see below |
| 9 | Session band: in-place change + `source_ref` capture (§6.8) | S |
| 6b | Keyboard remainder (§6.7b) | Whatever the five-animal trial shows is missing |

— cut line —

| # | Item |
|---|---|
| 11 | Inline soft checks + dry-run endpoint + interval bands (§7.2, §8) |
| 12 | Merge / supersede (§8) |
| — | Daily workflow (§9) — separate cycle |

### Why item 2 came in at M, and what it predicts

The `days_apart` and sort work *was* small, as estimated. What was not costed is that **deleting the
yes/no removed the trigger the whole flow hung off.** Two behaviours that had been implicit in a
click had to become explicit — fetching the list, and invalidating the selection when the dam, date
or calf sex changes — and neither was visible until the click was gone.

That is a general shape, not a one-off: **replacing an interaction costs more than adding one,
because the interaction being removed was carrying state transitions nobody wrote down.** Items 5,
7 and 8 all replace interactions. §5.2 in particular deletes more triggers than §6.3 did, so treat
its M as optimistic and re-size it once item 7 has shown whether the pattern recurs.

### Sequencing reasons

0 was a live bug in the control everything else touches. 3 and 4 are independent and cheap. B2 sits
before 5 because it closes the `/animals/new` duplicate hole (§6.2, hole 3) that would otherwise stay open
across the whole backfill, and because §5.1 inherits its query. 5 was last in pass 2 and gated the
backfill (§6.6).

**6a came before 7, which inverts the original order, and for a reason the original did not
anticipate:** once §6.6 landed the gate opened, so 7 no longer unblocks anything — the backfill can
start on `/animals/new` and `/animals/calvings/new` today. What 6a makes bearable is therefore *the entry that is about
to happen*, not a screen that does not exist yet. And 7's own keyboard needs are intrinsic to it:
"Enter moves to the next row" is that screen's premise, not a retrofit onto it.

**10 was pulled forward out of 8**, because a wrong life stage on every young animal — on the one
screen the operator is about to live in — is not something to look at for a week. Pulling it forward
is what surfaced the parity/age ordering bug, which no amount of reading the header comment had.

8's M is optimistic: it deletes more implicit triggers than §6.3 did, and §6.3 is what taught us
that replacing an interaction costs more than adding one. Re-size it after 7 is decided.

### Test budget

Keep the `data-role` selector convention; it is consistent across every component and is what makes
the frontend specs cheap to maintain. Items 5, 6 and 8 all rewrite code beneath existing specs.

Two conventions established in pass 1 that pass 2 onward depends on, both recorded in
[DEVELOPMENT.md](DEVELOPMENT.md) § 5 rather than only in the file that discovered them:

- **`settle()`, not `whenStable()` alone.** A promise chain started in a component *constructor*
  needs a macrotask tick before the DOM reflects it. `CalvingForm` asks for its dam list there, and
  without the tick the form still renders its empty state and every selector returns `null`. Items
  5 through 8 will all hit this.
- **Name the date a spec typed; never assert its pattern.** See the corollary in §3.

## 11. Still open

### The five-animal trial — predictions on record

Five animals go through the retrofitted `/animals/new` and `/animals/calvings/new` before §5.1 (roster pass) is decided:
the murkiest dates and the longest calving histories, deliberately the hard cases. **None of the six
predictions below has been fixed**, including the one-line ones, because fixing them costs an
uncontaminated read on the decision they inform. They are recorded before the trial so the outcome
can be told apart from taste.

Ranked by expected likelihood of actually biting:

1. **`acquired_from` in the tab path.** It sits between `name` and `post_no`, inheriting the identity
   grid's DOM order, and on a recall backfill it is the least-known of the three. One wasted Tab per
   animal, on the field reached for most.
2. **Overshooting the arrival date into the birth date.** The two `date-text` inputs are adjacent in
   the tab order with only a legend distinguishing them, identical placeholders, and the pause to
   think about a murky date falls right there. Visible via the reading line, but still a stumble.
   **The fix is not obvious, which is why it was not applied blind.**
3. **Ten tab stops, about half of them empty.** `acquired_from`, `tag_no` and `observed_by` are blank
   for most backfill animals. This is the specific friction that would argue for a list.
4. **`/animals/calvings/new`'s surviving dam being quietly wrong** when moving from one animal's card to the next.
   Recoverable via the candidate list and the near-duplicate guard, but it will read as a trap.
5. **The write announcement being too quiet** — a thin green line in the shell, with focus back in
   `name` and eyes on paper.
6. **`Cmd+Enter` doing nothing.** §5.1 specifies it; the retrofit does not have it.

Two predicted to feel *better* than expected, so the comparison stays honest: the printed digit
accelerators on sex and outcome, and the single date field on murky dates (`2019`, `Mar 2019`).

**Decision rule.** If 1 and 3 are the only real complaints, both are small fixes to `/animals/new` and a
roster screen is redundant. If 2 recurs, or if the round trip still feels like a stop-and-restart
rather than a continuation, build §5.1 — those are properties of the form *shape*, which no tab-order
work reaches.

#### Two answers held against the report, not built

- **Prediction 4 has a third option neither of us proposed:** keep the dam *and* land focus on it
  after a write. Continuing costs one Tab, switching costs nothing extra, and the silent-wrong case
  disappears because the eye is already there. Strictly better than either clearing it or leaving it
  silent. Held until the trial says whether it bit.
- **Prediction 5 may be item 8's "last five written" strip arriving early as a symptom.** If the
  announcement is too quiet, the answer is likely to pull that strip forward rather than make the
  line louder — a louder line is a bigger version of the wrong instrument.

#### Pre-trial amendment — 2026-09-04, at `v0.15.0-3-g212dfe0`

Recorded **before** the trial runs, not reconstructed after it. A separate refinement document
(`docs/archive/REGISTRY_UI_REFINEMENT.md`) was written against screenshots without repo access, then
validated against the code. Most of it fell to things already built; two defects survived and were
fixed, and both touch surfaces this trial measures. Frontend suite at the time of writing: **198
tests across 21 files**, up from 106 across 16 at `v0.13.0`.

**Two contaminations, both one-directional.** This matters more than the fact of the contamination:
the trial is not uniformly compromised, and reading it as if it were would waste it.

| Fix | Prediction it touches | Clean reading | Confounded reading |
|---|---|---|---|
| `:host{display:block}` on the registry components — component hosts are `display: inline` by default and vertical margins do not apply to inline boxes, so every `space-y-*` container was silently contributing nothing between a component and its siblings | **2** (overshooting the arrival date into the birth date). The two `/animals/new` date fields were flush against their neighbours | **If it still bites** — the defect was removed and the problem survived, which is *stronger* evidence than before that the fix is in the form shape | **Only a null result.** Part of the reason may be the spacing rather than the design being sound |
| `calfSex` default removed on `/animals/calvings/new` (starts unanswered, gates the picker, clears after a write). It was `female`, and the value filters `linkCandidates` — a guessed default greys out the right calf and leaves "create a new animal" as the only reachable path | **"Printed digit accelerators on sex and outcome"**, one of the two things predicted to feel *better* than expected. The accelerator now fires every record instead of rarely | **If they feel bad** — they are being exercised harder than the prediction assumed, so a negative reading is *stronger* evidence against them | **Only a positive result.** "Feels good" is now measured on a form where the chip is mandatory, which is a different test from the one predicted |

So: in both cases a **negative reading is clean and a positive reading needs the caveat.**

**Why these two were built when the standing rule is to fix nothing before the trial.** Both are
defects with a causal chain to a wrong record, not friction. The calf-sex default manufactures the
duplicate `CalfPicker` exists to prevent, from a question nobody was asked — the same shape as the
`precision-date.ts` fabrications in §4, and the same reason those were fixed immediately. The
spacing defect had collapsed the vertical rhythm of `/animals/new` entirely. Neither is a preference, and
neither is anything the trial was going to measure the value of.

**What the spacing defect actually was, since the refinement document got the mechanism wrong.** It
reported the paragraph *overlapping* the `Observed by` label. Measured before and after by reverting
the rule: the boxes never intersected in either state — the gap was **0px, and is now 16px**, and
every fieldset on the page was butted against its neighbour, not just that one pair. One host rule
fixed the whole page. This is worth recording because it is the same failure as the amber diagnosis
and as assumption A6: **visual review is reliable about what looks wrong and unreliable about why,
and that document stated the why with the same confidence as the what.** Three instances of one
error, not three errors.

**A third code change, which is the other half of fix #2 rather than a new one.** Removing the
default changed `CalfPicker`'s `ready` preconditions from two to three and left its copy describing
the old ones, so with the dam and date both answered the panel told the operator to do what they had
already done — the exact failure that message exists to prevent. The copy, the `ready` doc comment
and the `calving-form.ts` header now all name dam, date and sex. It gets no contamination row: it
restores what the fix was supposed to say, rather than changing anything the trial measures.

Two specs were added alongside, because a behaviour nobody pins rots: one asserts the calf sex is
cleared after a write while the dam survives, one asserts the blocked copy names all three
preconditions. Both were checked by reverting the code and confirming they fail.

**Two other defaults were considered and kept, and they are kept for different reasons — defaults
are not settled by this amendment.**

- `outcome: 'live'` on `/animals/calvings/new` — **settled on the merits, not held.** Its asymmetry is
  load-bearing and argued at the control: live → died is repairable with a departure event, the
  reverse is not, and would leave the animal permanently departed. A default that fails safe is not
  the same object as one that fabricates. No trial data would change this.
- `sex: 'female'` on `/animals/new` — **held for the trial.** It has no chain to a picker filter, so by the
  rule used above it is a preference rather than a defect, and it sits on the form prediction 3 and
  the roster-pass question both measure. It is also the one default with real evidence behind it:
  consecutive acquired animals arrive in same-sex runs, which is why it deliberately *survives* a
  write (§6.7a) and why a spec pins that. If the trial says the sex chip is friction, it is in scope
  then; it was not in scope now.

**Three items struck from the refinement document, so nobody reads them later as open work.**

- **Session ledger / "recent entries with undo" — struck entirely.** It was called the highest-value
  item in that document and is the most precisely pre-registered thing in this section: it *is*
  prediction 5's held answer, two bullets above. Building it would have spent the measurement it was
  meant to be evidence for. Separately, the **undo half is dead on the merits** — see the retraction
  finding below.
- **`DamSelector` (search + timeline) — split, and the search half is struck.** Prediction 4's held
  answer above (keep the dam *and* land focus on it) addresses the survival problem for a fraction of
  what search-plus-timeline costs. The **entry-time ordering flag is orthogonal and stays live as a
  post-trial item**: it addresses ordering, not re-selection. Note it does not remove the constraint
  either — `recordCalving` mints the calf, so a later-discovered earlier calving still arrives after
  its own consequences (§5.2). Keep the instruction *and* flag the violation; a sentence at the top
  of a form asks the operator to hold a rule, a flag at the moment of violation tells them they have
  broken it.
- **Token layer and `(optional)` markers — held, treated as adjacent to prediction 3.** Prediction 3
  ("ten tab stops, about half of them empty") is the same observation approached from the keyboard.
  These are preferences on forms the trial measures, so there is no cost to waiting. `Recheck` to the
  top of `/check` is held on the same grounds — uncontaminating, since `/check` is not in the trial,
  but not worth a commit now.

**The retraction finding, which changes a deferral in §8 and one in that document.** Assumption
"there is no event type that retracts or corrects a prior event" is false: `supersedes_id`,
`supersededIds()`/`effectiveEvents()` and `correctCalving()` already exist and are wired to the UI.
So the cost that document assigned to retraction — "every projection must learn to skip retracted
events" — is already paid, at one line in `project.ts`. But **supersession is replacement, not
retraction**: the target dies and the replacement lives, so an undo needs an event that removes both.
Adding one costs migration 3 (the `type IN (…)` CHECK), an invariant 9 allowance, and a date it has
no honest value for — and that is the cheap half. The expensive half is that **every write on both
entry screens creates an animal row**, and `registry_animals` is identity with no delete path:
retracting an `/animals/new` leaves invariant 3 failing immediately, and retracting a link-mode calving would
need to un-supersede an origin promotion, which invariant 9 forbids by name. Undo is therefore not a
retraction event but animal deletion or an animal-level void state — **item 12, merge/supersede,
below the cut line**, exactly where §8 already put it. The cut line holds; there is no migration 3.

**One measurement added, and it is not a prediction.** §5 of the refinement document deferred a
review-before-commit step on the grounds that undo would cover it more cheaply. Undo is now dead, so
that argument is gone — but the step does not automatically return, because `correctCalving` from the
success panel is real recourse. The question becomes: **is correction fast enough that a pre-commit
gate is not worth two clicks per record?** Answering it needs a number this trial would not otherwise
record — how long a correction takes from noticing the error — and that number cannot be recovered
afterwards without re-running the trial.

Kept **observational**: if a correction happens naturally, time it. Deliberately entering a wrong
record to time the fix would contaminate the stumble count, which is a worse trade than having no
number. Five animals may well produce zero corrections; that is **weak evidence against needing a
gate**, and the question stays open rather than being resolved on nothing.

### Other open items

- **Male terminology — partly confirmed, still blocking.** `katta` is the young male. The term for
  the grown bull is **not** confirmed, and it is not to be guessed from the female pattern.

  The male side of §7.1 stays entirely in English until both are known, and that is deliberate
  rather than lazy: a half-mapped vocabulary is worse than an unmapped one. `katta` for the calf
  beside a bare `male` for the adult *looks* like a complete mapping, so the next reader takes the
  English word for the farm's word. Uniform English is at least honestly incomplete.
- The cheapest shape for a manual life-stage override event.
- How boundary ambiguity surfaces in status when birth precision is year-only or estimated.
- Interval band numbers, to be retuned against real data once the backfill is in.
- **Whether the roster pass (§5.1) is needed at all** — which absorbs the older question of whether
  it survives the per-row year field, since both now turn on the same measurement. Decided by
  evidence rather than argument: the keyboard retrofit (§6.7a) was built as if it were the whole
  answer, and the five-animal trial above is the check. The measure is the round trip, not the field
  count.
- ~~**The override belongs in a column, not the payload.**~~ **Done — migration 4.** It lived in the
  payload only because a column cost a migration and the build order's standing claim was that
  everything above the cut line lands without one; the instruction here was to bundle it into
  whichever migration landed next, and the sales cycle is where that happened. It went as its OWN
  migration rather than riding along with four plain CREATEs, because it rebuilds a table with
  foreign keys off. `override_check` and `override_reason` are now columns on
  `registry_animal_events`, and the vocabulary is enforced by the database for the first time —
  in the payload it was a write-boundary check only. See
  [REGISTRY_SALES.md §9](REGISTRY_SALES.md#9-schema).