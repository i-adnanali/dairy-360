# Feed management — implementation specification and session handoff

Date: 2026-09-10. Repository baseline inspected: `e7fc20e`.
Status: implemented on 2026-09-10. This document preserves the original farm
requirements and proposed defaults; [REGISTRY_FEED.md](REGISTRY_FEED.md) records
what shipped, verification, material deviations and the database-isolation incident.
The implementation order and next-session prompt below are historical handoff text,
not outstanding instructions to restart this work.

## 1. Purpose and authority

Build feed management end to end inside Dairy 360: own fodder crops and their expenses, purchased feed, and one daily feeding summary integrated into Today. The user requested this document to carry into a new implementation session.

The user confirmed the operating facts below and explicitly chose one daily summary. Detailed schemas, routes and edge-case policies below are proposed implementation defaults, not claims that the user individually approved each technical choice. Proceed with these defaults when asked to implement; explain material deviations and ask only if a consequential ambiguity cannot be resolved from this document and current code.

The app must remain useful for the owner's own farm regardless of future commercial adoption. Currently it runs locally, with one operator on their own device. Authentication, public signup, tenancy, billing and deployment are outside this feature. `AUTH_HANDOFF.md` predates these later decisions and must not be treated as a requirement to implement authentication.

## 2. Confirmed farm practice

- The owner grows seasonal fodder on owned agricultural land, allocating a couple of acres according to need. Shortfalls are covered by nearby purchases.
- Fresh fodder is cut daily, judged sufficient for the day, and is not weighed.
- Silage is used intermittently, bought by weight and priced per 40 kg. Home-made silage is a future possibility, not current practice.
- Wanda and khall are usually given to milking animals. Amounts are judged personally, not routinely weighed.
- Khall is bought by weight, priced per 40 kg. It is placed in a designated container and fed dry or sometimes mixed with water. That container is not a calibrated weight unit.
- Other additions include ginger, green chilli, spices and ghee, sometimes targeted to pregnant animals. Record the operator's stated purpose without claiming medical/nutritional efficacy or recommending doses.
- One daily feeding summary is enough initially. No morning/evening split is required.
- Recipients of fresh fodder and silage have not been exhaustively established. Do not silently assume every animal receives them.

## 3. Product scope

Deliver:

1. Editable feed-item catalogue with archive support and inline creation.
2. Seasonal crop records, dates, acreage, status and crop expenses.
3. Feed purchases in original units with explicit pricing basis and costs.
4. One daily feeding summary with multiple feed lines, sources, recipients, optional quantities, preparation and exceptions.
5. Today integration, Feed overview, history, review/correction, navigation and command-palette integration.
6. Persistent backend, API, meaningful tests, isolated fixtures, screenshots and updated documentation.

Defer inventory balances, stock depletion, nutritional formulation, recommended feeding quantities, measured intake, yield per acre, cost per animal/litre/kg, automated forecasts, land opportunity cost, payroll allocation machinery, supplier credit/payment ledgers, silage production batches, recurring auto-completed logs, feed agent tools and automatic inferences from milk output.

Purchases are acquisitions and costs, not proof of feeding or payment. Growing crops are expected supply, not weighed stock. Unknown is not zero. Saving a summary means the day's account was recorded; it does not certify nutritional adequacy.

## 4. Repository orientation and non-negotiable constraints

Read applicable `AGENTS.md` files, then:

- `docs/UI_SYSTEM.md`, especially current phases, invariants and unresolved trial constraints.
- `docs/images/phase7/README.md` and actual representative light/dark images.
- `docs/DEVELOPMENT.md` for harness, persistent storage and verification.
- `docs/REGISTRY.md`, `docs/REGISTRY_ENTRY_UX.md`, `docs/REGISTRY_SALES.md`, `docs/REGISTRY_PAYROLL.md`, `docs/OPEN.md`.
- `server/src/registry/schema.ts`, `routes.ts`, `idempotency.ts`, `money.ts`, `milking.ts`, `overview.ts`, `fixtures.ts`, `harness.ts`, `backup.ts`, `invariants.ts` and their relevant tests.
- `web-angular/src/app/app.routes.ts` and registry `api.ts`, `registry-shell.ts`, `navigation.ts`, `command-palette.ts`, `session.ts`, `session-required.ts`, `form-state.ts`, `precision-date.ts`, `today.ts`, `today-board.ts`.

