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

**One override column.** At most one stage 2 warning fires per event: a service can only trip `ambiguous_service`, and a check trips `check_without_service` (no service on file) or `early_check` (a service on file), never both. Stage 3's 36-hour heat check can fire on a service that is also ambiguous, so stage 3 must decide how to record two ([OPEN-066](../OPEN.md#open-066)).

**No correction from the page.** A wrong entry is corrected with `registry:breed --supersedes`; a Correct action on the page is not built ([OPEN-065](../OPEN.md#open-065)).

**Migration 11 is one-way.** Migration 11 widens `override_check` so it can hold the three new names. Like migration 10, it is one-way.
