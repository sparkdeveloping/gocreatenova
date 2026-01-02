'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  // cache-first helpers
  getDocFromCache,
  getDocFromServer,
  getDocsFromCache,
  getDocsFromServer,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useRouter, usePathname } from 'next/navigation';

const UserContext = createContext(null);
const DISABLE_AUTO_REDIRECTS = true;

// ---- Roles cache (localStorage) ----
const ROLES_CACHE_KEY = 'nova-roles-v1';
const ROLES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function readRolesCache() {
  try {
    const raw = localStorage.getItem(ROLES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.cachedAt || Date.now() - parsed.cachedAt > ROLES_CACHE_TTL_MS) return null;
    return parsed.roles || null;
  } catch {
    return null;
  }
}
function writeRolesCache(roles) {
  try {
    localStorage.setItem(
      ROLES_CACHE_KEY,
      JSON.stringify({ cachedAt: Date.now(), roles })
    );
  } catch {}
}

export const UserProvider = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();

  // ---- Users ----
  const [currentUser, setCurrentUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // in-memory badge index: badgeId -> user (first match)
  const badgeIndexRef = useRef(new Map());
  const rebuildBadgeIndex = useCallback((users) => {
    const map = new Map();
    for (const u of users) {
      const badges = u?.badges || u?.badgeMap || u?.badge_ids || {};
      // support object map or array
      if (Array.isArray(badges)) {
        for (const b of badges) if (b) map.set(String(b), u);
      } else if (badges && typeof badges === 'object') {
        for (const [bid, val] of Object.entries(badges)) {
          if (val) map.set(String(bid), u);
        }
      }
    }
    badgeIndexRef.current = map;
  }, []);

  const fetchAllUsers = useCallback(async () => {
    // cache → server fallback
    const colRef = collection(db, 'users');
    try {
      const snap = await getDocsFromCache(colRef);
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllUsers(users);
      rebuildBadgeIndex(users);
    } catch {
      // no cache yet; that's fine
    }
    const live = await getDocsFromServer(colRef);
    const fresh = live.docs.map((d) => ({ id: d.id, ...d.data() }));
    setAllUsers(fresh);
    rebuildBadgeIndex(fresh);
  }, [db, rebuildBadgeIndex]);

  // Resolve by badge quickly; fall back to a 1-read query (cache-first)
  const findUserByBadge = useCallback(
    async (badgeId) => {
      const key = String(badgeId);
      const hit = badgeIndexRef.current.get(key);
      if (hit) return hit;

      const qRef = query(collection(db, 'users'), where(`badges.${key}`, '==', true));
      // cache → server
      try {
        const csnap = await getDocsFromCache(qRef);
        if (!csnap.empty) {
          const d = csnap.docs[0];
          const u = { id: d.id, ...d.data() };
          badgeIndexRef.current.set(key, u);
          return u;
        }
      } catch {}
      const ssnap = await getDocsFromServer(qRef);
      if (!ssnap.empty) {
        const d = ssnap.docs[0];
        const u = { id: d.id, ...d.data() };
        badgeIndexRef.current.set(key, u);
        return u;
      }
      return null;
    },
    [db]
  );

  // ---- Roles ----
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const rolesListenerRef = useRef(null);

  const rolesById = useMemo(() => {
    const m = new Map();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

  const refreshRoles = useCallback(
    async (force = false) => {
      if (!force) {
        const cached = readRolesCache();
        if (cached?.length) {
          setRoles(cached);
          setRolesLoading(false);
        }
      }
      const colRef = collection(db, 'roles');

      try {
        const csnap = await getDocsFromCache(colRef);
        const cachedRoles = csnap.docs.map((d) => ({
          id: d.id,
          permissions: [],
          ...d.data(),
          permissions: Array.isArray(d.data()?.permissions)
            ? d.data().permissions
            : [],
        }));
        if (cachedRoles.length) {
          setRoles(cachedRoles);
          setRolesLoading(false);
        }
      } catch {}

      const ssnap = await getDocsFromServer(colRef);
      const fetched = ssnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
        };
      });
      setRoles(fetched);
      writeRolesCache(fetched);
      setRolesLoading(false);
    },
    [db]
  );

  const startRolesListener = useCallback(() => {
    if (rolesListenerRef.current) return;
    const qRef = query(collection(db, 'roles'));
    rolesListenerRef.current = onSnapshot(qRef, (snap) => {
      const live = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          permissions: Array.isArray(data.permissions) ? data.permissions : [],
        };
      });
      setRoles(live);
      writeRolesCache(live);
    });
  }, [db]);

  const stopRolesListener = useCallback(() => {
    try {
      rolesListenerRef.current?.();
    } finally {
      rolesListenerRef.current = null;
    }
  }, []);

  // ---- Permissions helpers ----
  const currentUserPermissions = useMemo(() => {
    if (!currentUser) return new Set();
    const assigned = currentUser.roles || [];
    const ids = assigned
      .map((r) => (typeof r === 'string' ? r : r.id))
      .filter(Boolean);

    const perms = new Set();
    for (const id of ids) {
      const role = rolesById.get(id);
      (role?.permissions || []).forEach((p) => perms.add(p));
    }
    return perms;
  }, [currentUser, rolesById]);

  const hasRole = useCallback(
    (roleNameOrId) => {
      if (!currentUser) return false;
      const assigned = currentUser.roles || [];
      return assigned.some((r) =>
        typeof r === 'string'
          ? r === roleNameOrId
          : r.id === roleNameOrId || r.name === roleNameOrId
      );
    },
    [currentUser]
  );

  const can = useCallback(
    (permission) => currentUserPermissions.has(permission),
    [currentUserPermissions]
  );

  // ---- Initial load (runs once) ----
  const mountedOnce = useRef(false);
  useEffect(() => {
    if (mountedOnce.current) return;
    mountedOnce.current = true;

    (async () => {
      try {
        const stored = localStorage.getItem('nova-user');

        if (pathname.startsWith('/studios')) {
          // Skip auth enforcement on migration route
          await fetchAllUsers();
          await refreshRoles(false);
        } else if (stored) {
          const parsed = JSON.parse(stored);

          // current user: cache → server, plus live listener for JUST this doc
          const ref = doc(db, 'users', parsed.id);

          try {
            const c = await getDocFromCache(ref);
            if (c.exists()) setCurrentUser({ id: c.id, ...c.data() });
          } catch {}

          const s = await getDocFromServer(ref);
          if (s.exists()) setCurrentUser({ id: s.id, ...s.data() });
          else {
            localStorage.removeItem('nova-user');
if (!DISABLE_AUTO_REDIRECTS) {
  router.replace('/');
  return;
}
// If redirects are disabled, just continue with a null user.
setCurrentUser(null);

            return;
          }

          // live updates (cheap)
          onSnapshot(ref, (snap) => {
            if (snap.exists()) setCurrentUser({ id: snap.id, ...snap.data() });
          });

          // Optional: load whole pool (uses cache after first run)
          await fetchAllUsers();
        } else {
if (!DISABLE_AUTO_REDIRECTS) router.replace('/');
        }

        await refreshRoles(false);
      } finally {
        setLoading(false);
      }
    })();

    const onFocus = () => {
      const cached = readRolesCache();
      if (!cached) refreshRoles(false);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [db, fetchAllUsers, refreshRoles, router, pathname]);

  // ---- Memoize context value ----
  const value = useMemo(
    () => ({
      // user
      currentUser,
      setCurrentUser,
      allUsers,
      setAllUsers,
      loading,
      refreshUsers: fetchAllUsers,

      // fast badge resolver (memory → cache → server)
      findUserByBadge,

      // roles
      roles,
      rolesById,
      rolesLoading,
      refreshRoles,
      startRolesListener,
      stopRolesListener,

      // permissions
      can,
      hasRole,
    }),
    [
      currentUser,
      allUsers,
      loading,
      fetchAllUsers,
      findUserByBadge,
      roles,
      rolesById,
      rolesLoading,
      refreshRoles,
      startRolesListener,
      stopRolesListener,
      can,
      hasRole,
    ]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
};

export const useUser = () => useContext(UserContext);
