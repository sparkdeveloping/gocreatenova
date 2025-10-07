'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import dayjs from 'dayjs';

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { app } from '../lib/firebase';

import {
  UserCheck,
  Users,
  GraduationCap,
  BookOpen,
  Heart,
  Tag,
} from 'lucide-react';

// ------------------------------------------------------------
// Config
const STEPS = ['Know You', 'Personal Info', 'Emergency', 'Vehicles', 'Done'];

// Map membership type -> Role name to attach (case-insensitive match)
const MEMBERSHIP_TO_ROLE = {
  'Student': 'Student',
  'WSU Staff': 'Staff',
  'Educator': 'Educator',
  'Senior Citizen': 'Senior',
  'Veteran': 'Veteran',
  'None': 'Member',
};

// Safer Tailwind classes for Step 1 tiles
// Vibrant tile palette for Step 1
const TILE_PALETTE = {
  yellow: {
    selected: 'bg-gradient-to-br from-amber-50 to-yellow-100 border-amber-400 ring-amber-300 text-amber-800 shadow-amber-200/60',
    dot: 'bg-amber-500',
  },
  indigo: {
    selected: 'bg-gradient-to-br from-indigo-50 to-indigo-100 border-indigo-400 ring-indigo-300 text-indigo-800 shadow-indigo-200/60',
    dot: 'bg-indigo-500',
  },
  green: {
    selected: 'bg-gradient-to-br from-emerald-50 to-emerald-100 border-emerald-400 ring-emerald-300 text-emerald-800 shadow-emerald-200/60',
    dot: 'bg-emerald-500',
  },
  pink: {
    selected: 'bg-gradient-to-br from-pink-50 to-rose-100 border-pink-400 ring-pink-300 text-pink-800 shadow-pink-200/60',
    dot: 'bg-pink-500',
  },
  red: {
    selected: 'bg-gradient-to-br from-red-50 to-rose-100 border-red-400 ring-red-300 text-red-800 shadow-red-200/60',
    dot: 'bg-red-500',
  },
  slate: {
    selected: 'bg-gradient-to-br from-slate-50 to-slate-100 border-slate-400 ring-slate-300 text-slate-800 shadow-slate-200/60',
    dot: 'bg-slate-500',
  },
};


// ------------------------------------------------------------

