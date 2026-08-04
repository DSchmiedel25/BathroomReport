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

/* Firestore treats '/' as a path separator, so aggregates/node/123 is a three-segment path and
 * db.doc() throws. 6,595 location ids were OSM-derived and contained a slash, so this trigger
 * failed server-side for a quarter of the map — the same defect the client had. The data files
 * now carry the safe form, but locId is read out of a vote DOCUMENT here, and vote docs written
 * before the rename still hold the raw value, so normalise on read. Matches fsId() in app.js
 * and flushpanel.html. */
function fsId(id) {
  return String(id == null ? '' : id).replace(/\//g, '__');
}

/* Amenity and store-feature answer tallies.
 *
 * The client has always read aggregates/{locId}.amen and the comment here claimed this function
 * maintained it — it did not. It returned early on any amenity-only change, so `amen` was never
 * written by anything and amenityCache was permanently all-zeros. Every live community
 * confirmation was inert: the accessibility badge, restroom-setup answers, and the hasRestroom
 * hide. The only working path was the nightly export-votes -> bake-confirmed bake, and that was
 * crashing until 2026-07-30. So this feature had never reached a user by either route.
 *
 * Keys are not enumerated here on purpose: whatever keys appear in a vote's amenities /
 * storeFeatures maps get tallied, so adding an amenity in app.js needs no function redeploy.
 * Values are compared as strings; see COUNTED_ANSWERS below for the ones that move a counter. */
/* The amenity and store-feature keys this function will tally, kept DISJOINT.
 *
 * They used to be one flat set checked against both maps, so a vote carrying accessible:'yes' in
 * BOTH amenities and storeFeatures contributed two confirmations from one person. The app writes
 * bathroom answers to `amenities` and store answers to `storeFeatures`, and nothing legitimate
 * puts a key in both — so the split is the contract, not a convenience.
 *
 * Mirrors BATHROOM_AMENITIES and STORE_FEATURES in app.js. tools/audit-ui.js check 15 fails the
 * build if these drift from the rules or the client. */
const AMENITY_KEYS_BY_FIELD = {
  amenities:     new Set(['restroomType', 'genderSplit', 'accessible', 'changing', 'hasRestroom']),
  storeFeatures: new Set(['evCharging', 'airPump', 'shower', 'indoorSeating', 'wifi', 'grabAndGo', 'hotFood']),
};
const AMENITY_KEYS = new Set([
  ...AMENITY_KEYS_BY_FIELD.amenities,
  ...AMENITY_KEYS_BY_FIELD.storeFeatures,
]);

/* Answer values that move a counter.
 *
 * This used to be a literal `sv !== 'yes' && sv !== 'no'` test, which silently discarded every
 * restroomType answer — that amenity is multi-state ('single' / 'multiple'), not boolean. The key
 * was allowlisted above and the votes were being written and stored correctly, but nothing ever
 * reached aggregates/{locId}.amen, so the client's tally stayed {yes:0,no:0} forever. Downstream
 * that meant the setup answer could never confirm, never render a badge, and never retire from
 * the question rotation, so it was re-asked to everyone on every visit indefinitely.
 *
 * Multi-state counts live on the SAME cell as yes/no ({yes,no,single,multiple}), so readers that
 * only know about yes/no are unaffected. This list is bounded on purpose: `cell[sv]` is a
 * client-influenced key, and an open-ended set would let a vote grow the aggregate document.
 * It must stay in sync with the value allowlist in firestore.rules and the `states` arrays in
 * app.js. 'unknown' and '' are excluded — they are not answers (the app deliberately does not
 * persist "Not sure"; it only bumps that person's local not-sure counter). */
const COUNTED_ANSWERS = new Set(['yes', 'no', 'single', 'multiple']);

/* Reduce every vote for one location into the exact aggregate.
 *
 * NOT a delta. Deltas cannot survive Cloud Functions delivery semantics: an event may arrive
 * more than once, and two rapid edits may arrive out of order. A delta scheme double-counts on
 * the first and produces a lasting wrong total on the second — and clamping at zero, which the
 * previous version did, hides the negative while leaving the count wrong.
 *
 * Recomputing from the votes themselves is idempotent by construction: running it once, twice,
 * or out of order gives the same answer, because the answer is a function of stored state rather
 * than of the event that woke us up. It costs one query per vote write, which at this app's
 * volume is the right trade for a total that cannot drift. */
/* The three rating dimensions. `bathroom` is the original overall score and keeps its field
 * names exactly — every existing aggregate, every baked file and the whole client read
 * bathroomSum/bathroomCount, and renaming it would orphan all of it.
 *
 * safe is new. Both dimensions carry a recent-observation window as well as a running total,
 * because a sum cannot be un-summed and an average with no age attached is the specific way a
 * rating lies: "4.2 stars" reads as current whether the last vote was Tuesday or two years ago.
 * The window is what lets the client say WHEN. */
const RATING_TYPES = ['bathroom', 'safe'];
/* Bounded on purpose. Ten entries is enough for any recency weighting to be stable, and it caps
 * the document: without a limit a busy location would grow an unbounded array inside an
 * aggregate every client reads on every popup. */
const RECENT_MAX = 10;

function reduceVotes(docs) {
  const out = { bathroomSum: 0, bathroomCount: 0, amen: {}, lastRatedAt: 0, lastRatedBy: null };
  for (const t of RATING_TYPES) {
    if (t !== 'bathroom') { out[t + 'Sum'] = 0; out[t + 'Count'] = 0; }
    out[t + 'Recent'] = [];     // {v, t} pairs, newest last, trimmed below
  }
  for (const v of docs) {
    if (!v) continue;
    const votedAt = typeof v.ratedAt === 'number' ? v.ratedAt
                  : (typeof v.lastUpdated === 'number' ? v.lastUpdated : 0);
    /* safe uses the same shape and the same validation as the overall score — an integer 1..5 —
     * so one loop covers both and a future dimension is one array entry. */
    for (const t of RATING_TYPES) {
      const val = v[t];
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 5) continue;
      out[t + 'Sum'] += val;
      out[t + 'Count'] += 1;
      if (votedAt) out[t + 'Recent'].push({ v: val, t: votedAt });
    }
    if (typeof v.bathroom === 'number' && v.bathroom > 0 && Number.isInteger(v.bathroom) && v.bathroom <= 5) {
      const t = votedAt;
      if (t > out.lastRatedAt) {
        out.lastRatedAt = t;
        out.lastRatedBy = (typeof v.username === 'string' && v.username) ? v.username.slice(0, 40) : null;
      }
    }
    // Each key is read from ITS OWN field only, so one vote can never contribute twice.
    for (const field of ['amenities', 'storeFeatures']) {
      const m = v[field];
      if (!m || typeof m !== 'object') continue;
      for (const [key, val] of Object.entries(m)) {
        if (!AMENITY_KEYS_BY_FIELD[field].has(key)) continue;
        const sv = String(val);
        if (!COUNTED_ANSWERS.has(sv)) continue;
        const cell = (out.amen[key] = out.amen[key] || { yes: 0, no: 0 });
        cell[sv] = (cell[sv] || 0) + 1;
      }
    }
  }
  /* Newest first, capped. Sorting here rather than trusting document order: reduceVotes reads
   * an unordered query, so "recent" would otherwise mean "whatever Firestore returned first". */
  for (const t of RATING_TYPES) {
    out[t + 'Recent'].sort((a, b) => b.t - a.t);
    out[t + 'Recent'] = out[t + 'Recent'].slice(0, RECENT_MAX);
  }
  return out;
}

