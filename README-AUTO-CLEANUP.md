# BathroomReport automatic cleanup update

Upload these files to the same GitHub repository folder:

- index.html
- app.js
- flushpanel.html
- locations.js

After deploying:

1. Open flushpanel.html and sign in.
2. Press **Repair data** once.
3. Confirm the repair.

The repair rebuilds aggregate ratings from the live `votes` collection and hides old/orphaned
`activity` entries. Future tip deletions and location resets automatically hide related activity.

Important: the app's `firebase.js`, `styles.css`, icons, manifest, and service worker remain unchanged
and should stay in the repository.