Architecture: Angular standalone components/signals, Express/TypeScript, SQLite via injected database handles. Preserve existing architecture and UI primitives; avoid new dependencies unless a concrete requirement warrants them.

- No synthetic data in the persistent database. Use injected in-memory DBs and the fixture harness. Do not run root `seed` for this feature.
- Add a migration using the existing runner; never reset, drop or rewrite existing farm records to introduce feed.
- Feed is a separate domain; do not encode feed records as animal lifecycle events or alter their append-only guarantees.
- Preserve recording provenance (`source_form`, `recorded_by`, and existing applicable source-reference support). Never treat provenance as authentication. Witness fields, if exposed, remain optional and never default to recorder.
- Reads work without recording setup. Writes retain the existing provenance and storage-target safeguards.
- Preserve unfinished forms through provenance editing and nested purchase/item creation. No new persistent browser drafts without separately revisiting that existing constraint.
- Preserve current border tokens, date-precision and write-log conventions. Document the changed UI trial baseline honestly: the real five-animal trial was not completed at this baseline.
- Root `npm run dev` starts the persistent server and frontend; `npm run harness:app` starts isolated fixtures. They compete for port 4000.

## 5. Navigation and screen flow

Primary navigation: Today, Herd, Milk, Feed, Labour; retain Check in its established position. Feed uses the existing shell and contextual page conventions, not a new visual system.

Proposed routes (adapt naming only if current route conventions require it):

| Route | Purpose |
|---|---|
| `/feed` | Overview with date range and links to actions |
| `/feed/crops` | Active and finished crop cycles |
| `/feed/crops/new` | Add a crop already growing or newly planted |
| `/feed/crops/:id` | Crop detail, edit, expenses and linked supply days |
| `/feed/purchases` | Purchase list and date/item filters |
| `/feed/purchases/new` | New purchase; also usable as an in-flow panel |
| `/feed/purchases/:id` | Review/correct purchase |
| `/feed/daily` | Daily history and missing-day visibility within a selected range |
| `/feed/daily/:on` | Create/review/edit that date's summary |

Catalogue management can be a compact surface inside Feed; do not require a configuration wizard before the first log.

### 5.1 First use

Feed empty state offers Add crop, Record purchase and Record feeding. No historical backfill is mandatory. Adding a crop asks crop name, optional plot label, optional positive acreage, optional sowing date/precision, optional cutting start/end dates/precision, status (growing/cutting/finished), notes. Unknown dates and acreage are valid. A crop can already be cutting when first entered.

Crop and plot names need no separate land-management subsystem. New cycles have distinct IDs even if the same plot/crop names recur. Do not enforce a total-acreage limit or infer land ownership costs.

### 5.2 Normal daily entry

Today → Record feeding → complete compact form → review summary → save → Today.

- Date uses the farm-local calendar (Asia/Karachi), not UTC date truncation. Today links to its selected date.
- Fresh-fodder section: explicitly select own crop(s), purchased source(s), other/unknown source, or none given/unknown. Allow mixtures.
- Supply assessment is explicitly enough/short/surplus/unknown, with not-applicable when no fresh fodder was given. This is the operator's assessment of fresh-fodder supply, not a nutrition calculation.
- Additional items: add wanda, khall, silage or user-defined feed. Suggestions do not assert an item was fed.
- Each item has recipient selection, optional quantity/unit, optional preparation (dry/water-mixed/other/unknown), optional notes/stated purpose.
- Milking group is a shortcut for wanda/khall, not an enforced restriction or automatic claim. Whole herd, selected animals and unspecified recipients remain possible.
- Unknown quantity is explicit and valid; no mandatory scoop/weight conversion.
- Include optional day-level notes. A blank untouched form cannot become a completed summary. An explicit statement that no feeding information is known can be saved as a partial account, visibly distinct from a recorded feeding account.
- Review shows source, recipients, unmeasured labels and provenance, then one server-confirmed save. No silent autosave or optimistic success.

