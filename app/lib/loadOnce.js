// app/lib/loadOnce.js
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { app } from './firebase';

/**
 * Loads all users exactly once on the client and exposes a stable { usersMap }.
 * - Safe to call in multiple components; only the first call performs the read.
 * - Subsequent calls reuse an in-memory cache.
 */
let _usersCache = null;       // Array of user docs
let _usersCacheMap = null;    // Object map id -> user
let _usersCachePromise = null;

async function fetchUsersOnce(db) {
  if (_usersCacheMap) return _usersCacheMap;
  if (_usersCachePromise) return _usersCachePromise;

  _usersCachePromise = (async () => {
    const snap = await getDocs(collection(db, 'users'));
    _usersCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    _usersCacheMap = Object.fromEntries(_usersCache.map((u) => [u.id, u]));
    return _usersCacheMap;
  })();

  return _usersCachePromise.finally(() => {
    // prevent dangling promise reuse if it throws
    _usersCachePromise = null;
  });
}

export function useUsersMapOnce() {
  const db = getFirestore(app);
  const mountedRef = useRef(true);

  const [mapState, setMapState] = useState(() => _usersCacheMap || {});
  const [loading, setLoading] = useState(!_usersCacheMap);
  const [error, setError] = useState(null);

  useEffect(() => {
    mountedRef.current = true;
    if (_usersCacheMap) {
      // cache already ready
      setLoading(false);
      setMapState(_usersCacheMap);
      return () => { mountedRef.current = false; };
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const m = await fetchUsersOnce(db);
        if (!cancelled && mountedRef.current) {
          setMapState(m || {});
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled && mountedRef.current) {
          setError(e);
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = false; mountedRef.current = false; };
  }, [db]);

  // stable reference to an object (prevents re-renders if cache unchanged)
  const usersMap = useMemo(() => mapState || {}, [mapState]);

  return { usersMap, loading, error };
}

/**
 * Optional: array accessor if you ever need it.
 */
export function useUsersArrayOnce() {
  const { usersMap, loading, error } = useUsersMapOnce();
  const users = useMemo(() => Object.values(usersMap), [usersMap]);
  return { users, usersMap, loading, error };
}
