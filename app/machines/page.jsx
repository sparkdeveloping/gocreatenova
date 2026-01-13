'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wrench,
  Plus,
  Search,
  LayoutGrid,
  List as ListIcon,
  Filter,
  MapPin,
  CalendarCheck,
  Clock,
  Hammer,
  Trash2,
  Pencil,
  X,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Activity,
  FileText,
  BadgeCheck,
} from 'lucide-react';

import {
  getFirestore,
  collection,
  query,
  orderBy,
  where,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  getDocs,
} from 'firebase/firestore';

import { app } from '@/app/lib/firebase';

const db = getFirestore(app);

// Collections
const COL_MACHINES = 'machines';
const COL_STUDIOS = 'studios';
const COL_USERS = 'users';
const COL_RESERVATIONS = 'reservations';

// Subcollections
const SUB_USAGE = 'usageLogs';
const SUB_MAINT = 'maintenanceLogs';

// LocalStorage
const LS_CURRENT_USER = 'nova-user';

// Helpers
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
function formatWhen(v) {
  const d = toDateSafe(v);
  if (!d) return '—';
  return d.toLocaleString([], {
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

// Image helpers (store compressed data URL directly in doc)
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

export default function MachinesPage() {
  const router = useRouter();

  // Session user (for logs + reservation requests)
  const [me, setMe] = useState(null);

  // Data
  const [machines, setMachines] = useState([]);
  const [studios, setStudios] = useState([]);
  const [users, setUsers] = useState([]);

  // UI
  const [view, setView] = useState('grid'); // grid | list
  const [search, setSearch] = useState('');
  const [studioFilter, setStudioFilter] = useState(''); // studio id
  const [sortBy, setSortBy] = useState('name'); // name | studio | updated
  const [selectedId, setSelectedId] = useState(null);

  // Modals
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState(null); // machine or null
  const [savingMachine, setSavingMachine] = useState(false);

  const [showReserve, setShowReserve] = useState(false);
  const [reserveFor, setReserveFor] = useState(null); // machine
  const [resSaving, setResSaving] = useState(false);

  const [showAddUsage, setShowAddUsage] = useState(false);
  const [usageFor, setUsageFor] = useState(null);
  const [usageSaving, setUsageSaving] = useState(false);

  const [showAddMaint, setShowAddMaint] = useState(false);
  const [maintFor, setMaintFor] = useState(null);
  const [maintSaving, setMaintSaving] = useState(false);

  // Detail data (selected machine)
  const [usageLogs, setUsageLogs] = useState([]); // manual usage subcollection
  const [maintLogs, setMaintLogs] = useState([]); // maintenance subcollection
  const [reservationUsage, setReservationUsage] = useState([]); // derived from reservations

  // Conflict check for reservation modal
  const [conflicts, setConflicts] = useState([]);
  const [checking, setChecking] = useState(false);
  const conflictTimerRef = useRef(null);

  // Load current user from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_CURRENT_USER);
      if (!raw) return;
      setMe(JSON.parse(raw));
    } catch {}
  }, []);

  // Live: Studios
  useEffect(() => {
    const qy = query(collection(db, COL_STUDIOS), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qy, (snap) => {
      setStudios(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Live: Users (for usage log member lookup)
  useEffect(() => {
    const qy = query(collection(db, COL_USERS), orderBy('fullName', 'asc'));
    const unsub = onSnapshot(qy, (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  // Live: Machines
  useEffect(() => {
    const qy = query(collection(db, COL_MACHINES), orderBy('name', 'asc'));
    const unsub = onSnapshot(qy, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setMachines(list);

      // keep selected stable (if deleted, clear)
      if (selectedId && !list.some((m) => m.id === selectedId)) {
        setSelectedId(null);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studioMap = useMemo(() => {
    const m = new Map();
    studios.forEach((s) => m.set(s.id, s));
    return m;
  }, [studios]);

  const userMap = useMemo(() => {
    const m = new Map();
    users.forEach((u) => m.set(u.id, u));
    return m;
  }, [users]);

  const selectedMachine = useMemo(
    () => (selectedId ? machines.find((m) => m.id === selectedId) : null),
    [machines, selectedId]
  );

  // Filter + sort machines
  const filteredMachines = useMemo(() => {
    const q = (search || '').toLowerCase().trim();

    let list = machines.map((m) => ({
      ...m,
      _name: m.name || 'Unnamed machine',
      _studioId: m.studioId || m.studio || '',
      _studioName: studioMap.get(m.studioId || m.studio)?.name || 'No studio',
      _updatedAt: toDateSafe(m.updatedAt) || toDateSafe(m.createdAt) || new Date(0),
    }));

    if (studioFilter) {
      list = list.filter((m) => String(m._studioId) === String(studioFilter));
    }

    if (q) {
      list = list.filter((m) => {
        const hay = `${m._name} ${m.description || ''} ${m._studioName} ${m.serial || m.serialNumber || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (sortBy === 'name') list.sort((a, b) => a._name.localeCompare(b._name));
    if (sortBy === 'studio') list.sort((a, b) => a._studioName.localeCompare(b._studioName) || a._name.localeCompare(b._name));
    if (sortBy === 'updated') list.sort((a, b) => b._updatedAt.getTime() - a._updatedAt.getTime());

    return list;
  }, [machines, search, studioFilter, sortBy, studioMap]);

  // Load logs for selected machine
  useEffect(() => {
    setUsageLogs([]);
    setMaintLogs([]);
    setReservationUsage([]);

    if (!selectedMachine?.id) return;

    // Manual usage logs (subcollection)
    const usageRef = collection(db, COL_MACHINES, selectedMachine.id, SUB_USAGE);
    const usageQ = query(usageRef, orderBy('startAt', 'desc'), limit(150));
    const unsubUsage = onSnapshot(usageQ, (snap) => {
      setUsageLogs(snap.docs.map((d) => ({ id: d.id, ...d.data(), _source: 'manual' })));
    });

    // Maintenance logs (subcollection)
    const maintRef = collection(db, COL_MACHINES, selectedMachine.id, SUB_MAINT);
    const maintQ = query(maintRef, orderBy('createdAt', 'desc'), limit(150));
    const unsubMaint = onSnapshot(maintQ, (snap) => {
      setMaintLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    // Derived usage: reservations for this machine
    const nowMinus = new Date(Date.now() - 90 * 24 * 3600 * 1000); // last 90 days
    const resQ = query(
      collection(db, COL_RESERVATIONS),
      where('type', '==', 'machine'),
      where('machineId', '==', selectedMachine.id),
      where('endAt', '>=', nowMinus),
      orderBy('endAt', 'desc'),
      limit(200)
    );
    const unsubRes = onSnapshot(resQ, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data(), _source: 'reservation' }));
      setReservationUsage(list);
    });

    return () => {
      unsubUsage();
      unsubMaint();
      unsubRes();
    };
  }, [selectedMachine?.id]);

  // ---------- Machine Editor (Add/Edit/Delete) ----------
  const [mName, setMName] = useState('');
  const [mDesc, setMDesc] = useState('');
  const [mStudioId, setMStudioId] = useState('');
  const [mThumbnailFile, setMThumbnailFile] = useState(null);
  const [mThumbnailData, setMThumbnailData] = useState('');
  const [mPurchaseDate, setMPurchaseDate] = useState('');
  const [mLogHours, setMLogHours] = useState('');
  const [mCondition, setMCondition] = useState('');
  const [mSerial, setMSerial] = useState('');
  const [mLocation, setMLocation] = useState('');
  const [mTags, setMTags] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!mThumbnailFile) return;
      try {
        const compressed = await compressImageToDataURL(mThumbnailFile, { maxWidth: 1400, quality: 0.78 });
        if (!alive) return;
        setMThumbnailData(compressed);
      } catch {
        if (!alive) return;
      }
    })();
    return () => {
      alive = false;
    };
  }, [mThumbnailFile]);

  function openAddMachine() {
    setEditing(null);
    setMName('');
    setMDesc('');
    setMStudioId('');
    setMThumbnailFile(null);
    setMThumbnailData('');
    setMPurchaseDate('');
    setMLogHours('');
    setMCondition('');
    setMSerial('');
    setMLocation('');
    setMTags('');
    setShowEditor(true);
  }

  function openEditMachine(machine) {
    setEditing(machine);
    setMName(machine?.name || '');
    setMDesc(machine?.description || '');
    setMStudioId(machine?.studioId || machine?.studio || '');
    setMThumbnailFile(null);
    setMThumbnailData(machine?.thumbnailData || machine?.thumbnail || machine?.imageData || '');
    setMPurchaseDate(machine?.purchaseDate || '');
    setMLogHours(String(machine?.logHours ?? machine?.hours ?? ''));
    setMCondition(machine?.condition || '');
    setMSerial(machine?.serial || machine?.serialNumber || '');
    setMLocation(machine?.location || '');
    setMTags(Array.isArray(machine?.tags) ? machine.tags.join(', ') : (machine?.tags || ''));
    setShowEditor(true);
  }

  async function saveMachine() {
    const name = (mName || '').trim();
    if (!name) {
      alert('Please enter a machine name.');
      return;
    }

    setSavingMachine(true);
    try {
      const payload = {
        name,
        description: (mDesc || '').trim(),
        studioId: mStudioId || null,
        studio: mStudioId || null, // compatibility
        thumbnailData: mThumbnailData || null,
        purchaseDate: (mPurchaseDate || '').trim() || null,
        logHours: mLogHours === '' ? null : Number(mLogHours),
        condition: (mCondition || '').trim() || null,
        serial: (mSerial || '').trim() || null,
        location: (mLocation || '').trim() || null,
        tags:
          typeof mTags === 'string'
            ? mTags
                .split(',')
                .map((x) => x.trim())
                .filter(Boolean)
            : [],
        updatedAt: serverTimestamp(),
      };

      if (editing?.id) {
        await updateDoc(doc(db, COL_MACHINES, editing.id), payload);
      } else {
        await addDoc(collection(db, COL_MACHINES), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }

      setShowEditor(false);
      setEditing(null);
    } catch (e) {
      console.error('Save machine failed:', e);
      alert('Could not save machine. Please try again.');
    } finally {
      setSavingMachine(false);
    }
  }

  async function removeMachine(machine) {
    if (!machine?.id) return;
    const ok = confirm(`Delete machine "${machine.name || 'Unnamed'}"? This cannot be undone.`);
    if (!ok) return;

    try {
      await deleteDoc(doc(db, COL_MACHINES, machine.id));
      if (selectedId === machine.id) setSelectedId(null);
    } catch (e) {
      console.error('Delete machine failed:', e);
      alert('Could not delete machine. Please try again.');
    }
  }

  // ---------- Reserve from Machines ----------
  const [resTitle, setResTitle] = useState('');
  const [resNotes, setResNotes] = useState('');
  const [resStartStr, setResStartStr] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 10);
    d.setSeconds(0);
    return toLocalDateTimeInput(d);
  });
  const [resEndStr, setResEndStr] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() + 70);
    d.setSeconds(0);
    return toLocalDateTimeInput(d);
  });

  function openReserve(machine) {
    setReserveFor(machine);
    setResTitle(machine?.name ? `${machine.name} reservation` : 'Machine reservation');
    setResNotes('');
    const s = new Date();
    s.setMinutes(s.getMinutes() + 10);
    s.setSeconds(0);
    const e = new Date(s.getTime() + 60 * 60000);
    setResStartStr(toLocalDateTimeInput(s));
    setResEndStr(toLocalDateTimeInput(e));
    setConflicts([]);
    setShowReserve(true);
  }

  // Debounced conflict check for reserve modal
  useEffect(() => {
    if (!showReserve || !reserveFor?.id) return;

    if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    conflictTimerRef.current = setTimeout(() => {
      checkConflicts().catch(() => {});
    }, 350);

    return () => {
      if (conflictTimerRef.current) clearTimeout(conflictTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReserve, reserveFor?.id, resStartStr, resEndStr]);

  async function checkConflicts() {
    const startAt = fromLocalDateTimeInput(resStartStr);
    const endAt = fromLocalDateTimeInput(resEndStr);
    if (!reserveFor?.id || !startAt || !endAt || endAt <= startAt) {
      setConflicts([]);
      return;
    }

    setChecking(true);
    try {
      const qy = query(
        collection(db, COL_RESERVATIONS),
        where('type', '==', 'machine'),
        where('machineId', '==', reserveFor.id),
        where('startAt', '<', endAt),
        orderBy('startAt', 'asc'),
        limit(50)
      );

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

  async function createReservationFromHere() {
    if (!me?.id) {
      alert('No active user session found. Please scan in again.');
      return;
    }
    if (!reserveFor?.id) return;

    const startAt = fromLocalDateTimeInput(resStartStr);
    const endAt = fromLocalDateTimeInput(resEndStr);
    if (!startAt || !endAt || endAt <= startAt) {
      alert('Please choose a valid time range.');
      return;
    }
    if (conflicts.length > 0) {
      alert('This time overlaps an existing reservation. Please choose another time.');
      return;
    }

    setResSaving(true);
    try {
      const studioId = reserveFor.studioId || reserveFor.studio || null;
      const studio = studioId ? studioMap.get(studioId) : null;

      const payload = {
        type: 'machine',
        requestMode: studioId ? 'studio' : 'general',
        status: 'pending',
        title: (resTitle || '').trim() || 'Machine reservation',
        notes: (resNotes || '').trim(),
        startAt,
        endAt,

        studioId: studioId || null,
        machineId: reserveFor.id,
        staffUserId: null,
        classId: null,

        studioSnapshot: studio
          ? { id: studio.id, name: studio.name || 'Studio', coverData: studio.coverData || studio.coverUrl || null }
          : null,
        machineSnapshot: {
          id: reserveFor.id,
          name: reserveFor.name || 'Machine',
          studioId: studioId,
          thumbnailData: reserveFor.thumbnailData || reserveFor.thumbnail || reserveFor.imageData || null,
          description: reserveFor.description || '',
        },

        requester: {
          id: me.id,
          name: me.fullName || me.name || '',
          photoURL: me.photoURL || me.profileImageUrl || null,
          email: me.email || null,
        },

        attachmentData: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await addDoc(collection(db, COL_RESERVATIONS), payload);
      setShowReserve(false);
      setReserveFor(null);
    } catch (e) {
      console.error('Create reservation failed:', e);
      alert('Could not create reservation. Please try again.');
    } finally {
      setResSaving(false);
    }
  }

  // ---------- Add Manual Usage Log ----------
  const [usageMemberId, setUsageMemberId] = useState('');
  const [usageStartStr, setUsageStartStr] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - 30);
    d.setSeconds(0);
    return toLocalDateTimeInput(d);
  });
  const [usageEndStr, setUsageEndStr] = useState(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes());
    d.setSeconds(0);
    return toLocalDateTimeInput(d);
  });
  const [usageNotes, setUsageNotes] = useState('');

  function openUsage(machine) {
    setUsageFor(machine);
    setUsageMemberId('');
    const s = new Date();
    s.setMinutes(s.getMinutes() - 30);
    s.setSeconds(0);
    const e = new Date();
    e.setSeconds(0);
    setUsageStartStr(toLocalDateTimeInput(s));
    setUsageEndStr(toLocalDateTimeInput(e));
    setUsageNotes('');
    setShowAddUsage(true);
  }

  async function addManualUsage() {
    if (!usageFor?.id) return;

    const startAt = fromLocalDateTimeInput(usageStartStr);
    const endAt = fromLocalDateTimeInput(usageEndStr);
    if (!startAt || !endAt || endAt <= startAt) {
      alert('Please choose a valid time range.');
      return;
    }

    const memberDoc = usageMemberId ? userMap.get(usageMemberId) : null;
    if (!memberDoc) {
      alert('Please select a member who used the machine.');
      return;
    }

    setUsageSaving(true);
    try {
      const payload = {
        source: 'manual', // manual usage
        member: {
          id: memberDoc.id,
          name: memberDoc.fullName || memberDoc.name || 'Member',
          photoURL: memberDoc.photoURL || memberDoc.profileImageUrl || null,
          email: memberDoc.email || null,
        },
        startAt,
        endAt,
        minutes: minutesBetween(startAt, endAt),
        notes: (usageNotes || '').trim() || '',
        createdAt: serverTimestamp(),
        createdBy: me?.id
          ? { id: me.id, name: me.fullName || me.name || 'User' }
          : { id: null, name: 'System' },
      };

      await addDoc(collection(db, COL_MACHINES, usageFor.id, SUB_USAGE), payload);
      setShowAddUsage(false);
      setUsageFor(null);
    } catch (e) {
      console.error('Add usage failed:', e);
      alert('Could not add usage log. Please try again.');
    } finally {
      setUsageSaving(false);
    }
  }

  // ---------- Add Maintenance Log ----------
  const [maintTitle, setMaintTitle] = useState('');
  const [maintNotes, setMaintNotes] = useState('');
  const [maintStatus, setMaintStatus] = useState('open'); // open | done
  const [maintSeverity, setMaintSeverity] = useState('normal'); // normal | urgent
  const [maintCost, setMaintCost] = useState('');
  const [maintTechnician, setMaintTechnician] = useState('');

  function openMaintenance(machine) {
    setMaintFor(machine);
    setMaintTitle('');
    setMaintNotes('');
    setMaintStatus('open');
    setMaintSeverity('normal');
    setMaintCost('');
    setMaintTechnician('');
    setShowAddMaint(true);
  }

  async function addMaintenance() {
    if (!maintFor?.id) return;
    const title = (maintTitle || '').trim();
    if (!title) {
      alert('Please add a maintenance title.');
      return;
    }

    setMaintSaving(true);
    try {
      const payload = {
        title,
        notes: (maintNotes || '').trim(),
        status: maintStatus,
        severity: maintSeverity,
        cost: maintCost === '' ? null : Number(maintCost),
        technician: (maintTechnician || '').trim() || null,
        createdAt: serverTimestamp(),
        createdBy: me?.id
          ? { id: me.id, name: me.fullName || me.name || 'User' }
          : { id: null, name: 'System' },
      };

      await addDoc(collection(db, COL_MACHINES, maintFor.id, SUB_MAINT), payload);
      setShowAddMaint(false);
      setMaintFor(null);
    } catch (e) {
      console.error('Add maintenance failed:', e);
      alert('Could not add maintenance log. Please try again.');
    } finally {
      setMaintSaving(false);
    }
  }

  // Combined usage feed (manual + reservations), sorted desc by endAt
  const combinedUsage = useMemo(() => {
    const manual = (usageLogs || []).map((u) => ({
      ...u,
      _kind: 'manual',
      _endAt: toDateSafe(u.endAt) || toDateSafe(u.startAt) || new Date(0),
      _startAt: toDateSafe(u.startAt) || new Date(0),
      _label: 'Manual usage',
    }));
    const fromRes = (reservationUsage || []).map((r) => ({
      ...r,
      _kind: 'reservation',
      _endAt: toDateSafe(r.endAt) || toDateSafe(r.startAt) || new Date(0),
      _startAt: toDateSafe(r.startAt) || new Date(0),
      _label: 'Reservation',
    }));

    return [...manual, ...fromRes].sort((a, b) => b._endAt.getTime() - a._endAt.getTime());
  }, [usageLogs, reservationUsage]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
      <BokehBackground />

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-white/70 backdrop-blur border border-slate-200 shadow-sm grid place-items-center">
              <Wrench className="w-5 h-5 text-slate-700" />
            </div>
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight gradient-text">Machines</h1>
              <p className="text-slate-600 mt-1">Browse machines, view logs, track maintenance, and reserve equipment.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search machines, serial, studio…"
                className="h-11 w-[260px] max-w-[70vw] pl-9 pr-3 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <button
              onClick={() => setView((v) => (v === 'grid' ? 'list' : 'grid'))}
              className="h-11 px-4 rounded-2xl bg-white/70 backdrop-blur border border-slate-200 hover:bg-white shadow-sm flex items-center gap-2"
            >
              {view === 'grid' ? <ListIcon className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
              {view === 'grid' ? 'List' : 'Grid'}
            </button>

            <button
              onClick={openAddMachine}
              className="h-11 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add machine
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/70 backdrop-blur border border-slate-200 shadow-sm">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">Filters</span>
          </div>

          <select
            value={studioFilter}
            onChange={(e) => setStudioFilter(e.target.value)}
            className="h-10 px-4 rounded-full border border-slate-200 bg-white/70 backdrop-blur focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <option value="">All studios</option>
            {studios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name || 'Studio'}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="h-10 px-4 rounded-full border border-slate-200 bg-white/70 backdrop-blur focus:outline-none focus:ring-4 focus:ring-blue-100"
          >
            <option value="name">Sort: Name</option>
            <option value="studio">Sort: Studio</option>
            <option value="updated">Sort: Recently updated</option>
          </select>

          <div className="ml-auto text-sm text-slate-600">
            Showing <span className="font-semibold">{filteredMachines.length}</span> machine{filteredMachines.length === 1 ? '' : 's'}
          </div>
        </div>

        {/* Main split */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Left: list/grid */}
          <div className="lg:col-span-3">
            <div className="rounded-[2rem] border border-slate-200 bg-white/70 backdrop-blur shadow-xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200/70 flex items-center justify-between gap-3">
                <div className="font-bold text-slate-900">Machine catalog</div>
                <div className="text-xs font-semibold text-slate-500 bg-white/70 border border-slate-200 rounded-full px-3 py-1">
                  Click a machine to view details
                </div>
              </div>

              <div className="p-6">
                {filteredMachines.length === 0 ? (
                  <div className="rounded-[1.6rem] border border-dashed border-slate-300 bg-white/60 p-6 text-slate-600">
                    No machines found. Try changing filters or search.
                  </div>
                ) : view === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                    {filteredMachines.map((m) => (
                      <MachineCard
                        key={m.id}
                        machine={m}
                        studioName={m._studioName}
                        isSelected={selectedId === m.id}
                        onSelect={() => setSelectedId(m.id)}
                        onReserve={() => openReserve(m)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredMachines.map((m) => (
                      <MachineRow
                        key={m.id}
                        machine={m}
                        studioName={m._studioName}
                        isSelected={selectedId === m.id}
                        onSelect={() => setSelectedId(m.id)}
                        onReserve={() => openReserve(m)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: details */}
          <div className="lg:col-span-2">
            <div className="rounded-[2rem] border border-slate-200 bg-white/70 backdrop-blur shadow-xl overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-200/70 flex items-center justify-between gap-3">
                <div className="font-bold text-slate-900">Details</div>
                {selectedMachine ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openEditMachine(selectedMachine)}
                      className="h-9 px-3 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
                    >
                      <Pencil className="w-4 h-4" />
                      Edit
                    </button>
                    <button
                      onClick={() => removeMachine(selectedMachine)}
                      className="h-9 px-3 rounded-full bg-rose-600 text-white font-semibold hover:bg-rose-700 inline-flex items-center gap-2"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="p-6">
                {!selectedMachine ? (
                  <div className="rounded-[1.6rem] border border-dashed border-slate-300 bg-white/60 p-6 text-slate-600">
                    Select a machine to view logs, maintenance, and reservation options.
                  </div>
                ) : (
                  <>
                    {/* Hero */}
                    <div className="rounded-[1.6rem] overflow-hidden border border-slate-200 bg-white/75">
                      <div className="relative h-40 bg-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={
                            selectedMachine.thumbnailData ||
                            selectedMachine.thumbnail ||
                            selectedMachine.imageData ||
                            '/placeholder.png'
                          }
                          alt={selectedMachine.name || 'Machine'}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                        <div className="absolute bottom-3 left-3 right-3">
                          <div className="text-white font-extrabold text-xl leading-tight truncate">
                            {selectedMachine.name || 'Unnamed machine'}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/85 border border-white/40 text-slate-800">
                              {studioMap.get(selectedMachine.studioId || selectedMachine.studio)?.name || 'No studio'}
                            </span>
                            {selectedMachine.location ? (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-black/40 text-white inline-flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5" />
                                {selectedMachine.location}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="p-4">
                        {selectedMachine.description ? (
                          <div className="text-sm text-slate-700">{selectedMachine.description}</div>
                        ) : (
                          <div className="text-sm text-slate-500">No description provided.</div>
                        )}

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <Stat label="Purchase date" value={selectedMachine.purchaseDate || '—'} />
                          <Stat label="Log hours" value={selectedMachine.logHours ?? selectedMachine.hours ?? '—'} />
                          <Stat label="Condition" value={selectedMachine.condition || '—'} />
                          <Stat label="Serial" value={selectedMachine.serial || selectedMachine.serialNumber || '—'} />
                        </div>

                        {/* Primary actions */}
                        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            onClick={() => openReserve(selectedMachine)}
                            className="h-11 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 inline-flex items-center justify-center gap-2"
                          >
                            <CalendarCheck className="w-4 h-4" />
                            Reserve
                          </button>

                          <button
                            onClick={() => {
                              // Fast path: if you prefer to use /reservations flow later.
                              // router.push(`/reservations?machineId=${selectedMachine.id}`);
                              openUsage(selectedMachine);
                            }}
                            className="h-11 rounded-full bg-white border border-slate-200 text-slate-900 font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2"
                          >
                            <Activity className="w-4 h-4 text-slate-600" />
                            Add usage
                          </button>

                          <button
                            onClick={() => openMaintenance(selectedMachine)}
                            className="h-11 rounded-full bg-white border border-slate-200 text-slate-900 font-semibold hover:bg-slate-50 inline-flex items-center justify-center gap-2 sm:col-span-2"
                          >
                            <Hammer className="w-4 h-4 text-slate-600" />
                            Add maintenance log
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Usage logs */}
                    <div className="mt-5">
                      <SectionHeader
                        icon={<Clock className="w-4 h-4 text-slate-600" />}
                        title="Usage"
                        subtitle="Manual usage + reservations count as usage."
                        right={
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white">
                            {combinedUsage.length}
                          </span>
                        }
                      />

                      {combinedUsage.length === 0 ? (
                        <EmptyBox text="No usage logs yet." />
                      ) : (
                        <div className="mt-3 space-y-2">
                          {combinedUsage.slice(0, 12).map((u) => {
                            if (u._kind === 'manual') {
                              const member = u.member || {};
                              return (
                                <LogItem
                                  key={`manual-${u.id}`}
                                  badge="Manual"
                                  badgeClass="bg-slate-900 text-white"
                                  title={member?.name || 'Member'}
                                  subtitle={`${formatWhen(u.startAt)} → ${formatWhen(u.endAt)} • ${u.minutes ?? minutesBetween(u.startAt, u.endAt)} min`}
                                  note={u.notes || ''}
                                />
                              );
                            }
                            // reservation-derived
                            const requester = u.requester || {};
                            const status = String(u.status || 'pending').toLowerCase();
                            const badge =
                              status === 'approved'
                                ? { t: 'Approved', cls: 'bg-emerald-600 text-white' }
                                : status === 'denied'
                                ? { t: 'Denied', cls: 'bg-rose-600 text-white' }
                                : status === 'cancelled'
                                ? { t: 'Cancelled', cls: 'bg-slate-700 text-white' }
                                : { t: 'Pending', cls: 'bg-amber-600 text-white' };

                            return (
                              <LogItem
                                key={`res-${u.id}`}
                                badge={badge.t}
                                badgeClass={badge.cls}
                                title={requester?.name || 'Reservation'}
                                subtitle={`${formatWhen(u.startAt)} → ${formatWhen(u.endAt)} • ${minutesBetween(u.startAt, u.endAt)} min`}
                                note={u.title || u.notes || ''}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Maintenance logs */}
                    <div className="mt-5">
                      <SectionHeader
                        icon={<Hammer className="w-4 h-4 text-slate-600" />}
                        title="Maintenance"
                        subtitle="Track issues, repairs, and preventive work."
                        right={
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-900 text-white">
                            {maintLogs.length}
                          </span>
                        }
                      />

                      {maintLogs.length === 0 ? (
                        <EmptyBox text="No maintenance logs yet." />
                      ) : (
                        <div className="mt-3 space-y-2">
                          {maintLogs.slice(0, 12).map((m) => {
                            const sev = String(m.severity || 'normal').toLowerCase();
                            const status = String(m.status || 'open').toLowerCase();
                            const badge =
                              status === 'done'
                                ? { t: 'Done', cls: 'bg-emerald-600 text-white' }
                                : sev === 'urgent'
                                ? { t: 'Urgent', cls: 'bg-rose-600 text-white' }
                                : { t: 'Open', cls: 'bg-slate-900 text-white' };

                            return (
                              <LogItem
                                key={m.id}
                                badge={badge.t}
                                badgeClass={badge.cls}
                                title={m.title || 'Maintenance'}
                                subtitle={`${formatWhen(m.createdAt)}${m.technician ? ` • ${m.technician}` : ''}${m.cost != null ? ` • $${m.cost}` : ''}`}
                                note={m.notes || ''}
                              />
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Quick links */}
                    <div className="mt-6 flex flex-wrap gap-2">
                      <Link
                        href="/reservations"
                        className="h-10 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50 inline-flex items-center gap-2"
                      >
                        <CalendarCheck className="w-4 h-4 text-slate-600" />
                        Reservations
                      </Link>
                      <Link
                        href="/studios"
                        className="h-10 px-4 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90 inline-flex items-center gap-2"
                      >
                        <MapPin className="w-4 h-4" />
                        Studios
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Machine editor modal */}
      <AnimatePresence>
        {showEditor && (
          <ModalShell title={editing?.id ? 'Edit machine' : 'Add machine'} onClose={() => setShowEditor(false)}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Name" required>
                <input
                  value={mName}
                  onChange={(e) => setMName(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="e.g., Laser Cutter"
                />
              </Field>

              <Field label="Studio">
                <select
                  value={mStudioId}
                  onChange={(e) => setMStudioId(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  <option value="">No studio</option>
                  {studios.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || 'Studio'}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Description" full>
                <textarea
                  value={mDesc}
                  onChange={(e) => setMDesc(e.target.value)}
                  className="min-h-[100px] w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="What is this machine used for?"
                />
              </Field>

              <Field label="Thumbnail (image)" full>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <label className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 cursor-pointer hover:bg-white">
                    <Upload className="w-5 h-5 text-slate-500" />
                    <span className="text-sm text-slate-600">
                      {mThumbnailFile ? mThumbnailFile.name : 'Choose an image (JPG/PNG)'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setMThumbnailFile(e.target.files?.[0] || null)}
                    />
                  </label>

                  <div className="rounded-2xl border border-slate-200 bg-white/70 p-3">
                    <div className="text-xs font-semibold text-slate-500 mb-2">Preview</div>
                    <div className="relative h-28 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                      {mThumbnailData ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mThumbnailData} alt="Thumbnail" className="absolute inset-0 w-full h-full object-cover" />
                      ) : (
                        <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">No image</div>
                      )}
                    </div>
                  </div>
                </div>
              </Field>

              <Field label="Purchase date">
                <input
                  value={mPurchaseDate}
                  onChange={(e) => setMPurchaseDate(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="e.g., 2023-09-12"
                />
              </Field>

              <Field label="Log hours">
                <input
                  value={mLogHours}
                  onChange={(e) => setMLogHours(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="e.g., 1200"
                  inputMode="numeric"
                />
              </Field>

              <Field label="Condition">
                <input
                  value={mCondition}
                  onChange={(e) => setMCondition(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="e.g., Good"
                />
              </Field>

              <Field label="Serial">
                <input
                  value={mSerial}
                  onChange={(e) => setMSerial(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Serial number"
                />
              </Field>

              <Field label="Location">
                <input
                  value={mLocation}
                  onChange={(e) => setMLocation(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="e.g., Studio A - Bay 2"
                />
              </Field>

              <Field label="Tags (comma separated)" full>
                <input
                  value={mTags}
                  onChange={(e) => setMTags(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="laser, wood, acrylic"
                />
              </Field>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <button
                onClick={() => setShowEditor(false)}
                className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                disabled={savingMachine}
              >
                Cancel
              </button>
              <button
                onClick={saveMachine}
                className="h-11 px-5 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
                disabled={savingMachine}
              >
                {savingMachine ? 'Saving…' : editing?.id ? 'Save changes' : 'Create machine'}
              </button>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Reserve modal */}
      <AnimatePresence>
        {showReserve && reserveFor && (
          <ModalShell title={`Reserve: ${reserveFor.name || 'Machine'}`} onClose={() => setShowReserve(false)}>
            <div className="rounded-2xl border border-slate-200 bg-white/70 overflow-hidden">
              <div className="relative h-36 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reserveFor.thumbnailData || reserveFor.thumbnail || reserveFor.imageData || '/placeholder.png'}
                  alt={reserveFor.name || 'Machine'}
                  className="absolute inset-0 w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                <div className="absolute bottom-3 left-3 right-3 text-white">
                  <div className="font-extrabold text-lg truncate">{reserveFor.name || 'Machine'}</div>
                  <div className="text-xs text-white/90">
                    {studioMap.get(reserveFor.studioId || reserveFor.studio)?.name || 'No studio'}
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Start">
                    <input
                      type="datetime-local"
                      value={resStartStr}
                      onChange={(e) => setResStartStr(e.target.value)}
                      className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </Field>
                  <Field label="End">
                    <input
                      type="datetime-local"
                      value={resEndStr}
                      onChange={(e) => setResEndStr(e.target.value)}
                      className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    />
                  </Field>
                </div>

                <div className="mt-2 text-xs text-slate-600 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  Duration:{' '}
                  <span className="font-semibold">
                    {minutesBetween(fromLocalDateTimeInput(resStartStr), fromLocalDateTimeInput(resEndStr))}
                  </span>{' '}
                  minutes
                  {checking ? <span className="ml-2 text-slate-500">Checking conflicts…</span> : null}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3">
                  <Field label="Title (optional)">
                    <input
                      value={resTitle}
                      onChange={(e) => setResTitle(e.target.value)}
                      className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                      placeholder="e.g., Project cut"
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      value={resNotes}
                      onChange={(e) => setResNotes(e.target.value)}
                      className="min-h-[90px] w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                      placeholder="Add details for staff (materials, constraints, etc.)"
                    />
                  </Field>
                </div>

                <AnimatePresence>
                  {conflicts.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="mt-4 rounded-[1.2rem] border border-rose-200 bg-rose-50/70 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-rose-600 mt-0.5" />
                        <div className="min-w-0">
                          <div className="font-bold text-rose-900">Time conflict</div>
                          <div className="text-sm text-rose-800 mt-1">
                            This overlaps with {conflicts.length} reservation{conflicts.length === 1 ? '' : 's'}.
                          </div>
                          <div className="mt-2 space-y-2">
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

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={() => setShowReserve(false)}
                    className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                    disabled={resSaving}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={createReservationFromHere}
                    className="h-11 px-5 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
                    disabled={resSaving}
                  >
                    {resSaving ? 'Submitting…' : 'Submit reservation'}
                  </button>
                </div>

                <div className="mt-3 text-xs text-slate-500 flex items-center gap-2">
                  <BadgeCheck className="w-4 h-4" />
                  Reservations are saved as <span className="font-semibold">pending</span> by default.
                </div>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Add usage modal */}
      <AnimatePresence>
        {showAddUsage && usageFor && (
          <ModalShell title={`Add usage: ${usageFor.name || 'Machine'}`} onClose={() => setShowAddUsage(false)}>
            <div className="grid grid-cols-1 gap-4">
              <Field label="Member (who used it)" required>
                <select
                  value={usageMemberId}
                  onChange={(e) => setUsageMemberId(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                >
                  <option value="">Choose a member…</option>
                  {users.slice(0, 500).map((u) => (
                    <option key={u.id} value={u.id}>
                      {(u.fullName || u.name || 'Member') + (u.email ? ` • ${u.email}` : '')}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Start">
                  <input
                    type="datetime-local"
                    value={usageStartStr}
                    onChange={(e) => setUsageStartStr(e.target.value)}
                    className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </Field>
                <Field label="End">
                  <input
                    type="datetime-local"
                    value={usageEndStr}
                    onChange={(e) => setUsageEndStr(e.target.value)}
                    className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  />
                </Field>
              </div>

              <div className="text-xs text-slate-600 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-500" />
                Duration:{' '}
                <span className="font-semibold">
                  {minutesBetween(fromLocalDateTimeInput(usageStartStr), fromLocalDateTimeInput(usageEndStr))}
                </span>{' '}
                minutes
              </div>

              <Field label="Notes">
                <textarea
                  value={usageNotes}
                  onChange={(e) => setUsageNotes(e.target.value)}
                  className="min-h-[90px] w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Optional context"
                />
              </Field>

              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => setShowAddUsage(false)}
                  className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                  disabled={usageSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={addManualUsage}
                  className="h-11 px-5 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90 disabled:opacity-60"
                  disabled={usageSaving}
                >
                  {usageSaving ? 'Saving…' : 'Add usage log'}
                </button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Add maintenance modal */}
      <AnimatePresence>
        {showAddMaint && maintFor && (
          <ModalShell title={`Add maintenance: ${maintFor.name || 'Machine'}`} onClose={() => setShowAddMaint(false)}>
            <div className="grid grid-cols-1 gap-4">
              <Field label="Title" required>
                <input
                  value={maintTitle}
                  onChange={(e) => setMaintTitle(e.target.value)}
                  className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="e.g., Replace lens, align bed, fix jam"
                />
              </Field>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Status">
                  <select
                    value={maintStatus}
                    onChange={(e) => setMaintStatus(e.target.value)}
                    className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="open">Open</option>
                    <option value="done">Done</option>
                  </select>
                </Field>

                <Field label="Severity">
                  <select
                    value={maintSeverity}
                    onChange={(e) => setMaintSeverity(e.target.value)}
                    className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Field label="Cost (optional)">
                  <input
                    value={maintCost}
                    onChange={(e) => setMaintCost(e.target.value)}
                    className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    inputMode="decimal"
                    placeholder="e.g., 25.00"
                  />
                </Field>

                <Field label="Technician (optional)">
                  <input
                    value={maintTechnician}
                    onChange={(e) => setMaintTechnician(e.target.value)}
                    className="h-11 w-full px-4 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    placeholder="Name"
                  />
                </Field>
              </div>

              <Field label="Notes">
                <textarea
                  value={maintNotes}
                  onChange={(e) => setMaintNotes(e.target.value)}
                  className="min-h-[100px] w-full px-4 py-3 rounded-2xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                  placeholder="Details, parts, what was done, next steps…"
                />
              </Field>

              <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                <button
                  onClick={() => setShowAddMaint(false)}
                  className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                  disabled={maintSaving}
                >
                  Cancel
                </button>
                <button
                  onClick={addMaintenance}
                  className="h-11 px-5 rounded-full bg-slate-900 text-white font-semibold hover:opacity-90 disabled:opacity-60"
                  disabled={maintSaving}
                >
                  {maintSaving ? 'Saving…' : 'Add maintenance'}
                </button>
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>

      {/* Global shimmer text */}
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
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
      `}</style>
    </div>
  );
}

/* ---------------- UI Components ---------------- */

function MachineCard({ machine, studioName, isSelected, onSelect, onReserve }) {
  const cover = machine.thumbnailData || machine.thumbnail || machine.imageData || '/placeholder.png';

  return (
    <button
      onClick={onSelect}
      className={`text-left rounded-[1.6rem] overflow-hidden border shadow-xl backdrop-blur transition ${
        isSelected ? 'border-blue-400 bg-white/85' : 'border-slate-200 bg-white/70 hover:bg-white/80'
      }`}
    >
      <div className="relative h-36 bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cover} alt={machine._name} className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
        <div className="absolute top-3 left-3 flex gap-2">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/85 border border-white/40 text-slate-800">
            {studioName}
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="font-bold text-slate-900 truncate">{machine._name}</div>
        <div className="text-xs text-slate-600 mt-1 line-clamp-2">{machine.description || '—'}</div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <div className="text-xs text-slate-500">
            {machine.serial || machine.serialNumber ? `SN: ${machine.serial || machine.serialNumber}` : ' '}
          </div>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onReserve();
            }}
            className="h-9 px-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 inline-flex items-center gap-2"
          >
            <CalendarCheck className="w-4 h-4" />
            Reserve
          </button>
        </div>
      </div>
    </button>
  );
}

function MachineRow({ machine, studioName, isSelected, onSelect, onReserve }) {
  const cover = machine.thumbnailData || machine.thumbnail || machine.imageData || '/placeholder.png';

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left rounded-[1.4rem] border shadow-sm backdrop-blur transition overflow-hidden ${
        isSelected ? 'border-blue-400 bg-white/85' : 'border-slate-200 bg-white/70 hover:bg-white/80'
      }`}
    >
      <div className="p-4 flex items-center gap-4">
        <div className="relative w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 bg-slate-100 flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt={machine._name} className="absolute inset-0 w-full h-full object-cover" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="font-bold text-slate-900 truncate">{machine._name}</div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-white/85 border border-slate-200 text-slate-800">
              {studioName}
            </span>
          </div>
          <div className="text-xs text-slate-600 mt-1 line-clamp-1">{machine.description || '—'}</div>
          <div className="text-xs text-slate-500 mt-1">
            {machine.serial || machine.serialNumber ? `SN: ${machine.serial || machine.serialNumber}` : ' '}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onReserve();
          }}
          className="h-9 px-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 inline-flex items-center gap-2 flex-shrink-0"
        >
          <CalendarCheck className="w-4 h-4" />
          Reserve
        </button>
      </div>
    </button>
  );
}

function SectionHeader({ icon, title, subtitle, right }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-slate-800 flex items-center gap-2">
          {icon}
          {title}
        </div>
        <div className="text-xs text-slate-500 mt-1">{subtitle}</div>
      </div>
      {right}
    </div>
  );
}

function LogItem({ badge, badgeClass, title, subtitle, note }) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-white/75 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900 truncate">{title}</div>
          <div className="text-xs text-slate-600 mt-1">{subtitle}</div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${badgeClass}`}>{badge}</span>
      </div>
      {note ? (
        <div className="mt-2 text-xs text-slate-700 rounded-xl border border-slate-200 bg-white/70 p-2 line-clamp-3">
          {note}
        </div>
      ) : null}
    </div>
  );
}

function EmptyBox({ text }) {
  return (
    <div className="mt-3 rounded-[1.2rem] border border-dashed border-slate-300 bg-white/60 p-4 text-slate-600 text-sm">
      {text}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-2">
      <div className="text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="text-xs font-semibold text-slate-900 mt-0.5 truncate">{String(value)}</div>
    </div>
  );
}

function Field({ label, children, hint, required, full }) {
  return (
    <div className={full ? 'md:col-span-2' : ''}>
      <div className="flex items-end justify-between gap-3 mb-2">
        <div className="text-sm font-semibold text-slate-800">
          {label} {required ? <span className="text-rose-600">*</span> : null}
        </div>
        {hint ? <div className="text-xs text-slate-500">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function ModalShell({ title, onClose, children }) {
  return (
    <motion.div
      key="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/25 backdrop-blur-sm p-4"
    >
      <motion.div
        key="modal-card"
        initial={{ y: 18, opacity: 0, scale: 0.99 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 10, opacity: 0, scale: 0.99 }}
        transition={{ type: 'spring', stiffness: 320, damping: 26 }}
        className="w-full max-w-3xl rounded-[2rem] bg-white/90 backdrop-blur-xl border border-white/40 shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-5 border-b border-slate-200/70 flex items-center justify-between gap-3">
          <div className="font-bold text-slate-900">{title}</div>
          <button
            onClick={onClose}
            className="h-10 w-10 rounded-full bg-white border border-slate-200 hover:bg-slate-50 grid place-items-center"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </motion.div>
    </motion.div>
  );
}

/* ---------------- Background ---------------- */

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
