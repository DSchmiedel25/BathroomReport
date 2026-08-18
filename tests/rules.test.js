/* firestore.rules — behavioural tests against a real emulator.
 *
 * WHY THIS EXISTS
 * tools/audit-ui.js reads source as TEXT. It can verify that a key appears in an allowlist. It
 * cannot verify that Firestore actually rejects a write using a key that is missing from one.
 * That distinction is not academic — every rules defect found this session was invisible to
 * static analysis and visible to a human reading code:
 *
 *   wasHiddenGem was written by the client and absent from the votes allowlist, so EVERY rating
 *     at a location with fewer than five reviews was silently rejected. It surfaced as a tester
 *     saying "it says it failed but I'm still here".
 *   the same amenity key was accepted in both vote maps, so one person could confirm something
 *     twice and reach the confirmation threshold alone.
 *   votes were publicly readable while carrying uid, location and timestamp.
 *
 * Each of those is one assertion below. A test suite that only passes is worthless; the point is
 * that these FAIL if the rule regresses.
 *
 * RUN
 *   npm install                       (once)
 *   npm run test:rules
 *
 * Needs Java, which the Firebase emulator requires. `java -version` to check.
 * Nothing touches your real project: the emulator is local and in-memory.
 */
const { readFileSync } = require('fs');
const path = require('path');
const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, deleteDoc, collection, collectionGroup, getDocs, query, where, addDoc } =
  require('firebase/firestore');

const PROJECT_ID = 'bathroomreport-rules-test';
const ME = 'uid_me';
const THEM = 'uid_them';
const ADMIN = 'uid_admin';

let testEnv;

/* A vote that the rules SHOULD accept, so each test can vary one thing and attribute a failure
 * to that one thing. */
const validVote = (uid, locId) => ({
  locId,
  clientId: uid,
  bathroom: 4,
  store: 3,
  amenities: { accessible: 'yes' },
  storeFeatures: { wifi: 'yes' },
  amenityMeta: {},
  lastUpdated: Date.now(),
  ratedAt: Date.now(),
  username: 'dave',
});

const voteId = (uid, locId) => `${locId}_${uid}`;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { if (testEnv) await testEnv.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed an enabled admin. `enabled: true` specifically — the rule used to accept a missing
  // field, which meant merely EXISTING in this collection granted admin.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'admins', ADMIN), { enabled: true });
  });
});

const asMe = () => testEnv.authenticatedContext(ME).firestore();
const asThem = () => testEnv.authenticatedContext(THEM).firestore();
const asAdmin = () => testEnv.authenticatedContext(ADMIN).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

// ─────────────────────────────────────────────────────────────────────────────
describe('votes — ownership', () => {
  test('I can create my own vote', async () => {
    const db = asMe();
    await assertSucceeds(setDoc(doc(db, 'votes', voteId(ME, 'loc1')), validVote(ME, 'loc1')));
  });

  test('I cannot create a vote claiming to be someone else', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(THEM, 'loc1')), validVote(THEM, 'loc1')));
  });

  test('a signed-out visitor cannot vote', async () => {
    const db = asAnon();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')), validVote(ME, 'loc1')));
  });

  test('the document id must match locId_uid', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', 'wrong-id'), validVote(ME, 'loc1')));
  });
});

describe('votes — H-01, a vote is not public', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'votes', voteId(THEM, 'loc1')), validVote(THEM, 'loc1'));
    });
  });

  test('I can read my own vote', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'votes', voteId(ME, 'loc1')), validVote(ME, 'loc1'));
    });
    await assertSucceeds(getDoc(doc(asMe(), 'votes', voteId(ME, 'loc1'))));
  });

  /* A vote carries clientId, locId, ratedAt and username. Public reads let anyone reconstruct
   * where a named person had been and when. */
  test('I cannot read someone else\'s vote', async () => {
    await assertFails(getDoc(doc(asMe(), 'votes', voteId(THEM, 'loc1'))));
  });

  test('a signed-out visitor cannot read votes at all', async () => {
    await assertFails(getDoc(doc(asAnon(), 'votes', voteId(THEM, 'loc1'))));
  });

  test('an owner-scoped query is allowed', async () => {
    const db = asMe();
    await assertSucceeds(getDocs(query(collection(db, 'votes'), where('clientId', '==', ME))));
  });

  test('an unscoped query is denied', async () => {
    await assertFails(getDocs(collection(asMe(), 'votes')));
  });
});

