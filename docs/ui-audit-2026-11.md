# Dairy 360 — UI/UX audit, November 2026

6 November 2026 · source `83a9e55` (tag v0.15.0) · assessment only, no code changed · input to the light/dark redesign.

**Method.** Rendered on the memory-only harness (`npm run harness:app`, 31 synthetic animals) at 1440 px, light and dark, using the repo's own `scripts/shoot-screens.mjs`. Empty-registry states were captured from the same harness without its seed step. Assistant states use a **synthetic AG-UI stream** that was injected into the browser (`fetch` stub; no model, no server, no writes), so the agent's wording in those captures is invented and only the UI's handling of the events is evidence. Contrast was measured with `npm run check:contrast`. Screenshots are in [`ui-audit-2026-11/`](ui-audit-2026-11/): `screens/` (seeded), `empty/` (empty registry) and `assistant/` (chat states).

**Re-run with the full impeccable method (revised 6 Nov).** The first pass loaded the impeccable skill but its context launcher failed (the file isn't executable), and the `audit` and `critique` playbooks were never read. This revision follows both playbooks:
- **Critique:** two isolated subagents. A did the design review with Nielsen scoring; B ran `impeccable detect` (CLI, URL scans and an in-page overlay on 5 routes).
- **Audit:** the five-dimension audit, including a laptop-width and 200 % text probe (`responsive/`).

Findings added or changed by the re-run are tagged **[re-run]**. Claims from the subagents that failed my verification are listed in section 6. The critique snapshot was written to `.impeccable/critique/` (untracked).

**Scope corrections to the brief.** The registry entry UI already exists (animal, calving, correction, event, health, milk, feed and payroll forms), and the light/dark theme with a two-layer token system already exists. Farm Monitor has **no screen**: farm events reach the owner only through chat. Earlier reviews (`docs/reviews/`, 16–28 Sep) were read as background. Where a finding repeats one of them, that is noted, because a repeat means the fix didn't land.

---

## 1. Summary

1. The foundation is better than it looks. The tokens are real (3 `dark:` variants in the whole app, 6 raw palette classes, 24 arbitrary values), both themes pass a 122-check contrast gate, and the domain semantics (precision, provenance, approval versus execution) are careful.
2. The surface is a document, not an instrument. Every screen is a vertical stack of equal-weight, full-width white cards with 12–14 px text. Nothing is ranked by urgency, and the 1400 px rows make the eye cross the screen for every status.
3. The UI explains its data model to the user. Forms and cards carry paragraphs written for the developer ("a stable identifier, not a display name", "there is no default, because a default is how 'exact day' gets applied to a guess").
4. The agent surfaces are sound in mechanics but thin on consequence. The approval card shows *what* will be written but not *what it replaces* or that it can't be undone. An interrupted stream leaves a truncated number on screen with no "incomplete" mark.
5. A redesign is a re-skin plus a hierarchy change, not a rewrite. The token layer makes theming cheap. The real work is type scale, information density, status tones and a Today page that ranks attention.

**The 3 biggest problems**

- **No "needs attention" surface.** Today gives an overdue health task the same weight as "Morning · recorded". Farm Monitor anomalies and pending agent approvals appear nowhere outside chat. On an empty registry Today says "0 overdue · nothing expected", which reads as all clear. (F01, F02, F03)
- **Text the owner has to wade through.** Body text is mostly `text-sm`/`text-xs` (195 + 127 uses against 1 `text-base`), even though the design-system doc specifies 16/24 body. Developer-facing explanation paragraphs sit on every form, and raw enums and ISO timestamps leak into the UI. (F05, F06, F07)
- **Agent trust gaps at the moment of decision.** The approval card doesn't show before → after, and doesn't warn that flags overwrite and can't be undone. Every card state uses the same clay badge. Interrupted output isn't marked as incomplete. There's no Stop control. (F12–F16)

### Scores [re-run]

**Audit health: 14/20 (Good: address weak dimensions)**

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 3 | Token contrast passes in both themes (122 checks, 0 failures). There are 20 `role="alert"`, 25 `role="status"` and 6 `aria-live`, and field errors are wired with `aria-invalid`/`aria-describedby`. Gaps: placeholders at 2.5:1 (F30), a blocked session-gate button with no linked reason (F31), status partly carried by colour alone (F01, F09). |
| 2 | Performance | 3 | Initial bundle is 349 kB in the dev build, routes are lazy, and there is one keyframe with no `will-change`. Nothing visibly janky. Not profiled beyond this. |
| 3 | Theming | 3 | Channel-triplet tokens are used throughout: 3 `dark:` variants, 6 raw palette classes, 3 hex literals. Dark mode is coherent. Leaks: the placeholder colour is Tailwind's default `#9ca3af`, with no token (F30); the badge tone is fixed (F13); the chart legend swatch is broken (F20). |
| 4 | Responsive (laptop scope) | 3 | No horizontal overflow on 8 routes at 1280 and 1024. Doubling the root font size reflows cleanly. Sub-nav links are 20 px tall (spacing exception applies). Some sizes are in `px` and ignore the user's font setting (F35). Mobile was out of scope. |
| 5 | Implementation integrity | 2 | The static detector found 0 issues but warns this is an undercount. Runtime scans found nested cards and side-tab accents on Health, placeholder contrast, 131-character lines and a straggler. The visual layer is category-generic (F36). |

**Critique (Nielsen): 25/40 (Acceptable)**. Visibility of status 2 · Real-world match 3 · Control and freedom 3 · Consistency 2 · Error prevention 3 · Recognition 2 · Flexibility 3 · Minimalism 2 · Error recovery 2 · Help 3.

**Cognitive load: high.** It fails 5 of 8 checks: single focus, chunking, visual hierarchy, minimal choices and working memory. Progressive disclosure is only partial. Decision points with more than 4 visible options: top nav (6 sections plus 4 utilities), Health header and filters (3 actions, 3 chips, 4 filters), animal detail (5 controls in two rows), the analytics control bar (6), and the 26-option dam select.

**Design specificity.** Content and interaction are authored for this farm: herd vocabulary, precision dates, provenance, the recording-session source, roster shortcuts, and ineligible dams shown with a reason. The visual layer is not: system sans, warm grey, white rounded bordered cards, caps labels and one clay accent would fit any CRUD app, and nothing in it encodes urgency. The redesign should keep the interaction model and rebuild the visual system around status and attention.

---

## 2. Findings

Severity: **P0** blocks use · **P1** hurts daily use · **P2** polish · **P3** nice-to-have. Paths are relative to `docs/` unless they start with `web-angular/`.

| ID | Screen | Issue | Sev | Evidence | Recommended fix |
|---|---|---|---|---|---|
| F01 | Today | Overdue health ("1 overdue") is plain text in a neutral row, same weight as "Morning · recorded". Only unanswered milking gets an amber border, so the most urgent item is the least prominent. | P1 | `screens/today.light.png` | Rank rows by urgency: an attention band at top (overdue health, withdrawals that affect today's milk, pending approvals, flagged farm events), then today's outstanding work, then done items collapsed into a count. Use the danger tone for overdue. |
| F02 | Today / global | Farm Monitor (classified events, daily summaries, anomaly flags) has no UI. Flags exist only as chat tool results, so an urgent event is invisible unless you ask. | P1 | No route in `web-angular/src/app/app.routes.ts`; data in `farm_events` via `server/src/tools/farmReads.ts` | Add a Farm Monitor review screen and an attention item on Today (see Gaps G1). |
| F03 | Today (empty) | With an empty registry every row says "nothing expected" / "0 overdue" / "nobody salaried". A fresh install reads as all clear instead of "herd not set up". | P1 | `empty/empty-today.light.png` | Show a setup state when there are 0 animals: the backfill sequence (acquired animals → calvings oldest first → health history) with progress. |
| F04 | Global | After navigation the shell focuses the page heading programmatically. The heading then shows the browser's **default blue** outline as a full-width box, which looks like a selected input and doesn't match the clay focus token. **[re-run]**: confirmed by both assessments; the outline is the browser default, not the token. | P2 | All `screens/*.png`; `web-angular/src/app/registry/registry-shell/registry-shell.ts:150-168` | Keep the focus move (it's right for screen readers) but style `h1[tabindex="-1"]:focus` without the outline, or show the outline only on keyboard navigation. |
| F05 | Global | Type scale isn't what the doc specifies. `design-system.md` says body 16/24, but templates use `text-sm` 195×, `text-xs` 127× and `text-base` 1×. Metadata, hints and status are all 12 px. Too small for a reading-at-a-laptop transcription surface. | P1 | `grep` counts over `web-angular/src/app`; `reference/ui/design-system.md` "Type" row. **[re-run]**: `PageHeading` is `text-lg` (18 px), and `SectionHeading` and `SubHeading` are both `text-sm` (14 px), differing only in weight (`web-angular/src/app/ui/heading.ts:24-38`). Some pages hand-roll a ~24 px `<h1>` instead, so page titles render at two sizes (Today/Herd versus Milking). | Define the scale as tokens (`--text-body`, `--text-meta`, …) and enforce it through `ui/text.ts` components. Make 15–16 px the default body and reserve 12 px for true metadata. |
| F06 | All forms | Developer-voice help paragraphs on every field group: "A stable identifier, not a display name", "there is no default, because a default is how 'exact day' gets applied to a guess", "Post number and ear tag are attributes, not identity". Repeat of the 28 Sep audit's "excessive explanatory content". | P1 | `screens/animal-new.light.png`, `screens/calving-new.light.png`, `screens/milking.light.png`. **[re-run]** detector: the help text at `web-angular/src/app/registry/animal-form/animal-form.html:100` runs ~131 characters per line, bypassing the project's own 68ch `appHelp` cap. | Cut each to a short farmer-voice hint or an example placeholder. Move the rationale behind an (i) or into docs. |
| F07 | Herd, Milking, Health, Approval | Raw machine values shown to the user: `born_on_farm`, `cycle_card · card-01`, `feed_store`, `farm_event_3fa9c1`, `2026-11-08T18:00:00+05:00`, "instruction(s)". | P2 | `screens/animals.light.png`, `screens/animal-detail.light.png`, `screens/health.light.png`, `assistant/approval-card.light.png` | A single label/format layer: enum → label map, one date formatter (`6 Nov, 18:00`), pluralisation, and IDs only inside "Technical details". |
| F08 | Calving form | The "Observed by" hint says "nobody observed a **purchase** record" on the calving form, because the hint is hard-coded in the shared identifier input. | P2 | `screens/calving-new.light.png`; `web-angular/src/app/registry/identifier-input/identifier-input.ts:36` | Make the hint an input set by each form. |
| F09 | Milking roster | Withdrawal notices (milk must not be sold) render as neutral grey boxes in the entry column and push the litre inputs down. Every row is tinted amber because it's unanswered, so a food-safety warning carries less visual weight than "not yet entered". | P1 | `screens/milking.light.png` | Show withdrawal as a danger-tone row marker with a one-line consequence ("Milk withheld until 8 Nov"). Collapse the source detail into a disclosure. Use a single subtle marker for "unanswered" instead of a whole-row tint. |
| F10 | Milking roster | "Recording is off, so this session cannot be saved yet" appears only in the bottom save bar. You can type every value before finding out. | P1 | `screens/milking.light.png` (bottom) | When browsing, show the gate at the top of the sheet, or make the inputs read-only with an inline "Start recording to enter" prompt. |
| F11 | Herd | No status filter: departed animals sit between active ones, and the only control is free-text search. Names render in monospace alongside IDs. "Add animal" is a text link at the far right. | P1 | `screens/animals.light.png` | Default to an active-herd view with filter chips (in milk, dry, heifers/calves, males, departed) and counts. Use mono for identifiers only. Make "Add animal" / "Record calving" primary buttons. |
| F12 | Approval card | The card shows the proposed values but not the current value or the consequence. `flag_anomaly` overwrites any prior verdict and **cannot be unflagged** (tool description), yet the card says neither. | P1 | `assistant/approval-card.light.png`; `server/src/tools/farmWrites.ts` (description and `buildCard`) | Card contract: *Change* (before → after), *Effect* (one line on what this changes and whether it can be undone), *Source* (the event, linked). Supply before/after from `buildCard`; the UI renders it. |
| F13 | Approval card | The badge uses `tone="brand"` (clay) for every state: Approval requested, Recorded, Rejected, Not recorded, Outcome unknown. The tool chip's dot is the same green for "Success", "Awaiting approval" and "Rejected". State is carried by text alone. | P1 | `assistant/approval-card.light.png`, `assistant/approval-approved.light.png`, `assistant/approval-rejected.light.png`; `web-angular/src/app/components/confirmation-card/confirmation-card.html:3` | Map state → tone: requested = warning, recorded = success, rejected/not recorded = neutral with strike or icon, unknown = danger. Give chips the same mapping. |
| F14 | Chat (interrupted) | A stream cut mid-number leaves "fell from 1,262 L to 1,19" on screen as if final, with a raw "network error" banner and no retry. | P1 | `assistant/stream-cut.light.png` (synthetic cut). **[re-run]**: the tool chip beside the truncated text still says **Success**. That is the tool's status, but it reads as the run's. Show the run's status separately. | Mark the turn as incomplete inline ("Response interrupted, figures may be cut off"), keep the partial text visually de-emphasised, and offer *Retry this question*. Translate transport errors into plain language. |
| F15 | Chat (streaming) | While streaming, the composer placeholder says "Resolve the pending action above to continue…" when there's no pending action (busy and pending share one message), and there's no Stop control. | P2 | `assistant/streaming.light.png`; `chat-store.ts` `busy = loading ‖ pending` | Separate copy for "Answering…" and "Waiting for your approval". Add Stop (abort the run). |
| F16 | Chat | Output order puts the agent's prose first, then the chart, then the tool chips (provenance last). After approval, the model's "Done — …" text sits *above* the system receipt, so the claim reads before the proof. | P2 | `assistant/answer.light.png`, `assistant/approval-approved.light.png` | Show tool activity as a compact "Checked: farm events, milk production" line *above* the answer. Show the receipt as the authoritative outcome, with model prose secondary. |
| F17 | Chat | Starter prompts reference "the Kundi group" and "Log this morning's milking". Those are demo-table concepts. Registry writes are refused by design (README), so a starter invites a write the assistant cannot make to the real records. | P1 | `screens/chat.light.png`; README "Registry agent tools are read-only" | Generate starters from real registry state ("Which animals are overdue for a dose?", "Summarise last night's farm events"). Never suggest writes that target demo tables. |
| F18 | Chat page | On `/chat` the top nav marks **Today** as active. | P2 | `screens/chat.light.png`, `assistant/*.png`. **[re-run]** cause: `sectionFor` falls back to the first section (`web-angular/src/app/registry/navigation.ts:56-63`). | Give the Assistant route its own nav state (or none). |
| F19 | Chat | The agent label renders as "‹ dairy ›", which means nothing to the owner. | P3 | `assistant/approval-card.light.png` | Drop it, or say "Herd assistant" / "Sales assistant" with a tooltip. |
| F20 | Chat chart | Total litres (≈170) and avg/animal (≈11) share one y-axis, so the average is a flat line near zero. The dispatch/avg legend swatch renders as a scribbled black/white blob in both themes. | P2 | `assistant/answer.light.png`, `screens/analytics.dark.png` | Use a second axis or small multiples. Render the dashed-series legend as a short dashed line, not a hatched fill. |
| F21 | Analytics | The "Difference" card is a run-on list of qualifiers ending in "measurements..". The daily chart plots 2 points across 1300 px. The metric cards are tall and mostly empty. | P2 | `screens/analytics.dark.png` | Give each metric one qualifier chip (e.g. "partial · 5/12"), with the full reasons in a tooltip or the Records-to-review block. Fix the double period. Hide the chart in day view, or show the last 14 days with the selected day highlighted. |
| F22 | Animal detail | The tabs (Record / Add an event / Correct a calving) and two action buttons share one row, and the buttons hang under the tab line. The timeline runs oldest-first. Calves ("calf BD-0016") aren't links. There's no lactation summary, dam/sire, offspring or milk trend. | P1 | `screens/animal-detail.light.png` | A header with identity, status, dam/sire links and current lactation (DIM, last yield, withdrawal). Actions in one toolbar. Timeline newest-first and grouped by lactation. Every animal reference is a link. |
| F23 | Calving form | Choosing a dam takes two controls: a search box *and* a native `<select>`. Sire is free text. | P1 | `screens/calving-new.light.png`; `web-angular/src/app/registry/calving-form/`. **[re-run]**: "Observed by", "Acquired from" and sire are free-text identifiers with no autocomplete, so a typo silently creates a new person. The synthetic data already shows it: /check flags "'rafiq' … not a person on file". | A single combobox (type-ahead over serial/name/tag, ineligible items shown disabled with a reason). Make sire a combobox too, with "external sire" as an option. |
| F24 | Forms | Grouping is inconsistent on one page: a card with a caps label, a fieldset with a legend breaking its border, then bare fields outside any group. Defaults are inconsistent too (Sex pre-selected Female, Calf sex unselected, Outcome pre-selected Live). | P2 | `screens/animal-new.light.png`, `screens/calving-new.light.png` | One form-section component. A rule: no pre-selection for facts, defaults only where the doc says so (today's date on the roster). |
| F25 | Dates | Native date inputs render `06/11/2026` (locale dd/mm). Tables use `2026-11-06`, Analytics shows `06-Nov-2026`, and health uses ISO with offset. Four date formats. | P2 | `screens/milking.light.png`, `screens/analytics.dark.png`, `screens/health.light.png` | One display format (`6 Nov 2026`) and one typed-entry grammar (already exists in PrecisionDate). Use PrecisionDate for every date, including the roster and health board. |
| F26 | Health | The withdrawal section repeats the same three-line block for each animal and withdrawal type (5 near-identical grey boxes). The filters are spread over three rows. | P2 | `screens/health.light.png`. **[re-run]** detector: 7–10 **nested-cards** (`article.health-task` inside `appCard`, `health-page.html:315`; withdrawal `section` inside `appCard`, `withdrawal-notices.html:4`). Also **side-tab**: a 4 px start border plus a 12 px radius on task cards (`styles.css:761-763`). | Make withdrawals a table (animal, type, until, action) with source detail on expand. Put filters in a single toolbar. Flatten the card nesting into one surface with rows, and carry status in a badge or row marker rather than a side tab. |
| F27 | Header | The theme control reads "Light" / "System · light" as plain text, so it's unclear whether it shows the current state or is an action. The "harness · in memory" / "browsing" pills compete with the wordmark. | P3 | `screens/today.light.png` | Use an icon toggle with tooltip. Show the recording mode as one session control, not two pills. |
| F28 | Visual identity | The wordmark is plain text, and the only expression is a 🐃 emoji in empty states. There's no brand presence beyond the clay accent. | P3 | `screens/chat.light.png`, `empty/empty-animals.light.png` | Handle in the redesign: a mark and one restrained illustration style for empty states. |
| F29 | Assistant panel | At an ~800 px browser width the side panel opened as a blank full-screen sheet (header and Close only). At 1440 it renders correctly. Seen once in the browser pane and not reproduced. | P2 (unverified) | Observed during Step 1 at 800×600 | Re-test at narrow laptop widths before the redesign. |
| F30 **[re-run]** | Health, Chat, Add animal | Placeholder text renders at **2.5:1**: Tailwind's default `#9ca3af`, because no placeholder token exists. Affected placeholders include the date-format hints ("2019, Mar 2019, or 6 Jul 2023"), and those carry real instructions. | P2 | Detector overlay on `/animals/health`, `/chat`, `/animals/new`; no `::placeholder` rule in `web-angular/src/styles.css` | Add a `--text-placeholder` token in both themes at ≥4.5:1. Never put required guidance only in a placeholder. |
| F31 **[re-run]** | Session gate | The "Start entering" button is blocked through `appButtonDisabled` with no `reason`, so activating it announces nothing. The animal form's submit does link its reason (`reason="animal-submit-reason"`). | P2 | `web-angular/src/app/registry/session-gate/session-gate.html:110-115`; contract in `web-angular/src/app/ui/button.ts:24-31,107` | Pass `reason` with a visible hint ("Choose a source and enter who is typing"). |
| F32 **[re-run]** | Chat (run error) | The error appears twice: once as the tool chip's reason and again as the banner. The chip text says "Execution outcome is unknown", wording meant for writes, applied to a read-only `get_farm_events`. | P2 | `assistant/run-error.light.png`; `web-angular/src/app/core/chat-store.ts` `runAgent` finally-block | Show the error once. Use "unknown outcome" wording only for write tools. Offer Retry. |
| F33 **[re-run]** | Global | The browser tab title is "Dairy Farm Agent", but the product is "Dairy 360". | P3 | `web-angular/src/index.html` `<title>` | Use the per-route title "Herd · Dairy 360". |
| F34 **[re-run]** | Global | `prefers-reduced-motion` is a blanket `0.01ms` kill on everything. State is still conveyed (the "Thinking…" text and the busy label remain), so the impact is small. But the audit method flags blanket kills because they remove useful feedback by default. | P3 | `web-angular/src/styles.css:655-673` | Handle reduced motion per component: keep a static indicator for the streaming and busy states. |
| F35 **[re-run]** | Global | Several sizes are fixed `px` in `styles.css` (12 px chips, 14 px labels and save bar), so they ignore the user's browser font setting. Rem-based text reflowed cleanly at 2× root size. | P3 | `web-angular/src/styles.css:754-769`; `responsive/1280-text200_*.png` | Move those sizes into rem-based type tokens (F05). |
| F36 **[re-run]** | Global | Design specificity: the visual layer is a stock admin kit, and nothing in it is specific to a farm or encodes urgency. This finding is the reason for the redesign rather than a defect. | P2 | Critique A verdict; all `screens/*.png` | Build the redesign's visual system around status and attention (section 5). |

**What is already right (keep it):** semantic token layer with channel triplets and a contrast gate; native controls; draft guards; number-key segmented choices (`1 Female`); disabled-submit-with-reason ("Enter the arrival date."); precision-qualified dates (`~2018 est`, `2017-03 month`); herd empty state with a clear CTA (`empty/empty-animals.light.png`); approval → separate execution receipt; Cmd/Ctrl+Enter save.

---

## 3. Gaps (missing states, screens and patterns)

| ID | Gap | Why it matters |
|---|---|---|
| G1 | **Farm Monitor screen**: a timeline of classified events per night/day, filters by zone/severity, flag/unflag, daily activity summary, and a link from the event to chat. | Today the camera system's output is only reachable by asking the assistant. |
| G2 | **Attention model**: one cross-domain "needs you" list (overdue health, active withdrawals, unanswered sessions, pending approvals, urgent events) that drives Today and a header count. | There's no single place to answer "what needs me right now?". |
| G3 | **Pending approvals outside chat**: if a run pauses for approval and you navigate away or close the panel, nothing in the shell shows a decision is waiting. | An approval can be forgotten. |
| G4 | **Backfill / setup flow** for the empty registry, with progress (animals entered, calvings entered, gaps). | OPEN-001/002: the backfill hasn't run. This is the first real job the UI must do. |
| G5 | **Lactation view**: the current and past lactations per animal (start, DIM, dry-off, yield), plus a herd-level "in milk / dry / due to calve" view. | Lactations exist in the schema (`registry_lactations`) and feed days-in-milk on the roster and the life report, but there is no screen for reading them. |
| G6 | **Pedigree links**: dam → offspring and sire on animal detail, and a click-through family view. | The brief names dam links as a goal; today calves are plain text. |
| G7 | **Departures as a first-class flow** (sold / died / culled, with date precision, buyer/price, reason), plus a departed-animals filter. | Departure is only reachable through generic event/correction forms. |
| G8 | **Stop / retry / regenerate** in chat, and a persistent conversation history across reloads. | Long streams can't be cancelled, and a failed turn can't be retried in one click. |
| G9 | **Toast / undo pattern** after saves on non-gated writes, where the domain allows. | Saves give inline confirmation only, inconsistently per screen. |
| G10 | **Print / export of the herd list** (life report and statements print already). | A common paper workflow on farms. |

---

## 4. Registry entry UI: what's still needed

The forms exist. What's missing is the set of shared patterns that would make ~35 animals' worth of backfill fast and safe:

1. **Record combobox** (dam, sire, calf link, buyer, person): type-ahead over serial, name and tag; ineligible items visible but disabled with a reason; keyboard-complete; "create new" escape hatch. This replaces the search + `<select>` pair (F23).
2. **Shared field contract in use everywhere.** `ui/field` exists, but the 28 Sep audit found the calving dam error lacked `aria-invalid`/`aria-describedby`. Confirm every form uses it. Add focus-to-first-error on submit.
3. **One date component** (PrecisionDate) for every date, including the roster and health board, with one display format (F25).
4. **Batch / sequential entry mode**: "Save and add another calving for the same dam" and "next animal" without leaving the form, with a running list of what was entered this session on the side. Backfill is long-form, repetitive entry.
5. **Review-before-commit summary** for multi-record entries (calving creates a calf, opens a lactation and bumps parity). Show the derived effects before saving, the same way the approval card should (F12).
6. **Lactation and departure forms** with their own entry points (G5, G7).
7. **Inline duplicate warning** is already present (`duplicate-warning/`). Keep it and make it visually distinct from help text.
8. **Short help copy**: a one-line hint per field and an example placeholder. The rationale moves out of the form (F06).

---

## 5. Redesign groundwork

**What DESIGN.md (and the token system) should cover.** `docs/UI_SYSTEM.md` and `reference/ui/design-system.md` already cover tokens and component contracts. DESIGN.md should *replace* the visual sections and keep the meaning contracts.

1. **Principles.** Operate mode: rank by attention; numbers first; uncertainty shown, never hidden; system receipts outrank model prose.
2. **Colour tokens** (keep the channel-triplet mechanism and the contrast gate): surfaces (page/raised/sunken/overlay), text (primary/secondary/muted/disabled), lines (hairline/control/strong), accent, and **status roles with a fixed meaning**: danger = act now / unsafe (withdrawal, overdue, unknown outcome), warning = needs an answer (unanswered, pending approval), success = recorded/executed, info = agent / informational, neutral = done/historical. Light and dark values for each, matched for perceived contrast.
3. **Type scale as tokens**: display 28, page 22–24, section 17–18, body 15–16, meta 13, micro 12 (mono numerals only). Tabular figures for all quantities. One sans and one mono, with rules for when to use mono (identifiers and quantities only).
4. **Spacing and density**: a 4 px base, two densities (comfortable for forms, compact for review tables), max content widths (entry 720, review 1200, not 1400).
5. **Components**: AttentionItem, StatusBadge (role-driven), RecordCombobox, PrecisionDate, FormSection, EntrySheet row, DataTable with filters and toolbar, MetricTile (number + one qualifier chip), Timeline, ApprovalCard (Change / Effect / Source / Decision / Receipt), ToolActivity line, Toast.
6. **Formatting rules**: dates, litres, rupees, durations, enums → labels, plurals, IDs.
7. **Voice**: farmer-facing copy, a one-line limit for help text, error messages that say what to do next.
8. **States per component**: empty, loading, partial, error, interrupted, disabled-with-reason.

**Suggested order of work**

1. **PRODUCT.md and DESIGN.md first** (a day). Record the attention model, the status-role meanings and the type scale as decisions before any pixels move. Resolve the F05 doc-versus-code mismatch on paper.
2. **Tokens and type pass** (low risk, high reach). Re-point the token values for the new direction in both themes, add the type tokens, and keep `check:contrast` green. Most screens change with no template edits. Fix F04 here.
3. **Status roles and badges** (F13, F09, F01 tone). One component, many screens.
4. **Formatting layer** (F07, F25). Labels, dates and plurals in one module.
5. **Attention model + Today + Farm Monitor screen** (F01–F03, G1–G3). The biggest change to daily use.
6. **Approval card and chat states** (F12, F14–F17).
7. **Form patterns, then the registry entry additions** (F23, F24, F06, section 4): the combobox first, then batch entry, lactation and departure flows.
8. **Herd list and animal detail** (F11, F22, G5–G6).
9. Analytics and Health tidy (F21, F26) last; they work today.

Re-run `npm run shots` before and after steps 2–3 for a visual diff of every screen in both themes.

---

## 6. Re-run verification notes [re-run]

**Where the two assessments agreed with the first pass:** F01, F04, F09, F12, F13, F14, F18, F20, F22, F23, F25, F06 and the empty-Today problem (F03) were raised independently by the isolated design review, which did not see this document.

**New from the re-run:** F30–F36, plus additions to F04, F05, F06, F14, F18, F23 and F26. Strengths the review added: the date field reads back what it parsed ("reading as month only — 2019-03, stored as the 1st"), and the recording session declares source and recorder once, and every event then carries them.

**Claims checked and rejected:**
- *"Keystrokes typed right after ⌘K are dropped while records load."* Not reproduced. A scripted Cmd+K followed by "noo" kept all three characters. It may be a first-load race; it's unconfirmed, so it isn't listed as a finding.
- *"'Who is typing?' has no associated label."* False. It has `<label for="session-recorder">` (`session-gate.html:27-33`).
- *"Blocked submits never link their reason."* Only partly true. The animal form's submit does link it; the session gate's doesn't (F31).
- *"After Escape, focus goes to the heading instead of the Search trigger."* Reproduced, but when the palette is opened with ⌘K there is no trigger to return to, so the heading is a reasonable target. Not listed.
- Detector: the disabled-checkbox contrast flag is exempt (WCAG 1.4.3 inactive control). The em-dash flag on Health comes from one template string repeated by the data, so it's a false positive.

**Not checked:** screen-reader output (the DOM was checked, but VoiceOver wasn't run); real saves; the live model; and the dispatch, buyers, feed, labour and life-report screens beyond their screenshots. Narrow widths below 1024 weren't checked because they're out of scope.

## 7. Recommended impeccable commands [re-run]

In order. Each maps to findings above. Per section 5, the redesign itself starts with `init` (PRODUCT.md) and `document`/`shape` (DESIGN.md).

1. **[P1] `/impeccable onboard`**: empty-registry Today with a backfill checklist and order (F03, G4).
2. **[P1] `/impeccable layout`**: attention band and ranking on Today, Farm Monitor screen, approval count in the shell (F01, F02, G1–G3); animal detail header and toolbar (F22).
3. **[P1] `/impeccable clarify`**: approval card Change / Effect / Source; farmer-voice help copy; enum, date and ID formatting (F12, F06, F07, F08, F25).
4. **[P1] `/impeccable harden`**: chat interrupted, error, stop and retry states; separate tool and run status (F14, F15, F32); session-gate reason link (F31).
5. **[P1] `/impeccable shape`**: record combobox for dam, sire and people, plus batch backfill entry (F23, section 4).
6. **[P1] `/impeccable typeset`**: one type scale as tokens, page and section heading sizes, no px text (F05, F35).
7. **[P1] `/impeccable colorize`**: status roles mapped to meaning (badges, chips, withdrawal danger, placeholder token) (F13, F09, F30).
8. **[P2] `/impeccable distill`**: Health and Analytics density, nested cards, qualifier walls (F21, F26).
9. **[P2] `/impeccable polish`**: heading focus outline, nav state, window title, legend swatch, reduced motion (F04, F18, F20, F33, F34).
