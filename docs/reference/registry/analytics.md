# Analytics

Current reference for owner production and dispatch analytics. Metric definitions are shared by all views; rendering a chart alone is not validation.

## Periods, comparisons and filters

- Day: selected date; default today. Week: Monday–Sunday containing the selected
  date. Month: calendar month containing the selected date. Previous/next controls
  and a date picker are available. Monday is the implemented default; farm confirmation remains open.
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

## Metric dictionary

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

## APIs and consistency

`/api/registry/analytics/overview`, `/production` and `/reconciliation` use `view=day|week|month`, `on=YYYY-MM-DD` and `session=all|morning|evening`, plus applicable filters/paging. Responses include resolved scope, generation time, metric version, qualifications and unavailable reasons.

[analytics.ts](../../../server/src/registry/analytics.ts) separates database selection from calculation; [shared analytics types](../../../shared/src/analytics.ts) own the response contract. The routes return a complete calculated snapshot with the requested detail orientation. Full-period metrics do not change when a detail date/filter/page changes. Related totals and details use consistent transaction-backed reads.

## Pagination

Analytics and herd/calving/buyer/people lists use server pagination: 1-based page, 25/50/100 page size, allowlisted sorting and a stable tie-breaker. Filtering precedes counts/paging; filter/sort/page-size changes reset the page. Empty results and removed final pages have explicit recovery. Invalid parameters produce readable errors.

Buyer statements, life-report sections, Feed histories, Health lists and Check details page already-loaded composite collections locally. Their payload sizes are unchanged and local section pages are not URL-backed. Milking/Dispatch paginate whole session drafts, preserving all-row completeness, validation and atomic save. Print/JSON life-report paths retain the full loaded selection, independently of visible page.

## Presentation and examples

The trend precedes comparison. Date/session inspection supports previous/next and URL selection, retains period context and links to source records. Qualifications stay beside values; charts have equivalent data tables. Null buckets are gaps. Failed refresh must be visibly distinguished from fresh data. Day/week/month and session scope remain clear on narrow layouts.

Two animals measured at 10 L in both sessions yield 40 L, four measured slots and two complete animal-days. Replacing one measurement with an explicit unmeasured answer yields 30 measured litres, complete answer coverage but incomplete measurement coverage. It must not become a fabricated zero or confident loss percentage.

Entirely absent historical sessions are enumerated from effective lactations. Today's absent rows are pending. Approximate roster dates and unexpected rows limit confident comparisons. Current week/month comparisons exclude today and show exact ranges and eligible day counts.

## Limits and evidence

No tank carryover, automatic loss/clinical alarm, unbounded public export or new materialized-total schema is introduced. Dedicated server paging for composite histories and analytics exports remain future work. Measurement practice and real-farm adoption are not established by synthetic fixtures.

[Testing and analytics harness](../../guides/testing.md) owns commands. [Original analytics record](../../records/ANALYTICS_SPEC.md) retains performance measurements and delivery results. [Current UI evidence](../../implementation/geist-screen-evidence/ACCEPTANCE.md) distinguishes exercised browser workflows from unperformed acceptance.
