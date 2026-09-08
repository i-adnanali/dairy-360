# UI system — the design system

*Status: **phases 0–4 built and verified; 5, 6 and 7 are not.** Specified against
`816fe67`, validated against the code twice, and implemented over six commits
(`ef52fd4`…`dc0a160`). Frontend **294/294**, server **726/726**, production build
clean. Both light and dark rendered on all fourteen screens.*

*This is the **only** document for this work. It replaces the original plan, a
separate adversarial-validation file, and the per-phase implementation records —
all three were folded in here and deleted, because three documents disagreeing
about the same counts is how the counts went wrong the first time. Every figure
below was measured against the tree at `dc0a160`, not carried over.*

*Three items remain **BLOCKED** on the five-animal trial (§3). One contamination
of that trial was **knowingly accepted** and is recorded in §3.4 — read it before
reading the trial report.*

**Reading order for a new session:** §2 for where things stand, §3 for what you
may not touch, §8 for what will break if you are careless, §9 for the work,
§10 for how to prove it.

---

## 1. What this is

The app was not badly themed. It was **untokenised and drifted**: one custom
Tailwind ramp, no dark mode, zero CSS custom properties, and 358 distinct
whole-attribute class strings over 957 occurrences for what is about fifteen
visual primitives.

The design idea is that **certainty is the app's primary visual variable.** Every
screen distinguishes measured from approximate, observed from recalled, answered
from deliberately-blank — and all of them looked the same. §6 gives that axis a
treatment, and it is the one substantial part still unbuilt. Everything in
phases 1–4 existed to make it expressible.

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
| **5** | Certainty vocabulary | **not started** — §9.1 |
| **6** | Chat folded into the shell | **not started** — §9.2 |
| **7** | B1, B2, B3, then layout: rail, widths, command palette | **blocked** on the trial |

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

### 2.1 What was measured, before and after

| | before | after |
|---|---:|---:|
| Distinct whole-attribute class strings | 358 | **295** |
| Total occurrences | 957 | **619** |
| …of which occur exactly once | 230 | 207 |
| Distinct table-cell class strings | 31 | **3** |
| Cell padding scales in simultaneous use | 4 (44/34/12/7) | **2** |
| `farm` references in `src/` | ~500 | **0** |
| CSS custom properties | 0 | **55 light + 55 dark** |
| Colour-setting hex literals outside the token layer | 13 | **0** |
| Frontend tests | 281 | **294** |

**207 of the surviving 295 occur exactly once**, and they are layout, not
appearance — `flex flex-wrap items-end gap-3`, `mx-auto max-w-4xl space-y-6`,
`mt-2 space-y-1`. No primitive collapses those. That is the floor for this
metric, and it is why the occurrence count (−36%) is the more honest number than
the distinct count (−18%).

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

### 3.2 The two positive predictions are not in the table, and should be

§11 records **eight** predictions, not six. Two are expected to feel *better*:
"the printed digit accelerators on sex and outcome, and the single date field on
murky dates". The table above enumerates 1–6 and misses these.

This matters for **phase 5**. §6 gives "unanswered — still required" the
`warning` role, "the only amber on the screen", and says the vocabulary applies
to the frozen forms constrained by B2 only. The calf-sex chip on
`/animals/calvings/new` **starts unanswered** (§11's amendment removed its
default, and says "the accelerator now fires every record"). So phase 5 paints
the accelerator amber — the exact element one of the two positive predictions is
measured on — and B1/B2/B3 do not catch it. **Decide this before starting §9.1.**

### 3.3 The trial gate is drawn around routes; the code is organised around components

Three input primitives straddle the line: `chip-group` (2 frozen screens, 8
free), `identifier-input` (2 / 5), `precision-date` (2 / 2). There is no way to
give `ChipGroup` a treatment "on `/milk/milking` only". This did not bite phases
1–4, because those were either zero-delta or affected the frozen forms in ways
B1–B3 permit. It will bite phase 5.

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

Unchanged from today's Tailwind palette in light; §3.2's Light column *was*
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
utilities the original §3 never named; **their dark values are derived, not
specified**, and are the least-verified thing in the token layer.

**On red and amber.** `sales.spec.ts:269` and `routing.spec.ts:212` look like
they lock these meanings and do not: both are *negative* substring checks on
single elements ("this note must not be red"), they constrain restraint rather
than meaning, and both now pass **vacuously** — the literals are gone. Keeping
danger on red and warning on amber is a design choice defended on convention, not
a tested invariant. Whoever changes it should know the tests will not catch them.

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
same colour as an unanswered milking row.

