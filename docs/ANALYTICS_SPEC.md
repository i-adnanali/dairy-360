# Owner analytics: production and milk reconciliation

Status: first release implemented, updated 2026-09-16. Section 11 records delivery details and refinements; section 12 documents the dedicated analytics harness.

## 1. Confirmed requirements

- The primary user is the farm owner.
- Support daily, weekly and monthly review.
- First-release priorities are milk production and milk reconciliation.
- Farm practice will measure each animal at every milking session. Historical or
  exceptional missing/unmeasured records must still be represented honestly.
- Buyers mostly settle monthly. This does not establish a contractual due date.
- Deliver an in-app dashboard initially. Design calculations and queries for future
  reporting and exports without implementing those outputs in this release.
- Tables need pagination, including a planned rollout to existing record tables.

Everything below is a proposed implementation default unless identified above as
confirmed. Defaults make the specification implementable without implying that the
owner has individually approved every design choice.

## 2. Objective and scope

The owner can answer: how much milk was measured, how production changed, which
animals contributed, where recorded milk went, and which records need review.

Release scope: an Analytics entry at `/analytics`, production and reconciliation
views, shared period controls, charts, paginated detail tables and links to source
records. Link to Analytics from Today and Milk. Preserve the existing daily entry
workflows and use the existing design system.

Defer financial dashboards, profitability, feed efficiency, health analytics,
breeding analytics, predictive alerts, configurable dashboard builders, scheduled
reports and export buttons. Monthly buyer settlement informs future collections
analytics; do not introduce daily payment alarms in this release.

## 3. Pre-implementation findings and implementation constraints

- Use `registry_*` records, not demo `milkings`, `deliveries` or `animals`.
- `registry/milking.ts` supplies date-specific lactation membership and roster logic.
- `registry/dispatch.ts` supplies reconciliation and captured-price handling.
- Current completeness calculations in `milkingReport()` and `reconcile()` enumerate
  sessions having rows. An entirely absent session can therefore disappear from
  their expected counts. Dashboard coverage MUST enumerate expected sessions in
  the selected period, including sessions with no rows. Reuse domain rules, not
  these aggregate counts without adaptation.
- Existing reconciliation protects incomplete production but does not establish a
  stock balance, milk wastage, or completeness of occasional dispatches.
- Farm time is `Asia/Karachi`, already defined in `registry/time.ts`.
- Before implementation, the registry had no shared pagination controls and life
  reports used a ten-row limit with Show more. Sections 11–12 describe the shipped
  pagination and its harness coverage.
- The local immutable database snapshot inspected during discovery contained zero
  rows in the core registry tables checked. This is not evidence about production
  deployment data. Validate usability with representative fixtures and a farm trial.

References: [milking](REGISTRY_MILKING.md), [sales](REGISTRY_SALES.md),
[UI system](UI_SYSTEM.md), [health/life report](REGISTRY_HEALTH.md).

## 4. Periods, comparisons and filters

- Day: selected date; default today. Week: Monday–Sunday containing the selected
  date. Month: calendar month containing the selected date. Previous/next controls
  and a date picker are available. Week start is a proposed default.
- All occurrence-date bounds are inclusive farm-local dates. Never use entry
  timestamps to assign production or dispatch to a review period.
- Session filter: all, morning, evening. Do not compare morning to evening as a
  performance change; intervals between milkings may differ.
- Current periods display “in progress.” Future dates/sessions are not missing.
  Without configured milking deadlines, today's absent sessions are “not yet
  recorded,” not overdue. Historical absent expected sessions are missing.
- Daily chart: AM/PM breakdown. Weekly/monthly charts: daily buckets, preserving
  gaps. Totals may sum both sessions; changes compare like sessions.
- Completed periods compare to the immediately preceding equivalent calendar
  period. Monthly totals show day counts and daily averages because month lengths
  differ. Current week/month headline comparisons use completed days only against
  the same elapsed number of days in the preceding period (capped by its length,
  with actual ranges displayed). Today has no automatic daily percentage until
  both sessions are accounted for; individual completed sessions may compare to
  the same session yesterday.
