# UI design system

Current reference for how the app looks and what each visual state means. [Application interactions](application-interactions.md) owns navigation and workflow behavior; [registry references](../registry/README.md) own domain meaning.

The values live in [styles.css](../../../web-angular/src/styles.css) as channel-triplet custom properties, exposed to Tailwind by semantic name in [tailwind.config.js](../../../web-angular/tailwind.config.js). Components consume the semantic names and the shared directives in [ui/](../../../web-angular/src/app/ui), never raw palette values.

## Palette and themes

A deep green header band over neutral surfaces with a slight green bias. Light and dark are designed separately (dark surfaces are closer together so they still read as distinct), and theme switching cycles System, Light and Dark ([theme.ts](../../../web-angular/src/app/core/theme.ts)) with `color-scheme` set so native pickers and scrollbars follow.

| Role | Light | Dark | Use |
|---|---|---|---|
| Page / raised / sunken | `#F6F6F3` / `#FFFFFF` / `#EDEEE9` | `#0E1311` / `#141B18` / `#1A231F` | Page ground, cards and tables, bars and toolbars |
| Ink / muted | `#141613` / `#585C54` | `#ECF0EB` / `#9CA59A` | Text and secondary text |
| Brand | `#1A5640` | `#5AA784` | The main action button and the selected segment, nothing else |
| Focus | `#141613` | `#ECF0EB` | The single keyboard-focus ring (white inside the band) |

Role colours keep one meaning each:

| Colour | Means | Where |
|---|---|---|
| **Amber** (`warning`, `--session-lit`) | This needs an answer from you, or it is due now | Unanswered sheet rows (pale fill and a 3px leading bar), "Due today" and "Notable" items, the session board's "Now" tag and frame, incomplete counters |
| **Amber fill** (`warning-fill`) | This is not your real register, or the target is unknown | The storage chip only |
| **Red** (`danger`) | Act on it, or keep it out | Overdue tasks, urgent camera events, late sessions, milk withdrawals ("Not for sale"), errors |
| **Light green** (`success`, write log) | Something worked | "Recording started", save confirmations |
| **Neutral** | A fact that needs no answer | Meat-withdrawal chips, "Not saved yet", Check's people notes, overrides and balances |

[ui/amber.spec.ts](../../../web-angular/src/app/ui/amber.spec.ts) classifies every source file that uses amber, so a new use needs a reviewed meaning. Status never relies on colour alone: each state also has a word or a shape.

## Selection, location, now and focus

Shape says what kind of state something is; colour only accents. Implemented by `TabBar` and `Segmented` in [ui/selection.ts](../../../web-angular/src/app/ui/selection.ts) and the `.tab-bar`, `.segmented` and nav rules in styles.css.

| State | Treatment | Where |
|---|---|---|
| **Where you are** | Underline in the text colour, weight 600 (3px in the band, 2px below it) | Section nav, section bar views, `TabBar` tabs, phone menu, report contents |
| **What is chosen** | Filled segment in the brand colour, weight 600 | `Segmented` groups (Day/Week/Month, Morning/Evening, herd filters, report range), single-choice chips |
| **Due now** | Amber, and nothing else in the band is amber | Session board "Now" tag and 2px frame |
| **Viewing** | White 2px frame and the word "Viewing" | Session board tile for today's exact sheet only |
| **Keyboard focus** | One 2px ring at 2px offset in `--focus-ring` | Every control; a zero-specificity `:where(a, button, summary, [tabindex]):focus-visible` rule catches the rest |

`TabBar` is a `role="tablist"` with roving tabindex; `Segmented` keeps `aria-pressed` buttons in a labelled group. Both take one Tab stop and move with the arrow keys, Home and End, activating as they move. A "Skip to content" link is the first Tab stop on every page.

## Certainty

Every figure and date shows how it was known ([ui/certainty.ts](../../../web-angular/src/app/ui/certainty.ts), [precision-display.ts](../../../web-angular/src/app/registry/precision-display.ts)). The five states are distinguishable in greyscale, and [certainty.spec.ts](../../../web-angular/src/app/ui/certainty.spec.ts) fails if any two share every non-colour mark.

| State | Treatment | Example |
|---|---|---|
| Known | Monospace, tabular figures, no ornament | `6.5 L`, `11 Feb 2021` |
| Approximate | Monospace, dotted underline, a lowercase qualifier word | `Mar 2017 month`, `2016 year`, `~2018 est` |
| Answered "none" | Italic words | *not measured*, *nothing taken* |
| No record | En dash, labelled "No record" for screen readers | – |
| Unanswered | Amber row ground and leading bar | A milking row nobody has answered |

A date is truncated to its precision: a month-precision date never shows a day. Quantities use `~` for "about" or an average. Totals built from incomplete records carry "partial". Dates are written in words ("8 Nov 2026", "9 Nov, 01:22"), never as ISO strings.

## The shell

The band holds the app name, the storage chip, the recording chip, Search (`Cmd/Ctrl+K`), the theme control and the assistant toggle; the section nav (Today, Analytics, Herd, Milk, Feed, Labour, Monitor, and Check on the right); and the session board. Sections with more than one view get a sunken section bar with the views and at most one primary action. The session board's five tiles (morning milking and dispatch, feeding, evening milking and dispatch) show answered over expected; one size on every page, and on a phone it scrolls to Now first.

## Component contracts

| Role | Contract | Consumer |
|---|---|---|
| Page | Title before filters; entry 720px, review 1400px, report 1100px | People, purchase entry, lifetime report |
| Type | Page 24/32; section 18/24; body 16/24; help 14/20; metadata 12/16; prose capped near 68ch | PageHeading, SectionHeading, HelpText |
| Field | Persistent label; associated help and error IDs; placeholders are examples, not labels | Field with native `appInput` |
| Input | Separate control boundary; mobile 16px text and 44px target | Input, PrecisionDate |
| Actions | One primary per section; label stays during busy state; repeated activation blocked; a disabled action names its reason | Button |
| Surfaces | Raised card, elevated menu and dialog roles; never nest cards for spacing | Card, shared dialog/menu CSS |
| Review table | Identity and critical values first; a named keyboard stop only when it overflows | ScrollRegion, Cell |
| Entry sheet | One native control tree; identity next to entry; whole-session validation | Milking, Dispatch, Payroll |
| Metric | Number and qualification together; no invented zero | Metric |
| Chart | Adjacent qualification and an equivalent data table | ChartPanel, ChartDataTable |

## Preserve these meanings

Missing, unknown, unmeasured, not performed and explicit zero differ. Dates display only their recorded precision. Source, recorder and correction history stay discoverable. Historical rates and recipient snapshots belong to saved records. Pending or unknown writes lock editing and retry the same request. A planned dose is not a given dose; recorded wages are not payment; purchase cost is not consumed-feed cost. No presentation change may weaken those contracts.

## Validation

Run `npm run check:templates` and `npm run check:contrast` (a token and consumer gate, not full accessibility certification), and inspect changed screens in both themes and at phone width. Keyboard, error recovery and long content need interaction checks beyond screenshots; see [testing](../../guides/testing.md). [Current screenshots](../../images/current/README.md) show appearance only. The original phase-by-phase design record, including why each rule exists, is [UI_SYSTEM.md](../../records/UI_SYSTEM.md).
