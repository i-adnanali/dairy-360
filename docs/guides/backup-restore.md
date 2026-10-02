# Back up, verify and restore registry data

Use this runbook for persistent records. It does not assert that a scheduler, remote backup or live database has been checked. Commands run from the repository root. Keep real data outside the public repository.

## Preconditions

Use the pinned Node version and built shared workspace. Know which database and backup you intend to handle. Backups include registry source tables, Feed/Health revisions and request records, and attachment bytes. Animal projections can be rebuilt; source facts cannot.

Do not copy only a running WAL-mode `dairy.db`: committed data may be in its sidecar. The backup command uses SQLite snapshotting and integrity checks. [backup.ts](../../server/src/registry/backup.ts) derives source-table enumeration from the schema rather than a hand-maintained documentation count.

## Create and verify a backup

```bash
npm run registry:backup -w server
# Optional explicit destination, resolved by the workspace command:
npm run registry:backup -w server -- --out=/absolute/private/backup-directory
```

Expected output: a timestamped `.db` snapshot and deterministic registry `.sql` dump under `server/backups/` by default. `--no-dump` requests only the snapshot. Existing target names are not silently overwritten.

Verify the selected snapshot before relying on it:

```bash
npm run verify:registry -w server -- --db=backups/dairy-REPLACE-WITH-STAMP.db
```

`--db` is relative to `server/`, opens read-only and does not migrate the snapshot. Review schema-version notes and semantic invariant output; an empty snapshot's vacuous checks do not prove real records were backed up.

## Restore a binary snapshot

1. Verify the chosen snapshot and stop all writers/server processes.
2. Preserve the existing database and any sidecars together in a separate private recovery directory; do not mix old WAL/SHM files with the replacement.
3. Copy the verified snapshot to `server/dairy.db`.
4. Rebuild projections and verify:

```bash
npm run registry:rebuild -w server
npm run verify:registry -w server
```

Review records and coverage before reopening writers. If verification fails, keep both the restored candidate and original recovery files; diagnose against copies rather than overwriting the only surviving source.

## Restore a logical dump

Import the data-only SQL into a disposable database with the appropriate migrated schema and no existing registry data. The dump does not create schema. Then rebuild projections and run verification before replacing any operational database. An import into populated source tables can conflict or mix histories; it is not the restore procedure.

The [original restore record](../records/DEVELOPMENT.md#restoring) contains the prior worked commands and dated round-trip evidence. Schema and table coverage evolve; use current backup/verification code when preparing a restore.

## Scheduling and off-machine protection

[scripts/backup-daily.sh](../../scripts/backup-daily.sh) maintains versioned logical dumps in a separate private Git repository and local snapshots. It selects Node explicitly for noninteractive execution. Review its configured source/destination before use; the historical macOS launchd setup is documented in [the setup record](../records/DEVELOPMENT.md#versioned-history--recorded-local-setup-off-machine-deferred).

A local backup and a local Git repository share the machine's failure risk. Off-machine protection remains open until configured and verified. Do not infer a running schedule or successful remote copy from a plist/script being present. Inspect job results, timestamps and restores independently.

## Failure handling

A failed pre-migration backup normally prevents migration; do not bypass it as routine troubleshooting. Diagnose permissions, space and runtime first. Keep snapshots/dumps, credentials, camera captures and real-data screenshots out of version control. [Open work](../OPEN.md) tracks the accepted remaining backup gap.