exports.recomputeBathroomAggregate = onDocumentWritten('votes/{voteId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after  = event.data.after.exists  ? event.data.after.data()  : null;
  const locId  = (after && after.locId) || (before && before.locId);
  if (!locId) return;

  const ref = db.doc(`aggregates/${fsId(locId)}`);

  /* One transaction that READS every vote for this location and writes the exact totals.
   *
   * The previous version computed a delta from this single event and incremented. That is atomic
   * but neither idempotent nor order-safe, and Firestore guarantees neither exactly-once nor
   * ordered delivery. A retried event double-counted a rating; two fast amenity edits delivered
   * out of order left a permanently wrong tally that the zero-clamp made look plausible.
   *
   * Reading the votes makes the aggregate a pure function of stored state, so any number of
   * deliveries in any order converge on the same answer. It also removes the need for the clamp:
   * a computed count cannot go negative. */
  await db.runTransaction(async (tx) => {
    const votesSnap = await tx.get(db.collection('votes').where('locId', '==', locId));
    const totals = reduceVotes(votesSnap.docs.map((d) => d.data()));
    const curSnap = await tx.get(ref);
    const cur = curSnap.exists ? (curSnap.data() || {}) : {};

    const patch = {
      schemaVersion:  2,
      bathroomSum:    totals.bathroomSum,
      bathroomCount:  totals.bathroomCount,
      amen:           totals.amen,
    };
    /* The two new dimensions and all three recency windows. Written unconditionally, including
     * as empty, so a location whose last safety rating is deleted has the field zeroed rather
     * than keeping a stale total — the same reason lastRatedAt is deleted rather than omitted
     * a few lines down. */
    for (const t of RATING_TYPES) {
      if (t !== 'bathroom') {
        patch[t + 'Sum'] = totals[t + 'Sum'];
        patch[t + 'Count'] = totals[t + 'Count'];
      }
      patch[t + 'Recent'] = totals[t + 'Recent'];
    }

    /* lastRatedAt/By come from the votes too, so they no longer depend on which event fired.
     *
     * These MUST be deleted rather than merely omitted. The write below merges, and a merge
     * leaves an omitted field exactly as it was — so when a location's last rating was deleted
     * the count correctly fell to zero while the name and timestamp of the deleted rating stayed
     * on the document. bathroomCount === 0 hid it in the popup, but FlushPanel and anything else
     * reading the aggregate still saw a rater who no longer exists. */
    patch.lastRatedAt = totals.lastRatedAt || FieldValue.delete();
    patch.lastRatedBy = totals.lastRatedBy || FieldValue.delete();

    /* lastUpdated used to be set on every execution, which made it "when this function last ran"
     * rather than "when this aggregate last changed" — and since delivery is at-least-once, a
     * duplicate event moved it while nothing about the totals differed. Compare against what is
     * already stored and leave the timestamp alone when the recomputation agrees with it. */
    const changed = cur.bathroomSum !== totals.bathroomSum
      || cur.bathroomCount !== totals.bathroomCount
      /* The new dimension must be part of this or lastUpdated stops moving when only a safety
       * rating changes — and anything downstream keyed on it would go stale silently. */
      || RATING_TYPES.some(t => (t !== 'bathroom' && (cur[t + 'Sum'] !== totals[t + 'Sum'] || cur[t + 'Count'] !== totals[t + 'Count']))
           || JSON.stringify(cur[t + 'Recent'] || []) !== JSON.stringify(totals[t + 'Recent'] || []))
      || (cur.lastRatedAt || 0) !== (totals.lastRatedAt || 0)
      || (cur.lastRatedBy || null) !== (totals.lastRatedBy || null)
      || JSON.stringify(cur.amen || {}) !== JSON.stringify(totals.amen || {});
    if (changed || !curSnap.exists) patch.lastUpdated = Date.now();

    /* The whole document is written, NOT merged.
     *
     * The previous line claimed amen was "written whole" while calling set with { merge: true },
     * and a merge walks INTO nested maps: amen.restroomType survived every recomputation that no
     * longer contained it. Withdraw the only vote for a layout and the badge kept showing
     * "Multi-stall restroom · 1 report" forever, sourced from a vote that no longer existed.
     * The same applies one level deeper — a state count falling from 2 to 0 was merged as "leave
     * it at 2".
     *
     * So the next document is composed explicitly: everything currently on it, then the fields
     * this function owns, with amen replaced outright. Fields written by anything else are
     * preserved by the spread rather than by merge semantics, which is the same guarantee stated
     * out loud instead of assumed. */
    const next = { ...cur, ...patch, amen: totals.amen || {} };
    /* FieldValue.delete() is meaningless in a full set — the field simply must not be present. */
    Object.keys(next).forEach(k => {
      if (next[k] && typeof next[k] === 'object' && next[k]._methodName === 'delete') delete next[k];
    });
    tx.set(ref, next);
  });

  /* When a vote is DELETED, remove the activity entries it backed.
   *
   * The recap used to verify each activity entry by reading the vote behind it, which meant the
   * client had to be able to read OTHER people's votes — and a vote document carries the raw uid,
   * the location and the timestamp, so a public `votes` collection let anyone reconstruct where a
   * named person had been. Closing that read is only safe if something else keeps the activity
   * log honest, so the cleanup moves here where it belongs: the server owns derived state.
   *
   * Best-effort and deliberately non-fatal. A stale activity entry is cosmetic; failing the
   * aggregate write over one would not be. */
  if (!event.data.after.exists) {
    try {
      const stale = await db.collection('activity')
        .where('sourceId', '==', event.params.voteId).get();
      await Promise.all(stale.docs.map((d) => d.ref.delete()));
      if (stale.size) console.log(`removed ${stale.size} activity entr(ies) for deleted vote ${event.params.voteId}`);
    } catch (e) {
      console.warn('activity cleanup failed (non-fatal)', event.params.voteId, e && e.message);
    }
  }
});