### 4.4 Write-log — held by B3

`--writelog-bg` `#f0fdf4`, `--writelog-fg` `#14532d`, `--writelog-line`
`#bbf7d0`, unchanged from before any of this work. Dark: `#12291B` / `#8FD3A6` /
`#22452F`, matched for perceived contrast rather than mapped. See §3.1.

### 4.5 Certainty — declared, unused

Nothing consumes these until phase 5. `--certainty-known` tracks `--text-primary`
and `--certainty-absent` tracks `--text-subtle`, per the original spec.

| Token | Light | Dark |
|---|---|---|
| `--certainty-known` | `#1A1917` | `#F0EFEA` |
| `--certainty-approx` | `#82807A` | `#9E9C93` |
| `--certainty-rule` | `#A8A69E` | `#57564F` |
| `--certainty-absent` | `#82807A` | `#7C7B74` |

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

**Help prose demoted — NOT DONE.** §4 wants `text-xs`, `--text-muted`, 65ch max,
on the grounds that help text is currently "nearly as loud as the labels it
explains". It is a real visual change, the original §10 assigns it to **no
phase**, and phase 2's acceptance forbade it. Both current sizes survive as
`HelpText` variants. See §9.4.

---

## 6. The certainty vocabulary — the spec for phase 5

**Not built.** This is the design idea of §1 and the largest remaining piece.

| State | Treatment |
|---|---|
| **Known** — measured, exact day, observed | `certainty-known`, `font-mono tabular-nums`, no ornament |
| **Approximate** — estimated, month/year precision, recalled | `certainty-approx`, `border-b border-dotted` in `certainty-rule`, and a qualifier naming the imprecision (`~`, `YEAR`, `EST`) |
| **Deliberately absent** — `not_measured`, `nothing taken`, nobody observed | `certainty-absent`, *italic*, always **words**, never a dash |
| **Unanswered** — still required | The `warning` role. The only amber on the screen |

**Carried by weight, contrast and a mark — never by hue alone.** It must survive
dark mode, greyscale and colour blindness. This is the same commitment
`intervalReport()` makes when it refuses to average a measured interval with an
approximate one. **Acceptance is that the four states are distinguishable in
greyscale.**

Applies at `/milk/milking` (four row states), `/animals` and `/animals/:id`
(precision suffixes), `/check` (the separated measured/approximate boxes, finding
severities), `/milk/dispatch` (`nothing taken`, `not billed`, `kept, not sold`),
`/labour/*` (owed, in advance, `—`).

`decoration-certainty-rule` already exists at one site in `people-list` — the
dotted rule, now named.

**Constrained by B2**, and read §3.2 first: the unanswered calf-sex chip is one of
the two positive predictions.

---

## 7. Primitives — as implemented

Fifteen, in [src/app/ui/](../web-angular/src/app/ui/). **All fifteen are
attribute directives, not components** — the one structural deviation from the
plan, and it is forced by the code rather than chosen.

### 7.1 Why directives

86 of the 115 spec-reached `data-role` hooks sit on the exact element a primitive
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
| `theme-toggle.ts` | `ThemeToggle` — a **component**, since it has content and behaviour | — |

`Cell` was the largest collapse: 98 cells over 31 strings and four simultaneous
padding scales became two densities and 3 strings. **No cell carried `rounded`**,
which is why the original metric — distinct `rounded`-bearing strings — was blind
to the app's largest inconsistency.

`NotePanel` from the earliest draft **does not exist** and was not created. Its
eight sites are stat tiles inside `verification-panel` and remain a local `@for`.

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
(§9.2 wants it quieted, not unified) and keeps its own classes.
`confirmation-card`'s brand-filled pill is a badge and took `StatusBadge`.

### 7.4 Focus — one deliberate departure

§7 asked for `--focus-ring` on every interactive primitive. **Inputs take a
border shift instead.** `composer.ts` traded the native outline for
`focus:border-…` as a recorded decision, and §7 itself says to keep that and not
reinstate an outline there. A ring on every *other* input would leave one element
type with two focus languages, with the most-used control the odd one out.
Buttons and links take the ring, with `ring-offset-surface-page` — an offset with
no ground colour paints white on a dark page, which is the usual way a ring looks
broken in dark.

---

## 8. Invariants — what breaks if you are careless

**Check these after every change, not at the end.**

