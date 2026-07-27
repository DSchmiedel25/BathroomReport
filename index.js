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
    // Stamp only when the new state includes a real rating (not on rating removal), so the
    // client's "rated X ago" line reflects the most recent actual rating.
    ...(a > 0 ? { lastRatedAt: Date.now() } : {}),
  }, {merge: true});
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
  if(!/^([01]\d|2[0-4])[0-5]\d$/.test(o) || !/^([01]\d|2[0-4])[0-5]\d$/.test(c)) return null;
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

// Is this uid an admin? admins/{uid} with enabled != false. Admin SDK bypasses rules.
async function isAdminUid(uid){
  try { const d = await db.doc('admins/' + uid).get(); return d.exists && d.data().enabled !== false; }
  catch(e){ return false; }
}

exports.recomputeHourStatus = onDocumentWritten('hourReports/{storeId}/submissions/{uid}', async (event) => {
  const storeId = event.params.storeId;
  const statusRef = db.doc('hourStatus/' + storeId);

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

    const nextSource = next.source || (next.verified ? 'community_verified' : (p.source || null));
    const valueChanged = JSON.stringify(p.value) !== JSON.stringify(next.value) || (p.kind||null) !== (next.kind||null);
    const anyChanged =
      (!!p.verified) !== next.verified ||
      (p.state||null) !== next.state ||
      (p.agreeCount||0) !== (next.agreeCount||0) ||
      valueChanged ||
      (p.source||null) !== nextSource;
    if (snap.exists && !anyChanged) return;   // nothing to write

    const out = {
      verified: next.verified,
      state: next.state,
      agreeCount: next.agreeCount || 0,
      source: nextSource,
      schemaVersion: 1,
      bakedRevision: p.bakedRevision || 0,
      revision: (p.revision || 0) + 1,
    };
    if (next.verified){
      out.value = next.value; out.kind = next.kind;
      // value change resets the clock; otherwise just refresh lastConfirmedAt
      out.confirmedAt = valueChanged || !p.verified ? Date.now() : (p.confirmedAt || Date.now());
      out.lastConfirmedAt = Date.now();
    } else {
      out.value = p.value || null; out.kind = p.kind || null;
      out.confirmedAt = p.confirmedAt || null;
      out.lastConfirmedAt = p.lastConfirmedAt || null;
    }
    tx.set(statusRef, out, {merge:true});
  });
});
