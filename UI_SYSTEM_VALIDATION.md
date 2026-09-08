# UI_SYSTEM.md — validation

> **Round 1's subject is not the document at `docs/UI_SYSTEM.md` any more, and is
> not on disk at all.** Round 1 below reviews the earlier *plan* — the one with
> "67 distinct colour utilities", fourteen primitives, `NotePanel` and a
> twelve-screen phase 0. That plan was never committed to any ref, so it survives
> only as the quotations in this file; there is nothing to archive and no
> `archive/UI_SYSTEM_PLAN.md` was invented for it. `docs/UI_SYSTEM.md` now holds
> its successor, the design system, which is what `Round 2` further down reviews.
> Every `docs/UI_SYSTEM.md` link in round 1 therefore points at the wrong
> document; the section numbers in round 1's citations are the plan's, not the
> design system's. Round 1's body is left exactly as written.

*Adversarial read of the earlier plan (then at `docs/UI_SYSTEM.md`, see the note
above) against the working tree at
`816fe67` (source is clean at that commit; only the plan document itself is
modified). No code was changed. Where this file and the plan disagree, this file
was checked against the code and the plan was not.*

**Test counts from an actual run**, on the `.nvmrc` node (`22.22.3` — the default
shell node is `22.3.0` and the Angular CLI refuses it):

| Suite | Command | Result |
|---|---|---|
| Frontend | `npm test -w web-angular` | **281 passed / 281**, 26 files, 5.78 s |
| Server | `npm test -w server` | **726 passed / 726**, 4 suites, 0 fail, 0 skip |

Both green. Nothing is skipped or todo in either suite.

---

## 1. Claims that are wrong

### 1.1 "67 distinct colour utilities" — it is **54**

The plan's own `Uses` column reveals its counting method: variant prefixes
stripped, opacity modifiers kept distinct, production `.ts` only. Under exactly
that method every single `Uses` figure in the §4 table is correct, and the
distinct total is **54**, not 67. Counting variants as distinct (`hover:bg-farm-700`
separate from `bg-farm-700`) gives 62. Neither route reaches 67.

### 1.2 "the `farm` ramp is roughly 85% of all colour use" — it is **74.6%**

730 of 979 colour-utility occurrences. The figure only approaches 85% if
`bg-white`/`text-white`/`border-transparent` are dropped from the denominator, which
gives **82.7%**. Either way the plan overstates it, and understates how much
non-`farm` colour there is to re-home.

### 1.3 "96 distinct class strings containing `rounded`" — it is **101**

210 occurrences across 101 distinct whole-attribute strings. This matters for
phase 2's acceptance criterion — see §5.1.

### 1.4 "no status→class maps, no class-string constants" in TypeScript — **false**