// ============================================================
//  Community hours consensus — recomputeHourStatus
// ============================================================
// Derives hourStatus/{storeId} from the submissions under hourReports/{storeId}. Runs on every
// submission write. Fully idempotent: recomputes from scratch, so verification can rise OR fall.
// The verified value is whatever >=2 distinct ELIGIBLE users currently agree on. Admin overrides
// win until cleared. All writes to hourStatus happen in a transaction (compare-and-set on revision)
// so concurrent recomputes can't clobber newer state. NOTE: test in the Firestore emulator before
// deploying — see 2-cloud-function.md.
const {getAuth} = require('firebase-admin/auth');

// --- canonical hours (defensive; the picker should already emit canonical values) ---
function canonOne(s){
  if(typeof s !== 'string') return null;
  s = s.trim();
  if(/^(24|24\/7|24h)$/i.test(s)) return '24';
  const m = s.match(/^(\d{1,2}):?(\d{2})\s*-\s*(\d{1,2}):?(\d{2})$/);
  if(!m) return null;
  let o = String(+m[1]).padStart(2,'0') + m[2];
  let c = String(+m[3]).padStart(2,'0') + m[4];
  /* Valid clock times only. The old pattern ([01]\d|2[0-4])[0-5]\d also accepted 2401-2459,
   * which are not times — 2400 is the single legal "24" value and means midnight. A community
   * report of "24:30" would have canonicalised cleanly and then been compared against a real
   * clock by isLocationOpenNow, which reads the first two digits as the hour: 24:30 parses as
   * 2430, so a store would have looked closed from 23:59 until the following midnight. */
  const VALID_HHMM = /^(([01]\d|2[0-3])[0-5]\d|2400)$/;
  if(!VALID_HHMM.test(o) || !VALID_HHMM.test(c)) return null;
  if(c === '0000') c = '2400';
  if(o === '0000' && c === '2400') return '24';   // full midnight-to-midnight span
  return o === c ? '24' : o + '-' + c;   // overnight (c<o) stays a single entry by design
}
const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
// Returns {key, value, kind} or null. `key` is a stable grouping string.
function canonicalize(value, kind){
  if(kind === 'single'){ const v = canonOne(value); return v ? {key:v, value:v, kind:'single'} : null; }
  if(kind === 'perday' && value && typeof value === 'object'){
    const out = {};
    for(const d of DAYS){ if(value[d] != null){ const v = canonOne(value[d]); if(!v) return null; out[d] = v; } }
    if(!Object.keys(out).length) return null;
    return {key:'P:' + DAYS.map(d => d + ':' + (out[d]||'')).join('|'), value:out, kind:'perday'};
  }
  return null;
}

