# Screen recommendation reconciliation — 1 October 2026

Starting implementation: `a70aa1e`; delivered and pushed as `a56400a`. No applicable AGENTS.md found in the repository or ancestors. Local untracked audit documents are preserved. This checklist supersedes completion claims below. The last column records the gaps identified before editing; their implementation disposition follows the table. **Implemented** means source behavior exists; browser and acceptance evidence are separate. **Partial** identifies concrete missing presentation work; it does not imply a broken domain contract.

| Audit recommendation / consumer | Status at start → current source | Gap identified at reconciliation / preserved source evidence |
|---|---|---|
| Control boundaries, mobile text/targets, warm palette | Implemented → Retained | Input/Button and post-utility CSS; contrast evidence historical until rerun |
| Fields, Dam errors, precision copy, draft consequences | Implemented → Retained | Field, WriteLock, calving-form, precision-date, DraftRegistry; preserve raw values and initial safe focus |
| Busy action identity; dialog/menu elevation | Implemented → Retained | Button busy indicator and surface classes; retain native semantics |
| Type/spacing reference and state gallery | Partial → Implemented | Current §26 exists; add concise current reference and inspectable state examples rather than historical phase claims |
| People title, task separation, immutable ID, rehire | Partial → Implemented | Title/forms/search implemented; missing ScrollRegion import; add direct Open stint action and concise help |
| Person balance/status/action before history; payment groups | Partial → Implemented | Balance first, but employment summary absent and payment buried after statement; group payment fields, wrapping ledger, distinguish adjustments |
| Feed overview compact costs/coverage and drilldowns | Partial → Implemented | Correct summaries exist; long date/quantity/crop lists need disclosures and scoped links |
| Crops status/filter/reset and lifecycle scope | Partial → Implemented | No crop filter; preserve unknown acreage and archived history, clarify current lifecycle |
| Purchase grouping and explicit pricing | Partial → Implemented | Modes/units retained; quantity, pricing and charges lack section groups |
| Feeding history title/navigation/status | Partial → Implemented | Text states exist; broad repeated actions need route-specific navigation |
| Feeding account snapshot/nested purchase/removal | Implemented → Retained | feed-daily preserves recipient snapshot, independent purchase notice, removal history and draft guards |
| Herd identity/status/table/pagination | Partial → Implemented | Named region/title/reset implemented; serial/name separate and status behind secondary columns |
| Add animal acquired/farm-born/order/date controls | Implemented → Retained | animal-form preserves distinction and field order; shared size/date treatments apply |
| Calvings filter recovery/precision/provenance | Implemented → Retained | calvings-list reset/ScrollRegion and precision adapters |
| Record calving search/prerequisites/errors/outcome | Implemented → Retained | Dam search and associated errors; dependent calf picker explicit; retain sex/outcome choices |
| Animal context/event identity/correction before-after | Partial → Implemented | animal-detail/event-list context and technical disclosure exist; correction selection exposes raw ID and lacks proposed date comparison |
| Life report contents/date/print/export scope | Implemented → Retained | life-report contents and explicit all-history vaccination scope; native output acceptance remains open |
| Today outstanding/completed/historical scope | Partial → Implemented | Existing status classifications retained, but completed and outstanding session links interleaved; payroll wording can imply payment |
| Milking identity/withdrawal/receipt/next task | Partial → Implemented | Entry cards and withdrawal disclosure implemented; add contextual Dispatch continuation after successful save |
| Dispatch units/rate/occasional/buyer maintenance | Partial → Implemented | Units and distinctions implemented; maintenance navigation needs explicit draft consequence |
| Buyers creation/rate effective date/historical billing/action names | Implemented → Retained | destinations-list separate editors, named actions and retained billed-rate explanation |
| Buyer balance/period/adjustment/numeric alignment | Implemented → Retained | destination-detail split sections and signed adjustment guidance; verify narrow content |
| Payroll completeness/period/totals/earned vs paid | Implemented → Retained | payroll-run save summary and salaried/daily distinctions |
| Health editor above board, searchable references, groups | Partial → Implemented | Existing focus/group/search; historical exception fields always shown and editor return context needs improvement |
| Vaccination rounds selected summary/search | Implemented → Retained | selected entries retained while filtering; no planned-dose execution inference |
| Analytics trend/coverage/inspector/table/context/reset | Partial → Implemented | Trend and selector exist; add inspector previous/next and reduce unavailable-comparison panel; retain URL context and calculations |
| Shared chart/data contracts | Partial → Implemented | ScrollRegion/Cell/theme reused; standalone chart presentation and analytics retain distinct containers; consolidate shared panel presentation without changing adapters |
| Check record/action before proof, severity distinctions | Implemented → Retained | check-presentation and verification-panel separate violation/advisory/coverage; technical proof disclosed |
| Assistant context/expand/decision receipts/branding | Partial → Implemented | Context/expand/state tests exist; standalone branding repeated and settled fallback text incorrectly always says waiting; technical operation should be a separate disclosure |
| Navigation hierarchy/recording identity/unknown route | Partial → Implemented | Compact menu chosen over sidebar, complete hierarchy and Escape implemented; unknown routes silently redirect; add recovery page |
| Domain safeguards and uncertainty | Implemented → Retained | No model/API/calculation changes planned; exact-request retries, locks, revisions, snapshots, provenance, precision remain |
| Browser states and fault injection | Outstanding → Partial acceptance | Changed-workflow browser checks completed; exhaustive per-writer failure/navigation permutations remain outstanding |
| Native phone/screen reader/zoom/print/export/live executor/operator | Outstanding acceptance | Do not claim without actual execution; synthetic UI checks cannot close these gates |