describe('votes — field allowlist', () => {
  /* THE wasHiddenGem BUG. The client set this flag when someone was among the first to rate a
   * location, and it was missing from the allowlist — so from that moment every write of that
   * vote was rejected. Silently: two of three call sites swallowed their own errors. */
  test('wasHiddenGem is accepted', async () => {
    const db = asMe();
    await assertSucceeds(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), wasHiddenGem: true }));
  });

  test('an undeclared field is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), somethingNew: 'x' }));
  });

  test('a whole-star rating is accepted', async () => {
    const db = asMe();
    await assertSucceeds(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), bathroom: 5 }));
  });

  test('a fractional rating is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), bathroom: 3.7 }));
  });

  test('a rating above 5 is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), bathroom: 9 }));
  });

  test('a username over 40 characters is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), username: 'x'.repeat(41) }));
  });
});

describe('votes — H-02, the amenity maps are disjoint', () => {
  test('a bathroom key belongs in amenities', async () => {
    const db = asMe();
    await assertSucceeds(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), amenities: { accessible: 'yes' }, storeFeatures: {} }));
  });

  /* One vote could otherwise contribute two confirmations — enough to reach the threshold
   * alone. */
  test('a bathroom key in storeFeatures is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), amenities: {}, storeFeatures: { accessible: 'yes' } }));
  });

  test('a store key in amenities is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), amenities: { wifi: 'yes' }, storeFeatures: {} }));
  });

  /* A crafted key became a Firestore field path in the Cloud Function: amen.a.b.c.yes nested a
   * level too deep, and amen..yes has an empty segment that Firestore rejects outright — which
   * threw and took the rating update down with it. */
  test('an unknown amenity key is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), amenities: { 'a.b.c': 'yes' } }));
  });

  test('an unknown amenity VALUE is rejected', async () => {
    const db = asMe();
    await assertFails(setDoc(doc(db, 'votes', voteId(ME, 'loc1')),
      { ...validVote(ME, 'loc1'), amenities: { accessible: 'probably' } }));
  });
});

describe('admins — enabled must be an explicit true', () => {
  const override = { accessible: 'yes' };

  test('enabled:true grants admin', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'amenityOverrides', 'loc1'), override));
  });

  /* This used to read `enabled != false`, so a document with no such field granted admin —
   * merely existing in the collection was enough. */
  test('a missing enabled field does NOT grant admin', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins', 'uid_partial'), {});
    });
    const db = testEnv.authenticatedContext('uid_partial').firestore();
    await assertFails(setDoc(doc(db, 'amenityOverrides', 'loc1'), override));
  });

  test('enabled:false does not grant admin', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'admins', 'uid_off'), { enabled: false });
    });
    const db = testEnv.authenticatedContext('uid_off').firestore();
    await assertFails(setDoc(doc(db, 'amenityOverrides', 'loc1'), override));
  });

  test('an ordinary user cannot write an override', async () => {
    await assertFails(setDoc(doc(asMe(), 'amenityOverrides', 'loc1'), override));
  });

  test('an override value outside the enum is rejected even for an admin', async () => {
    await assertFails(setDoc(doc(asAdmin(), 'amenityOverrides', 'loc1'), { accessible: 'maybe' }));
  });
});