| Invariant | How to check |
|---|---|
| **115 spec-reached `data-role` hooks** must survive any markup move | §10.3 |
| **`templates.spec.ts:128`** — any registry file containing `.provenance()` must also contain `<app-session-required`, with two named route-gated exceptions. Its glob is `./*.ts`, registry only | in the suite |
| **No backtick inside a `template:` literal** | `npm run check:templates` |
| **`display: block` list** in styles.css must contain every non-routed registry component | manual, until §9.2's guard test |
| **The three opacity modifiers** must resolve through the tokens | §10.4 |
| **B1–B3** (§3) | judgement |
| Five `className` assertions and 30 `aria-disabled` assertions | in the suite |

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

---

## 9. Remaining work

### 9.1 Phase 5 — the certainty vocabulary

The spec is §6. Read §3.2 **first**: the unanswered calf-sex chip is a
pre-registered positive prediction, and painting it amber is a decision about the
trial, not a styling choice.

Acceptance: **the four states are distinguishable in greyscale.** The screenshot
driver can prove this — `Emulation.setEmulatedMedia` with a grayscale filter, or
post-process the PNGs.

Sequencing suggestion: `/check` first. It is not in the trial (§11 calls it
"uncontaminating"), it already separates measured from approximate boxes, and it
is where the vocabulary has the most to say.

### 9.2 Phase 6 — chat folded into the shell

`app.routes.ts` has `RegistryShell` as parent of every registry route with
`{ path: 'chat' }` as a **top-level sibling**, which is why the panel renders with
no banner, no session bar and no nav — and why it needs its own copy of the theme
toggle.

1. Move the route into `RegistryShell`'s `children`.
2. **`display: block` is necessary but not sufficient**, and the analysis was
   confirmed: the panel's root is `mx-auto flex h-full max-w-3xl flex-col` with a
   `flex-1 overflow-y-auto` region and a pinned composer. As a plain block child
   of `<main>` its `h-full` resolves against `auto` and collapses — the message
   list stops scrolling internally, the composer drifts, and
   `afterRenderEffect`'s `scrollTo` silently does nothing because
   `scrollHeight === clientHeight`. Needs
   `app-chat-panel { display: block; height: 100%; }`.
   **`main` needs nothing further** — it is a flex item, but its
   `overflow-y-auto` already makes its automatic minimum size zero, so the usual
   `min-h-0` remedy is redundant. What is left is not a collapse but an inset:
   `py-6` costs the panel 3rem, so its pinned composer floats 1.5rem off the
   bottom. A design call, not a bug.
3. **Quiet the user's own turn.** It is the highest-contrast element on the page
   while the answer is a low-contrast bordered card. You know what you typed.
4. **Provenance on agent-proposed writes.** The chat can propose a write on a
   surface with no provenance state at all, while every manual write is stamped.
   Use the same chip.
5. Remove the chat panel's duplicate `<app-theme-toggle />` once it inherits the
   shell's header.
6. **Add the `display: block` guard test.** `templates.spec.ts` has the
   machinery: glob registry sources, extract `selector: 'app-…'`, drop the routed
   ones, assert the rest appear in `styles.css`. Reading `styles.css` as raw text
   works — `'../../styles.css?raw'`, and `?raw` bypasses the Tailwind pipeline to
   give the hand-maintained source.
   **The sketch has one hole:** it says routed components are identifiable from
   `loadComponent`. Thirteen are; **`RegistryShell` is not** — it is a static
   `import` used as `component: RegistryShell`, and it is precisely the one the
   styles.css comment singles out as carrying the flex/height chain. The scan must
   read `component:` too, and `app.routes.ts` needs its own raw import since it
   sits outside the existing glob.

### 9.3 Phase 7 — after the trial

B1, B2, B3, then layout: the rail, content widths, a command palette. Plus §11's
held items — `Cmd+Enter`, the `(optional)` markers, `Recheck` to the top of
`/check`.

### 9.4 Primitive and token remainders

Small, independent, and each has a reason it was left:

- **`StatusBadge` collapsed 3 of 6.** `event-list.ts:58` (different radius,
  different stop, no `rounded-full`), `event-list.ts:84` (the amber "not billed"
  tag) and `dispatch-sheet.ts:167` (a small aside) need either a visible change or
  their own variants. Two of the six carry their own TypeScript colour logic,
  which is a categorical ramp rather than a status and does not belong here.
- **`SummaryBar` collapsed 2 of 3.** `payroll-run.ts:248` is a `<footer>` with
  `space-y-3 p-4` and no flex.