## Completed screen implementation

Implemented in the requested order: People/Feed and ordinary form/table patterns, animal/correction and operational screens, then Health, analytics, assistant and navigation. These source statuses do not close the separate acceptance gates.

| Recommendation family | Final implementation / concrete evidence |
|---|---|
| Current type, spacing and state reference | [UI-CURRENT.md](../UI-CURRENT.md) and [inspectable specimen](geist-screen-evidence/ui-specimen.html), with a reproducible generator; field grids align to content rather than stretching neighboring inputs |
| People | Imported the existing ScrollRegion consumer; clear Add person/Open stint actions; concise immutable-ID and rehire help; identity/name picker context; balance-first table and unbroken last-paid dates |
| Person | Balance/open-stint summary and payment action precede history; payment field groups; adjustment versus payment versus earned-wage copy; wrapping ledger rows |
| Feed overview | Compact costs/coverage retained; supply/quantity/crop lists in native disclosures; purchase drilldown carries the selected date range |
| Crops and purchases | Crop search/lifecycle/reset including archived records; current lifecycle explicitly separate from history; focused new forms omit review lists; item/delivery, quantity/original unit, pricing agreement and charges grouped |
| Feeding history/account | Route-specific primary actions; retained text statuses, saved recipients, independent nested-purchase notice, removal history and guards |
| Herd and animal events | Combined serial/name with prominent status; human correction choices and precision-aware current/proposed values; acquired birth summary does not invent a day; raw source/event values retained in disclosure |
| Add animal, calving list/entry, report | Existing scoped improvements retained after source reconciliation: native field order, acquired/farm-born meaning, Dam search/errors, precision, filter reset, report contents and vaccination scope. No unsupported native-output acceptance claim |
| Today | Outstanding session answers before recorded-review links; payroll period recording and earned-versus-paid distinction explicit |
| Milking/Dispatch/Payroll | Successful milking receipt and optional same-date/session Dispatch link; buyer maintenance opens a separate tab with draft/reload consequence stated; desktop local sticky table headers, existing mobile cards and write semantics preserved |
| Buyers/detail and Check | Existing effective-date/billed-rate, balance/credit/adjustment and severity/proof contracts retained; no unnecessary rewrite |
| Health | Blank irrelevant historical explanations disclosed on demand; values/errors always visible and retained; administration, withdrawal and evidence groups; human draft context; normal control heights beside taller date/search groups |
| Analytics/shared reporting | Previous/next date inspector with URL/filter scope and correctly reflected native selection; compact unavailable comparison; shared presentation-only Metric/CoverageNotice/ChartPanel/ChartDataTable/RecordDrilldown directives; calculations and data alternatives retained |
| Assistant | Less duplicate branding; proposed-effect action label; separate technical operation disclosure; truthful rejected/awaiting/recorded/refused/unknown fallback receipts |
| Navigation | Existing complete mobile Menu retained; guarded unknown-route recovery with Today/animal actions and keyboard activation |

Routine design decisions: retain native selects plus search for long entity lists; retain compact top navigation instead of adding a sidebar; keep optional history counts available; use local sticky entry headers without a pinned identity column because measured desktop sheets fit horizontally and mobile sheets already reflow. These decisions preserve the audit's intent without inventing new domain behavior.

- [x] Reconcile actionable findings against source before implementation.
- [x] Complete remaining screen presentation and shared-consumer changes.
- [x] Validate representative changed workflows at desktop/mobile light/dark, with narrow/long/error/draft/recovery checks.
- [x] Frontend 458 tests, server 779 tests, production build, typecheck, contrast and template gates.
- [ ] Exhaustive browser fault/navigation matrix across every writer (separate from representative execution).
- [ ] Native device/screen reader/zoom/text-spacing/print/export/live executor/operator acceptance.

See [screen-specific acceptance](geist-screen-evidence/ACCEPTANCE.md) for 144 browser captures, exact executed interactions, final source/build hashes, validation logs, capture chronology, and explicit remaining gaps. No backend models, APIs, calculations, money/date parsing, historical rates, recipient snapshots, revision handling, write locks or exact-request retries changed. Approval remains separate from a successful result. The implementation was subsequently committed and pushed as `a56400a` at the user’s request; no merge, deployment or publication was performed.

 Historical route captures below are not completion evidence for these remaining recommendations.

---

# Audit implementation — 28–30 September 2026

Baseline a1dd2a7, unchanged tracked source at start. Existing untracked docs/reviews preserved. No AGENTS.md found in repository or ancestor directories. Node 22.22.3 is required (default shell 22.3.0 cannot run Angular). Baseline: 450 tests / 42 files pass; see geist-evidence/baseline-tests.txt.

## Historical phases (not proof of screen completion)

- [x] P1: control boundaries, mobile sizing/cascade, spacing/type/surfaces, field associations, date copy, draft consequences.
- [ ] P2 (partial at a70aa1e): People/Feed pilot, labels/help/errors, attached units, entity search, form width/grouping, tables and remaining route consumers.
- [ ] P3 (partial at a70aa1e): Health editor/round, analytics inspector/coverage, assistant receipts/context, complete mobile navigation.
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
