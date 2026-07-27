#!/bin/bash
set -e
echo "── Bathroom Report: full bake (overrides + hours + amenities) ──"

# All three read steps need the service-account key. Fail fast with a clear message if it's missing.
if [ ! -f serviceAccountKey.json ]; then
  echo "🛑 serviceAccountKey.json not found here — can't read Firestore. Aborting."; exit 1
fi

# Sync with GitHub first so we never diverge
echo "Pulling latest from GitHub…"
git pull --no-rebase

# ① Overrides (admin corrections: hours / address / coords). Writes to ./baked/, then copy in.
echo ""
echo "① Overrides…"
node fetch-and-bake.js || echo "  ⚠ overrides step hit an issue — continuing with the rest."
if ls baked/*-locations.js >/dev/null 2>&1; then
  cp baked/*-locations.js .
fi

# ② Community + admin hours consensus (reads hourStatus, bakes in place).
echo ""
echo "② Community / admin hours…"
node fetch-and-bake-hours.js || echo "  ⚠ hours step hit an issue — continuing."

# ③ Community amenities (export vote tallies → bake confirmed, in place).
echo ""
echo "③ Amenities…"
node export-votes.js || echo "  ⚠ vote export hit an issue — skipping amenity bake."
if [ -f votes-summary.json ]; then
  node bake-confirmed.js votes-summary.json ./*-locations.js || echo "  ⚠ amenity bake hit an issue — continuing."
fi

# Stage ONLY location files — never functions / config / app files / secrets / intermediates.
echo ""
git add ./*-locations.js
if git diff --cached --quiet; then
  echo "No location changes to commit. Done."; exit 0
fi

# Backstop: refuse to commit if a secret or intermediate somehow got staged.
if git diff --cached --name-only | grep -qiE "serviceAccountKey|overrides\.json|votes-summary\.json|hours-status\.json"; then
  echo ""; echo "🛑 STOP: a secret/intermediate file is staged. Not committing."; exit 1
fi

git commit -m "Full bake: overrides + community/admin hours + amenities"
git push
echo ""
echo "✅ Baked, committed, pushed (overrides + hours + amenities)."
echo "   • If you changed app code, bump sw.js separately."
echo "   • Clear applied overrides by hand in Firebase Console → Firestore → overrides when confirmed live."
