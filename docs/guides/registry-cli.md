# Registry CLI

These commands operate on persistent registry data. Examples are documentation, not a disposable fixture loader. Use the memory harness for testing. Run from the repository root after `nvm use` and `build:shared`; replace all example identities/dates deliberately.

## Commands and expected behavior

```bash
# an animal that arrived from elsewhere -> BD-0001
npm run registry:add -w server -- --sex=female --name=Noor \
  --acquired-on=2019-01-01 --precision=year \
  --birth-on=2017-01-01 --birth-precision=year \
  --source-form=recall --recorded-by=adnan

# (no command for a farm-born animal whose mother is not known: use the Add animal
#  form, "Born here, mother not known", or POST /animals/born-here)

# a calving: dam event + calf + birth event + parentage + lactation, one txn
npm run registry:calve -w server -- --dam=BD-0001 --on=2023-04-01 --precision=month \
  --calf-sex=female --outcome=live --source-form=recall --recorded-by=adnan

# dry_off | departure | note on an existing animal
npm run registry:event -w server -- --animal=BD-0001 --type=dry_off \
  --on=2024-01-01 --precision=month --source-form=recall --recorded-by=adnan

# re-date a calving -- writes BOTH halves (dam's calving + calf's birth)
npm run registry:correct-calving -w server -- --event=aevt_f9097976-… \
  --on=2023-05-01 --precision=month --source-form=recall --recorded-by=adnan

# projections only, recomputed from the event log
npm run registry:rebuild -w server
npm run registry:rebuild -w server -- --animal=BD-0001
npm run registry:rebuild -w server -- --as-of=2026-03-01

# invariants + precision histogram + calving intervals. Writes nothing
npm run verify:registry -w server

# verify a BACKUP instead of the live database. Read-only, never migrated
npm run verify:registry -w server -- --db=backups/dairy-2026-09-04T163125.db

# snapshot + text dump of the record tables -> server/backups/
npm run registry:backup -w server
```

`--event=` for `correct-calving` is the **currently effective** calving event id,
printed by `registry:calve` and listed by `verify:registry`.

## Calving warnings

