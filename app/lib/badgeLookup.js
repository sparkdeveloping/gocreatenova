// app/lib/badgeLookup.js
'use client';

import { getFirestore, collection, query, where, limit as fsLimit, getDocs, doc, getDoc } from 'firebase/firestore';
import { app } from './firebase';

// ----------------------------
// In-memory + localStorage cache
// ----------------------------
const LS_KEY = 'nova-badge-index-v1';
const TTL_MS = 10 * 60 * 1000; // 10 minutes

let badgeIndex = new Map();     // badgeCode (string) -> userId (string)
let cacheLoaded = false;
let cacheLoadedAt = 0;

function loadCache() {
  if (cacheLoaded && Date.now() - cacheLoadedAt < TTL_MS) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.entries && parsed.cachedAt && Date.now() - parsed.cachedAt < TTL_MS) {
        badgeIndex = new Map(parsed.entries);
      } else {
        badgeIndex = new Map();
      }
    }
  } catch (_) {
    badgeIndex = new Map();
  } finally {
    cacheLoaded = true;
    cacheLoadedAt = Date.now();
  }
}

function saveCache() {
  try {
    const entries = Array.from(badgeIndex.entries());
    localStorage.setItem(LS_KEY, JSON.stringify({ cachedAt: Date.now(), entries }));
  } catch (_) {}
}

function toBadgeKey(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  // keep as typed (your codes are 5 digits already); normalize by removing non-digits
  const digits = s.replace(/\D+/g, '');
  return digits || s;
}

// ----------------------------
// Public API
// ----------------------------

/**
 * Seed the badge index from a users pool (array or map).
 * Minimizes reads by preparing a local key->id map.
 * Safe to call multiple times.
 */
export function primeBadgeIndex(usersPool) {
  loadCache();

  if (!usersPool) return;
  const iter = Array.isArray(usersPool)
    ? usersPool
    : typeof usersPool === 'object'
      ? Object.values(usersPool)
      : [];

  for (const u of iter) {
    const badge = u?.badge;
    const code = toBadgeKey(badge?.id ?? u?.badgeId);
    const uid = u?.id || u?.uid || u?.userId;
    if (!code || !uid) continue;

    // prefer most recent assignment
    badgeIndex.set(code, String(uid));

    // also allow numeric key if someone compares Number(code)
    const asNum = String(Number(code));
    if (asNum && asNum !== code) badgeIndex.set(asNum, String(uid));
  }

  saveCache();
}

/**
 * Update/insert a single mapping after you link a badge.
 */
export function updateLocalBadgeIndex(userId, badgeCode) {
  loadCache();
  const key = toBadgeKey(badgeCode);
  if (!key || !userId) return;
  badgeIndex.set(key, String(userId));
  const asNum = String(Number(key));
  if (asNum && asNum !== key) badgeIndex.set(asNum, String(userId));
  saveCache();
}

/**
 * Clear the local index (rarely needed; useful for debugging).
 */
export function clearBadgeIndex() {
  badgeIndex = new Map();
  saveCache();
}

/**
 * Find a user by badge code with zero reads when possible.
 * Falls back to at most 1 Firestore read (a single WHERE query).
 *
 * Options:
 *  - userPool: object map (id->user) or array of users for zero-read hydration
 *  - allowFirestoreFallback: when true, does ONE query on miss to resolve user
 *  - directGetById: when true and we already know the id (from index), fetches
 *                   Firestore doc to ensure fresh data if userPool lacks it.
 */
export async function findUserByBadge(badgeCode, opts = {}) {
  loadCache();
  const {
    userPool = null,
    allowFirestoreFallback = true,
    directGetById = false,
  } = opts;

  const db = getFirestore(app);
  const key = toBadgeKey(badgeCode);
  if (!key) return null;

  // 1) Zero-read path via local index
  const uid = badgeIndex.get(key);
  if (uid) {
    // try to resolve from provided pool (no reads)
    let user = null;
    if (userPool) {
      if (Array.isArray(userPool)) {
        user = userPool.find((u) => (u?.id || u?.uid || u?.userId) === uid) || null;
      } else if (typeof userPool === 'object') {
        user = userPool[uid] || null;
      }
    }

    // If caller asked for a fresh doc and pool didn’t have it, do 1 getDoc
    if (!user && directGetById) {
      try {
        const ref = doc(db, 'users', uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          user = { id: snap.id, ...snap.data() };
        }
      } catch (_) {}
    }

    if (user) return { id: uid, ...user };
    // If we know the uid but don't have user data and directGetById is false,
    // still return a minimal stub to avoid a read (caller can decide next step).
    return { id: uid };
  }

  // 2) Fallback: at most ONE query to Firestore to resolve unknown badges
  if (allowFirestoreFallback) {
    try {
      const usersCol = collection(db, 'users');
      const tryFields = ['badge.id', 'badge.badgeNumber'];

      for (const f of tryFields) {
        const qRef = query(usersCol, where(f, '==', key), fsLimit(1));
        const snap = await getDocs(qRef);
        if (!snap.empty) {
          const d = snap.docs[0];
          const data = { id: d.id, ...d.data() };

          // learn this mapping to keep future lookups zero-read
          updateLocalBadgeIndex(d.id, key);

          return data;
        }
      }
    } catch (e) {
      // swallow and return null — caller can handle "not found"
    }
  }

  return null;
}
