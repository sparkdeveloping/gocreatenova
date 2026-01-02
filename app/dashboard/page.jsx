'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import Link from 'next/link';
import {
  Wrench,
  ShoppingBag,
  GraduationCap,
  BookOpen,
  CalendarCheck,
  BadgeCheck,
  Gavel,
  AlertTriangle,
  Clock,
  Users,
  BarChartBig,
  Wallet,
  Hammer,
  ShieldCheck,
  LogOut,
  ChevronLeft,
  Search,
  Sparkles,
  Image as ImageIcon,
  Shield,
  CheckCircle2,
} from 'lucide-react';

import {
  getFirestore,
  updateDoc,
  doc,
  query,
  where,
  collection,
  getDocs,
  serverTimestamp,
  onSnapshot,
  orderBy,
} from 'firebase/firestore';

import { app } from '../lib/firebase';
import CornerUtilities from '../components/CornerUtilities';

const db = getFirestore(app);

const STUDIOS = 'studios';
const LS_DASH_STUDIOS = 'nova:dash:studios-cache:v1';

// -----------------------------------------------------------------------------
// superadmin detection (edit this to match your user shape)
// -----------------------------------------------------------------------------
function isSuperAdmin(member) {
  if (!member) return false;
  // common shapes:
  // member.role === 'superadmin'
  // member.roles = ['superadmin', ...]
  // member.roles = { superadmin: true }
  // member.isSuperAdmin === true
  if (member.isSuperAdmin === true) return true;
  if (typeof member.role === 'string' && member.role.toLowerCase() === 'superadmin') return true;

  if (Array.isArray(member.roles) && member.roles.map((r) => String(r).toLowerCase()).includes('superadmin')) {
    return true;
  }
  if (member.roles && typeof member.roles === 'object' && member.roles.superadmin) return true;

  return true;
}