`registry:calve` and `registry:correct-calving` refuse a calving that is unusual but possible until you save over it, each warning with its own flag: `--allow-near-duplicate` (another calving of hers within 60 days), `--allow-calving-before-window` (dated before her calving window opens, counted from the earliest possible conception of her last service) and `--allow-calving-past-extreme` (dated past the extreme after her latest possible conception, so a service is probably missing). When one write raises several, they are refused together as `breeding_warnings`, and the write goes through only when every one of them has its flag. The two window flags are switches: bare or `=true` is on, `=false` is off. `--override-reason=<text>` is kept with the override, and every warning that fired is recorded on the calving; a flag with nothing to override records nothing. The rules are in [Breeding](../reference/registry/breeding.md#calving-warnings).

```bash
npm run registry:calve -w server -- --dam=BD-0001 --on=2025-10-17 --precision=day \
  --calf-sex=female --outcome=live --source-form=recall --recorded-by=adnan \
  --allow-calving-before-window --override-reason="born early, vet confirmed"
```

`--db=` paths are resolved from **`server/`**, not the repo root — npm runs
workspace scripts with the workspace as cwd. So the path you read off a repo-root
listing needs one segment fewer. Getting it wrong is caught and named:

```
verify:registry: no such database '/…/server/server/backups/dairy-….db'.
  --db was given 'server/backups/dairy-….db', resolved against cwd /…/server.
```

On an empty registry, `verify:registry` says so rather than reporting a
misleading green:

```
0 animal(s), 0 event(s), 0 lactation(s)
NOTE: the registry is EMPTY, so every invariant passes vacuously.
```

## Breeding events

`registry:breed` writes the five breeding event types to a **female**. `--precision` is `day` or `month` (a
`pregnancy_check` is `day` only); `year` and `estimated` are refused. It refuses an unknown
animal, an animal that is not female, a precision a breeding event cannot have, and a date before she arrived or
was born or after she left; those have no override. `--supersedes=<event id>` corrects an earlier event of hers
(same animal, same type, once per event); a breeding event cannot be retracted, only replaced. It prints the event id and her state at `--as-of`.

Five warnings are refused until you save over them, each with its own flag: `--allow-ambiguous-service` (a service that joins an earlier service's case, so her calving window widens), `--allow-no-heat-sign` (a service with no heat sign recorded before it), `--allow-early-check` (a check before its method can be relied on), `--allow-check-without-service` (a check with no service on or before it) and `--allow-heat-after-positive` (a heat dated after a positive check; she still reads as Pregnant, re-check due). When one write raises several, they are refused together as `breeding_warnings`, and the write goes through only when every one of them has its flag. A flag is a switch: bare or `=true` is on, `=false` is off. `--override-reason=<text>` is kept with the override. Every warning that fired is recorded on the event; a flag with nothing to override records nothing.

```bash
# heat seen
npm run registry:breed -w server -- --animal=BD-0001 --type=heat_observed --sign=standing \
  --on=2026-01-19 --time=06:30 --precision=day --source-form=recall --recorded-by=adnan

# a service (ai | natural_observed | bull_exposure; a bull_exposure also needs --days and takes no time)
npm run registry:breed -w server -- --animal=BD-0001 --type=insemination --service=ai \
  --on=2026-01-20 --precision=day --source-form=recall --recorded-by=adnan
npm run registry:breed -w server -- --animal=BD-0001 --type=insemination --service=bull_exposure --days=30 \
  --on=2026-02-01 --precision=month --source-form=recall --recorded-by=adnan

# a pregnancy check (palpation | ultrasound | pag | progesterone; positive | negative)
npm run registry:breed -w server -- --animal=BD-0001 --type=pregnancy_check --method=ultrasound --result=positive \
  --on=2026-03-01 --precision=day --source-form=recall --recorded-by=adnan

# an abortion
npm run registry:breed -w server -- --animal=BD-0001 --type=abortion \
  --on=2026-05-01 --precision=day --source-form=recall --recorded-by=adnan

# a watch that saw nothing (heat | pregnancy_check)
npm run registry:breed -w server -- --animal=BD-0001 --type=null_observation --watched-for=heat \
  --on=2026-02-10 --precision=day --source-form=recall --recorded-by=adnan

# correct a service typed with the wrong date: a new insemination that supersedes the old event id
npm run registry:breed -w server -- --animal=BD-0001 --type=insemination --service=ai \
  --on=2026-02-20 --precision=day --source-form=recall --recorded-by=adnan --supersedes=<event id of the wrong service>
```

## Breeding backfill

`registry:breed-backfill` enters the breeding history of the animals the owner picks from one JSON file. **It opens the registry database the other `registry:*` commands open, which in normal use is the real one, `server/dairy.db`.** Try a file on a copy first.

Each case is one animal, with the `source_form` its rows were taken from (`recall`, `cycle_card`, `daily_herd_sheet`, `import` or `direct_entry`); its events are written in the order given. An event has `type`, `occurred_on`, `date_precision` and `payload` (the same fields `registry:breed` builds from its flags), and optionally `occurred_time`, `observed_by`, `allow` (the warnings to save over, by name) and `override_reason`. Unknown keys, wrong types and empty lists are refused before anything is checked.

```json
{
  "cases": [
    {
      "animal_id": "BD-0012",
      "source_form": "recall",
      "events": [
        { "type": "heat_observed", "occurred_on": "2026-01-19", "occurred_time": "06:30", "date_precision": "day", "payload": { "sign": "standing" } },
        { "type": "insemination", "occurred_on": "2026-01-20", "date_precision": "day", "payload": { "service_type": "ai" }, "observed_by": "karim" },
        { "type": "pregnancy_check", "occurred_on": "2026-03-10", "date_precision": "day", "payload": { "method": "ultrasound", "result": "positive" } }
      ]
    }
  ]
}
```

```bash
# check: prints one line per row, writes nothing
npm run registry:breed-backfill -w server -- --file=cases.json --recorded-by=adnan

# save: the whole file in one transaction, or nothing
npm run registry:breed-backfill -w server -- --file=cases.json --recorded-by=adnan --save
```

Every row goes through the same write path as `registry:breed`, with the earlier rows of its case already in place, and reports one of: `would_write`; `already_on_record` (an effective event with the same animal, type, date, precision and payload exists, so it is not written again); `refused` (a refusal with no override: its code and message); or `needs_allow` (a warning fired that the row's `allow` does not name: each warning's check and message). A warning named in `allow` is recorded on the event from the condition; a name in `allow` that does not fire records nothing. `--save` is a switch (bare or `=true` on, `=false` off). When any row is `refused` or `needs_allow`, the command exits non-zero and `--save` writes nothing at all, not even the other cases' clean rows.

---
## Recovery and related contracts

Refusals carry a domain error; correct inputs rather than disabling invariants. Calving correction uses the effective event ID and maintains both dam/calf history. Rebuild changes projections, not source facts. [Animal contracts](../reference/registry/animals.md) and [backup/restore](backup-restore.md) explain the boundaries.
