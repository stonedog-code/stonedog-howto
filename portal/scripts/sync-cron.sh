#!/usr/bin/env bash
# Copyright (C) 2026 StoneDogCode L.L.C.
#
# The hourly sync, as cron runs it.
#
#   crontab:  17 * * * * /path/to/this/repo/portal/scripts/sync-cron.sh
#
# Two steps, and the first is the one that is easy to leave out.
#
# ## Why this refreshes the source trees
#
# The portal reads a DEDICATED worktree per source repository, pinned at a
# commit — not somebody's working checkout, because that is whatever branch its
# owner is on and whatever they have half-saved.
#
# But a pinned worktree is pinned. Sync it hourly without refreshing and it
# serves the same commit forever, growing quietly more wrong. That is not
# hypothetical: this portal ran against a checkout nine commits stale and
# reported 101 articles as having no audience, days after the change that gave
# them one had merged. The number was honest and the source was not.
#
# ## The rule that keeps this safe, and the one it replaced
#
# A tree is refreshed ONLY when its articles.json entry opts in:
#
#   { "name": "…", "path": "…", "refresh": "origin/main" }
#
# No `refresh` key means never touch it. Explicit, per repository, and
# impossible to trigger by accident.
#
# The first version of this used a rule that sounded reasonable and was
# dangerous: refresh any tree that is DETACHED, on the theory that a detached
# tree belongs to the portal while a branch belongs to a person. That is
# backwards for the case that matters most. **A git submodule checkout is
# detached by design** — it sits at whatever commit its parent pins. So the rule
# treated the canonical submodule checkout as the portal's own and moved it nine
# commits forward, dragging the gitlink out from under anyone working in it.
# It did exactly that, once, before this was rewritten.
#
# Ownership is not something to infer. It is something to declare.
#
# Anything skipped is reported. A refresh that silently did nothing would put us
# straight back to serving stale content, which is the failure this exists to
# prevent.
set -uo pipefail

# cron's PATH is minimal and has no nvm, so node has to be found deliberately.
#
# NOT by hardcoding a version directory. That works exactly until the next nvm
# upgrade, and then this job stops running -- as a "command not found" in a log
# nobody reads, weeks before anybody notices the archive has stopped updating.
# The failure is silent, delayed, and looks nothing like its cause.
#
# So: ask nvm what its default is, fall back to whatever is on PATH, and REFUSE
# loudly if neither answers. A sync that cannot find node must say so, not exit
# quietly having done nothing.
# Appended, not assigned. Assigning discards whatever an operator deliberately
# put in the environment -- and it makes this script's own node resolution
# untestable, because a constrained PATH is thrown away before it is consulted.
export PATH="${PATH:+$PATH:}/usr/local/bin:/usr/bin:/bin"

node_bin_dir() {
  local nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$nvm_dir/nvm.sh" ]; then
    # shellcheck source=/dev/null
    . "$nvm_dir/nvm.sh" --no-use >/dev/null 2>&1
    local resolved
    if resolved="$(nvm which default 2>/dev/null)" && [ -x "$resolved" ]; then
      dirname "$resolved"
      return 0
    fi
  fi
  local found
  if found="$(command -v node 2>/dev/null)"; then
    dirname "$found"
    return 0
  fi
  return 1
}

if NODE_DIR="$(node_bin_dir)"; then
  export PATH="$NODE_DIR:$PATH"
else
  printf '%s  FATAL no node found. Install one, or set NVM_DIR.\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >&2
  exit 127
fi

# The manifest requires Node 20+. An older one fails later, in ways that read as
# application bugs rather than as the wrong interpreter.
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  printf '%s  FATAL node %s is too old; this needs 20 or newer.\n' \
    "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "${NODE_MAJOR:-unknown}" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

stamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()   { printf '%s  %s\n' "$(stamp)" "$*"; }

log "sync starting"

# ---------------------------------------------------------------------------
# 1. Refresh each source tree we own.
# ---------------------------------------------------------------------------
# `path<TAB>refresh-target`, with an empty second field when the entry does not
# opt in.
# ARTICLES_CONFIG, with the same default `sync-once.ts` uses. Two readers of
# one config file and only one of them honouring the override is a drift
# waiting to happen -- and it became load-bearing when the portal moved into
# this public repository and the config stayed behind in the private one, which
# is where the owner's article paths belong.
ARTICLES_CONFIG="${ARTICLES_CONFIG:-$REPO_ROOT/articles.json}"