- Withhold a percentage when either comparison range has unresolved production
  coverage, or the baseline is zero. Display the reason; never return infinity.
- Animal search/filter applies to production detail only. Reconciliation remains
  whole-farm: pooled dispatch cannot be attributed to individual animals. Label
  this scope difference and keep animal controls outside reconciliation.
- Save view, period, date, session, search, sort and page in URL query parameters.

## 5. Metric dictionary

Let E be expected animal-session slots from effective lactation history, M measured
slots, U milked-but-unmeasured slots, N explicitly not-milked slots and X missing
slots, for the historical selected scope. Expected slots must be matched by animal,
date and session; unexpected rows cannot compensate for missing expected rows.
Report unexpected rows separately for review. Current pending slots are separately
labelled, as described above. No eligible population means not applicable, not 100%.

| Metric | Definition | Presentation and limits |
|---|---|---|
| Measured production | Sum effective measured `yield_litres` | Litres; lower bound if U or X exists. Empty measurements are not a measured zero. |
| Recording coverage | (M + U + N) / E | Show counts and percentage; explicit answers, not measurement completeness. |
| Measurement coverage | M / E | Show N, U and X alongside; N is an accounted exception, not an entry failure. |
| Production accounted for | U = 0 and X = 0, with all expected slots matched | N contributes zero production; distinguish this from every animal being measured. |
| Recorded milked animals | Distinct animals with M or U in scope | N is excluded; period counts are unique animals, not sums of daily counts. |
| Mean daily yield per measured animal | For animal-days with both required sessions measured: sum litres / count of these animal-days | Show eligible/excluded animal-day counts; omit this metric for a single-session filter. No extrapolation. |
| Animal production | Sum measured litres for selected animal and period | Include M/U/N/X and a link to history. No automatic “best/worst” label on partial histories. |
| Sold litres | Sum taken dispatch litres to billable destinations | Recorded volume, irrespective of payment date. |
| Non-sale litres | Sum taken dispatch litres to non-billable destinations | Break out household/staff using supported destination kinds; preserve other kinds explicitly. |
| Total dispatched | Sold + non-sale litres | Includes all recorded destinations; explicit `none` is zero, absent is unknown. |
| Unreconciled difference | Measured production − total dispatched | Signed litres. Positive means more measured than dispatched; negative means more dispatched than measured. Neither proves a loss. |
| Difference percentage | Difference / measured production × 100 | Only when production is accounted for, expected standing dispatches are recorded, production > 0, and no pending selected session. Otherwise null plus reason. |
| Standing dispatch coverage | Answered expected standing destination-session slots / expected slots | Enumerate empty sessions using destination activity rules. Does not prove occasional dispatches are complete. |

Do not call the difference waste, theft, efficiency or stock on hand. No tank
opening/closing balance, carryover, or structured discarded-milk accounting is
established here. Differences are record-review information, not automated alarms.
Even fully recorded standing dispatches cannot prove all occasional uses were logged.

Use canonical numeric precision throughout calculations, round once for display,
and reuse existing litre/money conventions. Effective corrected records are counted
once; revisions and superseded history are not additional production. Changes to
animal history may change historical expected rosters and must refresh coverage.
Unknown historical date bounds must remain qualified, not presented as exact.

## 6. Screen specification

```text
Analytics                   [Day | Week | Month] [< date >] [Session]
[Production | Reconciliation]                    Updated ... [Refresh]

Measured milk        Measurement coverage       Dispatched       Difference
litres + qualifier   counts + exceptions        litres           litres + qualifier

Production and dispatch by session/day
Accessible legend, units, incomplete buckets and text summary

Records needing review: missing sessions / unmeasured yields / missing dispatches

Production: Animal | Measured litres | M/U/N/X | Complete animal-days | Open record
or
Reconciliation: Date/session | Produced | Sold | Non-sale | Difference | Coverage

Rows per page [25]       1–25 of 134       Previous   Page 1 of 6   Next
```

- Cards and chart summaries always represent the full filtered period.
- No data, genuine zero, incomplete, loading and failed states are distinct.
- Null chart buckets are gaps, never a zero-filled production line.
- Clicking a bucket narrows detail to its date/session; show and clear that filter.
- Source links open the matching animal, milking or dispatch date/session.
- Use existing tokens in both themes. Tables retain accessible headers; paging
  works with keyboard and screen readers. Small screens preserve units and labels.
