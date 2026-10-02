# Registry CLI

These commands operate on persistent registry data. Examples are documentation, not a disposable fixture loader. Use the memory harness for testing. Run from the repository root after `nvm use` and `build:shared`; replace all example identities/dates deliberately.

## Commands and expected behavior

```bash
# an animal that arrived from elsewhere -> BD-0001
npm run registry:add -w server -- --sex=female --name=Noor \
  --acquired-on=2019-01-01 --precision=year \
  --birth-on=2017-01-01 --birth-precision=year \
  --source-form=recall --recorded-by=adnan

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

---
## Recovery and related contracts

Refusals carry a domain error; correct inputs rather than disabling invariants. Calving correction uses the effective event ID and maintains both dam/calf history. Rebuild changes projections, not source facts. [Animal contracts](../reference/registry/animals.md) and [backup/restore](backup-restore.md) explain the boundaries.
