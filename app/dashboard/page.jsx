'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
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
  Search,
  Sparkles,
  MapPin,
  Image as ImageIcon,
  LayoutDashboard,
  Settings2,
  ChevronDown,
  Shield,
  Cpu,
  MessageSquare,
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
} from 'firebase/firestore';

import { app } from '../lib/firebase';
import CornerUtilities from '../components/CornerUtilities';
import { useUser } from '../context/UserContext';

const db = getFirestore(app);

// -----------------------------------------------------------------------------
// Role helpers (supports your real user.roles shape: ["roleDocId", ...] OR objects)
// -----------------------------------------------------------------------------
function getAssignedRoleIds(member) {
  const assigned = member?.roles;
  if (!assigned) return [];
  if (Array.isArray(assigned)) {
    return assigned
      .map((r) => (typeof r === 'string' ? r : r?.id))
      .filter(Boolean)
      .map(String);
  }
  if (typeof assigned === 'object') {
    // If you ever store roles as a map like {roleId:true}
    return Object.keys(assigned).map(String);
  }
  return [];
}

function isEmployeeFromRoles(member, rolesById) {
  const ids = getAssignedRoleIds(member);
  for (const id of ids) {
    const role = rolesById?.get?.(id);
    if (role?.isEmployee) return true;
  }
  // Optional fallback if you also set a direct flag
  if (member?.isEmployee === true) return true;
  return false;
}