- **`ErrorPanel` covers 26 of 35.** `chat-panel.ts:95` is a third radius *and* a
  bordered treatment; `verification-panel.ts:81` is a `<li>`. Both are real
  inconsistencies whose fix is visible, so they want a decision here rather than
  a quiet normalisation.
- **Help prose demotion** (§5) — belongs to no phase and should be given one.
- **`dayly yield`.** [chart-card.ts:51](../web-angular/src/app/components/chart-card.ts#L51)
  concatenates `{{ dataset().interval }}ly`, and the server sends
  `interval: 'day'`. Still there. One line, client-side.
- **The four `<thead>` elements** sharing `SectionLabel`'s class string were
  skipped deliberately — a directive named for a label does not belong on a table
  head — so that string survives at 4 occurrences.

### 9.5 Verification debt

- **The seven derived dark values** (§4.2) have never been compared to the light
  set by eye.
- **Dark mode has been rendered and read, not used.** §12's disclosure that the
  dark values had never been seen no longer holds; "seen by one person for an
  afternoon" is not "used for a week in a dairy".
- **Contrast ratios have not been computed** for any pair. Spot-checked only —
  the harness banner's `#EFC97A` on `#47370F` is about 7:1.

---

## 10. How to verify

### 10.1 Suites

```
nvm use                       # 22.22.3; the default 22.3.0 is refused by the CLI
npm run check:templates       # before anything compiles
npm test -w web-angular       # 294/294, 27 files
npm test -w server            # 726/726, 4 suites
npm run build:angular         # production build
```

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
values, and `data-role` values referenced by spec files. Expect **295 / 619** and
**115**.

### 10.4 Zero-delta, when a change should be invisible

The strongest check is not the screenshots — it is the compiled stylesheet.
`curl -s localhost:4200/styles.css` before and after; the diff should be exactly
what you intended and nothing else. Phase 1's whole acceptance was that this diff
contained only the `:root` block and one font stack.

Then `getComputedStyle` over every colour utility, and the three opacity
modifiers specifically: `rgb(var(--surface-page) / 0.8)`,
`rgb(var(--success-bg) / 0.4)`, `rgb(var(--border-subtle) / 0.6)`.

### 10.5 Screenshots

Fourteen screens — the twelve free ones plus both frozen forms — at **1440px**,
Chrome headless with `--hide-scrollbars --force-color-profile=srgb
--disable-lcd-text --font-render-hinting=none`, driven over CDP.

**The document never scrolls**, so a naive full-page capture is the fold only:
the shell is `flex h-full flex-col` and `<main>` owns the scroll, so
`Page.getLayoutMetrics` reports the viewport on every screen. Grow the *viewport
height* until `main.scrollHeight === main.clientHeight`, then capture. The first
attempt produced fourteen identical 900px crops before this was noticed.

**Force the theme** before the first navigation (`localStorage` seed plus
`Emulation.setEmulatedMedia`), or `system` leaks the host's OS preference into
the baseline.

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
  first tab stop rather than its last.
- **Tailwind emits nothing for an unused class**, so adding the semantic palette
  produced no CSS at all in phase 1. "The tokens work" could not be shown by
  rendering the app; it needed a scratch `tailwindcss` build pairing each
  semantic utility with its existing twin. 51 of 51 matched.
- **The initial bundle grew** 527.98 → 540.08 kB. Fifteen directives, a theme
  service and a toggle are code where hand-written strings were markup. The
  500 kB budget was already exceeded before any of this.
- **`aria-live` over a stream is the wrong reading of §7.** A live region
  re-announces on every mutation, and a token-by-token stream mutates dozens of
  times per reply — a screen reader would restart the answer on every token and
  finish none. The chat announces **transitions** instead, with `pending` checked
  before `loading` so an agent proposing a write is never described as "answer
  ready".

---

## 12. Still unverified

- The seven derived dark values, and every contrast ratio (§9.5).
- The categorical agent ramp has not been checked for distinguishability under
  common colour-vision deficiencies — in either mode.
- Compact/comfortable density assignment per screen is **proposed, not derived**,
  and rests on harness fixture data: 31 animals, 5 buyers, 3 people. It exercises
  every table and both forms, but it is not the backfill — no murky-date animal,
  no long calving history, no 31-row roster typed by hand. Row counts, column
  widths and the density split should be revisited against real entry.
- Phase 5's greyscale acceptance has never been tested, because there is nothing
  to test yet.