describe('tips — RB-02, per-entry ownership', () => {
  const entry = (uid) => ({ text: 'need a key', uid, ts: Date.now() });

  test('I can add a tip owned by me', async () => {
    await assertSucceeds(addDoc(collection(asMe(), 'tips', 'loc1', 'entries'), entry(ME)));
  });

  test('I cannot add a tip attributed to someone else', async () => {
    await assertFails(addDoc(collection(asMe(), 'tips', 'loc1', 'entries'), entry(THEM)));
  });

  test('a signed-out visitor cannot add a tip', async () => {
    await assertFails(addDoc(collection(asAnon(), 'tips', 'loc1', 'entries'), entry(ME)));
  });

  test('an over-long tip is rejected', async () => {
    await assertFails(addDoc(collection(asMe(), 'tips', 'loc1', 'entries'),
      { ...entry(ME), text: 'x'.repeat(51) }));
  });

  /* The legacy shared array could not be secured: rules cannot iterate a list, so append-only was
   * approximated by comparing SIZE, and any signed-in user could rewrite every existing tip. */
  test('the legacy shared array is admin-only now', async () => {
    await assertFails(setDoc(doc(asMe(), 'tips', 'loc1'), { tips: ['mine'] }));
    await assertSucceeds(setDoc(doc(asAdmin(), 'tips', 'loc1'), { tips: ['curated'] }));
  });
});

describe('activity — type-specific fields', () => {
  const base = { ts: Date.now(), locId: 'loc1', username: 'dave' };

  test('a rating entry with a sourceId is accepted', async () => {
    await assertSucceeds(addDoc(collection(asMe(), 'activity'),
      { ...base, type: 'rating', sourceId: voteId(ME, 'loc1') }));
  });

  test('a rating entry WITHOUT a sourceId is rejected', async () => {
    await assertFails(addDoc(collection(asMe(), 'activity'), { ...base, type: 'rating' }));
  });

  test('a tip entry without text is rejected', async () => {
    await assertFails(addDoc(collection(asMe(), 'activity'), { ...base, type: 'tip' }));
  });

  /* A far-future timestamp would pin an entry to the top of the recap permanently. */
  test('a far-future timestamp is rejected', async () => {
    await assertFails(addDoc(collection(asMe(), 'activity'),
      { ...base, type: 'rating', sourceId: 'x', ts: Date.now() + 9e10 }));
  });
});

describe('outOfOrder — RB-03, timestamps are clamped', () => {
  const report = (uid, extra = {}) => ({
    locId: 'loc1', locName: 'Test', lat: 42, lng: -73,
    reporterId: uid, ts: Date.now(), cleared: false, ...extra,
  });

  test('a normal report is accepted', async () => {
    await assertSucceeds(addDoc(collection(asMe(), 'outOfOrder'), report(ME)));
  });

  test('I cannot file a report as someone else', async () => {
    await assertFails(addDoc(collection(asMe(), 'outOfOrder'), report(THEM)));
  });

  /* A future-dated cleared:true suppressed every real report at a location permanently, and a
   * future-dated report pinned it broken forever. */
  test('a far-future timestamp is rejected', async () => {
    await assertFails(addDoc(collection(asMe(), 'outOfOrder'),
      report(ME, { ts: Date.now() + 9e10 })));
  });

  test('reports are immutable — no update, no delete', async () => {
    let id;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(collection(ctx.firestore(), 'outOfOrder'), report(ME));
      id = ref.id;
    });
    await assertFails(setDoc(doc(asMe(), 'outOfOrder', id), report(ME, { cleared: true })));
    await assertFails(deleteDoc(doc(asMe(), 'outOfOrder', id)));
  });
});

describe('users — the ratings mirror is private', () => {
  const profile = (uid) => ({ uid, username: 'dave', lastUpdated: Date.now(), ratings: {} });

  test('I can write my own profile', async () => {
    await assertSucceeds(setDoc(doc(asMe(), 'users', ME), profile(ME)));
  });

  test('I cannot write someone else\'s', async () => {
    await assertFails(setDoc(doc(asMe(), 'users', THEM), profile(THEM)));
  });

  /* This document mirrors every rating a person has made, keyed by location. */
  test('I cannot read someone else\'s', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', THEM), profile(THEM));
    });
    await assertFails(getDoc(doc(asMe(), 'users', THEM)));
  });

  test('an admin can read it, for moderation', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', THEM), profile(THEM));
    });
    await assertSucceeds(getDoc(doc(asAdmin(), 'users', THEM)));
  });
});

