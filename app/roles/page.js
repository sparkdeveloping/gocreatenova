'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  doc,
  deleteDoc,
} from 'firebase/firestore';
import { app } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  Search,
  Plus,
  Trash,
  ShieldCheck,
  UserPlus
} from 'lucide-react';
import { useUser } from '../context/UserContext';
import CornerUtilities from '../components/CornerUtilities';
import { saveAs } from 'file-saver';

const db = getFirestore(app);

// 🔔 Expand as needed
const ALL_PERMISSIONS = [
  'createMember',
  'viewUsers',
  'editRoles',
  'manageInventory',
  'viewPayments',
  'createReservations',
  'viewSessions',
  'assignCertifications',
];

// —————————————————————————————————————————————
// Helpers
// —————————————————————————————————————————————
function rolesArraySafe(v) {
  return Array.isArray(v) ? v : [];
}

function toRolesMap(rolesList) {
  const m = new Map();
  for (const r of rolesList) m.set(r.id, r);
  return m;
}

function userHasEmployeeRole(user, rolesMap) {
  const userRoles = rolesArraySafe(user?.roles);
  for (const r of userRoles) {
    const rid = typeof r === 'object' ? r.id : r;
    const role = rolesMap.get(rid);
    if (role?.isEmployee) return true;
  }
  return false;
}

async function recomputeAllUsersEmployment(currentRoles) {
  const rolesMap = toRolesMap(currentRoles);
  const usersSnap = await getDocs(collection(db, 'users'));
  for (const u of usersSnap.docs) {
    const data = u.data();
    const isEmployee = userHasEmployeeRole(data, rolesMap);
    // Merge only the needed fields; don’t blast entire doc
    await setDoc(
      doc(db, 'users', u.id),
      { isEmployee },
      { merge: true }
    );
  }
}

// —————————————————————————————————————————————

