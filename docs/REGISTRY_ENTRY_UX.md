# Registry entry UX — design decisions

Status: decided, not yet implemented. Supersedes the kickoff brief, the validation reply, and the
Q5/Q6/calf-age addendum — those three can be deleted once this lands.

Baseline verified at HEAD `42c0ad2` (`v0.12.0-2-g42c0ad2`). Server tests 385 passing, typecheck
clean. Frontend has 44 registry specs across 4 files.

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

**Invariants the system could enforce were delegated to the operator.** `/calving` asked "is the
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
(in four separate places). Both halves belong in `docs/REGISTRY.md`.

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
- Any date parsing utility or date library. `time.ts` has `farmToday()` only.
- Server-side idempotency. Double-submit is confirmed possible by execution, not inference: the same
  payload twice produces `BD-0001` and `BD-0002`; identical notes and dry-offs produce two events.
  The client disables the button while submitting, which stops a fast double-click on one live form
  and nothing else. A refresh-and-resubmit or a second tab produces a permanent duplicate. `/add` is
  the dangerous one — it mints a fresh serial with no calving flow involved.
- Any persistence of overrides. `allow_near_duplicate` and `allow_after_departure` are transient
  input flags. After the fact, an overridden write is indistinguishable from one that never tripped
  a check.
- Any history beyond the last result — `FormState.result` holds one, per form instance, lost on
  navigation.

### Live bug found during validation

`precision-date.ts:162-164` initialises its internal fields:

```
protected readonly year  = signal(new Date().getFullYear());
protected readonly month = signal(1);
protected readonly day   = signal(1);
```

Choose "Exact day", touch nothing, submit: you have written `2026-01-01` at day precision. It
satisfies every CHECK, every write-boundary assertion and every invariant. Only the "Will be
recorded as" preview stands between that and the log, and the year of a backfill has no strong prior
at all. This is the defaults rule being violated by the very control built to enforce it, and it is
the most serious finding of the validation pass.

---

## 5. The screens

Navigation changes from `Add animal / Record calving / Herd / Check` to `Roster / Herd / Check`,
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

`/calving` needs no backend change to work with a fixed dam — `dam_id` is a body field, and
`damCandidates` only feeds a dropdown the workbench will not have.

### 5.3 Day sheet mode — dropped

Designed to mirror a signed paper daily round. No such sheets exist on the farm. A screen mirroring
a nonexistent artifact has no purpose, so this is removed from the plan rather than deferred.

What it becomes instead is covered in §9.

---

## 6. Change list

Each item: intent, what validation established, and the decision.

### 6.1 Empty date fields, and write down the defaults rule

Fix `precision-date.ts` so year, month and day start empty. Add both halves of the defaults rule to
`docs/REGISTRY.md`. First commit, independent of everything else. The fix must be demonstrated by
execution — show the fabricated-date path actually closed, the way double-submit was proven open.

Check whether any of the 8 existing `precision-date` specs assert the old initialisation. If so,
that is worth calling out rather than quietly updating.

### 6.2 Server-side idempotency

An `Idempotency-Key` header on the three write routes, stored per key, returning the original result
on replay. Not in the original brief and it should have been: it is the cheapest reduction of
permanent-duplicate risk, and it covers the `/add` path that no amount of calving-flow care would
protect.

### 6.3 Candidate search replaces the yes/no binary

`/link-candidates` already computes eligibility, the "dam is unset" condition, and returns
`birth_on` and `birth_precision` per candidate. What is missing is proximity ranking. Add
`days_apart: number | null` to `LinkCandidate` and sort.

`recordCalving` needs no change — link mode is already a first-class branch via `calf.existing_id`,
and the whole mint-birth-departure-projection sequence runs in one transaction with test-only fault
injection at six points. This is a UI reshape plus a sort key.

**Match window:**

| Coarsest of the two precisions | Window |
|---|---|
| both day | ±7 days |
| either month | ±45 days |
| either year or estimated | same calendar year, ±1 year |
| candidate has no birth date | always shown, ranked first |

That last row matters most — an animal entered in the roster pass without a birth date is the most
likely link target, and a proximity filter would hide it. Rank by no-birth-date first, then by
absolute days apart.

### 6.4 Persist overrides

`allow_near_duplicate` and `allow_after_departure` are transient today, so an overridden write leaves
no trace of having been overridden. In an append-only log whose premise is that the record explains
itself, that is a provenance hole. Persist the flags on the event, with a free-text reason if it is
cheap. Small, and separate from the soft-warning work below the line.

### 6.5 Smaller items

- `datalist` of previously-used values on `observed_by`, `acquired_from` and `sire reference`. Free
  text across a hundred records produces `abdul`, `Abdul` and `abdul_r`.
- `observed_by` guidance is inconsistent across three forms — `/add` says "leave blank unless
  someone actually saw it", `/calving` and the event form say only "(optional)", and `recorded_by`
  gets "a stable identifier, not a display name". One field, three treatments. Unify, and apply the
  stable-identifier guidance to `observed_by` too.
- `/calving` empty state (`calving-form.ts:52-55`) is a dead end with no link, while `/herd`'s empty
  state already has `data-role="empty-cta"` pointing at `/add`. Fix the asymmetry — or make it
  unreachable once the roster pass exists.