- Refresh after successful relevant writes, on returning to the dashboard, and on
  explicit refresh. Show generation time. Failed refresh retains prior content
  only with a clearly visible stale/error indication.

## 7. Pagination specification and rollout

### Shared contract

- Server-side pagination for read-only record lists: `page` (1-based), `pageSize`
  (25 default; 25/50/100 allowed), allowlisted `sort` and `direction`.
- Response: `items`, `page`, `pageSize`, `totalItems`, `totalPages`, applied filters,
  sort, and generation time. Empty lists use page 1, zero pages and “0 results.”
- Search/filter before sorting/counting/paging. Add a unique stable tie-breaker
  (animal ID, record ID, or date plus session for grouped rows).
- Analytics production defaults to animal identifier ascending; reconciliation
  defaults to date descending, then evening before morning.
- Changing filters, sort or page size resets page to 1. Back navigation restores
  URL state. If corrections remove the last page, fetch the last valid page and
  update URL state. Reject invalid paging parameters with a readable 400 response.
- Totals and charts must never be calculated from `items`. Paging changes only
  visible rows. Distinguish full-filter totals from any explicitly labelled page sum.
- Count and items for one response use a consistent read transaction. Concurrent
  writes between requests can move rows; refreshing reestablishes the current view.

### Adoption scope

1. Required for launch: all new analytics detail tables and source drill-down lists.
2. Follow-on within the pagination workstream: read-only existing herd, calving,
   destination and people lists; buyer statement history; long feed and health
   histories; Check detail lists. Inventory concrete endpoints during implementation
   and track each migrated surface so this requirement is not lost after Analytics.
3. Life-report interactive histories can page, but future/all existing print and
   JSON paths must still include the full selected record set. Never export only
   the visible page.
4. Milking and dispatch sheets are editable session forms. They require a separate
   safe integration: retain drafts across pages, calculate completeness across the
   whole roster, validate all pages, navigate to the first invalid field, and save
   the whole intended session atomically. Do not paginate by submitting only the
   visible subset. Release this integration only after these guarantees are tested.

This specification includes the broader pagination requirement without silently
turning read-list pagination into a change to session-save semantics.

## 8. Architecture and API proposal

Create a registry analytics service accepting a database handle, explicit farm-local
date/clock and validated query. It must not import/open the live database as a side
effect. Separate record selection, pure metric calculations and output formatting.

Proposed read endpoints under `/api/registry/analytics`:

- `/overview`: full-scope metrics, comparable-period values, coverage and chart buckets.
- `/production`: paginated animal aggregates with coverage and source links.
- `/reconciliation`: paginated date/session aggregates with coverage and differences.

Shared query: `view=day|week|month`, `on=YYYY-MM-DD`,
`session=all|morning|evening`; detail endpoints add their applicable filters and
paging. Return resolved dates rather than making the browser reproduce period logic.
Return `metricVersion`, `generatedAt`, timezone, scope, eligibility/coverage, values
and machine-readable unavailable reasons. The browser supplies labels and formatting,
not independent business calculations. Reconcile cards and chart totals within one
snapshot; after corrections refresh all visible analytics responses together.

Expose a reusable unpaginated query/iteration boundary internally for future
reports and exports. Export adapters must consume the same validated filters and
metric definitions across all matching rows. Do not add an unbounded public
`pageSize=all` option. Future assistant integrations consume these same definitions.

Start with indexed reads and request-scoped aggregation, no warehouse or background
materialized totals. Inspect query plans and add indexes only where needed. Avoid
per-animal database round trips. Dashboard reads never seed, migrate, correct or
otherwise mutate domain records.

## 9. Acceptance examples

1. Two animals, both sessions, each measured at 10 L: production 40 L, M/E = 4/4,
   recording coverage 100%, mean daily yield 20 L over two eligible animal-days.
2. Replace one measured slot with unmeasured: 30 L measured, M/E = 3/4, recording
   coverage 100%, production incomplete. Do not infer the missing 10 L.