export default function RolesPage() {
  const [roles, setRoles] = useState([]);
  const [filteredRoles, setFilteredRoles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingRole, setEditingRole] = useState(null);
  const [assignRole, setAssignRole] = useState(null);

  const { allUsers, refreshUsers } = useUser();

  // Fetch roles on mount
  useEffect(() => {
    const fetchRoles = async () => {
      const snap = await getDocs(collection(db, 'roles'));
      const fetched = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || '',
          permissions: rolesArraySafe(data.permissions),
          protected: !!data.protected,
          isDefault: !!data.isDefault,
          isEmployee: !!data.isEmployee, // ⬅️ new
        };
      });
      setRoles(fetched);
      setFilteredRoles(fetched);
    };
    fetchRoles();
  }, []);

  // Ensure users context loaded (used by Assign modal)
  useEffect(() => {
    if (!allUsers || allUsers.length === 0) {
      (async () => { await refreshUsers(); })();
    }
  }, [allUsers, refreshUsers]);

  // Search filter
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    const filtered = roles.filter((r) => (r.name || '').toLowerCase().includes(q));
    setFilteredRoles(filtered);
  }, [searchTerm, roles]);

  // Export CSV (now includes Is Employee / Is Default)
  const exportCSV = () => {
    const header = ['Role Name', 'Permissions', 'Is Employee', 'Is Default'];
    const rows = filteredRoles.map((r) => [
      r.name || '',
      rolesArraySafe(r.permissions).join(' '),
      r.isEmployee ? 'Yes' : 'No',
      r.isDefault ? 'Yes' : 'No',
    ]);
    const csv = [header, ...rows].map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'roles.csv');
  };

  // Delete role (remove from all users, then delete; recompute employment)
  const handleDelete = async (role) => {
    if (role.protected) return;
    const ok = window.confirm(`Delete role "${role.name}"? This will remove it from all users.`);
    if (!ok) return;

    // Remove role from every user
    const usersSnap = await getDocs(collection(db, 'users'));
    for (const u of usersSnap.docs) {
      const userData = u.data();
      const userRoles = rolesArraySafe(userData.roles);
      const updatedRoles = userRoles.filter((r) => {
        const rid = typeof r === 'object' ? r.id : r;
        return rid !== role.id;
      });
      if (updatedRoles.length !== userRoles.length) {
        await setDoc(doc(db, 'users', u.id), { roles: updatedRoles }, { merge: true });
      }
    }

    // Delete role doc
    await deleteDoc(doc(db, 'roles', role.id));

    // Update local state
    const newRoles = roles.filter((r) => r.id !== role.id);
    setRoles(newRoles);
    setFilteredRoles(
      newRoles.filter((r) => (r.name || '').toLowerCase().includes(searchTerm.toLowerCase()))
    );

    // Recompute user.isEmployee everywhere
    await recomputeAllUsersEmployment(newRoles);
    await refreshUsers();
  };

  // Create/Update role
  const handleSaveRole = async (role) => {
    const trimmedName = (role.name || '').trim();
    if (!trimmedName) return;

    // Normalize
    const normalized = {
      id: role.id || undefined,
      name: trimmedName,
      permissions: rolesArraySafe(role.permissions),
      protected: !!role.protected,
      isDefault: !!role.isDefault,
      isEmployee: !!role.isEmployee, // ⬅️ store flag
    };

    // If default, unset others
    if (normalized.isDefault) {
      const snap = await getDocs(collection(db, 'roles'));
      for (const d of snap.docs) {
        if (d.id !== normalized.id && d.data().isDefault) {
          await setDoc(doc(db, 'roles', d.id), { isDefault: false }, { merge: true });
        }
      }
    }

    let updated;
    if (normalized.id) {
      // Update existing
      await setDoc(doc(db, 'roles', normalized.id), normalized, { merge: true });
      updated = roles.map((r) => (r.id === normalized.id ? { ...r, ...normalized } : r));
    } else {
      // Create new
      const ref = doc(collection(db, 'roles'));
      const toCreate = { ...normalized, id: ref.id };
      await setDoc(ref, toCreate, { merge: true });
      updated = [...roles, toCreate];
    }

    setRoles(updated);
    setFilteredRoles(updated.filter((r) =>
      (r.name || '').toLowerCase().includes(searchTerm.toLowerCase())
    ));
    setEditingRole(null);

    // Recompute user.isEmployee using the *updated* roles
    await recomputeAllUsersEmployment(updated);
    await refreshUsers();
  };

  const handleAddRole = () => {
    setEditingRole({
      name: '',
      permissions: [],
      isDefault: false,
      isEmployee: false, // default off
    });
  };

  // —————————————————————————————————————————————
  // UI
  // —————————————————————————————————————————————
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white px-4 py-6 text-slate-900">
      <CornerUtilities />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 backdrop-blur-md bg-white/40 border border-slate-200 rounded-[2rem] shadow-xl w-full max-w-[1600px] mx-auto mt-16 mb-16 p-8 flex flex-col min-h-[calc(100vh-12rem)]"
      >
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-3xl font-bold">Roles</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              className="rounded-[1rem] p-2 border border-slate-300 bg-white/70 hover:bg-white/80 shadow-sm"
              aria-label="Export"
            >
              <Download className="w-5 h-5" />
            </button>
            <button
              onClick={handleAddRole}
              className="p-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-md"
              aria-label="Add Role"
            >
              <Plus className="w-5 h-5" />
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search roles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-2 rounded-full border border-slate-300 bg-white/80 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Roles Table */}
        <div className="flex-1 overflow-y-auto mt-4">
          <div className="backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl overflow-x-auto p-4">
            <table className="w-full text-sm text-left text-slate-700">
              <thead>
                <tr>
                  <th className="px-2 py-1">Role Name</th>
                  <th className="px-2 py-1">Permissions</th>
                  <th className="px-2 py-1">Employee</th>
                  <th className="px-2 py-1">Default</th>
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoles.map((r) => (
                  <tr key={r.id} className="border-t border-slate-200 hover:bg-white/70">
                    <td className="px-2 py-1 font-semibold text-black">{r.name}</td>
                    <td className="px-2 py-1">{rolesArraySafe(r.permissions).join(', ') || '—'}</td>
                    <td className="px-2 py-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        r.isEmployee ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {r.isEmployee ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        r.isDefault ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                      }`}>
                        {r.isDefault ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td className="px-2 py-1">
                      <div className="flex gap-2 items-center justify-center">
                        <ActionButton icon={ShieldCheck} onClick={() => setEditingRole(r)} color="#0ea5e9" />
                        <ActionButton icon={UserPlus} onClick={() => setAssignRole(r)} color="#10b981" />
                        {!r.protected && (
                          <ActionButton icon={Trash} onClick={() => handleDelete(r)} color="#ef4444" />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredRoles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-2 py-6 text-center text-slate-400">No roles found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Modals */}
        <AnimatePresence>
          {editingRole && (
            <RoleEditModal
              role={editingRole}
              onClose={() => setEditingRole(null)}
              onSave={handleSaveRole}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {assignRole && (
            <AssignUserModal
              role={assignRole}
              onClose={() => setAssignRole(null)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

const ActionButton = ({ icon: Icon, onClick, color }) => (
  <button
    onClick={onClick}
    className="flex items-center justify-center p-1 rounded-[1rem] shadow-sm backdrop-blur-md border border-slate-200 hover:shadow-md transition hover:scale-105"
    style={{
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      color: color || '#0f172a',
      width: '32px',
      height: '32px',
    }}
  >
    <Icon className="w-[14px] h-[14px]" />
  </button>
);

const RoleEditModal = ({ role, onClose, onSave }) => {
  const [name, setName] = useState(role?.name || '');
  const [permissions, setPermissions] = useState(rolesArraySafe(role?.permissions));
  const [isDefault, setIsDefault] = useState(!!role?.isDefault);
  const [isEmployee, setIsEmployee] = useState(!!role?.isEmployee); // ⬅️ new

  const togglePermission = (perm) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({ ...role, name: name.trim(), permissions, isDefault, isEmployee });
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-xl">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-[2rem] shadow-xl p-6 w-[calc(100%-2rem)] max-w-[800px] overflow-y-auto max-h-[90vh]"
      >
        <h2 className="text-xl font-bold mb-4">{role?.id ? 'Edit Role' : 'Add New Role'}</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Role Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-[1rem] px-3 py-2 bg-white/80"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Permissions</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {ALL_PERMISSIONS.map((p) => (
                <label key={p} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={permissions.includes(p)}
                    onChange={() => togglePermission(p)}
                    className="accent-blue-500"
                  />
                  {p}
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="accent-blue-500"
              />
              Set as Default Role
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isEmployee}
                onChange={(e) => setIsEmployee(e.target.checked)}
                className="accent-emerald-600"
              />
              Employee role
            </label>
            <p className="text-xs text-slate-500">
              “Employee role” marks this role as staff-facing. Users with any employee role will be
              treated as employees across the app (filters, Sessions, etc.).
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white"
          >
            Save
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const AssignUserModal = ({ role, onClose }) => {
  const { allUsers, refreshUsers } = useUser();
  const [filteredUsers, setFilteredUsers] = useState([]);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!allUsers || allUsers.length === 0) {
      (async () => { await refreshUsers(); })();
    }
  }, [allUsers, refreshUsers]);

  useEffect(() => {
    const initiallySelected = (allUsers || [])
      .filter((u) => rolesArraySafe(u.roles).some((r) => (typeof r === 'object' ? r.id : r) === role.id))
      .map((u) => u.id);
    setSelectedUserIds(initiallySelected);
    setFilteredUsers(allUsers || []);
  }, [allUsers, role.id]);

  useEffect(() => {
    const q = search.toLowerCase();
    const filtered = (allUsers || []).filter((u) =>
      (u.fullName || '').toLowerCase().includes(q)
    );
    setFilteredUsers(filtered);
  }, [search, allUsers]);

  const toggleUser = (id) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    const roleSummary = { id: role.id, name: role.name };
    // We need roles list to recompute employment flags:
    const rolesSnap = await getDocs(collection(db, 'roles'));
    const currentRoles = rolesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const rolesMap = toRolesMap(currentRoles);

    for (const user of allUsers || []) {
      const userRef = doc(db, 'users', user.id);
      let userRoles = rolesArraySafe(user.roles).map((r) =>
        typeof r === 'object' ? { id: r.id, name: r.name } : { id: r, name: '' }
      );
      const shouldHaveRole = selectedUserIds.includes(user.id);

      if (shouldHaveRole) {
        if (!userRoles.some((r) => r.id === role.id)) {
          userRoles.push(roleSummary);
        }
      } else {
        userRoles = userRoles.filter((r) => r.id !== role.id);
      }

      const isEmployee = userHasEmployeeRole({ roles: userRoles }, rolesMap);

      await setDoc(
        userRef,
        { roles: userRoles, isEmployee },
        { merge: true }
      );
    }

    await refreshUsers();
    setSaving(false);
    onClose();
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-xl">
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white/70 backdrop-blur-md border border-slate-200 rounded-[2rem] shadow-xl w-[calc(100%-2rem)] max-w-md overflow-hidden"
        style={{ maxHeight: '90vh' }}
      >
        {saving ? (
          <div className="flex flex-col items-center justify-center py-16 px-8 text-center space-y-4 max-w-md mx-auto">
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
              className="w-14 h-14 border-4 border-blue-500 border-t-transparent rounded-full shadow-md"
            />
            <h2 className="text-2xl font-extrabold text-slate-800 tracking-tight">
              Updating Role Assignments
            </h2>
            <p className="text-base text-slate-600 leading-relaxed">
              Please hold on while we update user roles in the system.
            </p>
          </div>
        ) : (
          <>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-4 text-center">
                Assign Users to <span className="text-blue-600">{role.name}</span>
              </h2>

              <div className="relative mb-3">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search users..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-full border border-slate-300 bg-white/80 text-sm shadow-sm focus:outline-none"
                />
              </div>

              <div
                className="border border-slate-200 rounded-[1.5rem] bg-white/60 backdrop-blur-sm shadow-inner overflow-y-auto p-2 space-y-1"
                style={{ maxHeight: '250px', minHeight: '100px' }}
              >
                {filteredUsers.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm rounded-lg hover:bg-white/70 transition p-2 pl-3">
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(u.id)}
                      onChange={() => toggleUser(u.id)}
                      className="accent-blue-500 w-4 h-4"
                    />
                    <span className="truncate">{u.fullName || 'Unnamed User'}</span>
                  </label>
                ))}
                {filteredUsers.length === 0 && (
                  <div className="text-xs text-slate-500 text-center py-4">
                    No users found.
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 mt-6">
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-sm text-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-sm text-white"
                >
                  Save
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
};
