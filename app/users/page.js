'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getFirestore, collection, getDocs, query, orderBy } from 'firebase/firestore';
import { app } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';

import CornerUtilities from '../components/CornerUtilities';
import BadgeAssignmentModal from '../components/BadgeAssignmentModal';

import CardShell from '@/app/components/ui/CardShell';
import FilterPills from '@/app/components/ui/FilterPills';
import SearchInput from '@/app/components/ui/SearchInput';
import { ExportCSVButton, ViewToggleButton } from '@/app/components/ui/ToolbarButtons';
import StatBox from '@/app/components/ui/StatBox';
import DataTable from '@/app/components/table/DataTable';
import QuickActions from '@/app/components/users/QuickActions';
import UserPayModal from '@/app/components/users/UserPayModal';

// —————————————————————————————————————————————
// Helpers
const staffish = ['tech', 'mentor', 'admin', 'staff', 'employee', 'student tech'];
const byLower = (s) => String(s || '').toLowerCase();

function isEmployee(u) {
  return Array.isArray(u?.roles) && u.roles.some((r) => staffish.includes(String(r).toLowerCase()));
}
function isMemberOnly(u) {
  return !isEmployee(u);
}
function toDateMaybe(v) {
  // Accept JS Date, number, Firestore Timestamp-like
  if (!v) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v * (v < 10_000_000_000 ? 1000 : 1)); // epoch seconds or ms
  if (typeof v?.toDate === 'function') return v.toDate();
  if (v?.seconds) return new Date(v.seconds * 1000);
  return null;
}
function addCycle(fromDate, cycle = 'monthly') {
  const d = new Date(fromDate);
  const c = String(cycle || 'monthly').toLowerCase();
  if (c === 'yearly' || c === 'annual' || c === 'annually') {
    d.setFullYear(d.getFullYear() + 1);
  } else if (c === 'quarterly' || c === 'quarter') {
    d.setMonth(d.getMonth() + 3);
  } else {
    // default monthly
    d.setMonth(d.getMonth() + 1);
  }
  return d;
}
function hasBadge(u) {
  return !!(u?.badge?.id || u?.badgeId);
}

// —————————————————————————————————————————————

