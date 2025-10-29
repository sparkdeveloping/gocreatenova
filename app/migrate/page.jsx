'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp,
  updateDoc,
  arrayUnion,
} from 'firebase/firestore';
import { app } from '../lib/firebase';
import { Trash2, RefreshCw } from 'lucide-react';

// 🔹 Normalize membership type
function normalizeMembershipType(rawType) {
  const s = (rawType || '').toLowerCase();
  if (s.includes('assistance')) return 'assistance';
  if (s.includes('wsu') && s.includes('student')) return 'student';
  if (s.includes('educator') || s.includes('staff')) return 'educator';
  if (s.includes('corporate')) return 'corporate';
  if (s.includes('public')) return 'public';
  return 'regular';
}

// 🔹 Ensure superadmin role exists
async function ensureSuperadminRole(db) {
  const rolesSnap = await getDocs(collection(db, 'roles'));
  const existing = rolesSnap.docs.find(
    (d) => (d.data().name || '').toLowerCase() === 'superadmin'
  );
  if (existing) return existing.id;

  const ref = doc(collection(db, 'roles'));
  await setDoc(ref, {
    id: ref.id,
    name: 'superadmin',
    permissions: [
      'createMember',
      'editRoles',
      'viewPayments',
      'viewSessions',
      'viewUsers',
      'manageInventory',
      'createReservations',
      'assignCertifications',
    ],
    protected: false,
    isDefault: false,
  });
  return ref.id;
}

