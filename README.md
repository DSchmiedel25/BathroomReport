# Stewart's Bathroom Report

Updated split-file version.

## Files
- `index.html` — page structure
- `styles.css` — visual styles
- `locations.js` — Stewart's location data
- `firebase.js` — Firebase initialization
- `app.js` — map, ratings, Bathroom Now, amenities, condition reports, sorting

## New Firestore data
- Existing `votes` documents gain an `amenities` object.
- `conditionReports/{locationId}_{userId}` stores temporary condition reports.

Review your Firestore rules before deployment so users can only write their own vote/condition documents.
