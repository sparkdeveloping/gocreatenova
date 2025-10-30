'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ScanLine,
  UserPlus,
  AlertCircle,
  HandHelping,
  Search,
  CheckCircle2,
  ArrowDownLeft,
  Info,
  Image as ImageIcon,
  MapPin,
  Sparkles,
  Clock,
  CalendarDays,
} from 'lucide-react';
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  limit as fsLimit,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';

import { app } from './lib/firebase';
import CornerUtilities from './components/CornerUtilities';
import { useUser } from './context/UserContext';

// —————————————————————————————————————————————
// Helpers
const digitsOnly = (s) => (s.match(/\d+/g)?.join('') ?? '');
const clamp5 = (s) => digitsOnly(s).slice(0, 5);
const normalize = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

const formatTime = (d = new Date()) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDate = (d = new Date()) =>
  d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

const phrases = [
  'Create boldly. Be kind.',
  'Safety first. Curiosity always.',
  'Tiny iterations, massive outcomes.',
  'We cheer for your first draft.',
  'Today’s a great day to make.',
];

// —————————————————————————————————————————————

export default function NovaPublicHome() {
  const db = getFirestore(app);
  const router = useRouter();
  const { refreshRoles, setCurrentUser, allUsers } = useUser();

  // Kiosk identity (stable)
  const kioskId = 'front-desk-1';

  // Greeting / time
  const [greeting, setGreeting] = useState('');
  const [now, setNow] = useState(new Date());
  const [phrase, setPhrase] = useState(phrases[Math.floor(Math.random() * phrases.length)]);

  // Scanner buffer
  const [buf, setBuf] = useState('');
  const [lastKeyAt, setLastKeyAt] = useState(0);
  const [isReading, setIsReading] = useState(false);

  // Relink flow state
  const [showRelinkModal, setShowRelinkModal] = useState(false);
  const [pendingBadgeCode, setPendingBadgeCode] = useState('');
  const [pendingScanId, setPendingScanId] = useState(null); // id of the not_found/error scan
  const [dismissIn, setDismissIn] = useState(7);

  // Self-serve wizard
  const [showWizard, setShowWizard] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [linking, setLinking] = useState(false);
  const [linkDone, setLinkDone] = useState(false);

  // Front desk help
  const [helpNotified, setHelpNotified] = useState(false);
  const [helpNotifying, setHelpNotifying] = useState(false);

  // Preload roles (cheap no-op if cached)
  useEffect(() => {
    refreshRoles(false);
  }, [refreshRoles]);

  // Time / Greeting
  useEffect(() => {
    const updateTime = () => {
      setNow(new Date());
      const hour = new Date().getHours();
      if (hour < 12) setGreeting('Good Morning');
      else if (hour < 18) setGreeting('Good Afternoon');
      else setGreeting('Good Evening');
    };
    updateTime();
    const id = setInterval(updateTime, 30_000);
    return () => clearInterval(id);
  }, []);

  // Global key buffer
  useEffect(() => {
    const onKey = (e) => {
      // pause live scanning while dialogs are active
      if (showRelinkModal || showWizard) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key ?? '';
      if (/\d/.test(k)) {
        setIsReading(true);
        setBuf((prev) => clamp5(prev + k));
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
  }, [buf, showRelinkModal, showWizard]);

  // Idle auto-commit (typical barcode wedge gap)
  useEffect(() => {
    if (!buf || showRelinkModal || showWizard) return;
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
  }, [buf, lastKeyAt, showRelinkModal, showWizard]);

  function resetBuffer() {
    setBuf('');
    setIsReading(false);
    setLastKeyAt(0);
  }

  const playScanSound = () => {
    const audio = new Audio('/scan.mp3');
    audio.volume = 1;
    audio.play().catch(() => {});
  };

  async function commitScan(code) {
    setIsReading(false);
    playScanSound();
    await handleScan(code);
  }

  const clickToTest = async () => {
    if (showRelinkModal || showWizard) return;
    if (buf.length === 5) return commitScan(buf);
  };

  // —————————————————————————————————————————————
  // MAIN SCAN HANDLER
  // —————————————————————————————————————————————
  const handleScan = async (code) => {
    try {
      const badgeCode = clamp5(code);
      if (badgeCode.length !== 5) return;

      const usersCol = collection(db, 'users');
      const asString = String(badgeCode);
      const asNumber = Number(badgeCode);

      // Try multiple fields + types
      const fields = ['badge.id', 'badge.badgeNumber'];
      let hit = null;

      for (const field of fields) {
        for (const val of [asString, asNumber]) {
          try {
            const qs = query(usersCol, where(field, '==', val), fsLimit(1));
            const snap = await getDocs(qs);
            if (!snap.empty) {
              hit = snap.docs[0];
              break;
            }
          } catch (e) {
            console.warn(`Lookup failed on ${field} == ${val}`, e);
          }
        }
        if (hit) break;
      }

      if (!hit) {
        // NO MATCH → record scan, open relink modal
        const ref = await addDoc(collection(db, 'scans'), {
          badgeCode,
          matchedUserId: null,
          user: null,
          status: 'not_found',
          createdAt: serverTimestamp(),
          kioskId,
        });
        setPendingScanId(ref.id);
        setPendingBadgeCode(badgeCode);
        openRelinkModal();
        return;
      }

      // MATCH → record + continue to check-in
      const data = hit.data() || {};
      const matchedUser = {
        id: hit.id,
        name: data.fullName || data.name || '',
        photoURL: data.photoURL || null,
      };

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
      router.replace('/checkin');
    } catch (err) {
      console.error('Scan lookup error:', err);
      try {
        const ref = await addDoc(collection(db, 'scans'), {
          badgeCode: clamp5(code) || null,
          matchedUserId: null,
          user: null,
          status: 'error',
          errorMessage: String(err?.message || err),
          createdAt: serverTimestamp(),
          kioskId,
        });
        setPendingScanId(ref.id);
        setPendingBadgeCode(clamp5(code));
      } catch (_) {}
      // Fall back to relink screen with friendly copy
      openRelinkModal();
    }
  };

  // —————————————————————————————————————————————
  // RELINK MODAL HELPERS & LOGGING
  // —————————————————————————————————————————————
  function openRelinkModal() {
    setDismissIn(7);
    setHelpNotified(false);
    setShowRelinkModal(true);
    resetBuffer();
  }
  function closeRelinkModal() {
    setShowRelinkModal(false);
    setShowWizard(false);
    setSelectedUser(null);
    setResults([]);
    setNameQuery('');
    resetBuffer();
  }

  // Auto-dismiss only if user hasn't engaged
  useEffect(() => {
    if (!showRelinkModal || showWizard) return;
    if (dismissIn <= 0) {
      closeRelinkModal();
      return;
    }
    const id = setTimeout(() => setDismissIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [showRelinkModal, showWizard, dismissIn]);

  // —————————————————————————————————————————————
  // FRONT DESK HELP (logs for Sessions)
  // —————————————————————————————————————————————
  const notifyFrontDesk = async () => {
    if (helpNotified || helpNotifying) return;
    setHelpNotifying(true);
    try {
      // mark the original scan with the choice
      if (pendingScanId) {
        await updateDoc(doc(db, 'scans', pendingScanId), {
          flowChoice: 'help',
          flowChosenAt: serverTimestamp(),
          status: 'relink_help_requested',
        });
      }
      // create an assistance request document
      await addDoc(collection(db, 'assistanceRequests'), {
        type: 'badge_relink',
        kioskId,
        badgeCode: pendingBadgeCode || null,
        scanId: pendingScanId || null,
        status: 'open',
        createdAt: serverTimestamp(),
      });
      setHelpNotified(true);
    } catch (e) {
      console.error('Notify front desk error:', e);
      alert('Could not notify the front desk. Please walk over for assistance.');
    } finally {
      setHelpNotifying(false);
    }
  };

  // —————————————————————————————————————————————
  // SELF-SERVE WIZARD (USES PREFETCHED USERS)
  // —————————————————————————————————————————————
  const openWizard = async () => {
    try {
      if (pendingScanId) {
        await updateDoc(doc(db, 'scans', pendingScanId), {
          flowChoice: 'self_serve',
          flowChosenAt: serverTimestamp(),
          status: 'relink_self_selected',
        });
      }
    } catch (e) {
      console.warn('Could not mark flow choice on scan:', e);
    }
    setShowWizard(true);
  };

  const allUsersIndexed = useMemo(() => {
    // Prepare a lightweight index for fast client search
    return (allUsers || []).map((u) => ({
      id: u.id,
      name: u.fullName || u.name || '',
      nameNorm: normalize(u.fullName || u.name || ''),
      email: u.email || '',
      emailNorm: normalize(u.email || ''),
      phone: u.phone || u.phoneNumber || '',
      membershipType: u.membershipType || u.membership || '',
      photoURL: u.photoURL || null,
    }));
  }, [allUsers]);

  const searchCandidates = async () => {
    const qRaw = (nameQuery || '').trim();
    const q = normalize(qRaw);
    setIsSearching(true);
    try {
      if (!q || q.length < 2) {
        setResults([]);
        return;
      }

      // Match on name/email contains; prefer word-starts
      const starts = [];
      const contains = [];
      for (const u of allUsersIndexed) {
        if (!u.nameNorm && !u.emailNorm) continue;
        const nameStarts = u.nameNorm.split(' ').some((w) => w.startsWith(q));
        const emailStarts = u.emailNorm.startsWith(q);
        const nameContains = u.nameNorm.includes(q);
        const emailContains = u.emailNorm.includes(q);

        if (nameStarts || emailStarts) {
          starts.push(u);
        } else if (nameContains || emailContains) {
          contains.push(u);
        }
      }

      const merged = [...starts, ...contains].slice(0, 20);
      setResults(merged);
    } finally {
      setIsSearching(false);
    }
  };

  const linkBadgeToUser = async () => {
    if (!selectedUser || !pendingBadgeCode) return;
    setLinking(true);
    try {
      const userRef = doc(db, 'users', selectedUser.id);
      await updateDoc(userRef, {
        badge: {
          id: String(pendingBadgeCode),
          badgeNumber: Number(pendingBadgeCode),
          linkedAt: serverTimestamp(),
          kioskId,
        },
      });

      // mark the original not_found/error scan as relinked + who we matched
      if (pendingScanId) {
        await updateDoc(doc(db, 'scans', pendingScanId), {
          matchedUserId: selectedUser.id,
          user: {
            id: selectedUser.id,
            name: selectedUser.name,
            photoURL: selectedUser.photoURL || null,
          },
          status: 'relinked',
          relinkedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'scans'), {
          badgeCode: pendingBadgeCode,
          matchedUserId: selectedUser.id,
          user: {
            id: selectedUser.id,
            name: selectedUser.name,
            photoURL: selectedUser.photoURL || null,
          },
          status: 'relinked',
          createdAt: serverTimestamp(),
          kioskId,
        });
      }

      // Store locally and continue to check-in
      const enriched = { ...selectedUser, badge: { id: String(pendingBadgeCode) } };
      localStorage.setItem('nova-user', JSON.stringify(enriched));
      setCurrentUser(enriched);

      setLinkDone(true);
      setTimeout(() => router.replace('/checkin'), 700);
    } catch (e) {
      console.error('Badge link error:', e);
      alert('We hit a snag linking that badge. Please try again or ask the front desk.');
    } finally {
      setLinking(false);
    }
  };

  // —————————————————————————————————————————————
  // UI
  // —————————————————————————————————————————————
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
      {/* For this page we tuck CornerUtilities into top-right to avoid clutter */}
      <div className="fixed top-3 right-3 z-[30] opacity-90">
        <CornerUtilities />
      </div>

      {/* Top header bar */}
      <div className="pointer-events-none select-none w-full px-6 pt-6">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Image src="/Logo.svg" alt="GoCreate Nova" width={44} height={44} priority />
            <div>
              <div className="text-2xl font-bold">{greeting}</div>
              <div className="text-sm text-slate-500">{phrase}</div>
            </div>
          </div>

          <div className="flex items-center gap-4 text-sm text-slate-600">
            <div className="flex items-center gap-1">
              <CalendarDays className="w-4 h-4" />
              <span>{formatDate(now)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="w-4 h-4" />
              <span>{formatTime(now)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Split layout */}
      <div className="max-w-7xl mx-auto px-6 pb-10 pt-8 md:pt-10">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          {/* LEFT: Scanner zone */}
          <div className="relative rounded-[2rem] border border-slate-200 bg-white/60 backdrop-blur-md shadow-lg overflow-hidden min-h-[520px]">
            {/* Soft gradient wash */}
            <div className="absolute inset-0 bg-gradient-to-br from-sky-50 via-white/60 to-indigo-50 pointer-events-none" />

            {/* Instructional copy */}
            <div className="relative p-8 md:p-10">
              <div className="max-w-md">
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Place your badge on the scanner
                </h1>
                <p className="mt-2 text-slate-600">
                  Hold your card steady for a second. You&apos;ll hear a chime and we&apos;ll do the rest.
                </p>
              </div>
            </div>

            {/* Animated arrow & cue, positioned at 25% screen width */}
            <div className="pointer-events-none absolute left-0 right-0" style={{ bottom: 210 }}>
              <div className="relative w-full">
                {/* We anchor arrow ~25% across the viewport: */}
                <div className="absolute" style={{ left: 'calc(25% - 40px)' }}>
                  <motion.div
                    initial={{ y: 0, rotate: -18 }}
                    animate={{ y: [0, -12, 0] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                    className="flex items-center gap-3"
                  >
                    <ArrowDownLeft className="w-10 h-10 text-blue-600 drop-shadow" strokeWidth={2} />
                    <div className="bg-white/90 backdrop-blur rounded-xl px-3 py-1.5 border border-slate-200 text-sm font-medium shadow">
                      Scan here
                    </div>
                  </motion.div>
                </div>
              </div>
            </div>

            {/* The angled scanner pad */}
            {/*
              Pad is 220x220. Center X should be at 25% of full width → left: calc(25% - 110px)
            */}
            <div
              className="absolute"
              style={{ left: 'calc(25% - 110px)', bottom: 0 }}
            >
              <motion.div
                initial={{ y: 140, opacity: 0.9 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 140, damping: 18 }}
                className="relative"
              >
                <div
                  className="rounded-3xl border border-slate-200 bg-white shadow-2xl"
                  style={{
                    width: 220,
                    height: 220,
                    transform: 'rotate(-12deg) translateY(24px)',
                    transformOrigin: 'center',
                  }}
                >
                  {/* Subtle animated scan line */}
                  <motion.div
                    aria-hidden
                    className="absolute inset-x-6 top-10 h-[3px] rounded-full"
                    animate={{ opacity: [0.2, 0.8, 0.2] }}
                    transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
                    style={{
                      background:
                        'radial-gradient(50% 50% at 50% 50%, rgba(37,99,235,0.6) 0%, rgba(37,99,235,0.0) 100%)',
                    }}
                  />
                  {/* Big scan glyph in center */}
                  <div className="absolute inset-0 grid place-items-center">
                    <motion.div
                      animate={{ scale: isReading ? [1, 1.06, 1] : 1 }}
                      transition={{ repeat: isReading ? Infinity : 0, duration: 1.6, ease: 'easeInOut' }}
                    >
                      <ScanLine className="text-slate-700" style={{ width: 72, height: 72 }} strokeWidth={1.8} />
                    </motion.div>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Live status pill */}
            <div className="absolute left-6 bottom-6">
              <div className="flex items-center gap-2 rounded-full bg-white/90 backdrop-blur px-3 py-1.5 border border-slate-200 shadow">
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    isReading ? 'bg-green-500' : 'bg-slate-300'
                  }`}
                />
                <span className="text-sm font-medium">{isReading ? 'Reading...' : 'Ready'}</span>
                {buf && <span className="text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200">{buf}</span>}
              </div>
            </div>
          </div>

          {/* RIGHT: Mini dashboard */}
          <div className="flex flex-col gap-6">
            {/* Welcome panel */}
            <div className="rounded-[2rem] border border-slate-200 bg-white/60 backdrop-blur-md shadow-lg p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm text-slate-500">{formatDate(now)}</div>
                  <div className="text-2xl font-bold leading-tight">Welcome to GoCreate</div>
                  <div className="text-slate-600 mt-1">
                    Scan to check in — or explore while you&apos;re here.
                  </div>
                </div>
                <div className="hidden md:block">
                  <div className="rounded-2xl px-4 py-2 bg-slate-900 text-white text-sm font-semibold shadow">
                    {formatTime(now)}
                  </div>
                </div>
              </div>
            </div>

            {/* 2x2 quick grid */}
            <div className="grid grid-cols-2 gap-5">
              <DashCard
                title="About"
                subtitle="How it works, safety, studios"
                href="/about"
                icon={<Info className="w-6 h-6" />}
              />
              <DashCard
                title="Gallery"
                subtitle="See projects our members made"
                href="/gallery"
                icon={<ImageIcon className="w-6 h-6" />}
              />
              <DashCard
                title="Map"
                subtitle="Find studios & front desk"
                href="/map"
                icon={<MapPin className="w-6 h-6" />}
              />
              <DashCard
                title="What’s New"
                subtitle="Classes, events, announcements"
                href="/discover"
                icon={<Sparkles className="w-6 h-6" />}
              />
            </div>

            {/* New member CTA */}
            <Link
              href="/signup"
              className="group w-full rounded-[1.4rem] p-[2px] bg-gradient-to-tr from-blue-600 via-blue-500 to-sky-400 hover:via-blue-600 transition-shadow shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-200"
            >
              <div className="w-full h-16 rounded-[1.25rem] bg-white/85 backdrop-blur grid place-items-center">
                <div className="flex items-center gap-2 font-semibold text-blue-700 group-hover:text-blue-800">
                  <UserPlus className="h-5 w-5" />
                  <span>I’m new to GoCreate</span>
                </div>
              </div>
            </Link>

            {/* Tiny helper note */}
            <div className="text-xs text-slate-500 text-center">
              Prefer help? The front desk is happy to assist with anything.
            </div>
          </div>
        </div>
      </div>

      {/* Invisible click tester for dev (click the pad area to commit buffer) */}
      <button
        onClick={clickToTest}
        className="sr-only"
        aria-label="Test commit scan"
      />

      {/* Relink / Assistance modal */}
      <AnimatePresence>
        {showRelinkModal && !showWizard && (
          <motion.div
            key="overlay-relink"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-blue-100/70 backdrop-blur-sm"
          >
            <motion.div
              key="card-relink"
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 8, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="w-full max-w-lg rounded-[2rem] text-center flex flex-col items-center"
              style={{
                backgroundColor: '#ffffff',
                padding: '2.5rem',
                gap: '1.25rem',
                boxShadow: '0 8px 30px rgba(0,0,0,0.15)',
              }}
            >
              <div>
                <AlertCircle className="w-14 h-14" style={{ color: '#f97316' }} />
              </div>

              <h2 className="text-2xl font-bold text-slate-900">Hey there!</h2>
              <p className="text-base leading-relaxed text-slate-600 max-w-md mx-auto">
                I see you have a membership with us. We’re taking your experience to the next level — part of that
                requires us to <span className="font-semibold">re-link your badge</span> with your membership. It’s super
                easy. I can walk you through it, or you can get help from our front desk. What would you like?
              </p>

              {/* Actions */}
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                <button
                  onClick={openWizard}
                  className="h-12 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition active:scale-[0.99]"
                >
                  Guide me
                </button>
                <button
                  onClick={notifyFrontDesk}
                  className="h-12 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 transition active:scale-[0.99] flex items-center justify-center gap-2"
                >
                  <HandHelping className="w-5 h-5 text-slate-500" />
                  {helpNotified ? 'Front desk notified' : helpNotifying ? 'Notifying…' : 'Get help at front desk'}
                </button>
              </div>

              {!helpNotified && <div className="text-xs text-slate-500 mt-2">Auto closing in {dismissIn}s</div>}
              {helpNotified && (
                <div className="text-sm text-slate-600 mt-2">We’ve let the front desk know. Please see someone there.</div>
              )}

              <button
                onClick={closeRelinkModal}
                className="mt-3 h-10 px-5 rounded-full bg-slate-900 text-white font-medium hover:opacity-90"
              >
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Self-serve: Assign Badge Wizard (client-side search via UserContext) */}
      <AnimatePresence>
        {showWizard && (
          <motion.div
            key="overlay-wizard"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-sky-100/60 backdrop-blur-sm"
          >
            <motion.div
              key="card-wizard"
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 8, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="w-full max-w-2xl rounded-[2rem] bg-white p-6 md:p-8 shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-xl md:text-2xl font-bold text-slate-900">Assign badge to your membership</h3>
                  <p className="text-slate-600 mt-1">
                    Type your <span className="font-semibold">first and last name</span>, pick your membership, and we’ll
                    link badge <span className="font-mono">{pendingBadgeCode || '—'}</span>.
                  </p>
                </div>
                {linkDone ? <CheckCircle2 className="w-7 h-7 text-green-600" /> : <Search className="w-7 h-7 text-slate-400" />}
              </div>

              {/* Search input */}
              <div className="mt-5">
                <label className="block text-sm font-medium text-slate-700 mb-1">Search name</label>
                <div className="flex gap-2">
                  <input
                    value={nameQuery}
                    onChange={(e) => setNameQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') searchCandidates();
                    }}
                    placeholder="e.g., Jane Doe"
                    className="flex-1 h-12 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  />
                  <button
                    onClick={searchCandidates}
                    className="h-12 px-5 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 active:scale-[0.99]"
                  >
                    {isSearching ? 'Searching…' : 'Search'}
                  </button>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Tip: Use full name for best results. If you don’t see yourself, try a different spelling.
                </p>
              </div>

              {/* Results (from prefetched users) */}
              <div className="mt-5 space-y-2 max-h-64 overflow-auto pr-1">
                {results.length === 0 && !isSearching && (
                  <div className="text-slate-500 text-sm">No results yet — try searching your full name.</div>
                )}
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left p-3 rounded-xl border transition ${
                      selectedUser?.id === u.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={u.photoURL || '/default-avatar.png'}
                        alt={u.name}
                        className="w-10 h-10 rounded-xl object-cover"
                      />
                      <div className="min-w-0">
                        <div className="font-medium text-slate-900 truncate">{u.name || 'Unnamed'}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {u.email || '—'} · {u.phone || '—'} {u.membershipType ? `· ${u.membershipType}` : ''}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {/* Confirm link */}
              <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <button
                  disabled={!selectedUser || linking}
                  onClick={linkBadgeToUser}
                  className="flex-1 h-12 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {linking
                    ? 'Linking…'
                    : selectedUser
                    ? `Link badge to ${selectedUser.name}`
                    : 'Select your membership'}
                </button>
                <button
                  onClick={() => {
                    setShowWizard(false);
                    setShowRelinkModal(true);
                  }}
                  className="h-12 px-5 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  onClick={closeRelinkModal}
                  className="h-12 px-5 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// —————————————————————————————————————————————
// Small card for the mini dashboard grid
// —————————————————————————————————————————————
function DashCard({ title, subtitle, href, icon }) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-slate-200 bg-white/60 backdrop-blur hover:bg-white/80 transition-colors shadow-md p-4 focus:outline-none focus:ring-4 focus:ring-blue-100"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm group-hover:shadow">
          <div className="text-slate-700">{icon}</div>
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{subtitle}</div>
        </div>
      </div>
    </Link>
  );
}
