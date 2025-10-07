'use client';

import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  PackagePlus,
  Receipt,
  Wallet,
  ArrowDownToLine,
  ArrowUpFromLine,
  X,
  DollarSign,
  ClipboardList,
  CalendarDays,
  ChevronDown,
} from 'lucide-react';

import {
  getFirestore,
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  query,
  orderBy,
} from 'firebase/firestore';
import { app } from '../lib/firebase';

import CardShell from '@/app/components/ui/CardShell';
import FilterPills from '@/app/components/ui/FilterPills';
import SearchInput from '@/app/components/ui/SearchInput';
import { ExportCSVButton, ViewToggleButton } from '@/app/components/ui/ToolbarButtons';
import NovaSwitch from '@/app/components/ui/NovaSwitch';
import NovaCheckbox from '@/app/components/ui/NovaCheckbox';
import Reveal from '@/app/components/ui/Reveal';
import DataTable from '@/app/components/table/DataTable';

import CornerUtilities from '../components/CornerUtilities';
import GlassModal from '../components/ui/GlassModal';

// ------------------------------ helpers
const fmtCurrency = (n) => (isFinite(n) ? `$${Number(n).toFixed(2)}` : '$0.00');
const toDateOnly = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const byLower = (s) => String(s || '').toLowerCase();
const staffish = ['tech', 'mentor', 'admin', 'staff', 'employee', 'student tech'];

