---
version: 1
slug: "c-app-registry-today-board-today-board-ts-de17d8a3"
primary_target: "web-angular/src/app/registry/today-board/today-board.ts"
related_targets: ["web-angular/src/app/registry/registry-shell/registry-shell.ts"]
---

# Today: surface brief

Mode: **Operate**. Code-led build. Laptop widths 1024–1600 px, light and dark themes. Confirmed with the owner on 6 Nov 2026.

## Job, audience, outcome
- **Who and when:** the owner, alone at a laptop, opens Today before or around each milking session to answer "what needs me now?".
- **Success:** every item that needs action is visible in one look and can be acted on in one click from Today.
- **Data:** demo data stays synthetic and labelled. No real herd is entered yet.

## Scope (this cycle)
- **In:**
  - token and type foundation for both themes
  - status colour roles
  - Today rebuilt as a ranked attention surface
  - the session board in the shell (full height on Today, a compact strip elsewhere)
  - a Farm Monitor review screen
  - a pending-approval count on the Assistant button
  - an empty-registry setup checklist
  - "not for sale" markers for active milk withdrawals on the milking roster
  - shell fixes: the heading focus box, the active nav tab on /chat, the window title
- **Out (next cycle; inherits tokens only):**
  - approval-card and chat states
  - record pickers and batch entry
  - lactation-grouped animal history
  - the quick-add event button
  - generated dry-off, pregnancy-check and calving lists beyond the slots reserved for them
- **Untouched:**
  - the domain meanings in PRODUCT.md
  - draft guards
  - the recording-session gate
  - native controls

## Patterns adopted (from dairy-software research, 6 Nov 2026)
- **Attention list as home.** Ranked by severity, each item carrying a state (new, ongoing, getting better, getting worse). Lely Horizon and CowManager use this pattern.
- **Generated work lists.** Slots are reserved on Today for these lists. This cycle shows health due work and withdrawals (AfiFarm, DairyComp, MyHerd, Uniform-Agri).
- **Withdrawals block milk sale.** Top severity, shown with the end date. Herdwatch and the milking-robot SOPs work this way.
- **Status colours admit farm-defined, expiring animal flags later** without a new colour system (Uniform-Agri).

## States and ranges
- **Normal:** under 40 animals, 0–10 attention items, 0 to about 30 Farm Monitor events a night.
- **Empty registry:** a setup checklist in four steps (acquired animals, calvings oldest first, health history, start daily recording).
- **Nothing pending:** an explicit "all clear for this session", with the next session's time.

## Open decisions (owner's)
- Real session times: 05:30, 07:00, 17:30 and 19:00 are taken from the demo data.
- Whether milk records get fat and SNF.
- Farm Monitor history retention.

## Direction contract
- **THESIS:** The farm's day is a board of fixed sessions, and the current session is lit. Today ranks what needs the owner beneath that board. It refuses the category default of KPI tiles over a flat grey list.
- **OWN-WORLD:** Deep green header band (#0f3d2e) with a gold lit slot (#d4a72c), on a neutral near-white ground (a green-tinted near-black in dark). Red is reserved for danger, always paired with a text badge. Archivo throughout with tabular figures. Session slots carry large figures. Rows have a severity marker bar, one action, and no nested cards.
- **STORY:** The owner sees where the day stands (done sessions dimmed, the next one lit), then what needs them now, acts on the top item, and records the lit session.
- **FIRST VIEWPORT:**
  - **Header band:** nav, Search ⌘K, and Assistant with its count, then five session slots across the full width, the current or next slot lit gold.
  - **Left column:** "Needs you" rows (overdue dose, milk withdrawal not for sale until a date, approval waiting, flagged event), then "Also open".
  - **Right sidebar:**
    - "Milk today" (litres, a 7-day one-bar-per-day graph, lowest day red with a caption, today's bar partial until both sessions are recorded)
    - an overnight Farm Monitor summary
    - herd counts in the farm's terms
- **FORM:** Session Board (masjid daily timings board, its fixed-session rhythm only), position 1 on the ordered list. The 7-day milk graph was carried over from Platform Timetable at the owner's request. seed:46806c0ebaa75f78
- **FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