function isSuperAdminFromRoles(member, rolesById) {
  if (!member) return false;
  if (member.isSuperAdmin === true) return true;
  if (typeof member.role === 'string' && member.role.toLowerCase() === 'superadmin') return true;

  const ids = getAssignedRoleIds(member);
  for (const id of ids) {
    const role = rolesById?.get?.(id);
    const name = String(role?.name || '').toLowerCase();
    if (name === 'superadmin') return true;
    // If you decide to add an explicit flag on role docs later:
    if (role?.isSuperAdmin) return true;
  }
  return false;
}

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------
const ADMIN_ACTIONS = [
  { icon: Cpu, label: 'Machines', desc: 'Machines, logs, maintenance', path: '/machines', tint: 'text-indigo-600', bg: 'from-indigo-50/80 to-white/70' },
  { icon: MessageSquare, label: 'Messages', desc: 'Broadcasts and announcements', path: '/messages', tint: 'text-indigo-600', bg: 'from-indigo-50/80 to-white/70' },

  { icon: Wrench, label: 'Tools', desc: 'Inventory and tools catalog', path: '/tools', tint: 'text-blue-600', bg: 'from-blue-50/80 to-white/70' },
  { icon: ShoppingBag, label: 'Materials', desc: 'Consumables and stock', path: '/materials', tint: 'text-blue-600', bg: 'from-blue-50/80 to-white/70' },
  { icon: GraduationCap, label: 'Certifications', desc: 'Member certifications', path: '/certifications', tint: 'text-amber-600', bg: 'from-amber-50/80 to-white/70' },
  { icon: BookOpen, label: 'Courses', desc: 'Classes and learning', path: '/courses', tint: 'text-amber-600', bg: 'from-amber-50/80 to-white/70' },
  { icon: CalendarCheck, label: 'Reservations', desc: 'Machines and bookings', path: '/reservations', tint: 'text-emerald-600', bg: 'from-emerald-50/80 to-white/70' },
  { icon: BadgeCheck, label: 'About', desc: 'Policies and info', path: '/about', tint: 'text-emerald-600', bg: 'from-emerald-50/80 to-white/70' },
  { icon: Gavel, label: 'Bids', desc: 'Job bids and approvals', path: '/bids', tint: 'text-rose-600', bg: 'from-rose-50/80 to-white/70' },
  { icon: AlertTriangle, label: 'Issues', desc: 'Incident reporting', path: '/issues', tint: 'text-rose-600', bg: 'from-rose-50/80 to-white/70' },
  { icon: Clock, label: 'Sessions', desc: 'Check-ins and time', path: '/sessions', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
  { icon: Users, label: 'Users', desc: 'Members and accounts', path: '/users', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
  { icon: BarChartBig, label: 'Analytics', desc: 'Usage and trends', path: '/analytics', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
  { icon: Wallet, label: 'Payments', desc: 'Billing and invoices', path: '/payments', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
  { icon: Hammer, label: 'Maintenance', desc: 'Upkeep and repairs', path: '/maintenance', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
  { icon: ShieldCheck, label: 'Roles', desc: 'Permissions and access', path: '/roles', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
];

// Member grid: remove duplicates (Studios / Reservations / What's New are covered by top CTA row)
const MEMBER_ACTIONS = [
  { icon: MapPin, label: 'Map', desc: 'Find studios and front desk', path: '/map', tint: 'text-emerald-700', bg: 'from-emerald-50/80 to-white/70' },
  { icon: GraduationCap, label: 'Certifications', desc: 'View your certifications', path: '/certifications', tint: 'text-indigo-600', bg: 'from-indigo-50/80 to-white/70' },
  { icon: BookOpen, label: 'Courses', desc: 'See available courses', path: '/courses', tint: 'text-indigo-600', bg: 'from-indigo-50/80 to-white/70' },
  { icon: Wrench, label: 'Tools', desc: 'Browse tools catalog', path: '/tools', tint: 'text-sky-700', bg: 'from-sky-50/80 to-white/70' },
  { icon: ShoppingBag, label: 'Materials', desc: 'Materials and availability', path: '/materials', tint: 'text-sky-700', bg: 'from-sky-50/80 to-white/70' },
  { icon: BadgeCheck, label: 'About', desc: 'Rules, safety, memberships', path: '/about', tint: 'text-slate-700', bg: 'from-slate-50/80 to-white/70' },
];

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------
export default function DashboardPage() {
  const router = useRouter();
  const {
    currentUser,
    setCurrentUser,
    loading,
    rolesById,
    rolesLoading,
    refreshRoles,
  } = useUser();

  const [member, setMember] = useState(null);

  const [sessionType, setSessionType] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);

  const [showGoodbye, setShowGoodbye] = useState(false);
  const [goodbyeCountdown, setGoodbyeCountdown] = useState(5);

  // View switching:
  // - non-employee: regular only
  // - employee: can switch regular/admin
  const [view, setView] = useState('regular'); // 'regular' | 'admin'

  // Ensure roles are fresh enough for employee gating (your UserContext also caches them)
  useEffect(() => {
    if (!rolesLoading && rolesById?.size) return;
    refreshRoles(false).catch(() => {});
  }, [rolesLoading, rolesById, refreshRoles]);

  // Prefer context currentUser; fall back to localStorage only if needed.
  useEffect(() => {
    if (currentUser) {
      setMember(currentUser);
      return;
    }
    const stored = localStorage.getItem('nova-user');
    if (!stored) {
      router.push('/');
      return;
    }
    const parsed = JSON.parse(stored);
    setMember(parsed);
    // keep context in sync (so other pages behave consistently)
    setCurrentUser?.(parsed);
  }, [currentUser, router, setCurrentUser]);

  const employee = useMemo(() => isEmployeeFromRoles(member, rolesById), [member, rolesById]);
  const superAdmin = useMemo(() => isSuperAdminFromRoles(member, rolesById), [member, rolesById]);

  // Default view selection once we can evaluate employee status
  useEffect(() => {
    if (!member) return;
    setView(employee ? 'admin' : 'regular');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member, employee]);

  // Enforce: admin view only for employees
  useEffect(() => {
    if (!member) return;
    if (!employee && view === 'admin') setView('regular');
  }, [member, employee, view]);

  // Enforce active session (after member is known)
  useEffect(() => {
    if (!member?.id) return;

    const checkActiveSession = async () => {
      const q = query(collection(db, 'sessions'), where('member.id', '==', member.id), where('endTime', '==', null));
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const s = snapshot.docs[0];
        setCurrentSessionId(s.id);
        setSessionType(s.data().type);
      } else {
        router.push('/checkin');
      }
    };

    checkActiveSession().catch(() => router.push('/checkin'));
  }, [member?.id, router]);

  // Goodbye countdown
  useEffect(() => {
    if (!showGoodbye) return;
    const id = setInterval(() => setGoodbyeCountdown((p) => p - 1), 1000);
    return () => clearInterval(id);
  }, [showGoodbye]);

  useEffect(() => {
    if (goodbyeCountdown === 0) router.push('/');
  }, [goodbyeCountdown, router]);

  const handleSignOut = async () => {
    try {
      if (currentSessionId) {
        await updateDoc(doc(db, 'sessions', currentSessionId), { endTime: serverTimestamp() });
      }
      setShowGoodbye(true);
    } catch (err) {
      console.error('Error signing out:', err);
      alert('Error recording sign out. Please try again.');
    }
  };

  const displayName = member?.name || member?.fullName || 'there';

  // Search for regular dashboard
  const [search, setSearch] = useState('');
  const regularFiltered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    if (!q) return MEMBER_ACTIONS;
    return MEMBER_ACTIONS.filter((a) => a.label.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q));
  }, [search]);

  // Admin search
  const [adminSearch, setAdminSearch] = useState('');
  const adminFiltered = useMemo(() => {
    const q = (adminSearch || '').toLowerCase().trim();
    if (!q) return ADMIN_ACTIONS;
    return ADMIN_ACTIONS.filter((a) => a.label.toLowerCase().includes(q) || a.desc.toLowerCase().includes(q));
  }, [adminSearch]);

  // Loading state (context + member)
  if (loading && !member) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-slate-500 bg-gradient-to-br from-white via-slate-100 to-white">
        Loading…
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
      <CornerUtilities />
      <BokehBackground />

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
        >
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 md:w-16 md:h-16 rounded-[1.25rem] overflow-hidden border border-slate-200 bg-white/70 backdrop-blur shadow-sm">
              <Image
                src={member?.profileImageUrl || member?.photoURL || '/default-avatar.png'}
                alt="Profile"
                width={64}
                height={64}
                className="object-cover w-full h-full"
                priority
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                  Hey, <span className="gradient-text">{displayName}</span>
                </h1>
                {superAdmin ? (
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white">
                    <Shield className="w-3.5 h-3.5" />
                    Superadmin
                  </span>
                ) : null}
                {employee && !superAdmin ? (
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/70 border border-slate-200 text-slate-800">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Employee
                  </span>
                ) : null}
              </div>

              <p className="text-slate-600 mt-1 truncate">
                {view === 'regular' ? 'Your dashboard' : 'Employee console'}
                {sessionType ? ` • Session: ${sessionType}` : ''}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/profile"
              className="h-10 px-4 rounded-full bg-white/70 backdrop-blur border border-slate-200 hover:bg-white shadow-sm text-sm font-semibold inline-flex items-center gap-2"
            >
              <Settings2 className="w-4 h-4" />
              Profile
            </Link>

            {/* Toggle: ONLY for employees */}
            {employee ? (
              <div className="h-10 rounded-full border border-slate-200 bg-white/70 backdrop-blur shadow-sm p-1 flex items-center">
                <button
                  onClick={() => setView('regular')}
                  className={`h-8 px-4 rounded-full text-sm font-semibold transition ${
                    view === 'regular' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  Regular
                </button>
                <button
                  onClick={() => setView('admin')}
                  className={`h-8 px-4 rounded-full text-sm font-semibold transition inline-flex items-center gap-2 ${
                    view === 'admin' ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-white'
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Admin
                </button>
              </div>
            ) : null}

            <button
              onClick={handleSignOut}
              className="h-10 px-4 rounded-full bg-rose-600 text-white font-semibold shadow-sm hover:bg-rose-700 inline-flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              {sessionType === 'ClockIn' ? 'Clock Out' : 'Sign Out'}
            </button>
          </div>
        </motion.header>

        {/* Body */}
        <AnimatePresence mode="wait">
          {showGoodbye ? (
            <motion.div
              key="goodbye"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-10 grid place-items-center"
            >
              <div className="w-full max-w-lg rounded-[2rem] border border-slate-200 bg-white/70 backdrop-blur p-8 shadow-xl text-center">
                <h2 className="text-2xl font-bold">Have a great day!</h2>
                <p className="text-sm text-slate-600 mt-2">
                  Returning to home screen in <span className="font-semibold">{goodbyeCountdown}</span> second
                  {goodbyeCountdown !== 1 ? 's' : ''}.
                </p>
              </div>
            </motion.div>
          ) : view === 'admin' && employee ? (
            // -----------------------------------------------------------------
            // ADMIN (Employee) — visible only to employees, role IDs resolved via rolesById
            // -----------------------------------------------------------------
            <motion.section
              key="admin"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
              className="mt-8"
            >
              <div className="rounded-[2rem] border border-slate-200 bg-white/60 backdrop-blur shadow-xl overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-200/70 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <LayoutDashboard className="w-5 h-5 text-slate-700" />
                    <div>
                      <div className="font-bold text-slate-900">Admin Console</div>
                      <div className="text-sm text-slate-600">
                        Operational tools and management.
                        {rolesLoading ? ' (Loading roles…)': ''}
                      </div>
                    </div>
                  </div>

                  <div className="relative w-full md:w-[360px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      value={adminSearch}
                      onChange={(e) => setAdminSearch(e.target.value)}
                      placeholder="Search admin tools…"
                      className="w-full h-11 pl-9 pr-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                </div>

                <div className="p-6">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                    {adminFiltered.map(({ icon: Icon, label, desc, path, tint, bg }) => (
                      <button
                        key={label}
                        onClick={() => router.push(path)}
                        className={`group text-left rounded-[1.6rem] border border-slate-200 bg-gradient-to-b ${bg} backdrop-blur hover:bg-white transition shadow-md p-4 focus:outline-none focus:ring-4 focus:ring-blue-100`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="rounded-2xl border border-slate-200 bg-white/85 backdrop-blur p-2.5 shadow-sm group-hover:shadow">
                            <Icon className={`w-6 h-6 ${tint}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900">{label}</div>
                            <div className="text-xs text-slate-600 mt-1 line-clamp-2">{desc}</div>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-6 rounded-[1.6rem] border border-slate-200 bg-white/70 backdrop-blur p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="text-sm text-slate-600">
                      Need member-facing content? Switch to <span className="font-semibold">Regular</span>.
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href="/studios"
                        className="h-10 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
                      >
                        <ImageIcon className="w-4 h-4" />
                        Studios
                      </Link>
                      <Link
                        href="/"
                        className="h-10 px-4 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90 inline-flex items-center gap-2"
                      >
                        <CalendarCheck className="w-4 h-4" />
                        Home
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
          ) : (
            // -----------------------------------------------------------------
            // REGULAR (Members) — no duplicates; CTA row is the only place for these
            // -----------------------------------------------------------------
            <motion.section
              key="regular"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
              className="mt-8"
            >
              <div className="rounded-[2rem] border border-slate-200 bg-white/60 backdrop-blur shadow-xl overflow-hidden">
                <div className="px-6 py-5 border-b border-slate-200/70 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-amber-600" />
                      <div className="font-bold text-slate-900">Dashboard</div>
                    </div>
                    <div className="text-sm text-slate-600 mt-1">
                      Quick access to studios, reservations, and what’s happening today.
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                    <div className="relative w-full sm:w-[360px]">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search dashboard…"
                        className="w-full h-11 pl-9 pr-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                      />
                    </div>

                    <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-slate-500 px-3 h-11 rounded-2xl border border-slate-200 bg-white/60 backdrop-blur">
                      <span className="inline-flex items-center gap-2">
                        <ChevronDown className="w-4 h-4" />
                        Member view
                      </span>
                    </div>
                  </div>
                </div>

                <div className="p-6">
                  {/* Primary big CTA row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
                    {/* per request: NOT "Explore Studios" — just "Studios" */}
                    <BigCta title="Studios" subtitle="Spaces, gear, and projects" href="/studios" icon={ImageIcon} />

                    <BigCta title="Reservations" subtitle="Book machines and time" href="/reservations" icon={CalendarCheck} />

                    <BigCta title="What’s New" subtitle="Events, classes, announcements" href="/discover" icon={Sparkles} />
                  </div>

                  {/* Secondary grid (no duplicates of Studios/Reservations/What’s New) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {regularFiltered.map((a) => (
                      <ActionCard
                        key={a.label}
                        title={a.label}
                        subtitle={a.desc}
                        href={a.path}
                        icon={a.icon}
                        tint={a.tint}
                        bg={a.bg}
                      />
                    ))}
                  </div>

                  {/* Footer strip */}
                  <div className="mt-6 rounded-[1.6rem] border border-slate-200 bg-white/70 backdrop-blur p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div className="text-sm text-slate-600">Need help? The front desk can assist with anything.</div>
                    <div className="flex gap-2">
                      <Link
                        href="/about"
                        className="h-10 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
                      >
                        <BadgeCheck className="w-4 h-4" />
                        About
                      </Link>
                      <Link
                        href="/map"
                        className="h-10 px-4 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90 inline-flex items-center gap-2"
                      >
                        <MapPin className="w-4 h-4" />
                        Map
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>

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
// Components
// -----------------------------------------------------------------------------
function ActionCard({ title, subtitle, href, icon: Icon, tint, bg }) {
  return (
    <Link
      href={href}
      className={`group rounded-[1.6rem] border border-slate-200 bg-gradient-to-b ${bg} backdrop-blur hover:bg-white/85 transition shadow-xl p-5 focus:outline-none focus:ring-4 focus:ring-blue-100`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-2xl border border-slate-200 bg-white/85 backdrop-blur p-2.5 shadow-sm group-hover:shadow">
          <Icon className={`w-6 h-6 ${tint}`} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-lg text-slate-900">{title}</div>
          <div className="text-sm text-slate-600 mt-1 line-clamp-2">{subtitle}</div>
        </div>
      </div>
    </Link>
  );
}

function BigCta({ title, subtitle, href, icon: Icon }) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-[1.8rem] border border-slate-200 bg-white/75 backdrop-blur shadow-xl hover:bg-white transition focus:outline-none focus:ring-4 focus:ring-blue-100"
    >
      <div className="p-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-slate-900 text-lg">{title}</div>
          <div className="text-sm text-slate-600 mt-1">{subtitle}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white/85 p-2.5 shadow-sm">
          <Icon className="w-6 h-6 text-slate-800" />
        </div>
      </div>
      <div className="absolute inset-0 pointer-events-none opacity-0 group-hover:opacity-100 transition">
        <div
          className="absolute -top-24 -right-24 w-[300px] h-[300px] rounded-full blur-3xl"
          style={{
            background: 'radial-gradient(40% 40% at 50% 50%, rgba(99,102,241,0.22), rgba(99,102,241,0))',
          }}
        />
      </div>
    </Link>
  );
}

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