// Eligibility: >=7-day account OR >=10 ratings. (Check-ins retired.) Evaluated live, so a report
// made while ineligible starts counting once the user qualifies.
async function eligible(uid){
  try {
    const u = await getAuth().getUser(uid);
    if (u.metadata && u.metadata.creationTime &&
        Date.now() - new Date(u.metadata.creationTime).getTime() >= 7*24*3600*1000) return true;
  } catch(e){ /* ignore */ }
  try {
    /* Count RATINGS, not vote documents.
     *
     * count() counted every vote doc for this uid — but a vote document exists as soon as someone
     * answers an amenity question, with bathroom still 0. So answering amenity prompts at ten
     * locations granted hours-consensus eligibility without ever rating a bathroom, which is not
     * what the comment above promises.
     *
     * select('bathroom') fetches one field per doc rather than the whole vote, and avoids the
     * composite index a where('bathroom','>',0) count would need. */
    const snap = await db.collection('votes').where('clientId','==',uid).select('bathroom').get();
    let ratings = 0;
    for (const d of snap.docs) {
      const b = d.get('bathroom');
      if (typeof b === 'number' && b > 0) ratings++;
    }
    if (ratings >= 10) return true;
  } catch(e){ /* ignore */ }
  return false;
}

/* Admin is an EXPLICIT opt-in, and this must agree with firestore.rules.
 *
 * Phase 2a tightened the rules from `enabled != false` to `enabled == true` and left this server
 * check untouched. The two then disagreed: a missing, null or mistyped `enabled` field made an
 * account non-admin to every client path and rules check, while STILL granting it admin authority
 * inside the hours consensus, which runs with Admin SDK privileges and bypasses rules entirely.
 * Two sources of truth for who is an administrator is worse than either answer alone. */