3. Delete all evening rows: two missing expected slots still appear; 20 L measured
   and 50% recording coverage. An absent session must not disappear from the chart.
4. Replace one slot with explicit not-milked: 30 L, M/E = 3/4, recording coverage
   100%, production accounted for. Exclude that animal-day from the measured-day mean.
5. Complete production 40 L, sold 30 L, household 2 L, staff 3 L: dispatched 35 L,
   difference +5 L; 12.5% only if dispatch eligibility requirements are met. No
   “5 L wasted” claim. Dispatch above 40 L creates a signed negative difference.
6. A missing expected standing dispatch suppresses difference percentage. A recorded
   `none` answers the slot with zero. Neither establishes occasional-use completeness.
7. Today before evening entry: evening is pending; daily percentage is unavailable.
   Historical missing evening sessions are missing, not pending forever.
8. Zero baseline yields an unavailable percentage. No rows shows an empty state;
   measured zero rows show zero with their actual coverage.
9. Correct a yield or effective calving date: totals/expected rosters update once;
   superseded history is not double-counted. Unexpected rows cannot fill another gap.
10. With 63 filtered rows at 25/page: pages contain 25/25/13 rows; global totals and
    charts remain identical. Filtering, sorting, final-page deletion and URL restore
    follow the shared contract. Tied sort values have deterministic order.
11. Pagination of an editable sheet preserves drafts and validates/saves hidden
    rows; failed validation takes the owner to the affected page.
12. Month boundaries, February, local midnight, partial periods and AM-only filters
    resolve to explicit correct dates; comparison ranges and eligibility are visible.

Use isolated fixtures covering these cases, API/aggregation tests and targeted
browser checks for paging, drill-downs, empty/error states and responsive themes.
No new production metrics are accepted solely because a chart renders.

## 10. Delivery sequence and review points

1. Implement the metric/coverage layer and isolated examples, including entirely
   missing sessions. Establish one definition across new dashboard consumers.
2. Build overview and detail APIs with shared pagination and inspect query plans.
3. Build owner views, period controls, source links and all presentation states.
4. Adopt pagination across existing read lists; separately verify editable sheets.
5. Trial with a representative daily, weekly and monthly recording history.

Before launch, verify the proposed Monday week start, recording-history start date
and any known milk carryover between sessions with the owner. Until a recording
start is known, label selected historical gaps as no records, never retrospectively
claim failed recording obligations before adoption. Session deadlines and difference
alert thresholds remain unset; no blocking answer is needed to build the draft scope.

For performance validation, use a proposed fixture of 100 animals with two sessions
daily for three years and matching dispatch history. Record endpoint timings and
payload sizes on the target host; proposed target is p95 below one second for a
monthly overview over 30 warm read requests. Measure before adding caching. This
is an engineering test scale, not an assertion about the actual herd size.

## 11. Implementation record — 2026-09-15

The first implementation is present in the working tree. The requirements above
remain the design baseline; the refinements and limits below describe the delivery.

- `/analytics` is available in the main navigation. Day/week/month, date, session,
  search, sorting, detail-date selection and pagination are URL-backed. Tables and
  chart date controls link to source records. Full-period metrics share one read
  transaction with detail pages; a detail filter or page never changes top totals.
- Calculations live in `server/src/registry/analytics.ts`; shared response types
  are in `shared/src/analytics.ts`. The three analytics routes currently return the
  same complete snapshot, selecting the appropriate paged detail orientation.
  `calculate()` exposes the complete calculation result for future report adapters.
- Entirely absent historical sessions are enumerated from effective lactations.
  Today's absent rows are pending. Approximate roster dates and unexpected rows
  are additional explicit reasons to withhold confident percentage comparisons.
- Current month/week comparison excludes today, shows exact ranges and day counts,
  and includes daily averages alongside totals. No clinical or loss alarms were added.
- Analytics and herd/calving/buyer/people browse lists use server pagination with
  a 25/50/100 size choice, stable sorting, counts and last-page clamping. Calving
  browse now uses one aggregate endpoint instead of one HTTP call per animal.
