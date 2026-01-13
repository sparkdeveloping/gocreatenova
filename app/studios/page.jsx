'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import {
  Plus,
  Search,
  Sparkles,
  Users,
  Box,
  Hammer,
  Wrench,
  Image as ImageIcon,
  Info,
  ChevronLeft,
  Upload,
  UserPlus,
  CheckCircle2,
  LayoutDashboard,
  X,
  Trash,
} from 'lucide-react';

import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp,
  doc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';

import { app } from '@/app/lib/firebase';
import { useUser } from '@/app/context/UserContext';

// -----------------------------------------------------------------------------
// constants
// -----------------------------------------------------------------------------
const db = getFirestore(app);

const STUDIOS = 'studios';
const SUBS = {
  tools: 'tools',
  // machines subcollection kept for backwards compatibility; UI now uses global /machines
  materials: 'materials',
  mentors: 'mentors',
  gallery: 'gallery',
};

const LS_STUDIOS = 'nova:studios-cache:v1';

// -----------------------------------------------------------------------------
// image helpers — compress to keep under Firestore size limits
// -----------------------------------------------------------------------------
async function fileToDataURL(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

async function compressImageToDataURL(file, { maxWidth = 1600, quality = 0.85 } = {}) {
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

// -----------------------------------------------------------------------------
// page
// -----------------------------------------------------------------------------
export default function StudiosPage() {
  const { allUsers, refreshUsers, can } = useUser();

  const [studios, setStudios] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');

  const [creating, setCreating] = useState(false);
  const [creatingData, setCreatingData] = useState({ name: '', description: '' });
  const [coverFile, setCoverFile] = useState(null);
  const [savingStudio, setSavingStudio] = useState(false);

  // ensure users for mentor picker
  useEffect(() => {
    if (!allUsers || allUsers.length === 0) refreshUsers().catch(() => {});
  }, [allUsers, refreshUsers]);

  // seed cache
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(LS_STUDIOS) || '[]');
      if (Array.isArray(cached) && cached.length) setStudios(cached);
    } catch {}
  }, []);

  // live studios
  useEffect(() => {
    const qRef = query(collection(db, STUDIOS), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(qRef, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setStudios(list);
      try {
        localStorage.setItem(LS_STUDIOS, JSON.stringify(list));
      } catch {}
    });
    return () => unsub();
  }, []);

  const filtered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    if (!q) return studios;
    return studios.filter(
      (s) => s.name?.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)
    );
  }, [studios, search]);

  const startCreate = () => {
    setCreatingData({ name: '', description: '' });
    setCoverFile(null);
    setCreating(true);
  };

  const saveCreate = async () => {
    if (!creatingData.name.trim() || !coverFile) return;
    setSavingStudio(true);
    try {
      let coverData = await compressImageToDataURL(coverFile, { maxWidth: 1600, quality: 0.85 });
      if (coverData.length > 900_000) {
        const retry = await compressImageToDataURL(coverFile, { maxWidth: 1400, quality: 0.75 });
        if (retry.length < coverData.length) coverData = retry;
      }

      await addDoc(collection(db, STUDIOS), {
        name: creatingData.name.trim(),
        description: creatingData.description?.trim() || '',
        coverData,
        createdAt: serverTimestamp(),
      });

      setCreating(false);
      setCreatingData({ name: '', description: '' });
      setCoverFile(null);
    } catch (e) {
      console.error('Create studio failed', e);
      alert('Could not create studio. Please try again.');
    } finally {
      setSavingStudio(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white text-slate-900">
      <BokehBackground />

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Header with Back (goes to "/") */}
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full px-4 h-10 grid place-items-center bg-white/70 backdrop-blur border border-slate-200 hover:bg-white shadow-sm"
            >
              <ChevronLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight gradient-text">
                Studios
              </h1>
              <p className="text-slate-600 mt-1">
                Explore workspaces, gear, and mentors. Tap a studio to dive in.
              </p>
            </div>
          </div>

          {!selected ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  placeholder="Search studios…"
                  className="h-11 pl-9 pr-3 rounded-2xl border border-slate-200 bg-white/70 backdrop-blur focus:outline-none focus:ring-4 focus:ring-blue-100"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <button
                onClick={startCreate}
                className="h-11 px-4 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                New Studio
              </button>
            </div>
          ) : null}
        </div>

        <LayoutGroup>
          {/* IMPORTANT: when a studio is selected, we do NOT render the grid at all.
              This prevents the "small tile stays" behavior and lets the detail fill the space. */}
          <AnimatePresence mode="wait">
            {!selected ? (
              <motion.div
                key="studio-grid"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filtered.map((s) => (
                    <StudioCard key={s.id} studio={s} onOpen={() => setSelected(s)} />
                  ))}
                </div>
              </motion.div>
            ) : (
              <motion.div
                key={`studio-expanded-wrap-${selected.id}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="mt-6"
              >
                <StudioExpanded
                  studioId={selected.id}
                  initialData={selected}
                  allUsers={allUsers || []}
                  onClose={() => setSelected(null)}
                  canCreateMachines={!!can?.('createMachines')}
                  canManageEmployees={!!can?.('manageEmployees')}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </div>

      {/* Create Studio */}
      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] grid place-items-center bg-slate-900/10 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-[min(92vw,40rem)] rounded-[2rem] bg-white/85 backdrop-blur-xl border border-white/40 shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">Create Studio</h3>
                <button
                  onClick={() => setCreating(false)}
                  className="text-slate-500 hover:text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="space-y-3">
                <LabeledInput
                  label="Name"
                  value={creatingData.name}
                  onChange={(v) => setCreatingData((s) => ({ ...s, name: v }))}
                  placeholder="e.g., Design Studio"
                />
                <LabeledTextarea
                  label="Description"
                  value={creatingData.description}
                  onChange={(v) => setCreatingData((s) => ({ ...s, description: v }))}
                  placeholder="What can members do here?"
                />

                <div className="block">
                  <div className="text-sm font-medium text-slate-700 mb-1">
                    Cover Image (stored in Firestore)
                  </div>
                  <label className="flex items-center gap-3 rounded-xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 cursor-pointer hover:bg-white">
                    <Upload className="w-5 h-5 text-slate-500" />
                    <span className="text-sm text-slate-600">
                      {coverFile ? coverFile.name : 'Choose an image file (JPG/PNG)'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  {coverFile ? (
                    <div className="text-xs text-slate-500 mt-1">
                      {(coverFile.size / 1024 / 1024).toFixed(2)} MB (will be compressed)
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-5">
                <button
                  onClick={() => setCreating(false)}
                  className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                  disabled={savingStudio}
                >
                  Cancel
                </button>
                <button
                  onClick={saveCreate}
                  className="h-11 px-4 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
                  disabled={savingStudio || !creatingData.name.trim() || !coverFile}
                >
                  {savingStudio ? 'Saving…' : 'Save Studio'}
                </button>
              </div>
            </motion.div>
          </motion.div>
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

// -----------------------------------------------------------------------------
// bokeh background
// -----------------------------------------------------------------------------
function BokehBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10">
      <motion.div
        className="absolute -top-24 -left-24 w-[520px] h-[520px] rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(35% 35% at 50% 50%, rgba(99,102,241,0.45), rgba(99,102,241,0))',
        }}
        animate={{ x: [0, 20, -10, 0], y: [0, -10, 15, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-1/3 -right-16 w-[600px] h-[600px] rounded-full blur-[90px]"
        style={{
          background:
            'radial-gradient(40% 40% at 50% 50%, rgba(14,165,233,0.40), rgba(14,165,233,0))',
        }}
        animate={{ x: [0, -20, 10, 0], y: [0, 10, -15, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-140px] left-1/3 w-[520px] h-[520px] rounded-full blur-[80px]"
        style={{
          background:
            'radial-gradient(45% 45% at 50% 50%, rgba(16,185,129,0.35), rgba(16,185,129,0))',
        }}
        animate={{ x: [0, 10, -15, 0], y: [0, -8, 12, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// -----------------------------------------------------------------------------
// inputs
// -----------------------------------------------------------------------------
function LabeledInput({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
      />
    </label>
  );
}
function LabeledTextarea({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-slate-700 mb-1">{label}</div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-[96px] px-4 py-3 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
      />
    </label>
  );
}

// -----------------------------------------------------------------------------
// grid card
// -----------------------------------------------------------------------------
function StudioCard({ studio, onOpen }) {
  const coverSrc = studio.coverData || studio.coverUrl || '/placeholder.png';
  return (
    <motion.button
      layout
      layoutId={`studio-${studio.id}`}
      onClick={onOpen}
      className="group relative text-left rounded-[1.6rem] overflow-hidden border border-slate-200 bg-white/70 backdrop-blur hover:bg-white/85 transition shadow-xl"
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
          {(studio.description || '').length > 110
            ? `${studio.description.slice(0, 110)}…`
            : studio.description || ''}
        </p>
      </div>
    </motion.button>
  );
}

// -----------------------------------------------------------------------------
// expanded view
// -----------------------------------------------------------------------------
function StudioExpanded({
  studioId,
  initialData,
  allUsers,
  onClose,
  canCreateMachines,
  canManageEmployees,
}) {
  const [studio, setStudio] = useState(initialData);
  const [tab, setTab] = useState('about');

  const [tools, setTools] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [mentors, setMentors] = useState([]);
  const [gallery, setGallery] = useState([]);

  // GLOBAL machines from /machines
  const [machines, setMachines] = useState([]);

  // Studio + subs
  useEffect(() => {
    const unsubStudio = onSnapshot(doc(db, STUDIOS, studioId), (d) => {
      if (d.exists()) setStudio({ id: d.id, ...d.data() });
    });

    const unsubTools = onSnapshot(collection(db, STUDIOS, studioId, SUBS.tools), (snap) =>
      setTools(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    const unsubMaterials = onSnapshot(collection(db, STUDIOS, studioId, SUBS.materials), (snap) =>
      setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    const unsubMentors = onSnapshot(collection(db, STUDIOS, studioId, SUBS.mentors), (snap) =>
      setMentors(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    const unsubGallery = onSnapshot(collection(db, STUDIOS, studioId, SUBS.gallery), (snap) =>
      setGallery(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => {
      unsubStudio();
      unsubTools();
      unsubMaterials();
      unsubMentors();
      unsubGallery();
    };
  }, [studioId]);

  // Machines: listen to global /machines and filter client-side (robust to schema changes)
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'machines'), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const filtered = all.filter((m) => {
        const sid = m.studioId || m.studio?.id || m.studio?.docId;
        return String(sid || '') === String(studioId);
      });
      setMachines(filtered);
    });
    return () => unsub();
  }, [studioId]);

  const counts = {
    tools: tools.length,
    machines: machines.length,
    materials: materials.length,
    mentors: mentors.length,
    gallery: gallery.length,
  };

  const coverSrc = studio.coverData || studio.coverUrl || '/placeholder.png';

  return (
    <motion.div layout className="w-full">
      <motion.div
        layout
        layoutId={`studio-${studioId}`}
        className="rounded-[2rem] overflow-hidden border border-slate-200 bg-white/85 backdrop-blur-xl shadow-2xl"
      >
        {/* cover */}
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
              href="/dashboard"
              className="px-3 h-10 rounded-full bg-white/85 border border-white/50 text-slate-800 font-medium hover:bg-white inline-flex items-center gap-2"
            >
              <LayoutDashboard className="w-4 h-4" />
              Dashboard
            </Link>
            <Link
              href="/"
              className="px-3 h-10 rounded-full bg-white/85 border border-white/50 text-slate-800 font-medium hover:bg-white inline-flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              Done
            </Link>
          </div>

          <div className="absolute bottom-4 left-4 text-white drop-shadow">
            <h2 className="text-2xl md:text-3xl font-bold">{studio.name}</h2>
            <p className="opacity-90 max-w-2xl">
              {(studio.description || '').length > 220
                ? `${studio.description.slice(0, 220)}…`
                : studio.description || ''}
            </p>
          </div>
        </div>

        {/* tabs */}
        <div className="px-5 pt-4">
          <div className="flex flex-wrap items-center gap-2">
            <TabBtn icon={<Info className="w-4 h-4" />} label="About" active={tab === 'about'} onClick={() => setTab('about')} />
            <TabBtn icon={<Hammer className="w-4 h-4" />} label="Tools" badge={counts.tools} active={tab === 'tools'} onClick={() => setTab('tools')} />
            <TabBtn icon={<Wrench className="w-4 h-4" />} label="Machines" badge={counts.machines} active={tab === 'machines'} onClick={() => setTab('machines')} />
            <TabBtn icon={<Box className="w-4 h-4" />} label="Materials" badge={counts.materials} active={tab === 'materials'} onClick={() => setTab('materials')} />
            <TabBtn icon={<Users className="w-4 h-4" />} label="Mentors" badge={counts.mentors} active={tab === 'mentors'} onClick={() => setTab('mentors')} />
            <TabBtn icon={<ImageIcon className="w-4 h-4" />} label="Gallery" badge={counts.gallery} active={tab === 'gallery'} onClick={() => setTab('gallery')} />
          </div>
        </div>

        {/* content */}
        <div className="p-5">
          {tab === 'about' && <AboutBlock studio={studio} counts={counts} />}

          {tab === 'tools' && (
            <ItemsBlock studioId={studioId} path={SUBS.tools} title="Tools" icon={Hammer} emptyCta="Add a tool" />
          )}

          {tab === 'machines' && (
            <MachinesBlock
              studioId={studioId}
              studioName={studio?.name || ''}
              machines={machines}
              canCreateMachines={canCreateMachines}
            />
          )}

          {tab === 'materials' && (
            <ItemsBlock
              studioId={studioId}
              path={SUBS.materials}
              title="Materials"
              icon={Box}
              emptyCta="Add a material"
            />
          )}

          {tab === 'mentors' && (
            <MentorsBlock
              studioId={studioId}
              mentors={mentors}
              allUsers={allUsers}
              canManageEmployees={canManageEmployees}
            />
          )}

          {tab === 'gallery' && <GalleryBlock studioId={studioId} gallery={gallery} />}
        </div>
      </motion.div>
    </motion.div>
  );
}

// -----------------------------------------------------------------------------
// tabs ui
// -----------------------------------------------------------------------------
function TabBtn({ icon, label, active, onClick, badge }) {
  return (
    <button
      onClick={onClick}
      className={`h-10 px-4 rounded-full border transition backdrop-blur ${
        active
          ? 'bg-slate-900 text-white border-slate-900'
          : 'bg-white/70 text-slate-800 border-slate-200 hover:bg-white'
      }`}
    >
      <span className="inline-flex items-center gap-2">
        {icon}
        {label}
        {typeof badge === 'number' ? (
          <span className={`ml-1 text-xs px-2 py-0.5 rounded-full ${active ? 'bg-white/20' : 'bg-slate-100 text-slate-600'}`}>
            {badge}
          </span>
        ) : null}
      </span>
    </button>
  );
}

// -----------------------------------------------------------------------------
// blocks
// -----------------------------------------------------------------------------
function AboutBlock({ studio, counts }) {
  const pills = [
    { k: 'tools', n: counts.tools },
    { k: 'machines', n: counts.machines },
    { k: 'materials', n: counts.materials },
    { k: 'mentors', n: counts.mentors },
    { k: 'gallery', n: counts.gallery },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="md:col-span-2">
        <div className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-4">
          <h4 className="font-semibold flex items-center gap-2">
            <Info className="w-4 h-4 text-slate-600" /> About this studio
          </h4>
          <p className="text-slate-700 mt-2 leading-relaxed">{studio.description || '—'}</p>
        </div>
      </div>
      <div className="space-y-3">
        {pills.map((p) => (
          <div
            key={p.k}
            className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-3 flex items-center justify-between"
          >
            <div className="capitalize text-slate-700">{p.k}</div>
            <div className="font-semibold text-slate-900">{p.n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ItemsBlock({ studioId, path, title, icon: Icon, emptyCta }) {
  const [items, setItems] = useState([]);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, STUDIOS, studioId, path), (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [studioId, path]);

  const addItem = async () => {
    const n = name.trim();
    if (!n) return;
    await addDoc(collection(db, STUDIOS, studioId, path), {
      name: n,
      note: note?.trim() || '',
      createdAt: serverTimestamp(),
    });
    setName('');
    setNote('');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-slate-700" />
          <h4 className="font-semibold">{title}</h4>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {items.map((it) => (
          <div key={it.id} className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-3">
            <div className="font-semibold">{it.name}</div>
            {it.note ? <div className="text-sm text-slate-600 mt-1">{it.note}</div> : null}
          </div>
        ))}
        {items.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 text-slate-500">
            No {title.toLowerCase()} yet.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur p-4 mt-4">
        <div className="text-sm font-medium text-slate-700 mb-2">{emptyCta}</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`${title.slice(0, -1)} name`}
            className="h-11 px-4 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notes (optional)"
            className="h-11 px-4 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
          />
          <button onClick={addItem} className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Machines (GLOBAL /machines) — create requires createMachines permission
// -----------------------------------------------------------------------------
function MachinesBlock({ studioId, studioName, machines, canCreateMachines }) {
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [studio, setStudio] = useState(studioName || '');
  const [status, setStatus] = useState('available'); // optional field

  useEffect(() => setStudio(studioName || ''), [studioName]);

  const openCreate = () => {
    setName('');
    setStatus('available');
    setCreating(true);
  };

  const createMachine = async () => {
    if (!canCreateMachines) return;
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'machines'), {
        name: n,
        studioId,
        studioName: studio || studioName || '',
        status,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setCreating(false);
    } catch (e) {
      console.error('Create machine failed', e);
      alert('Could not create machine.');
    } finally {
      setSaving(false);
    }
  };

  const removeMachine = async (m) => {
    if (!canCreateMachines) return;
    const ok = window.confirm(`Remove machine "${m.name}"?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, 'machines', m.id));
    } catch (e) {
      console.error('Delete machine failed', e);
      alert('Could not remove machine.');
    }
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-slate-700" />
          <h4 className="font-semibold">Machines</h4>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/machines"
            className="h-10 px-4 rounded-full bg-white/70 border border-slate-200 text-slate-800 font-semibold hover:bg-white inline-flex items-center gap-2"
          >
            <LayoutDashboard className="w-4 h-4" />
            View all machines
          </Link>

          <button
            onClick={openCreate}
            disabled={!canCreateMachines}
            className="h-10 px-4 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-2"
            title={!canCreateMachines ? 'Requires createMachines permission' : 'Add a machine'}
          >
            <Plus className="w-4 h-4" />
            Add machine
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {machines.map((m) => (
          <div key={m.id} className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{m.name}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {m.status ? `Status: ${m.status}` : '—'}
                </div>
              </div>

              {canCreateMachines ? (
                <button
                  onClick={() => removeMachine(m)}
                  className="p-2 rounded-xl border border-slate-200 bg-white/70 hover:bg-white text-rose-600"
                  title="Remove machine"
                >
                  <Trash className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          </div>
        ))}

        {machines.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 text-slate-500">
            No machines yet.
          </div>
        )}
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] grid place-items-center bg-slate-900/10 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 24, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              className="w-[min(92vw,40rem)] rounded-[2rem] bg-white/90 backdrop-blur-xl border border-white/40 shadow-2xl p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold">Add Machine</h3>
                <button onClick={() => setCreating(false)} className="text-slate-500 hover:text-slate-700">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {!canCreateMachines ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
                  You do not have permission to create machines. (Requires <span className="font-semibold">createMachines</span>)
                </div>
              ) : (
                <div className="space-y-3">
                  <LabeledInput label="Machine name" value={name} onChange={setName} placeholder="e.g., Epilog Laser Engraver" />
                  <LabeledInput label="Studio" value={studio} onChange={setStudio} placeholder="Studio name (optional)" />
                  <label className="block">
                    <div className="text-sm font-medium text-slate-700 mb-1">Status</div>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                      className="w-full h-11 px-4 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
                    >
                      <option value="available">available</option>
                      <option value="offline">offline</option>
                      <option value="maintenance">maintenance</option>
                    </select>
                  </label>

                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => setCreating(false)}
                      className="h-11 px-4 rounded-full bg-white border border-slate-200 text-slate-800 font-semibold hover:bg-slate-50"
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={createMachine}
                      className="h-11 px-4 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-60"
                      disabled={saving || !name.trim()}
                    >
                      {saving ? 'Saving…' : 'Create'}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Mentors — manage requires manageEmployees permission