// Is this uid an admin? admins/{uid} with enabled == true. Admin SDK bypasses rules.
async function isAdminUid(uid){
  try { const d = await db.doc('admins/' + uid).get(); return d.exists && d.data().enabled === true; }
  catch(e){ return false; }
}

exports.recomputeHourStatus = onDocumentWritten('hourReports/{storeId}/submissions/{uid}', async (event) => {
  const storeId = event.params.storeId;
  // storeId comes from the hourReports path, which app.js already sanitises — normalise anyway
  // so a document written by any other path cannot produce an odd-segment path here.
  const statusRef = db.doc('hourStatus/' + fsId(storeId));

  // Admin authority is derived from CURRENT admin submissions on every recompute (below), so there
  // is no sticky override state to guard here — an admin editing or deleting their report re-derives
  // the result cleanly.

  /* Everything from here is inside ONE transaction, because the submissions read and the
   * hourStatus write have to be serialized TOGETHER.
   *
   * This query used to run outside the transaction below. The transaction then made the write
   * atomic, but it never proved the computation was based on the newest submissions — so a slow
   * invocation could compute "pending" from an old snapshot, and land it AFTER a newer
   * invocation had written "verified". revision++ cannot reject that: the stale write reads the
   * newer revision and simply increments past it, so it looks like the most recent answer while
   * being derived from stale input. Firestore does not guarantee trigger ordering, so the only
   * fix is to read the inputs under the same transaction that writes the output. */
  await db.runTransaction(async (tx) => {
  // Load all submissions, keep valid + eligible, group by canonical key.
  const subs = await tx.get(db.collection('hourReports/' + storeId + '/submissions'));
  const groups = {};
  const adminSubs = [];
  const valid = [];        // parsed submissions, before per-uid resolution
  for (const doc of subs.docs){
    const s = doc.data();
    const canon = canonicalize(s.value, s.kind);
    if (!canon) continue;
    valid.push({ uid: s.uid, canon, at: (typeof s.submittedAt === 'number' ? s.submittedAt : 0) });
  }

  /* Resolve each DISTINCT uid once, in parallel.
   *
   * This used to call isAdminUid() and eligible() inside the loop, sequentially, for every
   * submission — so N submissions meant up to 2N round trips awaited one after another, and the
   * same person submitting at several stores was re-checked every time. eligible() alone reads
   * Auth plus a votes query. */
  const uids = [...new Set(valid.map((v) => v.uid).filter(Boolean))];
  const [adminFlags, eligibleFlags] = await Promise.all([
    Promise.all(uids.map((u) => isAdminUid(u).catch(() => false))),
    Promise.all(uids.map((u) => eligible(u).catch(() => false))),
  ]);
  const isAdminBy = new Map(uids.map((u, i) => [u, adminFlags[i]]));
  const isEligibleBy = new Map(uids.map((u, i) => [u, eligibleFlags[i]]));

  for (const v of valid){
    // Admin reports are authoritative — they bypass the community tally entirely.
    if (isAdminBy.get(v.uid)){ adminSubs.push({ canon: v.canon, at: v.at }); continue; }
    if (!isEligibleBy.get(v.uid)) continue;
    const g = groups[v.canon.key] || (groups[v.canon.key] = {uids:new Set(), canon: v.canon});
    g.uids.add(v.uid);
  }
  let top = null, second = null;
  for (const k in groups){
    const n = groups[k].uids.size;
    if (!top || n > top.n){ second = top; top = {n, canon:groups[k].canon}; }
    else if (!second || n > second.n){ second = {n}; }
  }

  // Decide next state (recompute from scratch). Admin authority wins outright.
  let next;
  if (adminSubs.length){
    adminSubs.sort((a, b) => b.at - a.at);   // most recent admin report wins
    const win = adminSubs[0].canon;
    next = {verified:true, state:'admin_override', value:win.value, kind:win.kind,
            agreeCount:adminSubs.length, source:'admin_override'};
  } else if (top && top.n >= 2 && (!second || second.n < top.n)){
    next = {verified:true, state:'verified', value:top.canon.value, kind:top.canon.kind,
            agreeCount:top.n, source:'community_verified'};
  } else if (top && second && top.n >= 2 && second.n >= 2 && top.n === second.n){
    next = {verified:false, state:'conflict', agreeCount:top.n};
  } else {
    next = {verified:false, state:'pending', agreeCount: top ? top.n : 0};
  }

    // Same transaction — the compare-and-set on revision still applies, but now the `next` it
    // is comparing was derived from submissions read under this very transaction.
    const snap = await tx.get(statusRef);
    const p = snap.exists ? snap.data() : {};

    /* A doc that is no longer verified must not keep claiming it was. This used to carry the old
     * source forward, so a conflict or pending doc still read source:'community_verified' with a
     * confirmedAt date and the previously-verified value in `value` — indistinguishable from a
     * live verified record to anything that forgot to check the `verified` flag. bake-hours.js
     * does check it, but FlushPanel's conflict rows were rendering the stale value as if it were
     * the value in dispute. */
    const nextSource = next.source || (next.verified ? 'community_verified' : null);
    // Compare against whichever field currently holds the live value: `value` when the previous
    // state was verified, otherwise nothing was live and any new value is a change.
    const prevLive = p.verified ? p.value : undefined;
    const prevLiveKind = p.verified ? (p.kind || null) : null;
    const valueChanged = JSON.stringify(prevLive) !== JSON.stringify(next.value) || prevLiveKind !== (next.kind||null);
    const anyChanged =
      (!!p.verified) !== next.verified ||
      (p.state||null) !== next.state ||
      (p.agreeCount||0) !== (next.agreeCount||0) ||
      valueChanged ||
      (p.source||null) !== nextSource ||
      (p.schemaVersion||1) !== 2;
    if (snap.exists && !anyChanged) return;   // nothing to write

    const out = {
      verified: next.verified,
      state: next.state,
      agreeCount: next.agreeCount || 0,
      source: nextSource,
      // 2: an unverified doc no longer carries a stale value/source; the previous one moves to
      // prevValue/prevKind/prevConfirmedAt.
      schemaVersion: 2,
      bakedRevision: p.bakedRevision || 0,
      revision: (p.revision || 0) + 1,
    };
    if (next.verified){
      out.value = next.value; out.kind = next.kind;
      // value change resets the clock; otherwise just refresh lastConfirmedAt
      out.confirmedAt = valueChanged || !p.verified ? Date.now() : (p.confirmedAt || Date.now());
      out.lastConfirmedAt = Date.now();
    } else {
      // Not verified: the previous value is history, not current state. Keep it under prev* so
      // an admin can still see what it used to say, and leave `value` null so nothing can read
      // a stale window as though it were confirmed.
      out.value = null; out.kind = null;
      out.confirmedAt = null; out.lastConfirmedAt = null;
      out.prevValue = (p.verified ? p.value : p.prevValue) ?? null;
      out.prevKind  = (p.verified ? p.kind  : p.prevKind)  ?? null;
      out.prevConfirmedAt = (p.verified ? p.lastConfirmedAt : p.prevConfirmedAt) ?? null;
    }
    tx.set(statusRef, out, {merge:true});
  });
});


