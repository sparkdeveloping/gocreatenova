// app/firebase.js
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  indexedDBLocalPersistence,
  setPersistence,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

// Singleton app
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// ---- Auth (persist to IndexedDB) ----
const auth = getAuth(app);
setPersistence(auth, indexedDBLocalPersistence).catch(() => {
  // non-fatal; fall back to default if IndexedDB blocked
});

// ---- Firestore with durable local cache + multi-tab coherence ----
let db;
if (typeof window !== "undefined") {
  // Must be called before any getFirestore() usage
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(), // multi-tab safe
    }),
    ignoreUndefinedProperties: true,
  });
} else {
  // SSR/Node paths won’t use persistence
  db = getFirestore(app);
}

// ---- Other services ----
const storage = getStorage(app);
const rtdb = getDatabase(app);

export { app, auth, db, storage, rtdb };
