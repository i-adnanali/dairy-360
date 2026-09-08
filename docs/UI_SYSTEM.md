# UI system — the design system

*Status: **phases 0–6 built and verified; 7 is not.** Specified against
`816fe67`, validated against the code twice, and implemented over nine commits
(`ef52fd4`…`d9c0057`). Frontend **328/328**, server **726/726**, production build
clean. Both light and dark rendered on all fourteen screens, and the five
certainty states proved in **greyscale**.*

*This is the **only** document for this work. It replaces the original plan, a
separate adversarial-validation file, and the per-phase implementation records —
all three were folded in here and deleted, because three documents disagreeing
about the same counts is how the counts went wrong the first time. Every figure
below was measured against the tree at `dc0a160`, not carried over.*

*Three items remain **BLOCKED** on the five-animal trial (§3). One contamination
of that trial was **knowingly accepted** and is recorded in §3.4 — read it before
reading the trial report. A ninth prediction is pre-registered in §3.5.*

*§13 is **built** (phase 6b). §§12, 14 and 15 remain **specified and unbuilt**:
the shell, four primitive gaps and the copy rules. They were written after the
phase-4 renders and describe the end state the built work is a foundation for.*

*Two documents accompany this one and neither replaces it.
[PHASE5_PRECHECK.md](../PHASE5_PRECHECK.md) at the repo root holds the three
measurements taken before phase 5 — the contrast sweep, the amber census, and
the answer on whether §6's five states are renderable — because they are a
snapshot of one moment rather than part of the system. Everything they concluded
that outlives that moment has been folded in below.*

**Reading order for a new session:** §2 for where things stand, §3 for what you
may not touch, §8 for what will break if you are careless, §9 for the work,
§10 for how to prove it, §12, §14 and §15 for what is specified but unbuilt.

---

## 1. What this is

The app was not badly themed. It was **untokenised and drifted**: one custom
Tailwind ramp, no dark mode, zero CSS custom properties, and 358 distinct
whole-attribute class strings over 957 occurrences for what is about fifteen
visual primitives.

The design idea is that **certainty is the app's primary visual variable.** Every
screen distinguishes measured from approximate, observed from recalled, answered
from deliberately-blank — and all of them looked the same. §6 gives that axis a
treatment, and **it is built**: everything in phases 1–4 existed to make it
expressible, and phase 5 spent it. What remains unbuilt is the chrome around it
(§12) and four primitive gaps (§14).

**Presentation is not decided entirely in templates**, which is the fact that
made the migration larger than it looked. Six TypeScript methods build class
strings — `tool-call-chip.chipClass()`, `.dotClass()`, `message.agentClass()`,
`chip-group.chipClass()`, `dispatch-sheet.noneClass()`,
`milking-roster.chipClass()` — and `agentClass()` is a four-arm status→class map.
All six were migrated in `ed6235a`.

---

## 2. State of play

| Phase | Deliverable | Status |
|---|---|---|
| **0** | Baseline: both suites, fourteen screens at one fixed width | **done** — `ef52fd4` |
| **1** | Token layer, zero delta | **done** — `5c62480` |
| **2** | Fifteen primitives extracted | **done** — `dac518d` |
| — | *Call sites onto the semantic names* (unplanned prerequisite, see below) | **done** — `ed6235a` |
| **4** | Neutral re-point + monospace figures | **done** — `02e01f0` |
| **3** | Dark mode, `chartTheme()`, markdown, focus rings | **done** — `dc0a160` |
| **5** | Certainty vocabulary — §6, five states | **done** — `d36303e` |
| **6a** | Chat into the shell: the route move and the height fix | **done** — `67fc15a` |
| **6b** | Chat as a docked assistant panel — §13 | **done** — `d9c0057` |
| **7** | B1, B2, B3; then the shell — §12 | **blocked** on the trial |

**Phases 3 and 4 ran in the opposite order to the plan.** The recolour was what
the work was for; dark mode is larger and separable. Nothing depended on the
order, but §9 and any future reading of this table should know it.

**One phase was added that the plan did not have.** Phase 2 collapsed the
primitives but left ~100 call sites naming `farm` stops directly — bare colour
utilities on spans, which no primitive reaches. §4's promise is that re-pointing
one file recolours the app, and it could not: a trial run of phase 4's values
turned the app neutral while leaving the selected chip and the user's chat bubble
grey, because `chip-group.chipClass()` still said `bg-farm-600` and a ramp cannot
tell a brand fill from muted text when both are farm-600. `ed6235a` moved all of
them and deleted the ramp's last consumer.

**Phase 6 is split.** 6a is a bug fix — the panel renders outside the shell today
and would collapse inside it. 6b is design work with its own spec. As one commit
they would produce a broken intermediate that is neither the old route nor the
new panel.

### 2.1 What was measured, before and after

| | before | at `dc0a160` | after 5, 6a, 6b |
|---|---:|---:|---:|
| Distinct whole-attribute class strings | 358 | 295 | **305** |
| Total occurrences | 957 | 619 | **626** |
| …of which occur exactly once | 230 | 207 | **218** |
| Distinct table-cell class strings | 31 | 3 | **3** |
| Cell padding scales in simultaneous use | 4 (44/34/12/7) | 2 | **2** |
| `farm` references in `src/` | ~500 | 0 | **0** |
| CSS custom properties | 0 | 55 light + 55 dark | **55 light + 55 dark** |
| Colour-setting hex literals outside the token layer | 13 | 0 | **0** |
| Frontend tests | 281 | 294 | **328** |
| Initial bundle | 527.98 kB | 540.08 kB | **555.12 kB** |

**THE METRIC WENT UP, AND IT WAS SUPPOSED TO.** Phases 1–4 were a migration and
the number measured how much drift they collapsed. Phases 5 and 6 ADD three
screens' worth of vocabulary, a docked panel and a shortcut registry, so
+10 distinct strings over three phases of new surface is the cost of the work
rather than a regression in it. The count is a drift detector, not a budget.

Where the ten went: the certainty states composed inside cells needed wrapping
`<span>`s that carry their own positional classes, the assistant panel is nine
new strings on its own, and eleven of the eighteen new single-occurrence strings
are the panel's geometry. Note the arithmetic: **218 of 305 now occur exactly
once**, up from 207 of 295, so all ten of the new distinct strings and one
previously-repeated one landed in the singleton pile. That is the floor §2.1
already identified holding exactly as described — the new strings are layout,
and no primitive collapses layout.

**`--certainty-*` needed NO new token**, which is the row worth reading twice:
55 + 55 is unchanged across a phase whose entire subject was colour. §4.5's four
certainty properties were declared in phase 1 and phase 5 simply consumed them,
and the fifth state took `--text-disabled` rather than a name of its own.

§12.5 still moves a subset: `mx-auto max-w-4xl space-y-6` is one string on every
screen, and per-screen widths replace it with three.

---

## 3. BLOCKED — awaiting the five-animal trial

Three items, and only these. Everything else proceeds. The predictions are
`REGISTRY_ENTRY_UX.md` §11.

