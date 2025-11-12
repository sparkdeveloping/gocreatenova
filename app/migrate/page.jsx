'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { app, rtdb } from '../lib/firebase';
import { Trash2, RefreshCw } from 'lucide-react';
import { ref as rRef, set as rSet } from 'firebase/database';
import { updateLocalBadgeIndex } from '../lib/badgeLookup';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (normalize + safety)
// ─────────────────────────────────────────────────────────────────────────────
function normalizeMembershipType(rawType) {
  const s = (rawType || '').toLowerCase();
  if (s.includes('assistance')) return 'assistance';
  if (s.includes('wsu') && s.includes('student')) return 'student';
  if (s.includes('educator') || s.includes('staff')) return 'educator';
  if (s.includes('corporate')) return 'corporate';
  if (s.includes('public')) return 'public';
  return 'regular';
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cleanPhone(p) {
  return (p || '').replace(/[^0-9]/g, '');
}

// Ensure a role exists (by name). Returns roleId.
async function ensureRoleByName(db, name, permissions = [], extras = {}) {
  const snap = await getDocs(collection(db, 'roles'));
  const existing = snap.docs.find(
    (d) => (d.data().name || '').toLowerCase() === String(name).toLowerCase()
  );
  if (existing) return existing.id;

  const ref = doc(collection(db, 'roles'));
  await setDoc(ref, {
    id: ref.id,
    name,
    permissions: Array.isArray(permissions) ? permissions : [],
    protected: !!extras.protected,
    isDefault: !!extras.isDefault,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// TXT parser (same contract as yours, slightly safer)
// Each line: name,email,phone,membershipType,created,expiry
// ─────────────────────────────────────────────────────────────────────────────
async function parseText(file) {
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
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function MigratePage() {
  const db = getFirestore(app);
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);

  const log = (msg) => setLogs((p) => [...p, msg]);

  // Core import (clear = destructive refresh)
  const importUsers = async (records, clear = false) => {
    setRunning(true);
    setLogs([]);
    setStatus(clear ? '🧹 Clearing old users…' : '🔄 Updating users…');

    // Ensure baseline roles
    const memberRoleId = await ensureRoleByName(db, 'member', [
      // Reasonable base permissions for members (read-only app actions)
      'viewSelf',
      'checkin',
      'viewClasses',
      'createReservations',
      'checkoutTools',
    ], { isDefault: true });

    // Optional destructive cleanup
    if (clear) {
      const usersSnap = await getDocs(collection(db, 'users'));
      for (const d of usersSnap.docs) {
        await deleteDoc(doc(db, 'users', d.id));
      }
      const paySnap = await getDocs(collection(db, 'payments'));
      for (const d of paySnap.docs) {
        await deleteDoc(doc(db, 'payments', d.id));
      }
      log('✅ Cleared existing users and payments');
    }

    setProgress({ done: 0, total: records.length });

    // Per user: 1 read (lookup by email) + 1 write (create/merge)
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      try {
        const email = (r.email || '').toLowerCase();
        if (!email) {
          log(`⚠️ Skipped (missing email): ${r.name || '(no name)'}`);
          setProgress({ done: i + 1, total: records.length });
          continue;
        }

        const type = normalizeMembershipType(r.membershipType);
        const createdSec = numOrNull(r.created);
        const expirySec = numOrNull(r.expiry);
        const phone = cleanPhone(r.phone);

        // 1 read — find existing by email
        const qUser = query(collection(db, 'users'), where('email', '==', email));
        const snapUser = await getDocs(qUser);

        // Build user payload – align with live app expectations
        const baseUser = {
          fullName: r.name || '',
          email,
          phone,
          membershipType: type,
          // roles as IDs (app tolerates strings or objects; we prefer IDs)
          roles: [memberRoleId],
          // Preferred field used by getMembershipStatus()
          activeSubscription: expirySec
            ? {
                name: 'Member',
                planId: type,
                cycle: 'monthly',
                expiresAt: expirySec, // number (unix seconds) is OK
              }
            : null,
          // Legacy compatibility (also read by getMembershipStatus as fallback)
          membershipExpiresAt: expirySec || null,
          // Preserve original import timestamps if provided; also mark importedAt
          createdAt: createdSec || null,
          importedAt: serverTimestamp(),
        };

        if (snapUser.empty) {
          const userRef = doc(collection(db, 'users'));
          await setDoc(userRef, { id: userRef.id, ...baseUser });
          log(`🆕 Added ${baseUser.fullName || email}`);
        } else {
          const userRef = snapUser.docs[0].ref;
          await setDoc(userRef, baseUser, { merge: true });
          log(`🔄 Updated ${baseUser.fullName || email}`);
        }
      } catch (err) {
        log(`❌ ${r.name || r.email || '(unknown)'}: ${err.message}`);
      }
      setProgress({ done: i + 1, total: records.length });
    }

    // Ensure superadmin role + account (with badge and index sync)
    try {
      const superRoleId = await ensureRoleByName(db, 'superadmin', [
        'createMember',
        'editRoles',
        'viewPayments',
        'viewSessions',
        'viewUsers',
        'manageInventory',
        'createReservations',
        'assignCertifications',
        'checkin',
      ], { protected: true });

      const superEmail = 'denzelnyatsanza@gmail.com';
      const qSuper = query(collection(db, 'users'), where('email', '==', superEmail));
      const snapSuper = await getDocs(qSuper);

      const superBadge = { id: '23143', badgeNumber: 23143, doorNumber: 'Admin' };
      const superBase = {
        fullName: 'Denzel Nyatsanza',
        email: superEmail,
        phone: '3167496125',
        roles: [superRoleId],
        membershipType: 'admin',
        activeSubscription: {
          name: 'Admin',
          planId: 'admin',
          cycle: 'monthly',
          // keep it effectively "non-blocking" (one year from now)
          expiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
        },
        membershipExpiresAt: Math.floor(Date.now() / 1000) + 365 * 24 * 3600,
        badge: superBadge,
        importedAt: serverTimestamp(),
      };

      let superId;
      if (snapSuper.empty) {
        const ref = doc(collection(db, 'users'));
        await setDoc(ref, { id: ref.id, ...superBase });
        superId = ref.id;
        log('🌟 Created Superadmin account + badge 23143');
      } else {
        const ref = snapSuper.docs[0].ref;
        await setDoc(ref, superBase, { merge: true });
        superId = snapSuper.docs[0].id;
        log('🌟 Updated Superadmin roles/badge for Denzel');
      }

      // Keep badge index hot (RTDB + local in-memory/LS index)
      try {
        await rSet(rRef(rtdb, `badgeIndex/${superBadge.id}`), superId);
      } catch (e) {
        log(`⚠️ RTDB badge index write failed (superadmin): ${e.message}`);
      }
      try {
        updateLocalBadgeIndex(superId, superBadge.id);
      } catch (e) {
        // local index best-effort
      }
    } catch (e) {
      log(`❌ Superadmin ensure failed: ${e.message}`);
    }

    setStatus('✅ Migration Complete');
    setRunning(false);
  };

  // UI
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
                {logs.slice(-200).map((l, i) => (
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
