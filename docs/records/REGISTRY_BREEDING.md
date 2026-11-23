# Registry breeding, stage 1

> Decision record, 13 November 2026. Stage 1 of five. Written with the change that made
> the five breeding event types live; later stages add to it.

## What stage 1 is

Stage 1 lets the registry record breeding events and read back, for each animal, where she
is in her cycle: when she was served, whether a check has confirmed her, and the window in
which she should calve. It is read-only derivation over events that are only ever added.
It leaves out warnings and overrides, tasks, KPIs, entry forms and the Breeding page. The
server flag `REGISTRY_BREEDING=1` switches it on; with the flag off, the API and the pages
show what they did before. The flag does not cover the database: see
[Migration 10 is one-way](#migration-10-is-one-way).

## A second derived axis, not a new status

Reproductive state is computed on read and never stored. It is separate from the animal's
status, which stays as it is. This supersedes the sentence in
[REGISTRY.md](REGISTRY.md) ("At step 5 it gets added") that planned to add `pregnant` to
`RegistryAnimalStatus`. The reason is that the state has eleven values and changes with the
calendar day, while the status projection is compared row for row across rebuilds. A value
that moves with the date cannot sit in a projection that must rebuild to the same rows.

## Constants

All days are counted from the earliest possible conception. Sources are in the stage 1
spec and its research guide, and are not re-derived here.

| Constant | Value | Kind |
| --- | --- | --- |
| Gestation window opens | day 285 | breed-specific |
| Gestation window closes | day 325 | breed-specific |
| Expected calving | day 308 | breed-specific |
| Close-up lead | 21 days (starts day 264) | farm-tunable default |
| Dry-off lead | 60 days (starts day 248) | farm-tunable default |
| "Bred" lasts through | day 24 | biological constant |

| Check | Positive counts from | Negative counts from | Kind |
| --- | --- | --- | --- |
| Palpation | day 46 | day 46 | biological constant |
| Ultrasound | day 30 | day 30 | biological constant |
| PAG | day 28 | day 28 | biological constant |
| Progesterone | never | day 20 | biological constant |

## Dates

Breeding events accept `day` or `month` precision only, and `pregnancy_check` accepts `day`
only. `year` and `estimated` are refused, because a year-wide service date gives a calving
window too wide to say anything. The spec's warning row that mentions year-precision is
therefore stale. A breeding event dated after the animal's departure is refused, with no
override.

## Correction path added after review

On 2026-11-16, after review and before any real service was entered, the owner added a correction path to stage 1. A correction is a superseding event: `recordBreedingEvent` takes `supersedes_id` and `registry:breed` takes `--supersedes`. It must be the same type on the same animal, and an event can be corrected once. Retraction (saying an event never happened) is not built; it remains OPEN-064.

## Migration 10 is one-way

Migration 10 widens the event table's `type` check so it can hold the five breeding types. It
is one-way: it runs the first time a build that has it opens the database, whatever the flag
says, and a build from before it refuses to open the migrated database. Rolling back means
restoring a backup taken before it ran, such as the pre-migration snapshot; see
[Back up, verify and restore registry data](../guides/backup-restore.md).

## Left alone on purpose

`GESTATION_DAYS = 310` in `calving.ts` is not revisited. It is a floor for how soon after
her own birth a calving may be recorded, not a gestation length, and stage 1 does not use
it. `null_observation` is given the narrow breeding payload (`watched_for`) here, although
[REGISTRY.md](REGISTRY.md) Decision 8 imagined it arriving with sheet transcription.

## Stage 2: entry for services and checks, on a pilot

**Scope.** Stage 2 opens HTTP entry for `insemination` and `pregnancy_check`, on the animals listed in `REGISTRY_BREEDING_PILOT` only. The other breeding types (`heat_observed`, `null_observation`, `abortion`) stay CLI-only. The CLI is not gated by the pilot.

**Three warnings, not refusals.** `ambiguous_service` fires when a new insemination joins a case that already has a service with nothing ruling it out. `check_without_service` fires when a pregnancy check has no service on or before it. `early_check` fires when the derived latest check is not reliable for its method's day (`CHECK_RELIABLE_FROM`). Each describes something unusual but possible: a repeat service before a heat is seen, a check on a service that was never entered, a check taken early. The farm may know better than the record, so each is a warning the caller can save over with `allow_ambiguous_service`, `allow_early_check` or `allow_check_without_service`, and the override is recorded from the condition, never from the flag. Only the impossible is refused.

**One source of rules.** Warnings are answered by `deriveReproduction`, not by a second set of rules, so a warning and the badge cannot disagree.

**Spec warnings left for later.** The 36-hour heat check and the gestational-heat check wait for heat entry (stage 3), because with no heat entry the first would fire on every service. The two calving-window checks are calving writes, not entries this stage opens (stage 4). The month-precision check needs a "the farm normally knows the day" setting that does not exist; open question 07 stays open, and the Breeding tab shows the widened range instead. The bull-exposure ceiling is a check on the calendar, not on a write (stage 3, with tasks).

**One override column.** At most one stage 2 warning fires per event: a service can only trip `ambiguous_service`, and a check trips `check_without_service` (no service on file) or `early_check` (a service on file), never both. Stage 3's 36-hour heat check can fire on a service that is also ambiguous, so stage 3 decided how to record two: see [Stage 3](#stage-3-heat-entry-two-overrides-notes-and-tasks) ([OPEN-066](../OPEN.md#open-066), closed).

**No correction from the page.** A wrong entry is corrected with `registry:breed --supersedes`; a Correct action on the page is not built ([OPEN-065](../OPEN.md#open-065)).

**Migration 11 is one-way.** Migration 11 widens `override_check` so it can hold the three new names. Like migration 10, it is one-way.

## Stage 3: heat entry, two overrides, notes and tasks

**Scope.** Stage 3 opens HTTP entry for `heat_observed` and `null_observation` on the pilot, beside the stage 2 types. Tasks show on Today, on the animal page and on the Breeding page. `abortion` stays CLI-only (stage 4).

**Two overrides on one save ([OPEN-066](../OPEN.md#open-066), decided by the owner).** An `override_checks` list replaces the single `override_check` column (migration 12, one-way). `override_reason` stays one line for the whole save-over. Every override is still recorded from the condition, never from the flag.

**Two warnings, not refusals.** `no_heat_sign` fires on a service with no heat sign before it; `heat_after_positive` fires on a heat recorded after a positive check. Each is unusual but possible: a service made without a seen heat, a heat seen on an animal later found pregnant. The farm may know better than the record, so the caller can save over each. The heat-sign warning does not apply to a bull exposure or a month-precision service, where the timing cannot be known.

**Five notes.** A null observation reads as an absence, not evidence. A negative check inside a bull exposure is noted. Dry-off due while the pregnancy is unconfirmed is noted. A month-precision service shows a wider window. A note says when the latest record changed which service is counted. The notes are worded from `deriveReproduction`'s answer, never from a second copy of a rule, and are computed on read.

**Tasks.** A task is computed from the derived state and is cleared only by an event. Nothing stores a task and nobody ticks one off by hand.

**New numbers.** Days count from the earliest possible conception (`T` is `day_max`). The numbers below are added once, in `reproduction.ts`.

| Number | Value | Kind |
| --- | --- | --- |
| Heat watch opens | day 18 (`BREEDING_TASK_DAYS.heatWatchFrom`) | farm-tunable default |
| Heat watch red | `T >= 24` (`GESTATION.bredThrough`) | biological constant |
| Pregnancy check opens | day 28 (`CHECK_RELIABLE_FROM.pag.positive`) | biological constant |
| Pregnancy check red | `T > 60` (`BREEDING_TASK_DAYS.checkRedAfter`) | farm-tunable default |
| Dry-off opens | day 248 (`GESTATION.expected - GESTATION.dryOffLead`) | farm-tunable default |
| Dry-off red | `T >= 264` (`GESTATION.windowOpens - GESTATION.closeUpLead`) | farm-tunable default |
| Calving watch opens | day 285 (`GESTATION.windowOpens`) | breed-specific |
| Calving watch red | `T > 318` (`BREEDING_TASK_DAYS.calvingWatchRedAfter`) | farm-tunable default (low confidence) |
| Overdue review opens | day 333 (`BREEDING_TASK_DAYS.overdueFrom`) | farm-tunable default |
| Overdue review red | `T > 346` (`BREEDING_TASK_DAYS.overdueRedAfter`) | biological constant (low confidence) |
| Heat sign counts | within 36 hours before the service (`HEAT_SIGN.hoursBefore`) | farm-tunable default |
| Heat sign fallback, either time missing | same calendar day or the day before (`HEAT_SIGN.calendarDaysBack`) | farm-tunable default |

A recheck is amber and never red.

**The Breeding page** (`/animals/breeding`, in Herd's nav only when `/today` carries `breeding`) has To do and Cases. The mockup's day-by-day progress bar on Cases is not built (it needs a day-346 axis); stage 4 did not build it either.

**Spec items.** The spec's warning for a bull exposure still open past a ceiling with no end date does not apply: stage 1 makes `exposure_days` required. "Attribution recomputed" is built, because it can be computed on read by deriving the view with and without the latest recorded event.

## Stage 4: loss entry, calving-window warnings and herd figures

**Scope.** Stage 4 adds three things: abortion entry over HTTP on the pilot, two calving-window warnings on any calving write, and eight herd figures on the Breeding page (a Herd figures tab, read for the whole herd, not only the pilot). `breedingCases` is the one place cases are built. Nothing here is stored: warnings and figures are computed on read, and events are only ever added.

**Two calving warnings, not refusals.** A calving is possible at almost any gestation length, so neither is a refusal. Each says the record and the calving do not agree, and the farm may know better (a wrong service date, a long or short pregnancy). The caller can save over either, and the override is recorded from the condition, never from the flag. They fire only with `REGISTRY_BREEDING` on, on a new calving and on a calving correction, and only when the calving closes a case that has a service (the dam's view with the calving in it, as of the calving date, is `calved`). They come back together with `near_duplicate_calving` when that fires too.

- `calving_before_window`: the calving falls before day 285 counted from the earliest possible conception, so the case says too early to be this service.
- `calving_past_extreme`: the calving falls after day 346 counted from the latest possible conception, so the case says too late to be this service.

Each fires only when the whole calving date lies outside the bound. A month- or year-precision calving is judged by its whole month or year (it is stored on the 1st, and the day was never known), and an estimated date never warns. The day count in the message is taken from the stored date.

Both are worded from `deriveReproduction`'s answer (the case the calving closes), never from a second copy of the rule. `GESTATION_DAYS = 310` in `calving.ts` is not read, changed or reused.

**Migration 13 changes the trigger only.** It adds the two names to the `override_check` list the database trigger enforces, and nothing else. It is one-way. Until it runs, the trigger still lists seven names.

**Abortion entry.** `abortion` is accepted on the pilot with an empty payload and no warning. An abortion with no pregnancy on file is accepted too, because a service may have gone unrecorded. Only the impossible is refused.

**Owner defaults for this stage.**

- A loss is never prefilled from an inferred outcome.
- "Record a loss" opens an empty abortion form.
- Overdue is a task and a count. There is no banner.

**`breedingCases`.** It derives the cases of a female by calling `deriveReproduction` at each boundary: every recorded event dated up to the read date, and the read date itself. Each case's outcome is its view at the last event where it is still the anchor. A service that a later case lists among its services joined that case and is not a case of its own. The cases are derived at each boundary because a case's outcome depends on what was known on that day, and one derivation as of today would show a later record's attribution on an earlier case. The warnings, the Cases tab and the figures all read it, so they cannot disagree.

**Case outcomes.** `lost` when that view is lost; `failed` when it is open; `held` when it is calved or has a reliable positive; otherwise `pending`. A held or pending case followed by a later case is `replaced`: a new service came with no loss recorded, and its `closed_by` is the next case's first service. A case that has calved is never `replaced`: it stays `held` and its `closed_by` is the calving. A re-service recorded before the heat on the same day sorts before the heat, so it joins the earlier service in one failed case.

**The eight figures.** `P` is the period: for `12m`, `[on - 364 days, on]` (`on` and the 364 days before it); for `all`, everything up to and including `on`. A rate is a whole percent (7 of 10 is 70), shown only when its denominator is at least `FIGURES.minCases` (10); below that the page shows the count ("4 of 7") and no percentage. The current females are every female that had not left by `on`, with or without a service, and a breeding view is not required. `replaced` cases are left out of services per conception, held to first service, confirmed by day 60 and losses, and are reported in "Why some figures are rough".

| Figure | Definition |
| --- | --- |
| Overdue now | Current females whose view as of `on` is `overdue`, with each one's `day_max`. Ignores `P`. |
| Services per conception | Over held cases with `held_on` in `P`: the sum of `services_since_calving` divided by the number of cases, to one decimal. Null when there are fewer cases than `minCases`. |
| Held to first service | Cases that start after a calving (or are her first ever) with the first service in `P`. Of those with outcome `held`, `failed` or `lost`, the share `held`. The rest are pending, and are given as a count. |
| Confirmed by day 60 | Held cases with the first reliable positive in `P`. The share with that positive on day 60 or earlier (`BREEDING_TASK_DAYS.checkRedAfter`); the later days are listed. Held cases only, so a pregnancy confirmed and then lost is not in it. |
| Days open | Held cases with `held_on` in `P` and an earlier calving: days from that calving to the case's last service. The median (lower middle when even). Approximate when a month-precision date is used. A span whose either end is known only to the year, or is estimated, is left out, and the rough lines say how many. |
| Calving interval | Consecutive effective calvings of the same current female, the later one in `P`, both day or month precision. The mean, to a whole day. Approximate when a month-precision date is used. |
| Losses | Cases that had a reliable positive or a calving with `held_on` in `P`. The share whose outcome is `lost`. A lost case with no reliable positive has no `held_on` and is not counted. |
| Heats caught | Effective `heat_observed` events in `P`, against the heats expected. Expected is each current female's eligible days in `P`, counted from her first calving or service on record (her view that day is `open`, or she calved at least `voluntaryWaitDays` before with no service since; not on a day she had left), divided by `cycleDays`, rounded down. Always marked estimated. |

**By animal and the rough lines.** Under the figures the page lists a By animal table: one row for each female with a service in `P`, with her services in `P` and her latest value in `P` of first-service outcome, confirmed day, days open and calving interval (none shown when she has none). "Why some figures are rough" lists, each only when its count is above 0: the services of pending cases that have no outcome yet (it counts services, not cases); animals with no earlier calving; days-open spans left out for a year-only or estimated date; confirmed pregnancies, and services, followed by a new service with no loss recorded (the `replaced` cases); and always "expected heats are estimated".

**New numbers.** Added once, in `reproduction.ts`. Days count from the earliest possible conception unless a row says latest.

| Number | Value | Kind |
| --- | --- | --- |
| Calving before the window | the calving is definitely before `conception_earliest` + `GESTATION.windowOpens` (285) days (`definitelyBefore`, which allows for precision) | breed-specific |
| Calving past the extreme | the calving is definitely after `conception_latest` + `BREEDING_TASK_DAYS.overdueRedAfter` (346) days (`definitelyBefore`, which allows for precision) | biological constant (low confidence) |
| `FIGURES.minCases` | 10 | farm-tunable default |
| `FIGURES.cycleDays` | 21 | biological constant (high confidence) |
| `FIGURES.voluntaryWaitDays` | 45 | farm-tunable default (low confidence) |
| `FIGURES.periodDays` | 365 | farm-tunable default |

**Not built.** The season split and target lines (no target is drawn, and none is invented). The Breeding page's day-by-day progress bar on Cases is not built. General availability, correcting a breeding event from the page, and the backfill command are stage 5.