describe('hourReports — value shape depends on kind', () => {
  const sub = (uid, extra) => ({
    uid, kind: 'single', value: '0500-2300',
    submittedAt: Date.now(), schemaVersion: 1, ...extra,
  });
  const ref = (db, uid) => doc(db, 'hourReports', 'loc1', 'submissions', uid);

  test('a single window is a string', async () => {
    await assertSucceeds(setDoc(ref(asMe(), ME), sub(ME)));
  });

  test('a per-day report is a map', async () => {
    await assertSucceeds(setDoc(ref(asMe(), ME),
      sub(ME, { kind: 'perday', value: { mon: '0500-2300', tue: '24' } })));
  });

  test('a single window given as a map is rejected', async () => {
    await assertFails(setDoc(ref(asMe(), ME), sub(ME, { value: { mon: '24' } })));
  });

  test('I cannot submit under someone else\'s uid', async () => {
    await assertFails(setDoc(ref(asMe(), THEM), sub(THEM)));
  });
});

describe('server-derived collections are read-only to clients', () => {
  for (const c of ['aggregates', 'hourStatus', 'leaderboard', 'userStats']) {
    test(`${c} cannot be written, even by an admin`, async () => {
      await assertFails(setDoc(doc(asAdmin(), c, 'loc1'), { anything: 1 }));
    });
  }

  test('admins cannot be granted from a client', async () => {
    await assertFails(setDoc(doc(asMe(), 'admins', ME), { enabled: true }));
    await assertFails(setDoc(doc(asAdmin(), 'admins', ME), { enabled: true }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
/* Reports — one live report per person per location.
 *
 * A test report submitted from the app was refused with permission-denied and the client, which
 * mapped every refusal to "you've already reported this one", hid it. These assertions exist to
 * say WHICH clause refuses: each varies exactly one thing from a payload that should be accepted,
 * so a failure names its own cause instead of leaving the whole rule under suspicion.
 *
 * The first test is the important one. If it fails, the rule refuses a write the app makes in
 * normal operation, and the ones below it will say why. */
describe('reports — one live report per person per location', () => {
  // Exactly what app.js logReport() sends. Keep in step with it.
  const validReport = (uid, locId) => ({
    locId,
    locName: "Stewart's Shops - Test",
    addr: '123 Main Street',
    chainKey: 'stewarts',
    chain: "Stewart's Shops",
    storeNumber: null,
    city: 'Albany',
    state: 'NY',
    lat: 42.65,
    lng: -73.75,
    reporterId: uid,
    reporterName: 'dave',
    reason: 'Permanently closed',
    ts: Date.now(),
  });

  // Mirror of fsId() in app.js and fsLocId() in the rules.
  const reportId = (locId, uid) => `${locId.split('/').join('__')}_${uid}`;

  test('I can file a report on a location', async () => {
    const locId = 'stewarts-123';
    await assertSucceeds(
      setDoc(doc(asMe(), 'reports', reportId(locId, ME)), validReport(ME, locId))
    );
  });

  test('an OSM id containing a slash still works', async () => {
    const locId = 'node/456';
    await assertSucceeds(
      setDoc(doc(asMe(), 'reports', reportId(locId, ME)), validReport(ME, locId))
    );
  });

  test('a second report on the same location is refused', async () => {
    const locId = 'stewarts-123';
    const id = reportId(locId, ME);
    await assertSucceeds(setDoc(doc(asMe(), 'reports', id), validReport(ME, locId)));
    await assertFails(setDoc(doc(asMe(), 'reports', id), validReport(ME, locId)));
  });

  test('a different location is still allowed', async () => {
    await assertSucceeds(setDoc(doc(asMe(), 'reports', reportId('a', ME)), validReport(ME, 'a')));
    await assertSucceeds(setDoc(doc(asMe(), 'reports', reportId('b', ME)), validReport(ME, 'b')));
  });

  test('someone else may report the same location', async () => {
    const locId = 'stewarts-123';
    await assertSucceeds(setDoc(doc(asMe(), 'reports', reportId(locId, ME)), validReport(ME, locId)));
    await assertSucceeds(setDoc(doc(asThem(), 'reports', reportId(locId, THEM)), validReport(THEM, locId)));
  });

  test('a null reporterName is refused (null is present, not absent)', async () => {
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asMe(), 'reports', reportId(locId, ME)),
      { ...validReport(ME, locId), reporterName: null }));
  });

  test('an arbitrary document id is refused', async () => {
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asMe(), 'reports', 'whatever'), validReport(ME, locId)));
  });

  test('I cannot report as someone else', async () => {
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asMe(), 'reports', reportId(locId, THEM)), validReport(THEM, locId)));
  });

  test('a signed-out visitor cannot report', async () => {
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asAnon(), 'reports', `${locId}_anon`), validReport('anon', locId)));
  });

  test('a far-future timestamp is refused', async () => {
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asMe(), 'reports', reportId(locId, ME)),
      { ...validReport(ME, locId), ts: Date.now() + 86400000 }));
  });

  test('an impossible latitude is refused', async () => {
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asMe(), 'reports', reportId(locId, ME)),
      { ...validReport(ME, locId), lat: 999 }));
  });

  test('half a coordinate pair is refused', async () => {
    const locId = 'stewarts-123';
    const r = validReport(ME, locId); delete r.lng;
    await assertFails(setDoc(doc(asMe(), 'reports', reportId(locId, ME)), r));
  });

  test('a reporter cannot read the queue', async () => {
    const locId = 'stewarts-123';
    await assertSucceeds(setDoc(doc(asMe(), 'reports', reportId(locId, ME)), validReport(ME, locId)));
    await assertFails(getDocs(collection(asMe(), 'reports')));
  });
});

