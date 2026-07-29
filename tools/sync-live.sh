#!/usr/bin/env bash
# sync-live.sh — make the working folder match what is actually deployed, before editing anything.
#
# Three times in one session a data patch was built against a file that wasn't live, because
# the nightly bake, the SEO Action, and web uploads all push to main independently. Each time it
# was caught in verification rather than prevented. This prevents it.
#
#   ./tools/sync-live.sh                      # sync everything, refuse if you have local edits
#   ./tools/sync-live.sh circle-k-locations.js  # fetch one file to /tmp and diff it
#   ./tools/sync-live.sh --force              # sync and discard local edits (asks first)
set -euo pipefail

REPO="DSchmiedel25/BathroomReport"
BRANCH="main"
RAW="https://raw.githubusercontent.com/$REPO/$BRANCH"

# ---- single-file mode: fetch and diff, change nothing ----
if [[ $# -gt 0 && "$1" != "--force" ]]; then
  f="$1"
  tmp="/tmp/live-$f"
  echo "fetching live $f ..."
  curl -fsSL "$RAW/$f" -o "$tmp" || { echo "could not fetch $f from $BRANCH"; exit 1; }
  if [[ ! -f "$f" ]]; then
    echo "no local copy of $f — live version saved to $tmp"
    exit 0
  fi
  if diff -q "$f" "$tmp" >/dev/null; then
    echo "IDENTICAL — your local $f matches live."
  else
    added=$(diff "$f" "$tmp" | grep -c '^>' || true)
    removed=$(diff "$f" "$tmp" | grep -c '^<' || true)
    echo "DIFFERS from live: $removed local lines, $added live lines"
    echo "  live copy: $tmp"
    echo "  your local file is NOT what is deployed. Sync before patching it."
  fi
  exit 0
fi

# ---- full sync ----
FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

git fetch origin "$BRANCH"

dirty=$(git status --porcelain --untracked-files=no)
if [[ -n "$dirty" ]]; then
  echo "You have uncommitted changes to tracked files:"
  echo "$dirty"
  echo
  if [[ $FORCE -eq 0 ]]; then
    echo "Refusing to sync. Commit them, stash them, or re-run with --force to discard."
    exit 1
  fi
  read -r -p "Discard the changes listed above? [y/N] " ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || { echo "aborted"; exit 1; }
fi

git reset --hard "origin/$BRANCH"
echo
echo "synced to origin/$BRANCH at $(git rev-parse --short HEAD)"
echo "  $(git log -1 --pretty=%s)"
echo
echo "untracked files were left alone:"
git status --porcelain | grep '^??' | sed 's/^?? /  /' || echo "  (none)"
