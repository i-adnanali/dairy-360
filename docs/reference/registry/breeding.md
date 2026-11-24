# Breeding

Current contract for the five breeding event types and the reproductive state derived from them. The decisions behind it are in [REGISTRY_BREEDING.md](../../records/REGISTRY_BREEDING.md). Events are written with the [registry CLI](../../guides/registry-cli.md#breeding-events). [Animals](animals.md) owns the rest of the event log.

Breeding events are only ever added. The state is calculated on every read from an animal's effective events and is never stored; it is separate from the animal's status, which this feature does not change.

## Event payloads

All five are written to a female. Provenance, ordering and supersession work as for every other animal event.

| Event type | Payload |
|---|---|
| `heat_observed` | `sign`: `standing`, `mucus`, `restless` or `other` |
| `insemination` | `service_type`: `ai`, `natural_observed` or `bull_exposure`; `exposure_days`: whole days 1 to 365, required for `bull_exposure`, null otherwise |
| `pregnancy_check` | `method`: `palpation`, `ultrasound`, `pag` or `progesterone`; `result`: `positive` or `negative` |
| `abortion` | empty; who saw it is the provenance `observed_by` |
| `null_observation` | `watched_for`: `heat` or `pregnancy_check` |

Dates take `day` or `month` precision. A `pregnancy_check` takes `day` only.

## Refusals

The write path refuses four things about the event as written, and offers no override:

| Code | Meaning |
|---|---|
| `unknown_animal` | no such animal |
| `not_female` | the animal is not female |
| `breeding_precision` | a precision a breeding event cannot have (`year` or `estimated`; `month` for a check; a time of day on a `bull_exposure`) |
| `event_before_origin` / `animal_departed` | dated before she arrived or was born, or after she left |

A correction (an event with `supersedes_id`) is checked against those four first, as written, and then refused for three more reasons. All three are on field `supersedes_id`:

| Code | Meaning |
|---|---|
| `unknown_event` | no event has that id, or the event is on a different animal (the message says which) |
| `supersede_type_mismatch` | the event is of a different breeding type; a correction keeps the type |
| `already_superseded` | the event has already been replaced; the message names the replacing event, which is the one to correct instead |

## Constants

All days are counted from the earliest possible conception.

| Constant | Value |
|---|---|
| Gestation window opens | day 285 |
| Gestation window closes | day 325 |
| Expected calving | day 308 |
| Close-up lead | 21 days, so close-up starts day 264 |
| Dry-off lead | 60 days, so dry-off starts day 248 |
| "Bred" lasts through | day 24 |

The earliest day a check's result counts:

| Check | Positive counts from | Negative counts from |
|---|---|---|
| Palpation | day 46 | day 46 |
| Ultrasound | day 30 | day 30 |
| PAG | day 28 | day 28 |
| Progesterone | never | day 20 |

`GESTATION_DAYS = 310` in `calving.ts` is a different thing (a floor on how soon after her own birth a calving may be recorded) and is not used here.

## Which events count, and the case

Events are taken in canonical order with superseded ones dropped, then any event dated after `as_of` is dropped. With no insemination left there is no view (`null`).

The anchor is the last insemination. An earlier insemination joins the case when no calving, abortion, heat observation or negative check lies between it and the service after it; the walk stops at the first one that does not join. `services_in_case` counts them and `ambiguous_attribution` is true when there is more than one.

For one service the earliest conception is its date. The latest is the last day of its month for `month` precision, otherwise its date, plus `exposure_days` for a `bull_exposure`. Across the case, `conception_earliest` is the smallest earliest and `conception_latest` the largest latest. Let W be the days between them and T the days from `conception_earliest` to `as_of`.

## State rules

The first row that matches wins. Rows 1 to 13 are the thirteen rules; eleven states result.

| # | When | State | Basis |
|---|---|---|---|
| 1 | a calving follows the first service of the case | `calved` | observed |
| 2 | an abortion follows it | `lost` | observed |
| 3 | a reliable negative follows a positive | `lost` | inferred |
| 4 | a positive is held and it is progesterone, or earlier than its method's positive day, or a heat is dated after it | `recheck` | inferred |
| 5 | a positive is held and T > W + 325 | `overdue` | inferred |
| 6 | a positive is held and T >= 285 | `window` | inferred |
| 7 | a positive is held and T >= 264 | `close` | inferred |
| 8 | a positive is held, she is in milk, and T >= 248 | `dryoff` | inferred |
| 9 | a positive is held | `confirmed` | observed |
| 10 | a reliable negative and no positive | `open` | observed; inferred when the anchor is a `bull_exposure` and the check's day is <= W |
| 11 | a heat was observed, unless the anchor is a `bull_exposure` and the heat's day is <= W | `open` | inferred |
| 12 | T <= W + 24 | `bred` | observed |
| 13 | otherwise | `unconfirmed` | inferred |

A later positive clears an earlier loss or open finding; a reliable negative after a held positive moves her to `lost`; a negative earlier than its method's negative day is ignored. "In milk" means one of her lactations has no end.

The `window` is null for `calved`, `lost` and `open`; otherwise `opens_on` is `conception_earliest` + 285 and `closes_on` is `conception_latest` + 325. `day_max` is T and `day_min` is the days from `conception_latest` to `as_of`, not below 0. `latest_check` reports the last check with its day and whether it was `reliable`.

## The API

Breeding has no switch: since stage 5 it is on for the whole herd. `GET /animals/:id` always returns `reproduction`: a view, or `null` for a male, an animal that had left by `as_of`, or an animal with no service by then. The write routes that echo an animal back follow the same rule, so a response does not change shape between a read and a write.

`?as_of=YYYY-MM-DD` asks for the state on that day (default: today on the farm). Events dated later are invisible, including a later dry-off (whether she is in milk is read on `as_of`) and a later departure. A value that is not a real calendar date is a 400 `invalid_payload` on field `as_of`.

## The tasks: `GET /breeding/board` and `breeding_tasks`

Tasks are computed on every read from the same `reproduction` view and the same in-milk flag (`breedingForAnimal` in `breeding-board.ts`, which the detail and the board share); nothing is stored. `GET /breeding/board?on=YYYY-MM-DD` (default today on the farm; a bad date is a 400 `invalid_payload` on `on`) answers `{ on, tasks, overdue, due, cases }`. `tasks` holds every animal's tasks, each with `animal_name`, overdue first, then due, each group by `red_on` (none last) then `animal_id`. `cases` has one row per current female with a view: `{ animal_id, animal_name, view, notes, tasks, entry_open }`. `GET /today` always carries the same object as `breeding`. `GET /animals/:id` always carries `breeding_tasks`.

## The herd figures: `GET /breeding/figures`

`GET /breeding/figures?period=12m|all&on=YYYY-MM-DD` answers the eight herd figures, computed on every read by `breedingFigures` in `breeding-figures.ts`; nothing is stored. `period` is `12m` (default) or `all`, anything else a 400 `invalid_payload` on `period`; `on` defaults to today on the farm, and a bad date is a 400 `invalid_payload`. `P` is `on` and the 364 days before it for `12m` (`FIGURES.periodDays`), and every day up to `on` for `all`; `from` is the first day of `P`, null for `all`.

The current females are every female that had not left by `on`, served or not; the cases are `breedingCases` over those with a view on `on`, so the figures cannot disagree with the badge. A case `replaced` by a new service with no loss recorded is in none of the figures and has its own rough line. A `Count` is `{ n, of, rate }`; `rate` is a whole percent, present only when `of >= FIGURES.minCases` (10), else null. A `Spread` is `{ value, n, min, max, approximate }`, where `approximate` counts the spans built on a month-precision date.

| Key | Definition |
|---|---|
| `animals` | Current females with a service in `P`. |
| `overdue_now` | Current females whose view on `on` is `overdue`, with `day_max`. Ignores `P`. |
| `services_per_conception` | Held cases with `held_on` in `P`: `services` is the sum of `services_since_calving`, `conceptions` their number; `value` to one decimal, null below `minCases` conceptions. |
| `held_to_first_service` | Cases with `starts_after_calving` and the first service in `P`: `of` those held, failed or lost, `n` the held; `pending` the rest. |
| `confirmed_by_day_60` | Held cases with the first reliable positive in `P`: `n` those on day 60 or earlier (`BREEDING_TASK_DAYS.checkRedAfter`); `later_days` the other days, ascending. |
| `days_open` | Held cases with `held_on` in `P` and an earlier calving: days from that calving to the case's last service. A span with either date at year or estimated precision is left out (measured dates are never pooled with estimated ones). `value` is the median (lower middle when even). |
| `calving_interval` | Consecutive effective calvings of a current female, the later one in `P`, both day or month precision. `value` is the mean, to a whole day. |
| `losses` | Cases with `held_on` (a reliable positive or a calving) in `P`: `n` those lost. |
| `heats_caught` | `recorded`: effective `heat_observed` events in `P`. `expected`: each current female's eligible days in `P` (her view that day is `open`, or she calved at least `FIGURES.voluntaryWaitDays` days before and has no service since; not on a day she had left), summed, divided by `FIGURES.cycleDays` and rounded down. `estimated` is always true. |
| `by_animal` | One row per female counted in `animals`, by `animal_id`: her services in `P`, and her latest in `P` of: first-service outcome, confirmed day, days open, calving interval (null when none). |
| `rough` | "{k} services have no outcome yet" (the services of pending cases with the last service in `P`); "{k} animals have no earlier calving" (held cases in `P` left out of days open); "{k} days-open spans left out because a date is known only to the year or estimated"; "{k} confirmed pregnancies followed by a new service with no loss recorded" and "{k} services followed by a new service with no outcome recorded" (replaced cases with and without a reliable positive, replaced in `P`); always "expected heats are estimated". Singular when k is 1; a line with k = 0 is left out. |

## `POST /breeding/events`

It writes one service, heat, pregnancy check, "nothing seen" or loss through `recordBreedingEvent`, goes through the same `Idempotency-Key` handling as every write route, and answers `201 { event_id, animal }`, where `animal` is the animal's detail with `reproduction`, `reproduction_notes`, `breeding_tasks` and `breeding_entry`.

Body: `animal_id`, `type` (`insemination`, `pregnancy_check`, `heat_observed` with payload `{ sign }`, `null_observation` with payload `{ watched_for }`, or `abortion` with payload `{}`; `occurred_time` is optional), `occurred_on`, `occurred_time`, `date_precision` (required, never defaulted), `payload` (an object, passed as is), `supersedes_id` (a correction), the five flags `allow_ambiguous_service`, `allow_early_check`, `allow_check_without_service`, `allow_no_heat_sign` and `allow_heat_after_positive` (each counts only when it is exactly `true`), `override_reason`, and the provenance fields (`source_form`, `source_ref`, `observed_by`, `recorded_by`).

### Who can be entered for

Every female. A male is refused `not_female`, an event dated after she left is refused `animal_departed`, and an id that is not in the registry is refused `unknown_animal`, by `recordBreedingEvent` as in stage 1; there is no list of animals and no environment variable. `GET /animals/:id` always carries `breeding_entry`, true exactly for a current (not departed) female, so the page knows whether to offer the form; each board case carries the same value as `entry_open`.

One refusal comes before the domain function, `breeding_entry_closed`, a 400:

| Field | Message |
|---|---|
| `type` | `<type> is not entered on the page yet; a service, a heat, a pregnancy check, "nothing seen" or a loss is` |

An `abortion` raises no warning, with or without a pregnancy on file. On the page it is dated to the day or the month, with no time. The animal page's Breeding tab offers "Record a loss" when entry is open for her and her state is `lost` with basis `inferred`; it opens the form on a loss with nothing prefilled.

## Warnings

Beyond the refusals, unusual-but-possible cases come back as a 400 whose `error` is the warning's name and whose `field` is `occurred_on`. When more than one fires, `error` is `breeding_warnings` and the message joins theirs. Either way the body carries `warnings`, a list of `{ check, message }`, one per warning that fired. The message is worded from what `deriveReproduction` says, never from a second copy of the rules. Send the matching flag as `true` to save over it.

| Warning | On | Flag | When |
|---|---|---|---|
| `ambiguous_service` | `insemination` | `allow_ambiguous_service` | earlier services in this case are not ruled out by a heat, a negative check, a calving or a loss |
| `early_check` | `pregnancy_check` | `allow_early_check` | the check is earlier than its method is relied on (`CHECK_RELIABLE_FROM`); the message names the day |
| `check_without_service` | `pregnancy_check` | `allow_check_without_service` | no service is recorded on or before the check |
| `no_heat_sign` | `insemination` | `allow_no_heat_sign` | no heat sign is recorded close enough before the service |
| `heat_after_positive` | `heat_observed` | `allow_heat_after_positive` | the heat is dated after her latest positive check |

One save can step past more than one warning, so the event's `override_checks` column (a list of names, since migration 12) records every one of them, and `override_reason` is one line for the whole save-over. An override is recorded from the condition, never from the flag: a write that sends `allow_*: true` when the warning did not fire records no override.

### Calving warnings

A calving (`POST /calvings`) and a calving correction (`POST /calvings/:eventId/correction`) are also measured against the breeding case the calving closes. The dam's view is derived with the calving in it, as of the calving date; when that view is `calved`, two warnings can fire:

| Warning | Flag | When |
|---|---|---|
| `calving_before_window` | `allow_calving_before_window` | the calving is fewer than `GESTATION.windowOpens` (285) days after the earliest possible conception |
| `calving_past_extreme` | `allow_calving_past_extreme` | the calving is more than `BREEDING_TASK_DAYS.overdueRedAfter` (346) days after the latest possible conception |

Each fires only when the whole calving date lies outside the bound: a month- or year-precision calving is compared by its month or year, and an `estimated` one never fires. A dam with no service on or before the calving has no view, so neither fires. They come back with `near_duplicate_calving` when that fires too, in the order `near_duplicate_calving`, `calving_before_window`, `calving_past_extreme`, as the breeding warnings do: one is a 400 of its own code with `field` `occurred_on` and `warnings`; two or more are `breeding_warnings` with the messages joined. The calving is written only when every fired warning's flag is `true`, and its `override_checks` lists every fired warning. The hard calving refusals still come first. A correction saved over a near-duplicate records `near_duplicate_calving` in its `override_checks`, as a new calving does. The CLI (`registry:calve`, `registry:correct-calving`) calls the same functions, so it runs the same warnings, and saves over them with `--allow-near-duplicate`, `--allow-calving-before-window` and `--allow-calving-past-extreme`, with `--override-reason`; see [Registry CLI](../../guides/registry-cli.md#calving-warnings).

## Correcting a breeding event

A wrongly entered service, check or heat is corrected by writing a superseding event: `recordBreedingEvent` takes `supersedes_id`, and `registry:breed` takes `--supersedes=<event id>`. The original row stays in the table untouched; the new row carries `supersedes_id`, and `effectiveEvents()` drops the original, so the state follows the correction.

- **Same animal, same type.** A service is corrected by a service, a check by a check. The corrected event is written as any other, so the four refusals above still apply to it.
- **Once per event.** An event can be superseded only once. To correct a correction, supersede the replacement, not the original.
- **No retraction.** There is still no way to say "this never happened": a correction must be an event of the same type on the same animal. That remaining gap is [OPEN-064](../../OPEN.md#open-064).

## Migration 10 is one-way

Migration 10 widens the event table so it can hold the five breeding types. It is one-way: it runs the first time a build that has it opens the database (a server start or any `registry:*` command), and a build from before it refuses to open the migrated database. Rolling back means restoring a backup taken before it ran, such as the pre-migration snapshot written to `server/backups/`; see [Back up, verify and restore registry data](../../guides/backup-restore.md).

## Not built yet

Correcting a breeding event from the page, and the backfill command (stage 5, [OPEN-062](../../OPEN.md#open-062)). The Breeding page's day-by-day progress bar is not built.