Today after save: an actionable row such as “Feed recorded — own fodder sufficient; wanda and khall to milking animals.” Unknown/partial accounts say “Feed partially recorded.” No record says “Not recorded,” never “Not fed.” Keep Today concise rather than adding financial charts.

### 5.3 Shortfall and nested purchase

Daily entry → select Short → optionally Add purchase → save purchase → return to preserved daily form → explicitly include purchased item if given → review/save daily summary.

A purchase saved in this flow is committed independently. Cancelling the feeding form does not delete it; say so clearly and offer a link. Linking an existing purchase is optional because older stock may be used. Do not require a purchase record to truthfully report feeding purchased material.

### 5.4 Purchase entry

Ask item, delivery date, optional supplier name, quantity/unit if known, pricing basis or known total, optional transport/other charges, notes and provenance.

For measured purchases: 400 kg at Rs 2,000 per 40 kg produces Rs 20,000 goods cost, before extra charges. Preserve “per 40 kg” in the stored agreement and display. Do not turn it into a bag count.

Support a known-total mode for unweighed trolley/bundle purchases or old invoices. Missing quantity must not become zero. Unknown total remains unknown and is excluded from numeric totals with an explicit count. Do not invent a wanda bag size. In rate mode quantity and rate units must be compatible; custom units have no implicit kg conversion.

### 5.5 Crop lifecycle and expenses

Crop detail → Add expense (date, category, amount, notes/provenance) → return to crop detail. Categories include seed, fertilizer, irrigation, hired machinery/cutting, separately incurred labour and other.

Record expenses incurred, not presumed payments. Do not offer existing payroll salary as a new expense. Explain that already-recorded salary costs must not be entered again; automatic allocation is deferred.

Crop detail links to actual recorded supply days and shows expenses recorded so far. Finish crop stops it being a normal current-date suggestion; historical entries can still refer to it. Finishing does not fabricate a last-cut date. Approximate dates remain approximate.

### 5.6 History and corrections

History → date → review → edit → review/save. There is one effective summary per date, not multiple duplicates. Changing the date to one already occupied must refuse rather than overwrite it. Explicit removal requires confirmation and returns the date to unrecorded, with the audit trail preserved.

Purchases/crops/expenses can be reviewed and corrected. Archive items/crops instead of deleting referenced identities. Referenced purchases cannot silently disappear; either refuse removal while linked with an actionable message or retain a voided reference visibly. Use one documented policy consistently.

## 6. Data model and semantics

Use separate `registry_`-prefixed feed tables, stable IDs and the existing database/migration conventions. Exact SQL names are implementation choices; these entities and relationships are required:

| Entity | Required meaning |
|---|---|
| Feed item | Stable identity, editable label/category, archived flag; category supports fresh fodder, silage, concentrate, addition, other |
| Crop cycle | Crop/plot labels, optional acreage, optional dates with precision, lifecycle status, provenance |
| Crop expense | Crop ID, date, category, amount in paisa, notes, provenance |
| Purchase | Item ID, delivery date, optional supplier, original quantity/unit, price basis or stated total, extra charges, provenance |
| Daily summary | Unique local date, fresh-fodder assessment, completeness status, notes, provenance, revision |
| Feeding line | Summary ID, item ID, optional quantity/unit, preparation, recipient designation, stated purpose/notes |
| Line source | One or more crop/purchase references or explicit other/unknown source; no unmeasured allocation percentages |
| Recipient snapshot | Confirmed animal IDs where a resolved group/selection is used, alongside original group label |

Store source references relationally where practical. Never use names as foreign keys. Known quantities must be finite and positive; nullable quantity means unmeasured. Keep preparation water separate from the quantity of feed. Do not add water weight to khall totals.

Recipients: resolve milking membership using the existing date-specific registry logic, present it for confirmation, and persist the confirmed set. Whole-herd membership also requires a date-appropriate existing-animal set. Later animal-history corrections must not rewrite the saved recipients. Editing a historical log preserves its snapshot unless the user explicitly refreshes it. Unknown recipients are allowed and never inferred. No per-animal quantity allocation from group totals.

Daily coverage may be marked complete only after fresh-fodder status and additional-feed status are explicitly answered; “none given” is an answer and “unknown” yields partial status. Recipient/quantity uncertainty does not block a recorded feeding line. Distinguish partial account from no record in the API and UI. Do not require detailed health or adequacy assessments.

