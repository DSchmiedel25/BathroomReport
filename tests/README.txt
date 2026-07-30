Firestore rules tests
=====================

WHAT THESE ARE FOR
  tools/audit-ui.js reads source as TEXT. It can confirm a key appears in an allowlist. It cannot
  confirm Firestore actually REJECTS a write that uses a key missing from one. Only running the
  rules proves that, and every rules defect found across three audits was invisible to static
  analysis:

    wasHiddenGem      written by the client, absent from the votes allowlist. Every rating at a
                      location with under five reviews was rejected — silently, because two of
                      three call sites swallowed their errors. It surfaced as a tester saying
                      "it says it failed but I'm still here."
    amenity overlap   the same key was accepted in both vote maps, so one person could confirm
                      something twice and reach the threshold alone.
    public votes      readable by anyone while carrying uid, location and timestamp.

  Each of those is one assertion in rules.test.js. A suite that only ever passes is worthless —
  the value is that these FAIL if a rule regresses.

RUN
  npm install          once
  npm run test:rules

REQUIRES JAVA
  The Firestore emulator is a Java program. Check with:  java -version
  If missing:  brew install --cask temurin

NOTHING TOUCHES YOUR REAL PROJECT
  The emulator runs locally and in memory, under a throwaway project id
  (bathroomreport-rules-test). Your data is never read or written. It is safe to run repeatedly.

WHAT IT COVERS — 48 assertions
  votes         ownership, id format, the field allowlist, whole-star ratings, username length,
                the disjoint amenity maps, unknown keys and values
  votes reads   own allowed, other denied, anonymous denied, owner-scoped query allowed and an
                unscoped query denied
  admins        enabled:true grants; a missing field or enabled:false does not
  tips          per-entry ownership, length, and the legacy array being admin-only
  activity      type-specific required fields, clamped timestamps
  outOfOrder    ownership, clamped timestamps, immutability
  users         private mirror, admin read for moderation
  hourReports   value shape per kind, ownership
  read-only     aggregates, hourStatus, leaderboard, userStats, and admins unwritable by clients

WHEN A TEST FAILS
  Read what it asserts before changing the rule. Several of these encode a decision rather than a
  detail — the disjoint amenity maps exist so one person cannot confirm twice, and the owner-only
  vote read exists because a vote reveals where someone has been. If a change requires loosening
  one, that is worth doing deliberately, not by deleting the assertion.

ADDING TO THEM
  The useful habit: when something breaks in production, add the assertion that would have caught
  it BEFORE fixing it, and watch it fail. That is the only way to know the test is real. Two
  checks in tools/audit-ui.js passed a deliberately broken build during this project because
  nobody tested the test.