// ------------------------------ page
export default function PaymentsPage() {
  const db = getFirestore(app);

  // tabs
  const [mode, setMode] = useState('items'); // 'items' | 'subscriptions' | 'payments' | 'cash'
  const [viewMode, setViewMode] = useState('table');
  const [searchTerm, setSearchTerm] = useState('');

  // datasets
  const [items, setItems] = useState([]);
  const [subs, setSubs] = useState([]);
  const [payments, setPayments] = useState([]);
  const [cashLogs, setCashLogs] = useState([]);

  // filtered
  const [rows, setRows] = useState([]);

  // modals
  const [addOpen, setAddOpen] = useState(false);
  const [addType, setAddType] = useState(null); // 'item' | 'payment' | 'subscription' | 'cash'

  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [activeItem, setActiveItem] = useState(null);

  const [users, setUsers] = useState([]); // for checkout/payment user pick

  // fetch datasets
  useEffect(() => {
    (async () => {
      const dbx = getFirestore(app);

      const itemsSnap = await getDocs(collection(dbx, 'inventory'));
      setItems(itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const subsSnap = await getDocs(collection(dbx, 'subscriptions'));
      setSubs(subsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const paySnap = await getDocs(query(collection(dbx, 'payments'), orderBy('createdAt', 'desc')));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const cashSnap = await getDocs(query(collection(dbx, 'cashTallies'), orderBy('date', 'desc')));
      setCashLogs(cashSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const usersSnap = await getDocs(collection(dbx, 'users'));
      setUsers(usersSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, []);

  // search filter
  useEffect(() => {
    const q = byLower(searchTerm);
    let src = [];
    if (mode === 'items') src = [...items];
    else if (mode === 'subscriptions') src = [...subs];
    else if (mode === 'payments') src = [...payments];
    else if (mode === 'cash') src = [...cashLogs];

    if (q) {
      src = src.filter((r) => {
        if (mode === 'items') {
          return byLower(r.name).includes(q) || byLower(r.brand).includes(q);
        }
        if (mode === 'subscriptions') {
          return byLower(r.name).includes(q);
        }
        if (mode === 'payments') {
          return (
            String(r.externalRef || '').toLowerCase().includes(q) ||
            String(r.type || '').toLowerCase().includes(q) ||
            byLower(r.userName).includes(q)
          );
        }
        if (mode === 'cash') {
          return String(r.date).includes(q);
        }
        return false;
      });
    }
    setRows(src);
  }, [mode, searchTerm, items, subs, payments, cashLogs]);

  // column configs
  const columns = useMemo(() => {
    if (mode === 'items') {
      return [
        { header: 'Name', accessor: (i) => i.name || '-' },
        { header: 'Brand', accessor: (i) => i.brand || '-' },
        { header: 'Qty', accessor: (i) => i.quantity ?? 0, thClassName: 'w-20' },
        {
          header: 'Price',
          accessor: (i) => (i.pricePerPack ? `${fmtCurrency(i.pricePerPack)} / pack` : fmtCurrency(i.pricePerItem || i.price)),
        },
        {
          header: 'Options',
          accessor: (i) =>
            [
              i.color ? `Color:${i.color}` : null,
              i.dimensions ? `Dim:${i.dimensions}` : null,
              i.packQty ? `Pack:${i.packQty}×${i.itemsPerPack || 1}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—',
        },
        {
          header: 'Actions',
          exportable: false,
          render: (i) => (
            <div className="flex gap-2">
              <ActionPill
                icon={ArrowDownToLine}
                label="Check In"
                color="purple"
                onClick={() => {
                  setActiveItem(i);
                  setCheckInOpen(true);
                }}
              />
              <ActionPill
                icon={ArrowUpFromLine}
                label="Check Out"
                color="green"
                onClick={() => {
                  setActiveItem(i);
                  setCheckOutOpen(true);
                }}
              />
            </div>
          ),
        },
      ];
    }

    if (mode === 'subscriptions') {
      return [
        { header: 'Name', accessor: (s) => s.name || '-' },
        { header: 'Cycle', accessor: (s) => s.cycle || 'monthly' },
        { header: 'Price', accessor: (s) => fmtCurrency(s.price || 0) },
        { header: 'Includes', accessor: (s) => (Array.isArray(s.includes) ? s.includes.join(', ') : '—') },
      ];
    }

    if (mode === 'payments') {
      return [
        { header: 'When', accessor: (p) => (p.createdAt?.toDate ? p.createdAt.toDate().toLocaleString() : '—') },
        { header: 'Type', accessor: (p) => p.type || '-' }, // invoice | receipt
        {
          header: 'Status',
          accessor: (p) => p.status || (p.type === 'invoice' ? 'unpaid' : 'paid'),
        },
        { header: 'User', accessor: (p) => p.userName || '—' },
        { header: 'Method', accessor: (p) => p.method || '-' }, // cash | card | check
        { header: 'Ext Ref', accessor: (p) => p.externalRef || '-' },
        { header: 'Amount', accessor: (p) => fmtCurrency(p.total || 0) },
      ];
    }

    // cash
    return [
      {
        header: 'Date',
        accessor: (c) => {
          const d = c.date?.toDate ? c.date.toDate() : c.date ? new Date(c.date) : null;
          return d ? d.toLocaleDateString() : '—';
        },
      },
      { header: 'Morning', accessor: (c) => fmtCurrency(c.morning || 0) },
      { header: 'Midday', accessor: (c) => fmtCurrency(c.midday || 0) },
      { header: 'Evening', accessor: (c) => fmtCurrency(c.evening || 0) },
      { header: 'Notes', accessor: (c) => c.notes || '—' },
    ];
  }, [mode]);

  // counts for header chips
  const stats = useMemo(() => {
    const totalItems = items.length;
    const totalSubs = subs.length;
    const totalPays = payments.length;
    const totalCash = cashLogs.length;
    return { totalItems, totalSubs, totalPays, totalCash };
  }, [items, subs, payments, cashLogs]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-[#f1f5f9] to-white px-4 py-6 text-black">
      <CornerUtilities />

      <CardShell>
        {/* header tools */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-3xl font-bold">Payments</h1>

          <div className="flex-1 flex items-center gap-2">
            <SearchInput value={searchTerm} onChange={setSearchTerm} placeholder="Search…" />
            <div className="flex items-center gap-2 ml-auto">
              <ExportCSVButton
                filename={`${mode}.csv`}
                columns={columns}
                rows={rows}
              />
              <AddButton onClick={() => setAddOpen(true)} />
              <ViewToggleButton viewMode={viewMode} setViewMode={setViewMode} />
            </div>
          </div>
        </div>

        {/* stats */}
        <div className="flex flex-wrap gap-6 mt-2">
          <Stat label="Items" value={stats.totalItems} />
          <Stat label="Subscriptions" value={stats.totalSubs} />
          <Stat label="Payments" value={stats.totalPays} />
          <Stat label="Cash Days" value={stats.totalCash} />
        </div>

        {/* tabs */}
        <div className="mt-4">
          <FilterPills
            value={mode}
            onChange={setMode}
            options={[
              { value: 'items', label: 'Items' },
              { value: 'subscriptions', label: 'Subscriptions' },
              { value: 'payments', label: 'Payments' },
              { value: 'cash', label: 'Cash Log' },
            ]}
          />
        </div>

        {/* content */}
        <div className="flex-1 overflow-y-auto mt-4">
          <DataTable columns={columns} rows={rows} onRowClick={() => {}} />
        </div>
      </CardShell>

      {/* Add menu -> routes to the specific modal */}
      <AnimatePresence>
        {addOpen && (
          <GlassModal onClose={() => { setAddOpen(false); setAddType(null); }}>
            {!addType ? (
              <div className="flex flex-col gap-3">
                <h3 className="text-xl font-semibold">Add...</h3>
                <AddRow
                  icon={PackagePlus}
                  label="Item"
                  onClick={() => setAddType('item')}
                />
                <AddRow
                  icon={Receipt}
                  label="Payment (Invoice / Receipt)"
                  onClick={() => setAddType('payment')}
                />
                <AddRow
                  icon={ClipboardList}
                  label="Subscription"
                  onClick={() => setAddType('subscription')}
                />
                <AddRow
                  icon={Wallet}
                  label="Cash Tally"
                  onClick={() => setAddType('cash')}
                />
              </div>
            ) : addType === 'item' ? (
              <AddItemForm
                onCancel={() => { setAddType(null); }}
                onSaved={async (created) => {
                  setItems((prev) => [created, ...prev]);
                  setAddOpen(false); setAddType(null);
                }}
              />
            ) : addType === 'payment' ? (
              <AddPaymentForm
                users={users}
                items={items}
                onCancel={() => { setAddType(null); }}
                onSaved={(created) => {
                  setPayments((prev) => [created, ...prev]);
                  setAddOpen(false); setAddType(null);
                }}
              />
            ) : addType === 'subscription' ? (
              <AddSubscriptionForm
                onCancel={() => setAddType(null)}
                onSaved={(created) => {
                  setSubs((prev) => [created, ...prev]);
                  setAddOpen(false); setAddType(null);
                }}
              />
            ) : (
              <AddCashForm
                onCancel={() => setAddType(null)}
                onSaved={(created) => {
                  setCashLogs((prev) => [created, ...prev]);
                  setAddOpen(false); setAddType(null);
                }}
              />
            )}
          </GlassModal>
        )}
      </AnimatePresence>

      {/* Check In */}
      <AnimatePresence>
        {checkInOpen && activeItem && (
          <GlassModal onClose={() => { setCheckInOpen(false); setActiveItem(null); }}>
            <CheckInForm
              item={activeItem}
              onCancel={() => { setCheckInOpen(false); setActiveItem(null); }}
              onSaved={(updated) => {
                setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
                setCheckInOpen(false); setActiveItem(null);
              }}
            />
          </GlassModal>
        )}
      </AnimatePresence>

      {/* Check Out -> creates a Payment */}
      <AnimatePresence>
        {checkOutOpen && activeItem && (
          <GlassModal onClose={() => { setCheckOutOpen(false); setActiveItem(null); }}>
            <CheckOutForm
              item={activeItem}
              users={users}
              onCancel={() => { setCheckOutOpen(false); setActiveItem(null); }}
              onSaved={({ updatedItem, payment }) => {
                setItems((prev) => prev.map((i) => (i.id === updatedItem.id ? updatedItem : i)));
                setPayments((prev) => [payment, ...prev]);
                setCheckOutOpen(false); setActiveItem(null);
              }}
            />
          </GlassModal>
        )}
      </AnimatePresence>
    </div>
  );
}

// ================== tiny presentational bits ==================
function Stat({ label, value }) {
  return (
    <div>
      <div className="text-2xl font-bold text-black">{value}</div>
      <div className="text-sm text-gray-800">{label}</div>
    </div>
  );
}

function AddButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="backdrop-blur-md bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-[1rem] px-3 py-2 shadow-sm flex items-center gap-2"
    >
      <Plus className="w-4 h-4" />
      Add
      <ChevronDown className="w-4 h-4 opacity-70" />
    </button>
  );
}

function ActionPill({ icon: Icon, label, color = 'purple', onClick }) {
  const cls = {
    purple: 'bg-purple-100 hover:bg-purple-200 text-purple-700',
    green: 'bg-green-100 hover:bg-green-200 text-green-700',
    blue: 'bg-blue-100 hover:bg-blue-200 text-blue-700',
  }[color];
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
      className={`rounded-full px-3 py-1 text-sm font-medium flex items-center gap-1 shadow-sm transition hover:scale-105 ${cls}`}
      type="button"
    >
      <Icon className="w-4 h-4" />
      {label}
    </button>
  );
}

function AddRow({ icon: Icon, label, onClick }) {
  return (
    <button
      className="flex items-center gap-3 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 text-left transition"
      onClick={onClick}
    >
      <div className="rounded-lg bg-white shadow-inner p-2">
        <Icon className="w-5 h-5" />
      </div>
      <div className="font-medium">{label}</div>
    </button>
  );
}


// ================== Forms (Add / Check-in / Check-out) ==================

function AddItemForm({ onCancel, onSaved }) {
  const db = getFirestore(app);

  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [quantity, setQuantity] = useState(0);

  const [optPacks, setOptPacks] = useState(false);
  const [optDims, setOptDims] = useState(false);
  const [optColor, setOptColor] = useState(false);

  // packs
  const [packQty, setPackQty] = useState(0);
  const [itemsPerPack, setItemsPerPack] = useState(1);
  const [pricePerPack, setPricePerPack] = useState(0);
  const pricePerItem = useMemo(() => {
    const ip = Number(itemsPerPack) || 1;
    const pp = Number(pricePerPack) || 0;
    return ip ? pp / ip : 0;
  }, [itemsPerPack, pricePerPack]);

  // dimensions
  const [dimensions, setDimensions] = useState(''); // free text (e.g., "9x11 in, 220 grit")

  // color
  const [color, setColor] = useState('');

  // single-item price (no packs)
  const [price, setPrice] = useState(0);

  const canSave =
    name.trim().length > 0 &&
    (optPacks ? Number(pricePerPack) >= 0 : Number(price) >= 0);

  const handleSave = async () => {
    const payload = {
      name: name.trim(),
      brand: brand.trim(),
      quantity: Number(quantity) || 0,
      createdAt: serverTimestamp(),

      // options
      packQty: optPacks ? Number(packQty) || 0 : null,
      itemsPerPack: optPacks ? Number(itemsPerPack) || 1 : null,
      pricePerPack: optPacks ? Number(pricePerPack) || 0 : null,
      pricePerItem: optPacks ? Number(pricePerItem) || 0 : Number(price) || 0,

      dimensions: optDims ? dimensions.trim() : null,
      color: optColor ? color.trim() : null,
    };

    const ref = await addDoc(collection(db, 'inventory'), payload);
    const created = { id: ref.id, ...payload };
    onSaved && onSaved(created);
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">Add Item</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LabeledInput label="Name" value={name} onChange={setName} />
        <LabeledInput label="Brand" value={brand} onChange={setBrand} />
        <LabeledNumber label="Starting Quantity" value={quantity} onChange={setQuantity} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <NovaCheckbox label="Packs" checked={optPacks} onChange={setOptPacks} />
        <NovaCheckbox label="Dimensions" checked={optDims} onChange={setOptDims} />
        <NovaCheckbox label="Color" checked={optColor} onChange={setOptColor} />
      </div>

      <Reveal show={optPacks}>
        <div className="rounded-2xl bg-gray-50 p-3 grid grid-cols-1 md:grid-cols-4 gap-3">
          <LabeledNumber label="Packs in Stock" value={packQty} onChange={setPackQty} />
          <LabeledNumber label="Items / Pack" value={itemsPerPack} onChange={setItemsPerPack} />
          <LabeledNumber label="Price / Pack" value={pricePerPack} onChange={setPricePerPack} step="0.01" />
          <div className="flex items-end">
            <div className="text-sm text-gray-700">
              Price / Item: <span className="font-semibold">{fmtCurrency(pricePerItem)}</span>
            </div>
          </div>
        </div>
      </Reveal>
      <Reveal show={!optPacks}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LabeledNumber label="Price / Item" value={price} onChange={setPrice} step="0.01" />
        </div>
      </Reveal>

      <Reveal show={optDims}>
        <LabeledInput
          label="Dimensions / Spec"
          value={dimensions}
          onChange={setDimensions}
          placeholder='e.g., "9×11 in · 220 grit"'
        />
      </Reveal>
      <Reveal show={optColor}>
        <LabeledInput label="Color" value={color} onChange={setColor} />
      </Reveal>

      <div className="flex gap-2 justify-end pt-2">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!canSave} onClick={handleSave}>Save Item</PrimaryBtn>
      </div>
    </div>
  );
}

function AddPaymentForm({ users, items, onCancel, onSaved }) {
  const db = getFirestore(app);

  const [userQuery, setUserQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');

  const [lines, setLines] = useState([]); // {itemId, name, qty, unitPrice, total}
  const [method, setMethod] = useState('cash'); // cash | card | check
  const [externalRef, setExternalRef] = useState('');
  const [paid, setPaid] = useState(true); // receipt if true; invoice if false

  const filteredUsers = useMemo(() => {
    const q = byLower(userQuery);
    return users
      .filter((u) => byLower(u.fullName || u.name).includes(q))
      .slice(0, 10);
  }, [users, userQuery]);

  const addLine = (item) => {
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

  const removeLine = (idx) => {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const total = useMemo(() => lines.reduce((s, l) => s + (Number(l.total) || 0), 0), [lines]);

  const canSave = userId && externalRef.trim().length > 0 && lines.length > 0;

  const handleSave = async () => {
    const payload = {
      type: paid ? 'receipt' : 'invoice',
      status: paid ? 'paid' : 'unpaid',
      method,
      externalRef: externalRef.trim(),
      lines,
      total,
      userId,
      userName,
      createdAt: serverTimestamp(),
    };

    const ref = await addDoc(collection(db, 'payments'), payload);
    const created = { id: ref.id, ...payload };
    onSaved && onSaved(created);
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">Add Payment</h3>

      {/* user picker */}
      <div className="rounded-2xl bg-gray-50 p-3">
        <div className="text-sm font-semibold mb-2">Select User</div>
        {userId ? (
          <div className="flex items-center justify-between">
            <div className="font-medium">{userName}</div>
            <GhostBtn onClick={() => { setUserId(''); setUserName(''); }}>Change</GhostBtn>
          </div>
        ) : (
          <>
            <LabeledInput label="Search User" value={userQuery} onChange={setUserQuery} />
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-auto">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  className="text-left p-2 rounded-xl bg-white hover:bg-gray-100"
                  onClick={() => { setUserId(u.id); setUserName(u.fullName || u.name || ''); }}
                >
                  <div className="font-medium">{u.fullName || u.name}</div>
                  <div className="text-xs text-gray-600">{(u.roles || []).join(', ') || u.membershipType || 'Member'}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* lines */}
      <div className="rounded-2xl bg-gray-50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">Items</div>
          <GhostBtn onClick={() => { /* opening item picker inline */ }}>
            <PackagePlus className="w-4 h-4 mr-1 inline" /> Add from inventory
          </GhostBtn>
        </div>

        {/* simple inline picker */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
          {items.slice(0, 8).map((it) => (
            <button
              key={it.id}
              onClick={() => addLine(it)}
              className="p-2 rounded-xl bg-white hover:bg-gray-100 text-left"
            >
              <div className="font-medium">{it.name}</div>
              <div className="text-xs text-gray-600">{fmtCurrency(it.pricePerItem || it.price || 0)}</div>
            </button>
          ))}
        </div>

        {lines.length === 0 ? (
          <div className="text-sm text-gray-600">No items yet.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {lines.map((l, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-white p-2 rounded-xl">
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
                  <div className="font-semibold">{fmtCurrency(l.total)}</div>
                </div>
                <div className="col-span-1 flex justify-end">
                  <GhostBtn onClick={() => removeLine(idx)}>Remove</GhostBtn>
                </div>
              </div>
            ))}

            <div className="flex justify-end text-lg font-semibold mt-2">Total: {fmtCurrency(total)}</div>
          </div>
        )}
      </div>

      {/* meta */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Select label="Method" value={method} onChange={setMethod} options={['cash', 'card', 'check']} />
        <LabeledInput label="External Reference #" value={externalRef} onChange={setExternalRef} />
        <NovaSwitch
          label="Paid now? (Receipt)"
          checked={paid}
          onChange={setPaid}
          helper={paid ? "Will save as a Receipt" : "Will save as an Invoice"}
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!canSave} onClick={handleSave}>
          Save {paid ? 'Receipt' : 'Invoice'}
        </PrimaryBtn>
      </div>
    </div>
  );
}

function AddSubscriptionForm({ onCancel, onSaved }) {
  const db = getFirestore(app);
  const [name, setName] = useState('');
  const [cycle, setCycle] = useState('monthly');
  const [price, setPrice] = useState(0);
  const [includes, setIncludes] = useState('');

  const canSave = name.trim().length > 0;

  const handleSave = async () => {
    const payload = {
      name: name.trim(),
      cycle,
      price: Number(price) || 0,
      includes: includes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'subscriptions'), payload);
    onSaved && onSaved({ id: ref.id, ...payload });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">Add Subscription</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <LabeledInput label="Name" value={name} onChange={setName} />
        <Select label="Billing Cycle" value={cycle} onChange={setCycle} options={['monthly', 'quarterly', 'yearly']} />
        <LabeledNumber label="Price" value={price} onChange={setPrice} step="0.01" />
        <LabeledInput label="Includes (comma-separated)" value={includes} onChange={setIncludes} placeholder="e.g., 10hrs woodshop, 5 laser cuts" />
      </div>
      <div className="flex gap-2 justify-end pt-2">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!canSave} onClick={handleSave}>Save</PrimaryBtn>
      </div>
    </div>
  );
}

function AddCashForm({ onCancel, onSaved }) {
  const db = getFirestore(app);
  const [date, setDate] = useState(toDateOnly().toISOString().slice(0, 10));
  const [morning, setMorning] = useState(0);
  const [midday, setMidday] = useState(0);
  const [evening, setEvening] = useState(0);
  const [notes, setNotes] = useState('');

  const handleSave = async () => {
    const payload = {
      date: new Date(date),
      morning: Number(morning) || 0,
      midday: Number(midday) || 0,
      evening: Number(evening) || 0,
      notes: notes.trim() || null,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'cashTallies'), payload);
    onSaved && onSaved({ id: ref.id, ...payload });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">Add Cash Tally</h3>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <LabeledInput label="Date" type="date" value={date} onChange={setDate} />
        <LabeledNumber label="Morning" value={morning} onChange={setMorning} step="0.01" />
        <LabeledNumber label="Midday" value={midday} onChange={setMidday} step="0.01" />
        <LabeledNumber label="Evening" value={evening} onChange={setEvening} step="0.01" />
      </div>
      <LabeledTextArea label="Notes" value={notes} onChange={setNotes} />
      <div className="flex gap-2 justify-end pt-2">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn onClick={handleSave}>Save</PrimaryBtn>
      </div>
    </div>
  );
}

function CheckInForm({ item, onCancel, onSaved }) {
  const db = getFirestore(app);
  const [qty, setQty] = useState(0);

  const handleSave = async () => {
    const nextQty = Number(item.quantity || 0) + (Number(qty) || 0);
    await updateDoc(doc(db, 'inventory', item.id), { quantity: nextQty, updatedAt: serverTimestamp() });
    onSaved && onSaved({ ...item, quantity: nextQty });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">Check In – {item.name}</h3>
      <LabeledNumber label="Quantity to add" value={qty} onChange={setQty} />
      <div className="flex gap-2 justify-end">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn onClick={handleSave}>Save</PrimaryBtn>
      </div>
    </div>
  );
}

function CheckOutForm({ item, users, onCancel, onSaved }) {
  const db = getFirestore(app);
  const [qty, setQty] = useState(1);
  const [userQuery, setUserQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [paid, setPaid] = useState(false); // if true => receipt
  const [method, setMethod] = useState('cash');
  const [externalRef, setExternalRef] = useState('');

  const filteredUsers = useMemo(() => {
    const q = byLower(userQuery);
    return users.filter((u) => byLower(u.fullName || u.name).includes(q)).slice(0, 10);
  }, [userQuery, users]);

  const canSave = userId && qty > 0 && externalRef.trim().length > 0 && (item.quantity || 0) >= qty;

  const handleSave = async () => {
    // 1) reduce inventory
    const nextQty = Number(item.quantity || 0) - Number(qty || 0);
    await updateDoc(doc(db, 'inventory', item.id), { quantity: nextQty, updatedAt: serverTimestamp() });

    // 2) create payment
    const unit = item.pricePerItem || item.price || 0;
    const total = unit * qty;
    const payload = {
      type: paid ? 'receipt' : 'invoice',
      status: paid ? 'paid' : 'unpaid',
      method,
      externalRef: externalRef.trim(),
      lines: [{ itemId: item.id, name: item.name, qty: Number(qty), unitPrice: unit, total }],
      total,
      userId,
      userName,
      createdAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'payments'), payload);
    onSaved &&
      onSaved({
        updatedItem: { ...item, quantity: nextQty },
        payment: { id: ref.id, ...payload },
      });
  };

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-xl font-semibold">Check Out – {item.name}</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <LabeledNumber label="Quantity" value={qty} onChange={setQty} />
        <div className="flex items-end text-sm text-gray-700">
          In stock: <span className="ml-1 font-semibold">{item.quantity ?? 0}</span>
        </div>
      </div>

      <div className="rounded-2xl bg-gray-50 p-3">
        <div className="text-sm font-semibold mb-2">Select User</div>
        {userId ? (
          <div className="flex items-center justify-between">
            <div className="font-medium">{userName}</div>
            <GhostBtn onClick={() => { setUserId(''); setUserName(''); }}>Change</GhostBtn>
          </div>
        ) : (
          <>
            <LabeledInput label="Search User" value={userQuery} onChange={setUserQuery} />
            <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 max-h-44 overflow-auto">
              {filteredUsers.map((u) => (
                <button
                  key={u.id}
                  className="text-left p-2 rounded-xl bg-white hover:bg-gray-100"
                  onClick={() => { setUserId(u.id); setUserName(u.fullName || u.name || ''); }}
                >
                  <div className="font-medium">{u.fullName || u.name}</div>
                  <div className="text-xs text-gray-600">{(u.roles || []).join(', ') || u.membershipType || 'Member'}</div>
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <NovaSwitch
          label="Paid now? (Receipt)"
          checked={paid}
          onChange={setPaid}
          helper={paid ? "Will save as a Receipt" : "Will save as an Invoice"}
        />
        <Select label="Method" value={method} onChange={setMethod} options={['cash', 'card', 'check']} />
        <LabeledInput label="External Ref #" value={externalRef} onChange={setExternalRef} />
      </div>

      <div className="flex gap-2 justify-end">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
        <PrimaryBtn disabled={!canSave} onClick={handleSave}>
          Create {paid ? 'Receipt' : 'Invoice'}
        </PrimaryBtn>
      </div>
    </div>
  );
}

// ================== small form primitives ==================
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
function LabeledTextArea({ label, value, onChange }) {
  return (
    <div>
      <Label>{label}</Label>
      <textarea
        className="w-full min-h-[90px] px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Select({ label, value, onChange, options = [] }) {
  return (
    <div>
      <Label>{label}</Label>
      <select
        className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
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

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
