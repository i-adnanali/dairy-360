# Feed

Current reference combining confirmed farm practice and delivered behavior. [Shared rules](shared-rules.md) apply.

## Confirmed farm practice

- The owner grows seasonal fodder on owned agricultural land, allocating a couple of acres according to need. Shortfalls are covered by nearby purchases.
- Fresh fodder is cut daily, judged sufficient for the day, and is not weighed.
- Silage is used intermittently, bought by weight and priced per 40 kg. Home-made silage is a future possibility, not current practice.
- Wanda and khall are usually given to milking animals. Amounts are judged personally, not routinely weighed.
- Khall is bought by weight, priced per 40 kg. It is placed in a designated container and fed dry or sometimes mixed with water. That container is not a calibrated weight unit.
- Other additions include ginger, green chilli, spices and ghee, sometimes targeted to pregnant animals. Record the operator's stated purpose without claiming medical/nutritional efficacy or recommending doses.
- One daily feeding summary is enough initially. No morning/evening split is required.
- Recipients of fresh fodder and silage have not been exhaustively established. Do not silently assume every animal receives them.

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

Authentication, tenancy, billing, stock balances/forecasting, nutrition recommendations, automatic feeding, feed assistant tools, payroll allocation and supplier payment ledgers remain out of scope. No real farm usability trial was performed. The existing five-animal trial remains open. Presentation roles follow the current [UI reference](../ui/design-system.md).

## Interfaces and presentation

Feed uses route-specific entry actions, grouped quantity/pricing/charges, crop search/lifecycle/reset and native overview disclosures. The daily summary, purchase and crop editors preserve model values, drafts, revisions and exact requests. Histories page loaded records locally; this does not reduce API payload size.

Sources: [feed.ts](../../../server/src/registry/feed.ts), [routes.ts](../../../server/src/registry/routes.ts), [schema.ts](../../../server/src/registry/schema.ts) and the Feed components under [registry/](../../../web-angular/src/app/registry). Fields and validation are defined by source types; do not implement the old proposal's tentative route/table shapes in place of the delivered model.

## Evidence and history

[Current acceptance](../ui/acceptance-status.md) separates source/tests from browser checks. Original requirements are preserved in [the Feed specification](../../records/FEED_SPEC.md), and the isolation incident plus original verification in [the delivery record](../../records/REGISTRY_FEED.md). The incident is retained as evidence, not omitted from history.