describe('reporters — standing is admin-owned', () => {
  test('an admin can list the collection', async () => {
    await assertSucceeds(getDocs(collection(asAdmin(), 'reporters')));
  });

  test('an ordinary user cannot list it', async () => {
    await assertFails(getDocs(collection(asMe(), 'reporters')));
  });

  test('I can read my own record', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reporters', ME), { spamCount: 1, blockedAttempts: 0 });
    });
    await assertSucceeds(getDoc(doc(asMe(), 'reporters', ME)));
    await assertFails(getDoc(doc(asMe(), 'reporters', THEM)));
  });

  test('I can increment my own blockedAttempts by one, and nothing else', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reporters', ME), { spamCount: 2, blockedAttempts: 0 });
    });
    await assertSucceeds(setDoc(doc(asMe(), 'reporters', ME), { blockedAttempts: 1 }, { merge: true }));
    // Not by more than one, and not any other field.
    await assertFails(setDoc(doc(asMe(), 'reporters', ME), { blockedAttempts: 99 }, { merge: true }));
    await assertFails(setDoc(doc(asMe(), 'reporters', ME), { spamCount: 0 }, { merge: true }));
    await assertFails(setDoc(doc(asMe(), 'reporters', ME), { muted: false }, { merge: true }));
  });

  test('a muted reporter cannot file a report', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reporters', ME),
        { muted: true, mutedUntil: Date.now() + 86400000 });
    });
    const locId = 'stewarts-123';
    await assertFails(setDoc(doc(asMe(), 'reports', `${locId}_${ME}`), {
      locId, locName: 'x', addr: null, chainKey: 'stewarts', chain: 'S', storeNumber: null,
      city: null, state: null, lat: 42.65, lng: -73.75,
      reporterId: ME, reporterName: 'dave', reason: 'Wrong hours', ts: Date.now(),
    }));
  });

  test('an expired mute lets reports through again', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'reporters', ME),
        { muted: true, mutedUntil: Date.now() - 86400000 });
    });
    const locId = 'stewarts-123';
    await assertSucceeds(setDoc(doc(asMe(), 'reports', `${locId}_${ME}`), {
      locId, locName: 'x', addr: null, chainKey: 'stewarts', chain: 'S', storeNumber: null,
      city: null, state: null, lat: 42.65, lng: -73.75,
      reporterId: ME, reporterName: 'dave', reason: 'Wrong hours', ts: Date.now(),
    }));
  });
});