- The duplicated precision explainer is the shared control's internal `hint()`
  (`precision-date.ts:170`), rendering once per control on a page that has two. The separate
  paragraph at `animal-form.ts:82-86` is different text. Fixing this means an `explain` input on the
  shared component rendering on first instance only — not deleting a page paragraph.

### 6.6 Smart date field

One text input that parses what was typed, infers precision, and displays the inference back for
confirmation. `2019` → year, `mar 2019` → month, `6 Jul 2023` → day. The estimated checkbox swaps
precision to `estimated`, legal only where the parse yielded a bare year — which keeps the Jan-1
storage convention intact and requires no migration.

`precision-date.ts` is already the single shared control imported by all three write forms. Replace
its internals, keep the `PrecisionDate` output contract, and all surfaces benefit. The parser itself
is a pure sibling module so it can be unit-tested without a component.

**Ambiguous numeric dates are refused, not guessed.** Accept ISO `2023-07-06`, `6 Jul 2023`,
`Jul 2023`, `2023`. On any bare `NN/NN/YYYY`, refuse and teach: "Ambiguous — type the month as a
word (6 Jul 2023) or use 2023-07-06." Refuse *all* of them uniformly, including unambiguous cases
like `25/12/2023`, because accepting those trains a habit that silently breaks on `06/07`. The farm
is in Pakistan (DD/MM by convention) and the tooling is US-influenced (MM/DD); a wrong guess produces
a date that passes every check in the system.

### 6.7 Keyboard pass

Bigger than originally billed and it touches every screen: introduce `<form>` elements, Enter-submit,
sane tab order, and key handling on the radiogroups. Sequenced after the date field so it lands on
final markup rather than being done twice.

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

### 7.1 Terminology and life stage

Local terms and their boundaries:

- **katti** — female calf, from birth
- **choti** — grown female that has not yet calved
- **majj / bhains** — female that has calved

These map exactly onto calf / heifer / cow, so the existing status enum is likely already correct.
The boundary rules are what need fixing:

1. `CALF_MAX_AGE_MONTHS = 18`, not 12 (`project.ts:56`).
2. **The cow boundary is `parity >= 1`, not an age.** A choti becomes a majj by calving and by
   nothing else. Verify what the status projection actually does — if any age rule contributes to
   the cow transition, that is a bug, and it surfaces on exactly the animal most worth noticing: one
   old enough to look like a cow who has never calved.

So the entire scheme contains one age threshold, and every boundary after it is derived from events
the registry already holds.

**The age boundary is overridable.** The real katti→choti transition is physical — she gains weight
and features — not arithmetic. 18 months is the default inference; an explicit event overrides it
when the operator looks at her and says she is a choti now. Same principle as estimated precision:
show the computed guess, let stated knowledge beat it. The cheapest shape for this is an open
question — it may fit `note` with a payload, or need its own type.

**Ambiguity at the boundary.** An animal with year-only or estimated birth precision sitting near 18
months cannot be classified honestly. The status should say so rather than pick a side.

**Display the local terms, store the English enum.** `majj` carries the calving-defined meaning
precisely where "cow" is ambiguous about it, and the local word is what anyone else touching the
screen reads without thinking.

**Open: male terms.** Not yet confirmed. Leave the male side as it is and raise it as a decision.

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

The decisive argument for deferring is recovery cost. With five tables at zero rows, a bad duplicate
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

Everything above the cut line lands without a schema migration.

| # | Item | Size |
|---|---|---|
| 0 | Empty date fields + defaults rule in docs (§6.1) | XS |
| 1 | Server-side idempotency keys (§6.2) | S |
| 2 | Candidate search replaces the binary (§6.3) | S |
| 3 | Persist override flags (§6.4) | S |
| 4 | Smaller items — datalists, `observed_by` wording, empty-state link, explainer (§6.5) | S |
| 5 | Smart date field + "Estimated year" relabel (§6.6) | M |
| 6 | Keyboard pass (§6.7) | M |
| 7 | Roster pass, per-row estimated year (§5.1) | M |
| 8 | Animal workbench + last-five-written strip (§5.2) | M |
| 9 | Session band: in-place change + `source_ref` capture (§6.8) | S |
| 10 | Life-stage model: `CALF_MAX_AGE_MONTHS`, parity-driven cow boundary, local terms (§7.1) | S |

— cut line —

| # | Item |
|---|---|
| 11 | Inline soft checks + dry-run endpoint + interval bands (§7.2, §8) |
| 12 | Merge / supersede (§8) |
| — | Daily workflow (§9) — separate cycle |

Sequencing reasons: 0 is a live bug in the control everything else touches. 5 and 6 rewrite the same
component and its 8 specs, so they are adjacent and ordered so the keyboard work lands on final
markup. 7 precedes 8 because the workbench needs animals to show. 9 sits last above the line because
`source_ref` capture earns most on the surface that does not exist yet. 10 rides with 8 because the
boundary bug is invisible until a header renders it.

Budget for the 44 existing frontend specs — items 5, 6 and 8 all rewrite code beneath them. Keep the
`data-role` selector convention; it is consistent across every component and is what makes those
specs cheap to maintain.

---

## 11. Still open

- Male terminology — katta, jhota, or something else, and whether the boundary matters on a dairy
  where bulls leave young.
- The cheapest shape for a manual life-stage override event.
- How boundary ambiguity surfaces in status when birth precision is year-only or estimated.
- Whether the roster pass survives the per-row year field or should be folded into the workbench.
- Interval band numbers, to be retuned against real data once the backfill is in.