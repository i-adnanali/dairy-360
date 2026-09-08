# UI system — the design system

*Status: **phases 0, 1, 2 and 4 built. Phase 3 is not.** Specified against
`816fe67`. The token layer landed with zero visual delta; the fifteen primitives
landed as attribute **directives** rather than components (class strings 358 →
293, occurrences 957 → 614, all 115 `data-role` hooks intact); then every call
site moved onto the semantic names, and §3.1's Target light column went in. The
`farm` ramp is **deleted** — `src/` holds zero references to it — so the three
layers §3 describes are now two.*

*The app is no longer beige. Phase 4 is the commit where that happened, and
phases 1 and 2 existed to make it a single file's edit.*

***Phase 3 was skipped, not completed.*** Dark mode, the `.dark` block,
`chartTheme()`, the markdown surfaces and the focus rings are all still
outstanding, and `chart-card.spec.ts:31` still pins `#8a6431` by exact equality
— a literal that no longer appears anywhere else in the app. §10's order was 3
then 4; it was run 4 then 3 because the recolour is what the work was for and
dark mode is a larger, separable job. Read §10 knowing one row is out of
sequence. §12's **dark** values remain unrendered by anyone.*

*Three items remain **BLOCKED** on the five-animal trial, and B3 is visibly
doing its job: the write-log bar keeps its own three tokens at their original
green while every surface around it turned neutral.*

*One cost was accepted knowingly rather than avoided. §6.3's disabled state drops
the native attribute so `aria-describedby` can reach the reason text, which puts
the blocked submit back in the tab order: `/animals/new` now has nine tab stops
in the empty state rather than eight. `REGISTRY_ENTRY_UX.md` §11 prediction 3 is
pre-registered on that count and §2's B1 freezes fields, not buttons, so nothing
in the trial gate caught it. The decision was to build the system now and read
the trial against the built system. Treat it as a third entry alongside the two
contaminations §11 already documents.*

*Counts in §1, §4 and §6 were re-read from the code and **five are still wrong**
(they were implemented against the code, not against these figures):
§6.2's padding buckets measure 44/34/12/7 over 31 distinct cell strings (and do
not sum to 98 as printed), §6.3 has eight variants rather than seven, §6.4's
TextInput figure counts two of seventeen strings against a real 45, and
`querySelector` is 340 rather than 325. The corrections, and the phase-2 blocker
in full, are in [../UI_SYSTEM_VALIDATION.md](../UI_SYSTEM_VALIDATION.md) under
`Round 2`. Trust that file over this one where they disagree, until the body
here is refreshed.*

---

## 1. What this is

The app is not badly themed. It is **untokenised and drifted**: one custom
Tailwind ramp, no dark mode, zero CSS custom properties, and 358 distinct
whole-attribute class strings across 957 occurrences for what is about fifteen
visual primitives.

The design idea is that **certainty is the app's primary visual variable**. Every
screen distinguishes measured from approximate, observed from recalled, answered
from deliberately-blank — and today they are all the same beige. §5 gives that
axis a treatment; everything else exists to make it expressible.

**Correction to the earlier draft.** That draft claimed presentation was decided
entirely in templates. It is not. Six TypeScript methods build class strings —
`tool-call-chip.chipClass()`, `.dotClass()`, `message.agentClass()`,
`chip-group.chipClass()`, `dispatch-sheet.noneClass()`,
`milking-roster.chipClass()` — and `agentClass()` is a four-arm status→class map.
Three hold `base` string constants. Tokenisation has a TypeScript surface.

## 2. BLOCKED — awaiting the five-animal trial

Three items, and only these. Everything else in this document proceeds now.