Money uses integer paisa and existing rounding conventions; measurements may be decimal. Reuse/generalize pure monetary helpers without changing existing sales results. Rate calculation: goods amount = rounded(quantity / basis quantity × basis price); extras are added exactly once. Keep unknown totals distinct from genuine zero-cost acquisitions.

Date precision applies to crop history. Daily summaries use an exact calendar date; do not invent a day for an approximately remembered entry. Purchase/expense entry can initially require an exact date, with clear copy to defer uncertain backfill rather than silently assign today. Preserve server-generated recorded timestamps separately.

### Corrections and durability

Feed summaries and commercial records need editable effective state, not animal-event supersession. Follow existing write-log conventions and preserve prior content, provenance, operation, entity ID and timestamp for correction/removal. If the existing log cannot reconstruct prior state, add a narrow feed revision mechanism rather than rewriting the existing domain ledger. Document the chosen implementation.

Whole-summary writes (header, lines, sources, recipient snapshots and revision) are atomic. Use revision checks to refuse stale edits from another tab; return a conflict with a reload/review path and preserve the unsaved form. Idempotent retry is not a second revision.

## 7. Backend and API contract

Implement domain functions taking `Db`; never import the live singleton into feed modules or fixtures. Integrate under `/api/registry/feed` using the existing router factory and error mapping.

Required operations:

- List/create/edit/archive items and crops; crop detail with expenses and supply-day links.
- Create/edit/remove expenses under the documented revision policy.
- List/detail/create/edit/remove purchases under reference protections.
- Get/upsert/remove daily summary by date, with revision and complete/partial state.
- Date-range history and overview, plus date-specific recipient suggestions.
- Extend existing Today server read model with feed state and concise summary.

All writes require provenance and `Idempotency-Key` through the existing write wrapper. Validate IDs, types, units, quantities, dates, monetary values, duplicate selections and source compatibility on the server. Existing route conventions determine exact verbs and error shape; no frontend-only business rules. Identical retries return the original result; mismatched key reuse follows current refusal behavior.

Reject crop references on unrelated feed categories. Allow silage with an other/unknown source so future own production is not blocked, but do not build batch production now. No demo-table relationships.

## 8. Read models and reporting boundaries

Overview supports a selected date range and shows:

- Active crops as of recorded lifecycle information, with uncertainty visible.
- Fresh-fodder sufficiency/shortage/surplus counts and links to dates.
- Own-source days, purchased-source days and mixed-source days. These overlap unless shown as mutually exclusive categories; never add overlapping counts as total days.
- Recorded/partial/unrecorded day counts within the range. No manufactured obligations before the chosen tracking start date; default start to the first summary, with an explicit range control.
- Purchases grouped by item and compatible unit; never aggregate kg, bundles and trolley loads into one quantity.
- Purchase costs by delivery date, crop expenses by expense date, with unknown-cost counts. Label these “recorded costs,” not cash paid or feed consumed cost.
- Crop-cycle expenses to date and number of distinct linked supply dates. This is not proven continuous coverage, crop yield or cost efficiency.

Do not claim profitability or a causal relationship between feed and milk yield. Check may expose data-integrity issues or link to missing records, but should not classify an unweighed quantity or normal missing day as corruption.

## 9. UI and integration requirements

- Reuse existing labels, fields, chips, buttons, tables, empty/loading/error states, focus management and both themes. Preserve the held resting border token.
- Quantity uncertainty and date precision must be legible without colour alone.
- Common items are shortcuts, not checked defaults. No source/witness auto-assertions.
- Preserve form state when opening provenance setup, adding a purchase, or creating an item. Refresh still follows the application's current nonpersistent-draft behavior.
- Navigation/command palette link to Feed and its primary actions. Avoid adding sensitive feed tools to the assistant in this scope; ordinary route context can follow existing conventions.
- Route errors and stale-edit failures preserve entered values. Save controls prevent accidental double submits but server idempotency remains authoritative.
- Show persistent/harness storage identity unchanged. New tables must participate in backups and relevant integrity checks; examine any enumerated export/verification lists.

## 10. Acceptance scenarios

