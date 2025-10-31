'use client';


import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFirestore, collection, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { app } from '@/app/lib/firebase';
import { addCycle } from '@/app/lib/subscriptions';


function ModalPortal({ children }) {
if (typeof document === 'undefined') return null;
return typeof window !== 'undefined' ? (require('react-dom').createPortal(children, document.body)) : null;
}


export default function RenewMembershipModal({ open, onClose, user, plans }) {
const db = getFirestore(app);
const [planId, setPlanId] = useState('');
const [method, setMethod] = useState('cash');
const [externalRef, setExternalRef] = useState('');


useEffect(() => {
if (open && plans?.length && !planId) setPlanId(plans[0].id);
}, [open, plans, planId]);


if (!open || !user) return null;
const plan = plans.find((p) => p.id === planId);
const canSave = !!plan && externalRef.trim().length > 0;


const handleSave = async () => {
const startedAt = new Date();
const expiresAt = addCycle(startedAt, plan.cycle || 'monthly');


const payment = {
type: 'receipt',
status: 'paid',
method,
externalRef: externalRef.trim(),
lines: [{ itemId: plan.id, name: plan.name, qty: 1, unitPrice: Number(plan.price || 0), total: Number(plan.price || 0) }],
total: Number(plan.price || 0),
userId: user.id,
userName: user.fullName || user.name || '',
createdAt: serverTimestamp(),
};


const payRef = await addDoc(collection(db, 'payments'), payment);


const activeSubscription = {
planId: plan.id,
name: plan.name,
cycle: plan.cycle || 'monthly',
startedAt,
expiresAt,
status: 'active',
};


await updateDoc(doc(db, 'users', user.id), { activeSubscription });


onClose({ paymentId: payRef.id, activeSubscription });
};


return (
<ModalPortal>
<AnimatePresence>
<motion.div
initial={{ opacity: 0 }}
animate={{ opacity: 1 }}
exit={{ opacity: 0 }}
className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 md:p-8 bg-white/40 backdrop-blur-lg"
onClick={() => onClose(null)}
>
<motion.div
initial={{ y: 32, opacity: 0, scale: 0.985 }}
animate={{ y: 0, opacity: 1, scale: 1 }}
exit={{ y: 16, opacity: 0, scale: 0.985 }}
transition={{ duration: 0.22, ease: 'easeOut' }}
className="bg-white/90 backdrop-blur-md rounded-[2rem] shadow-2xl border border-slate-200 w-[min(92vw,34rem)] p-6"
onClick={(e) => e.stopPropagation()}
>
<h3 className="text-xl font-bold">Renew Membership – {user.fullName || user.name || 'User'}</h3>


<div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
<div>
<div className="text-xs font-semibold text-slate-600 mb-1">Plan</div>
<select
className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
value={planId}
onChange={(e) => setPlanId(e.target.value)}
>
{plans.map((p) => (
<option key={p.id} value={p.id}>
{p.name} · ${(Number(p.price || 0)).toFixed(2)} · {p.cycle || 'monthly'}
</option>
))}
</select>
</div>
<div>
<div className="text-xs font-semibold text-slate-600 mb-1">Payment Method</div>
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
<div className="md:col-span-2">
<div className="text-xs font-semibold text-slate-600 mb-1">External Reference #</div>
<input
className="w-full h-10 px-3 rounded-xl bg-gray-100 hover:bg-gray-200 focus:bg-white outline-none"
value={externalRef}
onChange={(e) => setExternalRef(e.target.value)}
placeholder="POS receipt / transaction id"
/>
</div>
</div>


<div className="flex justify-end gap-2 mt-6">
<button onClick={() => onClose(null)} className="px-4 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700">Cancel</button>
<button
disabled={!canSave}
onClick={handleSave}
className={`px-4 py-2 rounded-full text-white ${canSave ? 'bg-blue-500 hover:bg-blue-600' : 'bg-blue-300'}`}
>
Save & Renew
</button>
</div>
</motion.div>
</motion.div>
</AnimatePresence>
</ModalPortal>
);
}