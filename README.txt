BathroomReport v2.48.3 — stop trusting navigator.onLine

FILES     app.js  index.html  shell.css  sw.js  firebase.js
FIREBASE  nothing

WHY NOTHING OFFLINE WORKED
  Every offline behaviour hung off navigator.onLine, and on iOS that flag
  commonly stays TRUE in airplane mode. It reports whether a network interface
  exists, not whether anything answers. So the banner never showed, the longer
  GPS timeout never applied, and the score line never explained itself — all
  three were asking a question that was being answered wrongly.

  Connectivity is now tracked from OUTCOMES:
    · a probe request that completes  -> online
    · a probe that fails              -> offline
    · a vote write that returns "unavailable" -> offline
    · a vote write that lands                 -> online
    · a vote write REJECTED by rules          -> online (the server was reached)
    · navigator.onLine === false      -> offline (the one direction it is honest)

  The probe runs on demand — on the online event, and when the app is brought
  back to the foreground — not on a timer. Polling a server every few seconds
  to learn something the next real request will tell you is a battery cost for
  no information, and battery matters to someone stopped in a dead zone.

TESTING IT
  Airplane mode, then open the app. The amber bar should appear within a few
  seconds of the first probe. Rate something: the nearby check will say it
  takes longer with no signal, then save into the queue. Turn airplane mode
  off and the bar goes away and the rating uploads by itself.