/* ============================================================================
 *  Account recovery
 *
 *  Accounts are username + password. The address Firebase Auth holds is
 *  usernameToEmail() — <username>@stewarts-map.local — which is a lookup key, not a
 *  mailbox: nothing is ever delivered there. So Firebase's own password-reset mail has
 *  nowhere to go, and until now a forgotten password meant the account and everything in
 *  its Passport were gone permanently, with no recourse for the person OR the admin.
 *
 *  These two functions add a real address alongside, without disturbing username login:
 *  the person stores an email, proves they own it, and a reset link for the internal
 *  address is delivered to the real one.
 *
 *  Everything lives server-side because each step handles something a client must not be
 *  trusted with — the verification token, the mapping from username to account, and the
 *  reset link itself.
 * ========================================================================== */

const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {defineSecret} = require('firebase-functions/params');
const crypto = require('crypto');

// Set with: firebase functions:secrets:set RESEND_API_KEY
// Never in the repo, and never in the client — this key can send mail as the domain.
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const MAIL_FROM = 'Bathroom Report <noreply@bathroomreport.app>';
const SITE = 'https://bathroomreport.app';
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;   // a day is long enough to find the mail, short enough to matter

async function sendMail(apiKey, to, subject, html){
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({from: MAIL_FROM, to, subject, html}),
  });
  if (!res.ok) {
    // Log the provider's reason, never the address or the link.
    console.error('resend send failed', res.status, await res.text().catch(() => ''));
    throw new Error('send failed');
  }
}

