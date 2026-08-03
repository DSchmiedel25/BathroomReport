BathroomReport v2.28.3 — deploy bundle (2026-08-03)

Files are laid out exactly as they sit in the repo, so on the GitHub web UI
you can drag the CONTENTS of this folder into the repo root in one upload and
the workflow file lands in .github/workflows/ automatically. On the Mac:
unzip over the repo folder and commit everything.

WHAT THIS SHIPS
  app.js / index.html / sw.js      v2.28.3 — TDZ fix (All places + region
                                   loading), Bathroom Now walking mode,
                                   zoom-band fix so regions load wherever
                                   pins render
  shell.css / flushpanel.html      badge colors, pills removal, admin rename
  tools/audit-ui.js                generated-chain exemption
  .github/workflows/checks.yml     append-aware data check (clears the red X)
  public-toilets-manifest.js       deduped rebuild — 84,079 records,
  public-*-locations.js (x10)      5,783 same-restroom duplicates removed
  build-public-toilets.js          the build with spatial dedup baked in
  data-triage-report.txt           159 hand-file anomalies to review in
                                   FlushPanel (not auto-fixed on purpose)

NOT DEPLOYED BY GIT — two manual steps:
  firestore.rules      Firebase Console -> Firestore -> Rules -> paste -> Publish
  functions/index.js   from the repo folder on the Mac:
                       npx firebase-tools deploy --only functions
  Until these land, genderSplit votes are rejected. Everything else works.

AFTER PUSHING
  - The audit re-runs itself; green looks like "50 data files, 84079 records"
  - Hard-refresh the app, footer should read v2.28.3
  - Pan to Tampa at any zoom from 8 up: southatlantic loads, diamonds appear
