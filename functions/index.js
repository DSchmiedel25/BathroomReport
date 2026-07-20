// Bathroom Report — server-side rating aggregation.
//
// Rating totals in aggregates/{locId} are derived ONLY here, from writes to the votes
// collection, so no client can forge or tamper with them. We apply an exact delta computed
// from the before/after snapshots of the changed vote — zero extra reads.
const {onDocumentWritten} = require('firebase-functions/v2/firestore');
const {initializeApp} = require('firebase-admin/app');
const {getFirestore, FieldValue} = require('firebase-admin/firestore');

initializeApp();
const db = getFirestore();

exports.recomputeBathroomAggregate = onDocumentWritten('votes/{voteId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after  = event.data.after.exists  ? event.data.after.data()  : null;

  // Only bathroom ratings 1–5 count toward the average; 0/undefined means "not rated".
  const b = (before && typeof before.bathroom === 'number' && before.bathroom > 0) ? before.bathroom : 0;
  const a = (after  && typeof after.bathroom  === 'number' && after.bathroom  > 0) ? after.bathroom  : 0;

  const sumDelta   = a - b;
  const countDelta = (a > 0 ? 1 : 0) - (b > 0 ? 1 : 0);
  // Amenity-only / tip-only edits (and re-saving the same star value) don't change the average.
  if (sumDelta === 0 && countDelta === 0) return;

  const locId = (after && after.locId) || (before && before.locId);
  if (!locId) return;

  await db.doc(`aggregates/${locId}`).set({
    bathroomSum:   FieldValue.increment(sumDelta),
    bathroomCount: FieldValue.increment(countDelta),
    lastUpdated:   Date.now(),
  }, {merge: true});
});