export default function MigratePage() {
  const db = getFirestore(app);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);

  const log = (msg) => setLogs((p) => [...p, msg]);

  // 🔹 Parse txt file (clean version)
  const parseText = async (file) => {
    const res = await fetch(file);
    if (!res.ok) throw new Error(`File not found: ${file}`);
    const text = await res.text();
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const records = [];

    for (const line of lines) {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length >= 6) {
        const expiry = parts.pop();
        const created = parts.pop();
        const membershipType = parts.pop();
        const [name, email, phone] = parts;
        records.push({ name, email, phone, membershipType, created, expiry });
      }
    }
    return records;
  };

  // 🔹 Main import function
  const importUsers = async (records, clear = false) => {
    setRunning(true);
    setLogs([]);
    setStatus(clear ? '🧹 Clearing old users…' : '🔄 Updating users…');

    const now = Math.floor(Date.now() / 1000);
    const memberRoleId = 'XTCAvQEpCHBN09plzkrj';
    const memberRole = { id: memberRoleId, name: 'member' };

    // optional cleanup
    if (clear) {
      const usersSnap = await getDocs(collection(db, 'users'));
      for (const d of usersSnap.docs) await deleteDoc(doc(db, 'users', d.id));
      const paySnap = await getDocs(collection(db, 'payments'));
      for (const d of paySnap.docs) await deleteDoc(doc(db, 'payments', d.id));
      log('✅ Cleared existing users and payments');
    }

    setProgress({ done: 0, total: records.length });

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      try {
        const cleanPhone = (r.phone || '').replace(/[^0-9]/g, '');
        const type = normalizeMembershipType(r.membershipType);
        const createdSec = Number(r.created);
        const expirySec = Number(r.expiry);

        const qUser = query(collection(db, 'users'), where('email', '==', r.email));
        const snapUser = await getDocs(qUser);

        let userRef;
        if (snapUser.empty) {
          userRef = doc(collection(db, 'users'));
          await setDoc(userRef, {
            id: userRef.id,
            fullName: r.name,
            email: r.email,
            phone: cleanPhone,
            membershipType: type,
            createdAt: createdSec,
            expiresAt: expirySec,
            importedAt: serverTimestamp(),
            roles: [memberRole],
          });
          log(`🆕 Added ${r.name}`);
        } else {
          userRef = snapUser.docs[0].ref;
          await setDoc(
            userRef,
            {
              fullName: r.name,
              phone: cleanPhone,
              membershipType: type,
              expiresAt: expirySec,
              roles: [memberRole],
            },
            { merge: true }
          );
          log(`🔄 Updated ${r.name}`);
        }

        // update roles/member.users for tracking
        await updateDoc(doc(db, 'roles', memberRoleId), {
          users: arrayUnion({ fullName: r.name, id: userRef.id }),
        });

      } catch (err) {
        log(`❌ ${r.name}: ${err.message}`);
      }
      setProgress({ done: i + 1, total: records.length });
    }

    // 🔹 Ensure superadmin account
    const superRoleId = await ensureSuperadminRole(db);
    const superEmail = 'denzelnyatsanza@gmail.com';
    const qSuper = query(collection(db, 'users'), where('email', '==', superEmail));
    const snapSuper = await getDocs(qSuper);
    if (snapSuper.empty) {
      const ref = doc(collection(db, 'users'));
      await setDoc(ref, {
        id: ref.id,
        fullName: 'Denzel Nyatsanza',
        email: superEmail,
        phone: '3167496125',
        badge: { id: '23143', doorNumber: 'Admin' },
        roles: [{ id: superRoleId, name: 'superadmin' }],
        membershipType: 'admin',
        createdAt: Math.floor(Date.now() / 1000),
      });
      log('🌟 Created Superadmin account + badge 23143');
    } else {
      const ref = snapSuper.docs[0].ref;
      await setDoc(
        ref,
        {
          roles: [{ id: superRoleId, name: 'superadmin' }],
          badge: { id: '23143', doorNumber: 'Admin' },
        },
        { merge: true }
      );
      log('🌟 Updated Superadmin roles/badge for Denzel');
    }

    setStatus('✅ Migration Complete');
    setRunning(false);
  };

  // 🔹 UI
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-100 to-white p-10">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-2xl mx-auto p-8 rounded-[2rem] bg-white/70 backdrop-blur-xl shadow-xl border border-slate-200"
      >
        <h1 className="text-3xl font-bold mb-6 text-center text-slate-800">
          GoCreate Nova Membership Migration
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <motion.button
            disabled={running}
            onClick={async () => {
              const recs = await parseText('/gcms_final.txt');
              await importUsers(recs, true);
            }}
            whileTap={{ scale: 0.97 }}
            className={`rounded-2xl p-6 border border-slate-300 bg-gradient-to-br from-red-50 to-rose-100 text-red-700 shadow-sm hover:shadow-md transition ${
              running && 'opacity-50 cursor-not-allowed'
            }`}
          >
            <Trash2 className="w-6 h-6 mb-2 mx-auto" />
            <h2 className="text-lg font-semibold text-center">Complete Refresh</h2>
            <p className="text-sm text-center text-slate-600">
              Deletes all existing users & payments, then reimports from gcms_final.txt
            </p>
          </motion.button>

          <motion.button
            disabled={running}
            onClick={async () => {
              const recs = await parseText('/gcms_new.txt');
              await importUsers(recs, false);
            }}
            whileTap={{ scale: 0.97 }}
            className={`rounded-2xl p-6 border border-slate-300 bg-gradient-to-br from-blue-50 to-indigo-100 text-blue-700 shadow-sm hover:shadow-md transition ${
              running && 'opacity-50 cursor-not-allowed'
            }`}
          >
            <RefreshCw className="w-6 h-6 mb-2 mx-auto" />
            <h2 className="text-lg font-semibold text-center">Update Refresh</h2>
            <p className="text-sm text-center text-slate-600">
              Updates or adds users based on gcms_new.txt without deleting existing data
            </p>
          </motion.button>
        </div>

        <AnimatePresence>
          {status !== 'idle' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl bg-white/80 border border-slate-200 p-4"
            >
              <p className="font-medium mb-2">{status}</p>
              <div className="h-2 w-full bg-slate-200 rounded-full mb-3">
                <div
                  className="h-2 bg-blue-500 rounded-full transition-all"
                  style={{
                    width: `${(progress.done / progress.total) * 100 || 0}%`,
                  }}
                />
              </div>
              <div className="text-xs text-slate-600 max-h-60 overflow-y-auto font-mono">
                {logs.slice(-100).map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