describe('reportHistory — the archive is admin-only', () => {
  test('an admin can write and read it', async () => {
    await assertSucceeds(setDoc(doc(asAdmin(), 'reportHistory', 'x'), { locId: 'a', status: 'resolved' }));
    await assertSucceeds(getDocs(collection(asAdmin(), 'reportHistory')));
  });

  test('nobody else can read it', async () => {
    await assertFails(getDocs(collection(asMe(), 'reportHistory')));
    await assertFails(getDocs(collection(asAnon(), 'reportHistory')));
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Contribution credits — approval is what counts
 *
 * The badges used to count contributions at SUBMISSION time, which rewarded filing nonsense
 * exactly as much as filing something real. Credit is now granted server-side on approval, as
 * one document per approved contribution under userStats/{uid}/credits.
 *
 * The important property is that NOTHING with a client credential can write there. Cloud
 * Functions use the Admin SDK and bypass rules entirely, so the collection stays fully closed
 * and the triggers still work. If a test below ever starts passing a write, the badges have
 * become self-serve.
 *
 * The read paths this feature briefly needed — an own-scoped list of reports, an own-scoped read
 * of missingReports, and a collection-group read of hour submissions — are all gone again: the
 * client only reads its own credit ledger now. These assertions hold the queue shut.
 * ────────────────────────────────────────────────────────────────────────────*/
describe('contribution credits — the ledger is server-written only', () => {
  const creditRef = (db, uid) => doc(db, 'userStats', uid, 'credits', 'report_abc');

  test('I cannot grant myself a credit', async () => {
    await assertFails(setDoc(creditRef(asMe(), ME), { type: 'report', grantedAt: Date.now() }));
  });

  test('an admin cannot grant a credit from a client either', async () => {
    await assertFails(setDoc(creditRef(asAdmin(), ME), { type: 'report', grantedAt: Date.now() }));
  });

  test('I can read my own credits', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'userStats', ME, 'credits', 'report_abc'),
        { type: 'report', grantedAt: Date.now() });
    });
    await assertSucceeds(getDocs(collection(asMe(), 'userStats', ME, 'credits')));
  });

  test('I cannot read someone else\'s', async () => {
    // A credit names the location that was corrected, so the set is a map of where a person
    // has been — the same reason votes/{id} is owner-only.
    await assertFails(getDocs(collection(asMe(), 'userStats', THEM, 'credits')));
  });

  test('a signed-out visitor cannot read credits', async () => {
    await assertFails(getDocs(collection(asAnon(), 'userStats', ME, 'credits')));
  });

  test('the hour-credit ledger is closed to everyone', async () => {
    await assertFails(getDocs(collection(asMe(), 'hourCredits')));
    await assertFails(setDoc(doc(asAdmin(), 'hourCredits', 'loc1'), { uids: [ME] }));
  });
});

describe('contribution credits — missingReports carry an optional owner', () => {
  const missing = (extra) => ({ description: '123 Main St', ts: Date.now(), ...extra });

  test('a submission with my own uid is accepted', async () => {
    await assertSucceeds(addDoc(collection(asMe(), 'missingReports'), missing({ uid: ME })));
  });

  test('a submission claiming someone else\'s uid is refused', async () => {
    await assertFails(addDoc(collection(asMe(), 'missingReports'), missing({ uid: THEM })));
  });

  test('a signed-out submission with no uid still works', async () => {
    // The whole point of this collection: someone with no account can still flag a missing
    // place. Attaching an owner is what makes it CREDITABLE, never what makes it acceptable.
    await assertSucceeds(addDoc(collection(asAnon(), 'missingReports'), missing()));
  });

  test('a signed-out submission cannot forge a uid', async () => {
    await assertFails(addDoc(collection(asAnon(), 'missingReports'), missing({ uid: ME })));
  });

  test('the submission queue stays admin-only', async () => {
    await assertFails(getDocs(collection(asMe(), 'missingReports')));
  });
});

describe('contribution credits — the moderation queues stay shut', () => {
  test('a reporter still cannot list their own reports', async () => {
    await assertFails(
      getDocs(query(collection(asMe(), 'reports'), where('reporterId', '==', ME))));
  });

  test('nor the whole report queue', async () => {
    await assertFails(getDocs(collection(asMe(), 'reports')));
  });

  test('a collection-group read of hour submissions is denied', async () => {
    await assertFails(
      getDocs(query(collectionGroup(asMe(), 'submissions'), where('uid', '==', ME))));
  });
});
