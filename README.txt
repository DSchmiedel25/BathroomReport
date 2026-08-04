BathroomReport v2.48.1 — telling people what to do with no service

FILES     app.js  index.html  shell.css  sw.js  firebase.js
FIREBASE  nothing

TWO PLACES, ONE MESSAGE

1. A banner, only while it is true
   "Offline — showing what you've already loaded. Ratings and tips will
    upload when you're back."

   Amber, not red: no signal is the normal state where this app gets used, not
   a fault. Sits under the header rather than floating over the map, so it
   never covers a pin. No dismiss button — it leaves by itself when the
   connection returns.

   The useful information offline is not "you are offline" (the phone already
   said that). It is "keep going, nothing will be lost."

2. A How it works section, for BEFORE you leave
   "Going somewhere with no service?" — explains that panning around the area
   ahead of time stores the map squares and pins on the device, and that
   anything written offline uploads by itself later.

   That is the honest advice, because it is exactly how the caching works.
   There is no download button and this does not pretend there is.

ALSO IN THIS BUILD, if v2.48.0 has not shipped
  Firestore offline persistence — writes queue and replay automatically.
  Map tiles cached in their own bucket so the map draws where you have been.
