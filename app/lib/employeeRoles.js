'use client';

import { useEffect, useState } from 'react';
import { getFirestore, collection, onSnapshot, query } from 'firebase/firestore';
import { app } from '../lib/firebase';

// Live index of roles marked as employees
export function useEmployeeRoleIndex() {
  const [emp, setEmp] = useState({ ids: new Set(), byId: {} });

  useEffect(() => {
    const db = getFirestore(app);
    const q = query(collection(db, 'roles'));
    const unsub = onSnapshot(q, (snap) => {
      const ids = new Set();
      const byId = {};
      snap.forEach((d) => {
        const r = { id: d.id, ...d.data() };
        if (r.isEmployee) ids.add(d.id);
        byId[d.id] = r;
      });
      setEmp({ ids, byId });
    });
    return () => unsub();
  }, []);

  return emp; // { ids:Set<string>, byId:{ [id]: roleDoc } }
}

// Works when user.roles are strings OR objects {id,name,isEmployee}
export function userIsEmployee(user, empIds) {
  const roles = Array.isArray(user?.roles) ? user.roles : [];
  for (const r of roles) {
    if (typeof r === 'object') {
      if (r.isEmployee) return true;
      if (r.id && empIds.has(r.id)) return true;
    } else if (empIds.has(r)) {
      return true;
    }
  }
  return false;
}
