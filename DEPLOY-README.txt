BathroomReport v2.29.0 — settings sheet (2026-08-03)

Drop these five into the repo ROOT. No subfolders this time.

  app.js  index.html  shell.css  styles.css  sw.js

WHAT CHANGED
  New Settings row in the drawer opens a two-tab sheet:
    "What you see"  — All places, hide-closed, hide-step-only, travel mode,
                      maps app, theme
    "Your account"  — passport link, email, change password, sign out
  Scrim tap, the X, and Escape all close it.

  The passport flip is GONE. Its back face held email/password/theme behind a
  "flip for account" gesture — those moved into the sheet, and the card is
  one-sided again. styles.css is in this set because the flip CSS had to be
  replaced: the scene's height used to be set by JS, so with that removed the
  card would have rendered at zero height.

  Controls were MOVED, not rebuilt — same element ids, same handlers. That also
  collapsed the two competing theme controls (drawer switch + flip-card segment)
  down to one.

TEST AFTER UPLOAD
  1. Footer reads v2.29.0 · 2026-08-03  (force-close the PWA if it does not)
  2. Drawer -> Settings opens the sheet
  3. On "What you see": All places expands, both hide switches work,
     travel mode and maps app still save, theme flips
  4. On "Your account": Passport opens full height (not a sliver),
     email and change-password rows still work, sign out works
  5. Escape and the scrim both close the sheet

NOT INCLUDED
  Nothing else changed. firestore.rules and functions/index.js are unchanged
  since the last bundle — if you have not deployed those to Firebase yet,
  genderSplit votes are still being rejected.
