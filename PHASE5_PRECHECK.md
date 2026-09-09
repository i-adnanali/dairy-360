# Phase 5 pre-check

Three checks run before any phase-5 code, per the brief. Each guards a phase.
Written at the repo root deliberately: this is a measurement of one moment in
the tree, not part of the design system, and `docs/UI_SYSTEM.md` is the only
document for the system itself.

Measured against `521a965` (working tree clean apart from `docs/UI_SYSTEM.md`).

**Historical snapshot:** the figures and source line numbers below belong to
that baseline. UI phases 5–7 and the light approximate-token fix have since
changed the rendering and census. For current behavior and remaining failures,
see [UI_SYSTEM.md](docs/UI_SYSTEM.md), especially §§4.2.1, 4.5 and 9.4.

**Headline:** phase 5 is not invalidated, but **check 2 falsifies a premise
§6 and §4.2.1 both rest on**, and **check 1 finds that three of phase 5's own
five states fail WCAG AA on every surface in both modes.** Neither is a reason
to stop; both change what phase 5 can honestly claim. Details below.

---

## 1. Contrast ratios — §9.6

Scripted as [scripts/check-contrast.mjs](scripts/check-contrast.mjs), which
reads `web-angular/src/styles.css` as the source of truth so it cannot drift
from the values that render. Run it with `node scripts/check-contrast.mjs`
(`--all` for every pair, `--report` to print without a non-zero exit).

**33 graded failures: 18 light, 15 dark.** 124 graded checks, plus 96 rows
reported as informational and never failed.

### The tiers, because a first draft printed 100 failures and was wrong

The first version checked every plausible pair at 4.5 or 3 and produced a
hundred failures, most of which were the script misreading WCAG rather than the
palette failing it. Thresholds are now mapped to the criterion that applies:

| Tier | Threshold | What it covers |
|---|---|---|
| `TEXT` | 4.5:1 — SC 1.4.3 | A foreground that carries words, on every background it can land on |
| `FOCUS` | 3:1 — SC 1.4.11, 2.4.11 | The focus ring against what it is drawn over |
| `MARK` | 3:1 — SC 1.4.11 | Non-text **carrying meaning**: an input's own border, the selected-chip boundary, and from phase 5 on `--certainty-rule` |
| `INFO` | none | Decorative hairlines; a tinted role panel's fill against the page; any indicator whose state is **also in adjacent words** |

**Nothing in this app qualifies for the large-text exemption.** The largest type
is `PageHeading`'s `text-lg font-semibold` — 18px at weight 600, which is
13.5pt bold, and the exemption starts at 14pt bold. So 4.5:1 applies to every
piece of text in the app. That is a simplification worth writing down rather
than rediscovering.

Three indicators were moved to `INFO` **on the evidence of the code**, not on
preference:

