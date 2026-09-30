# Audit implementation — 28–30 September 2026

Baseline a1dd2a7, unchanged tracked source at start. Existing untracked docs/reviews preserved. No AGENTS.md found in repository or ancestor directories. Node 22.22.3 is required (default shell 22.3.0 cannot run Angular). Baseline: 450 tests / 42 files pass; see geist-evidence/baseline-tests.txt.

## Phases and finding checklist

- [x] P1: control boundaries, mobile sizing/cascade, spacing/type/surfaces, field associations, date copy, draft consequences.
- [x] P2: People/Feed pilot, labels/help/errors, attached units, entity search, form width/grouping, tables and remaining route consumers.
- [x] P3: Health editor/round, analytics inspector/coverage, assistant receipts/context, complete mobile navigation.
- [x] P4 implementation verification: production build, tests, contrast/template gates; 25-route desktop/mobile light/dark browser matrix; representative interaction checks.
- [ ] Exhaustive browser fault/navigation permutations and native/device/operator acceptance remain open; see [acceptance matrix](geist-evidence/ACCEPTANCE.md).

## Deliberate baseline revisions

The user explicitly authorizes revising held control borders and animal/calving presentation. Decorative border-default remains warm and quiet; border-control identifies native editable controls and is graded at 3:1 across all three surfaces in both themes. The six held border-default failures are replaced by real control-boundary checks; decorative pairs remain reported as INFO. Animal/calving native controls, field meaning/order, precision parsing and draft/write safeguards remain; their visual frame/mobile size and Dam search/association may change. Historical B1–B6 evidence is not rewritten as a fresh pass.

## Evidence rules

Source/test coverage and actual browser execution are separate. Native device, screen-reader, zoom, print/export, operator and live assistant checks require actual execution; synthetic responses cannot prove real execution. No deployment, publishing, merge or real farm writes.

## Route mapping

Every route below has browser DOM/geometry and viewport screenshots at 1440×1000 and 390×844 in light/dark themes. Links select one capture; sibling files use `-1440-light`, `-1440-dark`, `-390-light`, `-390-dark`. These are representative synthetic records, not every record/state. Final shared-shell refinements have separate `final-shell-*` evidence; see the acceptance matrix for chronology and limits.

| Route | Change family | Browser evidence |
|---|---|---|
| / | shell, typography, controls | [4 captures](geist-evidence/today-390-light.json) |
| /analytics | metrics, date inspector, table/drilldowns | [4 captures](geist-evidence/analytics-390-light.json) |
| /animals | title/search, named table overflow | [4 captures](geist-evidence/herd-390-light.json) |
| /animals/new | controls, grouping, date feedback | [4 captures](geist-evidence/animal-new-390-light.json) |
| /animals/calvings | named table overflow, filters | [4 captures](geist-evidence/calvings-390-light.json) |
| /animals/calvings/new | Dam search/errors, date feedback | [4 captures](geist-evidence/calving-new-390-light.json) |
| /animals/:id | shared controls/type, provenance retained | [4 captures](geist-evidence/animal-detail-390-light.json) |
| /animals/:id/report | shared controls/type, report scope retained | [4 captures](geist-evidence/life-report-390-light.json) |
| /animals/health | editor grouping, round search | [4 captures](geist-evidence/health-390-light.json) |
| /milk/milking | controls/units/save feedback | [4 captures](geist-evidence/milking-390-light.json) |
| /milk/dispatch | controls/units/save feedback | [4 captures](geist-evidence/dispatch-390-light.json) |
| /milk/buyers | controls, rate action names | [4 captures](geist-evidence/buyers-390-light.json) |
| /milk/buyers/:id | controls/units, statement scroll | [4 captures](geist-evidence/buyer-detail-390-light.json) |
| /feed | controls/type, catalogue editor | [4 captures](geist-evidence/feed-overview-390-light.json) |
| /feed/crops | controls/type, filter recovery | [4 captures](geist-evidence/crop-list-390-light.json) |
| /feed/crops/:id | constrained editor, groups | [4 captures](geist-evidence/crop-detail-390-light.json) |
| /feed/purchases | controls/type, filter recovery | [4 captures](geist-evidence/purchase-list-390-light.json) |
| /feed/purchases/:id | quantity/price groups and units | [4 captures](geist-evidence/purchase-detail-390-light.json) |
| /feed/daily | hierarchy, controls/type | [4 captures](geist-evidence/feeding-history-390-light.json) |
| /feed/daily/:on | groups/units; snapshot semantics retained | [4 captures](geist-evidence/feeding-day-390-light.json) |
| /labour/people | title/search, fields, table | [4 captures](geist-evidence/people-390-light.json) |
| /labour/people/:id | controls/units, closure consequence | [4 captures](geist-evidence/person-detail-390-light.json) |
| /labour/payroll | controls/units; completeness retained | [4 captures](geist-evidence/payroll-390-light.json) |
| /check | controls/type; issue classification retained | [4 captures](geist-evidence/check-390-light.json) |
| /chat | contextual starters, approval receipts | [4 captures](geist-evidence/chat-390-light.json) |

