'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarCheck, User, Users, CheckCircle2, LayoutDashboard } from 'lucide-react';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
  updateDoc,
  doc,
} from 'firebase/firestore';
import { app } from '../lib/firebase';
import Shell from '../components/Shell';
import { useUser } from '../context/UserContext';

const db = getFirestore(app);

export default function CheckInPage() {
  const [isEmployee, setIsEmployee] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [showNextActions, setShowNextActions] = useState(false);
  const [nextCountdown, setNextCountdown] = useState(14);
  const [lastSessionType, setLastSessionType] = useState(null); // 'ClockIn' | 'CheckIn' | null
  const autoStartedRef = useRef(false); // prevent double-creation race
  const router = useRouter();

  const { currentUser: member, loading } = useUser();

  // Timer for the "what's next" card
  useEffect(() => {
    if (!showNextActions) return;
    setNextCountdown(14);
    const id = setInterval(() => {
      setNextCountdown((s) => {
        if (s <= 1) {
          clearInterval(id);
          router.push('/');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [showNextActions, router]);

  // Determine if user is an employee (uses role summary isEmployee flag) and resume any open session
  useEffect(() => {
    if (loading || !member) return;

    const rolesArr = Array.isArray(member.roles) ? member.roles : [];
    const employeeFlag = rolesArr.some((r) =>
      typeof r === 'object'
        ? !!r.isEmployee
        : false // string roles won't be treated as employee unless summaries are normalized
    );

    setIsEmployee(employeeFlag);

    // Check if there's already an open session
    (async () => {
      const qRef = query(
        collection(db, 'sessions'),
        where('member.id', '==', member.id || member?.docId),
        where('endTime', '==', null)
      );
      const snapshot = await getDocs(qRef);
      if (!snapshot.empty) {
        const s = snapshot.docs[0]?.data();
        setCurrentSessionId(snapshot.docs[0].id);
        setLastSessionType(s?.type || null);
        setShowNextActions(true);
      }
    })();
  }, [loading, member]);

  // Start a session helper
  const startSession = async (type /* 'CheckIn' | 'ClockIn' */) => {
    if (!member) return;
    const memberWithId = { ...member, id: member.id || member?.docId };
    const sessionRef = await addDoc(collection(db, 'sessions'), {
      member: memberWithId,
      startTime: serverTimestamp(),
      endTime: null,
      type,
    });
    setCurrentSessionId(sessionRef.id);
    setLastSessionType(type);
    setShowNextActions(true);
  };

  // Auto-start for NON-EMPLOYEES: immediately create a CheckIn and show card.
  useEffect(() => {
    if (loading) return;
    if (!member) return;
    if (isEmployee) return; // employees must choose Clock In vs Check In
    if (showNextActions) return; // already on card (e.g., resumed open session)
    if (autoStartedRef.current) return;

    autoStartedRef.current = true;
    startSession('CheckIn');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, member, isEmployee, showNextActions]);

  // End the current session, then go home
  const checkOutNow = async () => {
    try {
      let activeId = currentSessionId;

      if (!activeId && (member?.id || member?.docId)) {
        const qRef = query(
          collection(db, 'sessions'),
          where('member.id', '==', member.id || member?.docId),
          where('endTime', '==', null)
        );
        const snap = await getDocs(qRef);
        if (!snap.empty) activeId = snap.docs[0].id;
      }

      if (!activeId) {
        router.push('/');
        return;
      }

      await updateDoc(doc(db, 'sessions', activeId), { endTime: serverTimestamp() });
      setCurrentSessionId(null);
      setShowNextActions(false);
      router.push('/');
    } catch (e) {
      console.error('Checkout failed:', e);
      router.push('/');
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center items-center min-h-screen text-sm text-slate-500">
          Loading...
        </div>
      </Shell>
    );
  }

  if (!member) {
    return (
      <Shell>
        <div className="flex justify-center items-center min-h-screen text-red-500 text-sm">
          No valid member found. Please scan again.
        </div>
      </Shell>
    );
  }

  const displayName = member.fullName || member.name || 'Member';

  return (
    <Shell>
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white flex items-center justify-center text-slate-900">
        {isEmployee && !showNextActions && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="relative z-10 backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl w-[90%] max-w-3xl p-10 space-y-6"
          >
            <div className="space-y-6 flex flex-col items-center">
              <div className="w-[96px] h-[96px] rounded-full overflow-hidden border border-slate-300 shadow-md grid place-items-center bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
                <User className="w-10 h-10" />
              </div>
              <h2 className="text-3xl font-bold text-center">Welcome, {displayName}</h2>
              <p className="text-sm text-slate-600 text-center max-w-sm">
                Are you starting a shift or just visiting?
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-md">
                {/* Clock In + Check In buttons unchanged */}
              </div>
            </div>
          </motion.div>
        )}

        {/* WHAT'S-NEXT CARD: shows for everyone once a session exists */}
        <AnimatePresence>
          {showNextActions && (
            <motion.div
              key="next-actions-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center bg-transparent"
            >
              <motion.div
                initial={{ y: 24, opacity: 0, scale: 0.98 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 12, opacity: 0, scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                className="w-[min(92vw,40rem)] rounded-[2rem] bg-white/85 backdrop-blur-xl border border-white/40 shadow-2xl p-7"
              >
                {/* header */}
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-700 grid place-items-center mx-auto mb-3 shadow-sm">
                    <CalendarCheck className="w-8 h-8" />
                  </div>
                  <h3 className="text-2xl font-bold">
                    Hi {member?.fullName || member?.name || 'there'}, you’re{' '}
                    {lastSessionType === 'ClockIn' ? 'clocked in' : 'checked in'}!
                  </h3>
                  <p className="text-slate-600 mt-1">
                    What would you like to do next?
                   <span className="ml-2 text-sm font-medium text-slate-600">
  Auto closing in {nextCountdown}s
</span>

                  </p>
                </div>

                {/* actions grid — Clock Out is now a tile; "Nope, that's all" is now the bottom tile */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-7">
                  {/* Dashboard */}
                 {/* Dashboard — FULL WIDTH */}
<button
  onClick={() => router.push('/dashboard')}
  className="group sm:col-span-2 rounded-[1.35rem] p-[2px] bg-gradient-to-tr from-slate-900/20 via-blue-500/30 to-sky-400/30 shadow-sm"
>
  <div className="rounded-[1.15rem] bg-white/75 backdrop-blur-xl border border-white/40 hover:bg-white/85 transition p-5 text-left flex items-center gap-4">
    <div className="rounded-2xl bg-slate-900 text-white/95 w-12 h-12 grid place-items-center shadow">
      <LayoutDashboard className="w-6 h-6" />
    </div>
    <div>
      <div className="font-semibold text-base md:text-lg">Go to Dashboard</div>
      <div className="text-sm text-slate-500">Everything you can do next</div>
    </div>
  </div>
</button>


                  {/* Add Guests (hide for ClockIn) */}
                  {lastSessionType !== 'ClockIn' && (
                    <button
                      onClick={() => router.push('/dashboard?pane=guests')}
                      className="group rounded-[1.35rem] p-[2px] bg-gradient-to-tr from-emerald-500/25 via-teal-400/25 to-green-500/25 shadow-sm"
                    >
                      <div className="rounded-[1.15rem] bg-white/75 backdrop-blur-xl border border-white/40 hover:bg-white/85 transition p-5 text-left flex items-center gap-4">
                        <div className="rounded-2xl bg-emerald-600 text-white w-12 h-12 grid place-items-center shadow">
                          <Users className="w-6 h-6" />
                        </div>
                        <div>
                          <div className="font-semibold text-base md:text-lg">Add Guests</div>
                          <div className="text-sm text-slate-500">Include friends on your visit</div>
                        </div>
                      </div>
                    </button>
                  )}

                  {/* Clock Out / Check Out (MOVED INTO GRID) */}
                  <button
                    onClick={checkOutNow}
                    className="group rounded-[1.35rem] p-[2px] bg-gradient-to-tr from-rose-600/35 via-rose-500/25 to-pink-500/25 shadow-sm"
                  >
                    <div className="rounded-[1.15rem] bg-white/70 backdrop-blur-xl border border-white/40 hover:bg-white/90 transition p-5 text-left flex items-center gap-4">
                      <div className="rounded-2xl bg-rose-600 text-white w-12 h-12 grid place-items-center shadow">
                        <CalendarCheck className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-semibold text-base md:text-lg">
                          {lastSessionType === 'ClockIn' ? 'Clock Out' : 'Check Out'}
                        </div>
                        <div className="text-sm text-rose-600">
                          {lastSessionType === 'ClockIn' ? 'End your shift' : 'End your visit'}
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Nope, that's all (REPLACES "That's everything" + moved to end) */}
<button
  onClick={() => router.push('/')}
  className="group sm:col-span-2 rounded-[1.35rem] p-[2px] bg-gradient-to-tr from-slate-400/25 via-slate-300/25 to-slate-500/25 shadow-sm"
>
  <div className="rounded-[1.15rem] bg-white/75 backdrop-blur-xl border border-white/40 hover:bg-white/85 transition p-5 text-left flex items-center gap-4">
    <div className="rounded-2xl bg-slate-200 text-slate-800 w-12 h-12 grid place-items-center shadow">
      <CheckCircle2 className="w-6 h-6" />
    </div>
    <div>
      <div className="font-semibold text-base md:text-lg">Nope, that’s all</div>
      <div className="text-sm text-slate-500">Return to home</div>
    </div>
  </div>
</button>

                </div>

                {/* Close button removed completely */}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Shell>
  );
}