export default function SignupPage() {
  const router = useRouter();
  const db = getFirestore(app);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(30);

  const [wizardData, setWizardData] = useState({
    membershipType: '',
    firstName: '',
    lastName: '',
    suffix: '',
    email: '',
    phone: '',
    address: '',
    birthday: '',
    emergency: [
      {
        name: '',
        phone: '',
        email: '',
        street: '',
        country: '',
        state: '',
        city: '',
        zip: '',
      },
    ],
    vehicles: [],
    addVehicles: false,
  });

  const updateWizard = (patch) => setWizardData((prev) => ({ ...prev, ...patch }));

  const isValidEmergency = useMemo(() => {
    return wizardData.emergency.every((c) =>
      c.name.trim() !== '' &&
      c.phone.trim() !== '' &&
      c.email.trim() !== '' &&
      c.street.trim() !== '' &&
      c.country.trim() !== '' &&
      c.city.trim() !== '' &&
      c.zip.trim() !== '' &&
      (c.country !== 'USA' || c.state.trim() !== '')
    );
  }, [wizardData.emergency]);

  // success countdown
  useEffect(() => {
    if (step === STEPS.length - 1) {
      const interval = setInterval(() => {
        setSeconds((s) => {
          if (s <= 1) {
            router.push('/');
            return 0;
          }
          return s - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step, router]);

  // ---- Roles resolution: default role + membership-mapped role (by name) ----
  async function resolveAssignedRoles(membershipType) {
    const snap = await getDocs(collection(db, 'roles'));
    const roles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const byName = new Map(
      roles.map((r) => [String(r.name || '').toLowerCase(), r])
    );

    const defaultRole = roles.find((r) => !!r.isDefault) || null;

    const mappedName = MEMBERSHIP_TO_ROLE[membershipType] || 'Member';
    const mappedRole =
      byName.get(String(mappedName).toLowerCase()) ||
      byName.get('member') ||
      null;

    const summaries = [];
    const aliases = [];

    if (defaultRole) {
      summaries.push({ id: defaultRole.id, name: defaultRole.name });
      aliases.push(String(defaultRole.name || '').toLowerCase());
    }

    if (mappedRole && (!defaultRole || mappedRole.id !== defaultRole.id)) {
      summaries.push({ id: mappedRole.id, name: mappedRole.name });
      aliases.push(String(mappedRole.name || '').toLowerCase());
    }

    // Fallback if nothing found: create a soft alias record (keeps legacy filters working)
    if (summaries.length === 0) {
      aliases.push('member');
    }

    // Dedup aliases
    const roleAliases = Array.from(new Set(aliases.filter(Boolean)));

    return { assigned: summaries, roleAliases };
  }

  async function handleSubmit() {
    try {
      setLoading(true);

      // Resolve roles
      const { assigned, roleAliases } = await resolveAssignedRoles(
        wizardData.membershipType
      );

      // Build user doc
      const docData = {
        fullName: `${wizardData.firstName} ${wizardData.lastName}`.trim(),
        suffix: wizardData.suffix || null,
        email: wizardData.email,
        phone: wizardData.phone,
        address: wizardData.address,
        birthday: wizardData.birthday || null,

        membershipType: wizardData.membershipType || 'None',

        // Keep data models rich + compatible:
        roles: assigned,             // [{id,name}] -> used by Roles/Permissions layer
        roleAliases,                 // ['member','student',...] -> keeps older string-based filters working

        emergencyContacts: wizardData.emergency,
        vehicles: wizardData.addVehicles ? wizardData.vehicles : [],
        createdAt: serverTimestamp(),
      };

      await addDoc(collection(db, 'users'), docData);
      setStep(4);
    } catch (err) {
      console.error(err);
      alert('Something went wrong creating your membership. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------- UI -----------------------------

  return (
    <div className="relative min-h-screen bg-gradient-to-br from-white via-[#f1f5f9] to-white overflow-hidden">
      {/* gentle blobs */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute w-64 h-64 bg-pink-200 rounded-full filter blur-3xl opacity-20 animate-pulse top-0 left-0" />
        <div className="absolute w-64 h-64 bg-blue-200 rounded-full filter blur-3xl opacity-20 animate-pulse bottom-0 right-0" />
      </div>

      {/* corner chips */}
      <CornerCard position="top-left" content="Wichita, KS — 75°F ☀️" />
      <CornerCard position="top-right" content={`${dayjs().format('dddd, MMM D')} — ${dayjs().format('h:mm A')}`} />
      <CornerCard position="bottom-left" content="Gallery" />
      <CornerCard position="bottom-right" content="Map" />

      <div className="relative z-10 flex flex-col items-center justify-center min-h-[80vh] px-4">
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="bg-white/80 backdrop-blur-lg border border-slate-200 rounded-[2rem] shadow-xl w-full max-w-xl p-6 space-y-4"
        >
          <StepIndicator step={step} />

          <AnimatePresence mode="wait">
            {step === 0 && (
              <Step1
                key="step1"
                data={wizardData}
                update={updateWizard}
                onNext={() => wizardData.membershipType && setStep(1)}
              />
            )}

            {step === 1 && (
              <Step2
                key="step2"
                data={wizardData}
                update={updateWizard}
                onNext={() => {
                  const ok =
                    wizardData.firstName &&
                    wizardData.lastName &&
                    wizardData.email &&
                    wizardData.phone &&
                    wizardData.address &&
                    wizardData.birthday;
                  if (ok) setStep(2);
                }}
                onBack={() => setStep(0)}
              />
            )}

            {step === 2 && (
              <Step3
                key="step3"
                data={wizardData}
                update={updateWizard}
                onNext={() => isValidEmergency && setStep(3)}
                onBack={() => setStep(1)}
              />
            )}

            {step === 3 && (
              <Step4
                key="step4"
                data={wizardData}
                update={updateWizard}
                onNext={handleSubmit}
                onBack={() => setStep(2)}
                loading={loading}
              />
            )}

            {step === 4 && <Step5 key="step5" seconds={seconds} />}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

// ---------------- small pieces ----------------

function CornerCard({ position, content }) {
  const pos = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };
  return (
    <div className={`absolute ${pos[position]} bg-white/80 backdrop-blur-md rounded-xl px-3 py-2 text-sm border border-slate-300 shadow-sm cursor-pointer text-slate-700 hover:scale-105 transition`}>
      {content}
    </div>
  );
}

function StepIndicator({ step }) {
  return (
    <div className="flex space-x-2 justify-center mb-2">
      {STEPS.map((_, idx) => {
        const color = idx   < step ? 'bg-blue-500' : idx === step ? 'bg-blue-300' : 'bg-gray-300';
        return <div key={idx} className={`${color} flex-1 h-2 rounded-full`} />;
      })}
    </div>
  );
}

// ---------------- steps ----------------

// Step 1
function Step1({ data, update, onNext }) {
  const types = [
    { label: 'Student', icon: GraduationCap, colorKey: 'yellow' },
    { label: 'WSU Staff', icon: Users, colorKey: 'indigo' },
    { label: 'Educator', icon: BookOpen, colorKey: 'green' },
    { label: 'Senior Citizen', icon: Heart, colorKey: 'pink' },
    { label: 'Veteran', icon: UserCheck, colorKey: 'red' },
    { label: 'None', icon: Tag, colorKey: 'slate' },
  ];

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Getting to know you better</h2>

      <div className="grid grid-cols-2 gap-3">
        {types.map((t) => {
          const selected = data.membershipType === t.label;
          const palette = TILE_PALETTE[t.colorKey] || TILE_PALETTE.slate;

          const base =
            'relative group w-full p-4 rounded-xl border text-center transition ' +
            'bg-white/80 border-slate-300 text-slate-700 hover:bg-white shadow-sm hover:shadow ' +
            'focus:outline-none';

          const sel =
            ` ring-2 ${palette.selected} shadow-lg `;

          return (
            <button
              key={t.label}
              type="button"
              onClick={() => update({ membershipType: t.label })}
              className={base + (selected ? sel : '')}
            >
              {/* status dot when selected */}
              {selected && (
                <span className={`absolute top-2 right-2 w-2.5 h-2.5 rounded-full ${palette.dot}`} />
              )}

              {/* icon + label */}
              <t.icon
                size={24}
                className={
                  'mx-auto mb-2 transition-opacity ' +
                  (selected ? 'opacity-100' : 'opacity-80 group-hover:opacity-100')
                }
              />
              <span className="font-medium">{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 text-right">
        <button
          onClick={onNext}
          disabled={!data.membershipType}
          className={`rounded-xl py-2 px-4 transition text-white shadow ${
            !data.membershipType
              ? 'bg-blue-300'
              : 'bg-blue-500 hover:bg-blue-600 hover:scale-105'
          }`}
        >
          Next
        </button>
      </div>
    </>
  );
}


// Step 2
function Step2({ data, update, onNext, onBack }) {
  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Personal Information</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <InputField placeholder="First Name" value={data.firstName} setValue={(v) => update({ firstName: v })} />
        <InputField placeholder="Last Name" value={data.lastName} setValue={(v) => update({ lastName: v })} />
        <InputField placeholder="Suffix (optional)" value={data.suffix} setValue={(v) => update({ suffix: v })} />
        <InputField placeholder="Email" value={data.email} setValue={(v) => update({ email: v })} />
        <InputField placeholder="Phone" value={data.phone} setValue={(v) => update({ phone: v })} />
        <InputField placeholder="Address" value={data.address} setValue={(v) => update({ address: v })} />
        <div className="relative md:col-span-2">
          <input
            type="date"
            value={data.birthday}
            onChange={(e) => update({ birthday: e.target.value })}
            className="w-full rounded-xl bg-slate-50/80 border border-slate-300 text-slate-700 px-3 py-3 text-sm focus:outline-none backdrop-blur-md shadow-sm"
          />
        </div>
      </div>
      <div className="mt-6 flex justify-between">
        <button onClick={onBack} className="text-slate-500 hover:underline">Back</button>
        <button onClick={onNext} className="bg-blue-500 hover:bg-blue-600 hover:scale-105 text-white rounded-xl py-2 px-4 transition">Next</button>
      </div>
    </>
  );
}

// Step 3
function Step3({ data, update, onNext, onBack }) {
  const add = () =>
    update({
      emergency: [
        ...data.emergency,
        { name: '', phone: '', email: '', street: '', country: '', state: '', city: '', zip: '' },
      ],
    });

  const remove = (i) => update({ emergency: data.emergency.filter((_, idx) => idx !== i) });

  const edit = (i, key, val) =>
    update({ emergency: data.emergency.map((c, idx) => (idx === i ? { ...c, [key]: val } : c)) });

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Emergency Contacts</h2>
      {data.emergency.map((c, idx) => (
        <div key={idx} className="border border-slate-300 rounded-xl p-3 mb-3 space-y-2 bg-slate-50/80">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <InputField placeholder="Name" value={c.name} setValue={(v) => edit(idx, 'name', v)} />
            <InputField placeholder="Phone" value={c.phone} setValue={(v) => edit(idx, 'phone', v)} />
            <InputField placeholder="Email" value={c.email} setValue={(v) => edit(idx, 'email', v)} />
            <InputField placeholder="Street" value={c.street} setValue={(v) => edit(idx, 'street', v)} />
            <InputField placeholder="Country" value={c.country} setValue={(v) => edit(idx, 'country', v)} />
            {c.country === 'USA' && (
              <InputField placeholder="State" value={c.state} setValue={(v) => edit(idx, 'state', v)} />
            )}
            <InputField placeholder="City" value={c.city} setValue={(v) => edit(idx, 'city', v)} />
            <InputField placeholder="Zip / Postal" value={c.zip} setValue={(v) => edit(idx, 'zip', v)} />
          </div>
          {data.emergency.length > 1 && (
            <button onClick={() => remove(idx)} className="text-sm text-red-500 hover:underline">Remove</button>
          )}
        </div>
      ))}
      <button onClick={add} className="text-blue-500 hover:underline">Add Another</button>
      <div className="mt-4 flex justify-between">
        <button onClick={onBack} className="text-slate-500 hover:underline">Back</button>
        <button onClick={onNext} className="bg-blue-500 hover:bg-blue-600 hover:scale-105 text-white rounded-xl py-2 px-4 transition">Next</button>
      </div>
    </>
  );
}

// Step 4
function Step4({ data, update, onNext, onBack, loading }) {
  const add = () =>
    update({
      vehicles: [...data.vehicles, { make: '', model: '', year: '', color: '', plate: '' }],
    });
  const remove = (i) => update({ vehicles: data.vehicles.filter((_, idx) => idx !== i) });
  const edit = (i, k, v) =>
    update({ vehicles: data.vehicles.map((obj, idx) => (idx === i ? { ...obj, [k]: v } : obj)) });

  return (
    <>
      <h2 className="text-xl font-semibold text-slate-800 mb-4">Vehicles</h2>
      {!data.addVehicles ? (
        <>
          <p className="text-slate-600">Would you like to add vehicle information?</p>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => update({ addVehicles: true })}
              className="bg-blue-500 hover:bg-blue-600 hover:scale-105 text-white rounded-xl py-2 px-4 transition"
            >
              Yes
            </button>
            <button
              onClick={onNext}
              disabled={loading}
              className="bg-slate-300 hover:bg-slate-400 hover:scale-105 rounded-xl py-2 px-4 transition disabled:opacity-60"
            >
              No, Skip
            </button>
          </div>
        </>
      ) : (
        <>
          {data.vehicles.map((v, idx) => (
            <div key={idx} className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-2">
              <InputField placeholder="Make" value={v.make} setValue={(val) => edit(idx, 'make', val)} />
              <InputField placeholder="Model" value={v.model} setValue={(val) => edit(idx, 'model', val)} />
              <InputField placeholder="Year" value={v.year} setValue={(val) => edit(idx, 'year', val)} />
              <InputField placeholder="Color" value={v.color} setValue={(val) => edit(idx, 'color', val)} />
              <InputField placeholder="License Plate" value={v.plate} setValue={(val) => edit(idx, 'plate', val)} />
              <button
                onClick={() => remove(idx)}
                className="text-sm text-red-500 hover:underline md:col-span-3 text-left"
              >
                Remove
              </button>
            </div>
          ))}
          <button onClick={add} className="text-blue-500 hover:underline">Add Another Vehicle</button>
          <div className="mt-4 flex justify-between">
            <button onClick={onBack} className="text-slate-500 hover:underline">Back</button>
            <button
              onClick={onNext}
              disabled={loading}
              className="bg-blue-500 hover:bg-blue-600 hover:scale-105 text-white rounded-xl py-2 px-4 transition disabled:opacity-60"
            >
              {loading ? 'Submitting…' : 'Finish'}
            </button>
          </div>
        </>
      )}
    </>
  );
}

// Step 5
function Step5({ seconds }) {
  return (
    <div className="text-center space-y-4">
      <h2 className="text-2xl font-bold text-slate-800">Successfully created your membership!</h2>
      <p className="text-slate-600">Please collect your badge at the front desk.</p>
      <p className="text-sm text-slate-500">Returning to home in {seconds} seconds…</p>
    </div>
  );
}

// Input
function InputField({ placeholder, value, setValue }) {
  return (
    <input
      className="w-full rounded-xl bg-slate-50/80 border border-slate-300 text-slate-700 px-3 py-3 text-sm focus:outline-none backdrop-blur-md shadow-sm"
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
