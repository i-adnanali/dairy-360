# Open items — one index, no content

Every unfinished thing in this repo, in one list. **This file holds no reasoning.**
Each line links to the section that owns it; that section stays the single source
of truth. If you resolve something, strike it in its home document *and* delete
the line here.

Items were scattered across seven documents before this existed, which is why
"what is left?" had no answer.

---

## Blocking on the real farm

These cannot be closed from the repo. They need the farm, the herd, or a person.

- **The five-animal trial has not run.** REGISTRY_ENTRY_UX items 7 and 8 are
  gated on it, and the remaining predictions are on record waiting to be scored —
  [REGISTRY_ENTRY_UX.md §11](REGISTRY_ENTRY_UX.md#11-still-open)
- **Real backfill is not recorded as completed.** The last documented live
  registry check was empty; a current `verify:registry` run is needed before
  making any claim about its contents —
  [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **`RESTRICTED_ZONES = { 'feed_store' }` is provisional.** Whether `barn` or
  `yard` should also be restricted overnight is the farm's answer, not ours —
  [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)
- **`CALF_MAX_AGE_MONTHS = 18` and `DOUBLE_ENTRY_WINDOW_DAYS = 60` are
  provisional** — reasoned, not measured — [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **Per-delivery `price_per_litre` capture needs confirming against real data**
  (a later price change must never rewrite delivery history) —
  [MULTI_AGENT.md § Open items](MULTI_AGENT.md#open-items)
- **Are there opening balances for staff?** The wage ledger is live and opens at zero for
  everybody; an outstanding advance or a part-paid month needs one `adjustment` payment each —
  [REGISTRY_PAYROLL.md §15](REGISTRY_PAYROLL.md#15-still-open)
- **Is leave deductible from a monthly salary?** The schema is deliberately agnostic; the absence
  table cannot be built without the answer —
  [REGISTRY_PAYROLL.md §11](REGISTRY_PAYROLL.md#11-leave-named-deferred-and-cheap-to-add-later)

## Known defects and limitations

These remain open; the linked sections describe their consequences.

- **Agent approvals have no cross-request replay protection.** Replaying the
  same pre-write history and approval can execute a demo write again. Registry
  HTTP idempotency keys do not cover agent executors —
  [TECHNICAL.md §1.3](TECHNICAL.md#13-the-write-gate-pause-and-resume).

- **The model offers registry writes it cannot perform.** `log_milking` hits the
  demo table and `guardIds` rejects a `BD-` serial, so the offer is a confusing
  dead end. One clause in the prompt, and it wants its own eval —
  [REGISTRY_TOOLS.md § Open items](REGISTRY_TOOLS.md#open-items)
- **Real Double Take labels every unknown face `'unknown'`**, so classification
  rule 2 counts all strangers as one person — [cycle-7-followups.md FU-4](cycle-7-followups.md#fu-4)
- **`farm_events.confidence` systematically underestimates the detection score**
  — [cycle-7-followups.md FU-1](cycle-7-followups.md#fu-1)
- **`detect.match.save: false` is silently ignored** — Double Take writes face
  crops anyway — [cycle-7-followups.md FU-6](cycle-7-followups.md#fu-6)
- **`registry_animals.origin` is written by a command, not the rebuild** — the
  one column stopping "projection tables can be dropped and recreated" from
  being literally true — [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **Status goes stale as animals age**, because the `calf` rule reads the current
  date. The fix is a rebuild; `verify:registry` says so —
  [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **The generator is still host-local.** `classify.ts` is zone-correct and the
  scripts pin `TZ`, but `scenarioStartMs()` composes host-relative —
  [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)
- **`langfuse.trace.metadata` stringification warning** — cosmetic —
  [OBSERVABILITY.md § Open items](OBSERVABILITY.md#open-items)

## Missing capability, deliberately deferred

- **Session `source_ref` capture is missing.** In-place session editing is built;
  the paper/card reference still has no entry control —
  [REGISTRY_ENTRY_UX.md §6.8](REGISTRY_ENTRY_UX.md#68-session-band)

Built when something needs them, not before.

- **No retention policy on `farm_events`** — now sized rather than guessed at
  ~1,600 rows and ~2.7 MB/day per camera —
  [FARM_EVENTS.md § Open items](FARM_EVENTS.md#open-items)
- **No camera health monitoring**; a dropout and a quiet camera are
  indistinguishable, and no threshold separates them —
  [FARM_EVENTS.md § Open items](FARM_EVENTS.md#open-items),
  [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)
- **`unknown_cluster` has no real producer** — the shape (embeddings + clustering,
  or on-the-fly enrolment) is genuinely undecided —
  [FARM_EVENTS.md § Open items](FARM_EVENTS.md#open-items),
  [cycle-7-followups.md FU-5](cycle-7-followups.md#fu-5)
- **Multi-zone events lose fidelity** in the indexed `zone` column; waiting for a
  query that wants a join table — [FARM_EVENTS.md § Open items](FARM_EVENTS.md#open-items)
- **Frigate `end` events are dropped**, so dwell time is unavailable —
  [FARM_EVENTS.md § Open items](FARM_EVENTS.md#open-items)
- **`registry:add` cannot record an animal's dam**; the `certainty` column exists
  and nothing writes it — [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **No first-class correction for non-calving events**; superseding a `dry_off`,
  `departure` or `note` means calling `appendEvent()` directly —
  [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **`correctOutcome()` is deferred**, with a procedural workaround —
  [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **The lactation curve on `/animals/:id`** is the one piece of REGISTRY_MILKING
  §9 still unbuilt — [REGISTRY_MILKING.md §13](REGISTRY_MILKING.md#13-still-open)
- **Absences are not recorded**, so the cost of covering leave with dihari cannot be reported. One
  table and one nullable column, deliberately deferred —
  [REGISTRY_PAYROLL.md §11](REGISTRY_PAYROLL.md#11-leave-named-deferred-and-cheap-to-add-later)
- **No agent tools over payroll**, and not for the usual reason: the chat panel has no notion of who
  is using it, and salaries are the first data where that matters —
  [REGISTRY_PAYROLL.md §14](REGISTRY_PAYROLL.md#14-build-order)
- **In-kind benefits are not valued anywhere.** The run compares milk litres taken against the
  allowance, but no rupee figure is computed, because the reference price is undecided —
  [REGISTRY_PAYROLL.md §15](REGISTRY_PAYROLL.md#15-still-open)
- **Quality-based milk pricing (fat / SNF) is not built.** The farm is flat-rate
  today; the seam it would use is named rather than left to be invented —
  [REGISTRY_SALES.md §4.2](REGISTRY_SALES.md#42-prices-effective-dated-agreement-captured-on-the-dispatch)
- **No batch price change.** Deliberate at three buyers, with a named trigger to
  build it — [REGISTRY_SALES.md §12.2](REGISTRY_SALES.md#122-milkbuyers--destinations-and-prices)
- **No revisions trail on a corrected dispatch, payment, wage period or wage payment**, so a
  changed figure leaves no history. Payroll deliberately did not invent a second answer and waits on
  the sales one — [REGISTRY_SALES.md §8](REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle),
  [REGISTRY_PAYROLL.md §8](REGISTRY_PAYROLL.md#8-corrections)
- **The six demo vendor tools and `get_yield_vs_deliveries` are now redundant**
  and still advertised; disposing of them is a writes-cycle decision —
  [REGISTRY_SALES.md §2](REGISTRY_SALES.md#2-the-finding-this-is-already-implemented-and-its-money-model-cannot-represent-the-farm)
- **No `get_lactation_history`, no registry `search_animals`, no digest budget on
  `get_registry_animal`** — each has a named trigger to build it —
  [REGISTRY_TOOLS.md § Open items](REGISTRY_TOOLS.md#open-items)
- **Repeated `summarize_daily_activity` re-classifies already-classified rows** —
  wasteful, not wrong — [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)
- **Scheduling (cron vs. on-demand) and unflagging / flag history** —
  [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)

## Test and eval gaps

- **UI contrast and colour-vision checks remain open.** The current contrast
  report has 30 failures; the resting input border remains explicitly held.
  The categorical agent ramp still needs colour-vision testing —
  [UI_SYSTEM.md §16](UI_SYSTEM.md#16-unverified-and-undecided)

- **Regression flakiness is unmeasured.** Two clean local passes is a small
  sample; the fallback is recorded transcripts —
  [REGRESSION.md § Open items](REGRESSION.md#open-items)
- **Eval 6 tests one round of pushback, not a campaign.** Escalating pressure is
  the realistic failure shape — [REGISTRY_TOOLS.md § Open items](REGISTRY_TOOLS.md#open-items)
- **"Unavailable API key" is uncovered** in the regression harness; it is a
  route-level guard and would need an HTTP-level test —
  [REGRESSION.md § Open items](REGRESSION.md#open-items)
- **No mocked-model path** for contributors without an API key beyond "the job
  skips" — [REGRESSION.md § Open items](REGRESSION.md#open-items)
- **The validation camera cannot close the remaining gaps** — it resolves neither
  multi-zone nor faces — [cycle-7-followups.md FU-2](cycle-7-followups.md#fu-2)

## Undecided questions

- **Should the milking roster get a "same as last session" accelerator?** And
  what happens to a session entered for the wrong date, given update-in-place
  leaves no history? — [REGISTRY_MILKING.md §13](REGISTRY_MILKING.md#13-still-open)
- **Should `not_milked` with reason `sick` also write a `note` event?** —
  [REGISTRY_MILKING.md §13](REGISTRY_MILKING.md#13-still-open)
- **How is a dispatch row corrected?** Update-in-place plus a revisions table,
  or freeze-on-settlement — the milking answer does not carry, because money is
  derived from it and there is a counterparty —
  [REGISTRY_SALES.md §8](REGISTRY_SALES.md#8-corrections-the-one-question-this-document-does-not-settle)
- **Yield interval bands**, the equivalent of the calving-interval bands —
  [REGISTRY_MILKING.md §13](REGISTRY_MILKING.md#13-still-open)
- **Does reconciliation want its own persistent UI widget**, or is a chat answer
  enough? — [MULTI_AGENT.md § Open items](MULTI_AGENT.md#open-items)
- **Revisit "two agents" vs. merged tools** if the dispatcher's `both` default
  fires on nearly every turn — [MULTI_AGENT.md § Open items](MULTI_AGENT.md#open-items)
- **Widen the original 12-scenario regression set?** Six registry precision evals
  have since been added; broader coverage remains a separate question —
  [REGRESSION.md § Open items](REGRESSION.md#open-items)
- **Revisit Langfuse's ClickHouse-acquisition implications** —
  [OBSERVABILITY.md § Open items](OBSERVABILITY.md#open-items)
- **Cycle 6 (live-model tool-selection/narration testing) was never written up.**
  Whether it ran, and what it found, is not recorded anywhere.

---

## Housekeeping

- **`registry.harness.test.ts`'s no-database module list is maintained by hand**,
  and `milking.ts` was missing from it for a whole cycle. The sales cycle found the omission while adding more modules by
  hand —
  [REGISTRY_SALES.md §17.5](REGISTRY_SALES.md#175-milkingts-was-never-in-the-harnesss-no-database-list)

- **The local Langfuse Docker stack teardown** is optional; the recorded
  validation left it running, and current status needs a container check —
  [OBSERVABILITY.md § Open items](OBSERVABILITY.md#open-items)
- **Off-machine backups do not exist.** Versioned local history runs; the
  off-machine half does not — [DEVELOPMENT.md §8](DEVELOPMENT.md)
- **Doc naming is inconsistent** (`SCREAMING_SNAKE`, `cycle-7-…`, `Cycle7-fu3-…`)
  and left that way on purpose: ~300 code citations reference these filenames.
  See [README.md § Conventions](README.md#conventions).
