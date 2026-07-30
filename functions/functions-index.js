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
 * Values are compared as strings; 'yes' and 'no' are the only ones that move a counter. */
/* The ONLY amenity and store-feature keys this function will tally.
 *
 * Keys used to be taken straight from the vote and turned into Firestore dot paths, and the
 * rules bound the map's SIZE but never its key names. A crafted vote could therefore produce
 * `amen.a.b.c.yes` — nesting a level deeper than the schema — or `amen..yes`, whose empty path
 * segment Firestore rejects outright, throwing and losing the rating update alongside it.
 *
 * Mirrors BATHROOM_AMENITIES and STORE_FEATURES in app.js. Adding an amenity there now needs a
 * line here too; that is the cost of not letting untrusted input name a field path. */
const AMENITY_KEYS = new Set([
  'restroomType', 'accessible', 'changing', 'hasRestroom',
  'evCharging', 'airPump', 'shower', 'indoorSeating', 'wifi', 'grabAndGo', 'hotFood',
]);

/* Returns { key: { yes: delta, no: delta } } — NOT dot paths. The caller resolves these against
 * the aggregate's current values inside a transaction, which is what lets it clamp at zero. */
function amenityDeltas(before, after) {
  const deltas = {};
  const bump = (key, which, n) => {
    if (!AMENITY_KEYS.has(key)) return;          // untrusted keys never reach a field path
    deltas[key] = deltas[key] || { yes: 0, no: 0 };
    deltas[key][which] += n;
  };
  for (const field of ['amenities', 'storeFeatures']) {
    const b = (before && before[field]) || {};
    const a = (after && after[field]) || {};
    for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
      const bv = String(b[key] == null ? '' : b[key]);
      const av = String(a[key] == null ? '' : a[key]);
      if (bv === av) continue;
      if (bv === 'yes' || bv === 'no') bump(key, bv, -1);
      if (av === 'yes' || av === 'no') bump(key, av, 1);
    }
  }
  // Drop keys whose deltas cancelled out.
  for (const k of Object.keys(deltas)) {
    if (deltas[k].yes === 0 && deltas[k].no === 0) delete deltas[k];
  }
  return deltas;
}

exports.recomputeBathroomAggregate = onDocumentWritten('votes/{voteId}', async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after  = event.data.after.exists  ? event.data.after.data()  : null;

  // Only bathroom ratings 1–5 count toward the average; 0/undefined means "not rated".
  const b = (before && typeof before.bathroom === 'number' && before.bathroom > 0) ? before.bathroom : 0;
  const a = (after  && typeof after.bathroom  === 'number' && after.bathroom  > 0) ? after.bathroom  : 0;

  const sumDelta   = a - b;
  const countDelta = (a > 0 ? 1 : 0) - (b > 0 ? 1 : 0);
  const amen       = amenityDeltas(before, after);

  // Nothing changed that any counter tracks (e.g. a lastUpdated-only touch).
  if (sumDelta === 0 && countDelta === 0 && Object.keys(amen).length === 0) return;

  const locId = (after && after.locId) || (before && before.locId);
  if (!locId) return;

  const ref = db.doc(`aggregates/${fsId(locId)}`);

  /* ONE transaction, for two reasons that need the same mechanism.
   *
   * ATOMICITY. This used to be set() followed by update(). Two writes: the second failing left
   * the rating totals moved and the amenity tallies not, and nothing retried.
   *
   * NEGATIVE COUNTERS. FieldValue.increment(-1) is blind — it will happily take a counter to -1.
   * Every amenity answer cast before this function existed was never tallied, so the first time
   * such a vote is CHANGED or DELETED the decrement lands on a baseline that was never
   * incremented. I previously called that "incomplete history"; it is not. A count of -1 is
   * corrupt, it propagates into isConfirmedYes/No, and it cannot be distinguished later from a
   * real tally. Reading the current value first is the only way to clamp it.
   *
   * Rating totals stay on increment() — those have been maintained since day one, so their
   * baseline is sound, and increment is contention-free. */
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const cur  = snap.exists ? (snap.data() || {}) : {};

    const patch = {
      schemaVersion: 2,
      lastUpdated:   Date.now(),
      /* Stamp only when the new state includes a real rating (not on rating removal), so the
       * client's "rated X ago" line reflects the most recent actual rating.
       *
       * lastRatedBy rides in a document the popup already fetches, so attribution costs no extra
       * read. The username is a chosen handle — sign-up converts it to a synthetic
       * @stewarts-map.local address purely because Firebase Auth wants an email format — so this
       * exposes no personal data. Bounded to 40 to match the votes rule. */
      ...(a > 0 ? { lastRatedAt: Date.now() } : {}),
      ...(a > 0 && after && typeof after.username === 'string' && after.username
          ? { lastRatedBy: after.username.slice(0, 40) } : {}),
    };
    if (sumDelta !== 0)   patch.bathroomSum   = FieldValue.increment(sumDelta);
    if (countDelta !== 0) patch.bathroomCount = FieldValue.increment(countDelta);

    /* Resolve amenity counts against what is actually stored, clamped at zero. Nested objects
     * rather than dot paths, because merge:true preserves sibling keys and the key names are
     * already restricted to AMENITY_KEYS. */
    const keys = Object.keys(amen);
    if (keys.length) {
      const curAmen = (cur && typeof cur.amen === 'object' && cur.amen) || {};
      const nextAmen = {};
      for (const key of keys) {
        const c = (curAmen[key] && typeof curAmen[key] === 'object') ? curAmen[key] : {};
        const cy = Number.isFinite(c.yes) ? c.yes : 0;
        const cn = Number.isFinite(c.no)  ? c.no  : 0;
        nextAmen[key] = {
          yes: Math.max(0, cy + amen[key].yes),
          no:  Math.max(0, cn + amen[key].no),
        };
      }
      patch.amen = nextAmen;
    }

    tx.set(ref, patch, {merge: true});
  });
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
    const c = await db.collection('votes').where('clientId','==',uid).count().get();
    if (c.data().count >= 10) return true;
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

  // Load all submissions, keep valid + eligible, group by canonical key.
  const subs = await db.collection('hourReports/' + storeId + '/submissions').get();
  const groups = {};
  const adminSubs = [];
  for (const doc of subs.docs){
    const s = doc.data();
    const canon = canonicalize(s.value, s.kind);
    if (!canon) continue;
    // Admin reports are authoritative — they bypass the community tally entirely.
    if (await isAdminUid(s.uid)){
      adminSubs.push({ canon, at: (typeof s.submittedAt === 'number' ? s.submittedAt : 0) });
      continue;
    }
    if (!(await eligible(s.uid))) continue;
    const g = groups[canon.key] || (groups[canon.key] = {uids:new Set(), canon});
    g.uids.add(s.uid);
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

  // Transactional compare-and-set on revision.
  await db.runTransaction(async (tx) => {
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