This is the load-bearing claim of §1 ("*that last point is what makes this
tractable… the work is mechanical, not architectural*"), and it does not hold.
There are 5 `[class.]` bindings, as claimed — but also **24 `[class]` bindings**,
six of which call TypeScript methods that build class strings:

| Location | Shape |
|---|---|
| [tool-call-chip.ts:31](web-angular/src/app/components/tool-call-chip.ts#L31) `chipClass()` | error → `border-red-300 bg-red-50 text-red-700`, else farm |
| [tool-call-chip.ts:36](web-angular/src/app/components/tool-call-chip.ts#L36) `dotClass()` | error → `bg-red-500`, else `bg-emerald-500` |
| [message.ts:69](web-angular/src/app/components/message.ts#L69) `agentClass()` | a four-arm `switch` on agent → emerald / amber / violet / farm |
| [chip-group.ts:109](web-angular/src/app/registry/chip-group.ts#L109) `chipClass()` | `base` + `wide` + selected, concatenated string constants |
| [dispatch-sheet.ts:452](web-angular/src/app/registry/dispatch-sheet.ts#L452) `noneClass()` | `base` + selected/unselected |
| [milking-roster.ts:433](web-angular/src/app/registry/milking-roster.ts#L433) `chipClass()` | `base` + selected/unselected |

`agentClass()` is a status→class map by any definition. Three of these hold a
`base` string constant. The tokenisation work therefore has a TypeScript surface
the plan says does not exist.

### 1.5 "16 hardcoded colour values, in exactly two files" — **13**, in two files

Two files is right. The count is not.
[chart-card.ts](web-angular/src/app/components/chart-card.ts) holds **10** hex
literals, not 13: `#8a6431` ×**6** (lines 36, 37, 67, 68, 72, 73 — the plan says
×5), `#c29b5c` ×2 (45, 46), `#e6d7b8` ×2 (66, 71).
[styles.css](web-angular/src/styles.css) holds 3 `rgba()` values (81, 95, 99), as
claimed. 10 + 3 = 13.

### 1.6 "282 `it()` blocks" — **281**

281 `it(` occurrences across 26 spec files (26 is right), and 281 is also what
the runner reports. No `it.skip`/`only`/`todo` anywhere.

### 1.7 "Exactly seven spec assertions touch presentation" — **five**, and one the plan missed

There are exactly five assertions in the suite that read `className`:

- [sales.spec.ts:269](web-angular/src/app/registry/sales.spec.ts#L269)
- [routing.spec.ts:212](web-angular/src/app/registry/routing.spec.ts#L212)
- [tool-call-chip.spec.ts:33](web-angular/src/app/components/tool-call-chip.spec.ts#L33)
- [event-list.spec.ts:51](web-angular/src/app/registry/event-list.spec.ts#L51) and
  [:56](web-angular/src/app/registry/event-list.spec.ts#L56)

The plan reaches seven by counting `target.spec.ts`, which asserts a **banner's
presence/absence**, not any styling. And it misses a sixth genuinely
presentational assertion — see §3.1.

### 1.8 `sales.spec.ts:269` and `routing.spec.ts:212` do **not** lock red-means-error and amber-means-outstanding

This is the plan's most consequential misreading of its own constraint table.
Both are **negative** assertions on one element each:

```ts
// sales.spec.ts:269 — the dispatch sheet's "lower bound" production note
expect(note.className).not.toContain('red');
// routing.spec.ts:212 — the Today board's CURRENT-month payroll line
expect(current.className).not.toContain('amber');
```

They say *this particular element must not wear the alarm colour* — restraint,
not meaning. Neither says anything about what red or amber mean anywhere else,
and neither would fail if the danger role moved off red entirely. The plan's
"Consequence" column ("the danger role stays on a red hue family") does not
follow from either.

Worse for the plan: both are **substring** checks. The moment phase 1 or 2
rewrites `bg-red-50 text-red-800` to `bg-danger-bg text-danger-fg`, the string
`red` disappears and **both assertions pass vacuously** — they would keep passing
if the element were rendered bright red through a token. So §9's acceptance
criterion for phase 5 ("`sales.spec.ts` and `routing.spec.ts` colour assertions
still pass") is satisfied by construction and gates nothing.

### 1.9 "No DOM-structure assertions" — **false**, and this is the real phase-2 risk surface

There are **92** `toBeNull()` presence/absence assertions, reached through **325**
`querySelector` calls over **115 distinct `data-role` hooks**. The plan is right
that there are no *nesting* assertions (one `tagName` check, at
[identifier-input.spec.ts:26](web-angular/src/app/registry/identifier-input.spec.ts#L26)),
and right that there are no snapshots and no `getComputedStyle`. But extracting
fourteen primitives means moving markup, and every one of those 115 hooks has to
survive the move. That is a far larger constraint on phase 2 than the five
`className` assertions the plan does track.

### 1.10 "`emerald` — three utilities" — **four**, and it names four

§4 says "*Three utilities (`text-emerald-700`, `bg-emerald-500`, `bg-emerald-50`,
`border-emerald-200`)*" — a list of four. All four exist, 4 occurrences in 2 files.
"*against 22 green ones*" is also low: green totals **25** occurrences.

### 1.11 "Exactly one component has a `focus-visible` ring" — true only on a literal reading

[chip-group.ts:111](web-angular/src/app/registry/chip-group.ts#L111) is the only
`focus-visible:ring-*`. But [composer.ts:17](web-angular/src/app/components/composer.ts#L17)
carries `outline-none focus:border-farm-500` — it has *deliberately removed* the
native focus ring and replaced it with a border shift. Phase 2's "add a
token-driven ring to every interactive primitive" must not silently reinstate an
outline there, and the plan's count implies composer is unstyled ground.

### 1.12 "Strike the backtick-lint item from OPEN.md" — **there is no such item in OPEN.md**

`docs/OPEN.md` contains no mention of backticks, template literals, ESLint, or
`templates.spec.ts`. The § "Test and eval gaps" section holds five items, none of
them this one. [REGISTRY_PAYROLL.md §16.3](docs/REGISTRY_PAYROLL.md) does exist and
does say what the plan quotes, and `templates.spec.ts` was indeed built — but the
housekeeping action §10 prescribes has no target.

### 1.13 "`dayly yield` … is not in `web-angular/src`; it originates server-side" — **it is in `web-angular/src`**

[chart-card.ts:15](web-angular/src/app/components/chart-card.ts#L15):

```html
{{ dataset().scopeLabel }} — {{ dataset().interval }}ly yield
```

The server sends `interval: 'day'`; the `ly` suffix is concatenated in the
template. It is a one-line client-side fix, not a server question.

### 1.14 Three primitive estimates are all wrong, two of them badly

| Primitive | Plan | Actual | What is really there |
|---|---:|---:|---|
| `StatusBadge` | ~15 | **6 sites, 5 distinct strings** | `rounded-full bg-farm-200 px-2 py-0.5 text-xs font-medium text-farm-800` ×2 ([animal-detail.ts:29](web-angular/src/app/registry/animal-detail.ts#L29), [herd-list.ts:86](web-angular/src/app/registry/herd-list.ts#L86)); `rounded bg-farm-200 px-1.5 py-0.5 text-xs font-medium text-farm-700` ×1 ([event-list.ts:57](web-angular/src/app/registry/event-list.ts#L57), superseded — note `rounded`, not `rounded-full`, and farm-700); `rounded-full bg-farm-600 px-2 py-0.5 text-xs font-medium text-white` ×1 ([confirmation-card.ts:11](web-angular/src/app/components/confirmation-card.ts#L11)); the agent chip ×1 and the tool chip ×1, both of which carry their own TS colour logic |
| `SummaryBar` | ~6 | **3 sites, 3 distinct strings** | [milking-roster.ts:216](web-angular/src/app/registry/milking-roster.ts#L216) `flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-farm-300 bg-farm-50 px-4 py-3 text-sm`; [dispatch-sheet.ts:239](web-angular/src/app/registry/dispatch-sheet.ts#L239) same but `justify-between` and `bg-white`; [payroll-run.ts:240](web-angular/src/app/registry/payroll-run.ts#L240) a `<footer>` with `space-y-3 … p-4` — different element, different layout, different padding |
| `NotePanel` | ~8 | **8 sites — but they are not caveat blocks** | `rounded-lg bg-farm-50 px-3 py-2 text-sm` ×8, *all inside* [verification-panel.ts](web-angular/src/app/registry/verification-panel.ts) (lines 150, 178, 185, 190, 245, 250, 255, 260). They are **stat tiles**. The actual `/check` caveat is [verification-panel.ts:162](web-angular/src/app/registry/verification-panel.ts#L162), whose class is `mt-3 text-xs text-farm-600` — i.e. `HelpText`, already on the list |

The count of 8 for `NotePanel` is right by coincidence; the name, the description
and the role are all wrong, and a primitive used in exactly one file is a local
`@for`, not a design-system component.

---

## 2. Claims that are right

- One custom Tailwind ramp, `farm`, ten stops, in [tailwind.config.js](web-angular/tailwind.config.js).
- No `darkMode` key; `plugins: []`.
- **Zero** CSS custom properties anywhere in `src/` — no `--x:` declaration, no `var()`.
- Exactly five `[class.]` bindings.
- No snapshot tests, no `getComputedStyle`, no nesting/sibling DOM assertions.
- 26 spec files.
- Hardcoded colour lives in exactly two files.
- The three `.prose-chat` `rgba(0,0,0,…)` values are code bg, thead bg and cell borders.
- Exactly **three** opacity modifiers exist, and they are the three named: `border-farm-200/60` ([confirmation-card.ts:38](web-angular/src/app/components/confirmation-card.ts#L38)), `bg-green-50/40` ([destination-detail.ts:99](web-angular/src/app/registry/destination-detail.ts#L99)), `bg-farm-50/80` ([chat-panel.ts:24](web-angular/src/app/components/chat-panel.ts#L24)). No others, on any utility.
- **All eighteen phase-1 hex values are exact matches** for the current `farm` stops / `#ffffff`. Verified stop by stop against the config; zero visual delta is achievable at those values.
- Ten of the fourteen primitive counts are exact: FieldLabel 23, HelpText 36 (20 `text-sm` + 16 `text-xs`), SubHeading 17, Card 16, PageHeading 14, SectionLabel 13, TextInput 10, TextLink 10, RowDivider 10.
- The Button table is exactly right: 6 / 4 / 3 / 2 / 1 = 16 sites over those five strings, and the payroll `bg-farm-800` / everyone-else `bg-farm-600` split is real ([payroll-run.ts:257](web-angular/src/app/registry/payroll-run.ts#L257) vs [animal-form.ts:120](web-angular/src/app/registry/animal-form.ts#L120)).
- ErrorPanel's two named variants total 26 (15 + 11).
- `emerald`, `violet` and the four-arm agent switch all exist as described in `message.ts`.
- [app.routes.ts](web-angular/src/app/app.routes.ts) does have `RegistryShell` as parent of every registry route with `{ path: 'chat' }` as a top-level sibling — the diagnosis in §8 is correct.
- The `display: block` list is hand-maintained and its comment does say a missing entry "fails silently and looks like a spacing bug".
- `~300 code citations` matches `docs/README.md` (≈130 by path + ≈170 by bare name).
- The plan's §11 self-disclosures are honest: the counts *are* static, the three estimates *were* estimates, and "each is a floor" is the right caveat.

---

## 3. Constraints the document missed

### 3.1 `chart-card.spec.ts:31` pins a hex literal by exact equality

```ts
expect(data.datasets[0].borderColor).toBe('#8a6431');
```

[chart-card.spec.ts:31](web-angular/src/app/components/chart-card.spec.ts#L31).
This is a sixth presentational assertion, and unlike the five the plan tracks it
is an **exact-equality** check, not a substring. §7 prescribes a `chartTheme()`
factory for precisely this file and never notices that a spec nails the literal
down. Any theming of `chart-card.ts` breaks this test on day one.

### 3.2 `templates.spec.ts` — "write controls are all behind a recording session"

[templates.spec.ts:128](web-angular/src/app/registry/templates.spec.ts#L128) is a
source-text guard: any file in `src/app/registry/` whose text contains
`.provenance()` must also contain `<app-session-required`, unless it is one of two
named route-gated exceptions (`animal-form.ts`, `calving-form.ts`). Phase 2
extracts a `Button` primitive across 12 sites that sit next to exactly this
component. If a submit and its `provenance()` call move into a shared file, or if
`<app-session-required>` is absorbed into a primitive, this guard fires. The plan
mentions `templates.spec.ts` only to strike a nonexistent OPEN.md item.

A second, quieter fact about that guard: its glob is `./*.ts` — **registry only**.
Nothing in `src/app/components/` is covered, so the chat fold-in of §8 gains no
protection from it.

### 3.3 `app-session-required` is missing from the `display: block` list

§8 says to add `app-chat-panel` to that list. It is not the only omission.
[session-required.ts](web-angular/src/app/registry/session-required.ts) has **12
call sites** and is absent from the list. Five of them sit inside a `flex`
parent, where CSS blockifies the child and nothing is wrong; the remaining
seven — [correction-form.ts:104](web-angular/src/app/registry/correction-form.ts#L104),
[person-detail.ts:266](web-angular/src/app/registry/person-detail.ts#L266),
[destination-detail.ts:186](web-angular/src/app/registry/destination-detail.ts#L186),
[destinations-list.ts:239](web-angular/src/app/registry/destinations-list.ts#L239),
[people-list.ts:152](web-angular/src/app/registry/people-list.ts#L152),
[people-list.ts:219](web-angular/src/app/registry/people-list.ts#L219),
[payroll-run.ts:262](web-angular/src/app/registry/payroll-run.ts#L262) — do not,
and are exactly the latent case the list's own comment warns about.

### 3.4 `routing.spec.ts:277` forbids a date input on the Today board

```ts
expect(el.querySelector('input[type="date"]')).toBeNull();
```

[routing.spec.ts:277](web-angular/src/app/registry/routing.spec.ts#L277) — the
board must state its date as text, never as a picker. Any "improve the date
affordance" work on `/` violates it. Not in the constraint table.

### 3.5 `violet` has no home in the token vocabulary

[message.ts:75](web-angular/src/app/components/message.ts#L75) uses
`bg-violet-50 text-violet-700 border-violet-200` for the `both` agent.
`agentClass()` is a **categorical** palette — dairy/vendor/both/default must be
mutually distinguishable — and the plan's semantic model has three roles whose
meanings are error, outstanding and settled. Folding emerald into `success` and
amber into `warning` makes the `dairy` chip mean "settled" and the `vendor` chip
mean "outstanding", which is false, and leaves violet with nowhere to go. This
needs a fourth, categorical, ramp that §4 does not have.

### 3.6 The `<alpha-value>` decision breaks Chart.js consumption

§4 correctly notes that `<alpha-value>` forces `:root` to hold channel triplets
(`250 247 240`) rather than hex. §7 then asks `chartTheme()` to read "resolved
custom properties" and hand them to Chart.js — which cannot consume
`250 247 240`. The factory has to wrap every read in `rgb(…)`. Small, but it is
the interaction between two sections that neither section notices.

### 3.7 `docs/README.md` does not list `UI_SYSTEM.md`

The plan opens by claiming a "dual reference/record role" alongside
[REGISTRY.md](docs/REGISTRY.md), and `docs/README.md § Conventions` requires every
document to carry status and be findable. The index has no entry. A one-line fix,
but it is the plan's own stated convention.

---

## 4. My answer on the trial gate

**The reading is defensible for five of the six predictions and wrong for the
sixth — and the per-route model it rests on is unsound for shared components.
As written, §3 is convenient.**

### Where the reading holds

§11's text is narrow, and the plan quotes it fairly. The held item is *"token
layer and `(optional)` markers — held, treated as adjacent to prediction 3…
These are preferences on forms the trial measures"*, and `/check` is explicitly
called *"uncontaminating, since `/check` is not in the trial."* Checking each
prediction against the code:

| # | Prediction | Surface | Frozen by the plan? |
|---|---|---|---|
| 1 | `acquired_from` in the tab path | `/animals/new` ([animal-form.ts:107](web-angular/src/app/registry/animal-form.ts#L107)) | Yes |
| 2 | Overshooting arrival date into birth date | `/animals/new` ([animal-form.ts:86,95](web-angular/src/app/registry/animal-form.ts#L86)) | Yes |
| 3 | Ten tab stops, half empty | `/animals/new`; `observed_by` is on the form at [animal-form.ts:108](web-angular/src/app/registry/animal-form.ts#L108), not in the session bar | Yes |
| 4 | Surviving dam quietly wrong | `/animals/calvings/new` ([calving-form.ts:77](web-angular/src/app/registry/calving-form.ts#L77)) | Yes |
| 5 | **Write announcement too quiet** | **the shell** — see below | **No** |
| 6 | `Cmd+Enter` does nothing | both frozen forms; behavioural, not visual | Yes |

### Where it fails: prediction 5

Prediction 5 is *"the write announcement being too quiet — **a thin green line in
the shell**"*. That line is
[registry-shell.ts:112-113](web-angular/src/app/registry/registry-shell.ts#L112-L113):

```html
<div class="border-b border-green-200 bg-green-50 px-4 py-1.5 text-center text-xs font-medium text-green-900"
  data-role="write-log">{{ msg }}</div>
```

The plan freezes "*the shell chrome immediately around them (**nav, tab order into
the form**)*". The write-log bar is neither nav nor tab order, and it is not in the
free list either — it falls in a gap the enumeration creates. Meanwhile:

- §4's `success` role is `green-50` / `green-800` / `green-300`. Mapping this line
  onto it changes `text-green-900` → `text-green-800` (**lighter**, i.e. quieter)
  and `border-green-200` → `border-green-300`.
- §5's certainty vocabulary claims `success` for "complete, measured, settled" and
  its acceptance criterion is a whole-app greyscale property, so it cannot stop at
  the free screens.
- §7's dark mode must give this bar a treatment either way.

So the plan's own phases 3 and 5 alter the contrast of the exact element
prediction 5 measures the loudness of — while §3 declares those phases
unconstrained. **The measurement prediction 5 was pre-registered for cannot be
re-taken**, and §11 held far cheaper things than this on far weaker grounds.

### The deeper problem: the gate is per-route, the code is per-component

Even setting prediction 5 aside, a route-shaped freeze cannot express what the
code actually is. Three input primitives straddle the line:

| Component | Frozen screens | Free screens |
|---|---|---|
| [chip-group.ts](web-angular/src/app/registry/chip-group.ts) | animal-form, calving-form | event-form, person-detail, dispatch-sheet, destinations-list, session-gate, milking-roster, destination-detail, people-list — **8** |
| [identifier-input.ts](web-angular/src/app/registry/identifier-input.ts) | animal-form, calving-form | event-form, person-detail, dispatch-sheet, milking-roster, payroll-run — **5** |
| [precision-date.ts](web-angular/src/app/registry/precision-date.ts) | animal-form, calving-form | event-form, correction-form — **2** |

There is no way to give `ChipGroup` a token-driven focus ring "on `/milk/milking`
only". §6 anticipates this for exactly one component — "*keep a `legacy` variant
reproducing their current classes exactly*" for `Button` — and does not notice
that the same problem applies to the three components the frozen forms are
mostly *made of*. `chip-group` is the sharpest case: §11's amendment records the
printed digit accelerators as one of two things **predicted to feel better than
expected**, and notes the calf-sex fix means "the accelerator now fires every
record". That prediction is measured on `ChipGroup`'s rendering.

`session-gate.ts` compounds it: on both frozen routes, an operator without a
session sees the gate *instead of* the form
([registry-shell.ts:145](web-angular/src/app/registry/registry-shell.ts#L145)), and
the gate carries a filled button, uppercase field labels and a note panel that
phase 2 would collapse. It appears nowhere in §3's lists.

### One internal contradiction, for the record

The constraint table says "*the recording bar may be restyled, never removed or
made conditional*". §3 freezes "*the shell chrome immediately around*" the two
forms. `<app-session-bar />` is the first child of the shell
([registry-shell.ts:26](web-angular/src/app/registry/registry-shell.ts#L26)) and
renders directly above both frozen forms. The two rules give opposite answers
about the same element.

### What I would do instead

Re-gate on **components**, not routes: freeze `animal-form`, `calving-form`,
`chip-group`, `precision-date`, `identifier-input`, `calf-picker`,
`duplicate-warning`, `session-gate`, `session-bar` and the write-log bar in
`registry-shell` until the trial reports. That is still compatible with phases 1
and 4 (which are genuinely zero-delta and single-file), and it costs phases 2, 3
and 5 only the free screens — which is most of the app. The alternative is to run
the five-animal trial first; it is five animals.

---

## 5. What will not work as specified

### 5.1 Phase 2's acceptance criterion is arithmetically unreachable

> *`rounded`-bearing distinct class strings drop from 96 to under 25.*

Of the **101** distinct `rounded` strings, **74 (73%) occur exactly once**. The 27
repeated strings account for 136 of the 210 occurrences. Extracting fourteen
primitives collapses *repeated* strings — at best it removes those 27, leaving
**≥74**. Reaching "under 25" requires rewriting roughly fifty one-off strings,
which is not "extract fourteen primitives" but "rewrite every template", and it
is the opposite of §1's "the work is mechanical, not architectural".

**And 12 of those 74 singletons live on frozen surfaces** — `calf-picker` ×2,
`calving-form` ×3, `duplicate-warning` ×1, `precision-date` ×2, `session-gate` ×4.
So the criterion cannot be met without visibly editing the trial forms.

The metric is also blind in two directions:

- **Seven of the fourteen primitives carry no `rounded` at all** — FieldLabel,
  HelpText, SubHeading, PageHeading, SectionLabel, TextLink, RowDivider. Extracting
  them (117 call sites, the majority of the work) moves the number by zero.
- It cannot see the app's largest inconsistency — §5.2.

A better criterion: total distinct whole-attribute class strings, currently **358**
over 957 occurrences.

### 5.2 The fourteen omit the biggest uncollapsed family: table cells

**12 tables, 98 cells (54 `<td>`, 44 `<th>`), 30 distinct cell class strings**, with
four competing padding scales in simultaneous use — `px-3 py-2` (22), `py-1` (10),
`px-3 py-2 text-right` (8), `px-3 py-1.5`, `px-4 py-1.5`. Spread across
`herd-list`, `people-list`, `destinations-list`, `destination-detail`,
`dispatch-sheet`, `milking-roster`, `verification-panel` (×4), `confirmation-card`.

No cell carries `rounded`, so phase 2's metric never sees it, and no primitive on
the list covers it. If the screenshots "read wrong", this is a likelier cause than
the button.

### 5.3 Other primitives the list misses at ≥6 sites

| String | Sites | Note |
|---|---:|---|
| `text-sm font-semibold text-farm-900` | 12 | A third heading level between `PageHeading` (text-lg) and `SubHeading` (text-sm font-medium farm-800) |
| `w-full rounded-lg border border-farm-300 px-3 py-2 text-sm` + `rounded-lg border border-farm-300 px-3 py-2 text-sm` | 7 + 6 | A **larger `TextInput`**. The listed variant is `px-2 py-1.5` ×10, so `TextInput` really spans ~23 sites over two sizes |
| `mb-1 text-xs font-medium uppercase tracking-wide text-farm-600` | 9 | A fieldset-legend label; on both frozen forms |
| `mt-1 text-sm text-farm-600` | 9 | `HelpText` + margin |
| `rounded-xl border border-farm-300 bg-white p-4 text-sm text-farm-600` | 6 | `Card` + empty-state text |

### 5.4 `@tailwindcss/forms` in phase 3 breaks the trial gate

The plugin is a **global base-layer** restyle of every `input`, `select`,
`textarea`, `checkbox` and `radio`. The two frozen forms contain all of these:

- [calving-form.ts:77](web-angular/src/app/registry/calving-form.ts#L77) —
  `<select #firstField data-role="dam">`, the **first field of the frozen calving
  form**. `@tailwindcss/forms` gives `<select>` a new chevron background-image,
  padding and border. This is the single most visible change it makes.
- [animal-form.ts:53,64,69](web-angular/src/app/registry/animal-form.ts#L53) — three
  bare text inputs; plus `identifier-input` ×2 and `precision-date` ×2.
- [precision-date.ts:111](web-angular/src/app/registry/precision-date.ts#L111) — a
  `type="checkbox"`, which the plugin restyles completely.

§3 permits only zero-visual-delta changes on frozen screens. **Phase 3 is not
zero-delta there**, and the plan never notices because it reasons about the
plugin per-screen while the plugin acts per-element-type.

The eleven `<input type="date">` the plan asks to enumerate, incidentally, are all
on free screens — [person-detail.ts:119](web-angular/src/app/registry/person-detail.ts#L119),
[:224](web-angular/src/app/registry/person-detail.ts#L224),
[dispatch-sheet.ts:82](web-angular/src/app/registry/dispatch-sheet.ts#L82),
[destinations-list.ts:148](web-angular/src/app/registry/destinations-list.ts#L148),
[:203](web-angular/src/app/registry/destinations-list.ts#L203),
[milking-roster.ts:101](web-angular/src/app/registry/milking-roster.ts#L101),
[payroll-run.ts:73](web-angular/src/app/registry/payroll-run.ts#L73),
[:78](web-angular/src/app/registry/payroll-run.ts#L78),
[:217](web-angular/src/app/registry/payroll-run.ts#L217),
[destination-detail.ts:132](web-angular/src/app/registry/destination-detail.ts#L132),
[people-list.ts:200](web-angular/src/app/registry/people-list.ts#L200). The frozen
forms use `precision-date`'s `date-text` input instead, so the OS-chrome problem
and the trial gate happen not to collide. Two of the eleven are pinned by specs
([payroll.spec.ts:296](web-angular/src/app/registry/payroll.spec.ts#L296) selects
one; [routing.spec.ts:277](web-angular/src/app/registry/routing.spec.ts#L277)
forbids one).

### 5.5 Phase 0 screenshots the wrong twelve screens

§9 phase 0: "*twelve screens screenshotted at one fixed width*". §3's free list has
exactly twelve entries. So the baseline covers the free screens and **omits
`/animals/new` and `/animals/calvings/new`** — the two screens where phase 1's
zero-delta property is the entire safety argument, and the only two that cannot be
re-measured if it fails. Phase 1's acceptance ("phase-0 screenshots match") is
therefore unenforceable exactly where it matters. Screenshot fourteen.

Related: all three opacity modifiers — the plan's named phase-1 regression test —
are on free screens (chat panel, confirmation card, destination detail). Phase 1
has **no** check that touches a frozen form.

### 5.6 `chart-card.ts` is easier than the plan says in one half, harder in the other

The plan calls it "the single most involved item" and says the chart is
"configured once at init". Half right:

- **`data` is already a `computed()`** ([chart-card.ts:26](web-angular/src/app/components/chart-card.ts#L26))
  holding five of the ten hex literals, and it is bound as `[data]="data()"`. Add a
  theme signal read and it re-evaluates and re-renders for free. Nothing in the
  component's structure fights this.
- **`options` is a plain class field** ([chart-card.ts:57](web-angular/src/app/components/chart-card.ts#L57))
  bound as `[options]="options"` — a stable reference, which is the "once at init"
  the plan describes. Converting it to a `computed()` and the binding to
  `options()` is a two-line change; `BaseChartDirective` picks up the new object
  through `ngOnChanges`.

So the mechanism is clean. The real obstacles are the two the plan does not name:
`chart-card.spec.ts:31` pins `#8a6431` by exact equality (§3.1), and
`getComputedStyle` reads of `:root` return **channel triplets** under the
`<alpha-value>` scheme, which Chart.js cannot parse without an `rgb()` wrapper
(§3.6). Note also that jsdom already cannot give this component a 2D context — the
run prints `Not implemented: HTMLCanvasElement's getContext()` — so a re-render-on-
toggle test has to assert on the config object, not the canvas.

### 5.7 Adding `app-chat-panel` to the `display: block` list is necessary but not sufficient — and contradicts the list's own rule

Two problems with §8.2.

**It breaks the list's stated policy.** The comment in
[styles.css](web-angular/src/styles.css) says routed components are *deliberately
absent*: "*they are never siblings of anything — the router inserts them alone
after `<router-outlet>`*". §8.1 moves chat **into** `RegistryShell`'s children,
which makes `app-chat-panel` a routed component — so by the list's own rule it
should stay off the list.

**`display: block` alone does not fix the layout.** The chat panel's root is
`<div class="mx-auto flex h-full max-w-3xl flex-col">`
([chat-panel.ts:23](web-angular/src/app/components/chat-panel.ts#L23)) with a
`flex-1 overflow-y-auto` scroll region and `<app-composer>` pinned below it.
Inside the shell it would land in
`<main class="flex-1 overflow-y-auto px-4 py-6">`. `main` gets a definite height
from the shell's `flex h-full flex-col` chain, but `app-chat-panel` as a plain
block child has `height: auto` — so the child's `h-full` percentage resolves
against `auto` and collapses. Consequences:

1. The message list stops scrolling internally; `main` scrolls the whole page instead.
2. The composer stops being pinned and drifts to the bottom of a long document.
3. `afterRenderEffect`'s `scrollTo({top: scrollHeight})`
   ([chat-panel.ts:83](web-angular/src/app/components/chat-panel.ts#L83)) silently
   does nothing, because `scrollHeight === clientHeight` on a container that never
   overflows.

What is needed is `app-chat-panel { display: block; height: 100%; }` (or `min-h-0`
plus a flex `main`), and `main`'s `py-6` reconciled with a full-height child. This
is the same class of failure the list exists to prevent, one level deeper.

**Can that list be guarded by a test instead of a comment?** Yes, and cheaply —
`templates.spec.ts` already has the machinery. `import.meta.glob('./*.ts', {query:
'?raw'})` yields every registry source; extract `selector: 'app-…'` from each,
drop the routed ones (they are identifiable from `app.routes.ts`'s
`loadComponent` list), and assert the remainder appear in `styles.css`. The one
new thing needed is reading `styles.css` as raw text, which the same glob
mechanism supports. Doing this would have caught `app-session-required` (§3.3).

### 5.8 The eighteen semantic tokens do not cover the 54 utilities

The plan asks whether a case falls through. Several do. The 18 tokens plus the
3×3 role grid cover 27 utilities; **19 fall through**, 4 of them `emerald`, all
of `violet`, and several with a real semantic job:

| Unmapped | Uses | Why it needs a name |
|---|---:|---|
| `border-farm-600` | 8 | The **selected** chip/card border — a state, not a brand fill. `chip-group`, `calf-picker`, `correction-form`, `animal-detail` (active tab) |
| `text-amber-900` | 13 | Warning text one stop darker than the role's `amber-800` |
| `text-red-700` | 9 | Pinned by [tool-call-chip.spec.ts:33](web-angular/src/app/components/tool-call-chip.spec.ts#L33) — the plan knows, but its `danger.fg` is `red-800`, so the role cannot express it |
| `text-green-900` | 7 | Includes the write-log bar (§4) |
| `bg-farm-200` | 4 | Status-badge fill |
| `border-green-200` | 2 | Write-log border; `success.line` is `green-300` |
| `border-transparent` | 2 | Inactive tab underline |
| `ring-farm-500`, `focus:border-farm-500` | 1 + 1 | Focus. §7 wants a token-driven ring — it needs a token |
| `decoration-farm-300` | 1 | Already the certainty vocabulary's dotted-underline rule, unnamed |
| `divide-farm-100` | 1 | Same hue as `border-hairline`, different property |
| `bg-farm-400`, `border-farm-500`, `bg-amber-200`, `text-amber-700`, `border-amber-200`, `bg-red-500` | 1 each | One-offs; some should just be deleted |

`bg-amber-200` ×1 is worth its own line: it is
[session-bar.ts:27](web-angular/src/app/registry/session-bar.ts#L27), the harness
banner, and [target.spec.ts](web-angular/src/app/registry/target.spec.ts) pins that
banner's presence and absence.

### 5.9 The Button set is larger than the table

The five listed variants are exactly right (16 sites). But there are **three more
button-shaped sites in two more variants** the table omits:

- [session-gate.ts:116](web-angular/src/app/registry/session-gate.ts#L116) —
  `mt-5 w-full rounded-xl bg-farm-600 px-4 py-2.5 …`, the gate's own submit, which
  is what an operator sees on a frozen route with no session.
- [person-detail.ts:137](web-angular/src/app/registry/person-detail.ts#L137) —
  `rounded-lg bg-farm-800 px-4 py-2 …` with **no disabled treatment at all**, so
  the count is three disabled strategies, not two.
- [herd-list.ts:38](web-angular/src/app/registry/herd-list.ts#L38) — an `<a>`
  styled as a button, so the primitive needs a link variant.

Plus two non-button uses of the same fill that must *not* be swept in:
[confirmation-card.ts:11](web-angular/src/app/components/confirmation-card.ts#L11)
(a badge) and [message.ts:16](web-angular/src/app/components/message.ts#L16) (the
user's chat bubble — which §8.4 separately wants quieted).

Likewise `ErrorPanel`: the two named variants are 26 sites, but there are **7
distinct red-panel strings over 35 sites**, including one at `text-red-900`
([verification-panel.ts:61](web-angular/src/app/registry/verification-panel.ts#L61))
and one at `text-red-700` with a `border-red-300` and a third radius
([chat-panel.ts:65](web-angular/src/app/components/chat-panel.ts#L65)) — neither
expressible in a `danger` role fixed at `red-800`.

### 5.10 Unstyled markdown: `h4`–`h6` cannot occur

§7 says "*`h1`–`h6`, `blockquote`, `a`, `hr`, `pre`, nested lists all fall through
preflight*". `ALLOWED_TAGS` in
[markdown-view.ts:14](web-angular/src/app/components/markdown-view.ts#L14) permits
`h1`, `h2`, `h3` only — DOMPurify strips `h4`–`h6` before they reach the DOM. The
rest of the list is correct, and `del` should be added to it.

---

## Summary

Sections 4 and 5 of the plan are in good shape: the eighteen phase-1 hex values
are exact, the opacity inventory is complete and correct, and phase 1 as specified
really is zero-delta. Ten of the fourteen primitive counts are exact and the
Button diagnosis is right.

The problems cluster in three places. The census numbers in §1 are inflated
(54 not 67, 101 not 96, 74.6% not 85%) and one of them — "no status→class maps" —
is the premise the plan's tractability argument rests on, and it is false.
Phase 2's acceptance criterion cannot be met by the work phase 2 describes, and
the fourteen primitives omit the app's largest inconsistency. And the trial gate
in §3 is drawn around routes when the code is organised around shared components,
which lets phase 3's `@tailwindcss/forms` and phase 5's `success` role reach the
two frozen forms and the write-log bar that prediction 5 was pre-registered
against.

Nothing here argues against the plan's direction. Phases 1 and 4 look sound and
could proceed against a fourteen-screen baseline. Phases 2, 3 and 5 need
re-gating on components before they are safe to run.

---

# Round 2 — 2026-09-08

*Adversarial read of the **design system** (`docs/UI_SYSTEM.md`, 505 lines, the
document that folds round 1's corrections in) against the working tree at
`816fe67`. Round 1 above is unchanged. Counts here were re-measured from the
code, not carried over. No code was changed in this pass.*

**Verdict up front: one blocker, in §6.3, and it stops phase 2 rather than phase
1.** §11.3 below is the finding. Phase 1 as specified is sound and zero-delta.

**Test counts, re-run on the `.nvmrc` node (`22.22.3`):**

| Suite | Command | Result |
|---|---|---|
| Frontend | `npm test -w web-angular` | **281 passed / 281**, 26 files, 5.67 s |
| Server | `npm test -w server` | **726 passed / 726**, 4 suites, 0 fail / skip / todo |

Unchanged from round 1. The `Not implemented: HTMLCanvasElement's getContext()`
notice still prints (§8.1's jsdom point is still true).

---

## 10. Which document is which — the housekeeping in part 3 cannot be run as written

Before any finding: the repo does not contain the two documents the task
describes.

| Path | State | Content |
|---|---|---|
| `docs/UI_SYSTEM.md` | new, staged, **not in `HEAD`** | the **design system** |
| `docs/UI_SYSTEM_DESIGN.md` | new, staged, **not in `HEAD`** | the design system, **byte-identical** (`md5 92a4b71c…`) |
| `UI_SYSTEM_DESIGN.md` (repo root) | **does not exist** | — |

Both files are the *same* document, the design system, and `git log --all` has
no commit touching either path. **The round-1 plan is not on disk anywhere.** It
was never committed, so it survives only as the quotations inside round 1 above
(its §4's "67 distinct colour utilities", its fourteen primitives, `NotePanel`,
its "twelve screens" — none of which appear in the file now at
`docs/UI_SYSTEM.md`, whose §6 lists fifteen primitives and whose §10 asks for
fourteen screens).

Consequences for part 3's five housekeeping steps:

1. **"Move `docs/UI_SYSTEM.md` → `docs/archive/UI_SYSTEM_PLAN.md`"** — has no
   valid target. `docs/UI_SYSTEM.md` is the *successor*, not the plan. Archiving
   it would file the design system as superseded by itself. Writing an
   `archive/UI_SYSTEM_PLAN.md` would mean reconstructing a document from its
   critic's quotations and back-dating it, which is a fabricated record.
2. **"Move `UI_SYSTEM_DESIGN.md` → `docs/UI_SYSTEM.md`"** — already satisfied.
   The design system is at that path. The step reduces to deleting the redundant
   `docs/UI_SYSTEM_DESIGN.md` copy.
3. `docs/README.md`'s Reference table still needs the entry (round 1 §3.7 stands,
   unfixed). The Archive table needs nothing, there being nothing to archive.
4. Round 1's links to `docs/UI_SYSTEM.md` now resolve to the design system rather
   than the plan. The honest note is that its subject is *not on disk* — not a
   pointer to an archive path that would not exist.
5. **Nothing in the code cites either path.** `grep -rn "UI_SYSTEM"` over
   `web-angular/`, `server/`, `shared/`, `scripts/` returns nothing; the only
   mentions are in `docs/` and this file.

This is a records problem, not a design one, and it does not block anything. But
step 1 as written cannot be executed truthfully, so it was not attempted.

---

## 11. Part 1 findings

### 11.1 The corrected counts — six exact, five still wrong

Method reproduced from round 1 so the numbers are comparable: whole-attribute
`class="…"` values in production `.ts` under `web-angular/src`, whitespace
normalised, variant prefixes stripped for the colour census, opacity modifiers
kept distinct.

| Claim | Measured | Verdict |
|---|---|---|
| 358 distinct class strings / 957 occurrences | **358 / 957** (230 singletons) | **exact** |
| 24 `[class]` + 5 `[class.x]` bindings | **24 / 5** | **exact** |
| 54 colour utilities | **54** (966 occurrences, farm 74.5%) | **exact** |
| TableCell: 12 tables, 98 cells | **12 tables, 98 cells** (54 `<td>`, 44 `<th>`) | **exact** |
| ErrorPanel 35 sites / 7 distinct | **35 / 7** | **exact** |
| SectionHeading 12 @ `text-sm font-semibold` | **12** (`text-sm font-semibold text-farm-900`) | **exact** |
| StatusBadge 6 sites / 5 distinct | **6 / 5** | **exact** |
| SummaryBar 3 sites / 3 distinct | **3 / 3** | **exact** |
| Button 19 sites | **19** | **exact** |
| 115 `data-role` hooks | **115** spec-reached | **exact** |
| 92 presence assertions | **92** `toBeNull()` (27 negated) | **exact** |
| `border-farm-600` ×8, a *selected* state | **8**, all selected/active-tab | **exact** |
| **TableCell 34 distinct strings** | **31** | wrong |
| **TableCell padding 39 / 26 / 8 / 7** | **44 / 34 / 12 / 7** | wrong |
| **TableCell "26 cells with no horizontal padding"** | **34** (35 counting one classless cell) | wrong — understated |
| **Button "seven variants"** | **eight** — and §6.3's own table lists eight rows | wrong |
| **Button "three disabled strategies"** | **three styled, plus five sites with none** | ambiguous |
| **TextInput ~23 over two sizes** | doc counts 2 of 17 strings; families are **27 + 18 = 45** | badly understated |
| **325 `querySelector` calls** | **340** (311 + 29 `querySelectorAll`) | wrong |

Notes on the four that matter.

**TableCell's buckets do not sum.** 39 + 26 + 8 + 7 = 80 against 98 cells; mine
(44 / 34 / 12 / 7, plus one classless cell) sum to 98. No scoping reproduces the
doc's figures — registry-only gives 94 cells / 29 distinct, components-only 4 / 4.
The direction is the useful part: the `py-1` family with **no horizontal padding
at all is 34 cells, not 26**, so §6.2's "largest inconsistency in the app" is
larger than it claims. "No cell carries `rounded`" is confirmed — zero of the 31
strings contains it.

**TextInput is the worst-measured primitive in the document.** `~23` is the sum
of two *exact strings* (`rounded-lg border border-farm-300 px-2 py-1.5 text-sm`
×10 and `w-full rounded-lg border border-farm-300 px-3 py-2 text-sm` ×7 +
`rounded-lg border border-farm-300 px-3 py-2 text-sm` ×6 = 13). The actual
population sharing those paddings is **27 sites over 10 strings** (`px-2 py-1.5`)
and **18 over 7** (`px-3 py-2`) — 45, once the width prefixes (`w-32`, `w-56`,
`w-full max-w-md`, `w-24`, `w-28`, `w-72`, `w-full max-w-xs/sm`) are recognised as
the same control at different widths. A `TextInput` with two sizes and no width
prop collapses 23 of 45 and leaves 22 behind.

**Button's eighth variant.** 19 sites over **eight** distinct strings. §6.3's
table has eight rows summing to 19, so the "Seven variants" in §6's summary table
contradicts §6.3 itself. Disabled treatments: `disabled:cursor-not-allowed
disabled:bg-farm-300` (8), `disabled:bg-farm-300` (3), `disabled:opacity-40` (4),
and **five sites with no disabled styling at all** (chat-panel, confirmation-card,
person-detail, herd-list's `<a>`, and the `mt-5 inline-block` empty-state CTA).

### 11.2 Token coverage — seven utilities still fall through, and one has no phase-1 value

§3.1's twenty-one phase-1 values are **all exact**, verified stop by stop against
`tailwind.config.js` (round 1 checked eighteen; the table has grown). §3.2's
*Light* column is likewise today's Tailwind palette exactly — `#fef2f2` red-50,
`#991b1b` red-800, `#fca5a5` red-300, `#b91c1c` red-700, `#fffbeb` amber-50,
`#92400e` amber-800, `#fcd34d` amber-300, `#78350f` amber-900, `#f0fdf4` green-50,
`#166534` green-800, `#86efac` green-300, and §3.4's `#14532d` green-900 /
`#bbf7d0` green-200. Zero-delta is achievable at all of them.

Walking all 54 against §3.1–§3.5, **47 map and 7 do not**:

| Unmapped | Uses | Where | Round-1 status |
|---|---:|---|---|
| `bg-farm-800` | 5 | the second button fill — payroll-run, people-list ×2, person-detail ×2 | §6.3 deletes the variant, but §3 gives farm-800 no token, so any surviving site has nowhere to go |
| `bg-amber-200` | 1 | `session-bar.ts:27`, the harness banner `target.spec.ts` pins | flagged round 1 — **silently dropped** |
| `bg-emerald-500` | 1 | `tool-call-chip.dotClass()`, the OK dot | §3.3 gives the agent ramp bg/fg/line, no dot fill — **silently dropped** |
| `bg-red-500` | 1 | `tool-call-chip.dotClass()`, the error dot | flagged round 1 — **silently dropped** |
| `bg-farm-400` | 1 | `chat-panel.ts`, the "Thinking…" pulse | flagged round 1 — **silently dropped** |
| `border-transparent` | 1 | `animal-detail.ts`, the inactive tab underline | flagged round 1 — **silently dropped** |
| `text-red-900` | 1 | `verification-panel.ts:61` | flagged round 1 §5.9 — **silently dropped**; `danger.fg` is red-800 and `danger-soft` red-700 |

So of the six one-offs round 1 flagged for deletion: **three were mapped**
(`border-farm-500` and `ring-farm-500` → `--focus-ring`; `text-amber-700` and
`border-amber-200` → §3.3's `agent.vendor` at today's amber), **none was
explicitly deleted**, and **four were silently dropped** — plus `border-transparent`
and `text-red-900` from the same lists.

**One structural gap, and it bites phase 1 directly.** Part 3 says "phase-1
values are the exact current hexes from §3.1". §3.1 has a phase-1 column; §3.2's
Light column happens to be today's values; **§3.5 has no phase-1 column at all** —
its `--certainty-approx` `#82807A` and `--certainty-approx-rule` `#A8A69E` are
*target neutrals*, and `decoration-farm-300` (the one site that already exists,
`#d4ba85`) is neither. §3.3's agent ramp is safe only because it carries a
"Today" column. So a phase 1 that declares every token in §3 at its tabulated
value would write two certainty tokens at target values. Harmless while nothing
consumes them — but it is not "the exact current hexes", and phase 5 is where it
would surface.

### 11.3 BLOCKER — §6.3's disabled state adds a tab stop to both frozen forms, and B1 does not catch it

This is the round-1 failure again, one enumeration over. Round 1 found the
write-log bar falling between "nav / tab order" and the free list. This one falls
between **"field"** and everything else.

**What the prediction measures.** `REGISTRY_ENTRY_UX.md §11` prediction 3 is
*"Ten tab stops, about half of them empty. `acquired_from`, `tag_no` and
`observed_by` are blank for most backfill animals. This is the specific friction
that would argue for a list."* Its decision rule is explicit: *"If 1 and 3 are
the only real complaints, both are small fixes to `/animals/new` and a roster
screen is redundant."* Prediction 3 gates whether §5.1 gets built.

**Measured, not inferred.** A throwaway probe rendered both forms and applied the
HTML tab-order rule:

| State | tab stops | submit natively disabled |
|---|---:|---|
| `/animals/new`, fresh | **8** | yes |
| `/animals/new`, both dates typed as `2019` | **11** | no |
| `/animals/calvings/new`, fresh | **6** | yes |

The ten are the controls: the sex group (one stop — `chip-group` uses a roving
tabindex, `tabIndexFor()` at [chip-group.ts:103](web-angular/src/app/registry/chip-group.ts#L103)),
`name`, `acquired_from`, `post_no`, `tag_no`, both `date-text` inputs, both
`estimated` checkboxes, `observed_by`. Fresh it is 8, because the two checkboxes
carry `[disabled]="!canEstimate()"` and `canEstimate('')` is false until a bare
year is typed. The submit is the eleventh, reachable only once enabled. **The
pre-registered "ten" is exactly the control count.**

**What §6.3 does to it.** The target is *"Disabled is visibly inert — reduced
contrast on both fill and label, `cursor-not-allowed`, `aria-disabled`, and
`aria-describedby` pointing at the existing reason text."* §7 states the purpose:
*"Submit reasons | Not linked | `aria-describedby` from button to reason."* That
purpose **requires dropping the native attribute** — a natively disabled button is
not focusable, so its `aria-describedby` is never announced and `aria-disabled`
is redundant beside it. Confirmed in jsdom:

```
native disabled  -> .disabled = true   matches(':disabled') = true
aria-disabled    -> .disabled = false  matches(':disabled') = false
```

So the button becomes focusable. On a fresh `/animals/new` the tab stops go
**8 → 9**; on `/animals/calvings/new` **6 → 7**. Mid-entry the operator now tabs
from `observed_by` onto a button that looks dead and does nothing, instead of
leaving the form.

**Why none of the three rules catches it.**

- **B1** is *"No field may be added, removed or reordered on either form."* A
  submit button is not a field. The rule is drawn around the identity grid and
  the date fieldsets.
- **B2** is the two `date-text` inputs.
- **B3** is `registry-shell.ts:112`.

And §2 does not merely fail to catch it — it **affirmatively permits** it:
*"Everything else — tokens, primitives, **buttons**, cells, spacing, dark mode,
the certainty vocabulary — applies to the two forms exactly as to every other
screen. There are no `legacy` variants and no component-level freeze."* The one
escape that would preserve the measurement — keep native `disabled` on the two
frozen forms — is the `legacy` variant §2 forbids by name.

**A second-order change on the same surface.** Implicit submission is blocked
when a form's default button is disabled. `animal-form.ts:27` records Enter-to-
submit as a deliberate keyboard affordance (*"A real `<form>`, which is what
makes Enter submit from any text field"*) and it is part of the §6.7a retrofit
predictions 3 and 6 measure. Under `aria-disabled` Enter reaches `onSubmit()`,
which falls through the belt-and-braces guard at
[animal-form.ts:229](web-angular/src/app/registry/animal-form.ts#L229) and does
nothing — the same *outcome*, but the form now submits-and-refuses where it
previously did not fire at all.

**Recommendation.** Three options, in the order I would take them:

1. **Run the trial.** It is five animals, and §2 exists only to protect it.
   Everything else in phases 1–2 then proceeds unconditionally.
2. **Add a B4** freezing tab-stop count and tab order on the two forms, and
   implement §6.3's disabled state everywhere *except* the two frozen submits —
   which needs §2's "no `legacy` variants" softened to "no legacy variants except
   where a prediction measures the thing being changed".
3. **Split §6.3.** Ship the radius/fill unification (genuinely invisible to every
   prediction) in phase 2 and defer only the disabled-state rework to phase 7,
   alongside B1–B3.

### 11.4 A second §2 gap, in phase 5 — the two predictions expected to feel *better*

Not a blocker for phases 0–2, but the same shape, and §2 should carry it.

`REGISTRY_ENTRY_UX.md §11` records eight predictions, not six: *"Two predicted to
feel better than expected, so the comparison stays honest: the printed digit
accelerators on sex and outcome, and the single date field on murky dates."*
§2's table enumerates 1–6 and dismisses 4 and 6 as behavioural. It never mentions
the other two.

The accelerators are `chip-group`'s printed digits
([chip-group.ts:72](web-angular/src/app/registry/chip-group.ts#L72)), and the
pre-trial amendment ties them to the calf-sex default removal: the chip *"starts
unanswered"* and *"the accelerator now fires every record"*. §5 then gives
*"Unanswered — still required"* the `warning` role — *"The only amber on the
screen"* — and says the vocabulary applies to the frozen forms *"constrained by
B2 only"*. So phase 5 paints the unanswered calf-sex group amber: the exact
element one of the two positive predictions is measured on, permitted by all
three rules.

### 11.5 Feasibility spot-checks

**§8.1 — `options` → `computed()` is correct, and confirmed against the installed
package.** `ng2-charts@10.0.0`. `BaseChartDirective` declares `options` as a
classic input with `usesOnChanges: true`
([ng2-charts.mjs:196](node_modules/ng2-charts/fesm2022/ng2-charts.mjs#L196)), and
`ngOnChanges` takes the non-first-change branch, does
`Object.assign(this.chart.config.options, config.options)` and then `this.update()`
([:94-106](node_modules/ng2-charts/fesm2022/ng2-charts.mjs#L94)). A new object
reference from a `computed()` is therefore picked up. Two details the doc does not
name, both benign: the merge is **shallow**, which is fine here because every
themed value sits under `scales`, and that whole sub-object is replaced by
reference; and the update path is `chart.update()`, not `render()` — `render()`
runs only when `type` changes — so no canvas is recreated, which is what makes the
jsdom `getContext()` gap survivable.

**§9.2 — the `h-full` collapse analysis is right; `main` does *not* need `min-h-0`.**
The chain is `<div class="flex h-full flex-col">` → `<main class="flex-1
overflow-y-auto px-4 py-6">` ([registry-shell.ts:145](web-angular/src/app/registry/registry-shell.ts#L145)),
and the panel's root is `mx-auto flex h-full max-w-3xl flex-col`
([chat-panel.ts:23](web-angular/src/app/components/chat-panel.ts#L23)) with a
`flex-1 overflow-y-auto` region and `<app-composer>` pinned after it. As a plain
block child of `main`, the host is `height: auto`, so the root's `h-full`
percentage resolves against `auto` and collapses — confirmed, and all three
consequences the doc lists follow.

`app-chat-panel { display: block; height: 100%; }` **does** resolve it, and
`main` needs nothing further: `main` is a flex item, but its `overflow-y-auto`
already makes its automatic minimum size zero, so the usual `min-h-0` remedy is
redundant here. What is left is not a collapse but an inset — `py-6` costs the
panel 3rem, so its pinned composer floats 1.5rem off the bottom of the scroll
region. That is a design call (drop the padding on the chat route, or accept the
inset), not the bug the doc is describing.

**§6.4 — no, extraction cannot preserve every hook implicitly. Four primitives
own the element the hook sits on.**

| Primitive | hooks on the owned element | spec-reached |
|---|---:|---:|
| `ErrorPanel` | **38** | 9 |
| `TextInput` | **36** | 15 |
| `Button` | **12** | 9 |
| `TableCell` | **12** | 4 |

86 hooks, 37 of them spec-reached, sit on the `<p>` / `<input>` / `<button>` /
`<td>` the primitive would absorb. A wrapping component puts `data-role` on the
*host* (`<app-text-input data-role="name">`), which still satisfies
`querySelector('[data-role="name"]')` — the host matches — but hands back an
`<app-text-input>` element, and the suite does not stop at matching:

- **43** casts to `HTMLButtonElement`, **25** to `HTMLInputElement`, 3 `HTMLSelectElement`, 1 `HTMLTextAreaElement`
- **37** reads of `.disabled`, **31** `.value =` assignments, **44** `dispatchEvent` calls, 2 `.checked =`
- [identifier-input.spec.ts:26](web-angular/src/app/registry/identifier-input.spec.ts#L26)
  asserts `input.tagName === 'INPUT'` outright

Eleven of the 36 `TextInput` hooks are also **interpolated** —
`[attr.data-role]="'litres-' + row.destination_id"`, `field()`,
`'amount-' + row.person.identifier` — so the primitive must take the role as an
input and re-emit it. §6 describes components and never mentions a role input.

The shape that survives all of this is an **attribute directive**
(`selector: 'input[appInput]'`, `button[appButton]'`) rather than a wrapping
component: the real element stays in the caller's template with its own
`data-role`, its own `[disabled]`, its own handler, and the directive contributes
only classes. `ErrorPanel` and `TableCell` can be components if they forward
`[attr.data-role]`. This is a deviation from §6's framing and should be recorded
before phase 2, not discovered during it.

**§9 guard test — feasible, and the sketch has one hole.** `templates.spec.ts`
already proves the mechanism: `import.meta.glob('./*.ts', { query: '?raw', import:
'default', eager: true })` at [templates.spec.ts:36](web-angular/src/app/registry/templates.spec.ts#L36),
chosen because the spec's tsconfig has no node types. Reading `styles.css` as raw
text works the same way — `'../../styles.css?raw'` from `src/app/registry/`, a
plain raw import or a one-entry glob; `?raw` bypasses the Tailwind/PostCSS
pipeline and returns the hand-maintained source, which is what the guard wants.

Excluding routed components is where the sketch fails. It says they *"are
identifiable from `app.routes.ts`'s `loadComponent` list"*. Thirteen registry
components are lazy, but **`RegistryShell` is not** — it is a static
`import { RegistryShell } from './registry/registry-shell'` used as
`component: RegistryShell` ([app.routes.ts:41,46](web-angular/src/app/app.routes.ts#L41)).
A `loadComponent`-only scan would flag `app-registry-shell` as an unlisted
non-routed component, and it is precisely the one the styles.css comment
singles out as carrying *"the flex/height chain the scroll container depends
on"*. The scan must read `component:` too. `app.routes.ts` also sits outside the
existing `./*.ts` glob and needs its own raw import.

With both fixed, the guard finds exactly one real gap today, which is round 1's
§3.3 unresolved: **`app-session-required`, 12 call sites, absent from the
`display: block` list** (25 registry selectors; 11 listed including `app-root`;
14 routed once `component:` is counted).

### 11.6 Still missed — three more

**a. `disabled:` variants stop matching, so the inert look has to be rebuilt.**
Once native `disabled` goes, `matches(':disabled')` is false (measured above), so
every `disabled:cursor-not-allowed`, `disabled:bg-farm-300` and
`disabled:opacity-40` silently stops applying. Tailwind 3.4.15 has no
`aria-disabled` variant out of the box; §6.3's "reduced contrast on both fill and
label" needs either `[&[aria-disabled=true]]:` utilities or a variant added to
the config. The document treats the disabled *appearance* as a restyle and never
notices the selector stops matching.

**b. Dropping native `disabled` removes the browser's click suppression from 19
sites.** Most handlers already re-guard — `start()` re-checks `canStart()`
([session-gate.ts:184](web-angular/src/app/registry/session-gate.ts#L184)),
`save()` re-checks `canSave()`, `submitPayment()` re-checks `canPay()`, and both
frozen forms carry belt-and-braces guards. One does not:
[destinations-list.ts:342](web-angular/src/app/registry/destinations-list.ts#L342)
`submitPrice()` guards `!d || !p` while its button also disables on
`priceState.submitting()`, so the double-submit the attribute was suppressing
becomes reachable. This is worth an audit of all 19 before phase 2, not after.

**c. 30 of the 37 `.disabled` assertions sit on Button call sites.**
`forms.spec.ts` 14 (11 `submit`, 3 `start`), `milking.spec.ts` 6,
`target.spec.ts` 5, `sales.spec.ts` 3, `payroll.spec.ts` 2. The remaining 7 are
inputs, a checkbox, two textareas and a calf-picker row, none of them Button
sites. §6.4 says the real risk is the 115 hooks and is *"far larger than the five
`className` assertions"* — true, but it misses this third population entirely,
and these are not cosmetic: `target.spec.ts:173-207` uses `start(e).disabled` to
pin that a session **cannot** be started against a real database before the
operator acknowledges it. Under `aria-disabled` that button is clickable and the
guarantee moves entirely into `start()`'s guard.

---

## Round 2 summary

Phase 1 is in better shape than round 1 left it: §3.1's twenty-one phase-1 values
are exact, §3.2's Light column is today's palette exactly, the three opacity
modifiers are still the only three, and the 358 / 957 / 54 / 115 / 92 / 12-tables
/ 98-cells / 19-buttons figures are all confirmed. It can be implemented as
written, with one caveat: §3.5 has no phase-1 column, so two certainty tokens
have no current value to be set to.

Phase 2 has a blocker (§11.3) and a shape problem (§11.5, §6.4). The blocker is
that §6.3's disabled-state rework changes the tab-stop count on both frozen
forms, which is what prediction 3 measures, and B1's "no field may be added"
does not reach a submit button. The shape problem is that four of the fifteen
primitives own the element 86 `data-role` hooks are attached to, and 68 casts to
concrete element types plus 37 `.disabled` reads plus one `tagName` assertion say
those four want to be attribute directives.

Neither is an argument against the direction. Phase 0 can be taken now — nothing
in it touches `src/` — and phase 1 is safe the moment §11.2's certainty-token gap
is closed. Phase 2 needs either the trial run or a B4.

---

# Phase 0 — baseline, 2026-09-08

Nothing in `src/` differs. This section is the record phase 1 is checked against.

## Suites

| Suite | Command | Result |
|---|---|---|
| Frontend | `npm test -w web-angular` | **281 passed / 281**, 26 files, 5.67 s |
| Server | `npm test -w server` | **726 passed / 726**, 4 suites, 0 fail / 0 skip / 0 todo |

Node `22.22.3` (`.nvmrc`; the default shell node is `22.3.0` and the Angular CLI
refuses it). `Not implemented: HTMLCanvasElement's getContext()` still prints
from `chart-card.spec.ts` and is not a failure.

## Screenshots — fourteen screens

`/private/tmp/claude-501/-Users-adnanali-personal-dairy-360/10f1d758-30dd-4215-9c1b-91f7b3a2c40d/scratchpad/shots/phase0/`

- **Viewport width: 1440 px**, fixed, every screen. Nominal height 900, `deviceScaleFactor: 1`.
- **Browser: Chrome 152.0.7977.76**, `--headless=new`, `--hide-scrollbars
  --force-color-profile=srgb --disable-lcd-text --font-render-hinting=none`.
- Captured with `Page.captureScreenshot` + `captureBeyondViewport`.

**The document never scrolls, so a naive full-page capture is the fold only.**
The shell is `flex h-full flex-col` and `<main>` is `overflow-y-auto`
([registry-shell.ts:145](web-angular/src/app/registry/registry-shell.ts#L145)), so
`Page.getLayoutMetrics` reports the viewport on every screen. The driver grows
the *viewport height* until `main.scrollHeight === main.clientHeight` and then
captures, so each PNG is a whole screen. Width is never touched. The first run
produced fourteen identical 1440×900 crops before this was noticed.

| File | Route | Captured | md5 |
|---|---|---|---|
| `01-today.png` | `/` | 1440×900 | `1e089d758a91d053c23e8c9f071c6bfa` |
| `02-herd.png` | `/animals` | 1440×1416 | `3de7de7d2f1dd411528c36ade16a2d0f` |
| `03-animal-detail.png` | `/animals/BD-0001` | 1440×1318 | `47842540f5ebd3e85b8268ce07d1f61e` |
| `04-milking.png` | `/milk/milking` | 1440×1085 | `72cc8d64ee9521e4e3841ef218d46b7c` |
| `05-dispatch.png` | `/milk/dispatch` | 1440×1014 | `d9d2e60498b42d92083f93e18bb2f4ca` |
| `06-buyers.png` | `/milk/buyers` | 1440×900 | `28e22a8360ece7eafa680b6b2235dac4` |
| `07-buyer-detail.png` | `/milk/buyers/dst_d5ba5757…` | 1440×966 | `d9f23a8bc12a6410c339aafe6020ca7a` |
| `08-payroll.png` | `/labour/payroll` | 1440×946 | `b1fa95623047eb953b3ddf659826d3f6` |
| `09-people.png` | `/labour/people` | 1440×1347 | `9ee2cb2bd56692c011a0eab3792bcece` |
| `10-person-detail.png` | `/labour/people/per_b9efa617…` | 1440×1085 | `ab87b1910d42ef91393d2802fc84e7ac` |
| `11-check.png` | `/check` | 1440×2246 | `ef0aa42b466c5bf11e67f417c814495c` |
| `12-chat.png` | `/chat` | 1440×900 | `4ccf4775c1a1f3f6a0a68b0d3bdb909f` |
| `13-animals-new.png` | `/animals/new` | 1440×1155 | `fd9b1adffd2c81e00879cd63f001b7ac` |
| `14-calvings-new.png` | `/animals/calvings/new` | 1440×1159 | `64c29682dcb5165dcc59e7fbc2b40bcc` |

## Fixture data and the "seed"

`npm run harness:app` — harness on 4000 (`:memory:`, `--empty`), Angular on 4200,
then `node scripts/harness-seed.mjs`. **83 writes.**

- **There is no numeric seed.** The harness seed is deterministic by
  construction: every write carries a fixed `Idempotency-Key` derived from its
  step name, so a re-run replays rather than duplicates. The identity of the
  fixture is the script at `816fe67` plus the run date.
- **It is date-relative, and that is the reproducibility catch.** `today()` and
  `dayAgo(n)` are `new Date()` formatted in `Asia/Karachi`
  ([harness-seed.mjs:66-70](scripts/harness-seed.mjs#L66)). Farm date for this
  baseline: **2026-09-08**. Screenshots taken on a different calendar day are not
  comparable to these.
- **Buyer and person IDs are per-run UUIDs**, so the three detail routes are not
  stable across harness restarts. This harness process was kept alive across
  phase 0 and phase 1. The IDs used: animal `BD-0001` (Noori, lactating), buyer
  `dst_d5ba5757-9850-48b5-9636-dd17acf609c3` (Bashir, dodhi), person
  `per_b9efa617-891d-46be-869f-35efd0bbc830` (imran, Rs 7,000 owed).
- Session: `direct_entry` / `adnan`. **It has to be driven through the gate.**
  `Session` persists nothing on purpose ([session.ts:18](web-angular/src/app/registry/session.ts#L18) —
  "the tripwire list for this cycle forbids local state that outlives a page
  load"), so the two `writes: true` routes cannot be reached by a page load at
  all: the shell renders `SessionGate` instead. The driver clicks
  `start-session`, picks the `direct_entry` chip, types `adnan`, clicks `start`,
  and thereafter navigates **client-side** (`pushState` + a synthetic `popstate`,
  which Angular's router acts on) so the in-memory session survives all thirteen
  in-shell screens. `/chat` is a top-level route and gets its own page load.

**One seed guard fired and was right to.** The first `harness:app` run left the
harness empty: a stale real dev server still held port 4000 when the seed polled,
the seed saw `storage=…/server/dairy.db memory=false` and **refused**, exactly as
designed. Re-running the seed against the confirmed `{"storage":":memory:","memory":true}`
harness succeeded. Worth knowing before phase 1's re-shoot.

## The three opacity modifiers

Read out of the compiled stylesheet (`http://localhost:4200/styles.css`, saved as
`styles.compiled.css`, 24,411 bytes) and out of `getComputedStyle`:

| Utility | Site | Compiled declaration | Computed | In the fourteen? |
|---|---|---|---|---|
| `border-farm-200/60` | [confirmation-card.ts:38](web-angular/src/app/components/confirmation-card.ts#L38) | `border-color: rgb(230 215 184 / 0.6)` | `rgba(230, 215, 184, 0.6)` | **no** |
| `bg-green-50/40` | [destination-detail.ts:99](web-angular/src/app/registry/destination-detail.ts#L99) | `background-color: rgb(240 253 244 / 0.4)` | `rgba(240, 253, 244, 0.4)` | yes — `07-buyer-detail` |
| `bg-farm-50/80` | [chat-panel.ts:24](web-angular/src/app/components/chat-panel.ts#L24) | `background-color: rgb(250 247 240 / 0.8)` | `rgba(250, 247, 240, 0.8)` | yes — `12-chat`, the header |

**`border-farm-200/60` is not reachable from any of the fourteen screens.**
`app-confirmation-card` renders only inside `chat-panel` when `store.pending()`
is non-empty ([chat-panel.ts:50](web-angular/src/app/components/chat-panel.ts#L50)) —
that is, only while an agent has proposed a write and is waiting for approval.
So the document's named phase-1 regression test is one-third unobservable by
screenshot. It is covered here at the CSS level instead, which is the stronger
check: `computed-colours.json` records the resolved value of **all 54 colour
utilities**, and phase 1 must reproduce every one.

Two of the 54 resolve to `rgba(0,0,0,0)` when probed bare, and this is correct
rather than a gap: `bg-farm-300` and `bg-farm-700` exist in the source **only**
as `disabled:bg-farm-300` and `hover:bg-farm-700`, so Tailwind's JIT never emits
the bare class. Their compiled variant forms are recorded instead —
`.disabled\:bg-farm-300:disabled { background-color: rgb(212 186 133 / var(--tw-bg-opacity, 1)) }`
and `.hover\:bg-farm-700:hover { … rgb(110 78 42 / …) }`.

`:root` carries **0 of the 21** core custom properties, confirming round 1's
"zero CSS custom properties anywhere in `src/`".

## One zero-delta risk phase 1 carries by instruction

`fontFamily.mono` is not an inert addition. `font-mono` is **already used at 34
sites across 18 files**, so redefining the stack rewrites a rule that is
currently rendering. Today's compiled value is Tailwind's default:

```
ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace
```

§3.6's stack adds `SF Mono` and drops `Monaco` and `Courier New`. On macOS
`ui-monospace` resolves first, so the rendered result should be identical here
and the screenshots will say so — but the declaration changes, and on a platform
without `ui-monospace` the fallback order genuinely differs. Recorded because
"nothing looks different" is true of this machine, not of the rule.

---

# Phase 1 — token layer, 2026-09-08

**Zero delta achieved, and measured three ways rather than eyeballed.**

## What landed

- `web-angular/src/styles.css` — a `:root` block of **48 custom properties** as
  channel triplets, ahead of the `html, body, app-root` rules.
- `web-angular/tailwind.config.js` — the semantic colour names, `darkMode:
  'class'`, `fontFamily.mono`. The `farm` ramp is **kept**, still literal hex.
  `plugins: []` unchanged; `@tailwindcss/forms` was not added.
- No `.dark` block. That is phase 3.
- Nothing in `src/app/` was touched — not one call site migrated. That is phase 2.

## Evidence of zero delta

**1. Fourteen screenshots, byte-identical.** Same harness process, same fixture,
same farm date, same viewport, same browser. All fourteen `md5`s match phase 0
exactly, including both frozen forms:

```
identical: 14   differing: 0
```

**2. The compiled stylesheet diff is exactly two things.** Fetched from
`http://localhost:4200/styles.css` before and after (24,411 → 25,862 bytes). The
whole diff is the `:root` addition plus the `font-mono` stack. **Not one colour
declaration changed** — every `farm`, red, amber, green, emerald and violet
utility compiles to the bytes it did before, because the `farm` ramp is still
literal hex and no call site moved.

**3. All 54 colour utilities resolve identically**, read back through
`getComputedStyle` in the live page (`computed-colours.json` in both shot
directories):

```
all 54 resolved colours IDENTICAL
```

The three opacity modifiers, the named regression test, are unmoved —
`rgba(250, 247, 240, 0.8)`, `rgba(240, 253, 244, 0.4)`, `rgba(230, 215, 184, 0.6)`.
`:root` went from **0 of 21** core properties to **21 of 21**.

**4. Suites unchanged:** 281/281 frontend, 726/726 server.

## The semantic names were checked against their twins, not assumed

Tailwind's JIT emits nothing for an unused class, so adding the semantic palette
produces **no new CSS at all** in phase 1 — which is why the stylesheet diff is
so small, and also why "the tokens work" is not something phase 1 can
demonstrate by rendering the app. Verified instead with a one-off `tailwindcss`
build over a scratch content file that uses each semantic utility beside its
existing counterpart, then comparing resolved channels and alpha:

```
semantic == existing:  51 of 51
```

Including all three opacity forms (`bg-surface-page/80` ≡ `bg-farm-50/80`, and
so on), which is the `<alpha-value>` contract actually working rather than
assumed. Two pairs needed a second look and both are identical:
`divide-divider` compiles to a compound selector (`.divide-divider >
:not([hidden]) ~ :not([hidden])`) carrying `rgb(var(--divider) / …)` = `243 236
220` = farm-100; and `decoration-certainty-rule` emits `rgb(var(--certainty-rule)
/ 1)` = `212 186 133` against `decoration-farm-300`'s literal `#d4ba85`, which is
the same colour written the other way.

## Two deviations from §3, both deliberate

**a. `--certainty-approx` is provisional, and labelled so in the file.** §3.5 has
no phase-1 column (§11.2 above), so unlike every other token this one has no
current value to be set to — its only tabulated value, `#82807A`, is a target
neutral. It holds `--text-subtle`'s channels as the nearest current analogue.
`--certainty-rule` by contrast *is* today's value: `212 186 133`, the
`decoration-farm-300` already in `people-list`. Nothing consumes either until
phase 5, so the layer is zero-delta regardless, but the provenance differs and
the comment says which is which.

**b. The seven unmapped utilities were left unmapped.** §11.2 lists them —
`bg-farm-800`, `bg-amber-200`, `bg-emerald-500`, `bg-red-500`, `bg-farm-400`,
`border-transparent`, `text-red-900`. §3 gives them no names and phase 1
implements §3, so no tokens were invented for them. They render unchanged
through the retained `farm` ramp and the literal palette. **Phase 2 cannot
migrate the sites that use them until §3 grows the names**, which is a real
prerequisite rather than a detail: `tool-call-chip`'s two status dots and
`session-bar`'s harness banner have nowhere to go.

## The one thing that did change, by instruction

`fontFamily.mono`. The diff:

```
-    ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace
+    ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace
```

Rendered identically here — all fourteen screenshots are byte-identical, so
`ui-monospace` is resolving first on this machine and the change is invisible, as
predicted in the phase-0 record. Two things to carry forward:

- **It appears twice in the compiled output, not once.** The `.font-mono` utility
  at line ~922, and Tailwind's **preflight base rule for `code, kbd, samp, pre`**
  at line ~175. So this also restyles markdown code spans and blocks in the chat
  panel, which `.prose-chat code` and `.prose-chat pre` sit on — a surface none of
  the 34 `font-mono` call sites covers, and one §8.2 is separately going to touch.
- On a platform without `ui-monospace` the fallback order genuinely differs
  (`Monaco` and `Courier New` are gone). Invisible on macOS is not invisible.

## Document housekeeping

- `docs/UI_SYSTEM_DESIGN.md` **deleted** — it was a byte-identical duplicate of
  `docs/UI_SYSTEM.md` (§10 above). Nothing cited it.
- `docs/UI_SYSTEM.md` **kept in place** with a status line replacing the old
  "specified, not implemented" and the now-satisfied "Intended home" paragraph:
  phases 0–1 built, phase 2 blocked and why, plus a pointer here for the five
  counts its body still gets wrong.
- `docs/README.md` — added to the **Reference** table, after `REGISTRY_ENTRY_UX.md`.
- **No `docs/archive/UI_SYSTEM_PLAN.md` was created.** There is nothing to
  archive: the plan was never committed to any ref, so the only way to produce
  the file would be to reconstruct a document from its critic's quotations and
  present it as the original. Round 1 now carries a note saying its subject is
  gone and its `docs/UI_SYSTEM.md` links resolve to the successor.
- The **Archive** table is unchanged, for the same reason.

---

# Phase 2 — primitives, 2026-09-08

**All fifteen landed. Class strings 358 → 293, occurrences 957 → 614, all 115
hooks intact, 284/284 and 726/726 green.**

## The decision that unblocked this

§11.3 above is unchanged and still true: §6.3's disabled state adds a tab stop to
both frozen forms, and prediction 3 of the five-animal trial is pre-registered on
that count. It was raised before starting and the call was to **build the design
system now and read the trial against the built system**, using the harness
fixture to understand the shape of the forms in the meantime, with any
improvement found in live use folded back into this document and its
implementation afterwards.

So the tab-stop change is **deliberate and recorded, not worked around**. It is
written into [button.ts](web-angular/src/app/ui/button.ts)'s header so the trial
report is read knowing the baseline moved — the same treatment
`REGISTRY_ENTRY_UX.md` §11 already gives its two pre-trial contaminations. What
the trial now measures on `/animals/new` is nine tab stops in the empty state,
not eight, and a submit that is reachable while inert.

**The form shapes here are harness shapes.** Every screenshot and every density
judgement in this phase rests on `scripts/harness-seed.mjs` fixture data at farm
date 2026-09-08 — 31 animals, 5 buyers, 3 people. It exercises every table and
both forms, but it is not the backfill: no murky-date animal, no long calving
history, no 31-row roster typed by hand. Row counts, column widths and the
compact/comfortable assignment in §4 are therefore **proposed against fixtures,
not derived from use**, which is the same caveat §12 already carries.

## Fifteen directives, not fifteen components — the one structural deviation

§6 describes components. All fifteen are **attribute directives**, in six files
under [ui/](web-angular/src/app/ui/). The reason is §11.5's measurement: 86 of
the 115 hooks sit on the exact element a primitive would absorb, and the suite
does not stop at matching a selector — 68 casts to concrete element types, 37
`.disabled` reads, 31 `.value =` assignments, 44 `dispatchEvent` calls, and
`identifier-input.spec.ts:26` asserting `input.tagName === 'INPUT'`, a test whose
whole point is that the control is an input with a datalist rather than a select.
A wrapping component fails that one by construction, and a `<td>` is the only
child a `<tr>` accepts.

A directive keeps the element, its attributes, its bindings and its handlers
where they were and contributes only classes. Angular merges a host `[class]`
binding with the template's static `class` — measured before relying on it — so
call sites keep positional classes (margins, widths) and give up only what the
primitive owns. **Zero hooks needed rewriting, including the 21 interpolated
ones** (`[attr.data-role]="'litres-' + row.destination_id"`).

| # | Primitive | File | Sites collapsed |
|---|---|---|---:|
| 1 | `Cell` | `ui/cell.ts` | 98 |
| 2 | `HelpText` | `ui/text.ts` | 71 |
| 3 | `TextInput` | `ui/input.ts` | 45 |
| 4 | `FieldLabel` | `ui/text.ts` | 28 |
| 5 | `ErrorPanel` + `ErrorText` | `ui/surface.ts` | 26 + 11 |
| 6 | `Card` | `ui/surface.ts` | 26 |
| 7 | `Button` | `ui/button.ts` | 19 |
| 8 | `SubHeading` | `ui/heading.ts` | 17 |
| 9 | `SectionLabel` | `ui/text.ts` | 18 |
| 10 | `PageHeading` | `ui/heading.ts` | 14 |
| 11 | `TextLink` | `ui/text.ts` | 14 |
| 12 | `SectionHeading` | `ui/heading.ts` | 12 |
| 13 | `RowDivider` | `ui/surface.ts` | 10 |
| 14 | `StatusBadge` | `ui/surface.ts` | 3 of 6 |
| 15 | `SummaryBar` | `ui/surface.ts` | 2 of 3 |

`NotePanel` was not created. Its eight sites are stat tiles inside
`verification-panel` and remain a local `@for`.

## The metric

| | before | after |
|---|---:|---:|
| Distinct whole-attribute class strings | **358** | **293** |
| Total occurrences | **957** | **614** |
| …of which occur exactly once | 230 | 209 |
| Distinct table-cell class strings | **31** | **3** |
| Four competing cell padding scales | 44 / 34 / 12 / 7 | two densities |

**−65 distinct (−18%) and −343 occurrences (−36%).** The occurrence figure is
the honest one: 343 hand-written class attributes stopped existing. The distinct
count moves less because **209 of the surviving 293 occur exactly once** and are
layout, not appearance — `flex flex-wrap items-end gap-3`, `mx-auto max-w-4xl
space-y-6`, `mt-2 space-y-1`. No primitive collapses those, which is round 1's
own point about this metric having a floor.

What is left repeated is mostly **bare colour utilities**: `text-farm-600` ×22,
`text-farm-900` ×17, `text-farm-500` ×15, `font-medium text-farm-900` ×15. These
are colour-only spans, not primitives, so §6 does not reach them and they were
left alone. **This matters for phase 4**: §3's promise is that re-pointing layer 2
makes "the whole app follow from one file", and it cannot while ~100 call sites
still name `farm` stops directly. Migrating them is mechanical and zero-delta,
and it should be scheduled before phase 4 rather than discovered during it.

## The one regression, and how it was caught

**Not by a test.** After the twelve non-button primitives landed, all fourteen
screenshots differed — 263 pixels on `/`, confined to 14 rows, `77 55 34` where
`138 100 49` belonged. The ten nav links carry
`routerLinkActive="font-medium text-farm-900"` over a base of `text-farm-600`, so
two colour utilities land on the active link and **the winner is decided by their
order in the compiled stylesheet, not by the template**. That worked because
Tailwind emits a ramp in ascending stop order. Renaming the base to
`text-content-muted` put it in a different group that lands last, and the active
nav item silently lost its highlight.

Fixed by making the precedence explicit — `routerLinkActive="font-medium
!text-content-primary"` — rather than by reordering config keys, which would have
restored the same invisible dependency. Same rendered colour as before. **The
fragility predated this phase**; renaming only exposed it.

This is the argument for the pixel diff over the hash: a byte comparison says
"different", and a 263-pixel/14-row answer says where to look. Every subsequent
step was checked the same way.

## Button — the sanctioned appearance change

One radius (`rounded-lg`, the middle of three), one fill (`bg-brand` = farm-600,
so payroll, the people list and the person record stop being farm-800), one
hover, one disabled state. `aria-disabled` replaces the native attribute, with
`aria-describedby` pointing at the existing reason text at the six sites that
have one — those notes gained an `id`; their wording is untouched.

**The two lookalikes were not swept in.** `message.ts:16`, the user's chat
bubble, keeps its own classes and does not import `Button`. `confirmation-card`'s
brand-filled pill is a badge and took `StatusBadge`, which is what it is.
`composer.ts` keeps `outline-none focus:border-farm-500` — the deliberate border
shift, not reinstated as an outline.

**Where the refusal now lives, measured rather than assumed.** Dropping the
native attribute means the browser stops suppressing the click, so activation is
refused in two places and which one works depends on the button:

- `type="submit"` (15 of 19) — the directive's `preventDefault` cancels the
  click, which cancels the form submission. **This is the primary defence**, and
  it was measured: with the handler guard removed the suite still passes, and
  only when `preventDefault` goes too does the new `target.spec` test fail.
- `type="button"` with a template `(click)` (payroll's save) — host and template
  listeners on one element have no guaranteed order, so the **handler guard** is
  the only defence.

All 19 handlers were checked one by one.
[destinations-list.ts:361](web-angular/src/app/registry/destinations-list.ts#L361)
`submitPrice()` was the single one that re-checked only half of its button's
condition — it tested `pricePreview()` but not `submitting()` — and now re-checks
both. The idempotency key survives an in-flight attempt so the double submit was
a replay rather than a duplicate rate, but it was still a second request nobody
asked for.

`animal-form`'s guard turned out to be enforced by the **type system**: removing
`if (a.status !== 'complete' …)` fails compilation, because it is what narrows
`DateEntry` to the branch carrying `.value`. Stronger than a test, and worth
knowing before anyone "simplifies" it.

## Specs

**30 assertions converted**, exactly the population §11.6c predicted:
`forms.spec.ts` 14, `milking.spec.ts` 6, `target.spec.ts` 5, `sales.spec.ts` 3,
`payroll.spec.ts` 2. Each `expect(x.disabled).toBe(true)` became
`expect(x.getAttribute('aria-disabled')).toBe('true')`, and `false` became
`.toBeNull()`. None was deleted.

**Seven were deliberately left native** and are not Button sites: two textareas
(`chat-panel`, `composer`), three inputs (`payroll` ×2, `milking`'s cell), a
checkbox (`precision-date`), and `calf-picker`'s candidate rows.

**Three tests added**, because the guarantee that used to be the browser's is now
the code's:

- `target.spec.ts` — a blocked `start` that is clicked anyway opens no session.
  Verified to fail by reverting **both** defences; either alone still passes,
  which is why the assertion is on the session and not on the attribute.
- `forms.spec.ts` — a blocked submit that is clicked anyway sends nothing.
- `forms.spec.ts` — the blocked submit points at its reason by `id`, and that
  element is the existing `data-role="blocked"` note.

Frontend went 281 → **284**. `templates.spec.ts:128` still passes: no
`provenance()` call moved, and nothing in `ui/` contains one, so the
registry-only glob is unaffected. The five `className` assertions were untouched
and still pass; `chart-card.spec.ts:31` is still phase 3's problem.

## Screens whose appearance changed

Diffed against the phase-1 baseline with a per-pixel comparison.

| Screen | Change | Sanctioned by |
|---|---|---|
| `01-today`, `02-herd`, `03-animal-detail` | **byte-identical** | — |
| `04-milking`, `05-dispatch` | 138 px, 24 rows — submit radius only | §6.3 one radius |
| `06-buyers` | 4,863 px, 36 rows — two submits | §6.3 |
| `07-buyer-detail` | height 966 → 990 — 7 cells `px-4 py-1.5` → `px-3 py-2` | §6.2 |
| `08-payroll` | 3,088 px, 36 rows, maxΔ=47 — save farm-800 → farm-600 | §6.3 one fill |
| `09-people` | 7,460 px, 72 rows — two buttons | §6.3 |
| `10-person-detail` | 5,008 px, 36 rows — two buttons | §6.3 |
| `11-check` | height 2,246 → 2,438 — 30 cells `py-1` → `px-3 py-2` | §6.2 |
| `12-chat` | 2,576 px, 40 rows — composer send + approve-all radius | §6.3 |
| `13-animals-new`, `14-calvings-new` | 3,747 / 4,646 px, 36 rows — the disabled submit | §6.3, and the trial cost above |

Every difference is confined to 24–72 rows around a button, or to the two tables
whose padding scales §6.2 deletes. Nothing else moved.

## Costs and remainders

- **The initial bundle grew 527.98 → 534.49 kB** (+6.5 kB raw, 145.84 kB
  transferred). Fifteen directives are code where hand-written strings were
  markup. The 500 kB budget was already exceeded before this phase (by 27.98 kB,
  now 34.49) — the warning is pre-existing, the increment is not.
- **`StatusBadge` collapsed 3 of 6 and `SummaryBar` 2 of 3.** §12 asked whether
  the six badges can share one primitive: three can. `event-list`'s superseded
  marker (different radius, different stop, no `rounded-full`), the amber "not
  billed" tag and the small `bg-farm-100` aside cannot without a visible change,
  and two of the six carry their own TypeScript colour logic. `SummaryBar`'s
  third site is a `<footer>` with different padding and no flex.
- **`ErrorPanel` covers 26 of 35 sites.** `verification-panel`'s `text-red-900`
  has no token in §3 to map onto, and `chat-panel`'s bordered `rounded-md`
  variant is a third radius. Both are real inconsistencies whose fix is visible,
  so they need a decision in §3 rather than a quiet normalisation here.
- **§4's help-prose demotion was not applied.** It is a real visual change
  (`text-sm` → `text-xs`, a 65ch measure) that §10 assigns to no phase. Both
  current sizes are preserved as variants.
- **`numeric` does not add `font-mono tabular-nums` yet.** Monospace figures are
  phase 4; adding them here would have put a third change into this phase.
- The four `<thead>` elements sharing `SectionLabel`'s class string were skipped
  deliberately — a directive named for a label does not belong on a table head.

---

# Phase 4 — the neutral re-point, 2026-09-08

**The app is no longer beige.** Phases 1 and 2 existed so this could be one
file's edit, and it was: 35 values in `:root`, plus deleting the ramp.

Run **out of §10's order** — 4 before 3 — because the recolour is what the work
was for and dark mode is a larger separable job. Phase 3 is untouched.

## What moved

| | |
|---|---|
| §3.1 core tokens | 21 → Target light. Greys `#F7F7F5`…`#1A1917`, brand a clay `#A9603C` |
| §3.3 agent ramp | 9 values. **`vendor` leaves amber for blue** — the collision §3.3 called "the point" |
| §3.5 certainty | 4 values, now genuinely §3.5's own rather than phase-1 provisionals |
| `--mark-pending` | farm-400 → `#A8A69E` |
| §3.2 roles | **unchanged.** Its Light column was already today's Tailwind palette |
| §3.4 write-log | **unchanged, per B3** — see below |
| `farm` ramp | **deleted** |

**B3 is visibly working.** The write-log bar keeps `--writelog-bg/-fg/-line` at
their original greens while every surface around it turned neutral. That is only
possible because §3.4 gave it its own three tokens instead of the `success`
role — and because the token migration split `--success-strong` and
`--success-line-soft` off as separate names holding identical values. One token
per value would have meant re-pointing the bar along with everything else, which
is exactly what prediction 5 is pre-registered against.

**Deleting the ramp is how the migration is proved, not assumed.** Any missed
call site would have failed the build loudly rather than quietly rendering the
old beige. `src/` now holds zero `farm` references; the only palette literal
anywhere is `border-transparent`, a Tailwind built-in. Zero occurrences of
`farm` in the compiled stylesheet.

## Monospace figures

`Cell`'s `numeric` prop now adds `font-mono tabular-nums whitespace-nowrap`,
held back from phase 2 only because that phase's acceptance was that nothing
moved except the button and cell padding. Eight money figures outside tables
(person-detail, payroll-run) and four amount inputs took `font-mono` too.

Two refinements the specification does not mention, both found by rendering:

- **A numeric `<th>` gets the alignment but not the face.** A header is a word —
  "Days", "Recorded", "Rate today" — and setting words in a figure font makes a
  table look like a terminal.
- **`whitespace-nowrap` comes with `numeric`.** A figure that wraps is worse than
  one that overflows, because the eye reads the fragment as a smaller number.

## The one layout consequence, and the wrong fix for it

Mono is **wider**, and on the dispatch sheet that cost 48px: the rate column
`Rs 7,000.00 / 40 L` grew, table layout took the width off the litres cell, and
its `flex-wrap` row dropped the "already saved" note onto a second line.

The fix was **not** to drop mono. The rate is a composite label, identical in
every row — nothing anybody scans down a column — so it takes right-alignment
without the face. The AMOUNT column next door keeps both, because rupees are
exactly what §4 wants monospaced. **0 of 14 screens reflow** against the
pre-phase-4 capture.

Worth recording how nearly this went wrong: an intermediate measurement said the
48px had *not* been recovered, and the comment written into `dispatch-sheet.ts`
said so and blamed the amount column. That measurement was taken against a
**broken build** — see below — so the dev server was serving stale CSS. The
comment was wrong in the tree for two commits' worth of work and is now
corrected. A screenshot is only evidence if the thing that produced it compiled.

## chart-card: ten hex literals the migration could not reach

Chart.js takes colour **strings**, not classes, so this file never went through
the token migration and phase 4's re-point could not touch it. Left alone it
would have held the only old-palette values left in `src/` — brown lines and
beige gridlines on a neutral card, visible the moment the agent returns a
dataset (it renders only inside `message.ts`, so no fixture screen shows it).

The literals were re-pointed **by hand** and `chart-card.spec.ts:31` updated to
match. **That is the defect, not the fix.** §8.1's `chartTheme()` factory, which
reads the custom properties, is phase 3 and is also what dark mode requires; a
hand-copied hex cannot follow a toggle and will drift from `:root` the first time
somebody edits one and not the other. The spec still pins a hex by exact
equality, which is precisely why §8.1 says theming this file "breaks it on day
one".

## I hit the bug templates.spec.ts was built for, and the guard could not fire

Writing that dispatch-sheet comment, I put backticks around `numeric` and
`flex-wrap` **inside a `template:` literal** — the exact mistake
`REGISTRY_PAYROLL.md` §16.3 records as having cost four occurrences over three
cycles, and which `templates.spec.ts` was built to catch. It produced eleven
TypeScript errors pointing at lines nowhere near the cause, as advertised.

**The guard never ran.** A stray backtick inside a template literal is a
*compile* error, so `ng test` fails at the build step and the spec that would
have named the file and line never executes. The guard can only fire for the
subset of stray backticks that still produce parseable TypeScript. That is a real
gap in a check whose whole stated purpose is that "the failure has to name the
file and the line so it is fixed in seconds rather than bisected" — it is
worth either moving to the server suite (which the header explicitly considered
and rejected for workspace reasons) or running it as a lint step ahead of the
build.

## Verification

- **284/284** frontend, **726/726** server, production build clean (534.23 kB,
  +0.26 kB against phase 2).
- **0 of 14 screens reflowed** — the recolour changed no layout.
- The three opacity modifiers still resolve through the tokens:
  `rgb(var(--surface-page) / 0.8)`, `rgb(var(--success-bg) / 0.4)`,
  `rgb(var(--border-subtle) / 0.6)`. The `<alpha-value>` contract held through a
  re-point, which is the thing channel triplets were chosen for.
- `--writelog-fg` still `20 83 45`; `--fill-brand` now `169 96 60`.

## What phase 3 still owes

Skipped, not done: the `.dark` block and the three-way toggle, `chartTheme()`,
`.prose-chat`'s three `rgba(0,0,0,…)` values and its unstyled `h1`–`h3` /
`blockquote` / `a` / `hr` / `pre` / `del` / nested lists, focus rings on every
interactive primitive (without reinstating an outline on `composer.ts`), and
`aria-live` on streaming chat output. §12's **dark** values have still never been
rendered by anyone.

---

# Phase 3 — dark mode, and the two guards, 2026-09-08

Run **after** phase 4. **294/294** frontend (287 → 294), **726/726** server,
production build clean. Both modes rendered on all fourteen screens; layout is
byte-for-byte identical between them.

## Two guards first, both cheap and both overdue

**`app-session-required` is in the `display: block` list.** 12 call sites, absent
for its whole life, seven of them outside a flex parent — round 1's §3.3, and the
exact latent case the list's own comment warns about ("fails silently and looks
like a spacing bug").

**The backtick guard can now fire.** §11.6 recorded that
`templates.spec.ts`'s check *cannot* catch what it was built for: a stray
backtick inside a `template:` literal is a **compile** error, so `ng test` dies
at the build step and the spec never runs. It is now also
`scripts/check-templates.mjs`, run by `npm run check:templates` **before** the
typecheck and both builds in CI.

The header of `templates.spec.ts` had rejected two homes — `node:fs` (no node
types in its tsconfig) and the server suite ("a check on frontend sources in the
wrong workspace"). Both are right. `scripts/` is the third option it did not
consider: not a workspace, already home to `harness-seed.mjs` as
explicitly-not-application-code, and node types simply available. It covers
`src/app/**` rather than the spec's registry-only `./*.ts`, so `components/` is
protected for the first time.

**It caught two real cases within a minute of existing** — both in comments I
was writing for this phase, in `registry-shell.ts` and `theme-toggle.ts`. It
then caught a third in `dispatch-sheet.ts` later the same session. The spec keeps
its copy, because it also asserts the check *fires*, which is what stops either
implementation rotting into a function that reports clean forever.

## Dark

55 tokens in a `.dark` block: every Dark column in §3.1–§3.5, verbatim. Seven
had **no** Dark column — the ones added during the token migration, after §3 was
written — so their dark values are **derived** and flagged in the file as the
least-verified thing in it.

Three things worth recording about the values:

- **Surfaces do not invert symmetrically.** Dark needs less separation between
  page/raised/sunken than light does to read as distinct, so these are not the
  light set flipped.
- **`--text-on-fill` goes dark** (`#20120A`). The brand lightens to `#C88356` in
  dark, and white on it fails contrast.
- **The write-log bar moves, and B3 permits it.** B3 freezes the bar's contrast
  *relative to its surroundings*, not its hex — a bar still at `#f0fdf4` on a
  `#141413` page would be a white slab. §3.4's dark values are "matched for
  perceived contrast rather than mapped from the light set", which is the same
  instruction. It keeps its own three tokens, so it can still be held while
  everything else moves.

**The toggle is three-way** (system / light / dark), persisted, class on
`<html>`, `color-scheme` set per mode — which is the half that makes the
browser's own scrollbars, the eleven date pickers and the five selects follow.
Without it a dark page opens a white calendar over itself.

`core/theme.ts` persists to `localStorage` while `session.ts` refuses to persist
anything. **That is not drift** and the file says so: session's rule is about
*provenance*, and a remembered `recorded_by` mis-attributes a record. A
remembered theme cannot. `theme.spec.ts` pins the behaviour, including that a
junk stored value (`banana`, and also `Dark`) is refused rather than passed
through to `classList.toggle`.

**The toggle's placement cost 34px before it cost nothing.** First added to the
header's wrapping flex row with `ml-auto`; the nav is ten links and already wraps
to a second line, so the toggle wrapped to a **third** — +34px on twelve of the
fourteen screens, permanently, for one control. The header is two explicit rows
now (title + toggle, then nav), which costs **+2px** — the toggle's box is 2px
taller than a bare `h1` at baseline. The trade is that the toggle became the
header's first tab stop rather than its last. One extra Tab against 34px on
every screen is the better half of that trade, but it is a trade.

## `chartTheme()` — and `chart-card.spec.ts:31` is finally resolved

Ten hex literals became ten token reads. §8.1 was right on every count, and the
two obstacles it named were both real:

- **The `rgb()` wrapper is not optional.** `getComputedStyle` returns
  `169 96 60` — the channel triplet `<alpha-value>` forces — which Chart.js
  cannot parse. It fails as a silently un-themed chart, not as an error.
- **`options` had to become a `computed()`.** As a plain field it was a stable
  reference, so `BaseChartDirective` never saw a change and the axes would have
  kept their first colours forever while the datasets re-rendered.

The re-render works by reading `theme.resolved()` and discarding it — that line
is the whole mechanism, and without it the token reads would be correct and
would simply never run again.

**The spec no longer pins a hex.** `chart-card.spec.ts:31` — round 1's §3.1,
which §8.1 called the reason "any theming breaks it on day one" — now asserts
that the value comes *from* the custom property and arrives *wrapped*. Three
tests replaced the one line: the token read, the re-resolve on a theme change
(asserted on the config object, because jsdom has no 2D context), and the
`currentColor` fallback for a missing token, which is the state the unit suite
itself runs in.

## Markdown — and the rules were unobservable, so they were rendered deliberately

The three `rgba(0, 0, 0, …)` values are tokens. All three were invisible over a
dark surface: black at 6% on `#1C1B1A` is black on near-black.

The elements §8.2 found falling through preflight are styled: `h1`–`h3` (three,
not six — `ALLOWED_TAGS` in `markdown-view.ts` permits no more, so rules for
`h4`–`h6` would be dead code that reads like coverage), `blockquote` with a
leading rule rather than an indent alone, `a`, `hr`, `pre` (with `pre code`
neutralised so a block does not get the inline treatment inside it), `del` —
which was missing from §8.2's own list — `em`, and nested list markers at
disc → circle → square.

**None of this is visible on any of the fourteen screens**, because no fixture
produces an assistant reply — the same blind spot as `border-farm-200/60`. So it
was rendered on purpose: a throwaway bubble containing every styled element,
screenshotted in both modes (`shots/markdown-light.png`, `markdown-dark.png`).
Everything reads.

## Focus, and the one place §7 is not followed literally

§7 asks for `--focus-ring` on every interactive primitive. **Inputs get a border
shift instead**, and that is deliberate: `composer.ts` traded the native outline
for `focus:border-…` as a recorded decision, and §7 itself says to keep that and
not reinstate an outline there. A ring on every *other* input would leave the app
with two focus languages for one element type, with the most-used control the odd
one out. Buttons and links take the ring, because they have no border to shift.
`ring-offset-surface-page` is set with it — an offset without a ground colour
paints white on a dark page, which is the usual way a ring looks broken in dark.

## `aria-live` on the chat, which is not what §7 literally asks for

§7 says "add to streaming chat output". Wrapping the stream in a live region is
the wrong reading: `aria-live` re-announces its region on every mutation, and a
token-by-token stream mutates dozens of times per reply — a screen reader would
restart the answer on every token and finish none of them.

So it announces the **transitions** — working / waiting for approval / answer
ready / failed — and leaves the prose to be read on demand, which is how anybody
reads an answer. Same shape as the registry's write log, counter included so two
identical statuses in a row still re-announce. `pending` is checked before
`loading`, because an agent proposing a write is the one state where the operator
must act and must not hear "answer ready".

## `prefers-reduced-motion`

§7 listed it as "not referenced", and it was: the "Thinking…" pulse animates
indefinitely while the model streams. Honoured as a blanket rule so anything
added later is covered by default, at `0.01ms` rather than `0` — some browsers
skip `transitionend`/`animationend` entirely at zero, and code waiting on those
events then hangs.

## What is left

- **Phase 5** — the certainty vocabulary. Tokens exist and nothing consumes them.
  Acceptance is that the four states are distinguishable **in greyscale**. Note
  §11.4: this is where the unanswered calf-sex chip goes amber, and that is one
  of the two predictions expected to feel *better*.
- **Phase 6** — the chat fold-in, and the `display: block` guard test §9 sketches
  (whose exclusion list must read `component:` as well as `loadComponent`, or it
  flags `app-registry-shell`).
- **Phase 7** — B1, B2, B3 and layout, after the trial.
- The primitive remainders from §11: `StatusBadge` 3 of 6, `SummaryBar` 2 of 3,
  `ErrorPanel` 26 of 35, and §4's help-prose demotion, which §10 still assigns
  to no phase.
- The seven derived dark values, which nobody has checked against the light set
  by eye.
