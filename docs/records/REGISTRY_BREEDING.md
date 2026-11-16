# Registry breeding, stage 1

> Decision record, 13 November 2026. Stage 1 of five. Written with the change that made
> the five breeding event types live; later stages add to it.

## What stage 1 is

Stage 1 lets the registry record breeding events and read back, for each animal, where she
is in her cycle: when she was served, whether a check has confirmed her, and the window in
which she should calve. It is read-only derivation over events that are only ever added.
It leaves out warnings and overrides, tasks, KPIs, entry forms and the Breeding page. The
server flag `REGISTRY_BREEDING=1` switches it on; with the flag off, nothing the farm sees
changes.

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

## Left alone on purpose

`GESTATION_DAYS = 310` in `calving.ts` is not revisited. It is a floor for how soon after
her own birth a calving may be recorded, not a gestation length, and stage 1 does not use
it. `null_observation` is given the narrow breeding payload (`watched_for`) here, although
[REGISTRY.md](REGISTRY.md) Decision 8 imagined it arriving with sheet transcription.