- `--mark-pending` sits immediately beside the literal word `Thinking…`
  ([chat-panel.ts:72](web-angular/src/app/components/chat-panel.ts#L72)).
- `--success-dot` / `--danger-dot` sit beside `{{ call().status }}`, rendered as
  words ([tool-call-chip.ts:18](web-angular/src/app/components/tool-call-chip.ts#L18)).
- `--warning-fill` is the harness banner, which says `harness · in memory` on
  itself; §12.2's chip keeps that text.

In all three the state is available in text, which is exactly what 1.4.11 exempts.

### The failures that matter to phase 5

**Three of the five certainty states fail AA on all three surfaces, in both
modes.** This is the finding the brief was looking for.

| Pair | light | dark | needs |
|---|---:|---:|---:|
| `certainty-approx` on `surface-page` | **3.68** | 6.70 ok¹ | 4.5 |
| `certainty-approx` on `surface-raised` | **3.95** | 6.25 ok¹ | 4.5 |
| `certainty-approx` on `surface-sunken` | **3.40** | 5.78 ok¹ | 4.5 |
| `certainty-absent` on `surface-page` | **3.68** | **4.34** | 4.5 |
| `certainty-absent` on `surface-raised` | **3.95** | **4.05** | 4.5 |
| `certainty-absent` on `surface-sunken` | **3.40** | **3.74** | 4.5 |
| `text-disabled` (state 4, no record) on `surface-page` | **2.27** | **2.50** | 4.5 |
| `text-disabled` on `surface-raised` | **2.44** | **2.33** | 4.5 |
| `text-disabled` on `surface-sunken` | **2.10** | **2.16** | 4.5 |
| `certainty-rule` on `surface-page` | **2.27** | **2.50** | 3 (MARK) |
| `certainty-rule` on `surface-raised` | **2.44** | **2.33** | 3 (MARK) |
| `certainty-rule` on `surface-sunken` | **2.10** | **2.16** | 3 (MARK) |

¹ `--certainty-approx` in dark holds `#9E9C93`, which is `--text-muted`'s dark
value — a full step louder than the light set's `#82807A`, which is
`--text-subtle`. So the approximate state clears AA comfortably in dark (5.78–6.70)
and fails it on every surface in light. **The dark palette is the better one
here**, and the light value is the one to move. The other two states fail in both
modes.

`--certainty-rule` failing `MARK` is the one that bites hardest, because §6.3
makes the dotted underline **the mark that carries "approximate" once hue is
gone**. A 2.1–2.5:1 dotted 1px rule is not a mark; it is a rumour. Phase 5's
greyscale acceptance can still be met — the qualifier word (`month`, `year`,
`est`) does the work — but it is met by the *words*, not by the rule, and that
should be said out loud rather than implied.

### The rest of the failures

Two pairs, at nine sites each, both pre-existing and neither introduced by
phase 5:

- `text-subtle` on all three surfaces: **3.40–3.95** light, **3.74–4.34** dark.
  This is `HelpText`'s `subtle` tone and `content-subtle` generally — the
  "already saved" aside on the roster, the `Thinking…` line, the §6.1 qualifier.
- `border-default` on all three surfaces: **1.43–1.66** light, **1.37–1.59**
  dark, against a `MARK` threshold of 3. This is **an input's own border**, and
  it is the failure with the widest reach in the app: on `/animals/new` and
  `/milk/milking` a 1px `#CBC9C3` edge on `#FFFFFF` is the only thing marking
  where a control is. §14.4 already wants a `box-shadow` added to the focus
  treatment; this says the **resting** border is the weaker half.

### The seven derived dark values — §9.6, now measured

All seven clear their own thresholds. Six are contrast-matched to their light
counterparts within a reasonable margin; **one is not.**

| Pair | light | dark | drift |
|---|---:|---:|---:|
| `danger-strong` on `danger-bg` | 9.16 | 11.27 | +23% |
| `success-strong` on `success-bg` | 8.70 | 9.55 | +10% |
| `success-line-soft` on `success-bg` | 1.16 | 1.95 | +68% |
| `warning-strong` on `warning-fill` | 7.28 | 7.31 | +0% |
| `success-dot` on `surface-raised` | 2.54 | 8.95 | **+253%** |
| `danger-dot` on `surface-raised` | 3.76 | 6.22 | +65% |
| `mark-pending` on `surface-raised` | 2.44 | 2.33 | −4% |

`--warning-strong` on `--warning-fill` at 7.31:1 confirms §9.6's spot-check of
"about 7:1" exactly, in dark.

**`--success-dot` is the one genuine mismatch.** At 2.54:1 in light it is nearly
invisible; at 8.95:1 in dark it is the loudest thing on the chip. `styles.css`
justifies the dark dots as "the status dots keep their saturation: they are 6px
marks and need to read at that size" — which is right about dark and reveals
that **light is where the dot does not read**. Both are `INFO` because the
status is also in words, so neither is a failure; the asymmetry is still real
and belongs to phase 6b, which is the phase that touches this chip.

### Not fixed

Per the brief. Nothing in `styles.css` was changed.

---

## 2. The amber census — §10.7

**§4.2.1's reservation is already broken, and not marginally.**

**43 amber utility occurrences at 26 distinct sites in 15 files**, carrying
**five** meanings where §4.2.1 permits two. 17 of the 26 sites are outside both
permitted meanings, and all 17 are in the content area.

Scanned as every `bg-|text-|border-|ring-|decoration-…-warning-{bg,fg,strong,line,fill}`
in `web-angular/src/app/**`, excluding `*.spec.ts`.

### Permitted — meaning 1, "this needs an answer from you" (9 sites)

| Site | What |
|---|---|
| [today-board.ts:72](web-angular/src/app/registry/today-board.ts#L72), :75 | incomplete session counter |
| [today-board.ts:87](web-angular/src/app/registry/today-board.ts#L87), :90 | incomplete session counter |
| [today-board.ts:102](web-angular/src/app/registry/today-board.ts#L102), :105 | outstanding item |
| [verification-panel.ts:108](web-angular/src/app/registry/verification-panel.ts#L108) | a `/check` finding |
| [verification-panel.ts:233](web-angular/src/app/registry/verification-panel.ts#L233) | `recorded < expected` |
| [verification-panel.ts:296](web-angular/src/app/registry/verification-panel.ts#L296) | a `/check` note |
| [session-required.ts:39](web-angular/src/app/registry/session-required.ts#L39), :40 | "you need a session to write" |

### Permitted — meaning 2, "this is not the real registry" (1 site)

| Site | What |
|---|---|
| [session-bar.ts:27](web-angular/src/app/registry/session-bar.ts#L27) | the harness banner, `warning-fill` |

### Meaning 3 — "you are overriding a refusal" (4 sites)

| Site | What |
|---|---|
| [event-form.ts:124](web-angular/src/app/registry/event-form.ts#L124), :139 | the override box |
| [correction-form.ts:102](web-angular/src/app/registry/correction-form.ts#L102), :110 | the override box |
| [calving-form.ts:178](web-angular/src/app/registry/calving-form.ts#L178), :187 | the override box — **frozen form** |
| [precision-date.ts:141](web-angular/src/app/registry/precision-date.ts#L141) | the bare-year override — **on both frozen forms** |

### Meaning 4 — "this looks unlike its neighbours" (4 sites)

| Site | What |
|---|---|
| [milking-roster.ts:222](web-angular/src/app/registry/milking-roster.ts#L222) | out-of-band litres |
| [payroll-run.ts:170](web-angular/src/app/registry/payroll-run.ts#L170) | expected ≠ taken |
| [calving-form.ts:141](web-angular/src/app/registry/calving-form.ts#L141) | the outcome warning — **frozen form** |
| [duplicate-warning.ts:49](web-angular/src/app/registry/duplicate-warning.ts#L49), :50, :56, :70 | a possible duplicate — **on `/animals/new`** |

### Meaning 5 — "this is a liability, or a missing agreement" (4 sites)

| Site | What |
|---|---|
| [person-detail.ts:85](web-angular/src/app/registry/person-detail.ts#L85) | negative balance |
| [people-list.ts:122](web-angular/src/app/registry/people-list.ts#L122) | negative balance |
| [destinations-list.ts:131](web-angular/src/app/registry/destinations-list.ts#L131) | "no price agreed" |
| [event-list.ts:84](web-angular/src/app/registry/event-list.ts#L84) | "not billed" |

### And one that is a bug, not a meaning

[message.ts:73](web-angular/src/app/components/message.ts#L73) is
`bg-warning-bg text-agent-vendor-fg border-agent-vendor-line`.

§4.3 states that **"`vendor` has left amber, which was the point: a vendor
answer used to wear the same colour as an unanswered milking row."** The
foreground and the border moved to the agent ramp. **The background did not.**
The vendor agent chip still renders on `--warning-bg`, in the chat's content
area, which is the one place §4.2.1 says amber may not be.

The document and the code disagree, so the code is right and the document is
wrong: §4.3's claim is half-true. This is a leftover from the phase-4 re-point,
it is the only site where the agent ramp and a role are mixed on one element,
and it is fixed in **phase 6b** — the phase that owns this component (§13.3
already moves the tool chip onto the ramp for the same reason).

### What this means for phase 5

It does not invalidate it. Four of the five states — known, approximate,
deliberately absent, no record — are hue-independent by construction and touch
amber nowhere. Only the fifth depends on it.

But it falsifies the sentence §6 uses to justify the fifth state, which the
document repeats twice:

> **Unanswered** — still required · The `warning` role. The only amber in the
> **content area** (§4.2.1)

It is not the only amber in the content area, and it will be the **sixth**
meaning of amber there rather than the second. So:

1. Phase 5 still gives the unanswered state the `warning` role. §3.2's argument
   holds on its own terms — amber's job is to make a skipped row **findable**,
   and a row-scale highlight is a different visual event from a 12px inline tag,
   which is what 16 of the 17 unpermitted sites are.
2. **The amber check is written as a baseline, not as the two-meaning rule.**
   A spec asserting §4.2.1 as written would fail on the day it was added and
   would then be deleted, which is how a guard becomes furniture. It pins the
   census instead and fails on **growth** — a new amber site has to be
   classified, in the spec, by whoever adds it.
3. Re-pointing the 17 is **not** phase 5's job and is not attempted here. Six of
   them sit on the two frozen forms or on `/animals/new`, so B1/B2 reach them,
   and the remaining eleven are four separate design decisions (an override, an
   anomaly hint, a liability, a missing agreement) that deserve their own names
   rather than a sweep. Recorded in §16 as undecided.

---

## 3. Are §6's five states renderable from today's data? — yes, no server change

The specific question: **can the roster distinguish a `not_measured` row from an
animal with no row at all, at the component level, without a server change?**

**Yes.** `RosterRow.previous` is
`{ session, occurred_on, status, yield_litres } | null`
([types.ts:158](web-angular/src/app/registry/types.ts#L158)), and
[milking.ts:504-510](server/src/registry/milking.ts#L504) coalesces a missing
row to `null` explicitly. So:

| §6 state | How the roster reads it |
|---|---|
| Known | `previous.status === 'measured'` → `previous.yield_litres` |
| Approximate | *not applicable to a yield* — there is no approximate litre |
| Deliberately absent | `previous.status === 'milked_not_measured'` or `'not_milked'` |
| No record | `previous === null` |
| Unanswered | `draft(id).status === null` — client state, already computed as `untouched()` |

`previousText()` at
[milking-roster.ts:434](web-angular/src/app/registry/milking-roster.ts#L434)
**already makes exactly this distinction** and throws it away typographically:
it returns `'—'` for `null` and the words `not measured` / `not milked` for the
two statuses, all three rendered identically in `tone="secondary"`. Phase 5 is
giving an existing distinction a treatment, not inventing one.

One honesty note: `previous === null` conflates two different no-records — no
row was saved for that session, and the animal was not in milk then. Both are
"nothing was ever entered", so both map to state 4 correctly, but the roster
cannot tell them apart and should not pretend to.

`recent_mean: number | null` and `existing: MilkingRow | null` carry the same
shape, so the mean column and the "already saved" aside are covered too.

### The other four screens, same check

| Screen | States present in the data |
|---|---|
| `/animals`, `/animals/:id` | `birth_precision: DatePrecision \| null` — `day` known, `month`/`year`/`estimated` approximate, `null` + null date no-record ([types.ts:20](web-angular/src/app/registry/types.ts#L20)) |
| `/milk/dispatch` | `SheetRow.previous: {...} \| null` and `DispatchStatus = 'taken' \| 'none'` — `none` is "nothing taken", a given answer; `previous: null` is no record; `price: null` is no agreement ([types.ts:339](web-angular/src/app/registry/types.ts#L339)) |
| `/check` | already separates measured / `milked_not_measured` / `not_milked` in `SessionCompleteness` and `MilkingReport` — this is where the distinction originates |
| `/labour/*` | `balance_minor` signed for owed/in-advance; the bare em dash sites are literal `'—'` in the templates and are the no-record state |

**No server change is required for any of the five screens.** Phase 5's scope
is unchanged.