- Buyer statement histories, life-report sections, feed histories, health board
  lists and long Check details page their already-loaded composite records locally.
  This is a deliberate refinement to the general server-pagination proposal:
  these endpoints also supply complete summaries, forms or print/export records.
  Their payload sizes are not reduced by local pagination. Dedicated server-paged
  history endpoints remain future scaling work; interactive paging does not truncate
  the existing life-report print/JSON output. Local section pages are not URL-backed.
- Milking and dispatch entry paginate their in-memory session drafts. All expected
  rows still participate in completeness checks and atomic saves. Keyboard advance
  crosses pages; invalid numeric drafts are brought into view; unanswered rows have
  a navigation action. Paging buttons explicitly cannot submit a form.
- Existing read catalogs remain intact for record pickers and other API consumers.
  No schema migration, new dependency, warehouse or cache was required.
- Feed/health analytics, financial reporting, exports and scheduled reports remain
  deferred. Buyer settlement dates, recording-adoption date and milk carryover
  still require real-farm validation; the UI makes no overdue/loss claim from them.

Verification uses isolated databases. The performance script
`scripts/benchmark-analytics.ts` creates 100 milked animals, 219,200 milk rows and
matching session dispatches across three years. Thirty warm monthly reads measured
p95 143 ms, maximum 172 ms, and about 39 KB per response on the development host.
The query plan uses the existing `idx_registry_milkings_date` index. These are
local measurements, not production latency guarantees.

Final verification, 2026-09-16: 776 server tests and 357 frontend tests pass;
server typecheck, template/host checks and the production Angular build pass.
Existing build warnings remain for initial bundle size, the shared CommonJS
package and an unused payroll import. Browser verification against an isolated
in-memory farm covered monthly comparisons, reconciliation page 2, and a 390 px
layout; no browser errors appeared. Real-farm recording practice has not yet
been trialled. Preview startup must use the same code revision for frontend and
backend; a long-running fixture process does not reload server source changes.

## 12. Dedicated analytics harness

`npm run harness:analytics` starts the in-memory registry on 6400 and Angular on
6420. Open `/analytics`. It is mutually exclusive with other commands using these
ports. Backend-only: `npm run registry:harness -w server -- --analytics --port=6410`.
`--analytics` cannot be combined with `--empty`. The default fixture/walkthrough
commands retain their existing broader feed, health and labour coverage.

`analyticsHerd(today)` creates 30 exactly dated lactating dams and 30 calves, a
billable buyer and home-use destination. It writes through domain entry functions
into `:memory:` only and closes the handle on construction failure. No live database
or migration of the persistent farm is involved. IDs/timestamps are generated;
scenario dates and quantities are deterministic for a supplied farm date.

The date window begins three calendar months before the current month. For a farm
date of 2026-09-16 it runs 2026-06-01 through 2026-09-16:

| Review | Expected scenario |
|---|---|
| Previous full month (August), then previous week | Fully measured periods and usable comparison; 30 production rows span two 25-row pages |
| First seeded day (June 1), evening | Entire session absent: 30 missing animal answers and missing dispatch |
| Next seeded day (June 2) | Explicit measured zero and no dispatch, distinct from unknown; no zero-baseline percentage |
| Two days before today (September 14) | Dispatch exceeds measured production by 14 L across both sessions |
| Yesterday (September 15) | Measured production exceeds dispatch by 10 L across both sessions |
| Today (September 16) | Morning has one unmeasured and one not-milked answer; all 30 evening answers are pending |

Daily home use is split from sales. Ordinary sessions retain a signed 5 L
difference; this is a review signal, not inferred waste. The buyer name illustrates
monthly collection practice, but payments/overdue financial analytics are not part
of this scenario. The CLI prints the actual dates on each start. Regression tests
assert these semantics, weekly/monthly coverage and pagination invariance.

Harness verification, 2026-09-16: 778 server tests and server/shared typecheck
pass. A fresh `--analytics` process returned the expected in-memory banner,
monthly comparison and five production records on page 2 over HTTP.

[Analytics screen gallery](images/analytics/README.md): daily, weekly and monthly reviews,
light/dark themes, production pagination, reconciliation and mobile captures
from the dedicated fixture harness (2026-09-16).