Interaction families: navigation/filter/reset/pagination; native field and entity selection; new/edit/view/save; refusal/conflict/unknown retry; draft Keep/Discard; session setup; dialog focus; chart/data/drilldown; assistant pending/approved/rejected/result. Execution evidence identifies exact cases in [ACCEPTANCE.md](geist-evidence/ACCEPTANCE.md); it does not imply every permutation passed.


## Findings resolved and retained contracts

| Audit finding | Implementation | Verification |
|---|---|---|
| Weak resting controls; mobile cascade | `border-control`, post-utility native input rules, 16px/44px mobile controls | 122 contrast checks, rendered control geometry across routes |
| Label/help/error gaps | Shared Field; Dam association; WriteLock field/error focus | Field and WriteLock tests; People duplicate refusal; calving invalid-date capture |
| Wide forms, inconsistent hierarchy | 720px Feed editor; People/Feed groups; title before search; attached units | New/saved crop and purchase, People, Milk and payroll matrices |
| Table overflow and hidden balances | Named scroll regions; adjacent People identity/balance | 390px matrix; 320px long-name local scroll |
| Deep Health editor, ungrouped dose and long round | Editor above board with heading focus; dose groups; reference and round search | Board/dose/round four-way matrices; nine editor families at 320px; selection retention |
| Analytics date-button wall | Compact inspector, trend before comparison, equivalent table retained | Daily empty/populated, monthly, expanded data and date detail |
| Assistant technical/state ambiguity | Context starters, expandable dock, outcome-specific receipt, rejected chip, settled disclosure | Rich synthetic transport, chart data, rejection/success/error; unknown-result tests |
| Draft route jargon and duplicate date/dose copy | Human consequence text; safe focus unchanged; presentation-only prefix removal | Keep/Discard and exact raw-value preservation; date/parser tests |
| Mobile navigation clipping | Full hierarchy Menu, one-row utilities, Escape from trigger and links | 320px final shell and menu capture, browser focus result, regression test |
| Filter-empty recovery | Herd/Calvings/People/analytics resets; purchase filter reset | Source/test coverage; purchase empty/reset browser execution |

No backend model, calculation, endpoint, money/date parser or idempotency implementation was changed. Existing compliant report/check content, precision/provenance adapters, recipients, historical rates and pending/unknown safeguards were retained and revalidated rather than rewritten. Shared styles migrate their rendered controls without changing these meanings.

The final test/build results, current source hashes, measured browser scope and outstanding acceptance are recorded in [fresh evidence](geist-evidence/ACCEPTANCE.md). Nothing was deployed, published or merged. Existing untracked audit documents were preserved.
