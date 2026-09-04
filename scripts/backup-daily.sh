#!/bin/bash
#
# Daily registry backup: snapshot, then commit the text dump off-machine.
#
#   scripts/backup-daily.sh [destination-repo]
#
# Run by the launchd agent com.dairy-agent.registry-backup (see
# docs/DEVELOPMENT.md § 8), and safe to run by hand at any time.
#
# WHAT IT DOES, and why in this order:
#
#   1. `registry:backup --out=<dest>/snapshots` -- stamped .db + .sql, never
#      overwritten. These are the exact restore artifacts and they stay LOCAL;
#      a 460 kB binary committed daily would bloat the repo and give no readable
#      history.
#   2. Copies the newest dump to `<dest>/registry.sql`, OVERWRITING it, and
#      commits. Overwriting is safe precisely because git keeps every version --
#      and it is what turns the history into `git log -p registry.sql` rather
#      than a directory of files you have to diff by hand.
#   3. Pushes. A push failure does NOT fail the run: the backup already exists
#      on disk by then, and a missing network is not a reason to report that the
#      backup did not happen.
#
# The snapshot step is the one that must not fail silently, so everything up to
# and including it runs under `set -e`.

set -euo pipefail

# Derived, not hardcoded: this script lives in the repo it backs up.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-$HOME/dairy-registry-backups}"
SNAPSHOTS="$DEST/snapshots"

log() { echo "[backup-daily] $*"; }

# ---------------------------------------------------------------------------
# node, under launchd
# ---------------------------------------------------------------------------
# THE VERSION IS SELECTED EXPLICITLY, NOT INHERITED, and this is the one part of
# the script that had to be measured rather than reasoned about.
#
# launchd runs no login shell: no PATH, no nvm. The obvious fix -- source nvm.sh
# and take what you get -- picks nvm's `default` ALIAS, which on this machine is
# node 16. better-sqlite3's binding is compiled for node 22's ABI, so the first
# version of this script failed under launchd with:
#
#   Error: ... better_sqlite3.node was compiled against a different Node.js
#   version using NODE_MODULE_VERSION 127. This version requires 93.
#
# It failed SAFELY -- `set -e` aborted before the commit step, so the backup repo
# was untouched -- but it failed, silently and daily, which is the worst property
# a backup job can have. An interactive run never sees it, because a login shell
# has already put a usable node on PATH.
NODE_FLOOR=22

cd "$REPO"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  # No argument: honours $REPO/.nvmrc, which is why the cd above comes first.
  nvm use >/dev/null 2>&1 || true
fi

node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

# .nvmrc's pin may not be installed (it tracks the Angular CLI's floor, which
# this script does not need). Fall back to the highest installed version that can
# actually load the binding, rather than failing over a version nothing here uses.
if [ "$(node_major)" -lt "$NODE_FLOOR" ]; then
  best=""
  for d in "$NVM_DIR"/versions/node/v*; do
    [ -x "$d/bin/node" ] || continue
    ver="${d##*/v}"
    [ "${ver%%.*}" -ge "$NODE_FLOOR" ] 2>/dev/null || continue
    if [ -z "$best" ] || [ "$(printf '%s\n%s\n' "$ver" "$best" | sort -V | tail -1)" = "$ver" ]; then
      best="$ver"
    fi
  done
  [ -n "$best" ] && export PATH="$NVM_DIR/versions/node/v$best/bin:$PATH"
fi

if [ "$(node_major)" -lt "$NODE_FLOOR" ]; then
  log "FATAL: need node >= $NODE_FLOOR to load better-sqlite3's binding; found $(node -v 2>/dev/null || echo none)"
  exit 1
fi
log "node $(node -v) at $(command -v node)"

if [ ! -d "$DEST/.git" ]; then
  log "FATAL: $DEST is not a git repository. Create it first — see docs/DEVELOPMENT.md § 8."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. The snapshot
# ---------------------------------------------------------------------------
log "snapshotting into $SNAPSHOTS"
npm run --silent registry:backup -w server -- --out="$SNAPSHOTS"

# ---------------------------------------------------------------------------
# 2. The canonical text dump
# ---------------------------------------------------------------------------
# Newest by NAME, not by mtime: the stamp is `YYYY-MM-DDTHHMMSS`, chosen to sort
# lexicographically for exactly this. mtime would be wrong the moment a file is
# copied or restored from another machine.
newest="$(find "$SNAPSHOTS" -maxdepth 1 -name 'registry-*.sql' | sort | tail -1)"
if [ -z "$newest" ]; then
  log "FATAL: registry:backup wrote no .sql dump into $SNAPSHOTS"
  exit 1
fi
cp "$newest" "$DEST/registry.sql"
log "canonical dump <- $(basename "$newest")"

# ---------------------------------------------------------------------------
# 3. Commit and push
# ---------------------------------------------------------------------------
cd "$DEST"
git add registry.sql

if git diff --cached --quiet; then
  # Only reachable if a run produced a byte-identical dump, header included --
  # i.e. two runs in the same second. Not an error, and not worth an empty commit.
  log "no change to registry.sql; nothing to commit"
else
  # Row counts in the subject, so `git log --oneline` reads as a herd history
  # rather than a list of identical "backup" lines.
  counts="$(
    grep -E '^--   registry_' "$DEST/registry.sql" \
      | sed -E 's/^--   ([a-z_]+) +([0-9]+) row\(s\)/\1=\2/' \
      | tr '\n' ' ' | sed 's/ $//'
  )"
  git commit -q -m "backup $(date '+%Y-%m-%d %H:%M %Z')" -m "$counts"
  log "committed: $counts"
fi

# `|| true` on purpose: the backup is already on disk and in a local commit.
# An unreachable remote is a reason to warn, not to report failure.
if git remote get-url origin >/dev/null 2>&1; then
  if git push -q origin HEAD 2>/dev/null; then
    log "pushed to $(git remote get-url origin)"
  else
    log "WARNING: push failed — the backup is committed locally but NOT off-machine"
  fi
else
  log "WARNING: no 'origin' remote — the backup is local only"
fi

log "done"
