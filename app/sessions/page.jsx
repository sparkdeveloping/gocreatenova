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
} from 'firebase/firestore';
import { app } from '../lib/firebase';

import {
  BadgeCheck,
  Clock,
  ScanLine,
  Download,
  CalendarRange,
  AlertCircle,
  UserPlus,
  ChevronDown,
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

// —————————————————————————————————————————————
// Helpers
const staffish = ['tech', 'mentor', 'admin', 'staff', 'employee', 'student tech'];
const byLower = (s) => String(s || '').toLowerCase();

function isEmployee(u) {
  return (
    Array.isArray(u?.roles) &&
    u.roles.some((r) =>
      staffish.includes(
        String(typeof r === 'object' ? r?.name || r?.id || '' : r).toLowerCase()
      )
    )
  );
}
function hasBadge(u) {
  return !!(u?.badge?.id || u?.badgeId);
}
function toDateMaybe(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v * (v < 10_000_000_000 ? 1000 : 1));
  if (typeof v?.toDate === 'function') return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return null;
}

// smart relative time (per spec)
function formatRelativeSmart(dateInput) {
  const d = toDateMaybe(dateInput);
  if (!d) return '—';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);

  const timeOnly = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHr < 2) return '1 hour ago';
  // beyond 2 hours → show time if today
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return timeOnly;

  // yesterday…
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === y.getFullYear() &&
    d.getMonth() === y.getMonth() &&
    d.getDate() === y.getDate();
  if (isYesterday) return `Yesterday, ${timeOnly}`;

  // within this week → Weekday + time
  const startOfWeek = new Date(now);
  startOfWeek.setHours(0, 0, 0, 0);
  // Sunday = 0
  startOfWeek.setDate(now.getDate() - now.getDay());
  if (d >= startOfWeek) {
    const weekday = d.toLocaleDateString([], { weekday: 'short' }); // Mon/Tue…
    return `${weekday} ${timeOnly}`;
  }

  // else full date
  return d.toLocaleString();
}

