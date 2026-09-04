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
  gated on it, and predictions 1–5 are on record waiting to be scored —
  [REGISTRY_ENTRY_UX.md §11](REGISTRY_ENTRY_UX.md#11-still-open)
- **The registry is empty.** Every `verify:registry` run against the live
  database passes vacuously until a real animal is entered —
  [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **`RESTRICTED_ZONES = { 'feed_store' }` is provisional.** Whether `barn` or
  `yard` should also be restricted overnight is the farm's answer, not ours —
  [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)
- **`CALF_MAX_AGE_MONTHS = 18` and `DOUBLE_ENTRY_WINDOW_DAYS = 60` are
  provisional** — reasoned, not measured — [REGISTRY.md § Known fidelity gaps](REGISTRY.md#known-fidelity-gaps)
- **Per-delivery `price_per_litre` capture needs confirming against real data**
  (a later price change must never rewrite delivery history) —
  [MULTI_AGENT.md § Open items](MULTI_AGENT.md#open-items)

## Known defects, safe today

Each fails safely and is written down rather than fixed.

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
- **No `get_lactation_history`, no registry `search_animals`, no digest budget on
  `get_registry_animal`** — each has a named trigger to build it —
  [REGISTRY_TOOLS.md § Open items](REGISTRY_TOOLS.md#open-items)
- **`get_milking_record` has no fixture rows**, so half the precision story has
  no eval — [REGISTRY_TOOLS.md § Open items](REGISTRY_TOOLS.md#open-items)
- **Repeated `summarize_daily_activity` re-classifies already-classified rows** —
  wasteful, not wrong — [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)
- **Scheduling (cron vs. on-demand) and unflagging / flag history** —
  [FARM_MONITOR.md § Open items](FARM_MONITOR.md#open-items)

## Test and eval gaps

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
- **Yield interval bands**, the equivalent of the calving-interval bands —
  [REGISTRY_MILKING.md §13](REGISTRY_MILKING.md#13-still-open)
- **Does reconciliation want its own persistent UI widget**, or is a chat answer
  enough? — [MULTI_AGENT.md § Open items](MULTI_AGENT.md#open-items)
- **Revisit "two agents" vs. merged tools** if the dispatcher's `both` default
  fires on nearly every turn — [MULTI_AGENT.md § Open items](MULTI_AGENT.md#open-items)
- **Widen the regression suite to the planned 15–20 scenarios?** —
  [REGRESSION.md § Open items](REGRESSION.md#open-items)
- **Revisit Langfuse's ClickHouse-acquisition implications** —
  [OBSERVABILITY.md § Open items](OBSERVABILITY.md#open-items)
- **Cycle 6 (live-model tool-selection/narration testing) was never written up.**
  Whether it ran, and what it found, is not recorded anywhere.

---

## Housekeeping

- **The local Langfuse Docker stack teardown** is optional and not done —
  [OBSERVABILITY.md § Open items](OBSERVABILITY.md#open-items)
- **Off-machine backups do not exist.** Versioned local history runs; the
  off-machine half does not — [DEVELOPMENT.md §8](DEVELOPMENT.md)
- **Doc naming is inconsistent** (`SCREAMING_SNAKE`, `cycle-7-…`, `Cycle7-fu3-…`)
  and left that way on purpose: ~300 code citations reference these filenames.
  See [README.md § Conventions](README.md#conventions).