| # | Blocked | Prediction | Rule until the trial reports |
|---|---|---|---|
| B1 | Field order and count on `/animals/new`, `/animals/calvings/new` | 1 (`acquired_from` in the tab path), 3 (ten tab stops, half empty) | No field may be added, removed or reordered on either form |
| B2 | Visual differentiation of the two adjacent `date-text` fields | 2 (overshooting arrival into birth) | Both keep identical placeholders and identical treatment. §11 says the fix "is not obvious, which is why it was not applied blind" — differentiating them blind destroys the read |
| B3 | Relative prominence of the write-log bar | 5 (announcement too quiet) | [registry-shell.ts:112](../web-angular/src/app/registry/registry-shell.ts#L112) keeps its current contrast against its surroundings. It may be tokenised at equal contrast; it may not be made louder or quieter |

**B3 needs care.** §4's `success` role is `green-800`; the bar is `text-green-900`
on `border-green-200`. Mapping it onto the role makes it *lighter* — quieter —
which is the exact axis prediction 5 measures. The bar therefore gets its own
tokens at its own values (§3.4), not the `success` role.

Predictions 4 (dam surviving between calvings) and 6 (`Cmd+Enter`) are behavioural
and constrain nothing here.

Everything else — tokens, primitives, buttons, cells, spacing, dark mode, the
certainty vocabulary — applies to the two forms exactly as to every other screen.
There are no `legacy` variants and no component-level freeze.

---

## 3. Token vocabulary

Three layers. Components read layer 3 only.

- **Layer 1** — primitives: the existing `farm` ramp plus a `neutral` ramp and a
  `clay` accent, declared as channel triplets in `:root`.
- **Layer 2** — the ramp indirection. Phase 1 points it at `farm` so nothing
  changes; phase 4 re-points it at `neutral` and the whole app follows from one
  file.
- **Layer 3** — semantic names. The only thing templates use.

### 3.1 Core tokens

`Phase 1` values are exact current hexes — zero visual delta, verified stop by
stop. `Target` is where phase 4 lands.

| Token | Phase 1 (= today) | Target light | Target dark |
|---|---|---|---|
| `--surface-page` | `#faf7f0` | `#F7F7F5` | `#141413` |
| `--surface-raised` | `#ffffff` | `#FFFFFF` | `#1C1B1A` |
| `--surface-sunken` | `#f3ecdc` | `#EFEEEB` | `#232220` |
| `--text-primary` | `#4d3722` | `#1A1917` | `#F0EFEA` |
| `--text-heading` | `#5b4026` | `#2E2D2A` | `#E8E6E0` |
| `--text-secondary` | `#6e4e2a` | `#4A4844` | `#C4C2B9` |
| `--text-muted` | `#8a6431` | `#63615C` | `#9E9C93` |
| `--text-subtle` | `#a87d3e` | `#82807A` | `#7C7B74` |
| `--text-disabled` | `#c29b5c` | `#A8A69E` | `#57564F` |
| `--text-on-fill` | `#ffffff` | `#FFFFFF` | `#20120A` |
| `--border-hairline` | `#f3ecdc` | `#EFEEEB` | `#232220` |
| `--border-subtle` | `#e6d7b8` | `#E3E2DE` | `#2C2B28` |
| `--border-default` | `#d4ba85` | `#CBC9C3` | `#3A3934` |
| `--border-strong` | `#c29b5c` | `#A8A69E` | `#4A4844` |
| `--border-selected` | `#8a6431` | `#A9603C` | `#C88356` |
| `--fill-brand` | `#8a6431` | `#A9603C` | `#C88356` |
| `--fill-brand-hover` | `#6e4e2a` | `#8E4E30` | `#D9976C` |
| `--fill-brand-disabled` | `#d4ba85` | `#E3E2DE` | `#2C2B28` |
| `--fill-badge` | `#e6d7b8` | `#EFEEEB` | `#2C2B28` |
| `--focus-ring` | `#a87d3e` | `#A9603C` | `#C88356` |
| `--divider` | `#f3ecdc` | `#EFEEEB` | `#232220` |

`--border-selected` is the one the earlier draft missed: `border-farm-600` at 8
sites is the **selected** chip/card/tab border, a state and not a brand fill.

### 3.2 Roles

| Role | Light bg / fg / line | Dark bg / fg / line |
|---|---|---|
| `danger` | `#fef2f2` / `#991b1b` / `#fca5a5` | `#2A1414` / `#F4A9A0` / `#4A2020` |
| `danger-soft` | — / `#b91c1c` / — | — / `#E8877C` / — |
| `warning` | `#fffbeb` / `#92400e` / `#fcd34d` | `#2E230F` / `#E0B558` / `#47370F` |
| `warning-strong` | — / `#78350f` / — | — / `#EFC97A` / — |
| `success` | `#f0fdf4` / `#166534` / `#86efac` | `#12291B` / `#7CC495` / `#22452F` |

`danger-soft` exists because `text-red-700` (9 sites) is pinned by
[tool-call-chip.spec.ts:33](../web-angular/src/app/components/tool-call-chip.spec.ts#L33)
and cannot be expressed by a `danger` role fixed at `red-800`. `warning-strong`
covers `text-amber-900` (13 sites).

**On red and amber.** An earlier draft claimed `sales.spec.ts:269` and
`routing.spec.ts:212` lock these meanings. They do not — both are negative
substring checks on single elements ("this note must not be red"), they constrain
restraint rather than meaning, and both pass **vacuously** once tokenisation
removes the literal strings. Keeping danger on red and warning on amber is a
design choice defended on convention, not a tested invariant. Whoever changes it
should know the tests will not catch them.

### 3.3 Categorical ramp — agents

`agentClass()` needs four mutually distinguishable values, and its meanings are
*which agent answered*, not error/outstanding/settled. Folding it into the roles
would make the `vendor` chip mean "outstanding", which is false.

| Agent | Today | Light bg / fg / line | Dark |
|---|---|---|---|
| `dairy` | emerald | `#ECF5F1` / `#2F6F5E` / `#BFDCD3` | `#122622` / `#79BFAB` / `#22403A` |
| `vendor` | amber — **collides with `warning`** | `#EEF0FA` / `#4C5FA8` / `#C7CEEA` | `#161A2E` / `#8FA0DC` / `#272E4D` |
| `both` | violet | `#F3EEFA` / `#7A5AA8` / `#D8CBEA` | `#211A2E` / `#B197D9` / `#352A4D` |
| default | farm-100 | `--surface-sunken` / `--text-muted` / `--border-subtle` | same tokens |

Moving `vendor` off amber is the point: as it stands a vendor answer wears the
same colour as an unanswered milking row.

### 3.4 Write-log tokens — BLOCKED values

`--writelog-bg` `#f0fdf4`, `--writelog-fg` `#14532d`, `--writelog-line`
`#bbf7d0` — the current values exactly, held at equal contrast per B3. Dark
values (`#12291B` / `#8FD3A6` / `#22452F`) are matched for perceived contrast
rather than mapped from the light set, and should be eyeballed against the light
bar before shipping.

### 3.5 Certainty tokens

| Token | Light | Dark |
|---|---|---|
| `--certainty-known` | `--text-primary` | `--text-primary` |
| `--certainty-approx` | `#82807A` | `#9E9C93` |
| `--certainty-approx-rule` | `#A8A69E` | `#57564F` |
| `--certainty-absent` | `--text-subtle` | `--text-subtle` |
| `--certainty-unanswered` | `warning` role | `warning` role |

### 3.6 Tailwind config

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'SF Mono', 'Menlo',
               'Consolas', 'Liberation Mono', 'monospace'],
      },
      colors: {
        farm: { /* unchanged through phase 2, deleted in phase 4 */ },
        surface: { page: 'rgb(var(--surface-page) / <alpha-value>)', /* … */ },
        content: { primary: '…', heading: '…', secondary: '…',
                   muted: '…', subtle: '…', disabled: '…', onFill: '…' },
        line:    { hairline: '…', subtle: '…', DEFAULT: '…',
                   strong: '…', selected: '…' },
        brand:   { DEFAULT: '…', hover: '…', disabled: '…' },
        danger:  { bg: '…', fg: '…', soft: '…', line: '…' },
        warning: { bg: '…', fg: '…', strong: '…', line: '…' },
        success: { bg: '…', fg: '…', line: '…' },
        agent:   { dairy: {…}, vendor: {…}, both: {…} },
        certainty: { known: '…', approx: '…', rule: '…', absent: '…' },
        writelog: { bg: '…', fg: '…', line: '…' },
      },
    },
  },
  plugins: [],   // see §9.3 — @tailwindcss/forms is NOT added
};
```

**`<alpha-value>` requires channel triplets**, so `:root` declares
`--surface-page: 247 247 245;`, not hex. Three opacity modifiers exist and are
the phase-1 regression test: `border-farm-200/60`
([confirmation-card.ts:38](../web-angular/src/app/components/confirmation-card.ts#L38)),
`bg-green-50/40`
([destination-detail.ts:99](../web-angular/src/app/registry/destination-detail.ts#L99)),
`bg-farm-50/80`
([chat-panel.ts:24](../web-angular/src/app/components/chat-panel.ts#L24)).

**Consequence for Chart.js:** `getComputedStyle` reads return `247 247 245`,
which Chart.js cannot parse. `chartTheme()` must wrap every read in `rgb(…)`.

---

## 4. Type and density

**Two families.** The existing system sans for prose and labels. A real monospace
for **every identifier, quantity, date and currency figure** — serials, litres,
rupees, dates, precision qualifiers. `font-mono` plus
`font-variant-numeric: tabular-nums` on any column of figures.

This is the single change that does most for the app's character: it makes the
record look like a record, and tabular alignment is what lets you scan 31 rows
for an anomaly. Two cells already do it (`py-1 text-right tabular-nums`,
`py-1 font-mono text-farm-800`) — accidentally, in one file.

**Scale.** Tailwind's, no custom sizes. `text-xs` 12 / `text-sm` 14 /
`text-base` 16 / `text-lg` 18. Three heading levels, not two:

| Level | Class | Sites |
|---|---|---:|
| Page | `text-lg font-semibold` + `--text-primary` | 14 |
| Section | `text-sm font-semibold` + `--text-primary` | 12 |
| Sub | `text-sm font-medium` + `--text-heading` | 17 |

The middle one was missing from the earlier draft.

**Density.** Two modes as token sets, not ad-hoc:

- **Compact** (entry: milking roster, dispatch, payroll, both forms) — control
  height 32px, `py-1.5`, 4px rhythm
- **Comfortable** (review: herd list, detail pages, `/check`, chat) — control
  height 36px, `py-2`, 6px rhythm

**Help prose demoted.** It is currently `text-sm` in `text-farm-600` — warmer and
nearly as loud as the labels it explains, and on `/animals/new` there is more of
it than there are controls. Target: `text-xs`, `--text-muted`, max 65ch. It stays
load-bearing; it stops competing.

---

## 5. The certainty vocabulary

Four states, one treatment, reused everywhere.

| State | Treatment |
|---|---|
| **Known** — measured, exact day, observed | `--certainty-known`, `font-mono tabular-nums`, no ornament |
| **Approximate** — estimated, month/year precision, recalled | `--certainty-approx`, `border-b border-dotted` in `--certainty-approx-rule`, and a qualifier naming the imprecision (`~`, `YEAR`, `EST`) |
| **Deliberately absent** — `not_measured`, `nothing taken`, nobody observed | `--certainty-absent`, *italic*, always **words**, never a dash |
| **Unanswered** — still required | The `warning` role. The only amber on the screen. |

**Carried by weight, contrast and a mark — never by hue alone.** It must survive
dark mode, greyscale and colour blindness. This is not decoration: it is the same
commitment `intervalReport()` makes when it refuses to average a measured interval
with an approximate one.

Applies at: `/milk/milking` (four row states), `/animals` and `/animals/:id`
(precision suffixes), `/check` (the separated measured/approximate boxes, finding
severities), `/milk/dispatch` (`nothing taken`, `not billed`, `kept, not sold`),
`/labour/*` (owed, in advance, `—`).

`decoration-farm-300` already exists at one site — the dotted rule, unnamed.

**Constrained by B2 only:** on the two frozen forms the vocabulary applies, but
the two `date-text` inputs must not be differentiated *from each other*.

---

## 6. Primitives

Fifteen. Counts re-read from the code; where the earlier draft was wrong the
corrected figure is given.

| # | Primitive | Sites | Notes |
|---|---|---:|---|
| 1 | `HelpText` | 36 + 9 | `text-sm`/`text-xs` variants, plus `mt-1 text-sm` ×9 |
| 2 | `TableCell` | **98** | **New. The largest inconsistency in the app.** See below |
| 3 | `FieldLabel` | 23 | `mb-1 block text-xs font-medium` |
| 4 | `TextInput` | **~23** | Two sizes: `px-2 py-1.5` ×10, `px-3 py-2` ×13 (7 `w-full` + 6 not) |
| 5 | `Button` | **19** | Seven variants, three disabled strategies. See below |
| 6 | `ErrorPanel` | **35** | Seven distinct strings, not two |
| 7 | `SubHeading` | 17 | |
| 8 | `Card` | 16 | `rounded-xl border p-4`, plus a `+ text-sm` empty-state variant ×6 |
| 9 | `PageHeading` | 14 | |
| 10 | `SectionLabel` | 13 + 9 | Plus the fieldset-legend variant `mb-1 text-xs font-medium uppercase` ×9 |
| 11 | `SectionHeading` | 12 | The missing middle level (§4) |
| 12 | `TextLink` | 10 | |
| 13 | `RowDivider` | 10 | |
| 14 | `StatusBadge` | **6** | Five distinct strings, not ~15 |
| 15 | `SummaryBar` | **3** | Three strings, three different layouts |

`NotePanel` from the earlier draft **does not exist**. Its 8 sites are stat tiles
inside a single file; the actual `/check` caveat is `HelpText`. Dropped.

### 6.2 TableCell — the finding

**12 tables, 98 cells, 34 distinct cell class strings, four competing padding
scales in simultaneous use:**

| Scale | n |
|---|---:|
| `px-3 py-2` (+ variants) | 39 |
| `py-1` (+ variants) — **no horizontal padding at all** | 26 |
| `px-3 py-1.5` | 8 |
| `px-4 py-1.5` | 7 |

No cell carries `rounded`, which is why no metric in the earlier draft could see
this. If the screenshots read wrong, this is a likelier cause than the button.

**Target:** two cell densities matching §4 — `px-3 py-2` comfortable, `px-3
py-1.5` compact — with `align`, `numeric` (adds `font-mono tabular-nums
text-right`) and `emphasis` props. `py-1` and `px-4 py-1.5` are deleted.

### 6.3 Button — the defect

| Variant | Sites |
|---|---:|
| `rounded-xl bg-farm-600 … disabled:cursor-not-allowed disabled:bg-farm-300` | 6 |
| `rounded-lg bg-farm-800 … disabled:opacity-40` | 4 |
| `rounded-xl bg-farm-600 … disabled:bg-farm-300` | 3 |
| `rounded-md bg-farm-600 px-3 py-1.5 … hover:bg-farm-700` | 2 |
| `rounded-xl bg-farm-600 px-4 py-2.5 …` | 1 |
| `mt-5 w-full rounded-xl bg-farm-600 px-4 py-2.5` — [session-gate.ts:116](../web-angular/src/app/registry/session-gate.ts#L116) | 1 |
| `rounded-lg bg-farm-800 px-4 py-2` — **no disabled treatment** — [person-detail.ts:137](../web-angular/src/app/registry/person-detail.ts#L137) | 1 |
| `<a>` styled as a button — [herd-list.ts:38](../web-angular/src/app/registry/herd-list.ts#L38) | 1 |

Three radii, two fills, **three** disabled strategies, `hover:` on 3 of 19.

This is why the screenshots read wrong: payroll's **enabled** button is
`bg-farm-800` while everyone else's is `bg-farm-600`, and disabled `bg-farm-300`
is a light tan that still invites a click.

**Target API:** `variant: primary | secondary | link`, `size: sm | md`,
`as: button | a`. Disabled is visibly inert — reduced contrast on both fill and
label, `cursor-not-allowed`, `aria-disabled`, and `aria-describedby` pointing at
the existing reason text.

**Two lookalikes must not be swept in:**
[confirmation-card.ts:11](../web-angular/src/app/components/confirmation-card.ts#L11)
is a badge, and [message.ts:16](../web-angular/src/app/components/message.ts#L16)
is the user's chat bubble — which §10 separately wants quieted.

### 6.4 Extraction constraint

**115 distinct `data-role` hooks are reached by 325 `querySelector` calls behind
92 presence/absence assertions.** There are no nesting assertions, but every hook
must survive the move. This is the real risk in extraction, and it is far larger
than the five `className` assertions.

Also: [templates.spec.ts:128](../web-angular/src/app/registry/templates.spec.ts#L128)
requires any registry file containing `.provenance()` to also contain
`<app-session-required`, with two named exceptions. If a submit and its
`provenance()` call move into a shared file, this guard fires. Its glob is
`./*.ts` — registry only — so nothing in `components/` is covered.

---

## 7. Focus and accessibility

| Item | Now | Target |
|---|---|---|
| Focus ring | **One** component: `chip-group` (`focus-visible:ring-2 ring-farm-500 ring-offset-1`) | `--focus-ring` on every interactive primitive |
| `composer.ts` | `outline-none focus:border-farm-500` — the native ring was **deliberately** replaced | Keep the border-shift pattern, tokenised. Do not reinstate an outline here |
| `aria-live` | One, on the write log — well built, with a counter so identical messages re-announce | Add to streaming chat output |
| Submit reasons | Not linked | `aria-describedby` from button to reason |
| `prefers-reduced-motion` | Not referenced | Honour it |
| Colour-only meaning | Status badges, the three `text-amber-800` balance bindings | §5 resolves it — mark plus contrast, not hue |

---

## 8. Dark mode

Three-way toggle (system / light / dark), persisted, class on `<html>`, with
`color-scheme` set per mode so native scrollbars and controls follow.

### 8.1 chart-card.ts

Ten hex literals: `#8a6431` ×6, `#c29b5c` ×2, `#e6d7b8` ×2.

Easier than the earlier draft claimed in one half and harder in the other. `data`
is **already a `computed()`** holding five of the ten, bound as `[data]="data()"`
— adding a theme-signal read makes it re-render for free. `options` is a plain
class field bound as `[options]="options"`; converting it to a `computed()` is a
two-line change that `BaseChartDirective` picks up via `ngOnChanges`.

The real obstacles:

- **[chart-card.spec.ts:31](../web-angular/src/app/components/chart-card.spec.ts#L31)
  pins `#8a6431` by exact equality.** Any theming breaks it on day one. Update it
  to assert the resolved token.
- `rgb()` wrapping for channel triplets (§3.6).
- jsdom has no 2D context — the run prints `Not implemented:
  HTMLCanvasElement's getContext()` — so a re-render test asserts on the config
  object, not the canvas.

Also: the title reads `dayly yield` because
[chart-card.ts:15](../web-angular/src/app/components/chart-card.ts#L15)
concatenates `{{ dataset().interval }}ly`. Client-side, one line.

### 8.2 Markdown

`.prose-chat` holds three `rgba(0,0,0,…)` values (code bg, thead bg, cell
borders) — all invisible over a dark surface. Tokenise all three.

Unstyled and falling through preflight: `h1`–`h3`, `blockquote`, `a`, `hr`,
`pre`, `del`, nested lists. **Not `h4`–`h6`** — `ALLOWED_TAGS` in
[markdown-view.ts](../web-angular/src/app/components/markdown-view.ts) permits
`h1`–`h3` only, so DOMPurify strips the rest before they reach the DOM.

### 8.3 `@tailwindcss/forms` — deferred, not adopted

It is a **global base-layer restyle** of every `input`, `select`, `textarea`,
`checkbox` and `radio`. `calving-form`'s first field is a `<select>`, and the
plugin's most visible single change is giving `<select>` a new chevron, padding
and border. `precision-date` carries a `type="checkbox"` the plugin restyles
completely.

None of that breaks B1–B3 as written — they cover field order, the two date
fields' sameness, and the write-log bar. But it changes the feel of the frozen
forms wholesale on the eve of a friction measurement, for a benefit (themeable
native controls) that only eleven `<input type="date">` and four `<select>`
actually need. **Style those explicitly instead.** Revisit after the trial.

The eleven date inputs are all on free screens; two are pinned by specs
([payroll.spec.ts:296](../web-angular/src/app/registry/payroll.spec.ts#L296)
selects one, [routing.spec.ts:277](../web-angular/src/app/registry/routing.spec.ts#L277)
forbids one on the Today board).

---

## 9. Chat fold-in

`app.routes.ts` has `RegistryShell` as parent of every registry route with
`{ path: 'chat' }` as a **top-level sibling** — which is why the panel renders
with no banner, no session bar and no nav.

1. Move the route into `RegistryShell`'s `children`.
2. **`display: block` is necessary but not sufficient.** The panel's root is
   `mx-auto flex h-full max-w-3xl flex-col` with a `flex-1 overflow-y-auto`
   region and a pinned composer. As a plain block child of `<main>` its `h-full`
   resolves against `auto` and collapses: the message list stops scrolling
   internally, the composer drifts, and `afterRenderEffect`'s `scrollTo` silently
   does nothing because `scrollHeight === clientHeight`. Needs
   `app-chat-panel { display: block; height: 100%; }` (or `min-h-0` on a flex
   `main`), and `main`'s `py-6` reconciled with a full-height child.
3. Note the tension: `styles.css` says routed components are **deliberately
   absent** from the list because "they are never siblings of anything". Folding
   chat in makes it routed, so by that rule it stays off — but it needs the
   height regardless. Resolve by giving routed full-height components their own
   rule rather than bending the list's meaning.
4. **Quiet the user's own turn.** It is currently the highest-contrast element on
   the page (solid `bg-farm-600`, white text) while the answer is a low-contrast
   bordered card. You know what you typed.
5. **Provenance on agent-proposed writes.** The chat can propose a write on a
   surface with no provenance state at all, while every manual write is stamped.
   Use the same chip.

**Guard the `display: block` list with a test.** `templates.spec.ts` already has
the machinery: glob registry sources, extract `selector: 'app-…'`, drop the
routed ones, assert the rest appear in `styles.css`. This would have caught
`app-session-required`, which has 12 call sites, is absent from the list, and has
**seven** of them outside a `flex` parent — the exact latent case the list's own
comment warns about.

---

## 10. Phases

| Phase | Deliverable | Passes when |
|---|---|---|
| **0** | Baseline: both suites run, **fourteen** screens screenshotted at one fixed width | Frontend 281/281, server 726/726 recorded. Fourteen includes the two forms — the only screens where zero-delta is the whole safety argument |
| **1** | Token layer, zero delta | Screenshots match. Suites pass unchanged. All three opacity modifiers still render |
| **2** | Fifteen primitives extracted | Distinct whole-attribute class strings drop from **358**. All 115 `data-role` hooks intact. `templates.spec.ts:128` still passes |
| **3** | Dark mode, `chartTheme()`, markdown, focus rings | Both modes legible on all fourteen screens. `chart-card.spec.ts:31` updated to assert the token |
| **4** | Neutral re-point + monospace figures | Layer-2 edit plus `font-mono` application. Zero token renames |
| **5** | Certainty vocabulary | The four states are distinguishable **in greyscale** |
| **6** | Chat folded in | Renders inside the shell with the session bar, scrolls internally, composer pinned. `display: block` guard test added |
| **7** | B1, B2, B3, then layout: rail, widths, command palette | After the trial reports |

Phase 2's metric is total distinct class strings, not `rounded`-bearing ones: 74
of the 101 `rounded` strings occur exactly once, so extraction can remove at most
27, and seven of the fifteen primitives carry no `rounded` at all.

---

## 11. Housekeeping

- The `display: block` guard test (§9).
- **`OPEN.md` has no backtick-lint item to strike.** An earlier draft said it did;
  it does not. `templates.spec.ts` was built, and
  [REGISTRY_PAYROLL.md §16.3](REGISTRY_PAYROLL.md) does say what was quoted — but
  the prescribed action has no target. No change needed.
- Add this document to [README.md](README.md)'s Reference table.

## 12. Unverified

- Target light/dark values in §3 have not been rendered. They are reasoned from
  the current palette and perceived-contrast matching, not measured.
- `--writelog-*` dark values need eyeballing against the light bar (B3).
- The categorical agent ramp (§3.3) has not been checked for distinguishability
  under common colour-vision deficiencies.
- `StatusBadge`'s five strings include two that carry TypeScript colour logic
  (`tool-call-chip`, the agent chip); whether they can share one primitive is a
  phase-2 question.
- Compact/comfortable density assignment per screen is proposed, not derived.