// quick ranges
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfToday() {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
function startOfYesterday() {
  const d = startOfToday();
  d.setDate(d.getDate() - 1);
  return d;
}
function endOfYesterday() {
  const d = new Date(startOfToday().getTime() - 1);
  d.setHours(23, 59, 59, 999);
  return d;
}
function startOfThisWeekSunday() {
  const d = startOfToday();
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

// —————————————————————————————————————————————

export default function SessionsPage() {
  const db = getFirestore(app);

  // sessions + filters
  const [sessions, setSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);

  const [mode, setMode] = useState('all');
  const [employeeRole, setEmployeeRole] = useState('all');
  const [viewMode, setViewMode] = useState('table');
  const [searchTerm, setSearchTerm] = useState('');

  // date filters (default to Today)
  const [dateRange, setDateRange] = useState([
    { startDate: startOfToday(), endDate: endOfToday(), key: 'selection' },
  ]);
  const [quickRange, setQuickRange] = useState('today'); // today | yesterday | week | custom
  const [showDatePicker, setShowDatePicker] = useState(false);

  // modals & scans
  const [modalSession, setModalSession] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);

  // last scans (top 5) + selection for assign
  const [scans, setScans] = useState([]);
  const [selectedScan, setSelectedScan] = useState(null);

  // preload users for assign
  const [allUsers, setAllUsers] = useState([]);
  const [assignSearch, setAssignSearch] = useState('');

  // 🔹 REAL-TIME sessions
  useEffect(() => {
    const sessionsRef = collection(db, 'sessions');
    const qSess = query(sessionsRef, orderBy('startTime', 'desc'));
    const unsub = onSnapshot(qSess, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setSessions(list);
      setFilteredSessions(list);
    });
    return () => unsub();
  }, [db]);

  // 🔹 Live last 5 scans
  useEffect(() => {
    const scansRef = collection(db, 'scans');
    const qScans = query(scansRef, orderBy('createdAt', 'desc'), fsLimit(5));
    const unsub = onSnapshot(qScans, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setScans(list);
    });
    return () => unsub();
  }, [db]);

  // 🔹 Preload users for assign modal
  useEffect(() => {
    if (!assignOpen || allUsers.length) return;
    (async () => {
      const usersSnap = await getDocs(collection(db, 'users'));
      const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllUsers(users);
    })();
  }, [assignOpen, allUsers.length, db]);

  // 🔹 Quick range behavior
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
      // custom
      setShowDatePicker(true);
    }
  };

  // 🔹 Filtering logic
  useEffect(() => {
    let list = [...sessions];

    if (mode === 'members') list = list.filter((s) => !isEmployee(s.member));
    else if (mode === 'employees') {
      list = list.filter((s) => isEmployee(s.member));
      if (employeeRole !== 'all') {
        list = list.filter((s) =>
          s.member?.roles?.some((r) =>
            String(typeof r === 'object' ? r?.name || '' : r)
              .toLowerCase()
              .includes(employeeRole)
          )
        );
      }
    }

    const q = byLower(searchTerm);
    if (q) {
      list = list.filter((s) =>
        (s.member?.fullName || s.member?.name || '').toLowerCase().includes(q)
      );
    }

    const { startDate, endDate } = dateRange[0] || {};
    if (startDate && endDate) {
      list = list.filter((s) => {
        const start = toDateMaybe(s.startTime);
        if (!start) return false;
        return start >= startDate && start <= endDate;
      });
    }

    setFilteredSessions(list);
  }, [sessions, mode, employeeRole, searchTerm, dateRange]);

  // 🔹 Stats
  const memberCount = useMemo(() => sessions.filter((s) => !isEmployee(s.member)).length, [sessions]);
  const employeeCount = useMemo(() => sessions.filter((s) => isEmployee(s.member)).length, [sessions]);
  const staffCount = useMemo(
    () => sessions.filter((s) => s.member?.roles?.some((r) => (r.name || '').toLowerCase() === 'staff')).length,
    [sessions]
  );
  const techCount = useMemo(
    () => sessions.filter((s) => s.member?.roles?.some((r) => (r.name || '').toLowerCase() === 'tech')).length,
    [sessions]
  );
  const studentTechCount = useMemo(
    () => sessions.filter((s) => s.member?.roles?.some((r) => (r.name || '').toLowerCase() === 'student tech')).length,
    [sessions]
  );

  // 🔹 Utils
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
    const header = ['Name', 'Type', 'Start', 'End', 'Duration'];
    const rows = filteredSessions.map((s) => {
      const start = toDateMaybe(s.startTime);
      const end = toDateMaybe(s.endTime);
      return [
        s.member?.fullName || s.member?.name || '',
        readableType(s.type),
        start ? start.toLocaleString() : '',
        end ? end.toLocaleString() : 'Active',
        formatDuration(s.startTime, s.endTime),
      ];
    });
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'sessions.csv');
  };

  // 🔹 Assign badge to selected user
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

  // 🔹 Lock scroll
  useEffect(() => {
    const anyOpen = !!modalSession || assignOpen;
    if (anyOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => (document.body.style.overflow = prev);
    }
  }, [modalSession, assignOpen]);

  // —————————————————————————————————————————————
  return (
    <div className="relative min-h-screen bg-gradient-to-br from-white via-slate-100 to-white px-4 py-6 text-slate-900">
      <CornerUtilities />

      {/* Grid 1:2 ratio */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[1800px] mx-auto">
        {/* LEFT: Last Scans (col-span-1) */}
        <div className="md:col-span-1">
          <CardShell>
            <LastScansCard
              scans={scans}
              onAssign={(scan) => {
                setSelectedScan(scan);
                setAssignOpen(true);
              }}
            />
          </CardShell>
        </div>

        {/* RIGHT: Sessions Panel (col-span-2) */}
        <div className="md:col-span-2">
          <CardShell>
            <SessionsPanel
              filteredSessions={filteredSessions}
              mode={mode}
              setMode={setMode}
              employeeRole={employeeRole}
              setEmployeeRole={setEmployeeRole}
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
              staffCount={staffCount}
              techCount={techCount}
              studentTechCount={studentTechCount}
              setModalSession={setModalSession}
              formatDuration={formatDuration}
              readableType={readableType}
              quickRange={quickRange}
              applyQuickRange={applyQuickRange}
            />
          </CardShell>
        </div>
      </div>

      <SessionModal session={modalSession} onClose={() => setModalSession(null)} />

      <AssignBadgeModal
        open={assignOpen}
        onClose={() => {
          setAssignOpen(false);
          setSelectedScan(null);
        }}
        badgeCode={selectedScan?.badgeCode}
        users={allUsers}
        search={assignSearch}
        setSearch={setAssignSearch}
        onAssign={handleAssignToUser}
      />
    </div>
  );
}

