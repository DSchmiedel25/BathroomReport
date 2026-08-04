BathroomReport v2.39.0

WHERE EACH FILE GOES
  repo root/   app.js  index.html  shell.css  styles.css  sw.js
               firestore.rules  flushpanel.html
  tools/       audit-ui.js
  functions/   index.js        <- NOT the root index.html; different file

TERMINAL
  cd ~/code/BathroomReport
  # unzip somewhere, then from that folder:
  #   cp app.js index.html shell.css styles.css sw.js firestore.rules flushpanel.html ~/code/BathroomReport/
  #   cp tools/audit-ui.js ~/code/BathroomReport/tools/
  #   cp functions/index.js ~/code/BathroomReport/functions/
  node --check app.js && node tools/audit-ui.js     # must say: all UI checks passed
  git add -A
  git commit -m "v2.39.0 — onboarding rebuild, signed-out map controls, swipe rating"
  git push

FIREBASE — git does not do these
  Rules already deployed if you did it earlier; firestore.rules is unchanged since then.
  functions/index.js is unchanged since your last deploy too.
  Nothing new to deploy in this build.

WHAT CHANGED SINCE v2.36.6
  v2.37.0  safety rating added to the location card strip
  v2.38.0  swipe left/right between the two rating questions
  v2.38.1  footer counts include regions not yet downloaded (was 28,074, now 84,079)
           version number was printing twice
  v2.38.2  "Add a place" and "Filter" hidden when signed out — both were
           unusable without an account
  v2.39.0  onboarding rebuilt: 202 words -> 54, and it now asks for location
           permission instead of explaining the app. Travel mode moved to
           Settings, where it already existed.

VERIFY AFTER DEPLOY
  Footer reads v2.39.0 (force-close the PWA; the service worker caches hard)
  Signed out: no Add a place, no Filter pill on the map
  Clear site data -> reload -> onboarding asks for location
  Rate a bathroom, swipe left on the stars -> "Did you feel safe?"