export default function UsersPage() {
  const db = getFirestore(app);

  // base datasets
  const [users, setUsers] = useState([]);
  const [payments, setPayments] = useState([]);   // for membership status calc (we only use receipts with subscriptions)
  const [subs, setSubs] = useState([]);           // plan metadata (optional for display)
  const [inventory, setInventory] = useState([]); // for Pay modal

  // UI state
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [mode, setMode] = useState('all');                // 'all' | 'members' | 'employees'
  const [memberStatus, setMemberStatus] = useState('all'); // 'all' | 'active' | 'pending' | 'expired'
  const [employeeRole, setEmployeeRole] = useState('all'); // 'all' | 'staff' | 'tech' | 'student tech'
  const [viewMode, setViewMode] = useState('table');       // 'table' | 'card'
  const [searchTerm, setSearchTerm] = useState('');

  const [showBadgeModal, setShowBadgeModal] = useState(false);
  const [selectedUserForBadge, setSelectedUserForBadge] = useState(null);

  const [showUserModal, setShowUserModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);

  // Pay modal (from /users)
  const [payOpen, setPayOpen] = useState(false);
  const [payUser, setPayUser] = useState(null);

  // Fetch base data
  useEffect(() => {
    (async () => {
      // users
      const usersSnap = await getDocs(collection(db, 'users'));
      const fetchedUsers = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setUsers(fetchedUsers);

      // payments (order desc for convenience)
      const paySnap = await getDocs(query(collection(db, 'payments'), orderBy('createdAt', 'desc')));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // subscriptions (definitions)
      const subSnap = await getDocs(collection(db, 'subscriptions'));
      setSubs(subSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // inventory (for Pay modal)
      const invSnap = await getDocs(collection(db, 'inventory'));
      setInventory(invSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    })();
  }, [db]);

  // Build membership index from receipts that include subscription lines
  const membershipIndex = useMemo(() => {
    // Map: userId -> { planName, planId, cycle, createdAt, expiry, hadAny }
    const map = new Map();

    const receipts = payments.filter((p) => String(p?.type).toLowerCase() === 'receipt');
    for (const p of receipts) {
      const created = toDateMaybe(p.createdAt);
      if (!created) continue;
      const uid = p.userId;
      if (!uid) continue;

      const lines = Array.isArray(p.lines) ? p.lines : [];
      // only consider subscription lines that carry subscriptionId
      const subLines = lines.filter((l) => l?.subscriptionId);
      if (subLines.length === 0) continue;

      for (const l of subLines) {
        const cycle = l?.cycle || 'monthly';
        const expiry = addCycle(created, cycle);
        const candidate = {
          userId: uid,
          planName: l?.name || 'Subscription',
          planId: l?.subscriptionId || null,
          cycle,
          createdAt: created,
          expiry,
          hadAny: true,
        };

        const prev = map.get(uid);
        if (!prev) {
          map.set(uid, candidate);
        } else {
          // pick the one with the furthest expiry; if tie, take newer createdAt
          if (candidate.expiry > prev.expiry || (candidate.expiry.getTime() === prev.expiry.getTime() && candidate.createdAt > prev.createdAt)) {
            map.set(uid, candidate);
          }
        }
      }
    }

    return map;
  }, [payments]);

  // Derive augmented users with membership status, plan, expiry
  const derivedUsers = useMemo(() => {
    const now = new Date();
    return users.map((u) => {
      const badge = hasBadge(u);
      const rec = membershipIndex.get(u.id); // may be undefined
      let status = 'pending';
      if (rec && rec.expiry) {
        if (rec.expiry >= now) {
          status = 'active';
        } else {
          status = badge ? 'expired' : 'pending';
        }
      } else {
        // never subscribed
        status = 'pending'; // per spec: pending = no badge OR never subscription (this ends up pending by default)
      }

      // Membership type preference: current planName -> else stored on user -> else 'N/A'
      const membershipType = rec?.planName || u.membershipType || 'N/A';
      const expiryDate = rec?.expiry || null;

      return {
        ...u,
        _derived: {
          hasBadge: badge,
          membershipType,
          expiryDate,
          status,           // 'active' | 'expired' | 'pending'
          planId: rec?.planId || null,
          cycle: rec?.cycle || null,
        },
      };
    });
  }, [users, membershipIndex]);

  // Filter + search
  useEffect(() => {
    const q = byLower(searchTerm);

    let list = [...derivedUsers];

    if (mode === 'members') {
      list = list.filter(isMemberOnly);
      if (memberStatus !== 'all') {
        list = list.filter((u) => (u._derived?.status || 'pending') === memberStatus);
      }
    } else if (mode === 'employees') {
      list = list.filter(isEmployee);
      if (employeeRole !== 'all') {
        list = list.filter((u) => u.roles?.map((r) => String(r).toLowerCase()).includes(employeeRole));
      }
    }

    if (q) {
      list = list.filter(
        (u) =>
          (u.fullName || u.name || '').toLowerCase().includes(q) ||
          String(u.badgeId || '').toLowerCase() === q
      );
    }

    setFilteredUsers(list);
  }, [derivedUsers, mode, memberStatus, employeeRole, searchTerm]);

  // Counts
  const memberCount = useMemo(() => users.filter(isMemberOnly).length, [users]);
  const employeeCount = useMemo(() => users.filter(isEmployee).length, [users]);
  const staffCount = useMemo(
    () => users.filter((u) => u.roles?.map((r) => String(r).toLowerCase()).includes('staff')).length,
    [users]
  );
  const techCount = useMemo(
    () => users.filter((u) => u.roles?.map((r) => String(r).toLowerCase()).includes('tech')).length,
    [users]
  );
  const studentTechCount = useMemo(
    () => users.filter((u) => u.roles?.map((r) => String(r).toLowerCase()).includes('student tech')).length,
    [users]
  );

  // Column config (dynamic per mode) — includes Membership Type + Expiry Date from _derived
  const columns = useMemo(() => {
    const nameCol = {
      header: 'Name',
      accessor: (u) => u.fullName || u.name || '-',
      thClassName: 'w-[30%]',
    };

    const memberCols = [
      {
        header: 'Membership Type',
        accessor: (u) => u._derived?.membershipType || 'N/A',
        csvAccessor: (u) => u._derived?.membershipType || '',
      },
      {
        header: 'Expiry Date',
        accessor: (u) => {
          const d = u._derived?.expiryDate;
          return d ? new Date(d).toLocaleDateString() : '—';
        },
        csvAccessor: (u) => {
          const d = u._derived?.expiryDate;
          const dt = d ? new Date(d) : null;
          return dt ? dt.toISOString().slice(0, 10) : '';
        },
      },
      {
        header: 'Status',
        accessor: (u) => (u._derived?.status || 'pending'),
      },
    ];

    const roleCol = {
      header: 'Roles',
      accessor: (u) => (u.roles?.length ? u.roles.join(', ') : 'None'),
    };

    const mixCol = {
      header: 'Membership Type / Roles',
      accessor: (u) => {
        const mt = u._derived?.membershipType || u.membershipType || 'N/A';
        return u.roles?.length ? u.roles.join(', ') : mt;
      },
    };

    const actionsCol = {
      header: 'Actions',
      exportable: false,
      render: (u) => {
        const badgeLabel = hasBadge(u) ? 'View Badge' : 'Add Badge';
        return (
          <QuickActions
            badgeLabel={badgeLabel} // QuickActions should use this to label the badge action
            onBadgeClick={() => {
              setSelectedUserForBadge(u);
              setShowBadgeModal(true);
            }}
            onReserveClick={() => {
              // Attach your route or modal
              // e.g., router.push(`/reservations?user=${u.id}`)
            }}
            onPayClick={() => {
              setPayUser(u);
              setPayOpen(true);
            }}
          />
        );
      },
    };

    if (mode === 'members') return [nameCol, ...memberCols, actionsCol];
    if (mode === 'employees') return [nameCol, roleCol, actionsCol];
    return [nameCol, mixCol, actionsCol]; // 'all'
  }, [mode]);

  const onRowClick = (u) => {
    setSelectedUser(u);
    setShowUserModal(true);
  };

  // Delete — demo only (soft-delete locally)
  const handleDeleteUser = async (user) => {
    if (!user) return;
    if (!window.confirm(`Delete ${user.fullName || user.name}? This cannot be undone.`)) return;
    setUsers((prev) => prev.filter((x) => x.id !== user.id));
    setFilteredUsers((prev) => prev.filter((x) => x.id !== user.id));
    setShowUserModal(false);
    setSelectedUser(null);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-[#f1f5f9] to-white px-4 py-6 text-black">
      <CornerUtilities />

      <CardShell>
        {/* Header + Tools */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-3xl font-bold">Users</h1>

          <div className="flex-1 flex items-center gap-2">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search name or badge..."
            />

            <div className="flex items-center gap-2 ml-auto">
              <ExportCSVButton
                filename="users.csv"
                columns={columns}
                rows={filteredUsers}
              />
              <ViewToggleButton viewMode={viewMode} setViewMode={setViewMode} />
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="flex flex-wrap justify-start gap-6 mt-2">
          <StatBox label="Total Users" count={users.length} />
          <StatBox label="Members" count={memberCount} />
          <StatBox label="Employees" count={employeeCount} />
          <StatBox label="Staff" count={staffCount} />
          <StatBox label="Techs" count={techCount} />
          <StatBox label="Student Techs" count={studentTechCount} />
        </div>

        {/* Top-level filters */}
        <div className="flex flex-wrap gap-2 mt-4">
          <FilterPills
            className=""
            value={mode}
            onChange={(v) => {
              setMode(v);
              setMemberStatus('all');
              setEmployeeRole('all');
            }}
            options={[
              { value: 'all', label: 'All' },
              { value: 'members', label: 'Members' },
              { value: 'employees', label: 'Employees' },
            ]}
          />
        </div>

        {/* Secondary filters (conditional) */}
        <AnimatePresence>
          {mode === 'members' && (
            <FilterPills
              className="mt-2"
              value={memberStatus}
              onChange={setMemberStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'pending', label: 'Pending' },
                { value: 'expired', label: 'Expired' },
              ]}
            />
          )}

          {mode === 'employees' && (
            <FilterPills
              className="mt-2"
              value={employeeRole}
              onChange={setEmployeeRole}
              options={[
                { value: 'all', label: 'All' },
                { value: 'staff', label: 'Staff' },
                { value: 'tech', label: 'Tech' },
                { value: 'student tech', label: 'Student Tech' },
              ]}
            />
          )}
        </AnimatePresence>

        {/* Content */}
        <div className="flex-1 overflow-y-auto mt-4">
          {viewMode === 'table' ? (
            <DataTable
              columns={columns}
              rows={filteredUsers}
              onRowClick={onRowClick}
            />
          ) : (
            <CardGrid
              users={filteredUsers}
              onOpen={(u) => {
                setSelectedUser(u);
                setShowUserModal(true);
              }}
              onBadge={(u) => {
                setSelectedUserForBadge(u);
                setShowBadgeModal(true);
              }}
            />
          )}
        </div>
      </CardShell>

      {/* Badge Modal */}
      <AnimatePresence>
        {showBadgeModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
            style={{ backdropFilter: 'blur(8px)' }}
          >
            <BadgeAssignmentModal
              user={selectedUserForBadge}
              onClose={() => {
                setShowBadgeModal(false);
                setSelectedUserForBadge(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* User Modal */}
      <AnimatePresence>
        {showUserModal && selectedUser && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            style={{ backdropFilter: 'blur(8px)' }}
          >
            <div className="relative bg-white rounded-[2rem] shadow-2xl p-8 max-w-lg w-full border-0 flex flex-col gap-6">
              <button
                className="absolute top-4 right-4 text-[#94a3b8] hover:text-neutral transition"
                onClick={() => {
                  setShowUserModal(false);
                  setSelectedUser(null);
                }}
                aria-label="Close"
              >
                <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
                  <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>

              <div className="flex flex-col items-center gap-4">
                <img
                  src={selectedUser.photoURL || '/default-avatar.png'}
                  alt={selectedUser.fullName || selectedUser.name}
                  className="w-24 h-24 rounded-full shadow-lg border-4 border-white object-cover"
                />
                <div className="text-center">
                  <div className="text-2xl font-bold text-black">
                    {selectedUser.fullName || selectedUser.name}
                  </div>
                  <div className="text-gray-800 text-sm mt-1">
                    {selectedUser.roles?.length ? selectedUser.roles.join(', ') : (selectedUser._derived?.membershipType || selectedUser.membershipType || 'Member')}
                  </div>
                  {/* Badge + Membership meta */}
                  <div className="mt-2 text-xs text-gray-600">
                    {hasBadge(selectedUser) ? (
                      <>Badge: {selectedUser.badge?.id || selectedUser.badgeId}</>
                    ) : (
                      <>No badge assigned</>
                    )}
                    {selectedUser._derived?.expiryDate && (
                      <> • Expires: {new Date(selectedUser._derived.expiryDate).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <button
                  className="bg-purple-500 hover:bg-purple-600 text-white rounded-xl py-2 px-4 font-semibold shadow transition-all"
                  onClick={() => {
                    setShowUserModal(false);
                    setSelectedUserForBadge(selectedUser);
                    setShowBadgeModal(true);
                  }}
                >
                  {hasBadge(selectedUser) ? 'View Badge' : 'Add Badge'}
                </button>
                <button
                  className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl py-2 px-4 font-semibold shadow transition-all"
                  onClick={() => {
                    setShowUserModal(false);
                    setPayUser(selectedUser);
                    setPayOpen(true);
                  }}
                >
                  Pay
                </button>
              </div>

              <div className="mt-2 text-xs text-gray-500 text-center">
                All details shown. Actions are fully animated and beautiful.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pay Modal (from /users) */}
      <AnimatePresence>
        {payOpen && payUser && (
          <UserPayModal
            open={payOpen}
            onClose={() => { setPayOpen(false); setPayUser(null); }}
            user={payUser}
            items={inventory}
            subs={subs}
            onSaved={() => {
              // optional: refresh payments (not needed immediately for status unless showing live)
              setPayOpen(false);
              setPayUser(null);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Optional: super-simple card grid for `viewMode === 'card'` */
function CardGrid({ users, onOpen, onBadge }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {users.map((u) => (
        <div
          key={u.id}
          className="rounded-2xl bg-white/70 shadow p-4 flex flex-col gap-3 hover:shadow-md transition cursor-pointer"
          onClick={() => onOpen(u)}
        >
          <div className="flex items-center gap-3">
            <img
              src={u.photoURL || '/default-avatar.png'}
              alt={u.fullName || u.name}
              className="w-12 h-12 rounded-full object-cover"
            />
            <div>
              <div className="font-semibold">{u.fullName || u.name || '-'}</div>
              <div className="text-xs text-gray-600">
                {u.roles?.length ? u.roles.join(', ') : (u._derived?.membershipType || u.membershipType || 'Member')}
              </div>
              {u._derived?.expiryDate && (
                <div className="text-[11px] text-gray-500">
                  Expires {new Date(u._derived.expiryDate).toLocaleDateString()}
                </div>
              )}
            </div>
          </div>

          <div className="mt-1 flex gap-2">
            <button
              className="rounded-full px-3 py-1 text-sm font-medium shadow-sm bg-purple-100 hover:bg-purple-200 text-purple-600"
              onClick={(e) => {
                e.stopPropagation();
                onBadge(u);
              }}
              type="button"
            >
              {hasBadge(u) ? 'View Badge' : 'Add Badge'}
            </button>
            <button
              className="rounded-full px-3 py-1 text-sm font-medium shadow-sm bg-blue-100 hover:bg-blue-200 text-blue-700"
              onClick={(e) => {
                e.stopPropagation();
                // open pay via event dispatching to parent? simplified: navigate through modal in parent
                // For card grid, you can lift a handler via props. For now, open user modal where Pay is available.
                onOpen(u);
              }}
              type="button"
            >
              Pay
            </button>
          </div>
        </div>  
      ))}
    </div>
  );
}
