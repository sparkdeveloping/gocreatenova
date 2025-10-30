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
  ArrowDown,
  Info,
  Image as ImageIcon,
  MapPin,
  Sparkles,
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
  const kioskId = 'front-desk-1';

  // Greeting / vibe
  const [greeting, setGreeting] = useState('');
  const [phrase, setPhrase] = useState(phrases[Math.floor(Math.random() * phrases.length)]);

  // Scanner buffer
  const [buf, setBuf] = useState('');
  const [lastKeyAt, setLastKeyAt] = useState(0);
  const [isReading, setIsReading] = useState(false);

  // Relink flow state
  const [showRelinkModal, setShowRelinkModal] = useState(false);
  const [pendingBadgeCode, setPendingBadgeCode] = useState('');
  const [pendingScanId, setPendingScanId] = useState(null);
  const [dismissIn, setDismissIn] = useState(20); // ← 20s

  // Self-serve wizard
  const [showWizard, setShowWizard] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [linking, setLinking] = useState(false);
  const [linkDone, setLinkDone] = useState(false);

  // Local fallback users for production if context didn't preload
  const [localUsers, setLocalUsers] = useState([]);

  // Front desk help
  const [helpNotified, setHelpNotified] = useState(false);
  const [helpNotifying, setHelpNotifying] = useState(false);

  useEffect(() => { refreshRoles(false); }, [refreshRoles]);

  useEffect(() => {
    const updateGreeting = () => {
      const hour = new Date().getHours();
      if (hour < 12) setGreeting('Good Morning');
      else if (hour < 18) setGreeting('Good Afternoon');
      else setGreeting('Good Evening');
    };
    updateGreeting();
    const id = setInterval(updateGreeting, 30_000);
    return () => clearInterval(id);
  }, []);

  // Scanner key buffer
  useEffect(() => {
    const onKey = (e) => {
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

  // Idle auto-commit
  useEffect(() => {
    if (!buf || showRelinkModal || showWizard) return;
    const elapsed = Date.now() - lastKeyAt;
    if (buf.length >= 5 && elapsed > 140) {
      commitScan(buf.slice(0, 5)); return;
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

      const fields = ['badge.id', 'badge.badgeNumber'];
      let hit = null;

      for (const field of fields) {
        for (const val of [asString, asNumber]) {
          try {
            const qs = query(usersCol, where(field, '==', val), fsLimit(1));
            const snap = await getDocs(qs);
            if (!snap.empty) { hit = snap.docs[0]; break; }
          } catch (e) { console.warn(`Lookup failed on ${field} == ${val}`, e); }
        }
        if (hit) break;
      }

      if (!hit) {
        const ref = await addDoc(collection(db, 'scans'), {
          badgeCode, matchedUserId: null, user: null, status: 'not_found',
          createdAt: serverTimestamp(), kioskId,
        });
        setPendingScanId(ref.id);
        setPendingBadgeCode(badgeCode);
        openRelinkModal();
        return;
      }

      const data = hit.data() || {};
      const matchedUser = { id: hit.id, name: data.fullName || data.name || '', photoURL: data.photoURL || null };

      await addDoc(collection(db, 'scans'), {
        badgeCode, matchedUserId: hit.id, user: matchedUser, status: 'matched',
        createdAt: serverTimestamp(), kioskId,
      });

      const scanned = { id: hit.id, ...data };
      localStorage.setItem('nova-user', JSON.stringify(scanned));
      setCurrentUser(scanned);
      router.replace('/checkin');
    } catch (err) {
      console.error('Scan lookup error:', err);
      try {
        const ref = await addDoc(collection(db, 'scans'), {
          badgeCode: clamp5(code) || null, matchedUserId: null, user: null,
          status: 'error', errorMessage: String(err?.message || err),
          createdAt: serverTimestamp(), kioskId,
        });
        setPendingScanId(ref.id);
        setPendingBadgeCode(clamp5(code));
      } catch (_) {}
      openRelinkModal();
    }
  };

  // —————————————————————————————————————————————
  // RELINK / WIZARD HELPERS
  // —————————————————————————————————————————————
  function openRelinkModal() {
    setDismissIn(20); // ← reset to 20 when opening
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

  useEffect(() => {
    if (!showRelinkModal || showWizard) return;
    if (dismissIn <= 0) { closeRelinkModal(); return; }
    const id = setTimeout(() => setDismissIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [showRelinkModal, showWizard, dismissIn]);

  const notifyFrontDesk = async () => {
    if (helpNotified || helpNotifying) return;
    setHelpNotifying(true);
    try {
      if (pendingScanId) {
        await updateDoc(doc(db, 'scans', pendingScanId), {
          flowChoice: 'help', flowChosenAt: serverTimestamp(), status: 'relink_help_requested',
        });
      }
      await addDoc(collection(db, 'assistanceRequests'), {
        type: 'badge_relink', kioskId, badgeCode: pendingBadgeCode || null,
        scanId: pendingScanId || null, status: 'open', createdAt: serverTimestamp(),
      });
      setHelpNotified(true);
    } catch (e) {
      console.error('Notify front desk error:', e);
      alert('Could not notify the front desk. Please walk over for assistance.');
    } finally {
      setHelpNotifying(false);
    }
  };

  const ensureUsersLoaded = async () => {
    if (Array.isArray(allUsers) && allUsers.length > 0) return;
    if (localUsers.length > 0) return;
    try {
      const snap = await getDocs(collection(db, 'users'));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setLocalUsers(list);
    } catch (e) {
      console.warn('Fallback user fetch failed', e);
    }
  };

  const openWizard = async () => {
    try {
      if (pendingScanId) {
        await updateDoc(doc(db, 'scans', pendingScanId), {
          flowChoice: 'self_serve', flowChosenAt: serverTimestamp(), status: 'relink_self_selected',
        });
      }
    } catch (e) { console.warn('Could not mark flow choice on scan:', e); }
    await ensureUsersLoaded(); // ← ensure we have users even in prod
    setShowWizard(true);
  };

  const sourceUsers = (allUsers && allUsers.length > 0) ? allUsers : localUsers;

  const allUsersIndexed = useMemo(
    () => (sourceUsers || []).map((u) => ({
      id: u.id,
      name: u.fullName || u.name || '',
      nameNorm: normalize(u.fullName || u.name || ''),
      email: u.email || '',
      emailNorm: normalize(u.email || ''),
      phone: u.phone || u.phoneNumber || '',
      membershipType: u.membershipType || u.membership || '',
      photoURL: u.photoURL || null,
    })),
    [sourceUsers]
  );

  const searchCandidates = async () => {
    const qRaw = (nameQuery || '').trim();
    const q = normalize(qRaw);
    setIsSearching(true);
    try {
      if (!q || q.length < 2) { setResults([]); return; }
      const starts = [], contains = [];
      for (const u of allUsersIndexed) {
        if (!u.nameNorm && !u.emailNorm) continue;
        const nameStarts = u.nameNorm.split(' ').some((w) => w.startsWith(q));
        const emailStarts = u.emailNorm.startsWith(q);
        const nameContains = u.nameNorm.includes(q);
        const emailContains = u.emailNorm.includes(q);
        if (nameStarts || emailStarts) starts.push(u);
        else if (nameContains || emailContains) contains.push(u);
      }
      setResults([...starts, ...contains].slice(0, 20));
    } finally { setIsSearching(false); }
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

      if (pendingScanId) {
        await updateDoc(doc(db, 'scans', pendingScanId), {
          matchedUserId: selectedUser.id,
          user: { id: selectedUser.id, name: selectedUser.name, photoURL: selectedUser.photoURL || null },
          status: 'relinked',
          relinkedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'scans'), {
          badgeCode: pendingBadgeCode,
          matchedUserId: selectedUser.id,
          user: { id: selectedUser.id, name: selectedUser.name, photoURL: selectedUser.photoURL || null },
          status: 'relinked',
          createdAt: serverTimestamp(),
          kioskId,
        });
      }

      const enriched = { ...selectedUser, badge: { id: String(pendingBadgeCode) } };
      localStorage.setItem('nova-user', JSON.stringify(enriched));
      setCurrentUser(enriched);

      setLinkDone(true);
      setTimeout(() => router.replace('/checkin'), 700);
    } catch (e) {
      console.error('Badge link error:', e);
      alert('We hit a snag linking that badge. Please try again or ask the front desk.');
    } finally { setLinking(false); }
  };

  // —————————————————————————————————————————————
  // UI
  // —————————————————————————————————————————————
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
      {/* Main grid centered vertically */}
      <div className="max-w-7xl mx-auto px-6 py-10 min-h-screen flex items-center">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 w-full items-stretch">
          {/* LEFT: Scanner zone */}
          <section className="relative rounded-[2rem] overflow-hidden min-h-[620px] border border-slate-200 bg-gradient-to-b from-white/70 via-sky-50/60 to-white">
            {/* Top content */}
            <div className="px-8 md:px-10 pt-8">
              <h2 className="text-3xl md:text-4xl font-extrabold gradient-text">{greeting}</h2>
              <p className="text-slate-500 mt-1">{phrase}</p>

              <div className="mt-6 max-w-xl">
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Place your badge on the scanner
                </h1>
                <p className="mt-2 text-slate-600">
                  Hold your card steady for a second. You&apos;ll hear a chime and we&apos;ll do the rest.
                </p>
              </div>
            </div>

            {/* Gray scan glyph — aligned under the copy column, not floating center */}
            <div
              className="absolute"
              style={{
                // Align to the same left padding as copy, sit in the middle third vertically
                left: 40, // slightly inset from px-8 padding for balance
                top: '52%',
                transform: 'translateY(-50%)',
              }}
            >
              <motion.div
                animate={{ scale: isReading ? [1, 1.08, 1] : 1, opacity: isReading ? [0.45, 1, 0.45] : 0.35 }}
                transition={{ repeat: isReading ? Infinity : 0, duration: 1.6, ease: 'easeInOut' }}
              >
                <ScanLine className="text-slate-700" style={{ width: 64, height: 64 }} strokeWidth={1.8} />
              </motion.div>
            </div>

            {/* BIG arrow & "Scan here" — inside the panel bottom-left */}
            <div className="absolute z-10 left-7 bottom-6 pointer-events-none">
              <motion.div
                initial={{ y: 0 }}
                animate={{ y: [0, 18, 0] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: 'easeInOut' }}
                className="flex flex-col items-start"
              >
                <div className="rounded-full bg-indigo-600 text-white shadow-lg px-5 py-2 text-base md:text-lg font-semibold mb-2">
                  Scan here
                </div>
                <ArrowDown className="w-16 h-16 md:w-20 md:h-20 text-indigo-600 drop-shadow" strokeWidth={2.4} />
              </motion.div>
            </div>

            {/* Invisible hit-area for dev testing */}
            <button
              onClick={clickToTest}
              aria-label="Test commit scan"
              className="absolute"
              style={{
                left: 16,
                bottom: 8,
                width: 260,
                height: 120,
                background: 'transparent',
              }}
            />
          </section>

          {/* RIGHT: Quick Actions — centered vertically */}
          <aside className="flex flex-col items-stretch justify-center">
            <div className="px-1 text-sm font-semibold tracking-wide text-slate-500 uppercase text-center">
              Quick Actions
            </div>

            <div className="grid grid-cols-2 gap-5 mt-3">
              <DashCard
                title="About"
                subtitle="How it works, safety, studios"
                href="/about"
                icon={<Info className="w-7 h-7 text-blue-600" />}
                accent="from-blue-50 to-white"
                textClass="text-blue-700"
              />
              <DashCard
                title="Gallery"
                subtitle="See projects members made"
                href="/gallery"
                icon={<ImageIcon className="w-7 h-7 text-pink-600" />}
                accent="from-pink-50 to-white"
                textClass="text-pink-700"
              />
              <DashCard
                title="Map"
                subtitle="Find studios & front desk"
                href="/map"
                icon={<MapPin className="w-7 h-7 text-emerald-600" />}
                accent="from-emerald-50 to-white"
                textClass="text-emerald-700"
              />
              <DashCard
                title="What’s New"
                subtitle="Classes, events, announcements"
                href="/discover"
                icon={<Sparkles className="w-7 h-7 text-amber-600" />}
                accent="from-amber-50 to-white"
                textClass="text-amber-700"
              />
            </div>

            <Link
              href="/signup"
              className="group w-full mt-6 rounded-[1.4rem] p-[2px] bg-gradient-to-tr from-blue-600 via-blue-500 to-sky-400 hover:via-blue-600 transition-shadow shadow-xl focus:outline-none focus:ring-4 focus:ring-blue-200"
            >
              <div className="w-full h-16 rounded-[1.25rem] bg-white/85 backdrop-blur grid place-items-center">
                <div className="flex items-center gap-2 font-semibold text-blue-700 group-hover:text-blue-800">
                  <UserPlus className="h-5 w-5" />
                  <span>I’m new to GoCreate</span>
                </div>
              </div>
            </Link>

            <div className="text-xs text-slate-500 text-center mt-3">
              Prefer help? The front desk is happy to assist with anything.
            </div>
          </aside>
        </div>
      </div>

      {/* Bottom-center GoCreate logo */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[20] opacity-95">
        <Image src="/Logo.svg" alt="GoCreate Nova" width={84} height={84} priority />
      </div>

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
              style={{ backgroundColor: '#ffffff', padding: '2.5rem', gap: '1.25rem', boxShadow: '0 8px 30px rgba(0,0,0,0.15)' }}
            >
              <div><AlertCircle className="w-14 h-14" style={{ color: '#f97316' }} /></div>
              <h2 className="text-2xl font-bold text-slate-900">Hey there!</h2>
              <p className="text-base leading-relaxed text-slate-600 max-w-md mx-auto">
                I see you have a membership with us. We’re taking your experience to the next
                level — part of that requires us to <span className="font-semibold">re-link your badge</span> with your
                membership. It’s super easy. I can walk you through it, or you can get help from our front desk. What would you like?
              </p>

              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                <button onClick={openWizard} className="h-12 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition active:scale-[0.99]">
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
              {helpNotified && <div className="text-sm text-slate-600 mt-2">We’ve let the front desk know. Please see someone there.</div>}

              <button onClick={closeRelinkModal} className="mt-3 h-10 px-5 rounded-full bg-slate-900 text-white font-medium hover:opacity-90">
                OK
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Self-serve: Assign Badge Wizard */}
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
                    onKeyDown={(e) => { if (e.key === 'Enter') searchCandidates(); }}
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
                <p className="text-xs text-slate-500 mt-2">Tip: Use full name for best results. If you don’t see yourself, try a different spelling.</p>
              </div>

              {/* Results */}
              <div className="mt-5 space-y-2 max-h-64 overflow-auto pr-1">
                {results.length === 0 && !isSearching && <div className="text-slate-500 text-sm">No results yet — try searching your full name.</div>}
                {results.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className={`w-full text-left p-3 rounded-xl border transition ${selectedUser?.id === u.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}
                  >
                    <div className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={u.photoURL || '/default-avatar.png'} alt={u.name} className="w-10 h-10 rounded-xl object-cover" />
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
                  {linking ? 'Linking…' : selectedUser ? `Link badge to ${selectedUser.name}` : 'Select your membership'}
                </button>
                <button
                  onClick={() => { setShowWizard(false); setShowRelinkModal(true); }}
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

      {/* Animated gradient text CSS */}
      <style jsx global>{`
        .gradient-text {
          background: linear-gradient(90deg, #4f46e5, #22d3ee, #4f46e5);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          background-size: 200% 100%;
          animation: gc-shimmer 3s ease-in-out infinite;
        }
        @keyframes gc-shimmer {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
}

// —————————————————————————————————————————————
// Small card for the mini dashboard grid
// —————————————————————————————————————————————
function DashCard({ title, subtitle, href, icon, accent = 'from-slate-50 to-white', textClass = 'text-slate-700' }) {
  return (
    <Link
      href={href}
      className={`group rounded-2xl border border-slate-200 bg-gradient-to-b ${accent} backdrop-blur hover:bg-white/80 transition-colors shadow-md p-4 focus:outline-none focus:ring-4 focus:ring-blue-100`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm group-hover:shadow">
          {icon}
        </div>
        <div className="min-w-0">
          <div className={`font-semibold ${textClass}`}>{title}</div>
          <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">{subtitle}</div>
        </div>
      </div>
    </Link>
  );
}
