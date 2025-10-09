'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanLine, UserPlus, AlertCircle } from 'lucide-react';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  limit,               // ← keep
  addDoc,              // ← NEW
  serverTimestamp,     // ← NEW
} from 'firebase/firestore';

import { app } from './lib/firebase';
import CornerUtilities from './components/CornerUtilities';
import { useUser } from './context/UserContext';

// Helpers
const digitsOnly = (s) => (s.match(/\d+/g)?.join('') ?? '');

export default function NovaPublicHome() {
  // Greeting
  const [greeting, setGreeting] = useState('');

  // Scanner buffer (global listener — no hidden input)
  const [buf, setBuf] = useState('');
  const [lastKeyAt, setLastKeyAt] = useState(0);
  const [isReading, setIsReading] = useState(false);

  // Not-found modal
  const [showBadgeError, setShowBadgeError] = useState(false);
  const [dismissIn, setDismissIn] = useState(7);
  const { refreshRoles, setCurrentUser } = useUser();
  const router = useRouter();
  const db = getFirestore(app);
const kioskId = 'front-desk-1'; // or any stable string that identifies this station

  // Preload roles (cheap no-op if already cached)
  useEffect(() => { refreshRoles(false); }, [refreshRoles]);

  // Time / Greeting
  useEffect(() => {
    const updateTime = () => {
      const hour = new Date().getHours();
      if (hour < 12) setGreeting('Good Morning');
      else if (hour < 18) setGreeting('Good Afternoon');
      else setGreeting('Good Evening');
    };
    updateTime();
    const id = setInterval(updateTime, 60_000);
    return () => clearInterval(id);
  }, []);

  // Global key buffer
  useEffect(() => {
    const onKey = (e) => {
      if (showBadgeError) return; // pause scanner while modal is open
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key ?? '';
      if (/\d/.test(k)) {
        setIsReading(true);
        setBuf((prev) => digitsOnly(prev + k).slice(0, 10));
        setLastKeyAt(Date.now());
      } else if (k === 'Enter') {
        if (buf.length >= 5) {
          e.preventDefault();
          commitScan(buf.slice(0, 5));
        }
      } else if (k === 'Escape') {
        resetBuffer();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buf, showBadgeError]);

  // Idle auto-commit
  useEffect(() => {
    if (!buf || showBadgeError) return;
    const elapsed = Date.now() - lastKeyAt;
    if (buf.length >= 5 && elapsed > 140) {
      commitScan(buf.slice(0, 5));
      return;
    }
    const t = setTimeout(() => {
      const gap = Date.now() - lastKeyAt;
      if (buf.length >= 5 && gap > 200) commitScan(buf.slice(0, 5));
    }, 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buf, lastKeyAt, showBadgeError]);

  function resetBuffer() {
    setBuf('');
    setIsReading(false);
    setLastKeyAt(0);
  }

// replace your current handleScan with this
const handleScan = async (code) => {
  try {
    const badgeCode = digitsOnly(code).slice(0, 5);
    if (badgeCode.length !== 5) return;

    const usersCol = collection(db, 'users');
    const asString = String(badgeCode);
    const asNumber = Number(badgeCode);

    // Try multiple fields + types, first hit wins
    const fields = ['badge.id', 'badge.badgeNumber'];
    let hit = null;

    for (const field of fields) {
      for (const val of [asString, asNumber]) {
        try {
          const qs = query(usersCol, where(field, '==', val), limit(1));
          const snap = await getDocs(qs);
          if (!snap.empty) { hit = snap.docs[0]; break; }
        } catch (e) {
          // ignore and try the next combo
          console.warn(`Lookup failed on ${field} == ${val}`, e);
        }
      }
      if (hit) break;
    }

    if (!hit) {
      // log NOT FOUND scan for /sessions "Last Scan" card
      await addDoc(collection(db, 'scans'), {
        badgeCode,
        matchedUserId: null,
        user: null,
        status: 'not_found',
        createdAt: serverTimestamp(),
        kioskId,
      });

      openBadgeError();
      return;
    }

    // we found a user — embed minimal user data for quick display
    const data = hit.data() || {};
    const matchedUser = {
      id: hit.id,
      name: data.fullName || data.name || '',
      photoURL: data.photoURL || null,
    };

    // log MATCHED scan for /sessions
    await addDoc(collection(db, 'scans'), {
      badgeCode,
      matchedUserId: hit.id,
      user: matchedUser,
      status: 'matched',
      createdAt: serverTimestamp(),
      kioskId,
    });

    const scanned = { id: hit.id, ...data };
    localStorage.setItem('nova-user', JSON.stringify(scanned));
    setCurrentUser(scanned);

    // use replace so the kiosk can't "back" to the scanner
    router.replace('/checkin');
    console.log('Routing to /checkin with', scanned);
  } catch (err) {
    console.error('Scan lookup error:', err);

    // Log as error so /sessions still sees the attempt
    try {
      await addDoc(collection(db, 'scans'), {
        badgeCode: digitsOnly(code).slice(0, 5) || null,
        matchedUserId: null,
        user: null,
        status: 'error',
        errorMessage: String(err?.message || err),
        createdAt: serverTimestamp(),
        kioskId,
      });
    } catch (_) {}

    openBadgeError();
  }
};



  // Sounds
  function playScanSound() {
    const audio = new Audio('/scan.mp3');
    audio.volume = 1;
    audio.play().catch(() => {});
  }

  async function commitScan(code) {
    setIsReading(false);
    playScanSound();
    await handleScan(code);
  }

  const clickToTest = async () => {
    if (showBadgeError) return;
    if (buf.length === 5) return commitScan(buf);
  };

  // Badge error modal helpers
  function openBadgeError() {
    setDismissIn(7);
    setShowBadgeError(true);
    resetBuffer();
  }
  function closeBadgeError() {
    setShowBadgeError(false);
    resetBuffer();
  }

  // Auto-dismiss countdown
  useEffect(() => {
    if (!showBadgeError) return;
    if (dismissIn <= 0) {
      closeBadgeError();
      return;
    }
    const id = setTimeout(() => setDismissIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [showBadgeError, dismissIn]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white flex flex-col items-center justify-center text-slate-900">
      <CornerUtilities />

     {/* Main card */}
<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.8, ease: 'easeOut' }}
  className="relative backdrop-blur-md bg-white/50 border border-slate-200 
             rounded-[2rem] shadow-xl w-[90%] max-w-3xl p-10 flex flex-col items-center"
>
  <Image src="/Logo.svg" alt="GoCreate Nova Logo" width={120} height={120} priority />
        <h1 className="text-2xl md:text-3xl font-bold text-center mt-4">{greeting}</h1>

        {/* Scan headline + icon */}
        <div
          onClick={clickToTest}
          className="flex flex-col items-center gap-4 mt-6 cursor-pointer group select-none"
        >
          <div className="text-lg md:text-xl font-medium text-slate-800 transition">
            Scan your badge to begin
          </div>

          {/* Large scan icon */}
          <div className="relative grid place-items-center mt-2">
            <motion.span
              aria-hidden
              className="absolute rounded-full"
              style={{ width: 150, height: 150 }}
              animate={{
                boxShadow: [
                  '0 0 0 0 rgba(37,99,235,0)',
                  '0 0 0 16px rgba(37,99,235,0.12)', // blue-600 at low alpha
                  '0 0 0 0 rgba(37,99,235,0)',
                ],
              }}
              transition={{ repeat: isReading ? Infinity : 0, duration: 1.7, ease: 'easeInOut' }}
            />
            <motion.div
              animate={{ scale: [1, 1.06, 1] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
              className={isReading ? 'opacity-85' : ''}
            >
              <ScanLine className="block text-slate-700 transition" style={{ width: 96, height: 96 }} strokeWidth={1.8} />
            </motion.div>
          </div>
        </div>

        {/* Divider */}
        <div className="relative w-full max-w-xs mt-8 mb-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center">
            <span className="px-4 bg-white text-slate-400 text-sm font-medium tracking-wide">
              OR
            </span>
          </div>
        </div>

        {/* Join link */}
        <Link
          href="/signup"
          className="flex items-center gap-2 text-lg font-semibold text-blue-600 hover:opacity-90 transition-colors"
        >
          <UserPlus className="h-5 w-5" />
          <span>Join GoCreate</span>
        </Link>
</motion.div>

{/* Not-found modal */}
{/* Not-found modal */}
<AnimatePresence>
  {showBadgeError && (
    <motion.div
      key="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-blue-100/70 backdrop-blur-sm"
    >
      <motion.div
        key="card"
        initial={{ y: 24, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 8, opacity: 0, scale: 0.98 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="w-full max-w-md rounded-[2rem] text-center flex flex-col items-center"
        style={{
          backgroundColor: "#ffffff", // solid white
          padding: "3rem 2.5rem",     // px-10 py-12 equivalent
          gap: "1.5rem",              // even spacing
          boxShadow: "0 8px 30px rgba(0,0,0,0.15)", // deep shadow
        }}
      >
        {/* Icon */}
        <div>
          <AlertCircle className="w-14 h-14" style={{ color: "#f97316" }} /> 
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-slate-900">
          Please See the Front Desk
        </h2>

        {/* Description */}
        <p className="text-base leading-relaxed text-slate-600 max-w-sm mx-auto">
          We couldn’t find that badge in our system. A team member can get you set up right away.
        </p>

        {/* Countdown */}
        <div
          style={{
            fontSize: "0.95rem",
            color: "#374151", // slate-700
            fontWeight: 500,
          }}
        >
          Auto closing in {dismissIn}s
        </div>

        {/* Button */}
        <button
          onClick={closeBadgeError}
          style={{
            width: "100%",
            height: "3rem",
            borderRadius: "9999px",
            backgroundColor: "#2563eb", // solid blue
            color: "#fff",
            fontSize: "1rem",
            fontWeight: 600,
            marginTop: "0.5rem",
            boxShadow: "0 4px 10px rgba(0,0,0,0.2)",
            transition: "background-color 0.2s ease, transform 0.15s ease",
          }}
          onMouseOver={(e) => (e.currentTarget.style.backgroundColor = "#1d4ed8")}
          onMouseOut={(e) => (e.currentTarget.style.backgroundColor = "#2563eb")}
        >
          OK
        </button>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>


    </div>
  );
}