if [ ! -f "$ARTICLES_CONFIG" ]; then
  # Named, not silent. A missing config and a config listing nothing both end
  # up refreshing no trees, and only one of them is a mistake.
  log "WARN no articles config at $ARTICLES_CONFIG — set ARTICLES_CONFIG or copy articles.example.json"
fi

PATHS="$(ARTICLES_CONFIG="$ARTICLES_CONFIG" node -e '
  const { readFileSync } = require("node:fs");
  const config = JSON.parse(readFileSync(process.env.ARTICLES_CONFIG, "utf8"));
  for (const repo of config.repos ?? []) {
    if (repo?.path) console.log(`${repo.path}\t${repo.refresh ?? ""}`);
  }
' 2>/dev/null)"

if [ -z "$PATHS" ]; then
  log "WARN could not read any paths from $ARTICLES_CONFIG — nothing to refresh"
fi

while IFS=$'\t' read -r articles_path refresh_target; do
  [ -n "$articles_path" ] || continue

  if [ -z "${refresh_target:-}" ]; then
    # Not ours to move. Said out loud rather than passed over, because a source
    # nobody refreshes is a source that quietly goes stale.
    log "hold $articles_path has no \"refresh\" in articles.json — left exactly as it is; its content is whatever is on disk"
    continue
  fi

  if [ ! -d "$articles_path" ]; then
    log "WARN $articles_path does not exist — the sync will report it as unreadable"
    continue
  fi

  tree="$(git -C "$articles_path" rev-parse --show-toplevel 2>/dev/null)"
  if [ -z "$tree" ]; then
    log "WARN $articles_path is not in a git tree — left as-is"
    continue
  fi

  # Belt and braces: even an opted-in tree is left alone if somebody has put it
  # on a branch, because that means a person is using it right now.
  branch="$(git -C "$tree" branch --show-current 2>/dev/null)"
  if [ -n "$branch" ]; then
    log "SKIP $tree opted in, but it is on branch '$branch' — somebody is working in it. Not refreshed."
    continue
  fi

  # And it must be a LINKED WORKTREE — one created by `git worktree add` — not a
  # primary checkout and not a submodule's own directory.
  #
  # The discriminator is the git-dir, and it has to be this one. The obvious
  # test, "a linked worktree has a .git FILE rather than a directory", is WRONG:
  # a submodule checkout has a .git file too, so that test passes the very tree
  # this is protecting. It did, and the submodule moved anyway.
  #
  #   linked worktree     …/.git/modules/apps/web/worktrees/<name>   <- has /worktrees/
  #   submodule checkout  …/.git/modules/apps/web                    <- does not
  git_dir="$(git -C "$tree" rev-parse --git-dir 2>/dev/null)"
  case "$git_dir" in
    */worktrees/*) : ;;
    *)
      log "SKIP $tree is not a dedicated worktree (git-dir: ${git_dir:-unknown}). Not refreshed."
      continue
      ;;
  esac

  if ! git -C "$tree" fetch --quiet origin 2>/dev/null; then
    log "WARN could not fetch $tree — syncing whatever it already has"
    continue
  fi

  before="$(git -C "$tree" rev-parse --short HEAD 2>/dev/null)"
  if git -C "$tree" checkout --quiet --detach "$refresh_target" 2>/dev/null; then
    after="$(git -C "$tree" rev-parse --short HEAD 2>/dev/null)"
    if [ "$before" = "$after" ]; then
      log "ok   $tree already at $after"
    else
      log "ok   $tree $before -> $after"
    fi
  else
    log "WARN could not move $tree to $refresh_target — syncing whatever it has"
  fi
done <<< "$PATHS"

# ---------------------------------------------------------------------------
# 2. Sync.
#
# `npm run sync` exits non-zero when anything was skipped, so that status is
# carried out of here rather than swallowed — a cron job that always exits 0
# reports success forever while the archive goes incomplete.
# ---------------------------------------------------------------------------
ARTICLES_CONFIG="$ARTICLES_CONFIG" npm run --silent sync
STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  log "sync finished cleanly"
else
  log "sync finished with status $STATUS — something was skipped or the config is wrong. Read the lines above."
fi

exit "$STATUS"
