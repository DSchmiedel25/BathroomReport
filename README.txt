BathroomReport v2.43.0 — reported vs confirmed

FILES     app.js  index.html  styles.css  sw.js     (repo root)
FIREBASE  nothing

THE PROBLEM
  An amenity answer was invisible until three people gave the same one. At a
  location with a single visitor, the first person's answer is stored, correct,
  and shown to nobody — possibly for years. That is why "single vs multiple
  stalls" looked missing: it had been answered, and the answer had nowhere to go.

THE CHANGE
  Three states now, not two:

    nothing            no votes           shows nothing
    reported           1-2 votes          outlined badge, dashed, "2 reports"
    confirmed          3+ votes           filled badge with the star, as before

  The question KEEPS being asked until three. Showing early costs no data — it
  just stops the first answer disappearing.

  The star still means confirmed. A report never borrows it, and states its
  count outright, because "one person said so" and "several agree" are
  different claims.

  A tie shows nothing: 1-1 is a disagreement, not a report.

  The answer strip at the top of the card follows the same three tiers, or the
  card would contradict itself about the same fact two rows apart.

  Section heading is now "What visitors say" rather than "Confirmed by
  visitors", since it holds both kinds.