// -----------------------------------------------------------------------------
// /studios-like admin view (reused vibe, lighter than full studios page)
// -----------------------------------------------------------------------------
function AdminStudiosView({ onBackToMember }) {
  const [studios, setStudios] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  // seed cache
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_DASH_STUDIOS) || '[]');
      if (Array.isArray(cached) && cached.length) setStudios(cached);
    } catch {}
  }, []);

  // live studios
  useEffect(() => {
    const q = query(collection(db, STUDIOS), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStudios(list);
      try { localStorage.setItem(LS_DASH_STUDIOS, JSON.stringify(list)); } catch {}
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    if (!q) return studios;
    return studios.filter(
      (s) =>
        s.name?.toLowerCase().includes(q) ||
        s.description?.toLowerCase().includes(q)
    );
  }, [studios, search]);

  const anySelected = !!selected;

  return (
    <div className="relative">
      {/* header row */}
      <div className="flex flex-wrap items-center gap-3 justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={onBackToMember}
            className="rounded-full px-4 h-10 grid place-items-center bg-white/70 backdrop-blur border border-slate-200 hover:bg-white shadow-sm"
            aria-label="Back to member dashboard"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">
              Superadmin
            </h2>
            <p className="text-slate-600 mt-1">Studios overview (admin view).</p>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            placeholder="Search studios…"
            className="h-11 pl-9 pr-3 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur focus:outline-none focus:ring-4 focus:ring-blue-100"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <LayoutGroup>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {filtered.map((s) => {
            const isSelected = selected?.id === s.id;
            const hideThis = anySelected && !isSelected;
            return (
              <div key={s.id} className={hideThis ? 'hidden' : ''}>
                <StudioCard studio={s} isSelected={isSelected} onOpen={() => setSelected(s)} />
              </div>
            );
          })}
        </div>

        <AnimatePresence>
          {selected && (
            <StudioPeek
              key={`peek-${selected.id}`}
              studio={selected}
              onClose={() => setSelected(null)}
            />
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}

function StudioCard({ studio, onOpen, isSelected }) {
  const coverSrc = studio.coverData || studio.coverUrl || '/placeholder.png';
  return (
    <motion.button
      layout
      layoutId={`dash-studio-${studio.id}`}
      onClick={onOpen}
      className={`group relative text-left rounded-[1.6rem] overflow-hidden border border-slate-200 bg-white/70 backdrop-blur hover:bg-white/85 transition shadow-xl ${
        isSelected ? 'ring-2 ring-sky-400' : ''
      }`}
    >
      <div className="relative h-48">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={coverSrc} alt={studio.name} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/10 to-transparent" />
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-sky-600" />
          <h3 className="font-semibold text-lg">{studio.name}</h3>
        </div>
        <p className="text-sm text-slate-600 mt-1">
          {(studio.description || '').length > 110 ? `${studio.description.slice(0, 110)}…` : (studio.description || '')}
        </p>
      </div>
    </motion.button>
  );
}

function StudioPeek({ studio, onClose }) {
  const coverSrc = studio.coverData || studio.coverUrl || '/placeholder.png';
  return (
    <motion.div layout className="mt-6">
      <motion.div
        layout
        layoutId={`dash-studio-${studio.id}`}
        className="rounded-[2rem] overflow-hidden border border-slate-200 bg-white/85 backdrop-blur-xl shadow-2xl"
      >
        <div className="relative h-64 w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coverSrc} alt={studio.name} className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/15 to-transparent" />
          <div className="absolute top-4 left-4 flex gap-2">
            <button
              onClick={onClose}
              className="px-3 h-10 rounded-full bg-white/85 border border-white/50 text-slate-800 font-medium hover:bg-white"
            >
              <span className="inline-flex items-center gap-1">
                <ChevronLeft className="w-4 h-4" /> Back
              </span>
            </button>
            <Link
              href="/studios"
              className="px-3 h-10 rounded-full bg-white/85 border border-white/50 text-slate-800 font-medium hover:bg-white inline-flex items-center gap-2"
            >
              <ImageIcon className="w-4 h-4" />
              Open Studios
            </Link>
          </div>
          <div className="absolute bottom-4 left-4 text-white drop-shadow">
            <h2 className="text-2xl md:text-3xl font-bold">{studio.name}</h2>
            <p className="opacity-90 max-w-2xl">
              {(studio.description || '').length > 220 ? `${studio.description.slice(0, 220)}…` : (studio.description || '—')}
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <QuickLink title="Studios" desc="Manage and explore studios" href="/studios" icon={ImageIcon} />
            <QuickLink title="Map" desc="Front desk and rooms" href="/map" icon={MapPin} />
            <QuickLink title="Announcements" desc="Events and classes" href="/discover" icon={Sparkles} />
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function QuickLink({ title, desc, href, icon: Icon }) {
  return (
    <Link
      href={href}
      className="rounded-[1.6rem] border border-slate-200 bg-white/70 backdrop-blur p-4 hover:bg-white transition shadow-sm focus:outline-none focus:ring-4 focus:ring-blue-100"
    >
      <div className="flex items-center gap-2">
        <Icon className="w-5 h-5 text-slate-700" />
        <div className="font-semibold text-slate-900">{title}</div>
      </div>
      <div className="text-sm text-slate-600 mt-1">{desc}</div>
    </Link>
  );
}

// -----------------------------------------------------------------------------
// Main page
// -----------------------------------------------------------------------------
export default function DashboardPage() {
  const [member, setMember] = useState(null);
  const [sessionType, setSessionType] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [goodbyeCountdown, setGoodbyeCountdown] = useState(5);
  const [showGoodbye, setShowGoodbye] = useState(false);

  // view toggle (member vs admin)
  const [view, setView] = useState('member'); // 'member' | 'admin'

  const router = useRouter();

  const superAdmin = useMemo(() => isSuperAdmin(member), [member]);

  useEffect(() => {
    // If user is not superadmin, force member view
    if (!superAdmin) setView('member');
  }, [superAdmin]);

  useEffect(() => {
    const stored = localStorage.getItem('nova-user');
    if (!stored) {
      // If no member, go to home or checkin; pushing to /dashboard loops.
      router.push('/');
      return;
    }
    const parsed = JSON.parse(stored);
    setMember(parsed);

    const checkActiveSession = async () => {
      const q = query(
        collection(db, 'sessions'),
        where('member.id', '==', parsed.id),
        where('endTime', '==', null)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const session = snapshot.docs[0];
        setCurrentSessionId(session.id);
        setSessionType(session.data().type);
      } else {
        router.push('/checkin');
      }
    };

    checkActiveSession();
  }, [router]);

  useEffect(() => {
    if (showGoodbye) {
      const interval = setInterval(() => {
        setGoodbyeCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showGoodbye]);

  useEffect(() => {
    if (goodbyeCountdown === 0) {
      router.push('/');
    }
  }, [goodbyeCountdown, router]);

  const handleSignOut = async () => {
    try {
      if (currentSessionId) {
        const sessionDocRef = doc(db, 'sessions', currentSessionId);
        await updateDoc(sessionDocRef, { endTime: serverTimestamp() });
      }
      setShowGoodbye(true);
    } catch (err) {
      console.error('Error signing out:', err);
      alert('Error recording sign out. Please try again.');
    }
  };

  const options = [
    { icon: Wrench, label: 'tools', path: '/tools', tintClass: 'text-blue-500', hoverClass: 'hover:bg-blue-500' },
    { icon: ShoppingBag, label: 'materials', path: '/materials', tintClass: 'text-blue-500', hoverClass: 'hover:bg-blue-500' },
    { icon: GraduationCap, label: 'certifications', path: '/certifications', tintClass: 'text-yellow-500', hoverClass: 'hover:bg-yellow-500' },
    { icon: BookOpen, label: 'courses', path: '/courses', tintClass: 'text-yellow-500', hoverClass: 'hover:bg-yellow-500' },
    { icon: CalendarCheck, label: 'reservations', path: '/reservations', tintClass: 'text-teal-500', hoverClass: 'hover:bg-teal-500' },
    { icon: BadgeCheck, label: 'about', path: '/about', tintClass: 'text-teal-500', hoverClass: 'hover:bg-teal-500' },
    { icon: Gavel, label: 'bids', path: '/bids', tintClass: 'text-rose-500', hoverClass: 'hover:bg-rose-500' },
    { icon: AlertTriangle, label: 'issues', path: '/issues', tintClass: 'text-rose-500', hoverClass: 'hover:bg-rose-500' },
    { icon: Clock, label: 'sessions', path: '/sessions', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: Users, label: 'users', path: '/users', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: BarChartBig, label: 'analytics', path: '/analytics', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: Wallet, label: 'payments', path: '/payments', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: Hammer, label: 'maintenance', path: '/maintenance', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: ShieldCheck, label: 'roles', path: '/roles', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white flex items-center justify-center text-slate-900">
      <CornerUtilities />
      <BokehBackground />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="relative z-10 backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl w-[92%] max-w-5xl p-8 md:p-10"
      >
        {!showGoodbye ? (
          <>
            {/* Top row: profile + superadmin toggle */}
            <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-[1rem] overflow-hidden border border-slate-300 shadow-sm">
                  <Image
                    src={member?.profileImageUrl || '/default-avatar.png'}
                    alt="Profile"
                    width={64}
                    height={64}
                    className="object-cover"
                  />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900">
                    Hey, {member?.name}
                  </h2>
                  <p className="text-sm text-slate-600">
                    Welcome back to GoCreate Nova
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/profile"
                  className="px-3 py-1.5 bg-white/80 hover:bg-white rounded-[1rem] border border-slate-300 text-sm shadow-sm transition transform hover:scale-105 cursor-pointer"
                >
                  View Profile
                </Link>
                <Link
                  href="/groups"
                  className="px-3 py-1.5 bg-white/80 hover:bg-white rounded-[1rem] border border-slate-300 text-sm shadow-sm transition transform hover:scale-105 cursor-pointer"
                >
                  My Groups
                </Link>

                {superAdmin && (
                  <div className="ml-1 h-10 rounded-[1rem] border border-slate-200 bg-white/70 backdrop-blur shadow-sm p-1 flex items-center gap-1">
                    <button
                      onClick={() => setView('member')}
                      className={`h-8 px-3 rounded-[0.85rem] text-sm font-semibold transition ${
                        view === 'member' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white'
                      }`}
                    >
                      Member
                    </button>
                    <button
                      onClick={() => setView('admin')}
                      className={`h-8 px-3 rounded-[0.85rem] text-sm font-semibold transition inline-flex items-center gap-2 ${
                        view === 'admin' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white'
                      }`}
                    >
                      <Shield className="w-4 h-4" />
                      Admin
                    </button>
                  </div>
                )}
              </div>
            </div>

            <AnimatePresence mode="wait">
              {view === 'admin' && superAdmin ? (
                <motion.div
                  key="admin"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.18 }}
                >
                  <AdminStudiosView onBackToMember={() => setView('member')} />
                </motion.div>
              ) : (
                <motion.div
                  key="member"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.18 }}
                >
                  {/* Grid buttons */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {options.map(({ icon: Icon, label, path, tintClass, hoverClass }, idx) => (
                      <motion.button
                        key={idx}
                        whileHover={{ scale: 1.05 }}
                        onClick={() => router.push(path)}
                        className={`flex flex-col items-center gap-2 ${tintClass} bg-white/80 border border-slate-300 rounded-[1.5rem] min-h-[100px] px-4 py-3 shadow-sm justify-center transition ${hoverClass} hover:text-white cursor-pointer`}
                      >
                        <Icon className="w-7 h-7" />
                        {label}
                      </motion.button>
                    ))}
                  </div>

                  {/* Sign out */}
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    onClick={handleSignOut}
                    className="w-full flex justify-center items-center gap-2 text-sm font-medium text-white bg-red-500/90 hover:bg-red-600 rounded-[1.5rem] py-3 shadow-sm transition mt-8 cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                    {sessionType === 'ClockIn' ? 'Clock Out' : 'Sign Out'}
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        ) : (
          <div className="text-center space-y-3">
            <h2 className="text-xl md:text-2xl font-bold">Have a great day!</h2>
            <p className="text-xs text-slate-500">
              Returning to home screen in {goodbyeCountdown} second{goodbyeCountdown !== 1 && 's'}
            </p>
          </div>
        )}
      </motion.div>

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

// -----------------------------------------------------------------------------
// bokeh background
// -----------------------------------------------------------------------------
function BokehBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      <motion.div
        className="absolute -top-24 -left-24 w-[520px] h-[520px] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(35% 35% at 50% 50%, rgba(99,102,241,0.45), rgba(99,102,241,0))' }}
        animate={{ x: [0, 20, -10, 0], y: [0, -10, 15, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 -right-16 w-[600px] h-[600px] rounded-full blur-[90px]"
        style={{ background: 'radial-gradient(40% 40% at 50% 50%, rgba(14,165,233,0.40), rgba(14,165,233,0))' }}
        animate={{ x: [0, -20, 10, 0], y: [0, 10, -15, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-140px] left-1/3 w-[520px] h-[520px] rounded-full blur-[80px]"
        style={{ background: 'radial-gradient(45% 45% at 50% 50%, rgba(16,185,129,0.35), rgba(16,185,129,0))' }}
        animate={{ x: [0, 10, -15, 0], y: [0, -8, 12, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}
