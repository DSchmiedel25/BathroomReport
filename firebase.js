import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import {
    getFirestore, doc, getDoc, setDoc, increment, arrayUnion,
    collection, addDoc, query, where, getDocs, deleteDoc
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
  import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
    signOut, onAuthStateChanged, updateProfile
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
  import {
    initializeAppCheck, ReCaptchaV3Provider
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";

  const firebaseConfig = {
    apiKey: "AIzaSyDMu-9NYeqvBD4Mbp2jctoAF89raE7p8UM",
    authDomain: "stewarts-map.firebaseapp.com",
    projectId: "stewarts-map",
    storageBucket: "stewarts-map.firebasestorage.app",
    messagingSenderId: "1024042855550",
    appId: "1:1024042855550:web:02120ef818d67c57e17c2f",
    measurementId: "G-Q63YXL8XVY"
  };

  const fbApp = initializeApp(firebaseConfig);

  /* App Check — attests that a request came from this app, not a script hitting the REST API.
   *
   * The reports and missingReports collections accept writes that the rules can shape but cannot
   * attribute: nothing in a rule can tell a real visitor from a loop posting straight to
   * Firestore. blockedDevices does not close that, because the client picks the identifier it
   * presents and can rotate it at will. App Check is the piece that makes "did this come from
   * bathroomreport.app" answerable at all.
   *
   * The site key is public by design — it is bound to the domain registered with reCAPTCHA, so
   * publishing it grants nothing. The SECRET key is the one that must never appear here; it lives
   * in the Firebase console.
   *
   * MUST run before getFirestore/getAuth so that every subsequent call carries a token.
   *
   * Enforcement is a separate switch in the Firebase console and is deliberately still OFF. Until
   * it is turned on this only reports metrics, so a token failure cannot lock anybody out. That
   * is the point of the ordering: ship the token flow, watch the console for a few days, and only
   * enforce once the traffic is demonstrably attested.
   *
   * Wrapped because a reCAPTCHA failure — an ad blocker, a network filter, gstatic unreachable —
   * must not take the app down with it. With enforcement off the consequence of a miss is an
   * unattested request, which is exactly what every request was before this existed. */
  try{
    initializeAppCheck(fbApp, {
      provider: new ReCaptchaV3Provider('6LdaNnAtAAAAAAuYD76f2g40rfCcQNgYEm49xZQz'),
      isTokenAutoRefreshEnabled: true
    });
  }catch(e){
    console.warn('App Check did not initialise; requests will be unattested', e && e.code);
  }

  const db = getFirestore(fbApp);
  const auth = getAuth(fbApp);

  // Expose just what the rest of the (non-module) page script needs
  window.__fb = {
    db, doc, getDoc, setDoc, increment, arrayUnion, collection, addDoc, query, where, getDocs, deleteDoc,
    auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, updateProfile
  };

  // Track login state globally — the rest of the page (non-module script) reads window.__currentUser
  window.__currentUser = null;
  onAuthStateChanged(auth, (user) => {
    window.__currentUser = user;
    window.dispatchEvent(new Event('authStateReady'));
  });
