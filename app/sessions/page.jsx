'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getFirestore,
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  limit as fsLimit,
  doc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { app } from '../lib/firebase';

import {
  BadgeCheck,
  Clock,
  ScanLine,
  Download,
  CalendarRange,
  UserPlus,
  ChevronDown,
  ShieldAlert,
  MoreVertical,
} from 'lucide-react';

import { intervalToDuration } from 'date-fns';
import { saveAs } from 'file-saver';
import { DateRange } from 'react-date-range';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';

import CornerUtilities from '../components/CornerUtilities';
import CardShell from '@/app/components/ui/CardShell';
import FilterPills from '@/app/components/ui/FilterPills';
import SearchInput from '@/app/components/ui/SearchInput';
import { ViewToggleButton } from '@/app/components/ui/ToolbarButtons';
import StatBox from '@/app/components/ui/StatBox';

// 🔁 employee roles
import { useEmployeeRoleIndex, userIsEmployee } from '@/app/lib/employeeRoles';

/* ------------------------------------------------
   Date helpers (null-safe)
-------------------------------------------------*/
function toDateSafe(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();                 // Firestore Timestamp
  if (typeof v === 'object' && v !== null && typeof v.seconds === 'number')
    return new Date(v.seconds * 1000);                                    // {seconds}
  if (typeof v === 'number') return new Date(v < 1e10 ? v * 1000 : v);    // sec/ms
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function toDateMaybe(v) { return toDateSafe(v); }

/* ------------------------------------------------
   Membership status logic (Active / Expired / Inactive)
-------------------------------------------------*/
function addCycle(date, cycle) {
  const d = new Date(date);
  if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
  else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
  else d.setMonth(d.getMonth() + 1); // monthly default
  return d;
}

function getMembershipStatus(user) {
  const now = new Date();
  const sub = user?.activeSubscription || null;
  const expiresAt = toDateSafe(sub?.expiresAt);
  const hadAny =
    !!sub ||
    (Array.isArray(user?.subscriptions) && user.subscriptions.length > 0) ||
    !!toDateSafe(user?.membershipExpiresAt);

  if (expiresAt && expiresAt > now) {
    return { label: 'Active', code: 'active', expiresAt, hadAny };
  }
  if (hadAny) {
    // existed at some point but not active anymore
    return { label: 'Expired', code: 'expired', expiresAt, hadAny };
  }
  return { label: 'Inactive', code: 'inactive', expiresAt: null, hadAny: false };
}

const byLower = (s) => String(s || '').toLowerCase();
const hasBadge = (u) => !!(u?.badge?.id || u?.badgeId);

/* ------------------------------------------------
   Smart relative "Last scan"
-------------------------------------------------*/
function formatRelativeSmart(dateInput) {
  const d = toDateMaybe(dateInput);
  if (!d) return '—';
  const now = new Date();
  const diffMs = now - d;
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const timeOnly = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (sec < 60) return 'just now';
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
  if (hr < 2) return '1 hour ago';

  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return timeOnly;

  const y = new Date(now); y.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === y.toDateString();
  if (isYesterday) return `Yesterday, ${timeOnly}`;

  const startOfWeek = new Date(now);
  startOfWeek.setHours(0,0,0,0);
  startOfWeek.setDate(now.getDate() - now.getDay());
  if (d >= startOfWeek) {
    const weekday = d.toLocaleDateString([], { weekday: 'short' });
    return `${weekday} ${timeOnly}`;
  }
  return d.toLocaleString();
}

/* ------------------------------------------------
   Quick ranges
-------------------------------------------------*/
function startOfToday() { const d=new Date(); d.setHours(0,0,0,0); return d; }
function endOfToday() { const d=new Date(); d.setHours(23,59,59,999); return d; }
function startOfYesterday() { const d=startOfToday(); d.setDate(d.getDate()-1); return d; }
function endOfYesterday() { const d=new Date(startOfToday().getTime()-1); d.setHours(23,59,59,999); return d; }
function startOfThisWeekSunday(){ const d=startOfToday(); d.setDate(d.getDate()-d.getDay()); return d; }

/* ------------------------------------------------
   Main page
-------------------------------------------------*/
export default function SessionsPage() {
  const db = getFirestore(app);

  // employee roles
  const emp = useEmployeeRoleIndex(); // { ids:Set<string>, byId: {...} }
  const employeeRoleOptions = useMemo(() => {
    return Object.values(emp.byId || {})
      .filter((r) => r?.isEmployee)
      .map((r) => ({ value: byLower(r.name || r.id), label: r.name || r.id }));
  }, [emp.byId]);

  // sessions + filters
  const [sessions, setSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);

  const [mode, setMode] = useState('all'); // all | members | employees
  const [employeeRole, setEmployeeRole] = useState('all'); // role filter when employees
  const [viewMode, setViewMode] = useState('table'); // card | table
  const [searchTerm, setSearchTerm] = useState('');

  // date filters (default Today)
  const [dateRange, setDateRange] = useState([{ startDate: startOfToday(), endDate: endOfToday(), key: 'selection' }]);
  const [quickRange, setQuickRange] = useState('today'); // today | yesterday | week | custom
  const [showDatePicker, setShowDatePicker] = useState(false);

  // scans / modals
  const [scans, setScans] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [modalSession, setModalSession] = useState(null);

  // membership manage
  const [plans, setPlans] = useState([]);                 // from /plans
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState(null);   // user object

  // preload users for assign modal
  const [allUsers, setAllUsers] = useState([]);
  const [assignSearch, setAssignSearch] = useState('');

  // RT sessions
  useEffect(() => {
    const qSess = query(collection(db, 'sessions'), orderBy('startTime', 'desc'));
    const unsub = onSnapshot(qSess, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSessions(list);
      setFilteredSessions(list);
    });
    return () => unsub();
  }, [db]);

  // RT last 5 scans
  useEffect(() => {
    const qScans = query(collection(db, 'scans'), orderBy('createdAt', 'desc'), fsLimit(5));
    const unsub = onSnapshot(qScans, (snap) => {
      setScans(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [db]);

  // Plans (for renew modal)
  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, 'plans'));
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // keep stable order (by price asc if present)
      list.sort((a,b) => (Number(a.price||0) - Number(b.price||0)));
      setPlans(list);
    })();
  }, [db]);

  // Users cache for assign
  useEffect(() => {
    if (!assignOpen || allUsers.length) return;
    (async () => {
      const usersSnap = await getDocs(collection(db, 'users'));
      setAllUsers(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [assignOpen, allUsers.length, db]);

  // Quick range
  const applyQuickRange = (next) => {
    setQuickRange(next);
    if (next === 'today') {
      setShowDatePicker(false);
      setDateRange([{ startDate: startOfToday(), endDate: endOfToday(), key: 'selection' }]);
    } else if (next === 'yesterday') {
      setShowDatePicker(false);
      setDateRange([{ startDate: startOfYesterday(), endDate: endOfYesterday(), key: 'selection' }]);
    } else if (next === 'week') {
      setShowDatePicker(false);
      setDateRange([{ startDate: startOfThisWeekSunday(), endDate: new Date(), key: 'selection' }]);
    } else {
      setShowDatePicker(true);
    }
  };

  // Filtering
  useEffect(() => {
    let list = [...sessions];

    if (mode === 'members') list = list.filter((s) => !userIsEmployee(s.member, emp.ids));
    else if (mode === 'employees') {
      list = list.filter((s) => userIsEmployee(s.member, emp.ids));
      if (employeeRole !== 'all') {
        const want = byLower(employeeRole);
        list = list.filter((s) =>
          (s.member?.roles || []).some((r) =>
            byLower(typeof r === 'object' ? r?.name || r?.id || '' : r).includes(want)
          )
        );
      }
    }

    const q = byLower(searchTerm);
    if (q) {
      list = list.filter((s) => (s.member?.fullName || s.member?.name || '').toLowerCase().includes(q));
    }

    const { startDate, endDate } = dateRange[0] || {};
    if (startDate && endDate) {
      list = list.filter((s) => {
        const start = toDateMaybe(s.startTime);
        return !!start && start >= startDate && start <= endDate;
      });
    }

    setFilteredSessions(list);
  }, [sessions, mode, employeeRole, searchTerm, dateRange, emp.ids]);

  // Stats
  const memberCount = useMemo(() => sessions.filter((s) => !userIsEmployee(s.member, emp.ids)).length, [sessions, emp.ids]);
  const employeeCount = useMemo(() => sessions.filter((s) => userIsEmployee(s.member, emp.ids)).length, [sessions, emp.ids]);

  // Utils
  const formatDuration = (start, end) => {
    if (!start) return '';
    const startTime = start?.toDate ? start.toDate() : new Date(start);
    const endTime = end?.toDate ? end.toDate() : new Date(end || new Date());
    const dur = intervalToDuration({ start: startTime, end: endTime });
    const hours = dur.hours || 0;
    const mins = dur.minutes || 0;
    return `${hours}h ${mins}m`;
  };
  const readableType = (type) => (type === 'ClockIn' ? 'Shift' : 'Regular');

  const exportCSV = () => {
    const header = ['Name', 'Type', 'Start', 'End', 'Duration', 'Membership'];
    const rows = filteredSessions.map((s) => {
      const start = toDateMaybe(s.startTime);
      const end = toDateMaybe(s.endTime);
      const m = getMembershipStatus(s.member);
      const until = m.expiresAt ? m.expiresAt.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' }) : '—';
      const text =
        m.code === 'active' ? `Active (until ${until})` :
        m.code === 'expired' ? `Expired (was ${until})` :
        'Inactive';
      return [
        s.member?.fullName || s.member?.name || '',
        readableType(s.type),
        start ? start.toLocaleString() : '',
        end ? end.toLocaleString() : 'Active',
        formatDuration(s.startTime, s.endTime),
        text,
      ];
    });
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    saveAs(new Blob([csv], { type: 'text/csv' }), 'sessions.csv');
  };

  // assign badge
  const handleAssignToUser = async (user) => {
    if (!selectedScan?.badgeCode || !user?.id) return;
    const uref = doc(getFirestore(app), 'users', user.id);
    await updateDoc(uref, {
      badge: { id: String(selectedScan.badgeCode), badgeNumber: Number(selectedScan.badgeCode) || null },
    }).catch(() => {});
    try {
      if (selectedScan?.id) {
        await updateDoc(doc(db, 'scans', selectedScan.id), { matchedUserId: user.id, status: 'assigned' });
      }
    } catch (_) {}
    setAssignOpen(false);
    setSelectedScan(null);
  };

  // lock scroll on modals
  useEffect(() => {
    const anyOpen = !!modalSession || assignOpen || renewOpen;
    if (!anyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [modalSession, assignOpen, renewOpen]);

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-white via-slate-100 to-white px-4 py-6 text-slate-900">
      <CornerUtilities />

      {/* Grid 1:2 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[1800px] mx-auto">
        {/* LEFT: Last Scans */}
        <div className="md:col-span-1">
          <CardShell>
            <LastScansCard
              scans={scans}
              onAssign={(scan) => { setSelectedScan(scan); setAssignOpen(true); }}
            />
          </CardShell>
        </div>

        {/* RIGHT: Sessions */}
        <div className="md:col-span-2">
          <CardShell>
            <SessionsPanel
              filteredSessions={filteredSessions}
              mode={mode}
              setMode={(v) => { setMode(v); setEmployeeRole('all'); }}
              employeeRole={employeeRole}
              setEmployeeRole={setEmployeeRole}
              employeeRoleOptions={employeeRoleOptions}
              showDatePicker={showDatePicker}
              setShowDatePicker={setShowDatePicker}
              dateRange={dateRange}
              setDateRange={setDateRange}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              exportCSV={exportCSV}
              viewMode={viewMode}
              setViewMode={setViewMode}
              memberCount={memberCount}
              employeeCount={employeeCount}
              setModalSession={setModalSession}
              formatDuration={formatDuration}
              readableType={readableType}
              quickRange={quickRange}
              applyQuickRange={applyQuickRange}
              onRenew={(member) => { setRenewTarget(member); setRenewOpen(true); }}
              onExtend={async (member) => {
                const sub = member?.activeSubscription;
                if (!sub) return;
                const next = addCycle(toDateSafe(sub.expiresAt) || new Date(), sub.cycle || 'monthly');
                await updateDoc(doc(db, 'users', member.id), {
                  'activeSubscription.expiresAt': next,
                  'activeSubscription.status': 'active',
                });
              }}
              onEndNow={async (member) => {
                if (!member?.id) return;
                await updateDoc(doc(db, 'users', member.id), {
                  'activeSubscription.status': 'expired',
                  'activeSubscription.expiresAt': new Date(),
                });
              }}
              onClearSub={async (member) => {
                if (!member?.id) return;
                await updateDoc(doc(db, 'users', member.id), {
                  activeSubscription: null,
                });
              }}
              plans={plans}
            />
          </CardShell>
        </div>
      </div>

      <SessionModal session={modalSession} onClose={() => setModalSession(null)} />

      <AssignBadgeModal
        open={assignOpen}
        onClose={() => { setAssignOpen(false); setSelectedScan(null); }}
        badgeCode={selectedScan?.badgeCode}
        users={allUsers}
        search={assignSearch}
        setSearch={setAssignSearch}
        onAssign={handleAssignToUser}
      />

      <RenewMembershipModal
        open={renewOpen}
        member={renewTarget}
        onClose={() => { setRenewOpen(false); setRenewTarget(null); }}
        onSaved={() => { setRenewOpen(false); setRenewTarget(null); }}
        plans={plans}
      />
    </div>
  );
}

/* ------------------------------------------------
   Sub-components
-------------------------------------------------*/

function LastScansCard({ scans, onAssign }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-2xl font-bold">Last Scans</h2>
        {scans?.[0]?.status && (
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
            scans[0].status === 'matched' ? 'bg-emerald-100 text-emerald-700'
            : scans[0].status === 'assigned' ? 'bg-blue-100 text-blue-700'
            : scans[0].status === 'error' ? 'bg-rose-100 text-rose-700'
            : 'bg-amber-100 text-amber-700'
          }`}>
            {String(scans[0].status).toUpperCase()}
          </span>
        )}
      </div>

      {!scans?.length ? (
        <div className="rounded-[2rem] border border-slate-200 bg-white/70 p-8 text-center shadow">
          <div className="mx-auto w-16 h-16 grid place-items-center rounded-full bg-slate-100 mb-3">
            <ScanLine className="w-8 h-8 text-slate-500" />
          </div>
          <div className="text-lg font-semibold">Waiting for scans…</div>
          <div className="text-sm text-slate-500 mt-1">When the kiosk scans a badge, it’ll appear here instantly.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {scans.map((scan) => {
            const name = scan?.user?.fullName || scan?.user?.name || 'No match';
            const rel = formatRelativeSmart(scan?.createdAt);
            const unmatched = !scan?.user?.id && !scan?.matchedUserId;

            return (
              <motion.div key={scan.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                className="rounded-[2rem] border border-slate-200 bg-white/70 p-5 shadow">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-slate-100 grid place-items-center overflow-hidden">
                    <BadgeCheck className="w-6 h-6 text-slate-500" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-bold text-black truncate">{name}</div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      Badge: <span className="font-mono">{scan?.badgeCode || '—'}</span>
                      <span className="mx-2">•</span>
                      Scanned <span className="font-medium">{rel}</span>
                    </div>
                    {unmatched && (
                      <div className="mt-3">
                        <button onClick={() => onAssign(scan)}
                          className="rounded-full px-3 py-1.5 text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 transition">
                          Assign User
                        </button>
                        <Link href="/signup"
                          className="ml-2 rounded-full px-3 py-1.5 text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition inline-flex items-center gap-2">
                          <UserPlus className="w-4 h-4" /> New Member
                        </Link>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SessionsPanel({
  filteredSessions,
  mode, setMode,
  employeeRole, setEmployeeRole, employeeRoleOptions,
  showDatePicker, setShowDatePicker, dateRange, setDateRange,
  searchTerm, setSearchTerm,
  exportCSV, viewMode, setViewMode,
  memberCount, employeeCount,
  setModalSession, formatDuration, readableType,
  quickRange, applyQuickRange,
  onRenew, onExtend, onEndNow, onClearSub,
  plans,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap justify-between items-center gap-2 relative">
        <h1 className="text-3xl font-bold">Sessions</h1>
        <div className="flex-1 flex items-center gap-2">
          <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search name…" />
          <div className="flex items-center gap-2 ml-auto relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              onMouseEnter={() => setMenuOpen(true)}
              onMouseLeave={() => setMenuOpen(false)}
              className="rounded-[1rem] px-3 py-2 border border-slate-300 bg-white/70 hover:bg-white/80 shadow-sm flex items-center gap-2"
            >
              <CalendarRange className="w-5 h-5" />
              <span className="text-sm font-medium capitalize">{quickRange === 'week' ? 'This week' : quickRange}</span>
              <ChevronDown className="w-4 h-4 opacity-70" />
            </button>
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  onMouseEnter={() => setMenuOpen(true)}
                  onMouseLeave={() => setMenuOpen(false)}
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  className="absolute right-28 top-12 z-10 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
                >
                  {[
                    ['today', 'Today'],
                    ['yesterday', 'Yesterday'],
                    ['week', 'This week'],
                    ['custom', 'Custom…'],
                  ].map(([key, label]) => (
                    <button key={key}
                      onClick={() => { applyQuickRange(key); setMenuOpen(false); }}
                      className={`block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${quickRange === key ? 'bg-slate-50 font-semibold' : ''}`}
                    >
                      {label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <button onClick={exportCSV} className="rounded-[1rem] p-2 border border-slate-300 bg-white/70 hover:bg-white/80 shadow-sm">
              <Download className="w-5 h-5" />
            </button>
            <ViewToggleButton viewMode={viewMode} setViewMode={setViewMode} />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap justify-start gap-6 mt-3">
        <StatBox label="Total" count={filteredSessions.length} />
        <StatBox label="Members" count={memberCount} />
        <StatBox label="Employees" count={employeeCount} />
      </div>

      {/* Filter pills */}
      <div className="mt-4">
        <FilterPills
          value={mode}
          onChange={(v) => { setMode(v); setEmployeeRole('all'); }}
          options={[{ value: 'all', label: 'All' }, { value: 'members', label: 'Members' }, { value: 'employees', label: 'Employees' }]}
        />
        <AnimatePresence>
          {mode === 'employees' && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-2">
              <FilterPills value={employeeRole} onChange={setEmployeeRole} options={[{ value: 'all', label: 'All' }, ...employeeRoleOptions]} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Date picker */}
      <AnimatePresence>
        {showDatePicker && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-3">
            <DateRange ranges={dateRange} onChange={(item) => setDateRange([item.selection])} maxDate={new Date()} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sessions list */}
      <div className="mt-4">
        {viewMode === 'card' ? (
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
            {filteredSessions.map((s) => (
              <SessionCard key={s.id} s={s}
                formatDuration={formatDuration} readableType={readableType}
                onOpen={() => setModalSession(s)}
                onRenew={onRenew} onExtend={onExtend} onEndNow={onEndNow} onClearSub={onClearSub}
              />
            ))}
          </div>
        ) : (
          <div className="backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl overflow-x-auto p-4">
            <table className="w-full text-sm text-left text-slate-700">
              <thead>
                <tr>
                  <th className="px-2 py-1">Name</th>
                  <th className="px-2 py-1">Membership</th>
                  <th className="px-2 py-1">Role(s)</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Start</th>
                  <th className="px-2 py-1">End</th>
                  <th className="px-2 py-1">Duration</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s) => {
                  const start = toDateMaybe(s.startTime);
                  const end = toDateMaybe(s.endTime);
                  const duration = formatDuration(s.startTime, s.endTime);
                  const name = s.member?.fullName || s.member?.name || 'Unknown';
                  const roles = (s.member?.roles || []).map((r) => (typeof r === 'object' ? r?.name || r?.id || 'role' : r)).join(', ') || '—';

                  const m = getMembershipStatus(s.member);
                  const chipCls =
                    m.code === 'active' ? 'bg-emerald-100 text-emerald-700' :
                    m.code === 'expired' ? 'bg-rose-100 text-rose-700' :
                    'bg-slate-200 text-slate-700';

                  const expiresLabel = m.expiresAt
                    ? m.expiresAt.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' })
                    : null;

                  return (
                    <tr key={s.id} className="border-t border-slate-200 hover:bg-white/70">
                      <td className="px-2 py-1 font-semibold text-black cursor-pointer" onClick={() => setModalSession(s)}>
                        {name}
                      </td>
                      <td className="px-2 py-1 text-slate-600">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${chipCls}`}>
                          {m.label}{expiresLabel && m.code !== 'inactive' ? <span className="opacity-70"> · {expiresLabel}</span> : null}
                        </span>
                      </td>
                      <td className="px-2 py-1 text-slate-600">{roles}</td>
                      <td className="px-2 py-1">{readableType(s.type)}</td>
                      <td className="px-2 py-1">{start ? start.toLocaleString() : '—'}</td>
                      <td className="px-2 py-1">{end ? end.toLocaleString() : 'Active'}</td>
                      <td className="px-2 py-1">{end ? duration : ''}</td>
                      <td className="px-2 py-1">
                        <StatusDot code={m.code} />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <QuickManageMenu
                          member={s.member}
                          status={m}
                          onRenew={() => onRenew(s.member)}
                          onExtend={() => onExtend(s.member)}
                          onEndNow={() => onEndNow(s.member)}
                          onClearSub={() => onClearSub(s.member)}
                          plans={plans}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function StatusDot({ code }) {
  const map = {
    active: 'bg-emerald-500',
    expired: 'bg-rose-500',
    inactive: 'bg-slate-400',
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${map[code] || 'bg-slate-400'}`} />;
}

function QuickManageMenu({ member, status, onRenew, onExtend, onEndNow, onClearSub }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        className="rounded-full p-2 border border-slate-300 bg-white/70 hover:bg-white/80 shadow-sm"
        onClick={() => setOpen((v)=>!v)}
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute right-0 top-10 z-20 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden min-w-44"
            onMouseLeave={() => setOpen(false)}
          >
            <button className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" onClick={() => { setOpen(false); onRenew(member); }}>
              Renew (Create payment)
            </button>
            <button disabled={status.code === 'inactive'} className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
              onClick={() => { setOpen(false); onExtend(member); }}>
              Extend +1 cycle
            </button>
            <button disabled={status.code !== 'active'} className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40"
              onClick={() => { setOpen(false); onEndNow(member); }}>
              End now
            </button>
            <button className="block w-full text-left px-4 py-2 text-sm hover:bg-slate-50" onClick={() => { setOpen(false); onClearSub(member); }}>
              Clear subscription (Inactive)
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SessionCard({ s, formatDuration, readableType, onOpen, onRenew, onExtend, onEndNow, onClearSub }) {
  const start = toDateMaybe(s.startTime);
  const end = toDateMaybe(s.endTime);
  const duration = formatDuration(s.startTime, s.endTime);
  const name = s.member?.fullName || s.member?.name || 'Unknown';
  const m = getMembershipStatus(s.member);
  const membership = s.member?.membershipType || '—';
  const chipCls =
    m.code === 'active' ? 'bg-emerald-100 text-emerald-700'
    : m.code === 'expired' ? 'bg-rose-100 text-rose-700'
    : 'bg-slate-200 text-slate-700';
  const expiresLabel = m.expiresAt
    ? m.expiresAt.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' })
    : null;

  return (
    <div onClick={onOpen}
      className="cursor-pointer backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl p-4 hover:shadow-lg transition">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2 font-semibold text-black">
          <BadgeCheck className="w-4 h-4 text-slate-500" /> {name}
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${chipCls}`}>
          {m.label} {expiresLabel && m.code !== 'inactive' ? <span className="opacity-70">· {expiresLabel}</span> : null}
          {m.code === 'expired' && <ShieldAlert className="w-3 h-3" />}
        </span>
      </div>

      <div className="text-xs text-slate-500 mb-1">
        Membership: <span className="text-slate-700">{membership}</span>
      </div>
      <div className="text-sm text-slate-500 mb-1">
        <ScanLine className="inline w-4 h-4 mr-1" /> {readableType(s.type)}
      </div>
      <div className="text-sm text-slate-500 mb-1">
        <Clock className="inline w-4 h-4 mr-1" /> {start ? start.toLocaleString() : '—'}
      </div>
      <div className="text-sm mb-3">
        {end ? <span className="text-black">{duration}</span> : <span className="text-blue-500 font-medium">Active • {duration}</span>}
      </div>

      <div className="flex justify-end gap-2">
        <button
          className="rounded-full px-3 py-1.5 text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600"
          onClick={(e) => { e.stopPropagation(); onRenew(s.member); }}
        >
          Renew
        </button>
        <button
          className="rounded-full px-3 py-1.5 text-xs font-semibold bg-slate-200 hover:bg-slate-300"
          onClick={(e) => { e.stopPropagation(); onExtend(s.member); }}
          disabled={m.code === 'inactive'}
        >
          +1 cycle
        </button>
        <button
          className="rounded-full px-3 py-1.5 text-xs font-semibold bg-rose-100 text-rose-700 hover:bg-rose-200"
          onClick={(e) => { e.stopPropagation(); onEndNow(s.member); }}
          disabled={m.code !== 'active'}
        >
          End now
        </button>
      </div>
    </div>
  );
}

function SessionModal({ session, onClose }) {
  const [activeTab, setActiveTab] = useState('current');
  if (!session) return null;

  const start = session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime);
  const end = session.endTime?.toDate ? session.endTime.toDate() : null;
  const type = session.type === 'ClockIn' ? 'Shift' : 'Regular';
  const name = session.member?.fullName || session.member?.name || 'Unknown';
  const membership = session.member?.membershipType || '—';
  const roles = (session.member?.roles || []).map((r) => (typeof r === 'object' ? r?.name || r?.id || 'role' : r)).join(', ') || '—';
  const m = getMembershipStatus(session.member);
  const chipCls =
    m.code === 'active' ? 'bg-emerald-100 text-emerald-700'
    : m.code === 'expired' ? 'bg-rose-100 text-rose-700'
    : 'bg-slate-200 text-slate-700';

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 md:p-8 bg-white/40 backdrop-blur-lg supports-[backdrop-filter]:bg-white/30"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }} transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white/90 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 w-[min(92vw,40rem)] max-h-[85vh] overflow-y-auto p-6 space-y-4"
          >
            <h2 className="text-xl font-bold">Session Details</h2>

            <div className="space-y-1 text-sm text-slate-700">
              <div className="flex items-center gap-2">
                <strong>Name:</strong> {name}
                <span className={`ml-2 inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full ${chipCls}`}>
                  {m.label}
                  {m.expiresAt && m.code !== 'inactive' && (
                    <span className="opacity-70">· {m.expiresAt.toLocaleDateString([], { month:'short', day:'numeric', year:'numeric' })}</span>
                  )}
                </span>
              </div>
              <div><strong>Membership:</strong> {membership}</div>
              <div><strong>Roles:</strong> {roles}</div>
              <div><strong>Badge:</strong> {session.member?.badgeId || session.member?.badge?.id || 'N/A'}</div>
              <div><strong>Type:</strong> {type}</div>
              <Link href={`/users/${session.member?.id}`}>
                <button className="mt-2 text-blue-500 text-xs hover:underline">View Profile</button>
              </Link>
            </div>

            <div className="flex gap-2 mt-4 border-b border-slate-200">
              {['Current Session', 'All Sessions'].map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab === 'Current Session' ? 'current' : 'all')}
                  className={`px-2 pb-1 text-sm ${activeTab === (tab === 'Current Session' ? 'current' : 'all') ? 'border-b-2 border-blue-500 text-blue-500' : 'text-slate-500 hover:text-slate-700'}`}>
                  {tab}
                </button>
              ))}
            </div>

            <div className="text-sm text-slate-700 space-y-1 mt-2">
              {activeTab === 'current' ? (
                <>
                  <div>Checked in at {start.toLocaleString()}</div>
                  {end && <div>Checked out at {end.toLocaleString()}</div>}
                </>
              ) : (
                <div>Empty logs (future feature)</div>
              )}
            </div>

            <div className="flex justify-end mt-4">
              <button onClick={onClose} className="px-4 py-2 rounded-full bg-blue-500 text-white hover:bg-blue-600 text-sm transition">
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  );
}

