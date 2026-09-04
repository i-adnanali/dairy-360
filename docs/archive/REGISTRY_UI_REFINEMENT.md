# Registry entry UI — refinement decision doc

> ## ⚠️ VALIDATED 2026-09-04 — MOST OF THIS DOCUMENT IS SUPERSEDED, DO NOT IMPLEMENT FROM IT
>
> The validation outcome lives in **`REGISTRY_ENTRY_UX.md` §11, "Pre-trial amendment"**, which is
> authoritative wherever the two disagree. This file is kept only as the record of what was proposed
> and why it was wrong; it is to be rewritten after the five-animal trial, against what exists.
>
> **What survived:** §3.8 (a real defect, wrong mechanism — see below) and the calf-sex half of the
> Tier-1 defaults item. Both are built.
>
> **What was already built before this was written:** §3.1 `DatePrecisionInput` (ships as
> `PrecisionDateControl`, and its proposed *editable* precision control is a deliberate rejection —
> it would re-open silent downgrade) and §3.4 `CalfRegistryLookup` (ships as `CalfPicker`).
>
> **What is struck or held, with answers already written down — not open work:** §3.3 `SessionLedger`
> (struck; it is prediction 5's pre-registered held answer, and the undo half is dead on the merits),
> the search half of §3.2 `DamSelector` (struck; prediction 4's held answer is cheaper), §3.5 tokens
> and the `(optional)` markers (held), `Recheck` to the top of `/check` (held), and the
> `outcome: 'live'` half of the defaults item (rejected — its default fails safe).
>
> **Three factual errors, all the same error.** Assumption A6 ("no event type retracts or corrects a
> prior event") is false — `supersedes_id`, `effectiveEvents()` and `correctCalving()` exist and are
> wired to the UI. §3.5's claim that amber is overloaded across six things is false — amber means
> *warning*, consistently; the overloaded ramp is `farm-*`. §3.8's overlap is not an overlap — the
> boxes never intersected; the gap was 0px. Each is a **mechanism asserted as fact from outside the
> code**: visual review is reliable about what looks wrong and unreliable about why, and this
> document stated the why with the same confidence as the what.

**Status:** written 2026-09-03 without repo access; validated 2026-09-04 against
`v0.15.0-3-g212dfe0`. Superseded — see the banner above.
**Baseline:** the registry entry UI as it stands (screens `/add`, `/calving`, `/herd`, `/check`)
**Author's position:** written without repo access. Every claim about the existing
codebase is an assumption to be checked, not a fact.

---

## 0. How to use this document

This doc proposes changes to an entry UI that already works. The screens are
sound in their thinking; the problems are that the design communicates through
prose where it should communicate through visual channels, and that it is
optimised for first use rather than for a long transcription session.

**Before implementing anything, validate.** Inspect the real code and report
back on:

1. Every assumption in §1 — confirm, correct, or flag as unknowable.
2. Any component in §3 whose proposed interface conflicts with what exists.
3. The counter-arguments in §6 — these are places where I think I might be
   wrong. Argue back. A reasoned objection here is more valuable than an
   implementation.

Do not begin implementation until the assumptions are resolved and the
counter-arguments have been answered.

**Division of labour:** repo-evidence questions (what the schema stores, what
projections exist, what the component tree looks like) get resolved by
inspection. Real-world questions (which precision values actually occur in
the paper records, whether the review step is wanted) get resolved by the
user. Both kinds are marked below.

---

## 1. Assumptions to validate first

These are load-bearing. If any is wrong, the corresponding component spec
changes or dies.

| # | Assumption | How to check | If wrong |
|---|---|---|---|
| A1 | Date precision is stored as a single enum with four values: `day`, `month`, `year`, `estimated` | The `/check` page cross-tab shows exactly these four in the PRECISION column. Confirm against the `registry_*` schema and any TS union type | The whole of §3.1 changes. Report the actual representation before proceeding |
| A2 | `estimated` is a value of the same enum, not a separate boolean flag alongside `year` | Same. Check whether there is a `year_is_estimate` column or similar in addition to the precision column | If it is a separate flag, the four-button control still works but writes two fields; say so |
| A3 | `source` (`cycle_card`, `daily_herd_sheet`, `recall`, `import`) is set once per session, not per record | The harness banner reads `Recording as zsf from import` with a `Change` link. Confirm where that value is held and whether any per-record override exists | If it is per-record, it needs a home in the form and §3.1 must not claim otherwise |
| A4 | `zsf` in the banner is the **recorder** (who is operating the app), and the per-record `Observed by` field is the **witness** (who saw the event) | Check whether these write to the same column | If they are the same field, the form's `Observed by` is a session-default override and should be labelled as such |
| A5 | The event log is append-only with no delete path, and projections are derived | Stated in prior notes. Confirm there is no `DELETE FROM registry_*` anywhere outside migrations | §3.3 undo becomes trivial instead of interesting |
| A6 | There is no event type that retracts or corrects a prior event | Grep the event-type union | §3.3 needs a new event type — a schema change, not a UI change. Escalate |
| A7 | A per-dam calving history is queryable cheaply (a projection, not a scan) | Look for whatever backs the `PARITY` and `EVENTS` columns on `/herd` | §3.2's timeline needs a new query; assess cost |
| A8 | The frontend is Angular 22 and these screens are components, not templates rendered server-side | Inspect | Rewrite the component specs in whatever the real idiom is |
| A9 | The harness `:memory:` fixture mode can drive all four screens without a real DB | The banner implies yes | Testing plan in §7 changes |

**Also report:** whether `/add` and `/calving` share any date-input code today, or
whether the two date fieldsets on `/add` are duplicated markup. This determines
whether §3.1 is one change or four.

---

## 2. What this refinement is and is not trying to do

**Trying to do:**

- Make date confidence visible without reading prose.
- Remove the ordering constraint the user currently has to hold in their head.
- Make errors recoverable at the moment they are noticed.
- Cut the per-record interaction cost for a long backfill session.

**Not trying to do:**

- Support multiple users, roles, or permissions.
- Work on a phone, offline, or in a shed. This stays a localhost laptop
  transcription surface.
- Add reporting, dashboards, or derived metrics beyond what `/check` already does.
- Change the event schema, except where A6 forces it.

**Explicitly preserved:** the `/check` page's framing and statistics. The
measured/approximate split with `n` and range rather than a pooled mean is
correct and should not be touched. The local vocabulary (`katti`, `choti`,
`majj`) stays.

---

## 3. Components

### 3.1 `DatePrecisionInput` — the core change

**Replaces:** the free-text date field plus the "Even the year is a guess"
checkbox plus three captions, on all four sites where dates are entered
(`/add` arrival, `/add` birth, `/calving` calving date, and any future
departure event).

**What it does.** One text input plus a visible, editable four-way precision
control. The user types a date in whatever form they know it. The input parses
and **sets** the precision control, which then stays on screen as a committed,
editable value. Changing the precision control constrains the input.

| Typed | Parses to | Control lands on |
|---|---|---|
| `6 Jul 2023` | `2023-07-06` | `day` |
| `Mar 2019` | `2019-03-01` | `month` |
| `2019` | `2019-01-01` | `year` |
| (unparseable) | null | unchanged, input flagged |

Selecting a precision manually re-shapes the input: choosing `month` from `day`
truncates to the month and drops the day segment; choosing `estimated` requires
a bare year and applies the low-confidence treatment.

`estimated` is the one value typing cannot express, so it is the one value that
must be clicked. That is correct — it is the only case where the user is
asserting something about their own memory rather than about the record.

**Interface (subject to A1/A2):**

```
input:   value: { date: ISODate | null, precision: 'day'|'month'|'year'|'estimated' | null }
         required: boolean
output:  valueChange, and a validity signal the parent form gates its submit on
```

**Reasoning.** The app's stated doctrine is that a default precision is how
"exact day" gets applied to a guess. The current implementation honours this by
inferring precision from typed format — but the inference is invisible. The
user has to trust a parse they cannot see, and after the fact the only record
of *why* a date is month-precision is the date itself. Making the parse result
visible and editable costs one row of UI and removes the trust requirement
entirely.

The conditional checkbox goes because its label currently contains its own
precondition ("only applies to a bare year, since an estimate is stored as
January 1"). A control that has to explain when it applies should be a state
of another control instead. If A2 holds, `estimated` is already a peer value of
`year` in the schema, so the checkbox was always a second encoding of a fact
the enum could express.

**Open questions:**

- *(user)* Of the paper records, roughly what share are day-precision? This
  decides whether the parse-then-confirm design is right or whether the
  precision control should be primary. See §6.1.
- *(repo)* Is there existing parse logic to reuse, and is it tested? If the
  placeholder `2019, Mar 2019, or 6 Jul 2023` reflects a real parser, this
  component wraps it rather than replacing it.
- *(user)* Should `estimated` be selectable at day or month precision, or only
  at year? I have assumed year-only, matching the current checkbox's
  precondition.

---

### 3.2 `DamSelector` — search plus timeline

**Replaces:** the `<select>Choose a dam...</select>` on `/calving`, and the
instruction "Enter calvings oldest first."

**What it does.** Type-ahead search on name, serial, ear tag, or post number.
On selection, renders a card showing the dam's identity, status, parity, and
**her existing calvings in chronological order with their precisions**, plus a
marker for the slot the current entry will occupy.

Once a calving date is entered, the card indicates where it lands. If it falls
between two existing calvings, or before her own birth date, that is surfaced
here at entry time rather than on `/check` afterward.

**Interface:**

```
input:   none (queries internally)
output:  damSelected: { animalId, serial, name, status, parity, birthDate,
                        calvings: Array<{ date, precision }> }
```

**Reasoning.** Two problems collapse into one component. The dropdown does not
scale past a couple of dozen animals and, more importantly, never confirms that
the right animal was picked — serials are similar and names are absent for
several animals in the herd. And "oldest first" is the app offloading an
ordering constraint onto human memory; a visible timeline turns a rule into a
thing you can see. For a dam with three prior calvings entered from recall,
this is where a transposition error becomes obvious.

Note that this also front-loads the calving-interval sanity check. `/check`
currently reports intervals after the fact; showing the interval as the date is
typed catches the error while the paper record is still open.

**Depends on:** A7. If a per-dam calving projection does not exist, report the
query cost before building.

**Open question** *(repo)*: does the "which calf is this?" gating logic already
compute the dam's date constraints? If so, the timeline is a rendering of data
the component already has.

---

### 3.3 `SessionLedger` — recent entries with undo

**New.** Occupies the currently empty right margin (the content column is
~540px in a ~1900px viewport).

**What it does.** Lists the last 5–10 events recorded in this session, most
recent first: serial, animal name, event type, and an undo affordance. Undo
writes a compensating event and marks the ledger row as reverted rather than
removing it.

**Interface:**

```
input:   append(event: RecordedEvent)   called by the form on successful submit
output:  undoRequested: eventId
```

**Reasoning.** This is the highest-value addition in the doc and the one both
the current design and the alternative design I reviewed are missing. In a
backfill session the dominant error mode is a transcription mistake noticed one
second after submitting — wrong dam, transposed digits, month instead of day.
The current recourse is to switch to `/herd`, confirm the mistake, and then
have no way to fix it from the UI at all.

Secondary benefit: it answers "did that save?" without a tab switch, which is
otherwise a constant interruption.

**This is the component most likely to require a schema change.** See A6. If no
retraction event type exists, three options, in my order of preference:

1. **Retraction event type.** A `registry_event_retracted` (or equivalent)
   event referencing a prior event id, which projections honour by excluding
   the retracted event. Preserves append-only semantics honestly: the mistake
   and its correction are both in the history. Cost: every projection must
   learn to skip retracted events.
2. **Uncommitted buffer.** The form holds entries in memory and commits on an
   explicit "save session" action. Cheap, but breaks the write-as-you-go model
   and risks losing an hour of transcription to a browser refresh. I do not
   recommend it.
3. **Hard delete within a session window.** Pragmatic, dishonest, and it makes
   the event log's append-only guarantee conditional. Only worth it if option 1
   turns out to be genuinely expensive across the projections.

**Report which of these the codebase can absorb before building any of it.**
If option 1 is a large change, the ledger is still worth building read-only
(feedback without undo) as a first step.

---

### 3.4 `CalfRegistryLookup`

**Modifies:** the "Which calf is this?" panel on `/calving`.

**What it does.** After dam and date are set, searches the registry for an
existing animal that could be this calf. If found, links it. If not, creates a
new animal as today.

**Reasoning.** Currently the calving auto-creates the calf. If the same animal
was already entered through `/add` — plausible during a multi-pass backfill
where identity records and calving histories are entered separately — the
result is a duplicate with no obvious signal. Search-then-create-if-absent
closes that.

Secondary fix: the panel today is an empty box containing prose explaining why
it is empty, which reads as broken rather than pending. Either collapse it
until its preconditions are met, or give it a visibly pending treatment
(dashed border, muted) so its state is legible.

**Open question** *(repo)*: is duplicate detection already handled at the
projection or invariant level? If `/check` would catch this, the UI change is
about timing rather than correctness, which lowers its priority.

---

### 3.5 Token layer — one semantic channel per meaning

**Cross-cutting.** Not a component; a change to the palette definitions.

**Problem.** The current palette runs one amber/brown family across body text,
field labels, `(optional)` markers, helper captions, warning prose, and the
precision qualifiers in the `/herd` table. All of it reads at roughly the same
weight. The consequence is that the one concept the app exists to make visible
— date confidence — has no dedicated visual channel. On `/herd`,
`2017-03-01 (month)` and `2018-01-01 (estimated)` are indistinguishable at a
glance.

**Proposed tokens:**

| Token | Role | Currently |
|---|---|---|
| `--text-primary` | body text, field labels — near-black warm brown | too light, competes with captions |
| `--text-secondary` | captions, helper text — clearly recessive | same weight as body |
| `--text-uncertain` | **amber, reserved exclusively for low confidence** | amber used for six things |
| `--text-ok` | muted olive, for the `/check` pass state | pass and fail states look identical |
| `--text-error` | desaturated red-brown, blocking validation only | no dedicated error colour |

**Rule to enforce:** amber appears if and only if something is uncertain. Any
other amber usage is a bug. This single constraint makes precision legible on
all four screens at once, and makes the `/check` page's measured/approximate
split readable without reading.

**Also:** drop the `(optional)` markers. When nearly every field is optional,
marking optional is noise — mark the required fields instead. Currently that is
sex and arrival date on `/add`, dam/date/sex/outcome on `/calving`.

**Reasoning worth noting:** the warm palette is not the problem and should be
kept. Amber already has a natural association with "provisional", which is why
reserving it costs nothing thematically. The generic green/white palette in the
alternative design I reviewed had no relationship to the domain and simply
moved the overload from amber to green.

---

### 3.6 `StatusBadge` and `/herd` table density

**Modifies:** the `/herd` table.

Changes, in order of value:

1. **Colour the status badges by lifecycle.** `in milk`, `dry`, and `departed`
   are the operationally meaningful distinctions and are currently the same
   tan. Give `departed` a muted treatment so live animals carry weight.
2. **`male` as a status is a category error.** There is already a `SEX` column.
   It is a lifecycle bucket standing in for "not applicable", which makes the
   status column mean two different things depending on the row.
   *(user question: is there a real male lifecycle vocabulary — a counterpart
   to katti/choti/majj — that belongs here instead?)*
3. **Precision qualifiers move to `--text-uncertain`.** Per §3.5. Make
   `unknown` consistent with `(estimated)` rather than italic.
4. **Sortable columns**, particularly `BORN` and `PARITY` — those are how a
   transcription error becomes visible.
5. **Tighter row height.** At herd scale the job of this page is seeing the
   whole herd at once.

No filtering, search, or pagination. The real herd is ~20 animals; the 31 rows
in the screenshots are harness fixtures. Do not build for scale that is not
coming.

---

### 3.7 `GuidanceDisclosure`

**Modifies:** the explanatory prose on `/add` and `/calving`.

`/add` currently carries roughly 8 controls against 10 blocks of prose. Some of
it is good thinking ("Post number and ear tag are attributes, not identity"),
but it is thinking that belongs in the schema docs. It pays off once and costs
scanning time forever.

Keep one short line per fieldset. Move the reasoning behind an expandable `?`,
or — simpler for a single-user tool — one "hide guidance" toggle in the header
that persists in `localStorage`.

**Note:** §3.1 deletes three of these blocks outright, because a visible
precision control needs no explanation of how precision is inferred. Do §3.1
first and re-measure before building a disclosure mechanism for what remains.

---

### 3.8 Bug

On `/add`, the paragraph beginning "Leave the birth date blank if you do not
know it…" **overlaps the `Observed by (optional)` label**. It is also outside
the fieldset it refers to and indented inconsistently with its surroundings.

---

## 4. How the components interact

Calving entry, the most complex flow:

```
DamSelector
  └─ damSelected ──▶ CalvingForm
                       │  holds dam context: birthDate, existing calvings
                       │
                       ├─▶ DatePrecisionInput (calving date)
                       │      └─ valueChange ──▶ back to DamSelector's timeline,
                       │                          which renders where this date
                       │                          lands and flags impossible
                       │                          positions
                       │
                       ├─▶ CalfRegistryLookup
                       │      enabled only once dam + date are set
                       │      (its precondition is the date constraint)
                       │
                       └─ submit ──▶ event log write
                                       └─▶ SessionLedger.append()
                                              └─ undoRequested ──▶ compensating
                                                                    event write
```

Two things to notice about this graph:

- **The date flows back up.** `DatePrecisionInput` is not a leaf; its value
  feeds the dam timeline, which is what makes the ordering constraint visible.
  If the existing form holds date state locally, this is the main structural
  change.
- **`CalfRegistryLookup`'s enablement is derived, not declared.** It becomes
  available when dam and date are both set, because those two facts define the
  window a calf could exist in. That is the same logic the current
  "Which calf is this?" panel gates on — reuse it, do not reimplement it.

Nothing else is required, and `SessionLedger` sits outside the form entirely
(it only receives appends), so it can be built and shipped independently.

`/add` is the same graph minus the dam and calf pieces: two
`DatePrecisionInput` instances, one required (arrival) and one optional
(birth), feeding a form that appends to the same ledger.

---

## 5. Deferred, with criteria

**Review-before-commit step.** A confirmation screen showing mother, calf, and
what the write will create. The argument for it is real: an append-only log
means a mistake is not deleted but corrected by a second event that lives in
the history forever, and that asymmetry justifies friction a normal CRUD app
would not need.

**Deferred because** undo (§3.3) may cover the same ground more cheaply. A
review step costs two clicks on *every* record to prevent an error that undo
fixes in one click on the *rare* record.

**Decide after:** §3.1–3.3 are in place and 5–10 real calvings have been
entered. If undo gets used more than once or twice in that sample, build the
review step. If it never fires, do not.

**Also deferred:** dam-centric entry (build one animal's whole history on a
single screen, matching the shape of the paper records rather than the shape of
the event log). This is potentially a larger win than everything in §3, and it
is purely a composition layer over the same writes. But it is a bigger change,
and it should be decided *before* the real herd is entered rather than after —
cheap now, expensive once there is real data and muscle memory behind the
current flow. Raise it with the user as a question, not a task.

**Not deferred, rejected:** sidebar navigation, a hub screen for picking an
event type, multi-step wizards, org/avatar/role chrome, animal photos, and
`Reports` as an IA slot. Four nav items do not need a sidebar, and `/check`
is not a report — it explicitly makes no assertions and changes nothing, which
a `Reports` tab would misrepresent.

---

## 6. Counter-arguments — please argue back

These are the places I think I am most likely wrong. I would rather have a
reasoned objection than an implementation.

### 6.1 Certainty-first may be slower than what exists

The strongest case against §3.1: for a touch typist, `6 Jul 2023` in a single
free-text field is *faster* than any control with a selection step. If most of
the paper records are day-precision, I have added a mandatory interaction to
every record to protect against a minority case.

The parse-then-confirm design in §3.1 is my attempt to have both — typing speed
preserved, precision made visible. But it is a compromise, and it is worth
checking whether it actually beats the status quo on throughput. **Time three
real records both ways.**

Note that this is a revision of my initial position, which was that precision
should be selected *before* the date and should gate which input fields exist.
That version is safer (you cannot type a day you did not claim to know) but
strictly slower. I moved off it because the safety it buys is small once the
parse result is visible and editable. If you think the stricter version is
right, say so — the argument for it is that a visible-but-editable control
still permits a wrong precision to be *accepted* silently, whereas a gating
control makes false precision unrepresentable.

### 6.2 The session ledger may be YAGNI

It is possible that `/herd` already serves as adequate feedback, and that undo
matters less than I think because errors get caught on the `/check` page
anyway. If the compensating-event work in §3.3 turns out to be large, say so
loudly — the read-only ledger without undo may be 80% of the value for 10% of
the cost, and I would take that trade.

### 6.3 Undo may pollute the event log for no good reason

Every corrected typo becomes two permanent events. At a few hundred events this
is fine; the objection is philosophical rather than practical. But if the
projections get materially harder to reason about — particularly the `/check`
invariants and the calving-interval computation — that is a real cost against a
convenience feature. Assess honestly.

### 6.4 The token layer may be over-engineered for one user

Five semantic tokens for a single-user localhost tool could be more ceremony
than it deserves. Counter to my own point: the amber-for-uncertainty rule is
the one piece I would defend hardest, because it is the app's whole thesis made
visual. The other four tokens are conventional and cheap. If you disagree, tell
me which ones do not earn their place.

### 6.5 I may be wrong about the dam timeline's cost

I have assumed (A7) that a per-dam calving history is cheap. If it requires a
new projection or an N+1 query per keystroke of the type-ahead, the timeline
might need to load lazily on selection rather than live — which weakens the
"see where this date lands" argument, since the feedback would arrive later
than the typing.

### 6.6 Something I have not thought of

You have the codebase and I do not. If there is a constraint, an existing
abstraction, or a simpler path that makes any of §3 unnecessary, that is the
most useful thing you can report.

---

## 7. Definition of done

Ordered by value per unit of work. Do not proceed past the validation gate.

**Gate:** §1 assumptions reported. §6 counter-arguments answered. Blocking
issues and open decisions surfaced. **Stop here for review.**

**Tier 1 — small, high ratio**

- [ ] §3.8 overlap bug fixed
- [ ] §3.5 tokens defined; amber reserved for uncertainty and audited across all
  four screens; `(optional)` markers dropped, required fields marked
- [ ] Default selections removed from calf sex and calf outcome; submit gates on
  both, with the blocking field named in the hint
- [ ] `Recheck` moved to the top of `/check`, adjacent to the invariants panel

**Tier 2 — the substance**

- [ ] `DatePrecisionInput` built once and used at all four date sites; the three
  captions it obsoletes are deleted
- [ ] `DamSelector` with search and chronological timeline; "Enter calvings
  oldest first" removed from the page
- [ ] `SessionLedger`, read-only first, then undo if §3.3 option 1 proves
  affordable
- [ ] `CalfRegistryLookup`; the empty-prose panel replaced with either
  collapse or a visibly pending state

**Tier 3 — polish**

- [ ] §3.6 badge colours, `departed` de-emphasis, sortable `BORN` and `PARITY`,
  tighter rows, consistent `unknown`
- [ ] §3.7 guidance disclosure, re-measured after Tier 2

**Tier 4 — decisions, not tasks**

- [ ] Review step: decided on evidence from 5–10 real calvings (§5)
- [ ] Dam-centric entry: raised with the user before the real herd is entered

**Acceptance test, more important than any checkbox:** enter three real animals
with full calving histories, timed, noting every place you scrolled back,
re-read, or double-checked. Compare against the same three on the current UI.
Twenty minutes of that outranks everything above.

---
