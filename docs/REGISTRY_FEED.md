# Feed management

Implemented 2026-09-10 from [FEED_SPEC.md](FEED_SPEC.md). The specification records the confirmed farm practice; this document describes the shipped implementation and verification.

## Workflows

Feed has overview, crops, purchases and daily history views. Add a crop already cutting with unknown dates or acreage; record separately incurred expenses on its detail page. Finish/archive through Correct without fabricating a cutting-end date. Do not duplicate payroll salaries as crop expenses.

Purchases retain original quantities and pricing agreements. Unknown quantity is null, not zero. A 400 kg purchase at Rs 2,000 per 40 kg costs Rs 20,000 plus separately entered charges; a known-total trolley needs no weight. Only explicit mass units (g, kg, tonne) convert; custom units must match. Costs are incurred acquisition/expense amounts, not payments or consumed-feed costs.

Today links to its selected date's single summary. Explicit fresh/additional answers distinguish recorded, partially recorded and unrecorded days. Add feed lines and source links deliberately; nothing is pre-asserted. Confirm a date-specific milking/herd list or selected animal list, or leave recipients unspecified. Saved recipient snapshots survive later animal-history corrections. Unmeasured feeding and operator-stated preparation/purpose are supported without recommendations.

A nested purchase commits independently, preserves the daily draft and must be explicitly linked if fed. Cancelling the daily draft retains that purchase. Recording setup uses the existing Session, target gate, FormState and WriteLog. Refresh discards unsaved drafts, as elsewhere in the application.

## Persistence and corrections

Migration 8 adds ten `registry_feed_*` tables, with no seed data and no alterations to older tables. Stable identities, revisions, unique daily dates, item/crop/purchase/animal foreign keys and ordered child rows are relational. Validated scalar effective records are stored in JSON alongside those indexed relationships. Daily JSON also contains the complete account so revisions can reconstruct it; Check verifies agreement with relational lines, sources and recipients.

Every successful create/update/remove appends an immutable before/after revision with operation, recorder, source and server timestamp in the same transaction. Items/crops archive; expense/purchase/daily removal retains revisions. A referenced purchase cannot be removed or changed to a different item or a delivery after its linked feeding. Detail screens expose correction history; removed IDs remain readable through their `/revisions` endpoint and backup, without a one-click restore action. To restore, review the prior content and enter a new effective record.

Whole-summary replacement and its revision are atomic. Expected revisions reject stale edits with HTTP 409. The daily conflict panel loads the occupied date alongside the preserved draft and requires explicit adoption. An occupied date is never overwritten.

All feed HTTP writes use the existing provenance/idempotency wrapper plus a durable feed request table. Successful keys bind to the path and body, including provenance; an identical retry returns the original response even after a router restart. Changed content with that key refuses. Failed attempts do not reserve a key. This deliberately strengthens feed replay handling without changing older domains' process-local replay semantics.

The registry backup table enumeration includes all ten tables, including revisions and request bindings. Restore tests cover source and recipient foreign keys. `checkFeed` participates in the HTTP Check response and snapshot verification; missing days and unknown quantities/costs are valid, not corruption. The standalone `verify:registry` CLI also calls `verifyAll`, so feed integrity is checked there and during backup snapshot verification.

## Reporting choices and boundaries

Coverage defaults to the first saved summary, with an explicit inclusive range (up to 3,660 days). Own/purchased/mixed counts overlap and are labelled accordingly. Purchased material can be reported without an invoice link, so older bought stock remains recordable. Quantity totals stay grouped by original unit, with unmeasured purchase counts. Purchase costs use delivery dates; expense totals use expense dates. Unknown totals are excluded with a count.

Crop status is the latest recorded lifecycle, explicitly labelled rather than reconstructed as a historical as-of state. Crop expenses and distinct linked supply dates are lifetime totals, separately labelled from range totals. These are implementation choices where the spec allowed repository-specific defaults.

Authentication, tenancy, billing, stock balances/forecasting, nutrition recommendations, automatic feeding, feed assistant tools, payroll allocation and supplier payment ledgers remain out of scope. No real farm usability trial was performed. The existing five-animal trial remains open; border tokens are unchanged.

## Verification on 2026-09-10

- Server: 742 passing tests, no failures or skips. Feed coverage includes populated version-7 migration, null/zero semantics, monetary/unit validation, recipient snapshots, atomic rollback, stale/date conflicts, linked purchase protection, immutable audit, durable HTTP replay, integrity drift and backup restore.
- Frontend: 347 passing tests across 33 files, including provenance/draft preservation, nested purchases, explicit recipient confirmation, date precision and refusal recovery.
- Typecheck, template checks (72 component files) and production build pass. Existing build warnings remain: initial bundle budget, shared CommonJS dependency and unused payroll SummaryBar import. jsdom reports its existing missing canvas implementation during tests.
- Contrast reporting: 122 graded checks, 30 existing token failures. No contrast token changes in this feature.
- Guarded HTTP harness seed and immediate replay both pass against port 4110 with `:memory:` storage. The injected fixture set also includes unknown-cost wanda, targeted ginger, measured khall and silage, mixed supply and partial/missing days.
- Browser checks use only isolated harnesses: crop with unknown dates, expense entry, daily correction, provenance preservation, independent nested purchase/cancellation, price agreement display, history distinctions, light/dark desktop and narrow layout. See the [feed gallery](images/feed/README.md).

## Database preservation incident and fix

The initial SHA-256 was `71a63e8800a44c0da88c46220203df43b837893c7d5f532bf838c5ed3e2e91ca`. The final file is not byte-identical: a pre-existing test-isolation defect in `registry.cli.test.ts` imported CLI usage constants from modules that eagerly imported `db.ts`. At 12:28:43 PKT the first server regression run therefore opened the live file and applied additive migration 8. The new feed tables are empty; no harness/seed data was written there. The migration creates only new feed tables and triggers; it does not update or delete prior farm records. This is an unintended schema change, not a successful unchanged-file check.

The four CLI modules now load the singleton only inside actual command execution. A regression asserts that usage imports load neither `db.ts` nor `seed.ts`. The subsequent full server run leaves SHA-256 `566debb5abe95091541647c9311c18adf6171765ee3409027d5191c8871e78d0` unchanged. The live file was inspected using SQLite `immutable=1`, never seeded or restored. No deployment, commit or push was performed.
