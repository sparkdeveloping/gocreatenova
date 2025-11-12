'use client';


export function toDateMaybe(v) {
if (!v) return null;
if (v instanceof Date) return v;
if (typeof v === 'number') return new Date(v * (v < 10_000_000_000 ? 1000 : 1));
if (typeof v?.toDate === 'function') return v.toDate();
if (v?.seconds) return new Date(v.seconds * 1000);
return null;
}


export function hasActiveMembership(user, now = new Date()) {
const a = user?.activeSubscription;
const ex = toDateMaybe(a?.expiresAt);
if (ex && ex > now) return true;


const subs = Array.isArray(user?.subscriptions) ? user.subscriptions : [];
for (const s of subs) {
const ex2 = toDateMaybe(s?.expiresAt);
if ((s?.status === 'active' || s?.isActive) && ex2 && ex2 > now) return true;
}


const fallback = toDateMaybe(user?.membershipExpiresAt);
if (fallback && fallback > now) return true;


return false;
}


export function addCycle(start, cycle) {
const d = new Date(start);
if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
else d.setMonth(d.getMonth() + 1);
return d;
}