// —————————————————————————————————————————————
// Sub-components
// —————————————————————————————————————————————

function LastScansCard({ scans, onAssign }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-2xl font-bold">Last Scans</h2>
        {scans?.[0]?.status && (
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold ${
              scans[0].status === 'matched'
                ? 'bg-emerald-100 text-emerald-700'
                : scans[0].status === 'assigned'
                ? 'bg-blue-100 text-blue-700'
                : scans[0].status === 'error'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-amber-100 text-amber-700'
            }`}
          >
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
          <div className="text-sm text-slate-500 mt-1">
            When the kiosk scans a badge, it’ll appear here instantly.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {scans.map((scan) => {
            const name = scan?.user?.fullName || scan?.user?.name || 'No match';
            const rel = formatRelativeSmart(scan?.createdAt);
            const unmatched = !scan?.user?.id && !scan?.matchedUserId;

            return (
              <motion.div
                key={scan.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-[2rem] border border-slate-200 bg-white/70 p-5 shadow"
              >
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
                        <button
                          onClick={() => onAssign(scan)}
                          className="rounded-full px-3 py-1.5 text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 transition"
                        >
                          Assign User
                        </button>
                        <Link
                          href="/signup"
                          className="ml-2 rounded-full px-3 py-1.5 text-xs font-semibold bg-purple-100 text-purple-700 hover:bg-purple-200 transition inline-flex items-center gap-2"
                        >
                          <UserPlus className="w-4 h-4" />
                          New Member
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
  mode,
  setMode,
  employeeRole,
  setEmployeeRole,
  showDatePicker,
  setShowDatePicker,
  dateRange,
  setDateRange,
  searchTerm,
  setSearchTerm,
  exportCSV,
  viewMode,
  setViewMode,
  memberCount,
  employeeCount,
  staffCount,
  techCount,
  studentTechCount,
  setModalSession,
  formatDuration,
  readableType,
  quickRange,
  applyQuickRange,
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      {/* Header + Tools */}
      <div className="flex flex-wrap justify-between items-center gap-2 relative">
        <h1 className="text-3xl font-bold">Sessions</h1>

        <div className="flex-1 flex items-center gap-2">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search name…"
          />

          <div className="flex items-center gap-2 ml-auto relative">
            {/* Quick Range Control */}
            <button
              onClick={() => setMenuOpen((v) => !v)}
              onMouseEnter={() => setMenuOpen(true)}
              onMouseLeave={() => setMenuOpen(false)}
              className="rounded-[1rem] px-3 py-2 border border-slate-300 bg-white/70 hover:bg-white/80 shadow-sm flex items-center gap-2"
            >
              <CalendarRange className="w-5 h-5" />
              <span className="text-sm font-medium capitalize">
                {quickRange === 'week' ? 'This week' : quickRange}
              </span>
              <ChevronDown className="w-4 h-4 opacity-70" />
            </button>

            {/* Hover menu */}
            <AnimatePresence>
              {menuOpen && (
                <motion.div
                  onMouseEnter={() => setMenuOpen(true)}
                  onMouseLeave={() => setMenuOpen(false)}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-28 top-12 z-10 rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden"
                >
                  {[
                    ['today', 'Today'],
                    ['yesterday', 'Yesterday'],
                    ['week', 'This week'],
                    ['custom', 'Custom…'],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => {
                        applyQuickRange(key);
                        setMenuOpen(false);
                      }}
                      className={`block w-full text-left px-4 py-2 text-sm hover:bg-slate-50 ${
                        quickRange === key ? 'bg-slate-50 font-semibold' : ''
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            <button
              onClick={exportCSV}
              className="rounded-[1rem] p-2 border border-slate-300 bg-white/70 hover:bg-white/80 shadow-sm"
            >
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
        <StatBox label="Staff" count={staffCount} />
        <StatBox label="Techs" count={techCount} />
        <StatBox label="Student Techs" count={studentTechCount} />
      </div>

      {/* Capsule filters */}
      <div className="mt-4">
        <FilterPills
          value={mode}
          onChange={(v) => {
            setMode(v);
            setEmployeeRole('all');
          }}
          options={[
            { value: 'all', label: 'All' },
            { value: 'members', label: 'Members' },
            { value: 'employees', label: 'Employees' },
          ]}
        />
        <AnimatePresence>
          {mode === 'employees' && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="mt-2"
            >
              <FilterPills
                value={employeeRole}
                onChange={setEmployeeRole}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'staff', label: 'Staff' },
                  { value: 'tech', label: 'Tech' },
                  { value: 'student tech', label: 'Student Tech' },
                ]}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Date picker (only for Custom) */}
      <AnimatePresence>
        {showDatePicker && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="mt-3"
          >
            <DateRange
              ranges={dateRange}
              onChange={(item) => setDateRange([item.selection])}
              maxDate={new Date()}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sessions list */}
      <div className="mt-4">
        {viewMode === 'card' ? (
          <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
            {filteredSessions.map((s) => {
              const start = toDateMaybe(s.startTime);
              const end = toDateMaybe(s.endTime);
              const duration = formatDuration(s.startTime, s.endTime);
              const name = s.member?.fullName || s.member?.name || 'Unknown';
              const membership = s.member?.membershipType || '—';

              return (
                <div
                  key={s.id}
                  onClick={() => setModalSession(s)}
                  className="cursor-pointer backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl p-4 hover:shadow-lg transition"
                >
                  <div className="flex items-center gap-2 mb-1 font-semibold text-black">
                    <BadgeCheck className="w-4 h-4 text-slate-500" />
                    {name}
                  </div>
                  <div className="text-xs text-slate-500 mb-1">
                    Membership: <span className="text-slate-700">{membership}</span>
                  </div>
                  <div className="text-sm text-slate-500 mb-1">
                    <ScanLine className="inline w-4 h-4 mr-1" />
                    {readableType(s.type)}
                  </div>
                  <div className="text-sm text-slate-500 mb-1">
                    <Clock className="inline w-4 h-4 mr-1" />
                    {start ? start.toLocaleString() : '—'}
                  </div>
                  <div className="text-sm mb-1">
                    {end ? (
                      <span className="text-black">{duration}</span>
                    ) : (
                      <span className="text-blue-500 font-medium">
                        Active • {duration}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
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
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((s) => {
                  const start = toDateMaybe(s.startTime);
                  const end = toDateMaybe(s.endTime);
                  const duration = formatDuration(s.startTime, s.endTime);
                  const name = s.member?.fullName || s.member?.name || 'Unknown';
                  const membership = s.member?.membershipType || '—';
                  const roles = (s.member?.roles || [])
                    .map((r) =>
                      typeof r === 'object' ? r?.name || r?.id || 'role' : r
                    )
                    .join(', ') || '—';

                  return (
                    <tr
                      key={s.id}
                      onClick={() => setModalSession(s)}
                      className="border-t border-slate-200 hover:bg-white/70 cursor-pointer"
                    >
                      <td className="px-2 py-1 font-semibold text-black">{name}</td>
                      <td className="px-2 py-1 text-slate-600">{membership}</td>
                      <td className="px-2 py-1 text-slate-600">{roles}</td>
                      <td className="px-2 py-1">{readableType(s.type)}</td>
                      <td className="px-2 py-1">{start ? start.toLocaleString() : '—'}</td>
                      <td className="px-2 py-1">{end ? end.toLocaleString() : 'Active'}</td>
                      <td className="px-2 py-1">{end ? duration : ''}</td>
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

function SessionModal({ session, onClose }) {
  const [activeTab, setActiveTab] = useState('current');
  if (!session) return null;

  const start = session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime);
  const end = session.endTime?.toDate ? session.endTime.toDate() : null;
  const type = session.type === 'ClockIn' ? 'Shift' : 'Regular';
  const statusVerb = session.type === 'ClockIn' ? 'Clocked' : 'Checked';

  const name = session.member?.fullName || session.member?.name || 'Unknown';
  const membership = session.member?.membershipType || '—';
  const roles = (session.member?.roles || [])
    .map((r) => (typeof r === 'object' ? r?.name || r?.id || 'role' : r))
    .join(', ') || '—';

  return (
    <ModalPortal>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 md:p-8 bg-white/40 backdrop-blur-lg supports-[backdrop-filter]:bg-white/30"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          onClick={onClose}
        >
          <motion.div
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 24, opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="bg-white/90 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 w-[min(92vw,40rem)] max-h-[85vh] overflow-y-auto p-6 space-y-4"
          >
            <h2 className="text-xl font-bold">Session Details</h2>

            <div className="space-y-1 text-sm text-slate-700">
              <div><strong>Name:</strong> {name}</div>
              <div><strong>Membership:</strong> {membership}</div>
              <div><strong>Roles:</strong> {roles}</div>
              <div><strong>Badge:</strong> {session.member?.badgeId || session.member?.badge?.id || 'N/A'}</div>
              <div><strong>Type:</strong> {type}</div>
              <Link href={`/users/${session.member?.id}`}>
                <button className="mt-2 text-blue-500 text-xs hover:underline">
                  View Profile
                </button>
              </Link>
            </div>

            <div className="flex gap-2 mt-4 border-b border-slate-200">
              {['Current Session', 'All Sessions'].map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab === 'Current Session' ? 'current' : 'all')}
                  className={`px-2 pb-1 text-sm ${
                    activeTab === (tab === 'Current Session' ? 'current' : 'all')
                      ? 'border-b-2 border-blue-500 text-blue-500'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
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
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-full bg-blue-500 text-white hover:bg-blue-600 text-sm transition"
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  );
}

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
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 md:p-8 bg-white/40 backdrop-blur-lg supports-[backdrop-filter]:bg-white/30"
          style={{ backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          onClick={onClose}
        >
          <motion.div
            key="card"
            initial={{ y: 32, opacity: 0, scale: 0.985 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="bg-white/90 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 w-[min(92vw,40rem)] max-h-[85vh] p-6 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold">Assign Badge</h3>
              <button
                className="text-slate-500 hover:text-slate-700"
                onClick={onClose}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="mt-1 text-sm text-slate-600">
              Badge Code: <span className="font-mono">{badgeCode || '—'}</span>
            </div>

            <div className="mt-4">
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search user by name, exact badge, or ID…"
              />
            </div>

            <div className="mt-4 max-h-[55vh] overflow-y-auto divide-y divide-slate-200">
              {filtered.length === 0 && (
                <div className="py-10 text-center text-slate-500">No matches.</div>
              )}

              {filtered.map((u) => (
                <div
                  key={u.id}
                  className="py-2.5 px-1 flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u.photoURL || '/default-avatar.png'}
                      alt={u.fullName || u.name}
                      className="w-9 h-9 rounded-full object-cover shrink-0 shadow-sm border border-white"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold truncate">{u.fullName || u.name}</div>
                      <div className="text-[11px] text-slate-600 truncate">
                        {(u.roles || [])
                          .map((r) => (typeof r === 'object' ? r?.name || r?.id || 'role' : r))
                          .join(', ') || 'Member'}
                        {hasBadge(u) && <span className="ml-2 text-emerald-600">• has badge</span>}
                      </div>
                    </div>
                  </div>
                  <button
                    className="rounded-full px-3 py-1.5 text-sm font-semibold bg-blue-500 text-white hover:bg-blue-600"
                    onClick={() => onAssign(u)}
                  >
                    Assign
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
              <div>
                Tip: If the person is brand new, hit{' '}
                <Link href="/signup" className="text-blue-600 hover:underline">
                  Signup
                </Link>{' '}
                and then assign.
              </div>
              <button
                className="rounded-full px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    </ModalPortal>
  );
}

function ModalPortal({ children }) {
  return typeof document !== 'undefined' ? createPortal(children, document.body) : null;
}