// -----------------------------------------------------------------------------
function MentorsBlock({ studioId, mentors, allUsers, canManageEmployees }) {
  const [search, setSearch] = useState('');

  const candidates = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    const list = (allUsers || []).map((u) => ({
      id: u.id,
      name: u.fullName || u.name || 'Unnamed',
      photoURL: u.photoURL || null,
    }));
    const filtered = q ? list.filter((u) => u.name.toLowerCase().includes(q)) : list.slice(0, 40);

    // Hide already-added users from picker
    const existing = new Set((mentors || []).map((m) => String(m.userId || '')));
    return filtered.filter((u) => !existing.has(String(u.id)));
  }, [allUsers, search, mentors]);

  const addMentor = async (u) => {
    if (!canManageEmployees) return;
    const ref = doc(collection(db, STUDIOS, studioId, SUBS.mentors));
    await setDoc(ref, {
      id: ref.id,
      userId: u.id,
      name: u.name,
      photoURL: u.photoURL || null,
      addedAt: serverTimestamp(),
    });
  };

  const removeMentor = async (m) => {
    if (!canManageEmployees) return;
    const ok = window.confirm(`Remove mentor "${m.name}" from this studio?`);
    if (!ok) return;
    try {
      await deleteDoc(doc(db, STUDIOS, studioId, SUBS.mentors, m.id));
    } catch (e) {
      console.error('Remove mentor failed', e);
      alert('Could not remove mentor.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
      <div className="lg:col-span-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {mentors.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl border border-slate-200 bg-white/70 backdrop-blur p-3 flex items-center gap-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={m.photoURL || '/default-avatar.png'}
                alt={m.name}
                className="w-10 h-10 rounded-xl object-cover"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{m.name}</div>
                <div className="text-xs text-slate-500 truncate">{m.userId || ''}</div>
              </div>

              {canManageEmployees ? (
                <button
                  onClick={() => removeMentor(m)}
                  className="p-2 rounded-xl border border-slate-200 bg-white/70 hover:bg-white text-rose-600"
                  title="Remove mentor"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>
          ))}

          {mentors.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 text-slate-500">
              No mentors yet.
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white/80 backdrop-blur p-4">
        <div className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
          <UserPlus className="w-4 h-4" /> Add mentor (from users)
        </div>

        {!canManageEmployees ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-800 text-sm">
            You do not have permission to manage mentors. (Requires{' '}
            <span className="font-semibold">manageEmployees</span>)
          </div>
        ) : (
          <>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search users…"
                className="w-full h-11 pl-9 pr-3 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
              />
            </div>

            <div className="max-h-64 overflow-auto pr-1 space-y-1">
              {candidates.map((u) => (
                <button
                  key={u.id}
                  onClick={() => addMentor(u)}
                  className="w-full text-left rounded-xl border border-slate-200 bg-white/70 hover:bg-white transition p-2 flex items-center gap-3"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={u.photoURL || '/default-avatar.png'}
                    alt={u.name}
                    className="w-8 h-8 rounded-lg object-cover"
                  />
                  <div className="truncate">{u.name}</div>
                </button>
              ))}
              {candidates.length === 0 && <div className="text-sm text-slate-500">No users.</div>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function GalleryBlock({ studioId, gallery }) {
  const [file, setFile] = useState(null);
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);

  const addImage = async () => {
    if (!file) return;
    setUploading(true);
    try {
      let dataUrl = await compressImageToDataURL(file, { maxWidth: 1600, quality: 0.85 });
      if (dataUrl.length > 900_000) {
        const retry = await compressImageToDataURL(file, { maxWidth: 1400, quality: 0.75 });
        if (retry.length < dataUrl.length) dataUrl = retry;
      }

      await addDoc(collection(db, STUDIOS, studioId, SUBS.gallery), {
        dataUrl,
        caption: caption?.trim() || '',
        createdAt: serverTimestamp(),
      });

      setFile(null);
      setCaption('');
    } catch (e) {
      console.error('Gallery upload failed', e);
      alert('Could not add image to gallery.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
        {gallery.map((g) => {
          const src = g.dataUrl || g.url;
          return (
            <div key={g.id} className="rounded-2xl overflow-hidden border border-slate-200 bg-white/70 backdrop-blur">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={g.caption || 'Gallery'} className="w-full h-40 object-cover" />
              <div className="p-2 text-sm text-slate-700 truncate">{g.caption || '—'}</div>
            </div>
          );
        })}

        {gallery.length === 0 && (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white/60 backdrop-blur p-4 text-slate-500">
            No images yet.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white/80 backdrop-blur p-4 mt-4">
        <div className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2">
          <Upload className="w-4 h-4" /> Add to gallery
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="h-11 px-4 rounded-xl border border-dashed border-slate-300 bg-white/80 flex items-center gap-3 cursor-pointer hover:bg-white">
            <Upload className="w-4 h-4 text-slate-500" />
            <span className="text-sm text-slate-600">{file ? file.name : 'Choose image'}</span>
            <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            className="h-11 px-4 rounded-xl border border-slate-200 bg-white/80 focus:outline-none focus:ring-4 focus:ring-blue-100"
          />
          <button
            onClick={addImage}
            className="h-11 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
            disabled={uploading || !file}
          >
            {uploading ? 'Uploading…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