/* Tokens are stored as a SHA-256 hash, never in the clear.
 * recovery/{uid} is readable by its owner, so a plaintext token sitting in the document
 * would let anyone who could read it verify an address they do not control — which is the
 * one thing this whole flow is meant to prevent. */
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

/* Basic shape check only. Deliverability is not decidable from a regex — that is what the
 * verification link is for. This exists to catch a typo before a mail is wasted on it. */
const looksLikeEmail = (e) =>
  typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/* ---------------------------------------------------------------------------
 *  setRecoveryEmail — store an address and send a verification link.
 *  Callable, so it requires a signed-in caller and the uid comes from the verified
 *  token rather than the request body.
 * ------------------------------------------------------------------------- */
exports.setRecoveryEmail = onCall({secrets: [RESEND_API_KEY], cors: true}, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const uid = req.auth.uid;
  const email = String(req.data && req.data.email || '').trim().toLowerCase();
  if (!looksLikeEmail(email)) throw new HttpsError('invalid-argument', "That doesn't look like an email address.");

  const ref = db.collection('recovery').doc(uid);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : {};

  /* Rate limit. Each send costs quota and lands in somebody's inbox, and an unauthenticated
   * attacker is not the threat here — a signed-in account looping this is. */
  if (prev.lastSentAt && Date.now() - prev.lastSentAt < 60000) {
    throw new HttpsError('resource-exhausted', 'Just sent one — give it a minute.');
  }

  const token = crypto.randomBytes(32).toString('hex');
  await ref.set({
    email,
    // Changing the address always drops verification: proving you own one mailbox says
    // nothing about the next one.
    verified: false,
    tokenHash: hashToken(token),
    tokenExpires: Date.now() + VERIFY_TTL_MS,
    lastSentAt: Date.now(),
    updatedAt: Date.now(),
  }, {merge: true});

  const name = req.auth.token.name || 'there';
  const link = `${SITE}/verify.html?uid=${encodeURIComponent(uid)}&t=${token}`;
  await sendMail(RESEND_API_KEY.value(), email, 'Confirm your Bathroom Report recovery email', `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Confirm this address so you can recover your Bathroom Report account if you ever forget your password.</p>
    <p><a href="${link}">Confirm my email</a></p>
    <p>This link expires in 24 hours. If you didn't ask for this, ignore it — nothing changes until the link is used.</p>
  `);
  return {ok: true};
});

