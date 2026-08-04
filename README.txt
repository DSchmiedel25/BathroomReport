BathroomReport v2.48.2 — airplane-mode fixes

FILES     app.js  index.html  shell.css  sw.js  firebase.js
FIREBASE  nothing

THE BIG ONE — the geofence blocked the offline queue
  GPS works fine with no signal; satellites do not care. What disappears is the
  network assistance that normally makes a fix nearly instant, so a cold start
  can take thirty seconds. The 10-second high-accuracy timeout therefore failed
  almost every time in a dead zone — and that failure blocked the write BEFORE
  the offline queue could ever hold it. The queue shipped in v2.48.0 was
  useless behind a gate that could not open.

  Offline now gets 30 seconds at high accuracy, then falls back to a coarse fix
  accepting a position up to 15 minutes old. verifyNearby already widens its
  radius to match the accuracy it is given, so a poor fix is handled honestly
  rather than treated as no fix at all.

  And the wait says why: "Checking you're nearby… this takes longer with no
  signal". Thirty silent seconds on 19% battery reads as a hang, and someone
  who closes the app loses the answer they were about to give.

"NO RATINGS YET" ABOVE FOUR FILLED STARS
  Your own vote comes from Firestore's cache offline; the community aggregate
  often does not. So the card claimed nobody had rated while showing your
  rating underneath. It now says "Your rating · totals unavailable offline",
  because the count being unknown is true and the count being zero is not.

STILL TO CHECK
  The offline banner did not appear in your screenshot. Either v2.48.1 was not
  live yet, or iOS reports navigator.onLine as true in airplane mode — it
  sometimes does. If it still does not show after deploying this, that is worth
  knowing, and the fix is a real reachability probe rather than the flag.
