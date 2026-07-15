import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
  import {
    getFirestore, doc, getDoc, setDoc, increment, arrayUnion,
    collection, addDoc, query, where, getDocs, deleteDoc
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
  import {
    getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
    signOut, onAuthStateChanged
  } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

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
  const db = getFirestore(fbApp);
  const auth = getAuth(fbApp);

  // Expose just what the rest of the (non-module) page script needs
  window.__fb = {
    db, doc, getDoc, setDoc, increment, arrayUnion, collection, addDoc, query, where, getDocs, deleteDoc,
    auth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut
  };

  // Track login state globally — the rest of the page (non-module script) reads window.__currentUser
  window.__currentUser = null;
  onAuthStateChanged(auth, (user) => {
    window.__currentUser = user;
    window.dispatchEvent(new Event('authStateReady'));
  });
