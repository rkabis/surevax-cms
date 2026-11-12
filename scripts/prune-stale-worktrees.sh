#!/usr/bin/env bash
# Teardown / cleanup for accumulated worktrees + branches.
#
# WHY: /orchestrate, the Workflow pilot, and external tools (emdash) create git
# worktrees — and /orchestrate additionally creates a branch per unit — but none
# tear them down, and squash-merge leaves the remote head branch behind. Without
# a teardown step these accrue without bound: a 2026-05-31 cleanup found
# 80 worktrees, 345 local branches, 57 remote branches — almost all stale. That
# pile also feeds the per-worktree port-collision bug in setup-worktree.sh
# (which scans every sibling .env for a claimed port).
#
# SAFE BY DEFAULT: this is a DRY RUN. Pass --apply to actually delete.
#
# Removal criteria:
#   • worktree     → removed when NO file under it was modified within --days
#                    (default 5). Catches uncommitted edits, not just commits.
#   • local branch → deleted when merged into origin/main (ancestor OR a merged
#                    PR head, if `gh` is available) OR last commit older than --days.
#   • remote branch→ deleted ONLY when it is a merged PR head. Unmerged remote
#                    branches are NEVER auto-deleted — that's the one irreversible
#                    footgun (a remote-only branch may hold the only copy).
#
# NEVER touched: `main`, the current worktree + its branch, any checked-out
# branch (git refuses those anyway), and any worktree with recent file activity.
#
# Usage:
#   scripts/prune-stale-worktrees.sh                 # dry run, 5-day cutoff
#   scripts/prune-stale-worktrees.sh --apply         # execute
#   scripts/prune-stale-worktrees.sh --days 10 --apply
#
# Run from the coordinator's worktree at the end of an /orchestrate wave or a
# /ship, or on a schedule. Idempotent.

set -uo pipefail

GIT="$(command -v git || echo /usr/bin/git)"
DAYS=5
APPLY=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) APPLY=true ;;
    --days) DAYS="$2"; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

# Cutoff date YYYY-MM-DD, DAYS ago. BSD (macOS) then GNU (CI/Linux) form.
CUT="$(date -v-"${DAYS}"d +%Y-%m-%d 2>/dev/null || date -d "-${DAYS} days" +%Y-%m-%d)"

CURRENT_WT="$("$GIT" rev-parse --show-toplevel)"
CURRENT_BRANCH="$("$GIT" -C "$CURRENT_WT" rev-parse --abbrev-ref HEAD 2>/dev/null)"

MODE="DRY RUN (pass --apply to execute)"
$APPLY && MODE="APPLY"
echo "▸ prune-stale-worktrees — $MODE — cutoff $CUT (${DAYS}d) — protecting [main] + [$CURRENT_BRANCH] + current worktree"
echo

# Merged-PR head branches (more reliable than ancestor test for squash-merge).
MERGED_FILE="$(mktemp)"
trap 'rm -f "$MERGED_FILE"' EXIT
if command -v gh >/dev/null 2>&1; then
  gh pr list --state merged --limit 2000 --json headRefName -q '.[].headRefName' 2>/dev/null | sort -u > "$MERGED_FILE" || true
fi
is_merged_pr() { [[ -s "$MERGED_FILE" ]] && grep -qxF "$1" "$MERGED_FILE"; }

wt_removed=0; lb_deleted=0; rb_deleted=0

# ── 1. Worktrees ─────────────────────────────────────────────────────────────
echo "── worktrees ──"
while IFS= read -r wt; do
  [[ -z "$wt" ]] && continue
  [[ "$wt" == "$CURRENT_WT" ]] && continue
  br="$("$GIT" -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  [[ "$br" == "main" ]] && continue
  [[ ! -d "$wt" ]] && continue
  recent="$(find "$wt" -type f -not -path '*/.git/*' -not -path '*/node_modules/*' -newermt "$CUT" -print -quit 2>/dev/null)"
  if [[ -n "$recent" ]]; then
    echo "  keep    ${wt##*/} [$br] — active since $CUT"
    continue
  fi
  if $APPLY; then
    "$GIT" worktree remove --force "$wt" 2>/dev/null && { echo "  removed ${wt##*/} [$br]"; wt_removed=$((wt_removed+1)); }
  else
    echo "  WOULD remove ${wt##*/} [$br] — stale"
  fi
done < <("$GIT" worktree list --porcelain | awk '/^worktree /{print $2}')
$APPLY && "$GIT" worktree prune

# ── 2. Local branches ────────────────────────────────────────────────────────
echo "── local branches ──"
# Branches checked out in a (kept) worktree are off-limits — git refuses to
# delete them and they back live working trees.
CHECKED_OUT="$("$GIT" worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')"
while IFS= read -r b; do
  [[ -z "$b" || "$b" == "main" || "$b" == "$CURRENT_BRANCH" ]] && continue
  printf '%s\n' "$CHECKED_OUT" | grep -qxF "$b" && continue
  cdate="$("$GIT" log -1 --format=%cs "$b" 2>/dev/null || echo 0000-00-00)"
  reason=""
  if "$GIT" merge-base --is-ancestor "$b" origin/main 2>/dev/null; then reason="merged"
  elif is_merged_pr "$b"; then reason="merged-PR"
  elif [[ "$cdate" < "$CUT" ]]; then reason="stale($cdate)"
  fi
  [[ -z "$reason" ]] && continue
  if $APPLY; then
    "$GIT" branch -D "$b" >/dev/null 2>&1 && { echo "  deleted $b ($reason)"; lb_deleted=$((lb_deleted+1)); } || echo "  skip    $b (checked out)"
  else
    echo "  WOULD delete $b ($reason)"
  fi
done < <("$GIT" for-each-ref --format='%(refname:short)' refs/heads/)

# ── 3. Remote branches (MERGED ONLY) ─────────────────────────────────────────
echo "── remote branches (merged only) ──"
while IFS= read -r b; do
  [[ -z "$b" || "$b" == "main" || "$b" == "HEAD" ]] && continue
  if "$GIT" merge-base --is-ancestor "origin/$b" origin/main 2>/dev/null || is_merged_pr "$b"; then
    if $APPLY; then
      "$GIT" push origin --delete "$b" >/dev/null 2>&1 && { echo "  deleted origin/$b"; rb_deleted=$((rb_deleted+1)); }
    else
      echo "  WOULD delete origin/$b (merged)"
    fi
  fi
done < <("$GIT" for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin/)
$APPLY && "$GIT" remote prune origin >/dev/null 2>&1

echo
if $APPLY; then
  echo "✓ removed: $wt_removed worktree(s), $lb_deleted local branch(es), $rb_deleted remote branch(es)."
  echo "  Unmerged remote branches were left untouched — review + delete those by hand."
else
  echo "Dry run only. Re-run with --apply to execute. Unmerged remote branches are never auto-deleted."
fi
