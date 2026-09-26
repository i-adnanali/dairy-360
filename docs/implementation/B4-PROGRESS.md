# Dairy 360 — Batch B4

**B4 implementation is complete; native print/PDF and browser-download acceptance remain outstanding. Stopped before B5.** Baseline: `75f9eed024621db451496a97c81cbb02ef2ec148`. Work and verification: 2026-09-25–26. No applicable AGENTS.md found. Commit and push authorized by the user after the B4 review handoff. Existing untracked `docs/reviews/` references preserved.

## Implemented behavior

| Surface | Outcome |
|---|---|
| Buyer statements | Deliveries and Payments have separate headings, column sets, month-qualified pagers and keyboard-accessible local scrolling. Either collection can be empty independently. Original full-period/month balances, pricing and row formatting remain; an explicit full-collection unpriced-delivery qualification prevents treating a partial billed total as complete. |
| Analytics | Shared Input/Button/Cell/Certainty treatment; summaries ordered Measured production, Recorded dispatch, Difference, Coverage. Actual response coverage distinguishes zero, no records, no measurements and unavailable differences. Partial qualifications accompany differences. Show data exposes a semantic chart table; dated controls include value/coverage descriptions. Existing filters, day links, signs, rounding, calculations, pagination and chart gaps remain. Retry keeps filters; retained refresh results are labelled stale. |
| Life report | Contents anchors/counts focus their headings. Explicit adapters cover identity/parentage, timeline, reproduction, milk, lactations, health, visits, feed and returned costs. Requested superseded events and health revisions have human summaries and state/provenance. Vaccination card, withdrawal instructions, production summaries and API order remain. Unknown fields/types, unsupported sections and original correction JSON remain losslessly available in Technical audit and complete JSON export. |
| Check | Invariant violations, coverage sections and advisory worklists have human headings. Labour contexts are a shared optional discriminated contract used atomically by server/frontend. All five advisory kinds retain original detail and technical metadata. Links use structured IDs, never prose. Server fallback now says “has a recorded wage” and formats minor units once; wage differences stay advisory. Loading/failure hides clean-state claims; reconciliation failure is explicit. |

The shared Certainty directive adds an optional accessible label so “No measurements” is not announced as “No record”; existing consumers retain their default semantics and styling. No UI library, persistent drafts, financial/clinical calculation changes or write behavior changes were introduced.

## Verification

- **443 frontend tests across 42 files pass; 779 server tests pass**, with no skips in the server suite. Production build, typecheck, template/host checks and `git diff --check` pass.
- Contrast: **six exact held resting-border failures; zero unexpected failures**. Existing initial bundle budget, shared CommonJS and jsdom canvas warnings remain.
- A09: existing shared pager matrix covers 0/1/25/26/51/101 records and sizes 25/50/100. Added statement regression and browser checks cover independently paged 101 deliveries/26 payments, page-size changes and unchanged full-period totals; empty deliveries retain Payments.
- A12/A14: semantic numeric/null labels, accessible measurement labels, signed rounding, coverage qualifications, Show data, retry and all nine period/session combinations are covered. Server assertions pin measured totals, expected/measured/missing coverage, unavailable differences and daily yield for all nine combinations using an in-memory database. Existing zero, unmeasured, approximate, missing, negative-difference and corrected-value regressions pass. Analytics calculation source is unchanged from B3.
- A15: unit tests render empty/101-row reports, inspect the print DOM with all rows/disclosures from a non-first page, verify restoration of that page, and compare the generated JSON Blob with the complete untouched input, including corrections and unknown fields. Adapter tests cover supported health domains, precision, monetary zero, revision ordering and superseded/latest retained state. The current API returns one complete transaction snapshot, **not a paged response**; no extra fetch or invented paging contract was added.
- A16: server and frontend tests cover all five contexts, missing/mismatched/unknown context, structured routes, zero and `4500000 → Rs 45,000.00`. Original invariant classifications remain unchanged.
- Browser: **40 renders** across the four affected workflows at **360/390/768/1024/1440px**, light/dark; document and main widths match the viewport. Overflow stays in named table regions, which become keyboard stops only when overflowing. Additional checks cover all nine Analytics combinations, keyboard Show data/local scrolling/date selection, statement independent pagination, and report contents focus/correction navigation.
- Protected comparisons verify unchanged animal/calving forms, write-log/styles, page measures, draft/date/write-safety helpers and server calculation/validation code outside the intended advisory builder.

[Evidence, reproduction instructions and limits](b4-evidence/README.md). All data came from an isolated `:memory:` harness or synthetic read-only fixtures; no real farm records were seeded or modified.

## Remaining acceptance and limits

- **Actual print/PDF completeness is unverified.** The browser Print / Save as PDF action was exercised, but the available in-app surface produced no inspectable PDF/print preview. Passing print-DOM tests are not a claim about native printed output, page breaks or PDF legibility.
- **Actual downloaded JSON file acceptance is unverified.** The Export complete JSON action was exercised, but the browser download-event wait timed out and supplied no inspectable artifact. Exact complete Blob serialization is verified in the component test. No partial export or truncation defect was inferred from that tool limitation.
- Representative operator validation, native screen-reader behavior, real-phone keyboard, actual browser zoom and live assistant checks remain outstanding. No release-readiness claim or decision to ship without operator validation is made.
- Browser checks use fixed synthetic backend dates; the frontend retains its real clock. Native print/download checks should be repeated in a browser where the resulting PDF/file can be inspected, including corrections and a non-first report page. Unknown future fields remain in Technical audit until an explicit domain adapter is added.
- B5 has not started. Sandbox build aborts were resolved with reviewed escalation; one browser permission-review timeout succeeded on retry. No automatic approval rejection occurred.
