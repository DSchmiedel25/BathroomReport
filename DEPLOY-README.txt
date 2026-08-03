BathroomReport v2.36.1 — safety rating

REPO ROOT   app.js  index.html  shell.css  styles.css  sw.js  firestore.rules
            tools/audit-ui.js   functions/index.js

FIREBASE — three pending rules changes:
  1. genderSplit votes        (v2.28)
  2. stripPicks account sync  (v2.34)
  3. safe votes               (this build)
  Console -> Firestore -> Rules -> paste -> Publish

FUNCTIONS — required, not optional:
  npx firebase-tools deploy --only functions
  Without it, safety votes are written but never aggregated: the average
  stays at zero while every write succeeds. Hard to spot after the fact.

WHAT CHANGED
  No separate cleanliness question. The overall bathroom rating already IS
  the cleanliness signal — its own quips say "Bring sanitizer" and
  "Certified clean" — so a second question would collect the same judgement
  twice and weaken both by splitting the votes.

  The rating block cycles between two questions now: overall, then
  "Did you feel safe?". Skip moves on. Two dots show progress.

  Safety has its own quips, deliberately plainer than the bathroom ones —
  the low end is somebody telling the next person not to stop, and
  "Thoughts and prayers" is funny about a dirty toilet and not about
  feeling unsafe.

STILL COLLECTED, NOT YET SHOWN
  bathroomRecent / safeRecent (10 most recent {value, timestamp} per
  location) are written by the function from day one. They are what will
  let a rating show its AGE — "4.2 stars, most recent 3 days ago" — which
  is the honest replacement for the cleanliness decay we dropped.