/* ---------------------------------------------------------------------------
 *  confirmRecoveryEmail — check the token from the emailed link.
 *  Deliberately NOT auth-gated: the link may be opened in a different browser from the
 *  one that is signed in. Possession of the token is the proof.
 * ------------------------------------------------------------------------- */
exports.confirmRecoveryEmail = onCall({cors: true}, async (req) => {
  const uid = String(req.data && req.data.uid || '');
  const token = String(req.data && req.data.token || '');
  if (!uid || !token) throw new HttpsError('invalid-argument', 'Bad link.');

  const ref = db.collection('recovery').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'That link is no longer valid.');
  const d = snap.data() || {};

  // timingSafeEqual over the hashes, so a wrong token cannot be narrowed by how long the
  // comparison takes. Both sides are fixed-length hex, so the lengths always match.
  const expected = Buffer.from(String(d.tokenHash || ''), 'utf8');
  const got = Buffer.from(hashToken(token), 'utf8');
  const match = expected.length === got.length && crypto.timingSafeEqual(expected, got);
  if (!match || !d.tokenExpires || d.tokenExpires < Date.now()) {
    throw new HttpsError('permission-denied', 'That link has expired or already been used.');
  }

  // Token cleared on use: single-use, so an old mail in an inbox is inert.
  await ref.set({
    verified: true,
    verifiedAt: Date.now(),
    tokenHash: FieldValue.delete(),
    tokenExpires: FieldValue.delete(),
  }, {merge: true});
  return {ok: true};
});

/* ---------------------------------------------------------------------------
 *  requestPasswordReset — username in, reset link to the verified address.
 *
 *  ALWAYS returns {ok:true}. No username, no recovery record, an unverified address, a
 *  rate limit — all identical from outside. Anything else turns this into a way to test
 *  whether a username exists, and usernames are shown publicly on ratings and the
 *  leaderboard, so confirming one is tied to a live account is a real leak.
 *
 *  Failures are logged for the admin instead.
 * ------------------------------------------------------------------------- */
exports.requestPasswordReset = onCall({secrets: [RESEND_API_KEY], cors: true}, async (req) => {
  const username = String(req.data && req.data.username || '').trim().toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
  if (!username) return {ok: true};

  try {
    // Same construction as usernameToEmail() in app.js. If that ever changes, this must too.
    const authEmail = `${username}@stewarts-map.local`;
    const user = await getAuth().getUserByEmail(authEmail).catch(() => null);
    if (!user) { console.log('reset: no such account'); return {ok: true}; }

    const snap = await db.collection('recovery').doc(user.uid).get();
    const d = snap.exists ? snap.data() : null;
    if (!d || d.verified !== true || !d.email) {
      console.log('reset: account has no verified recovery address');
      return {ok: true};
    }
    if (d.lastResetAt && Date.now() - d.lastResetAt < 60000) {
      console.log('reset: rate limited');
      return {ok: true};
    }

    /* generatePasswordResetLink builds a link for the INTERNAL address — the one Firebase
     * Auth actually knows about. Firebase never delivers it anywhere; we deliver it to the
     * real mailbox instead. That is the whole trick, and why username login is untouched. */
    const link = await getAuth().generatePasswordResetLink(authEmail);
    await db.collection('recovery').doc(user.uid).set({lastResetAt: Date.now()}, {merge: true});

    await sendMail(RESEND_API_KEY.value(), d.email, 'Reset your Bathroom Report password', `
      <p>Someone asked to reset the password for <b>${escapeHtml(user.displayName || username)}</b>.</p>
      <p><a href="${link}">Choose a new password</a></p>
      <p>If that wasn't you, ignore this — your password stays as it is.</p>
    `);
  } catch (e) {
    // Still {ok:true}: a send failure must not reveal that the account exists.
    console.error('requestPasswordReset failed', e && e.message);
  }
  return {ok: true};
});