/* Assign Badge Modal */
function AssignBadgeModal({ open, onClose, badgeCode, users, search, setSearch, onAssign }) {
  if (!open) return null;
  const q = (search || '').trim().toLowerCase();
  const filtered = (users || []).filter((u) => {
    const name = (u.fullName || u.name || '').toLowerCase();
    const badgeId = String(u.badge?.id || u.badgeId || '').toLowerCase();
    const uid = String(u.id || '').toLowerCase();
    return name.includes(q) || (!!q && badgeId === q) || (!!q && uid === q);
  });

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div key="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 md:p-8 bg-white/40 backdrop-blur-lg supports-[backdrop-filter]:bg-white/30"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          onClick={onClose}
        >
          <motion.div key="card" initial={{ y: 32, opacity: 0, scale: 0.985 }} animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.985 }} transition={{ duration: 0.22, ease: 'easeOut' }}
            className="bg-white/90 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 w-[min(92vw,40rem)] max-h-[85vh] p-6 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">Assign Badge</h3>
              <button className="text-slate-500 hover:text-slate-700" onClick={onClose} aria-label="Close">✕</button>
            </div>

            <div className="mt-1 text-sm text-slate-600">
              Badge Code: <span className="font-mono">{badgeCode || '—'}</span>
            </div>

            <div className="mt-4">
              <SearchInput value={search} onChange={setSearch} placeholder="Search user by name, exact badge, or ID…" />
            </div>

            <div className="mt-4 max-h-[55vh] overflow-y-auto divide-y divide-slate-200">
              {filtered.length === 0 && <div className="py-10 text-center text-slate-500">No matches.</div>}
              {filtered.map((u) => (
                <div key={u.id} className="py-2.5 px-1 flex items-center justify-between gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={u.photoURL || '/default-avatar.png'} alt={u.fullName || u.name}
                    className="w-9 h-9 rounded-full object-cover shrink-0 shadow-sm border border-white" />
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">{u.fullName || u.name}</div>
                    <div className="text-[11px] text-slate-600 truncate">
                      {(u.roles || []).map((r) => (typeof r === 'object' ? r?.name || r?.id || 'role' : r)).join(', ') || 'Member'}
                      {hasBadge(u) && <span className="ml-2 text-emerald-600">• has badge</span>}
                    </div>
                  </div>
                  <button className="rounded-full px-3 py-1.5 text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600"
                    onClick={() => onAssign(u)}>Assign</button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <div>Tip: If brand new, hit <Link href="/signup" className="text-blue-600 hover:underline">Signup</Link> then assign.</div>
              <button className="rounded-full px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50" onClick={onClose}>Close</button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  );
}

/* Minimal portal helper */
function ModalPortal({ children }) {
  return typeof document !== 'undefined' ? createPortal(children, document.body) : null;
}

/* ------------------------------------------------
   Renew Membership Modal (plans + payment)
-------------------------------------------------*/
function RenewMembershipModal({ open, member, onClose, onSaved, plans }) {
  const db = getFirestore(app);
  const [planId, setPlanId] = useState('');
  const [method, setMethod] = useState('cash');
  const [externalRef, setExternalRef] = useState('');

  useEffect(() => {
    if (open && plans?.length && !planId) setPlanId(plans[0].id);
  }, [open, plans, planId]);

  if (!open || !member) return null;

  const plan = plans.find((p) => p.id === planId);
  const canSave = !!plan && externalRef.trim().length > 0;

  const savePaymentAndActivate = async () => {
    const startedAt = new Date();
    const expiresAt = addCycle(startedAt, plan?.cycle || 'monthly');

    // payment record
    const payment = {
      type: 'receipt',
      status: 'paid',
      method,
      externalRef: externalRef.trim(),
      lines: [{ itemId: plan.id, name: plan.name, qty: 1, unitPrice: Number(plan.price || 0), total: Number(plan.price || 0) }],
      total: Number(plan.price || 0),
      userId: member.id,
      userName: member.fullName || member.name || '',
      createdAt: serverTimestamp(),
      reason: 'membership_renewal',
    };
    await addDoc(collection(db, 'payments'), payment);

    const activeSubscription = {
      planId: plan.id,
      name: plan.name,
      cycle: plan.cycle || 'monthly',
      startedAt,
      expiresAt,
      status: 'active',
    };
    await updateDoc(doc(db, 'users', member.id), { activeSubscription });

    onSaved && onSaved();
  };

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 md:p-8 bg-white/40 backdrop-blur-lg supports-[backdrop-filter]:bg-white/30"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          onClick={onClose}
        >
          <motion.div initial={{ y: 32, opacity: 0, scale: 0.985 }} animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.985 }} transition={{ duration: 0.22, ease: 'easeOut' }}
            className="bg-white/90 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 w-[min(92vw,36rem)] p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-semibold">Renew Membership</h3>
            <div className="text-sm text-slate-700 mt-1">
              <div className="font-medium">{member.fullName || member.name}</div>
              <div className="text-slate-500 text-xs">ID: <span className="font-mono">{member.id || '—'}</span></div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Plan</label>
                <select value={planId} onChange={(e) => setPlanId(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none">
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · ${(Number(p.price || 0)).toFixed(2)} · {p.cycle || 'monthly'}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600 mb-1 block">Payment Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}
                  className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none">
                  {['cash','card','check'].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-slate-600 mb-1 block">External Reference #</label>
                <input value={externalRef} onChange={(e)=>setExternalRef(e.target.value)} placeholder="POS receipt / transaction id"
                  className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={onClose} className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200">Cancel</button>
              <button disabled={!canSave} onClick={savePaymentAndActivate}
                className={`px-4 py-2 rounded-xl text-white shadow ${!canSave ? 'bg-blue-300' : 'bg-blue-500 hover:bg-blue-600'}`}>
                Save & Renew
              </button>
            </div>
            <div className="text-[11px] text-slate-500 mt-3">
              Saves a paid receipt and updates the user's <code>activeSubscription</code>.
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  );
}