1. Empty persistent-schema test DB migrates successfully without demo seed; existing animals/milk/payroll remain unchanged.
2. A crop already being cut is added with unknown sowing date and unweighed output.
3. Today saves own fodder “enough,” wanda and khall to confirmed milking animals, unknown quantities, water-mixed khall. Reload restores the account faithfully.
4. An unrecorded day, partial account and explicit no-fresh-fodder day display differently; no supplied values are invented.
5. A mixed own/purchased day links both sources and is counted once in total recorded days.
6. A 400 kg purchase at Rs 2,000/40 kg calculates Rs 20,000 goods cost; transport is counted once. No inferred bags.
7. A known-total trolley purchase saves without kg; incompatible unit rate calculations refuse with a field error.
8. Nested purchase save returns to the unchanged daily draft. Cancelling that draft leaves the purchase available.
9. An addition is recorded for a selected animal with operator-stated purpose, without benefit/dose recommendations.
10. A finished crop remains available for historical review and historical references. Archived items remain readable in old logs.
11. Same-key retry creates no duplicate purchase/log/revision; reused key with changed body refuses; failed child row rolls back the entire summary.
12. Two tabs editing one summary cause a stale-revision conflict, not silent lost updates. Correction/removal has recoverable history.
13. Changing historical lactation data leaves already-confirmed feed recipients unchanged.
14. Unknown costs/quantities are excluded honestly; reports never display false stock balances, intake or profitability.
15. All new writes obey provenance/target gates; browse flows remain available without recording setup.
16. Existing herd, milk, labour, Today and assistant flows continue working. Backup/restore tests include feed and recipient/source relationships.

## 11. Implementation order and verification

1. Inspect current docs/code and record baseline status. Resolve repository-specific choices in this spec without reopening settled farm questions.
2. Add schema, domain validation, transactions, revisions/idempotency, server read models and focused backend tests.
3. Add isolated fixtures: active/finished crops, unknown-date crop, measured silage/khall purchase, unweighed purchase, mixed-source day, partial day, missing day and targeted addition.
4. Build catalogue/crop/expense/purchase screens and daily entry/history, then Today/navigation/overview integration.
5. Exercise end-to-end scenarios against the in-memory harness; review desktop light/dark and narrow layouts, keyboard flow, validation, correction and nested-form recovery.
6. Run appropriate existing verification: backend tests, frontend tests, typecheck, template checks, build and contrast reporting. Read package scripts for exact commands. Report pre-existing warnings separately from introduced failures; do not claim historical test counts as new runs.
7. Capture new-route and key-state screenshots, extend the gallery, update DEVELOPMENT/UI_SYSTEM/OPEN and relevant domain docs. Record what shipped versus deferred. No live-database UI trial without explicit user direction.

Done means usable persistent end-to-end workflows, successful regression checks, inspected screenshots, and honest documentation—not just screens or a schema. No deployment, commits or pushes implied by this spec alone.

## 12. Prompt for the next session

> Implement feed management end to end in `/Users/adnanali/personal/dairy-360` using `docs/FEED_SPEC.md`. Read its repository references and applicable instructions first. The confirmed scope is crops and expenses, feed purchases, and one daily feeding summary integrated into Today, with review/corrections, overview/history and the existing UI/provenance system. Use the proposed defaults to resolve routine implementation details and document deviations. Keep authentication, billing, inventory forecasting and nutrition recommendations out of scope. Use only isolated in-memory fixture data for development/testing; preserve all existing farm records. Complete the backend, frontend, tests, visual verification and documentation. Do not deploy or push unless I ask.

## 13. Background references

These support the distinction between purchased and home-grown cost, quantity and loss; they are not local feeding prescriptions or imported US price assumptions:

- Penn State Extension, [Feed Inventory for the Dairy Herd: Planning for Shortages](https://extension.psu.edu/feed-inventory-for-the-dairy-herd-planning-for-shortages).
- University of Minnesota Extension, [Managing high feed costs](https://extension.umn.edu/agriculture/animals-and-livestock/dairy/dairy-news/managing-high-feed-costs).

The farm-specific facts in §2 take precedence over generic examples. Verify current primary documentation before introducing any specific new dependency or nutritional claim.