| # | Blocked | Prediction | Rule until the trial reports |
|---|---|---|---|
| B1 | Field order and count on `/animals/new`, `/animals/calvings/new` | 1 (`acquired_from` in the tab path), 3 (ten tab stops, half empty) | No field may be added, removed or reordered on either form |
| B2 | Visual differentiation of the two adjacent `date-text` fields | 2 (overshooting arrival into birth) | Both keep identical placeholders and identical treatment. §11 says the fix "is not obvious, which is why it was not applied blind" |
| B3 | Relative prominence of the write-log bar | 5 (announcement too quiet) | [registry-shell.ts:123](../web-angular/src/app/registry/registry-shell.ts#L123) keeps its **contrast against its surroundings**. It may be tokenised at equal contrast; it may not be made louder or quieter |

Predictions 4 (dam surviving between calvings) and 6 (`Cmd+Enter`) are
behavioural and constrain nothing here.

### 3.1 B3 is why the write-log bar has its own three tokens

The `success` role's foreground is green-800; the bar is `text-green-900` on
`border-green-200`. Mapping the bar onto the role would make it **lighter** —
quieter — which is the exact axis prediction 5 measures. So it has
`--writelog-bg/-fg/-line` at its own values, and the token migration
additionally split off `--success-strong` and `--success-line-soft` as separate
names holding **identical** values. One token per value would have meant phase 4
re-pointing the bar along with everything else.

**It works.** Phase 4 turned every surface neutral and the bar kept its greens.

**B3 permits the bar to move in dark**, and it does. B3 freezes contrast relative
to surroundings, not the hex: a bar still at `#f0fdf4` on a `#141413` page would
be a white slab. §4.4's dark values are "matched for perceived contrast rather
than mapped from the light set", which is the same instruction.

### 3.2 The two positive predictions, and the rule that protects them

§11 records **eight** predictions, not six. Two are expected to feel *better*:
"the printed digit accelerators on sex and outcome, and the single date field on
murky dates". The B1–B3 table enumerates 1–6 and misses these.

This mattered for phase 5. §6 gives the unanswered state the `warning` role, and
the calf-sex chip on `/animals/calvings/new` **starts unanswered** — §11's
amendment removed its default and says "the accelerator now fires every record".
A naive phase 5 would paint the accelerator amber: the exact element one of the
two positive predictions is measured on.

**Resolved, and not as a workaround.** The unanswered state applies to **rows and
list items, never to a control the eye is already on**:

> Amber's job in the unanswered state is to make something **findable** — a row
> skipped in a 31-animal roster, a destination unanswered on the dispatch sheet.
> A two-option chip group sitting directly in the tab path is not lost; you are
> looking at it, and the disabled submit already names it. Amber there is noise
> that trains the eye to ignore amber elsewhere.

`ChipGroup` is therefore exempt from the unanswered treatment permanently, and
would be even if the trial had already run. This also resolves §3.3 for phase 5:
the component that most straddles the gate is the one component the vocabulary
does not touch.

### 3.3 The trial gate is drawn around routes; the code is organised around components

Three input primitives straddle the line: `chip-group` (2 frozen screens, 8
free), `identifier-input` (2 / 5), `precision-date` (2 / 2). There is no way to
give `ChipGroup` a treatment "on `/milk/milking` only".

This did not bite phases 1–4, because those were either zero-delta or affected
the frozen forms in ways B1–B3 permit. §3.2 removes the phase-5 case.
`identifier-input` and `precision-date` take the certainty treatment only for
values they *display*, which B2 already governs — so the gate holds without a
component-level freeze.

**It held.** Phase 5 touched neither input primitive, and the only change
reaching either frozen form is the help-prose demotion, which applies to every
screen and differentiates nothing on those two from each other. `precision-date`
keeps its amber override box, both `date-text` inputs keep identical
placeholders and identical treatment, and no field was added, removed or
reordered. B2's own instruction was that the fix "is not obvious, which is why
it was not applied blind"; the vocabulary gave it a treatment it could have
used, and it was still not applied.

### 3.4 The contamination that was accepted

**`/animals/new` now has nine tab stops in the empty state, not eight.**

§7.3's Button unifies the disabled state on `aria-disabled` rather than the
native attribute, because `aria-describedby` can only reach the reason text if
the button is focusable — a natively disabled button is skipped, so the reason it
points at is never announced. Dropping the native attribute puts the blocked
submit back in the tab order.

Measured, not inferred:

| Screen | tab stops, empty state | after |
|---|---:|---:|
| `/animals/new` | 8 | **9** |
| `/animals/calvings/new` | 6 | **7** |

The ten of prediction 3 are the ten controls (sex group is one stop — roving
tabindex; the two `estimated` checkboxes are natively disabled until a bare year
is typed).

**B1 freezes *fields*, and a submit button is not a field**, so nothing in the
gate caught it — while §3's own text names "buttons" as applying to both forms
and forbids the `legacy` variant that would have preserved the measurement. This
was raised before implementing, and the decision was **to build the system now
and read the trial against the built system**, folding any improvement found in
live use back into this document. It is recorded in
[button.ts](../web-angular/src/app/ui/button.ts)'s header too. Treat it as a
third entry alongside the two contaminations §11 already documents.

**How to score prediction 3 against it.** Record it as *predicted 10, measured N,
of which one is the submit button, which was not a tab stop when the prediction
was written*. The prediction's substance is friction from tabbing through blank
optional fields, and one extra stop at the end of the sequence does not create
that — but the number moved, and the comparison has to stay legible.

### 3.5 A ninth prediction, pre-registered

§3.4's change may have created a friction none of the eight cover, so it is
recorded **before** the trial rather than explained after it:

> **9. Tab from the last field now lands on the submit button, and Enter does
> nothing** while it is refused. During a fast backfill that is a new stumble at
> the end of every record.

Pre-registering it is the discipline §11 set up: an outcome recorded in advance
can be told apart from taste.

---

## 4. Token vocabulary — as implemented

**Two layers, not the three originally planned.** The `farm` ramp is deleted, so
the custom properties in [styles.css](../web-angular/src/styles.css) *are* layer
1, and the semantic names in
[tailwind.config.js](../web-angular/tailwind.config.js) are layer 2. The
indirection did its job and collapsed.

`:root` holds 55 properties; `.dark` overrides all 55. Every one is a **channel
triplet** (`247 247 245`), not hex, because the config wraps each as
`rgb(var(--token) / <alpha-value>)` and the placeholder is what keeps opacity
modifiers working.

### 4.1 Core

| Token | Light | Dark | Tailwind name |
|---|---|---|---|
| `--surface-page` | `#F7F7F5` | `#141413` | `surface-page` |
| `--surface-raised` | `#FFFFFF` | `#1C1B1A` | `surface-raised` |
| `--surface-sunken` | `#EFEEEB` | `#232220` | `surface-sunken` |
| `--text-primary` | `#1A1917` | `#F0EFEA` | `content-primary` |
| `--text-heading` | `#2E2D2A` | `#E8E6E0` | `content-heading` |
| `--text-secondary` | `#4A4844` | `#C4C2B9` | `content-secondary` |
| `--text-muted` | `#63615C` | `#9E9C93` | `content-muted` |
| `--text-subtle` | `#82807A` | `#7C7B74` | `content-subtle` |
| `--text-disabled` | `#A8A69E` | `#57564F` | `content-disabled` |
| `--text-on-fill` | `#FFFFFF` | `#20120A` | `content-onFill` |
| `--border-hairline` | `#EFEEEB` | `#232220` | `line-hairline` |
| `--border-subtle` | `#E3E2DE` | `#2C2B28` | `line-subtle` |
| `--border-default` | `#CBC9C3` | `#3A3934` | `line` (DEFAULT) |
| `--border-strong` | `#A8A69E` | `#4A4844` | `line-strong` |
| `--border-selected` | `#A9603C` | `#C88356` | `line-selected` |
| `--fill-brand` | `#A9603C` | `#C88356` | `brand` (DEFAULT) |
| `--fill-brand-hover` | `#8E4E30` | `#D9976C` | `brand-hover` |
| `--fill-brand-disabled` | `#E3E2DE` | `#2C2B28` | `brand-disabled` |
| `--fill-badge` | `#EFEEEB` | `#2C2B28` | `brand-badge` |
| `--focus-ring` | `#A9603C` | `#C88356` | `focus` |
| `--divider` | `#EFEEEB` | `#232220` | `divider` |
| `--mark-pending` | `#A8A69E` | `#57564F` | `mark-pending` |

`--border-selected` is a **state, not a brand fill**: `border-farm-600` at 8
sites was the selected chip, selected card and active tab. It shares a value with
`--fill-brand` today and must not share a name, or phase 7 cannot move one
without the other.

**`--text-on-fill` goes dark in dark mode** (`#20120A`). The brand lightens to
`#C88356` and white on it fails contrast. Surfaces also do not invert
symmetrically — dark needs less separation between page/raised/sunken to read as
distinct — so the dark set is not the light set flipped.

### 4.2 Roles

Unchanged from today's Tailwind palette in light; the target Light column *was*
already the current values, so phase 4 moved nothing here.

| Role | Light bg / fg / line | Dark bg / fg / line |
|---|---|---|
| `danger` | `#fef2f2` / `#991b1b` / `#fca5a5` | `#2A1414` / `#F4A9A0` / `#4A2020` |
| `danger-soft` (red-700) | `#b91c1c` | `#E8877C` |
| `danger-strong` (red-900) | `#7f1d1d` | `#F8C4BD` |
| `danger-dot` (red-500) | `#ef4444` | `#F87171` |
| `warning` | `#fffbeb` / `#92400e` / `#fcd34d` | `#2E230F` / `#E0B558` / `#47370F` |
| `warning-strong` (amber-900) | `#78350f` | `#EFC97A` |
| `warning-fill` (amber-200) | `#fde68a` | `#47370F` |
| `success` | `#f0fdf4` / `#166534` / `#86efac` | `#12291B` / `#7CC495` / `#22452F` |
| `success-strong` (green-900) | `#14532d` | `#9BD9B4` |
| `success-line-soft` (green-200) | `#bbf7d0` | `#2E5A3D` |
| `success-dot` (emerald-500) | `#10b981` | `#34D399` |

`danger-soft` exists because `text-red-700` is pinned by
[tool-call-chip.spec.ts](../web-angular/src/app/components/tool-call-chip.spec.ts)
and a `danger` role fixed at red-800 cannot express it. The `-strong`, `-fill`,
`-dot` and `-line-soft` names were added during the token migration for the seven
utilities the original spec never named; **their dark values are derived, not
specified**, and are the least-verified thing in the token layer.

**On red and amber.** `sales.spec.ts:269` and `routing.spec.ts:212` look like
they lock these meanings and do not: both are *negative* substring checks on
single elements ("this note must not be red"), they constrain restraint rather
than meaning, and both now pass **vacuously** — the literals are gone. Keeping
danger on red and warning on amber is a design choice defended on convention, not
a tested invariant. Whoever changes it should know the tests will not catch them.

#### 4.2.1 Amber is reserved for two meanings — and carries five

§6 called the unanswered state "the only amber on the screen", which was already
false when written: the harness banner is `bg-amber-200`
([session-bar.ts:27](../web-angular/src/app/registry/session-bar.ts#L27)), pinned
by [target.spec.ts](../web-angular/src/app/registry/target.spec.ts). Every
harness screen had two ambers before phase 5 proposed a third — and the census
below shows that "two" was itself a large undercount.

| Meaning | Token | Where |
|---|---|---|
| **This needs an answer from you** | `warning` role | unanswered rows and list items, incomplete session counters, `/check` findings |
| **This is not the real registry** | `warning-fill` | the storage chip in the header (§12.2), and nowhere else |

They coexist because the second is confined to one element in the **chrome** and
never appears in the content area. **Nothing else may take amber**, and §8's
invariant table now checks it. `danger` needs no equivalent reservation: an error
panel is self-announcing.

### 4.3 Categorical ramp — agents

`agentClass()` needs four mutually distinguishable values meaning *which agent
answered*, not error/outstanding/settled. Folding it into the roles would make
the `vendor` chip mean "outstanding", which is false.

| Agent | Light bg / fg / line | Dark bg / fg / line |
|---|---|---|
| `dairy` | `#ECF5F1` / `#2F6F5E` / `#BFDCD3` | `#122622` / `#79BFAB` / `#22403A` |
| `vendor` | `#EEF0FA` / `#4C5FA8` / `#C7CEEA` | `#161A2E` / `#8FA0DC` / `#272E4D` |
| `both` | `#F3EEFA` / `#7A5AA8` / `#D8CBEA` | `#211A2E` / `#B197D9` / `#352A4D` |
| default | `surface-sunken` / `text-muted` / `line-subtle` | same tokens |

**`vendor` has left amber**, which was the point: a vendor answer used to wear the
same colour as an unanswered milking row. §4.2.1 is why it may not go back.

**That sentence was half true for three commits.** `ed6235a` moved the vendor
chip's foreground and border onto the ramp and left `bg-warning-bg` in
`agentClass()`, so the chip still rendered on the warning role — in the chat's
content area, the one place §4.2.1 forbids, and as the only element in the app
mixing a categorical ramp with a role. Found by the amber census
(PHASE5_PRECHECK.md §2), which is what a census is for; fixed in phase 6b, which
is the phase that owns the component. The lesson is narrow and worth keeping: a
three-token migration is three separate edits, and the one that is a background
is the one nobody re-reads.

The tool-call chip (§13.3) also draws from this ramp rather than from `success` —
a completed tool call is not a settled balance. **Built in phase 6b**, per agent,
with the error arm left on `danger` because an error is one.

### 4.4 Write-log — held by B3

`--writelog-bg` `#f0fdf4`, `--writelog-fg` `#14532d`, `--writelog-line`
`#bbf7d0`, unchanged from before any of this work. Dark: `#12291B` / `#8FD3A6` /
`#22452F`, matched for perceived contrast rather than mapped. See §3.1.

### 4.5 Certainty — consumed by phase 5

`--certainty-known` tracks `--text-primary` and `--certainty-absent` tracks
`--text-subtle`, per the original spec. Declared in phase 1, consumed in phase 5,
and **no fifth property was added** — see §2.1.

| Token | Light | Dark |
|---|---|---|
| `--certainty-known` | `#1A1917` | `#F0EFEA` |
| `--certainty-approx` | `#82807A` | `#9E9C93` |
| `--certainty-rule` | `#A8A69E` | `#57564F` |
| `--certainty-absent` | `#82807A` | `#7C7B74` |

**No record** — §6's fifth state — needs **no new token**. It is
`--text-disabled`, which already exists and already sits one step past
`--certainty-absent` in both modes, which is the correct relationship: an absent
answer is quieter than a given one, and no answer at all is quieter still.

**One collision this created, and it is live.** `--text-disabled` also dresses a
SUPERSEDED event in the timeline (`event-list.ts`), which is a statement about
the record rather than about the certainty of anything in it. The two are told
apart by the strike-through, which no certainty state has — adequate, and not the
same as correct. §14.1's `ended` tone is the real fix and it is phase 7.

**And three of these values fail WCAG AA.** `--certainty-approx` and
`--certainty-absent` hold the same light value (`#82807A`), so in greyscale they
are separated by the dotted rule and the italic alone; `--certainty-rule` clears
only 2.1–2.5:1 against a 3:1 threshold, which makes the mark that carries
"approximate" the weakest thing in the vocabulary. Measured, not estimated:
PHASE5_PRECHECK.md §1 and §9.6. Fixing them is a token change and phase 5 was
right not to make it while implementing the states.

"Unanswered" has deliberately **no token**: §6 assigns it the `warning` role, and
a second name for one value is how the two drift apart.

### 4.6 Config

`darkMode: 'class'`. `fontFamily.mono` overridden — note this also changes
preflight's `code, kbd, samp, pre` base rule, not just `font-mono`, so it reaches
markdown code blocks. `plugins: []`.

**`@tailwindcss/forms` is deliberately not adopted.** It is a global base-layer
restyle of every `input`, `select`, `textarea`, `checkbox` and `radio`.
`calving-form`'s first field is a `<select>` whose most visible change under the
plugin is a new chevron, padding and border; `precision-date` carries a
`type="checkbox"` it restyles completely. Both sit on the frozen forms. The
benefit — themeable native controls — is now delivered without it: `TextInput`
covers the five `<select>` elements explicitly, and `color-scheme` (§4.7) makes
the eleven date pickers follow the theme. **Revisit only if something else needs
it.**

### 4.7 Theme switching

[core/theme.ts](../web-angular/src/app/core/theme.ts). Three-way —
system / light / dark — persisted to `localStorage`, `.dark` class on `<html>`,
and `color-scheme` set per mode.

`color-scheme` is the half that is easy to forget: `.dark` restyles what the app
draws, and nothing else. Scrollbars, the eleven date pickers' calendars, select
dropdowns, autofill backgrounds and spellcheck underlines follow `color-scheme`,
and without it a dark page opens a blinding white calendar over itself.

**This persists while `session.ts` refuses to, and that is not drift.** Session's
rule is about *provenance* — a remembered `recorded_by` mis-attributes a record.
A remembered theme cannot. Pinned in
[theme.spec.ts](../web-angular/src/app/core/theme.spec.ts), including that a junk
stored value is refused rather than passed through to `classList.toggle`.

---

## 5. Type, density and figures

**Two families.** The system sans for prose and labels; a real monospace for
identifiers, quantities, dates and currency. `font-mono` plus `tabular-nums` on
any column of figures — this is the change that does most for the app's
character, because tabular alignment is what lets an eye scan 31 rows for an
anomaly.

**Applied** at every `Cell` marked `numeric`, eight money figures outside tables,
and four amount inputs. Two refinements found by rendering:

- **A numeric `<th>` gets the alignment but not the face.** A header is a word —
  "Days", "Recorded", "Rate today" — and words in a figure font make a table look
  like a terminal.
- **`whitespace-nowrap` comes with `numeric`.** A figure that wraps reads as a
  smaller number.

**Scale.** Tailwind's, no custom sizes. Three heading levels, which is one more
than the app knew it had — `SectionHeading` at `text-sm font-semibold` was the
missing middle, and the most-repeated single heading string in the app.

**Density.** Compact for entry (milking roster, dispatch, payroll, both forms),
comfortable for review (herd list, detail pages, `/check`, chat). Implemented on
`Cell` and `TextInput` as a `density` input. **A `<th>` is always comfortable** —
both entry screens paired a roomy header with tight rows consistently, which
reads as deliberate, and honouring it meant those two tables came through the
whole migration visually unchanged.

**Help prose demoted — DONE in phase 5.** The original spec wanted `text-xs`,
`content-muted` and a bounded measure, on the grounds that help text was "nearly
as loud as the labels it explains". It was a real visual change, the original
phase list assigned it to **no phase**, and phase 2's acceptance forbade it —
so it rode with the certainty vocabulary, which needs the prose one step quieter
to read at all.

**What moved is the DEFAULT, not the variants.** `HelpText.size` still takes
`sm`; it is simply no longer what a bare `appHelp` gets. That demoted the 34
sites relying on the default and left the 38 already passing `size="xs"`
untouched. Those 38 are now redundant and were deliberately not stripped: they
document a site that wanted `xs` regardless of what the default is, and 38
no-op template edits would be churn with no visual result.

**A prose measure is independent of its container.** A note under a full-width
table wraps at 68ch, not at the table's width — `max-w-[68ch]`, which only ever
constrains, so a paragraph already inside a 320px column is unaffected. 68 and
not the original draft's 65, because §5 and §12.5 both settled on 68 and one
number in two places is how they drift. See §12.5.

**It is a `max-width`, so it does nothing on an inline element**, and four sites
put `appHelp` on a `<span>` inside a flex row. Those are single clauses rather
than prose and their measure is already bounded by the row, which is why the
primitive does not force `display: block` — doing so would break four layouts to
bound a measure that needs no bounding.

---

## 6. The certainty vocabulary — built in phase 5

**Built**, `d36303e`. This was the design idea of §1 and the largest remaining
piece; everything in phases 1–4 existed to make it expressible.

Implemented as two directives in
[ui/certainty.ts](../web-angular/src/app/ui/certainty.ts) — `Certainty` for the
five states and `Qualifier` for §6.1's word — plus one `unanswered` input on
`RowDivider`, because the fifth state belongs to a row and not to a value (§3.2).
The domain mapping from a stored date to what should be shown for it lives
separately in
[registry/precision-display.ts](../web-angular/src/app/registry/precision-display.ts),
so `ui/` knows nothing about `DatePrecision`.

**Five states, not four.** The third and fourth look alike and are different
facts: `not_measured` is a **recorded answer** — the animal was milked, nobody
weighed it — while a missing row is **nothing recorded at all**.
`REGISTRY_MILKING.md`'s completeness report keeps them apart on purpose, and
`/check` reports "22 rows carry a number, 5 milked but unweighed, 1 not milked"
precisely so they are never blended. A vocabulary that rendered them identically
would undo that in the one place a person actually looks.

| State | Treatment |
|---|---|
| **Known** — measured, exact day, observed | `certainty-known`, `font-mono tabular-nums`, no ornament |
| **Approximate** — estimated, month/year precision, recalled | `certainty-approx`, `border-b border-dotted` in `certainty-rule`, a qualifier naming the imprecision (§6.1) — **and, as built, `font-mono tabular-nums` too; see below** |
| **Deliberately absent** — an answer was given: `not_measured`, `nothing taken`, nobody observed | `certainty-absent`, *italic*, always **words** |
| **No record** — nothing was ever entered | `content-disabled`, roman, an en dash `–` |
| **Unanswered** — still required | The `warning` role. The only amber in the **content area** (§4.2.1) |

The earlier rule "always words, never a dash" becomes: **an answer is always
words; only the absence of an answer is a dash.**

**ONE DEVIATION, TAKEN DELIBERATELY.** The table above lists `font-mono
tabular-nums` under `known` alone, on the unstated assumption that an
approximate value is words. It is not: `2017-03` is a figure, and every date
column in this app holds both certainties at once. §5's rule is `font-mono` plus
`tabular-nums` "on any column of figures … tabular alignment is what lets an eye
scan 31 rows for an anomaly", so dropping the face on the approximate half
would have left every date column ragged. `approximate` therefore takes the
face as well, and what separates it from `known` is the ornament, the tone and
the qualifier — three marks rather than one. §6's own contrast for `known` is
"NO ORNAMENT", which still holds exactly.

The rate columns on the dispatch sheet and the buyer record are the counter-case
and were left alone: a composite rate label is not a figure column, and §11
records the 48px the sheet grew the last time it was set in mono. They take a
certainty state only when they are reporting an absence.

**AND ONE RULE THE DASH NEEDED.** §6 reserves the en dash for the no-record
state, and three sites turned out to be using it for something else — two
hiding a REASON (`not billed` on the dispatch sheet, and destination-detail's
rate column, which returned an empty string outright) and one hiding a KNOWN
ZERO (`people-list.owed` dashed a balance of exactly nought, from a ledger with
entries in it that net to nothing, while `person-detail` two clicks away already
said "Settled — nothing outstanding"). §15 rule 1 forbids "a zero standing in
for an unknown"; that last one was an unknown standing in for a zero, which is
the same lie facing the other way.

So: **the dash is for when there is nothing to say that is not already said.**
Where the absence has a reason worth naming, name it — and the treatment follows
the fact rather than the glyph. A `no price` in words is still the no-record
state.

### 6.1 The qualifier

Lowercase, no parentheses, `text-xs` in `content-subtle`, one space after the
figure: `2017-03 month`, `2016 year`, `~2018 est`.

**THE FIGURE IS TRUNCATED TO ITS PRECISION, AND THAT TURNED OUT TO BE THE
SUBSTANCE OF THIS SECTION** rather than the punctuation. The registry stores
every date as a full ISO day and records separately how much was known — `month`
as the 1st, `year` and `estimated` as January 1 — so three screens were
rendering `2019-03-01 (month)`: a day the operator was careful NOT to claim,
printed as though it were known, beside a qualifier denying it. The comment
above the herd list's own cell read *"never a bare date: hiding the qualifier
manufactures confidence"*, which was right about the qualifier and blind to the
fabricated day two characters to its left.

`~` is kept on `estimated` **as well as** the word, and the two say different
things: `est` names why the figure is imprecise, while `~` says the figure
itself may be wrong. A `year`-precision date is an exact year with an unknown
month; an `estimated` one may not be the right year. Without the tilde the two
would render identically apart from one word.

One space is implemented as `ml-1` rather than a literal space: Angular's
default `preserveWhitespaces: false` removes whitespace-only text nodes between
elements, so a template reading `</span> <span appQualifier>` cannot be relied
on to keep the gap.

Not `YEAR` / `EST`. Uppercase labels are the one typographic treatment the app
avoids everywhere else, and the herd table already renders `(month)` lowercase.
The `~` prefix is kept for **quantities** (`~9.9 L`), where there is no room for
a word and the tilde already reads as "about".

### 6.2 Where it applies

`/milk/milking` (the four row states plus no-record), `/animals` and
`/animals/:id` (precision suffixes), `/check` (the separated measured/approximate
boxes, finding severities), `/milk/dispatch` (`nothing taken`, `not billed`,
`kept, not sold`), `/labour/*` (owed, in advance, and the bare em dash that
should be the no-record state).

**`decoration-certainty-rule` in `people-list` was NOT the dotted rule**, and
this sentence used to claim it was. It is a SOLID underline on an identifier
link — a person's `identifier`, rendered as a navigation target. Leaving it there
once `--certainty-rule` means "this figure is approximate" would have said that
this person's identifier was a guess. Moved to `line-strong`, which is the value
§14.2 specifies for exactly this treatment: "an identifier is a name, not a
link". The certainty rule now has one meaning and one kind of consumer.

### 6.3 What it does not apply to

**`ChipGroup` never takes the unanswered treatment**, on any screen. §3.2 gives
the reasoning: amber's job is to make something findable, and a chip group in the
tab path is not lost. A permanent design rule, not a trial workaround.

**Carried by weight, contrast and a mark — never by hue alone.** It must survive
dark mode, greyscale and colour blindness. This is the same commitment
`intervalReport()` makes when it refuses to average a measured interval with an
approximate one. **Acceptance is that the five states are distinguishable in
greyscale.**

**TESTED, IN BOTH SENSES.** Visually, by
[scripts/shoot-screens.mjs](../scripts/shoot-screens.mjs) `--grey`, which
desaturates the live page and captures it — so the states can also be LOOKED at,
which is what actually finds a pair that has collapsed into one grey. The
non-hue marks that separate them:

| State | The mark that survives greyscale |
|---|---|
| Known | monospace, roman, a figure, no ornament |
| Approximate | a **dotted underline**, plus §6.1's qualifier word |
| Deliberately absent | **italic**, and always words rather than a figure |
| No record | an **en dash** — a different glyph from any word or figure |
| Unanswered | a **filled ground and a 3px leading bar**, which no other state has |

Structurally, by
[ui/certainty.spec.ts](../web-angular/src/app/ui/certainty.spec.ts), which
enumerates all **ten pairs** and fails if any two share every non-colour mark.
Tone is deliberately excluded from what counts as a separator there, which makes
the test stricter than the palette — and correctly so, because two of the tones
are the same number.

**The thinnest pair is `approximate` against `absent`**, and it is thin for a
measurable reason: `--certainty-approx` and `--certainty-absent` hold the
IDENTICAL light value (`#82807A`), so in light greyscale they are told apart by
the dotted rule and the italic alone, with no tonal separation at all. That is a
real distinction and it is one mark thinner than the other nine pairs. Recorded
rather than papered over, and it is an argument for moving one of the two light
values — a token change, and not phase 5's to make while implementing the states.

The screenshot is the weaker half of this proof and the spec is the stronger
one: a capture proves the vocabulary was distinguishable on the day it was
taken, and the spec is what stops a later edit quietly reducing two states to a
pair of greys.

**Constrained by B2** on the two frozen forms: the vocabulary applies to values
they display, but the two `date-text` inputs must not be differentiated *from
each other*.

---

## 7. Primitives — as implemented

**Eighteen directives and one component**, in
[src/app/ui/](../web-angular/src/app/ui/). Being attribute directives rather
than components is the one structural deviation from the plan, and it is forced
by the code rather than chosen.

**This section said "fifteen" for four phases and §7.2's own table has always
summed to sixteen** — 1 cell + 4 text + 1 input + 6 surface + 3 heading + 1
button. Corrected here rather than left to be rediscovered, and noted because
it is the same failure this document's preamble describes: "three documents
disagreeing about the same counts is how the counts went wrong the first time."
One document can disagree with itself just as easily, and a prose number beside
a table that contradicts it is how.

The seventeenth and eighteenth are `Certainty` and `Qualifier` (§6, phase 5);
`RowDivider` gained an input in the same phase. The one component is
`ThemeToggle`, and phase 6b added a second in `components/` — `AssistantPanel`,
a component for the same reason, because it has content and behaviour.

### 7.1 Why directives

86 of the spec-reached `data-role` hooks sit on the exact element a primitive
would absorb: 38 on an error panel's own `<p>`, 36 on an `<input>`, 12 on a
`<button>`, 12 on a `<td>`. A wrapping `<app-help-text>` still *matches*
`[data-role="hint"]`, because the host carries the attribute — but the suite does
not stop at matching. It casts querySelector results to concrete element types 68
times, reads `.disabled` 37 times, assigns `.value` 31 times, calls
`dispatchEvent` 44 times, and
[identifier-input.spec.ts:26](../web-angular/src/app/registry/identifier-input.spec.ts#L26)
asserts `input.tagName === 'INPUT'` outright — a test whose whole point is that
this control is an input with a datalist and not a `<select>`. A component fails
that one by construction, and a `<td>` is the only child a `<tr>` accepts.

*(The denominator here was written as 115. §10.3 records that 115 is not
reproducible by any stated rule; 86 is the count that carried the argument and
the argument does not turn on the total.)*

A directive keeps the element, its attributes, bindings and handlers exactly
where they were and contributes only classes. Angular merges a host `[class]`
binding with the template's static `class`, so a call site keeps its positional
classes (margins, widths) and gives up only what the primitive owns. **Zero hooks
needed rewriting, including the 21 interpolated ones**
(`[attr.data-role]="'litres-' + row.destination_id"`).

### 7.2 The set

| File | Primitives | Sites collapsed |
|---|---|---:|
| `cell.ts` | `Cell` — `density`, `tone`, `numeric`, `emphasis`, `nowrap`, `small` | 98 |
| `text.ts` | `HelpText` (`size`, `tone`), `FieldLabel` (`inline`), `SectionLabel` (`legend`), `TextLink` (`tone`) | 131 |
| `input.ts` | `TextInput` (`density`) — also `<select>` and `<textarea>` | 50 |
| `surface.ts` | `Card` (`empty`), `ErrorPanel` (`size`), `ErrorText`, `RowDivider`, `StatusBadge` (`tone`), `SummaryBar` | 66 |
| `heading.ts` | `PageHeading`, `SectionHeading`, `SubHeading` | 43 |
| `button.ts` | `Button` — `variant`, `size`, `appButtonDisabled`, `reason` | 19 |
| `certainty.ts` | `Certainty` (§6's five states), `Qualifier` (§6.1) — **phase 5** | — |
| `theme-toggle.ts` | `ThemeToggle` — a **component**, since it has content and behaviour | — |

The last two collapse nothing, which is why their column is empty: they express
a distinction that was not being made anywhere rather than unifying one that was
being made twelve ways. That is the difference between phases 1–4 and phase 5,
and it is why §2.1's metric goes up rather than down.

`Cell` was the largest collapse: 98 cells over 31 strings and four simultaneous
padding scales became two densities and 3 strings. **No cell carried `rounded`**,
which is why the original metric — distinct `rounded`-bearing strings — was blind
to the app's largest inconsistency.

`NotePanel` from the earliest draft **does not exist** and was not created. Its
eight sites are stat tiles inside `verification-panel` and remain a local `@for`.

§14 specifies four additions the set still needs — all four still unbuilt.

### 7.3 Button — the one sanctioned appearance change

Was 19 sites over **eight** distinct strings (the plan's prose said seven; its own
table listed eight rows summing to 19): three radii, two enabled fills — payroll,
the people list and the person record were `bg-farm-800` while everything else
was `bg-farm-600` — `hover:` on 3 of 19, and four different answers to what
disabled looks like.

Now: one radius (`rounded-lg`), one fill, one hover, and a disabled state that is
**visibly inert** rather than a light tan under white text that still invites the
click. `aria-disabled` with `aria-describedby` at the reason text; the six sites
with such text gained an `id` and their wording is untouched.

**Where the refusal now lives, measured rather than assumed.** Dropping the
native attribute means the browser stops suppressing the click:

- `type="submit"` (15 of 19) — the directive's `preventDefault` cancels the
  click, which cancels the form submission. **Primary.** With the handler guard
  removed the suite still passes; only when `preventDefault` also goes does
  `target.spec.ts`'s "cannot be clicked past" fail.
- `type="button"` with a template `(click)` (payroll's save) — host and template
  listeners on one element have no guaranteed order, so the **handler guard** is
  the only defence.

All 19 handlers were checked. `destinations-list.submitPrice()` was the one that
re-checked only half its button's condition and now re-checks both.
`animal-form`'s guard turns out to be enforced by the **type system** — removing
it fails compilation, because it is what narrows `DateEntry` to the branch
carrying `.value`. Worth knowing before anyone "simplifies" it.

**Two lookalikes are not swept in.** `message.ts:16` is the user's chat bubble
(§13.3 wants it quieted, not unified) and keeps its own classes.
`confirmation-card`'s brand-filled pill is a badge and took `StatusBadge`.

### 7.4 Focus — one deliberate departure

The spec asked for `--focus-ring` on every interactive primitive. **Inputs take a
border shift instead.** `composer.ts` traded the native outline for
`focus:border-…` as a recorded decision, and the spec itself says to keep that
and not reinstate an outline there. A ring on every *other* input would leave one
element type with two focus languages, with the most-used control the odd one
out. Buttons and links take the ring, with `ring-offset-surface-page` — an offset
with no ground colour paints white on a dark page, which is the usual way a ring
looks broken in dark.

§14.4 completes the border shift, which is currently a colour change only and is
close to invisible at a 1px border on a light surface.

---

## 8. Invariants — what breaks if you are careless

**Check these after every change, not at the end.**

| Invariant | How to check |
|---|---|
| **Spec-reached `data-role` hooks** must survive any markup move — 116 by the rule §10.3 now states | §10.3 |
| **Amber's census must not grow**, and every site must be classified by meaning | `ui/amber.spec.ts` — and read §4.2.1's correction first |
| **The five certainty states must be separable without hue** — all ten pairs | `ui/certainty.spec.ts`, §6.3 |
| **`templates.spec.ts`** — any registry file containing `.provenance()` must also contain `<app-session-required`, with two named route-gated exceptions. Its glob is `./*.ts`, registry only | in the suite |
| **No backtick inside a `template:` literal** | `npm run check:templates` |
| **`display: block` list** in styles.css must contain every non-routed component in `src/app/**` | `npm run check:templates` — §9.2, and NOT in the suite; see there |
| **Only one owner may hold a global key chord** | `core/shortcuts.spec.ts`, §12.6 |
| **The three opacity modifiers** must resolve through the tokens | §10.4 |
| **B1–B3** (§3) | judgement |
| Five `className` assertions and 30 `aria-disabled` assertions | in the suite |

**Two rows in this table changed meaning rather than being ticked off**, and the
difference matters more than the tick would have.

*Amber* was "appears in exactly two roles". It never did — see §4.2.1. The
invariant is now that the census cannot grow unclassified, which is a rule that
can actually hold.

*The `display: block` list* is no longer "manual". It is also no longer in the
suite, which is where §9.2 assigned it: `?raw` on a `.css` file returns an empty
string under `@angular/build:unit-test`, so the guard read its input as `''` and
reported every listed component as missing. §9.2's mechanism is wrong and the
check now lives beside the backtick guard, which was moved out of the suite in
`dc0a160` for the same class of reason (§8.3).

### 8.1 The stylesheet-order trap

**This is the one that cost the most, and it is not obvious.**

After the twelve non-button primitives landed, all fourteen screenshots differed
— 263 pixels on one screen, 14 rows, `77 55 34` where `138 100 49` belonged. The
ten nav links carry `routerLinkActive="font-medium …"` over a base colour, so
**two colour utilities land on the active link and the winner is decided by their
order in the compiled stylesheet, not by the template.** It had worked only
because Tailwind emits a ramp in ascending stop order. Renaming the base put it
in a different group that lands last, and the active nav item silently lost its
highlight.

Fixed by stating the precedence — `!text-content-primary` — rather than
reordering config keys, which would have restored the same invisible dependency.
**The fragility predated the change; renaming only exposed it.**

Everything else is safe, and was checked: every `[class]` ternary replaces
wholesale so its branches never coexist, and the three `[class.text-warning-fg]`
bindings sit on elements whose base carries no competing colour.
`routerLinkActive` was the only *additive* case.

**§12.1 rebuilds the nav.** When it does, the active state should **replace**
rather than add, or carry the `!` precedence deliberately. This trap is latent in
any nav whose active class is additive.

### 8.2 Surfaces no fixture screen can show

Two sets of rules are invisible to the fourteen-screen baseline, so they must be
verified deliberately or not at all:

- **`border-line-subtle/60`** on `confirmation-card` renders only while an agent
  write is pending approval. One of the three named opacity regression tests is
  therefore unobservable by screenshot; check it in the compiled CSS instead.
- **Every `.prose-chat` rule.** No fixture produces an assistant reply. §10.5 is
  the recipe.

### 8.3 The backtick guard could not fire, and now can

`templates.spec.ts` was built to catch a backtick inside a `template:` literal —
a bug `REGISTRY_PAYROLL.md` §16.3 records as having cost four occurrences over
three cycles. **It cannot catch it.** A stray backtick is a *compile* error, so
`ng test` dies at the build step and the spec never runs; it only ever covered
the rarer subset that still parses.

It is now also [scripts/check-templates.mjs](../scripts/check-templates.mjs), run
by `npm run check:templates` **ahead of the typecheck and both builds** in CI, and
covering `src/app/**` rather than the spec's registry-only glob — so
`components/` is protected for the first time. **It caught three real cases in
the session that added it.** The spec keeps its copy, because it also asserts the
check *fires*.

**This correction belongs in `REGISTRY_PAYROLL.md §16.3` and `OPEN.md` too**, not
only here. As those documents stand, the repo's record says the problem was
solved; it was not, until `dc0a160`.

---

## 9. The work, and what remains

### 9.1 Phase 5 — done, `d36303e`

The spec is §6; read §6.1, §6.3 and §4.2.1 for what changed while it was built.

Sequenced as planned — `/check` first, because it is uncontaminating, already
separates measured from approximate, and is where the vocabulary has the most to
say. Then `/animals` and `/animals/:id`, then the roster, then dispatch and
labour. **Eleven files took the vocabulary**, two more than §6.2 listed: the
event log on `/animals/:id` was the third screen printing a fabricated day, and
the buyers pair carry the same price/rate absences as the dispatch sheet.

The `/check` precision histogram is the one that earned the sequencing. Its
`Precision` column holds the vocabulary's own words — `day`, `month`, `year`,
`estimated` — so each is set in the state it names, and a reader who has seen
`month` dotted there reads a dotted `2017-03` on `/animals` without being told.
It is where the vocabulary is learnable.

Both riders landed: the help-prose demotion (§5) and the amber check (§10.7).

### 9.2 Phase 6a — done, `67fc15a`

`app.routes.ts` had `{ path: 'chat' }` as a top-level sibling of `RegistryShell`.
All four steps are done, and §9.2's two pre-worked conclusions were both
confirmed in the render: `<main>` needs no `min-h-0`, and `py-6`'s 3rem inset
leaves the composer floating 24px off the bottom — a design call about the
shell's padding, left alone.

**Two things §9.2 predicted were stale, and the difference is instructive.**

*`app-session-required` was already in the list.* It was added late in `dc0a160`,
with the twelve call sites and the seven-outside-a-flex-parent analysis in a
comment above it. §9.2 was written before that and never revised.

*The guard cannot live in the suite.* §9.2 says "reading `styles.css` as raw text
works — `'../../styles.css?raw'`". It does not: `import.meta.glob` resolves the
key and returns a module whose `default` is a string of **length zero**, because
`@angular/build:unit-test` intercepts `.css` ahead of Vite's `?raw` handling.
A guard that reads its input as `''` does not fail — it reports every component
as unlisted, which on the first run it duly did, all eleven of them. That is
§8.3's failure one layer along, so the check joined the backtick guard in
[scripts/check-templates.mjs](../scripts/check-templates.mjs). Both of its inputs
are now asserted non-empty before use, and it self-tests that it can still fire.

§9.2's `component:` analysis was right and is implemented: 14 of the 15 routed
classes come from `loadComponent` and `RegistryShell` comes from a static
`component:` — and it is precisely the one whose absence from the list is
deliberate, so a scan reading only `loadComponent` would have sent somebody to
"fix" it.

**What the guard actually found: nine components, all in `components/` and
`ui/`** — which is to say none in the one directory anybody had looked at, the
same blind spot §8.3 records for the backtick guard. Three were live bugs, each
an inline host inside a `space-y-*`:

| Host | Parent | Effect |
|---|---|---|
| `app-message` | `message-list.ts:11`, `space-y-5` | **every gap between every chat message** contributed nothing |
| `app-chart-card` | `message.ts:50`, `space-y-3` | charts butted against each other |
| `app-confirmation-card` | `chat-panel.ts:79`, `space-y-3` | two pending writes sat flush together |

Two of the three are invisible to the fourteen-screen baseline for the reasons
§8.2 already gives. The other six are latent and were listed anyway, per the
policy styles.css already states: flex and grid children are blockified by CSS,
so the declaration costs nothing — and all six become bugs the moment a sibling
appears beside them, which is exactly what happened to `app-session-required`.

### 9.3 Phase 6b — done, `d9c0057`

The spec is §13, and all of it is built except §13.4, which is specification
only because the writes it describes do not exist.

**The initial bundle is the thing worth carrying forward.** The shell imports the
panel statically, so the toggle works on every screen — which pulled `ChatPanel`,
and with it `marked`, `DOMPurify` and `Chart.js`, into the initial bundle:
541.98 → **903.81 kB**, a 67% jump on an app whose 500 kB budget §11 already
records as exceeded. All three were lazy before this phase because they arrived
with `loadComponent` on the `/chat` route, and folding the chat into the chrome
must not undo that. `@defer (when assistant.open())` is the right trigger for a
panel §13.1 makes default-closed: the operator who never opens the assistant
never downloads a charting library. Back to 555.12 kB, so the panel costs
13.14 kB.

**The `/chat` route is kept.** §13 does not ask for its removal, it is the deep
link, and below 1100px the panel is the full content area anyway — which is the
same thing the route renders. `ChatPanel` is mounted in two places and the
context line is absent on the route, because there the route IS the assistant.

**§12.6's shortcut registry was built here rather than deferred**, because §12.6
is explicit that the first global key handler is the one that has to establish
the owner. See §12.6 for what it does and refuses to do.
### 9.4 Phase 7 — after the trial

**The only phase left, and the gate has not moved.** B1, B2, B3; then the shell,
specified in **§12**: header zones, the storage and session chips, five-section
nav, the section bar, per-screen content widths, and the command palette. Plus
`REGISTRY_ENTRY_UX.md` §11's held items — `Cmd+Enter`, the `(optional)` markers,
`Recheck` to the top of `/check`.

**Four things phases 5 and 6 have left on its doorstep**, none of them blocking
and all of them cheaper to do inside §12 than beside it:

- **The assistant toggle is parked.** §13.1 puts it in §12.1's header; it
  currently sits in the existing header's row 1 beside the theme toggle, with a
  comment at the call site pointing here. Note the tab-order consequence §11
  already flagged for the theme toggle: there are now **two** controls ahead of
  the nav rather than one.
- **`/chat` has no entry point.** The route survives 6a and 6b and nothing links
  to it. §12.4's five-section nav is where that gets decided — see §16.
- **§14.1's `ended` tone is now load-bearing**, not cosmetic. `--text-disabled`
  became §6's no-record colour in phase 5, and it also dresses a superseded event
  in the timeline. The strike-through tells them apart, which is adequate rather
  than correct. §4.5.
- **Amber's twelve unpermitted sites** (§4.2.1) cannot move until B1/B2 clear,
  because six of them sit on the frozen forms or on `/animals/new`.

### 9.5 Primitive and token remainders

Small, independent, and each has a reason it was left:

- **`StatusBadge` collapsed 3 of 6.** `event-list.ts:58` (different radius,
  different stop, no `rounded-full`), `event-list.ts:84` (the amber "not billed"
  tag) and `dispatch-sheet.ts:167` (a small aside). §14.1's tone vocabulary
  resolves all three.
- **`SummaryBar` collapsed 2 of 3.** `payroll-run.ts:248` is a `<footer>` with
  `space-y-3 p-4` and no flex.
- **`ErrorPanel` covers 26 of 35.** `chat-panel.ts:95` is a third radius *and* a
  bordered treatment; `verification-panel.ts:81` is a `<li>`. Both are real
  inconsistencies whose fix is visible, so they want a decision rather than a
  quiet normalisation.
- **Help prose demotion** (§5) — **done in phase 5**.
- **`dayly yield`.** [chart-card.ts:51](../web-angular/src/app/components/chart-card.ts#L51)
  concatenates `{{ dataset().interval }}ly`, and the server sends
  `interval: 'day'`. **Still there** after phase 6b, which touched the chart's
  neighbours and not the chart. One line, client-side, and it has now survived
  three phases of somebody being in the file next door.
- **The four `<thead>` elements** sharing `SectionLabel`'s class string were
  skipped deliberately — a directive named for a label does not belong on a table
  head — so that string survives at 4 occurrences.

### 9.6 Verification debt

- **Contrast ratios are now computed**, by
  [scripts/check-contrast.mjs](../scripts/check-contrast.mjs), which reads
  `styles.css` as the source of truth so it cannot drift from what renders.
  `npm run check:contrast`. **33 graded failures — 18 light, 15 dark** — over 124
  graded checks, listed in full in PHASE5_PRECHECK.md §1. Not fixed: they are
  token changes, and phase 5 was right not to make them while implementing the
  states that sit on them.

  The script's own design is the part worth keeping. A first draft checked every
  plausible pair at 4.5 or 3 and printed a hundred failures, most of which were
  the script misreading WCAG rather than the palette failing it. Thresholds are
  now mapped to the criterion that applies — text at 1.4.3, focus and
  meaning-bearing marks at 1.4.11, decoration and any indicator whose state is
  ALSO in adjacent words reported and never failed. Three indicators moved to
  that last tier on the evidence of the code rather than on preference: the
  pending dot sits beside the word `Thinking…`, the tool-call dots sit beside
  `{{ call().status }}`, and the harness banner says `harness · in memory` on
  itself.

  One fact that fell out and is worth stating once: **nothing in this app
  qualifies for the large-text exemption.** The biggest type is `PageHeading`'s
  `text-lg font-semibold` — 18px at weight 600, which is 13.5pt bold, and the
  exemption starts at 14pt bold. 4.5:1 applies to every piece of text in the app.

  The two widest-reaching failures are both pre-existing and neither belongs to
  phase 5: `content-subtle` at 3.40–4.34 across both modes (that is `HelpText`'s
  `subtle` tone and §6.1's qualifier), and **`--border-default` at 1.37–1.66
  against a 3:1 threshold, which is an input's own border** — on `/animals/new`
  and `/milk/milking` a 1px `#CBC9C3` edge on white is the only thing marking
  where a control is. §14.4 wants a shadow added to the FOCUS treatment; this
  says the resting border is the weaker half.

- **The seven derived dark values** (§4.2) are now measured against their light
  counterparts, and six of the seven are contrast-matched within a reasonable
  margin. `--warning-strong` on `--warning-fill` lands at 7.31:1 in dark, which
  confirms this section's own spot-check of "about 7:1" exactly.

  **`--success-dot` is the one genuine mismatch: 2.54:1 in light against 8.95:1
  in dark, a drift of +253%** — nearly invisible in one mode and the loudest
  thing on the chip in the other. `styles.css` justifies the dark dots as
  keeping their saturation because "they are 6px marks and need to read at that
  size", which is right about dark and reveals that light is where the dot does
  not read. Neither is a failure, because the status is also in words. **Retired
  in phase 6b** — §13.3 moved the chip onto the agent ramp, whose foreground has
  no such split — so the mismatch is now a fact about an unused token.

- **Dark mode has been rendered and read, not used.** Still true. "Seen by one
  person for an afternoon" is not "used for a week in a dairy", and phases 5 and
  6 added two afternoons rather than a week.

- **The categorical agent ramp** has still not been checked for
  distinguishability under common colour-vision deficiencies. Phase 6b widened
  the ramp's reach — the tool-call chip now draws from it too — so this matters
  slightly more than it did.

---

## 10. How to verify

### 10.1 Suites

```
nvm use                       # 22.22.3; the default 22.3.0 is refused by the CLI
npm run check:templates       # before anything compiles -- TWO checks now
npm test -w web-angular       # 328/328, 31 files
npm test -w server            # 726/726, 4 suites
npm run build:angular         # production build, 555.12 kB initial
npm run check:contrast        # 33 known failures, printed not gated -- §9.6
```

`check:templates` runs the backtick guard and the `display: block` host guard,
and prints a line for each. `check:contrast` is aliased with `--report` so it
prints rather than exiting non-zero: the 33 failures are recorded debt, not
regressions, and a command that always fails is a command nobody runs. Drop the
flag to use it as a gate once they are fixed.

`Not implemented: HTMLCanvasElement's getContext()` prints on every frontend run.
jsdom has no 2D context; it is not a failure, and it is why `chart-card.spec.ts`
asserts on the config object rather than a canvas.

### 10.2 The app, with fixture data

```
npm run harness:app           # harness :4000 (:memory:), Angular :4200
node scripts/harness-seed.mjs # 83 writes, if the concurrent seed lost its race
```

**The app is on :4200.** Port 4000 is the API and mounts only
`/api/registry/*`, so `/` there is a 404 even when healthy.

**Confirm you have the harness before seeding:**
`curl -s localhost:4000/api/registry/storage` must say
`{"storage":":memory:","memory":true}`. The seed refuses to run against a real
`dairy.db` and it was right to at least once — a stale dev server held the port.

Two reproducibility catches:

- **The fixture is date-relative** (`today()`, `dayAgo(n)` in `Asia/Karachi`), so
  screenshots only compare within one calendar day.
- **Buyer and person IDs are per-run UUIDs.** Keep one harness process alive
  across a before/after comparison, or the detail routes move. Animal IDs
  (`BD-0001`…) are stable. Row ordering for salaried people is *not* stable
  across restarts.

**The two write routes cannot be reached by a page load.** `Session` persists
nothing by design, so the shell renders `SessionGate` instead. Drive the gate
(`start-session` → a `source-form` chip → `recorded-by` → `start`) and then
navigate **client-side**, or the session dies with the reload.

### 10.3 Hooks and the metric

Both are simple source counts over `web-angular/src`: distinct `class="…"`
values, and `data-role` values referenced by spec files. Expect **305 / 626**
and **116** — and see §2.1 on why the first two went up.

**The 115 this section used to claim is not reproducible**, and that is worth
recording rather than quietly overwriting. A script that reproduces
295 / 619 / 207 at `dc0a160` *exactly* — so the class-string rule is the one
this document has been using — gives **110** spec-reached hooks at that same
commit under the rule stated here, and 116 now. Counting instead every distinct
`data-role` literal a spec mentions gives 114 then and 120 now. No rule tried
yields 115 at the commit the figure was measured at.

So the delta is +6 under a stated rule, the absolute is 116 under that rule, and
whichever rule produced 115 was not written down. **State the rule with the
number**, which is the whole lesson of this document's own preamble about three
documents disagreeing over the same counts.

### 10.4 Zero-delta, when a change should be invisible

The strongest check is not the screenshots — it is the compiled stylesheet.
`curl -s localhost:4200/styles.css` before and after; the diff should be exactly
what you intended and nothing else. Phase 1's whole acceptance was that this diff
contained only the `:root` block and one font stack.

Then `getComputedStyle` over every colour utility, and the three opacity
modifiers specifically: `rgb(var(--surface-page) / 0.8)`,
`rgb(var(--success-bg) / 0.4)`, `rgb(var(--border-subtle) / 0.6)`.

### 10.5 Screenshots

**This was a recipe for four phases and every phase re-implemented it by hand.
It is now [scripts/shoot-screens.mjs](../scripts/shoot-screens.mjs)**, and the
reason it stopped being a recipe is §6.3: the acceptance for the certainty
vocabulary is that five states are distinguishable in greyscale, and that is not
something anybody re-derives correctly at eleven at night.

```
npm run harness:app                      # or a production build behind serve-built.mjs
node scripts/shoot-screens.mjs           # fourteen screens, both themes
node scripts/shoot-screens.mjs --grey    # desaturated, in the page
node scripts/shoot-screens.mjs --assistant   # with §13.1's panel open
node scripts/shoot-screens.mjs --path=/milk/milking?on=2026-12-25 --key=unanswered
```

No dependencies: Node 22 has a global `WebSocket`, so it drives CDP directly. A
verification script that needs `npm i` before it runs is a script that does not
get run.

Fourteen screens — the twelve free ones plus both frozen forms — at **1440px**,
Chrome headless with `--hide-scrollbars --force-color-profile=srgb
--disable-lcd-text --font-render-hinting=none`, driven over CDP.

Three things this section already knew would go wrong, all three encoded in the
script — and three more found while writing it:

- **`--force-device-scale-factor=1`** matters as much as the width. On a retina
  host Chrome captures at 2x and a pixel diff against a 1x baseline reports
  every pixel as changed.
- **The gate is filled in WHERE IT ALREADY IS.** §10.2 says to drive the gate
  and then navigate client-side "or the session dies with the reload", which is
  right about reloads and wrong about the route:
  [registry-shell.ts](../web-angular/src/app/registry/registry-shell.ts) renders
  `<app-session-gate />` inside `<main>` in place of the outlet on a write-only
  route, so `/animals/new` already shows the gate and the shell swaps it for the
  form the moment the session opens, URL untouched. No hop is needed. The first
  version looked for `[data-role="start-session"]`, which lives on the session
  *bar* and is the button that opens the gate on a non-write route — and it duly
  printed `!! GATE STILL SHOWING` on both frozen forms, which is what that
  warning is for.
- **`Page.navigate` immediately followed by `Page.reload` fails** with "Not
  attached to an active page": the first cross-origin hop off `about:blank` swaps
  the renderer and the reload lands in the gap. Chrome is launched pointed at
  the app instead, so every navigation is same-origin.
- **`--assistant` ensures the panel is open rather than toggling it.** §13.1
  persists the state to `sessionStorage`, so a blind click opened the panel on
  the first screen and closed it again on the second. The persistence working
  exactly as specified, and a bug in the driver.

**The document never scrolls**, so a naive full-page capture is the fold only:
the shell is `flex h-full flex-col` and `<main>` owns the scroll, so
`Page.getLayoutMetrics` reports the viewport on every screen. Grow the *viewport
height* until `main.scrollHeight === main.clientHeight`, then capture. The first
attempt produced fourteen identical 900px crops before this was noticed.

**Force the theme** before the first navigation (`localStorage` seed plus
`Emulation.setEmulatedMedia`), or `system` leaks the host's OS preference into
the baseline. `prefers-reduced-motion: reduce` is emulated too, which freezes
the `Thinking…` pulse and makes the capture deterministic rather than
nearly-deterministic.

**Greyscale is applied in the PAGE, not to the PNG.** Post-processing the file
would prove the same thing; doing it live means you can also open the browser
and look, which is what actually finds a pair of states that have collapsed into
one grey. On `<html>` and not `<body>`, so the page's own ground goes with it —
a desaturated body over a coloured root paints a grey card on a tinted field and
reads as a bug in the capture.

**Compare by pixel, not by hash.** A hash says "different"; a
263-pixels-on-14-rows answer says where to look, and that is how §8.1 was found.

For the surfaces no screen shows (§8.2), inject a bubble containing every styled
element and capture it in both modes.

### 10.6 A screenshot is only evidence if the build compiled

An intermediate measurement during phase 4 said a 48px regression had not been
fixed, and a comment blaming the wrong column was written into the tree on the
strength of it. The dev server had been serving stale CSS because the build was
broken by a stray backtick. Check the build succeeded before believing the
picture.

### 10.7 The amber check

A source scan, not a screenshot — and it is a spec now, not an instruction:
[ui/amber.spec.ts](../web-angular/src/app/ui/amber.spec.ts).

**What it asserts is not what this section asked for**, because what this
section asked for was already false. See §4.2.1. Every `warning`-role utility in
`src/app/**` must be **classified by meaning, in the spec, by whoever added it**;
a new unclassified site fails, and so does a classified site that has lost its
amber. Three globs rather than one, because `import.meta.glob` takes literals
and `templates.spec.ts`'s single `./*.ts` covers registry alone — which is how
`components/` went unprotected by the backtick guard for its whole life (§8.3).

Two implementation notes, both found by the check misreporting itself:

- **Comments are stripped before scanning.** A comment ABOUT amber is not a use
  of it, and this file's own prose plus the explanation `people-list` now carries
  for why its balance cell keeps `text-warning-fg` both matched a naive scan. A
  guard that counts its own documentation grows every time somebody explains it.
- **Stripping preserves line count.** Replacing a six-line `<!-- … -->` with `''`
  shifts every line after it up by five, and the census then prints line numbers
  pointing at the wrong code. A guard that misdirects is worse than no guard.

It becomes simpler once §12.2 exists, because at that point the chip is one
element and the second permitted meaning becomes mechanical.

---

## 11. Costs and things that surprised

- **Monospace is wider**, and on the dispatch sheet it cost 48px: the rate column
  grew, table layout took the width off the litres cell, and its `flex-wrap` row
  dropped "already saved" onto a second line. The fix was *not* to drop mono —
  the rate is a composite label identical in every row, so it takes alignment
  without the face, while the amount column beside it keeps both because rupees
  are exactly what §5 wants monospaced.
- **The theme toggle cost 34px on twelve screens** before it cost nothing. Added
  to the header's wrapping flex row with `ml-auto`; the nav is ten links and
  already wraps, so the toggle wrapped to a third row. The header is two explicit
  rows now and the cost is 2px — at the price of the toggle becoming the header's
  first tab stop rather than its last. §12.1's two fixed rows make the wrap
  impossible rather than merely unlikely.
- **Tailwind emits nothing for an unused class**, so adding the semantic palette
  produced no CSS at all in phase 1. "The tokens work" could not be shown by
  rendering the app; it needed a scratch `tailwindcss` build pairing each
  semantic utility with its existing twin. 51 of 51 matched.
- **The initial bundle grew** 527.98 → 540.08 kB over phases 1–4. Sixteen
  directives, a theme service and a toggle are code where hand-written strings
  were markup. The 500 kB budget was already exceeded before any of this.

- **AND THEN PHASE 6b GREW IT BY 67% IN ONE COMMIT, BEFORE IT WAS CAUGHT.**
  541.98 → **903.81 kB**. The shell imports the assistant panel statically so
  the toggle works on every screen, and that pulled `ChatPanel` into the initial
  bundle — and with it `marked`, `DOMPurify` and `Chart.js`, all three of which
  had been lazy since they were written because they arrived with
  `loadComponent` on the `/chat` route.

  Nothing about the change looked like a bundle decision. Moving a component from
  a lazy route into the chrome is a routing change, an import change and a 362 kB
  change, and only two of those three are visible in the diff. `@defer (when
  assistant.open())` restored it to 555.12 kB, which is the right trigger for a
  panel §13.1 makes default-closed: the operator who never opens the assistant
  never downloads a charting library, and the one who does pays once.

  **Read the build output, not just the tests.** Both suites were green at
  903.81 kB and the only thing that said otherwise was a budget warning that had
  already been firing for four phases — which is how a warning that is always on
  stops being read.
- **`aria-live` over a stream is the wrong reading of the focus spec.** A live
  region re-announces on every mutation, and a token-by-token stream mutates
  dozens of times per reply — a screen reader would restart the answer on every
  token and finish none. The chat announces **transitions** instead, with
  `pending` checked before `loading` so an agent proposing a write is never
  described as "answer ready".

---

## 12. The shell — specified, unbuilt

Phase 7, gated on the trial: it changes the chrome around the frozen forms and
the tab order into them.

### 12.1 Header — three zones, two rows

**Row 1**, full width, `surface-raised`, `line-subtle` beneath:

| Zone | Contents |
|---|---|
| Left | App name, then the **storage chip** (§12.2) |
| Right | The **session chip** (§12.3), theme toggle, assistant toggle |

**Row 2 is the section nav**, same surface, `line-subtle` beneath. Five items:
Today, Herd, Milk, Labour — then Check, pushed right with `margin-left: auto`.
Active takes `content-primary` with a 2px bottom border in the same colour;
others `content-muted`.

Two explicit rows, not one wrapping row. §11 records the theme toggle costing
34px because it wrapped a ten-link nav onto a third row.

**Read §8.1 before touching the active state.**

**Header, not sidebar, and the reason is measured.** The herd list is seven
columns, the roster five plus two controls per row, the dispatch sheet six. A
240px rail costs every one of them 240px permanently, on the surfaces where the
hours go. The nav costs 38px once, at the top. This is the one place where
current fashion and this app's job disagree, and the job wins.

### 12.2 The storage chip

Replaces the harness banner. Always present, three states:

| Probe | Chip | Tone |
|---|---|---|
| `memory: true` | `harness · in memory` | `warning-fill` |
| `memory: false` | `registry`, full path on hover and focus | neutral, `line-strong` border |
| unreachable or unanswered | `target unknown` | `warning-fill` |

**A chip, not a banner.** `/check` has no badge that turns green for the same
reason a standing coloured band becomes furniture within the hour. The chip is
small, permanent, and only two of its three states are coloured.

The acknowledgement gate (`REGISTRY.md`, "Which database am I writing to") is
unchanged: the chip *states* the target, the gate still requires an explicit
acknowledgement for a real database, and storage drift still clears the session.

This is the second of amber's two permitted meanings (§4.2.1), and the only place
amber appears outside the content area.

### 12.3 The session chip

`recall · adnan` when a session is open; `browsing` in `content-subtle` when not.
Click opens the gate.

This promotes the app's most consequential state out of being its faintest text.
It also makes the reads-are-free / writes-are-gated split visible **before** a
form refuses, which is where a person can act on it.

### 12.4 The section bar

A third bar, `surface-sunken`, for sections with more than one view or any
action.

| Section | Views | Actions |
|---|---|---|
| Today | — | Start a recording session |
| Herd | Animals, Calvings | Record calving, **Add animal** |
| Milk | Milking, Dispatch, Buyers | — |
| Labour | People, Payroll | Add person |
| Check | — | Recheck |

**Actions leave the navigation.** "Add animal" and "Record calving" are things
done *to* the herd, not places. Moving them here takes the nav from ten items to
five and makes the RECORD / REVIEW inline labels unnecessary — the split becomes
structural. It also matches the URL grouping `app.routes.ts` already chose, and
resolves the tension its own comment records: URLs name subjects, the nav grouped
by activity.

At most one `primary` Button per section; everything else `secondary`.

**Write actions gate here.** With no session, a section's write actions are
replaced by a single `secondary` button reading `Start a recording session`. That
is one more site for the twelve-site guarantee `REGISTRY_PAYROLL.md §12.5`
describes, and it must be added to that test.

**Today's action is the gate itself**, which stops the bar rendering as an empty
strip on one screen and is also the right answer: a queue you cannot act on is
exactly where the gate belongs.

### 12.5 Content width, per screen kind

`mx-auto max-w-4xl` on everything is the current rule and it is wrong in both
directions — too narrow for tables, too wide for prose.

| Kind | Width | Screens |
|---|---|---|
| Table | full, `max-width: 1400px` | herd, roster, dispatch, buyers, people, payroll, check |
| Form | `max-width: 720px` | add animal, record calving, add person, the gate |
| Prose | `max-width: 68ch` | help text and notes **inside** either of the above |

The prose measure is independent of its container: a note under a full-width
table wraps at 68ch, not at the table's width.

This is also the largest single reduction still available on §2.1's metric.

### 12.6 Command palette — `Cmd/Ctrl+K`

Not built, and worth building. One operator, keyboard-heavy, long sittings, 31
animals with stable serials: typing `BD-0016` beats Herd → scan → click every
time.

Scope: the five sections and their views; every animal by serial or name; every
person and destination by name; and the §12.4 actions, shown disabled with their
reason when no session is open.

It is what lets the nav stay at five items as the app grows, and it is the
natural home for the held keyboard items in `REGISTRY_ENTRY_UX.md` §11.

**Nothing registered a global key handler, and now something does.**
[core/shortcuts.ts](../web-angular/src/app/core/shortcuts.ts), built in phase 6b
because §13.1's `Cmd/Ctrl+/` was the first — and this section is explicit that
the first is the one that has to establish the owner. `Cmd+K` and the held
`Cmd+Enter` register against it rather than adding listeners of their own.

It is deliberately **not** a keymap system: no sequences, no contexts, no
priorities. What it does have is the property this warning asks for —
**registering a chord somebody already holds THROWS, at startup, naming both
owners.** A collision is a programming mistake and it should not be discoverable
only by somebody on a different keyboard finding that `Cmd+K` does nothing.

Two rules that are about this app rather than about shortcuts:

- **A bare key never fires from inside a text field.** The milking roster and the
  dispatch sheet bind bare `m` and `n` INSIDE their litres inputs, the composer
  takes free text, and both frozen forms are nothing but inputs. A global
  bare-key handler that fired in them would be the fastest possible way to lose
  a half-typed figure.
- **A modifier chord always does.** `Cmd+/` typed in the composer should still
  put the panel away: the person pressing it is asking for exactly that and
  their hands are already there.

`mod` resolves to Cmd on macOS and Ctrl elsewhere, and not to either on both:
`Ctrl+/` on macOS is a live text-editing binding in some input methods. The
chord is also **printed** on the panel's close button, per the lesson the roster
records for its own accelerators — a shortcut nobody can see is a shortcut
nobody uses — and printed per platform, because showing `⌘/` to somebody on
Linux is worse than showing nothing.

---

## 13. The assistant panel — built in phase 6b

Built, `d9c0057`, except §13.4. §9.2 moved the route and fixed the height; this
is what it became.

Three files:
[core/assistant.ts](../web-angular/src/app/core/assistant.ts) for the state and
§13.2's phrasing,
[components/assistant-panel.ts](../web-angular/src/app/components/assistant-panel.ts)
for the geometry, and
[core/shortcuts.ts](../web-angular/src/app/core/shortcuts.ts) for §12.6's one
owner. The shell gained a positioning context around `<main>` and the toggle.

### 13.1 Geometry

- 320px, docked right, **overlaying** the content rather than pushing it, with
  the content beneath dimmed one step.
- Default closed. State persisted per session, not per route.
- Toggled from the header (§12.1) and by `Cmd/Ctrl+/`.
- Below 1100px viewport width it takes the full content area. This is the app's
  only breakpoint, and it exists because 320px plus a 1400px table does not fit a
  1280px laptop.

**Overlay, not push.** Pushing reflows every table mid-sitting, and a
transcription surface should not move under the person using it. The assistant is
a consultation.

**As built**, three details the spec did not settle:

- The panel is absolute against the **content region**, not the viewport. A new
  `relative flex min-h-0 flex-1` wrapper holds `<main>` and the panel, which is
  what keeps the storage banner, the session bar and the nav visible beneath it
  — the three things §12.2 and §12.3 argue must never be covered. `min-h-0` goes
  on the wrapper and not on `<main>`, for the reason §9.2 works out in reverse:
  `<main>` does not need it because its own `overflow-y-auto` zeroes its
  automatic minimum size, but the wrapper does not scroll.
- **The dim carries `pointer-events-none`**, and that is the line between a
  consultation and a modal. §13.4's case is reading a figure off the table while
  asking about it, so the content stays clickable, scrollable and selectable.
  One step and not a blackout: `surface-page` at 60%. §16 still holds whether
  the dim is right at all as undecided.
- The 1100px breakpoint is written as `max-[1100px]:`, not as a named screen in
  `tailwind.config.js`. A named breakpoint is an invitation — the moment
  `assistant:` exists in the config the next person reaches for it, and the app
  has a responsive system it never decided to have.

`sessionStorage`, not `localStorage`, for "persisted per session". §4.7 draws the
rule for the theme — a remembered theme cannot mis-attribute a record — and this
clears it too, but the panel is a working posture rather than a preference and
somebody who closed it on Tuesday has said nothing about Wednesday. Every access
is wrapped: blocked site data throws rather than returning null.

### 13.2 Context

The panel carries the current route as a context line above the composer:
`Reading BD-0003`, `Reading the evening roster`. On an animal route,
*how does her interval compare?* resolves the pronoun without the person naming
the animal.

This is the difference between folded in and merely relocated.

**Absent rather than generic** where a route has nothing useful to say, and
`/chat` is the clearest case: the route IS the assistant, so "Reading the
assistant" is a sentence about nothing while training the eye to skip the one
place that does resolve a pronoun. Both frozen forms and the two detail routes
whose ids are per-run UUIDs say nothing either. The wording lives in the shell,
beside the nav that names the same screens, which is what stops "the evening
roster" and "Milking" becoming two names for one place.

### 13.3 Message treatment

- **The person's own turn is quiet** — `surface-sunken` with a `line-subtle`
  border, right-aligned, `content-secondary`. It is currently the
  highest-contrast element on the page while the answer is a low-contrast card.
  You know what you typed.
- **The answer is plain content** on the panel surface, no card,
  `content-primary`, markdown styled per §8.2.
- **The tool chip sits below the answer it belongs to**, not above whatever
  follows. It is a footnote about how the answer was produced, and today it reads
  as a header for the chart beneath it.
- The tool chip draws from the **categorical agent ramp** (§4.3), not `success`
  — per agent, so the chip and the agent tag above it read as one statement
  about one turn rather than two unrelated badges. The **error arm keeps
  `danger`**, because a tool call that failed is an error and the role is the
  right vocabulary; `text-danger-soft` is also pinned by the component's own
  spec, which is why `danger.soft` exists at all (§4.2).

**One thing §13.3 did not mention and the build had to decide:** the chip is a
button that expands its argument summary, and its hover cue was
`hover:bg-brand-badge` — a single ground that cannot survive four ramp arms plus
the error arm. Replaced with `hover:brightness-95 dark:hover:brightness-110`,
which is ramp-agnostic and reads as pressable on any of the five.

### 13.4 Provenance, when agent writes arrive

**Still specification only.** Deferred with the writes themselves — `REGISTRY.md` records them as going through
a confirmation-gated `WRITE_EXECUTOR` — and specified now so it is not invented
later.

An agent-proposed write renders as a confirmation card in the registry's own
vocabulary: approximate values dotted, absent values in words, no-record values
dashed. It is stamped with the session's `source_form` and `recorded_by`, with
`source_ref` naming the turn. **With no session open the assistant answers but
cannot propose a write**, and says so.

One provenance rule, two surfaces. Today the chat can propose writes on a surface
with no provenance state at all while every manual write is stamped.

---

## 14. Vocabulary the primitives still need

Gaps in §7.2's inputs, found by rendering the design rather than by reading it.

### 14.1 `StatusBadge` tones

§9.5 records the badge collapsing 3 of 6. The tone set that resolves all three
remainders:

| Tone | Appearance | Used by |
|---|---|---|
| `default` | `brand-badge` bg, `content-secondary` | in milk, dry, choti, katti, male |
| `ended` | transparent bg, **dashed** `line` border, `content-subtle` | departed, closed engagement, inactive destination |
| `warning` | `warning` role | not billed |
| `brand` | `fill-brand` / `content-onFill` | the confirmation-card pill only |

`ended` is the one the renders added, and it is the herd table's worst single
offender: a departed animal currently wears the same solid pill as a lactating
one, in a 31-row table where status is the most-scanned column.

### 14.2 Identifier links

A serial or person identifier that navigates renders as `font-mono` in
`content-primary` with a 1px `line-strong` underline — **not** `TextLink`'s
colour treatment.

An identifier is a name, not a link. Colouring it would put a second colour
language into every table, and the tables are where the certainty vocabulary
needs the colour budget.

### 14.3 Table row interaction

`tbody tr:hover` → `surface-sunken`. Rows that navigate get `cursor: pointer` and
a `focus-visible` ring on the **row**, not only on the link inside it.

Neither is specified or present today, and a 31-row table at 13px with no hover
target is hard to track across.

### 14.4 Input focus, completed

§7.4 chose a border shift over a ring for inputs. Complete it: border to `focus`,
**plus `box-shadow: 0 0 0 1px` in the same colour**, so the shift is visible at a
1px border width. `composer.ts`'s existing pattern takes the shadow too, so the
two stop differing.

---

## 15. Copy

The app's prose is load-bearing — it is why the forms do not lie — and a design
system that governs colour but not words will let it drift. Four rules, drawn
from what the app already does:

1. **An absence is named, not blanked.** `not measured`, `nothing taken`,
   `not known` — never an empty cell, and never a zero standing in for an
   unknown. The one dash permitted is §6's no-record state, which is the absence
   of an answer rather than an answer.
2. **A refusal says what to do.** Server messages are shown verbatim; anything
   the client writes follows the same shape. `Still to answer: Mithi, Neeli`
   rather than `Form incomplete`.
3. **A caveat travels with its number.** The sample-size and lower-bound notes
   are fields on the report, not footnotes — `REGISTRY.md` makes that a
   deliberate API property. Render them adjacent; never collapse them behind a
   disclosure.
4. **Sentence case, no exclamation, no reassurance.** `Recorded a dry off for
   BD-0003 Kali.` The app does not congratulate, and it has no green tick.

---

## 16. Unverified, and undecided

**Moved out of "unverified" by phases 5 and 6**

- ~~The seven derived dark values, and every contrast ratio.~~ Both computed.
  Six of the seven derived values are contrast-matched, one is not, and 33 pairs
  fail AA. §9.6, and PHASE5_PRECHECK.md §1 for the full list. **Measured is not
  fixed**: the 33 are now recorded debt rather than an unknown.
- ~~Phase 5's greyscale acceptance has never been tested.~~ Tested, both ways:
  a desaturated capture and a spec that enumerates all ten pairs. §6.3.
- ~~§§12–14 have been rendered as static mockups only.~~ **§13 is built and
  measured in the app.** §§12 and 14 are still mockups only.

**Unverified**

- **The 33 contrast failures are unfixed**, and three of them are certainty
  states — the vocabulary phase 5 just built sits on two tokens that fail AA on
  every surface and a mark that fails 3:1. Nothing renders wrongly; it renders
  quieter than the standard asks for, on a screen somebody reads all day.
- **The categorical agent ramp** has not been checked for distinguishability
  under common colour-vision deficiencies, in either mode — and phase 6b widened
  its reach to the tool-call chip, so it now carries more weight than when this
  item was written.
- Compact/comfortable density assignment per screen is **proposed, not derived**,
  and rests on harness fixture data: 31 animals, 5 buyers, 3 people. It exercises
  every table and both forms, but it is not the backfill — no murky-date animal,
  no long calving history, no 31-row roster typed by hand. Row counts, column
  widths and the density split should be revisited against real entry.
- **The certainty vocabulary has been read, not used.** Same disclosure the dark
  values carry, and for the same reason: the fixture has one animal per precision
  and a saved milking session, which is enough to render all five states and is
  not the backfill. The state the vocabulary exists for — a 31-row roster with
  one row skipped — was produced for a capture by asking for a date with no
  saved session, not by anybody skipping a row.
- **§§12 and 14 have been rendered as static mockups only.** No part of the
  shell or the four primitive additions has been built or measured in the app.

**Undecided**

- **The three unpermitted meanings of amber** (§4.2.1), at twelve sites: an
  override, an anomaly hint, and a liability or missing agreement. Each is a real
  distinction and each wants its own name rather than a sweep onto the warning
  role — but six of the twelve sit on the two frozen forms or on `/animals/new`,
  so B1/B2 reach them and nothing can move until the trial reports. The census
  spec holds the line in the meantime: they may not grow.
- **Whether `--certainty-approx` and `--certainty-absent` should hold different
  light values.** They hold the identical `#82807A` today, which makes them the
  thinnest of §6.3's ten pairs — separated by an italic and a dotted rule with no
  tonal difference at all. The dark set already separates them, and separates
  them the right way round. A one-line change to `styles.css`, and it is a
  decision about the palette rather than about the vocabulary.
- **Where `Recheck` lives** once §12.4 exists. `REGISTRY_ENTRY_UX.md` §11 holds
  "`Recheck` to the top of `/check`"; §12.4 makes it a section action, which may
  satisfy that item or may answer a different question.
- **Whether the storage chip's neutral state is enough.** A real registry showing
  a neutral chip is quieter than today's absence-of-banner, and §12.2's argument
  against alarm chrome may be wrong in this one case. Decide by using it, not by
  reasoning about it.
- **Whether `--border-selected` and `--fill-brand` should diverge in value.** They
  are separate names holding one value specifically so phase 7 *can* move one.
  Phase 7 has not decided whether to.
- **Whether the assistant panel's dim is right at all.** Dimming a table you are
  transcribing from is a cost; the alternative is no visual separation between an
  overlay and the content beneath it. It is built as specified and
  `pointer-events-none`, so the content stays usable while it is dimmed — which
  narrows the question to whether the dim helps, rather than whether it blocks.
- **Whether `/chat` should survive §12.4's nav.** The route is kept and nothing
  links to it: the panel is how the assistant is reached, and below 1100px the
  panel is the full content area, which is what the route renders anyway. So the
  route is a deep link with no entry point. §12.4's five-section nav is where
  that gets decided.
