'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CalendarCheck,
  Search,
  Plus,
  Sparkles,
  Wrench,
  Users,
  MapPin,
  Info,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  X,
  AlertTriangle,
  Clock,
  Filter,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  List as ListIcon,
} from 'lucide-react';

import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
  getDocs,
  doc,
  getDocFromServer,
} from 'firebase/firestore';

import { app } from '@/app/lib/firebase';

const db = getFirestore(app);

// Collections
const COL_MACHINES = 'machines';
const COL_USERS = 'users';
const COL_STUDIOS = 'studios';
const COL_RESERVATIONS = 'reservations';

// LocalStorage
const LS_CURRENT_USER = 'nova-user';

// Reservation types
const RES_TYPES = {
  machine: 'machine',
  tutoring: 'tutoring',
};

// Request modes
const REQUEST_MODES = {
  general: 'general',
  studio: 'studio',
  staff: 'staff',
  class: 'class', // later
};

// -------------------- helpers --------------------
const pad2 = (n) => String(n).padStart(2, '0');

function toLocalDateTimeInput(d) {
  if (!d) return '';
  const yyyy = d.getFullYear();
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
function fromLocalDateTimeInput(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function toDateSafe(v) {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v?.toDate === 'function') return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  if (typeof v === 'number') return new Date(v < 1e10 ? v * 1000 : v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}
function formatWhen(d) {
  const dt = toDateSafe(d);
  if (!dt) return '—';
  return dt.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
function minutesBetween(a, b) {
  const A = toDateSafe(a);
  const B = toDateSafe(b);
  if (!A || !B) return 0;
  return Math.max(0, Math.round((B - A) / 60000));
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  const as = toDateSafe(aStart)?.getTime();
  const ae = toDateSafe(aEnd)?.getTime();
  const bs = toDateSafe(bStart)?.getTime();
  const be = toDateSafe(bEnd)?.getTime();
  if (!as || !ae || !bs || !be) return false;
  return as < be && bs < ae;
}
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function sameDay(a, b) {
  const A = startOfDay(a).getTime();
  const B = startOfDay(b).getTime();
  return A === B;
}

// Image helpers (attachment)
async function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}
async function compressImageToDataURL(file, { maxWidth = 1400, quality = 0.78 } = {}) {
  const src = await fileToDataURL(file);
  const img = document.createElement('img');
  img.decoding = 'async';
  const loaded = new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });
  img.src = src;
  await loaded;

  const scale = Math.min(1, maxWidth / (img.naturalWidth || img.width || maxWidth));
  const targetW = Math.round((img.naturalWidth || img.width) * scale);
  const targetH = Math.round((img.naturalHeight || img.height) * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW || img.naturalWidth || img.width;
  canvas.height = targetH || img.naturalHeight || img.height;

  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL('image/jpeg', quality);
}

// Fetch freshest user when needed
async function getFreshUser(db, userLike) {
  if (!userLike?.id) return userLike;
  try {
    const snap = await getDocFromServer(doc(db, 'users', userLike.id));
    if (snap.exists()) return { id: snap.id, ...snap.data() };
  } catch (_) {}
  return userLike;
}

// -------------------- page --------------------
export default function ReservationsPage() {
  const router = useRouter();

  const [me, setMe] = useState(null);

  // data
  const [machines, setMachines] = useState([]);
  const [studios, setStudios] = useState([]);
  const [users, setUsers] = useState([]);
  const [reservations, setReservations] = useState([]);

  // schedule view
  const [viewMode, setViewMode] = useState('calendar'); // calendar | list
  const [filterType, setFilterType] = useState('all'); // all | machine | tutoring
  const [filterStudioId, setFilterStudioId] = useState('');
  const [search, setSearch] = useState('');
  const [focusDay, setFocusDay] = useState(() => startOfDay(new Date()));
  const [selectedRes, setSelectedRes] = useState(null);

  // wizard modal
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);

  // wizard form
  const [resType, setResType] = useState(RES_TYPES.machine);
  const [requestMode, setRequestMode] = useState(REQUEST_MODES.general);
  const [studioId, setStudioId] = useState('');
  const [machineId, setMachineId] = useState('');
  const [staffId, setStaffId] = useState('');
  const [classId, setClassId] = useState(''); // later
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');

  const [startAtStr, setStartAtStr] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 15);
    d.setSeconds(0);
    return toLocalDateTimeInput(d);
  });
  const [endAtStr, setEndAtStr] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 75);
    d.setSeconds(0);
    return toLocalDateTimeInput(d);
  });

  const [attachFile, setAttachFile] = useState(null);
  const [attachDataUrl, setAttachDataUrl] = useState('');

  // conflicts
  const [checking, setChecking] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const conflictTimerRef = useRef(null);

  const [saving, setSaving] = useState(false);

  // current user
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CURRENT_USER);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setMe(parsed);
    } catch {}
  }, []);

  // live: machines
  useEffect(() => {
    const qy = query(collection(db, COL_MACHINES), orderBy('name', 'asc'));
    const unsub = onSnapshot(qy, (snap) => {
      setMachines(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // live: studios
  useEffect(() => {
    const qy = query(collection(db, COL_STUDIOS), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qy, (snap) => {
      setStudios(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // live: users
  useEffect(() => {
    const qy = query(collection(db, COL_USERS), orderBy('fullName', 'asc'));
    const unsub = onSnapshot(qy, (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // live: upcoming reservations
  useEffect(() => {
    const now = new Date();
    const qy = query(
      collection(db, COL_RESERVATIONS),
      where('endAt', '>=', now),
      orderBy('endAt', 'asc'),
      limit(400)
    );
    const unsub = onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setReservations(list);
    });
    return () => unsub();
  }, []);

  // maps
  const studioMap = useMemo(() => new Map(studios.map((s) => [s.id, s])), [studios]);
  const machineMap = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  // staff candidates (simple heuristic)
  const staffCandidates = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    return users
      .map((u) => {
        const roleStr = String(u.role || '').toLowerCase();
        const rolesArr = Array.isArray(u.roles) ? u.roles.map((r) => String(r).toLowerCase()) : [];
        const rolesObj = u.roles && typeof u.roles === 'object' ? u.roles : null;

        const isStaff =
          ['staff', 'mentor', 'admin', 'superadmin'].includes(roleStr) ||
          rolesArr.some((r) => ['staff', 'mentor', 'admin', 'superadmin'].includes(r)) ||
          rolesObj?.staff ||
          rolesObj?.mentor ||
          rolesObj?.admin ||
          rolesObj?.superadmin;

        const name = u.fullName || u.name || 'Unnamed';
        const email = u.email || '';
        if (!isStaff) return null;
        if (q && !name.toLowerCase().includes(q) && !email.toLowerCase().includes(q)) return null;

        return {
          id: u.id,
          name,
          email,
          photoURL: u.photoURL || u.profileImageUrl || null,
        };
      })
      .filter(Boolean)
      .slice(0, 80);
  }, [users, search]);

  // schedule filtering
  const scheduleList = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    let list = reservations;

    if (filterType !== 'all') list = list.filter((r) => r.type === filterType);

    if (filterStudioId) {
      list = list.filter((r) => String(r.studioId || '') === String(filterStudioId));
    }

    if (q) {
      list = list.filter((r) => {
        const machine = r.machineId ? machineMap.get(r.machineId) : null;
        const staff = r.staffUserId ? userMap.get(r.staffUserId) : null;
        const studio = r.studioId ? studioMap.get(r.studioId) : null;

        return (
          String(r.title || '').toLowerCase().includes(q) ||
          String(r.notes || '').toLowerCase().includes(q) ||
          String(machine?.name || '').toLowerCase().includes(q) ||
          String(staff?.fullName || staff?.name || '').toLowerCase().includes(q) ||
          String(studio?.name || '').toLowerCase().includes(q)
        );
      });
    }

    return list;
  }, [reservations, filterType, filterStudioId, search, machineMap, userMap, studioMap]);

  // calendar “week strip”
  const weekDays = useMemo(() => {
    const start = addDays(focusDay, -3);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [focusDay]);

  const dayBuckets = useMemo(() => {
    const buckets = new Map();
    for (const day of weekDays) buckets.set(startOfDay(day).getTime(), []);
    scheduleList.forEach((r) => {
      const s = startOfDay(toDateSafe(r.startAt) || new Date()).getTime();
      if (buckets.has(s)) buckets.get(s).push(r);
    });
    // sort by startAt
    for (const [k, arr] of buckets.entries()) {
      arr.sort((a, b) => (toDateSafe(a.startAt)?.getTime() || 0) - (toDateSafe(b.startAt)?.getTime() || 0));
      buckets.set(k, arr);
    }
    return buckets;
  }, [scheduleList, weekDays]);

  // machine list for wizard
  const wizardMachineCandidates = useMemo(() => {
    const q = ''; // keep wizard selection clean; use internal search later if needed
    let list = machines.map((m) => ({
      ...m,
      name: m.name || 'Unnamed machine',
      description: m.description || '',
      studioId: m.studioId || m.studio || '',
    }));
    if (studioId) list = list.filter((m) => String(m.studioId) === String(studioId));
    if (q) {
      list = list.filter(
        (m) => (m.name || '').toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [machines, studioId]);

  // attachment compress
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!attachFile) {
        setAttachDataUrl('');
        return;
      }
      try {
        const compressed = await compressImageToDataURL(attachFile, { maxWidth: 1400, quality: 0.78 });
        if (!alive) return;
        setAttachDataUrl(compressed);
      } catch {
        if (!alive) return;
        setAttachDataUrl('');
      }
    })();
    return () => {
      alive = false;
    };
  }, [attachFile]);

  // auto-wire studio when machine chosen
  useEffect(() => {
    if (!machineId) return;
    const m = machineMap.get(machineId);
    const sId = m?.studioId || m?.studio || '';
    if (sId && studioId !== sId) setStudioId(sId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  // keep end after start
  useEffect(() => {
    const s = fromLocalDateTimeInput(startAtStr);
    const e = fromLocalDateTimeInput(endAtStr);
    if (!s || !e) return;
    if (e <= s) {
      const nextEnd = new Date(s.getTime() + 60 * 60000);
      setEndAtStr(toLocalDateTimeInput(nextEnd));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAtStr]);

  // conflict checks (debounced)
  useEffect(() => {
    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);

    const shouldCheck =
      (resType === RES_TYPES.machine && !!machineId) ||
      (resType === RES_TYPES.tutoring && requestMode === REQUEST_MODES.staff && !!staffId);

    if (!shouldCheck) {
      setConflicts([]);
      return;
    }

    conflictTimerRef.current = setTimeout(() => {
      checkConflicts().catch(() => {});
    }, 300);

    return () => {
      if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resType, requestMode, machineId, staffId, startAtStr, endAtStr]);

  async function checkConflicts() {
    const startAt = fromLocalDateTimeInput(startAtStr);
    const endAt = fromLocalDateTimeInput(endAtStr);
    if (!startAt || !endAt || endAt <= startAt) return;

    setChecking(true);
    try {
      const proposedEnd = endAt;

      let qy = null;
      if (resType === RES_TYPES.machine) {
        qy = query(
          collection(db, COL_RESERVATIONS),
          where('type', '==', RES_TYPES.machine),
          where('machineId', '==', machineId),
          where('startAt', '<', proposedEnd),
          orderBy('startAt', 'asc'),
          limit(50)
        );
      } else {
        qy = query(
          collection(db, COL_RESERVATIONS),
          where('type', '==', RES_TYPES.tutoring),
          where('staffUserId', '==', staffId),
          where('startAt', '<', proposedEnd),
          orderBy('startAt', 'asc'),
          limit(50)
        );
      }

      const snap = await getDocs(qy);
      const hits = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => {
          const status = String(r.status || 'pending').toLowerCase();
          if (!['pending', 'approved'].includes(status)) return false;
          return overlaps(r.startAt, r.endAt, startAt, endAt);
        });

      setConflicts(hits);
    } finally {
      setChecking(false);
    }
  }

  function resetWizard() {
    setStep(0);
    setResType(RES_TYPES.machine);
    setRequestMode(REQUEST_MODES.general);
    setStudioId('');
    setMachineId('');
    setStaffId('');
    setClassId('');
    setTitle('');
    setNotes('');
    setAttachFile(null);
    setAttachDataUrl('');
    setConflicts([]);

    const s = new Date();
    s.setMinutes(s.getMinutes() + 15);
    s.setSeconds(0);
    const e = new Date(s.getTime() + 60 * 60000);
    setStartAtStr(toLocalDateTimeInput(s));
    setEndAtStr(toLocalDateTimeInput(e));
  }

  function openWizard() {
    resetWizard();
    setWizardOpen(true);
  }
  function closeWizard() {
    setWizardOpen(false);
    setTimeout(() => resetWizard(), 200);
  }

  const selectedMachine = machineId ? machineMap.get(machineId) : null;
  const selectedStudio = studioId ? studioMap.get(studioId) : null;
  const selectedStaff = staffId ? userMap.get(staffId) : null;

  const startAt = fromLocalDateTimeInput(startAtStr);
  const endAt = fromLocalDateTimeInput(endAtStr);
  const durationMin = minutesBetween(startAt, endAt);

  // step validation
  const stepCanNext = useMemo(() => {
    if (step === 0) return true; // type
    if (step === 1) {
      if (resType === RES_TYPES.machine) return requestMode !== REQUEST_MODES.staff; // staff not allowed
      return true;
    }
    if (step === 2) {
      if (requestMode === REQUEST_MODES.studio && !studioId) return false;
      if (resType === RES_TYPES.machine && !machineId) return false;
      if (resType === RES_TYPES.tutoring && requestMode === REQUEST_MODES.staff && !staffId) return false;
      // general tutoring ok; studio tutoring ok if studio selected handled above
      return true;
    }
    if (step === 3) {
      if (!startAt || !endAt || endAt <= startAt) return false;
      // hard conflict only when resource-specific
      const hardConflict =
        (resType === RES_TYPES.machine && !!machineId && conflicts.length > 0) ||
        (resType === RES_TYPES.tutoring && requestMode === REQUEST_MODES.staff && !!staffId && conflicts.length > 0);
      if (hardConflict) return false;
      return true;
    }
    if (step === 4) return true; // details optional
    if (step === 5) return true; // review
    return true;
  }, [step, resType, requestMode, studioId, machineId, staffId, startAt, endAt, conflicts.length]);

  async function submitReservation() {
    if (!me?.id) {
      alert('No active user session found. Please scan in again.');
      return;
    }

    const freshMe = await getFreshUser(db, me);

    const s = fromLocalDateTimeInput(startAtStr);
    const e = fromLocalDateTimeInput(endAtStr);
    if (!s || !e || e <= s) {
      alert('Please choose a valid start and end time.');
      return;
    }

    if (resType === RES_TYPES.machine && !machineId) {
      alert('Please choose a machine.');
      return;
    }

    if (requestMode === REQUEST_MODES.studio && !studioId) {
      alert('Please choose a studio.');
      return;
    }

    if (resType === RES_TYPES.tutoring && requestMode === REQUEST_MODES.staff && !staffId) {
      alert('Please choose a staff member.');
      return;
    }

    // hard conflict guard
    const hardConflict =
      (resType === RES_TYPES.machine && !!machineId && conflicts.length > 0) ||
      (resType === RES_TYPES.tutoring && requestMode === REQUEST_MODES.staff && !!staffId && conflicts.length > 0);
    if (hardConflict) {
      alert('This time overlaps an existing reservation. Please choose another time.');
      return;
    }

    setSaving(true);
    try {
      const machine = machineId ? machineMap.get(machineId) : null;
      const studio = studioId ? studioMap.get(studioId) : null;
      const staff = staffId ? userMap.get(staffId) : null;

      const payload = {
        type: resType,
        requestMode,
        status: 'pending',
        title: title.trim() || (resType === RES_TYPES.machine ? 'Machine reservation' : 'Tutoring request'),
        notes: notes.trim() || '',
        startAt: s,
        endAt: e,

        studioId: studioId || null,
        machineId: resType === RES_TYPES.machine ? machineId : null,
        staffUserId: resType === RES_TYPES.tutoring ? (staffId || null) : null,
        classId: requestMode === REQUEST_MODES.class ? (classId || null) : null,

        studioSnapshot: studio
          ? { id: studio.id, name: studio.name || 'Studio', coverData: studio.coverData || studio.coverUrl || null }
          : null,
        machineSnapshot: machine
          ? {
              id: machine.id,
              name: machine.name || 'Machine',
              studioId: machine.studioId || machine.studio || null,
              thumbnailData: machine.thumbnailData || machine.thumbnail || machine.imageData || null,
              description: machine.description || '',
            }
          : null,
        staffSnapshot: staff
          ? {
              id: staff.id,
              name: staff.fullName || staff.name || 'Staff',
              photoURL: staff.photoURL || staff.profileImageUrl || null,
            }
          : null,

        requester: {
          id: freshMe.id,
          name: freshMe.fullName || freshMe.name || '',
          photoURL: freshMe.photoURL || freshMe.profileImageUrl || null,
          email: freshMe.email || null,
        },

        attachmentData: attachDataUrl || null,

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, COL_RESERVATIONS), payload);

      closeWizard();
      setSelectedRes(null);
      setViewMode('calendar');
      // jump calendar focus to reservation day
      setFocusDay(startOfDay(s));
    } catch (e2) {
      console.error('Create reservation failed:', e2);
      alert('Could not create reservation. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // -------------------- render --------------------
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
      <BokehBackground />

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="rounded-full px-4 h-10 grid place-items-center bg-white/70 backdrop-blur border border-slate-200 hover:bg-white shadow-sm"
              aria-label="Back to dashboard"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight gradient-text">
                Reservations
              </h1>
              <p className="text-slate-600 mt-1">
                View the schedule, then create a reservation in a guided flow.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                placeholder="Search schedule…"
                className="h-11 pl-9 pr-3 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur focus:outline-none focus:ring-4 focus:ring-blue-100"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <button
              onClick={openWizard}
              className="h-11 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              New Reservation
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 rounded-[2rem] border border-slate-200 bg-white/70 backdrop-blur shadow-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Segmented
                  value={viewMode}
                  onChange={setViewMode}
                  options={[
                    { value: 'calendar', label: 'Calendar', icon: <CalendarCheck className="w-4 h-4" /> },
                    { value: 'list', label: 'List', icon: <ListIcon className="w-4 h-4" /> },
                  ]}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <PillToggle
                  active={filterType === 'all'}
                  onClick={() => setFilterType('all')}
                  label="All"
                />
                <PillToggle
                  active={filterType === 'machine'}
                  onClick={() => setFilterType('machine')}
                  label="Machines"
                />
                <PillToggle
                  active={filterType === 'tutoring'}
                  onClick={() => setFilterType('tutoring')}
                  label="Tutoring"
                />

                <select
                  value={filterStudioId}
                  onChange={(e) => setFilterStudioId(e.target.value)}
                  className="h-10 px-4 rounded-full border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100 text-sm font-semibold text-slate-800"
                >
                  <option value="">All studios</option>
                  {studios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || 'Studio'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mt-4">
              {viewMode === 'calendar' ? (
                <CalendarStrip
                  focusDay={focusDay}
                  setFocusDay={setFocusDay}
                  weekDays={weekDays}
                  dayBuckets={dayBuckets}
                  machineMap={machineMap}
                  studioMap={studioMap}
                  userMap={userMap}
                  onSelect={(r) => setSelectedRes(r)}
                />
              ) : (
                <ReservationListModern
                  list={scheduleList}
                  machineMap={machineMap}
                  studioMap={studioMap}
                  userMap={userMap}
                  onSelect={(r) => setSelectedRes(r)}
                />
              )}
            </div>
          </div>

          {/* Detail side card */}
          <div className="lg:col-span-4">
            <AnimatePresence mode="wait">
              {selectedRes ? (
                <motion.div
                  key={selectedRes.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="rounded-[2rem] border border-slate-200 bg-white/70 backdrop-blur shadow-xl p-5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">Reservation</div>
                      <div className="text-lg font-bold text-slate-900 mt-1">
                        {selectedRes.title || 'Reservation'}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">
                        {formatWhen(selectedRes.startAt)} → {formatWhen(selectedRes.endAt)}
                      </div>
                    </div>
                    <button
                      onClick={() => setSelectedRes(null)}
                      className="h-10 w-10 grid place-items-center rounded-full bg-white/70 border border-slate-200 hover:bg-white"
                      aria-label="Close"
                    >
                      <X className="w-4 h-4 text-slate-600" />
                    </button>
                  </div>

                  <div className="mt-4 space-y-2">
                    <DetailRow
                      icon={<Clock className="w-4 h-4 text-slate-500" />}
                      label="Duration"
                      value={`${minutesBetween(selectedRes.startAt, selectedRes.endAt)} min`}
                    />
                    <DetailRow
                      icon={selectedRes.type === 'tutoring' ? <GraduationCap className="w-4 h-4 text-slate-500" /> : <Wrench className="w-4 h-4 text-slate-500" />}
                      label="Type"
                      value={selectedRes.type === 'tutoring' ? 'Tutoring' : 'Machine'}
                    />
                    <DetailRow
                      icon={<MapPin className="w-4 h-4 text-slate-500" />}
                      label="Studio"
                      value={selectedRes.studioSnapshot?.name || studioMap.get(selectedRes.studioId)?.name || '—'}
                    />
                    {selectedRes.type === 'machine' ? (
                      <DetailRow
                        icon={<Wrench className="w-4 h-4 text-slate-500" />}
                        label="Machine"
                        value={selectedRes.machineSnapshot?.name || machineMap.get(selectedRes.machineId)?.name || '—'}
                      />
                    ) : (
                      <DetailRow
                        icon={<Users className="w-4 h-4 text-slate-500" />}
                        label="Staff"
                        value={
                          selectedRes.requestMode === 'staff'
                            ? selectedRes.staffSnapshot?.name || userMap.get(selectedRes.staffUserId)?.fullName || '—'
                            : 'General / studio help'
                        }
                      />
                    )}

                    {selectedRes.notes ? (
                      <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-white/70 p-4 text-sm text-slate-700 whitespace-pre-wrap">
                        {selectedRes.notes}
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[1.2rem] border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-500">
                        No notes.
                      </div>
                    )}

                    {selectedRes.attachmentData ? (
                      <div className="mt-3 rounded-[1.2rem] border border-slate-200 bg-white/70 overflow-hidden">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selectedRes.attachmentData} alt="Attachment" className="w-full h-44 object-cover" />
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="empty-detail"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="rounded-[2rem] border border-slate-200 bg-white/60 backdrop-blur shadow-xl p-6"
                >
                  <div className="flex items-center gap-2">
                    <Info className="w-4 h-4 text-slate-600" />
                    <div className="font-bold text-slate-900">Select an item</div>
                  </div>
                  <p className="text-sm text-slate-600 mt-2">
                    Click a reservation in the calendar or list to see details here.
                  </p>

                  <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
                    Tip: Use filters to narrow by studio or type, then create a new reservation with the guided flow.
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Wizard Overlay */}
      <AnimatePresence>
        {wizardOpen && (
          <WizardOverlay onClose={closeWizard}>
            <WizardShell
              step={step}
              setStep={setStep}
              canNext={stepCanNext}
              onSubmit={submitReservation}
              saving={saving}
              onClose={closeWizard}
            >
              <WizardStep
                step={step}
                index={0}
                title="What do you want to reserve?"
                subtitle="Pick the reservation type."
                icon={<Sparkles className="w-5 h-5 text-amber-600" />}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <ChoiceCard
                    active={resType === RES_TYPES.machine}
                    onClick={() => {
                      setResType(RES_TYPES.machine);
                      if (requestMode === REQUEST_MODES.staff) setRequestMode(REQUEST_MODES.general);
                    }}
                    title="Machine"
                    subtitle="Reserve a machine and time"
                    icon={<Wrench className="w-5 h-5" />}
                  />
                  <ChoiceCard
                    active={resType === RES_TYPES.tutoring}
                    onClick={() => setResType(RES_TYPES.tutoring)}
                    title="Tutoring"
                    subtitle="Request staff help"
                    icon={<GraduationCap className="w-5 h-5" />}
                  />
                </div>
              </WizardStep>

              <WizardStep
                step={step}
                index={1}
                title="How specific should this be?"
                subtitle="Choose targeting for routing and assignment."
                icon={<Filter className="w-5 h-5 text-slate-600" />}
              >
                <div className="flex flex-wrap gap-2">
                  <SmallToggle
                    active={requestMode === REQUEST_MODES.general}
                    onClick={() => setRequestMode(REQUEST_MODES.general)}
                    label="General"
                  />
                  <SmallToggle
                    active={requestMode === REQUEST_MODES.studio}
                    onClick={() => setRequestMode(REQUEST_MODES.studio)}
                    label="Studio"
                  />
                  {resType === RES_TYPES.tutoring && (
                    <SmallToggle
                      active={requestMode === REQUEST_MODES.staff}
                      onClick={() => setRequestMode(REQUEST_MODES.staff)}
                      label="Staff"
                    />
                  )}
                  <SmallToggle active={false} onClick={() => {}} label="Class (later)" disabled />
                </div>

                <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
                  {resType === RES_TYPES.machine
                    ? 'For machine reservations, you’ll pick a machine. Studio targeting helps filter machines.'
                    : 'For tutoring, you can request a specific staff member or keep it general.'}
                </div>
              </WizardStep>

              <WizardStep
                step={step}
                index={2}
                title="Choose the resource"
                subtitle="Pick a studio, machine, or staff depending on your choices."
                icon={<MapPin className="w-5 h-5 text-emerald-700" />}
              >
                <div className="grid grid-cols-1 gap-4">
                  {(requestMode === REQUEST_MODES.studio || resType === RES_TYPES.machine) && (
                    <div>
                      <LabelRow label="Studio (optional)" hint="Used for routing + filtering" />
                      <select
                        value={studioId}
                        onChange={(e) => setStudioId(e.target.value)}
                        className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                      >
                        <option value="">No studio selected</option>
                        {studios.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name || 'Studio'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {resType === RES_TYPES.machine && (
                    <div>
                      <LabelRow label="Machine" hint="Pick from /machines" />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {wizardMachineCandidates.slice(0, 8).map((m) => (
                          <ResourceCard
                            key={m.id}
                            active={machineId === m.id}
                            title={m.name}
                            subtitle={studioMap.get(m.studioId)?.name || 'No studio'}
                            image={
                              m.thumbnailData || m.thumbnail || m.imageData || '/placeholder.png'
                            }
                            onClick={() => setMachineId(m.id)}
                            rightTag={m.logHours != null ? `${m.logHours}h` : null}
                          />
                        ))}
                      </div>

                      {wizardMachineCandidates.length > 8 ? (
                        <div className="mt-3 text-xs text-slate-500">
                          Showing 8 machines. Narrow by studio to find the one you need.
                        </div>
                      ) : null}
                    </div>
                  )}

                  {resType === RES_TYPES.tutoring && requestMode === REQUEST_MODES.staff && (
                    <div>
                      <LabelRow label="Staff member" hint="From /users (staff/mentor/admin)" />
                      <select
                        value={staffId}
                        onChange={(e) => setStaffId(e.target.value)}
                        className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                      >
                        <option value="">Choose a staff member…</option>
                        {staffCandidates.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} {s.email ? `• ${s.email}` : ''}
                          </option>
                        ))}
                      </select>

                      {selectedStaff ? (
                        <div className="mt-3 rounded-2xl border border-slate-200 bg-white/70 p-3 flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={selectedStaff.photoURL || '/default-avatar.png'}
                            alt={selectedStaff.fullName || selectedStaff.name || 'Staff'}
                            className="w-10 h-10 rounded-xl object-cover border border-slate-200"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold truncate">
                              {selectedStaff.fullName || selectedStaff.name || 'Staff'}
                            </div>
                            <div className="text-xs text-slate-600 truncate">{selectedStaff.email || '—'}</div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {resType === RES_TYPES.tutoring && requestMode !== REQUEST_MODES.staff && (
                    <div className="rounded-[1.2rem] border border-slate-200 bg-white/70 p-4 text-sm text-slate-700">
                      This tutoring request will be routed as <span className="font-semibold">general</span>
                      {requestMode === REQUEST_MODES.studio && studioId ? (
                        <> to <span className="font-semibold">{selectedStudio?.name || 'that studio'}</span></>
                      ) : null}
                      .
                    </div>
                  )}
                </div>
              </WizardStep>

              <WizardStep
                step={step}
                index={3}
                title="Pick a time"
                subtitle="We’ll block overlaps for machine and staff-specific reservations."
                icon={<Clock className="w-5 h-5 text-slate-600" />}
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <div className="text-xs font-semibold text-slate-500 mb-2">Start</div>
                    <input
                      type="datetime-local"
                      value={startAtStr}
                      onChange={(e) => setStartAtStr(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <div className="text-xs font-semibold text-slate-500 mb-2">End</div>
                    <input
                      type="datetime-local"
                      value={endAtStr}
                      onChange={(e) => setEndAtStr(e.target.value)}
                      className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-slate-600 flex items-center gap-2">
                    <Clock className="w-4 h-4 text-slate-500" />
                    Duration: <span className="font-semibold">{durationMin}</span> min
                    {checking ? <span className="ml-2 text-slate-500">Checking conflicts…</span> : null}
                  </span>

                  <div className="ml-auto flex flex-wrap gap-2">
                    <DurationChip onClick={() => bumpDuration(30)} label="30m" />
                    <DurationChip onClick={() => bumpDuration(60)} label="60m" />
                    <DurationChip onClick={() => bumpDuration(90)} label="90m" />
                    <DurationChip onClick={() => bumpDuration(120)} label="2h" />
                  </div>
                </div>

                <AnimatePresence>
                  {conflicts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="mt-4 rounded-[1.6rem] border border-rose-200 bg-rose-50/70 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5" />
                        <div className="min-w-0">
                          <div className="font-bold text-rose-900">Time conflict</div>
                          <div className="text-sm text-rose-800 mt-1">
                            This overlaps with {conflicts.length} existing reservation{conflicts.length === 1 ? '' : 's'}.
                          </div>
                          <div className="mt-3 space-y-2">
                            {conflicts.slice(0, 3).map((r) => (
                              <div key={r.id} className="rounded-xl border border-rose-200 bg-white/70 p-3">
                                <div className="text-sm font-semibold text-slate-900">{r.title || 'Reservation'}</div>
                                <div className="text-xs text-slate-600 mt-1">
                                  {formatWhen(r.startAt)} → {formatWhen(r.endAt)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </WizardStep>

              <WizardStep
                step={step}
                index={4}
                title="Add details"
                subtitle="Optional, but helpful for staff routing."
                icon={<Info className="w-5 h-5 text-slate-600" />}
              >
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <LabelRow label="Title (optional)" hint="Short label" />
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder={resType === RES_TYPES.machine ? 'e.g., Laser cutter project' : 'e.g., Help with Fusion 360'}
                      className="w-full h-11 px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </div>
                  <div>
                    <LabelRow label="Notes" hint="Describe what you need" />
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add details, goals, constraints, materials, etc."
                      className="w-full min-h-[110px] px-4 py-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </div>

                  <div>
                    <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Upload className="w-4 h-4 text-slate-500" />
                      Optional attachment (image)
                    </div>
                    <p className="text-xs text-slate-500 mt-1">Compressed and stored directly on the reservation doc.</p>

                    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 cursor-pointer hover:bg-white">
                        <Upload className="w-5 h-5 text-slate-500" />
                        <span className="text-sm text-slate-600">
                          {attachFile ? attachFile.name : 'Choose an image file (JPG/PNG)'}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => setAttachFile(e.target.files?.[0] || null)}
                        />
                      </label>

                      <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                        <div className="text-xs font-semibold text-slate-500 mb-2">Preview</div>
                        <div className="relative h-28 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                          {attachDataUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={attachDataUrl} alt="Attachment" className="absolute inset-0 w-full h-full object-cover" />
                          ) : (
                            <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">No attachment</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </WizardStep>

              <WizardStep
                step={step}
                index={5}
                title="Review and submit"
                subtitle="Confirm everything looks correct."
                icon={<CheckCircle2 className="w-5 h-5 text-emerald-600" />}
              >
                <div className="rounded-[1.6rem] border border-slate-200 bg-white/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-500">Summary</div>
                      <div className="text-lg font-bold text-slate-900 mt-1">
                        {title.trim() || (resType === RES_TYPES.machine ? 'Machine reservation' : 'Tutoring request')}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">
                        {formatWhen(startAt)} → {formatWhen(endAt)} ({durationMin} min)
                      </div>
                    </div>
                    <div className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white">
                      Pending
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                    <MiniRow label="Type" value={resType === 'tutoring' ? 'Tutoring' : 'Machine'} />
                    <MiniRow label="Targeting" value={requestMode} />
                    <MiniRow label="Studio" value={selectedStudio?.name || '—'} />
                    {resType === RES_TYPES.machine ? (
                      <MiniRow label="Machine" value={selectedMachine?.name || '—'} />
                    ) : (
                      <MiniRow
                        label="Staff"
                        value={requestMode === REQUEST_MODES.staff ? (selectedStaff?.fullName || selectedStaff?.name || '—') : 'General / studio help'}
                      />
                    )}
                  </div>

                  {notes ? (
                    <div className="mt-4 rounded-[1.2rem] border border-slate-200 bg-white/70 p-4 text-sm text-slate-700 whitespace-pre-wrap">
                      {notes}
                    </div>
                  ) : null}

                  {conflicts.length > 0 ? (
                    <div className="mt-4 rounded-[1.2rem] border border-rose-200 bg-rose-50/70 p-4 text-sm text-rose-800">
                      This time conflicts with existing reservations. Go back and choose another time.
                    </div>
                  ) : null}
                </div>
              </WizardStep>
            </WizardShell>
          </WizardOverlay>
        )}
      </AnimatePresence>

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

  function bumpDuration(mins) {
    const s = fromLocalDateTimeInput(startAtStr);
    if (!s) return;
    const e = new Date(s.getTime() + mins * 60000);
    setEndAtStr(toLocalDateTimeInput(e));
  }
}

// -------------------- schedule components --------------------
function CalendarStrip({ focusDay, setFocusDay, weekDays, dayBuckets, machineMap, studioMap, userMap, onSelect }) {
  return (
    <div className="rounded-[1.6rem] border border-slate-200 bg-white/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFocusDay(addDays(focusDay, -1))}
            className="h-10 w-10 grid place-items-center rounded-full bg-white/70 border border-slate-200 hover:bg-white"
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4 text-slate-700" />
          </button>
          <button
            onClick={() => setFocusDay(startOfDay(new Date()))}
            className="h-10 px-4 rounded-full bg-white/70 border border-slate-200 hover:bg-white text-sm font-semibold"
          >
            Today
          </button>
          <button
            onClick={() => setFocusDay(addDays(focusDay, 1))}
            className="h-10 w-10 grid place-items-center rounded-full bg-white/70 border border-slate-200 hover:bg-white"
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4 text-slate-700" />
          </button>
        </div>

        <div className="text-sm font-semibold text-slate-700">
          {focusDay.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-7">
        {weekDays.map((d) => {
          const key = startOfDay(d).getTime();
          const items = dayBuckets.get(key) || [];
          const isFocus = sameDay(d, focusDay);

          return (
            <button
              key={key}
              onClick={() => setFocusDay(startOfDay(d))}
              className={`text-left p-3 border-b md:border-b-0 md:border-r border-slate-200/70 hover:bg-white/60 transition ${
                isFocus ? 'bg-white/80' : 'bg-white/40'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-500">
                  {d.toLocaleDateString([], { weekday: 'short' })}
                </div>
                <div className={`text-xs font-bold ${isFocus ? 'text-slate-900' : 'text-slate-600'}`}>
                  {d.getDate()}
                </div>
              </div>

              <div className="mt-2 space-y-1.5">
                {items.slice(0, 3).map((r) => (
                  <div
                    key={r.id}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelect(r);
                    }}
                    className="rounded-xl border border-slate-200 bg-white/70 p-2"
                  >
                    <div className="text-xs font-semibold text-slate-900 truncate">
                      {r.title || 'Reservation'}
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5 truncate">
                      {formatTimeRange(r.startAt, r.endAt)} •{' '}
                      {r.type === 'tutoring'
                        ? r.requestMode === 'staff'
                          ? r.staffSnapshot?.name || userMap.get(r.staffUserId)?.fullName || 'Staff'
                          : 'Tutoring'
                        : r.machineSnapshot?.name || machineMap.get(r.machineId)?.name || 'Machine'}
                    </div>
                  </div>
                ))}
                {items.length > 3 ? (
                  <div className="text-[11px] text-slate-500">+{items.length - 3} more</div>
                ) : null}
                {items.length === 0 ? (
                  <div className="text-[11px] text-slate-400">No reservations</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {/* Focus day detail list */}
      <div className="p-4 border-t border-slate-200/70 bg-white/55">
        <div className="text-sm font-bold text-slate-900">Day schedule</div>
        <div className="text-xs text-slate-600 mt-1">
          {focusDay.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
        </div>

        <div className="mt-3 space-y-2">
          {(dayBuckets.get(startOfDay(focusDay).getTime()) || []).length === 0 ? (
            <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-white/60 p-4 text-sm text-slate-600">
              No reservations on this day.
            </div>
          ) : (
            (dayBuckets.get(startOfDay(focusDay).getTime()) || []).map((r) => (
              <button
                key={r.id}
                onClick={() => onSelect(r)}
                className="w-full text-left rounded-[1.2rem] border border-slate-200 bg-white/70 hover:bg-white transition p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{r.title || 'Reservation'}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {formatWhen(r.startAt)} → {formatWhen(r.endAt)}
                    </div>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white">
                    {r.type === 'tutoring' ? 'Tutoring' : 'Machine'}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ReservationListModern({ list, machineMap, studioMap, userMap, onSelect }) {
  return (
    <div className="rounded-[1.6rem] border border-slate-200 bg-white/60 overflow-hidden">
      <div className="p-4 border-b border-slate-200/70 flex items-center justify-between">
        <div className="text-sm font-bold text-slate-900">Schedule</div>
        <div className="text-xs text-slate-600">{list.length} item{list.length === 1 ? '' : 's'}</div>
      </div>

      <div className="p-4">
        {list.length === 0 ? (
          <div className="rounded-[1.2rem] border border-dashed border-slate-300 bg-white/60 p-6 text-slate-600">
            No reservations found.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {list.map((r) => {
              const machine = r.machineId ? machineMap.get(r.machineId) : null;
              const studio = r.studioId ? studioMap.get(r.studioId) : null;
              const staff = r.staffUserId ? userMap.get(r.staffUserId) : null;

              const cover =
                r.machineSnapshot?.thumbnailData ||
                machine?.thumbnailData ||
                machine?.thumbnail ||
                r.studioSnapshot?.coverData ||
                studio?.coverData ||
                '/placeholder.png';

              return (
                <button
                  key={r.id}
                  onClick={() => onSelect(r)}
                  className="text-left rounded-[1.6rem] overflow-hidden border border-slate-200 bg-white/75 backdrop-blur hover:bg-white transition shadow-xl"
                >
                  <div className="relative h-36 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={cover} alt={r.title || 'Reservation'} className="absolute inset-0 w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
                    <div className="absolute top-3 left-3 flex gap-2">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/85 border border-white/50 text-slate-800">
                        {r.type === 'tutoring' ? 'Tutoring' : 'Machine'}
                      </span>
                    </div>
                  </div>

                  <div className="p-4">
                    <div className="font-bold text-slate-900 truncate">{r.title || 'Reservation'}</div>
                    <div className="text-xs text-slate-600 mt-1">
                      {formatWhen(r.startAt)} → {formatWhen(r.endAt)}
                    </div>

                    <div className="mt-3 space-y-2 text-sm">
                      {r.type === 'machine' ? (
                        <DetailRow
                          icon={<Wrench className="w-4 h-4 text-slate-500" />}
                          label="Machine"
                          value={r.machineSnapshot?.name || machine?.name || '—'}
                        />
                      ) : (
                        <DetailRow
                          icon={<GraduationCap className="w-4 h-4 text-slate-500" />}
                          label="Tutoring"
                          value={
                            r.requestMode === 'staff'
                              ? `With ${r.staffSnapshot?.name || staff?.fullName || staff?.name || '—'}`
                              : r.requestMode === 'studio'
                              ? 'Studio help'
                              : 'General help'
                          }
                        />
                      )}
                      <DetailRow
                        icon={<MapPin className="w-4 h-4 text-slate-500" />}
                        label="Studio"
                        value={r.studioSnapshot?.name || studio?.name || '—'}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatTimeRange(a, b) {
  const A = toDateSafe(a);
  const B = toDateSafe(b);
  if (!A || !B) return '—';
  const t1 = A.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const t2 = B.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${t1}–${t2}`;
}

// -------------------- wizard components --------------------
function WizardOverlay({ children, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[10020] bg-slate-900/10 backdrop-blur-sm grid place-items-center px-4"
      onMouseDown={(e) => {
        // click outside to close
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </motion.div>
  );
}

function WizardShell({ step, setStep, canNext, onSubmit, saving, onClose, children }) {
  const maxStep = 5;

  return (
    <motion.div
      initial={{ y: 18, opacity: 0, scale: 0.99 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 12, opacity: 0, scale: 0.99 }}
      transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      className="w-full max-w-3xl rounded-[2rem] bg-white/85 backdrop-blur-xl border border-white/50 shadow-2xl overflow-hidden"
    >
      <div className="px-6 py-5 border-b border-slate-200/70 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          <div className="font-bold text-slate-900">New reservation</div>
          <div className="text-xs font-semibold text-slate-500">Step {step + 1} of {maxStep + 1}</div>
        </div>

        <button
          onClick={onClose}
          className="h-10 w-10 grid place-items-center rounded-full bg-white/70 border border-slate-200 hover:bg-white"
          aria-label="Close"
        >
          <X className="w-4 h-4 text-slate-700" />
        </button>
      </div>

      <div className="px-6 py-4">
        <ProgressDots step={step} total={maxStep + 1} />
      </div>

      <div className="px-6 pb-6">
        {children}
      </div>

      <div className="px-6 py-5 border-t border-slate-200/70 bg-white/60 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 disabled:opacity-50"
          disabled={step === 0 || saving}
        >
          Back
        </button>

        <div className="flex items-center gap-2 ml-auto">
          {step < maxStep ? (
            <button
              onClick={() => setStep((s) => Math.min(maxStep, s + 1))}
              className="h-11 px-5 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90 disabled:opacity-50"
              disabled={!canNext || saving}
            >
              Next
            </button>
          ) : (
            <button
              onClick={onSubmit}
              className="h-11 px-5 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
              disabled={!canNext || saving}
            >
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function WizardStep({ step, index, title, subtitle, icon, children }) {
  const dir = step > index ? 1 : -1;
  const isActive = step === index;

  return (
    <AnimatePresence mode="popLayout">
      {isActive && (
        <motion.div
          key={index}
          initial={{ opacity: 0, x: 40 * dir }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 * dir }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        >
          <div className="flex items-start gap-3">
            <div className="rounded-2xl border border-slate-200 bg-white/70 p-2">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="text-xl font-bold text-slate-900">{title}</div>
              <div className="text-sm text-slate-600 mt-1">{subtitle}</div>
            </div>
          </div>

          <div className="mt-5">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ProgressDots({ step, total }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2.5 rounded-full transition-all ${
            i === step ? 'w-8 bg-slate-900' : 'w-2.5 bg-slate-200'
          }`}
        />
      ))}
    </div>
  );
}

// -------------------- UI atoms --------------------
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

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-full border border-slate-200 bg-white/70 p-1 shadow-sm">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`h-9 px-4 rounded-full text-sm font-semibold transition inline-flex items-center gap-2 ${
              active ? 'bg-slate-900 text-white' : 'bg-transparent text-slate-700 hover:bg-white'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function PillToggle({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 rounded-full border text-sm font-semibold transition ${
        active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/70 text-slate-800 border-slate-200 hover:bg-white'
      }`}
    >
      {label}
    </button>
  );
}

function SmallToggle({ active, onClick, label, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`h-10 px-4 rounded-full border text-sm font-semibold transition ${
        disabled
          ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
          : active
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white/70 text-slate-800 border-slate-200 hover:bg-white'
      }`}
    >
      {label}
    </button>
  );
}

function ChoiceCard({ active, onClick, title, subtitle, icon }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-[1.6rem] border p-4 transition backdrop-blur ${
        active
          ? 'bg-slate-900 text-white border-slate-900 shadow-lg'
          : 'bg-white/70 text-slate-900 border-slate-200 hover:bg-white shadow-sm'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className={`rounded-2xl p-2 border ${active ? 'border-white/20 bg-white/10' : 'border-slate-200 bg-white/80'}`}>
          <div className={active ? 'text-white' : 'text-slate-700'}>{icon}</div>
        </div>
        <div className="min-w-0">
          <div className="font-bold">{title}</div>
          <div className={`text-sm mt-1 ${active ? 'text-white/80' : 'text-slate-600'}`}>{subtitle}</div>
        </div>
      </div>
    </button>
  );
}

function ResourceCard({ active, title, subtitle, image, onClick, rightTag }) {
  return (
    <button
      onClick={onClick}
      className={`text-left rounded-[1.6rem] overflow-hidden border transition shadow-sm hover:shadow-md ${
        active ? 'border-sky-400 ring-2 ring-sky-300 bg-white' : 'border-slate-200 bg-white/70 hover:bg-white'
      }`}
    >
      <div className="relative h-28 bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={title} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
        {rightTag ? (
          <div className="absolute top-3 right-3 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/85 border border-white/50 text-slate-800">
            {rightTag}
          </div>
        ) : null}
      </div>
      <div className="p-3">
        <div className="font-semibold text-slate-900 truncate">{title}</div>
        <div className="text-xs text-slate-600 mt-1 truncate">{subtitle}</div>
      </div>
    </button>
  );
}

function DurationChip({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="h-9 px-3 rounded-full bg-white/70 border border-slate-200 hover:bg-white text-sm font-semibold text-slate-800"
    >
      {label}
    </button>
  );
}

function LabelRow({ label, hint }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-2">
      <div className="text-sm font-semibold text-slate-800">{label}</div>
      {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <div className="text-xs font-semibold text-slate-500 w-16">{label}</div>
      <div className="text-sm font-semibold text-slate-900 truncate">{value}</div>
    </div>
  );
}

function MiniRow({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-3">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 mt-1 truncate">{String(value)}</div>
    </div>
  );
}
