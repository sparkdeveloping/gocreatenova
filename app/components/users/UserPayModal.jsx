'use client';

import { useMemo, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { getFirestore } from 'firebase/firestore';
import { app } from '@/app/lib/firebase';

import GlassModal from '@/app/components/ui/GlassModal';
import FilterPills from '@/app/components/ui/FilterPills';
import NovaSwitch from '@/app/components/ui/NovaSwitch';
import Reveal from '@/app/components/ui/Reveal';

function Label({ children }) {
  return <div className="text-xs font-semibold text-gray-600 mb-1">{children}</div>;
}
function LabeledInput({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type={type}
        className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function LabeledNumber({ label, value, onChange, step = '1' }) {
  return (
    <div>
      <Label>{label}</Label>
      <input
        type="number"
        step={step}
        className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function GhostBtn({ children, onClick }) {
  return (
    <button onClick={onClick} className="px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200">
      {children}
    </button>
  );
}
function PrimaryBtn({ children, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-2 rounded-xl text-white shadow ${
        disabled ? 'bg-blue-300' : 'bg-blue-500 hover:bg-blue-600'
      }`}
    >
      {children}
    </button>
  );
}

export default function UserPayModal({
  open,
  onClose,
  user,          // { id, fullName | name }
  items = [],    // inventory items
  subs = [],     // subscription plans (definitions)
  onSaved,       // (createdPayment) => void
}) {
  const db = getFirestore(app);

  const userId = user?.id || '';
  const userName = user?.fullName || user?.name || '';

  const [mode, setMode] = useState('payment'); // 'payment' | 'subscription'
  const [method, setMethod] = useState('cash'); // cash | card | check
  const [externalRef, setExternalRef] = useState('');
  const [paid, setPaid] = useState(true); // receipt if true; invoice if false

  // ---- Payment (lines) ----
  const [lines, setLines] = useState([]); // {itemId?, name, qty, unitPrice, total}
  const addLineFromItem = (item) => {
    const unit = item.pricePerItem || item.price || 0;
    setLines((prev) => [...prev, { itemId: item.id, name: item.name, qty: 1, unitPrice: unit, total: unit }]);
  };
  const updateLine = (idx, patch) => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l;
        const next = { ...l, ...patch };
        next.total = Number(next.qty || 0) * Number(next.unitPrice || 0);
        return next;
      })
    );
  };
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));
  const totalPayment = useMemo(() => lines.reduce((s, l) => s + (Number(l.total) || 0), 0), [lines]);

  // ---- Subscription selection ----
  const [subId, setSubId] = useState('');
  const selectedPlan = useMemo(() => subs.find((s) => s.id === subId), [subs, subId]);
  const subPrice = selectedPlan?.price || 0;

  // ---- Common save ----
  const canSavePayment = userId && externalRef.trim().length > 0 && lines.length > 0;
  const canSaveSub = userId && externalRef.trim().length > 0 && !!selectedPlan;

  const savePayment = async () => {
    const payload = {
      type: paid ? 'receipt' : 'invoice',
      status: paid ? 'paid' : 'unpaid',
      method,
      externalRef: externalRef.trim(),
      lines,
      total: totalPayment,
      userId,
      userName,
      createdAt: serverTimestamp(),
      source: 'users', // helps you know this was created via /users
    };
    const ref = await addDoc(collection(db, 'payments'), payload);
    onSaved?.({ id: ref.id, ...payload });
    onClose?.();
  };

  const saveSubscription = async () => {
    const line = {
      subscriptionId: selectedPlan.id,
      name: selectedPlan.name,
      cycle: selectedPlan.cycle || 'monthly',
      qty: 1,
      unitPrice: Number(subPrice) || 0,
      total: Number(subPrice) || 0,
    };
    const payload = {
      type: paid ? 'receipt' : 'invoice',
      status: paid ? 'paid' : 'unpaid',
      method,
      externalRef: externalRef.trim(),
      lines: [line],
      total: line.total,
      userId,
      userName,
      createdAt: serverTimestamp(),
      source: 'users-subscription',
    };
    const ref = await addDoc(collection(db, 'payments'), payload);
    onSaved?.({ id: ref.id, ...payload });

    // OPTIONAL: if you want to stamp user profile with current plan, uncomment:
    // await updateDoc(doc(db, 'users', userId), { membershipType: selectedPlan.name, membershipPlanId: selectedPlan.id });

    onClose?.();
  };

  return (
    <GlassModal open={open} onClose={onClose} size="md" title={`Pay · ${userName || 'Member'}`}>
      {/* Tabs */}
      <div className="mb-3">
        <FilterPills
          value={mode}
          onChange={setMode}
          options={[
            { value: 'payment', label: 'Payment' },
            { value: 'subscription', label: 'Subscription' },
          ]}
        />
      </div>

      {/* BODY */}
      {mode === 'payment' ? (
        <div className="flex flex-col gap-4">
          {/* quick item picker */}
          <div className="rounded-2xl bg-gray-50 p-3">
            <div className="text-sm font-semibold mb-2">Add items from inventory</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-auto">
              {items.slice(0, 10).map((it) => (
                <button
                  key={it.id}
                  onClick={() => addLineFromItem(it)}
                  className="text-left p-2 rounded-xl bg-white hover:bg-gray-100"
                >
                  <div className="font-medium">{it.name}</div>
                  <div className="text-xs text-gray-600">
                    ${(it.pricePerItem || it.price || 0)?.toFixed?.(2)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* lines */}
          <div className="flex flex-col gap-2">
            {lines.length === 0 ? (
              <div className="text-sm text-gray-600">No items yet.</div>
            ) : (
              lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-gray-50 p-2 rounded-xl">
                  <div className="col-span-5">
                    <Label>Item</Label>
                    <div className="font-medium">{l.name}</div>
                  </div>
                  <div className="col-span-2">
                    <LabeledNumber label="Qty" value={l.qty} onChange={(v) => updateLine(idx, { qty: Number(v) || 0 })} />
                  </div>
                  <div className="col-span-2">
                    <LabeledNumber label="Unit $" step="0.01" value={l.unitPrice} onChange={(v) => updateLine(idx, { unitPrice: Number(v) || 0 })} />
                  </div>
                  <div className="col-span-2">
                    <Label>Total</Label>
                    <div className="font-semibold">${(l.total || 0).toFixed(2)}</div>
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <GhostBtn onClick={() => removeLine(idx)}>Remove</GhostBtn>
                  </div>
                </div>
              ))
            )}
            <div className="flex justify-end text-lg font-semibold mt-1">Total: ${(totalPayment || 0).toFixed(2)}</div>
          </div>
        </div>
      ) : (
        // SUBSCRIPTION MODE
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Plan</Label>
              <select
                className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
                value={subId}
                onChange={(e) => setSubId(e.target.value)}
              >
                <option value="">Select a plan…</option>
                {subs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} — ${(s.price || 0).toFixed(2)} / {s.cycle || 'monthly'}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <div className="text-sm text-gray-700">
                {selectedPlan ? (
                  <>
                    <span className="font-medium">{selectedPlan.name}</span> ·{' '}
                    ${(subPrice || 0).toFixed(2)} / {selectedPlan.cycle || 'monthly'}
                  </>
                ) : (
                  'Choose a plan to continue'
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER (shared meta) */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <Label>Method</Label>
          <select
            className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {['cash', 'card', 'check'].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <LabeledInput label="External Reference #" value={externalRef} onChange={setExternalRef} />
        <div className="md:col-span-2 flex items-center">
          <NovaSwitch
            label="Paid now? (Receipt)"
            checked={paid}
            onChange={setPaid}
            helper={paid ? 'Will save as Receipt' : 'Will save as Invoice'}
          />
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-3">
        <GhostBtn onClick={onClose}>Cancel</GhostBtn>
        {mode === 'payment' ? (
          <PrimaryBtn onClick={savePayment} disabled={!canSavePayment}>
            Save {paid ? 'Receipt' : 'Invoice'}
          </PrimaryBtn>
        ) : (
          <PrimaryBtn onClick={saveSubscription} disabled={!canSaveSub}>
            Save {paid ? 'Receipt' : 'Invoice'}
          </PrimaryBtn>
        )}
      </div>
    </GlassModal>
  );
}
