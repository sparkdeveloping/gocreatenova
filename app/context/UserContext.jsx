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
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  onSnapshot,
  query,
} from 'firebase/firestore';
import { app } from '../lib/firebase';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';

const UserContext = createContext(null);

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
  const db = getFirestore(app);
  const router = useRouter();
const pathname = usePathname();

  // ---- Users ----
  const [currentUser, setCurrentUser] = useState(null);
  const [allUsers, setAllUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchAllUsers = useCallback(async () => {
    const snap = await getDocs(collection(db, 'users'));
    setAllUsers(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, [db]);

  // ---- Roles ----
  const [roles, setRoles] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const rolesListenerRef = useRef(null);

  const rolesById = useMemo(() => {
    const m = new Map();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

  const refreshRoles = useCallback(async (force = false) => {
    // serve cache first (if allowed)
    if (!force) {
      const cached = readRolesCache();
      if (cached?.length) {
        setRoles(cached);
        setRolesLoading(false);
      }
    }

    const snap = await getDocs(collection(db, 'roles'));
    const fetched = snap.docs.map(d => {
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
  }, [db]);

  const startRolesListener = useCallback(() => {
    if (rolesListenerRef.current) return;
    const qRef = query(collection(db, 'roles'));
    rolesListenerRef.current = onSnapshot(qRef, (snap) => {
      const live = snap.docs.map(d => {
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
      .map(r => (typeof r === 'string' ? r : r.id))
      .filter(Boolean);

    const perms = new Set();
    for (const id of ids) {
      const role = rolesById.get(id);
      (role?.permissions || []).forEach(p => perms.add(p));
    }
    return perms;
  }, [currentUser, rolesById]);

  const hasRole = useCallback(
    (roleNameOrId) => {
      if (!currentUser) return false;
      const assigned = currentUser.roles || [];
      return assigned.some(r =>
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
        if (pathname.startsWith('/dashboard')) {
  // Skip auth enforcement on migration route
  await fetchAllUsers();
  await refreshRoles(false);
} else if (stored) {
  const parsed = JSON.parse(stored);
  const userDoc = await getDoc(doc(db, 'users', parsed.id));

  if (userDoc.exists()) {
    setCurrentUser({ id: userDoc.id, ...userDoc.data() });
    await fetchAllUsers();
  } else {
    localStorage.removeItem('nova-user');
    router.replace('/');
  }
} else {
  router.replace('/');
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
  }, [db, fetchAllUsers, refreshRoles, router]);

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
