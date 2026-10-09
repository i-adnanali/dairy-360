# Open work

This is the active status index. Stable `OPEN-*` identifiers locate existing items; original Cycle 7 `FU-*` IDs remain in linked evidence. Unless stated otherwise, items are open/deferred, not newly authorized implementation work. Resolve status here and link new evidence; do not rewrite historical records to appear current.

The 9 October 2026 scope decision closes the Angular remediation task with specific checks skipped; see [acceptance status](reference/ui/acceptance-status.md). Other deferred product and real-farm work is unchanged. The old contrast-failure claim and inconsistent-current-filenames item are removed because their documented fixes are already delivered. [Current references](README.md) own behavior; links below retain the detailed rationale.

## Blocking on the real farm

These cannot be closed from the repo. They need the farm, the herd, or a person.

<a id="open-001"></a>

- **OPEN-001** — **The five-animal trial has not run.** REGISTRY_ENTRY_UX items 7 and 8 are
  gated on it, and the remaining predictions are on record waiting to be scored —
  [REGISTRY_ENTRY_UX.md §11](records/REGISTRY_ENTRY_UX.md#11-still-open)
<a id="open-002"></a>

- **OPEN-002** — **Real backfill is not recorded as completed.** The last documented live
  registry check was empty; a current `verify:registry` run is needed before
  making any claim about its contents —
  [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-003"></a>

- **OPEN-003** — **`RESTRICTED_ZONES = { 'feed_store' }` is provisional.** Whether `barn` or
  `yard` should also be restricted overnight is the farm's answer, not ours —
  [FARM_MONITOR.md § Open items](records/FARM_MONITOR.md#open-items)
<a id="open-004"></a>

- **OPEN-004** — **`CALF_MAX_AGE_MONTHS = 18` and `DOUBLE_ENTRY_WINDOW_DAYS = 60` are
  provisional** — reasoned, not measured — [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-005"></a>

- **OPEN-005** — **Per-delivery `price_per_litre` capture needs confirming against real data**
  (a later price change must never rewrite delivery history) —
  [MULTI_AGENT.md § Open items](records/MULTI_AGENT.md#open-items)
<a id="open-006"></a>

- **OPEN-006** — **Are there opening balances for staff?** The wage ledger is live and opens at zero for
  everybody; an outstanding advance or a part-paid month needs one `adjustment` payment each —
  [REGISTRY_PAYROLL.md §15](records/REGISTRY_PAYROLL.md#15-still-open)
<a id="open-007"></a>

- **OPEN-007** — **Is leave deductible from a monthly salary?** The schema is deliberately agnostic; the absence
  table cannot be built without the answer —
  [REGISTRY_PAYROLL.md §11](records/REGISTRY_PAYROLL.md#11-leave-named-deferred-and-cheap-to-add-later)

## Known defects and limitations

These remain open; the linked sections describe their consequences.

<a id="open-008"></a>

- **OPEN-008** — **Agent approvals have no cross-request replay protection.** Replaying the
  same pre-write history and approval can execute a demo write again. Registry
  HTTP idempotency keys do not cover agent executors —
  [TECHNICAL.md §1.3](records/TECHNICAL.md#13-the-write-gate-pause-and-resume).

<a id="open-009"></a>

- **OPEN-009** — **Registry-write refusal needs a dedicated live-model eval.** The prompt now
  explicitly directs recording to registry screens and forbids demo health tools
  for registry serials. The earlier observed offer needs regression coverage —
  [REGISTRY_TOOLS.md § Open items](records/REGISTRY_TOOLS.md#open-items)
<a id="open-010"></a>

- **OPEN-010** — **Real Double Take labels every unknown face `'unknown'`**, so classification
  rule 2 counts all strangers as one person — [cycle-7-followups.md FU-4](records/cycle-7-followups.md#fu-4)
<a id="open-011"></a>

- **OPEN-011** — **`farm_events.confidence` systematically underestimates the detection score**
  — [cycle-7-followups.md FU-1](records/cycle-7-followups.md#fu-1)
<a id="open-012"></a>

- **OPEN-012** — **`detect.match.save: false` is silently ignored** — Double Take writes face
  crops anyway — [cycle-7-followups.md FU-6](records/cycle-7-followups.md#fu-6)
<a id="open-013"></a>

- **OPEN-013** — **`registry_animals.origin` is written by a command, not the rebuild** — the
  one column stopping "projection tables can be dropped and recreated" from
  being literally true — [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-014"></a>

- **OPEN-014** — **Status goes stale as animals age**, because the `calf` rule reads the current
  date. The fix is a rebuild; `verify:registry` says so —
  [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-015"></a>

- **OPEN-015** — **The generator is still host-local.** `classify.ts` is zone-correct and the
  scripts pin `TZ`, but `scenarioStartMs()` composes host-relative —
  [FARM_MONITOR.md § Open items](records/FARM_MONITOR.md#open-items)
<a id="open-016"></a>

- **OPEN-016** — **`langfuse.trace.metadata` stringification warning** — cosmetic —
  [OBSERVABILITY.md § Open items](records/OBSERVABILITY.md#open-items)

## Missing capability, deliberately deferred

<a id="open-017"></a>

- **OPEN-017** — **Session-level `source_ref` capture is missing.** In-place session editing is built;
  the shared session gate has no paper/card-reference control. Feed and health now capture
  their own source reference per record —
  [REGISTRY_ENTRY_UX.md §6.8](records/REGISTRY_ENTRY_UX.md#68-session-band)

Built when something needs them, not before.

<a id="open-018"></a>

- **OPEN-018** — **No retention policy on `farm_events`** — now sized rather than guessed at
  ~1,600 rows and ~2.7 MB/day per camera —
  [FARM_EVENTS.md § Open items](records/FARM_EVENTS.md#open-items)
<a id="open-019"></a>

- **OPEN-019** — **No camera health monitoring**; a dropout and a quiet camera are
  indistinguishable, and no threshold separates them —
  [FARM_EVENTS.md § Open items](records/FARM_EVENTS.md#open-items),
  [FARM_MONITOR.md § Open items](records/FARM_MONITOR.md#open-items)
<a id="open-020"></a>

- **OPEN-020** — **`unknown_cluster` has no real producer** — the shape (embeddings + clustering,
  or on-the-fly enrolment) is genuinely undecided —
  [FARM_EVENTS.md § Open items](records/FARM_EVENTS.md#open-items),
  [cycle-7-followups.md FU-5](records/cycle-7-followups.md#fu-5)
<a id="open-021"></a>

- **OPEN-021** — **Multi-zone events lose fidelity** in the indexed `zone` column; waiting for a
  query that wants a join table — [FARM_EVENTS.md § Open items](records/FARM_EVENTS.md#open-items)
<a id="open-022"></a>

- **OPEN-022** — **Frigate `end` events are dropped**, so dwell time is unavailable —
  [FARM_EVENTS.md § Open items](records/FARM_EVENTS.md#open-items)
<a id="open-023"></a>

- **OPEN-023** — **`registry:add` cannot record an animal's dam**; the `certainty` column exists
  and nothing writes it — [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-024"></a>

- **OPEN-024** — **No first-class correction for non-calving events**; superseding a `dry_off`,
  `departure` or `note` means calling `appendEvent()` directly —
  [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-025"></a>

- **OPEN-025** — **`correctOutcome()` is deferred**, with a procedural workaround —
  [REGISTRY.md § Known fidelity gaps](records/REGISTRY.md#known-fidelity-gaps)
<a id="open-026"></a>

- **OPEN-026** — **The lactation curve on `/animals/:id`** is the one piece of REGISTRY_MILKING
  §9 still unbuilt — [REGISTRY_MILKING.md §13](records/REGISTRY_MILKING.md#13-still-open)
<a id="open-027"></a>

- **OPEN-027** — **Absences are not recorded**, so the cost of covering leave with dihari cannot be reported. One
  table and one nullable column, deliberately deferred —
  [REGISTRY_PAYROLL.md §11](records/REGISTRY_PAYROLL.md#11-leave-named-deferred-and-cheap-to-add-later)
<a id="open-028"></a>

- **OPEN-028** — **No agent tools over payroll**, and not for the usual reason: the chat panel has no notion of who
  is using it, and salaries are the first data where that matters —
  [REGISTRY_PAYROLL.md §14](records/REGISTRY_PAYROLL.md#14-build-order)
<a id="open-029"></a>

- **OPEN-029** — **In-kind benefits are not valued anywhere.** The run compares milk litres taken against the
  allowance, but no rupee figure is computed, because the reference price is undecided —
  [REGISTRY_PAYROLL.md §15](records/REGISTRY_PAYROLL.md#15-still-open)
<a id="open-030"></a>

- **OPEN-030** — **Quality-based milk pricing (fat / SNF) is not built.** The farm is flat-rate
  today; the seam it would use is named rather than left to be invented —
  [REGISTRY_SALES.md §4.2](records/REGISTRY_SALES.md#42-prices-effective-dated-agreement-captured-on-the-dispatch)
<a id="open-031"></a>

- **OPEN-031** — **No batch price change.** Deliberate at three buyers, with a named trigger to
  build it — [REGISTRY_SALES.md §12.2](records/REGISTRY_SALES.md#122-milkbuyers--destinations-and-prices)
<a id="open-032"></a>

- **OPEN-032** — **No revisions trail on a corrected dispatch, payment, wage period or wage payment**, so a
  changed figure leaves no history in those domains. Feed and health have their own immutable revision trails;
  it has not been generalized to sales or payroll. Payroll deliberately did not invent a second answer and waits on
  the sales one — [REGISTRY_SALES.md §8](records/REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle),
  [REGISTRY_PAYROLL.md §8](records/REGISTRY_PAYROLL.md#8-corrections)
<a id="open-033"></a>

- **OPEN-033** — **The six demo vendor tools and `get_yield_vs_deliveries` are now redundant**
  and still advertised; disposing of them is a writes-cycle decision —
  [REGISTRY_SALES.md §2](records/REGISTRY_SALES.md#2-the-finding-this-is-already-implemented-and-its-money-model-cannot-represent-the-farm)
<a id="open-034"></a>

- **OPEN-034** — **No `get_lactation_history`, no registry `search_animals`, no digest budget on
  `get_registry_animal`** — each has a named trigger to build it —
  [REGISTRY_TOOLS.md § Open items](records/REGISTRY_TOOLS.md#open-items)
<a id="open-035"></a>

- **OPEN-035** — **Repeated `summarize_daily_activity` re-classifies already-classified rows** —
  wasteful, not wrong — [FARM_MONITOR.md § Open items](records/FARM_MONITOR.md#open-items)
<a id="open-036"></a>

- **OPEN-036** — **Scheduling (cron vs. on-demand) and unflagging / flag history** —
  [FARM_MONITOR.md § Open items](records/FARM_MONITOR.md#open-items)

## Test and eval gaps

<a id="open-037"></a>

- **OPEN-037** — **Colour-vision and exhaustive accessibility acceptance are not established.** The automated contrast gate has passed; historical 30-failure/border-hold claims are superseded. Spoken screen-reader and native-mobile checks were explicitly skipped for the completed remediation on 9 October 2026; they are not outstanding gates for that task or certified passes. Broader accessibility coverage is unchanged. See [acceptance status](reference/ui/acceptance-status.md).

<a id="open-038"></a>

- **OPEN-038** — **Regression flakiness is unmeasured.** Two clean local passes is a small
  sample; the fallback is recorded transcripts —
  [REGRESSION.md § Open items](records/REGRESSION.md#open-items)
<a id="open-039"></a>

- **OPEN-039** — **Eval 6 tests one round of pushback, not a campaign.** Escalating pressure is
  the realistic failure shape — [REGISTRY_TOOLS.md § Open items](records/REGISTRY_TOOLS.md#open-items)
<a id="open-040"></a>

- **OPEN-040** — **"Unavailable API key" is uncovered** in the regression harness; it is a
  route-level guard and would need an HTTP-level test —
  [REGRESSION.md § Open items](records/REGRESSION.md#open-items)
<a id="open-041"></a>

- **OPEN-041** — **No mocked-model path** for contributors without an API key beyond "the job
  skips" — [REGRESSION.md § Open items](records/REGRESSION.md#open-items)
<a id="open-042"></a>

- **OPEN-042** — **The validation camera cannot close the remaining gaps** — it resolves neither
  multi-zone nor faces — [cycle-7-followups.md FU-2](records/cycle-7-followups.md#fu-2)

## Undecided questions

<a id="open-043"></a>

- **OPEN-043** — **Should the milking roster get a "same as last session" accelerator?** And
  what happens to a session entered for the wrong date, given update-in-place
  leaves no history? — [REGISTRY_MILKING.md §13](records/REGISTRY_MILKING.md#13-still-open)
<a id="open-044"></a>

- **OPEN-044** — **Should `not_milked` with reason `sick` also write a `note` event?** —
  [REGISTRY_MILKING.md §13](records/REGISTRY_MILKING.md#13-still-open)
<a id="open-045"></a>

- **OPEN-045** — **How is a dispatch row corrected?** Update-in-place plus a revisions table,
  or freeze-on-settlement — the milking answer does not carry, because money is
  derived from it and there is a counterparty —
  [REGISTRY_SALES.md §8](records/REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle)
<a id="open-046"></a>

- **OPEN-046** — **Yield interval bands**, the equivalent of the calving-interval bands —
  [REGISTRY_MILKING.md §13](records/REGISTRY_MILKING.md#13-still-open)
<a id="open-047"></a>

- **OPEN-047** — **Demo-domain reconciliation UI remains a separate decision.** Registry production/dispatch reconciliation is already implemented at `/analytics`; the older question concerns demo-agent `get_yield_vs_deliveries` — [MULTI_AGENT.md § Open items](records/MULTI_AGENT.md#open-items)
<a id="open-048"></a>

- **OPEN-048** — **Revisit "two agents" vs. merged tools** if the dispatcher's `both` default
  fires on nearly every turn — [MULTI_AGENT.md § Open items](records/MULTI_AGENT.md#open-items)
<a id="open-049"></a>

- **OPEN-049** — **Widen the original 12-scenario regression set?** Six registry precision evals
  have since been added; broader coverage remains a separate question —
  [REGRESSION.md § Open items](records/REGRESSION.md#open-items)
<a id="open-050"></a>

- **OPEN-050** — **Revisit Langfuse's ClickHouse-acquisition implications** —
  [OBSERVABILITY.md § Open items](records/OBSERVABILITY.md#open-items)
<a id="open-051"></a>

- **OPEN-051** — **Cycle 6 (live-model tool-selection/narration testing) was never written up.**
  Whether it ran, and what it found, is not recorded anywhere.

---

## Housekeeping

<a id="open-052"></a>

- **OPEN-052** — **`registry.harness.test.ts`'s no-database module list is maintained by hand**,
  and `milking.ts` was missing from it for a whole cycle. The sales cycle found the omission while adding more modules by
  hand —
  [REGISTRY_SALES.md §17.5](records/REGISTRY_SALES.md#175-milkingts-was-never-in-the-harnesss-no-database-list)

<a id="open-053"></a>

- **OPEN-053** — **The local Langfuse Docker stack teardown** is optional; the recorded
  validation left it running, and current status needs a container check —
  [OBSERVABILITY.md § Open items](records/OBSERVABILITY.md#open-items)
<a id="open-054"></a>

- **OPEN-054** — **Off-machine backups are not documented as configured.** Versioned local history has a recorded setup; current runtime status has not been rechecked — [DEVELOPMENT.md §8](records/DEVELOPMENT.md)

## Feed follow-up

<a id="open-055"></a>

- **OPEN-055** — **Real-farm feed usability remains unverified.** Isolated UI checks do not complete the farm trial — [REGISTRY_FEED.md reporting boundaries](records/REGISTRY_FEED.md#reporting-choices-and-boundaries).

## Health and lifetime-report follow-up

<a id="open-056"></a>

- **OPEN-056** — Structured weight, movement, breed, breeding/pregnancy and discarded-milk capture
  remain stage 3; the report labels unsupported coverage — [REGISTRY_HEALTH.md](records/REGISTRY_HEALTH.md#using-it).
<a id="open-057"></a>

- **OPEN-057** — Health/report real-farm acceptance remains unverified. Actual Chrome/Safari A4 Save-as-PDF output was verified on synthetic animal reports, including complete audit content and repeated long identity. Alternative-format support and further browser/report coverage were skipped on 9 October 2026; the known alternate-format limitation remains. See [current status and PDF evidence](reference/ui/acceptance-status.md), and the [original delivery record](records/REGISTRY_HEALTH.md#validation).
<a id="open-058"></a>

- **OPEN-058** — Large-history server pagination and scheduled cleanup of unlinked uploads are
  not implemented; the current API returns full snapshots and cleanup is an explicit
  helper — [REGISTRY_HEALTH.md](records/REGISTRY_HEALTH.md#interfaces).

## Analytics follow-ups

<a id="open-059"></a>

- **OPEN-059** — First-release production/reconciliation dashboards and table controls are built.
See [ANALYTICS_SPEC.md](records/ANALYTICS_SPEC.md). Remaining work: real-farm trial of
recording adoption, milk carryover and buyer settlement conventions; server paging
for large composite histories; analytics report/export adapters; and later feed,
health and financial analytics. Monthly payment practice alone does not define an
overdue balance, and production-minus-dispatch is not established milk loss.

## Screen-specific UI acceptance — scope decision

<a id="open-060"></a>

- **OPEN-060** — **Angular remediation closed within the agreed scope.** Screen implementation at `a56400a` and subsequent fixes through `cb94fe9` are delivered. Feed comparison races and native A4 animal/buyer PDF checks have recorded evidence. On 9 October 2026, the owner chose to skip alternative print formats, Firefox/additional reports, spoken-reader and native-mobile acceptance. Those exclusions no longer block this remediation and are not passes. Unrelated historical follow-ups—including operator/large-data walkthroughs, live assistant/unknown-write acceptance, exhaustive per-writer permutations and further zoom/text-spacing coverage—are unchanged. [Current decision and evidence](reference/ui/acceptance-status.md) · [original acceptance scope](implementation/geist-screen-evidence/ACCEPTANCE.md#remaining-acceptance--explicitly-open).

## Camera finding carried forward

<a id="camera-fu-5"></a>

- **CAMERA-FU-5** — Per-individual unfamiliar-visitor recognition remains a design-stage proposal. No implementation is implied by the unknown-cluster field. [Original finding](records/cycle-7-followups.md#fu-5). FU-3 remains historically closed; FU-1/2/4/6 are indexed above.
