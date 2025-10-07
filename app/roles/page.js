'use client';

import { useState, useEffect } from 'react';
import { getFirestore, collection, getDocs, setDoc, doc, deleteDoc } from 'firebase/firestore';
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

// 🔔 Expand this as the app grows
const ALL_PERMISSIONS = [
  'createMember',
  'viewUsers',
  'editRoles',
  'manageInventory',
  'viewPayments',
  'createReservations',
  'viewSessions',
  'assignCertifications'
];

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
      const querySnapshot = await getDocs(collection(db, 'roles'));
      const fetched = querySnapshot.docs.map(docSnap => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          permissions: Array.isArray(data.permissions) ? data.permissions : []
        };
      });
      setRoles(fetched);
      setFilteredRoles(fetched);
    };
    fetchRoles();
  }, []);

  // Ensure users are loaded into context (if empty)
  useEffect(() => {
    if (!allUsers || allUsers.length === 0) {
      (async () => {
        await refreshUsers();
      })();
    }
  }, [allUsers, refreshUsers]);

  // Search filter
  useEffect(() => {
    const filtered = roles.filter(r =>
      r.name?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredRoles(filtered);
  }, [searchTerm, roles]);

  // Export CSV
  const exportCSV = () => {
    const header = ['Role Name', 'Permissions'];
    const rows = filteredRoles.map(r => [
      r.name || '',
      (r.permissions || []).join(' ')
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'roles.csv');
  };

  // Delete role (and remove from all users)
  const handleDelete = async (role) => {
    if (role.protected) return;
    const ok = window.confirm(`Delete role "${role.name}"? This will remove it from all users.`);
    if (!ok) return;

    const snapshot = await getDocs(collection(db, 'users'));
    for (const docSnap of snapshot.docs) {
      const userData = docSnap.data();
      const updatedRoles = (userData.roles || []).filter(r => r.id !== role.id);
      await setDoc(doc(db, 'users', docSnap.id), { ...userData, roles: updatedRoles });
    }

    await deleteDoc(doc(db, 'roles', role.id));
    const newRoles = roles.filter(r => r.id !== role.id);
    setRoles(newRoles);
    setFilteredRoles(newRoles.filter(r =>
      r.name?.toLowerCase().includes(searchTerm.toLowerCase())
    ));
  };

  // Create/Update role
  const handleSaveRole = async (role) => {
    const trimmedName = (role.name || '').trim();
    if (!trimmedName) return;

    // Normalize role object
    const normalized = {
      id: role.id || undefined,
      name: trimmedName,
      permissions: Array.isArray(role.permissions) ? role.permissions : [],
      protected: !!role.protected,
      isDefault: !!role.isDefault
    };

    // If default, unset any other default role
    if (normalized.isDefault) {
      const querySnapshot = await getDocs(collection(db, 'roles'));
      for (const docSnap of querySnapshot.docs) {
        if (docSnap.id !== normalized.id && docSnap.data().isDefault) {
          await setDoc(doc(db, 'roles', docSnap.id), { ...docSnap.data(), isDefault: false }, { merge: true });
        }
      }
    }

    if (normalized.id) {
      const ref = doc(db, 'roles', normalized.id);
      await setDoc(ref, normalized, { merge: true });
      const updated = roles.map(r => (r.id === normalized.id ? normalized : r));
      setRoles(updated);
      setFilteredRoles(updated.filter(r =>
        r.name?.toLowerCase().includes(searchTerm.toLowerCase())
      ));
    } else {
      const ref = doc(collection(db, 'roles'));
      const toCreate = { ...normalized, id: ref.id };
      await setDoc(ref, toCreate);
      const updated = [...roles, toCreate];
      setRoles(updated);
      setFilteredRoles(updated.filter(r =>
        r.name?.toLowerCase().includes(searchTerm.toLowerCase())
      ));
    }

    setEditingRole(null);
  };

  const handleAddRole = () => {
    setEditingRole({ name: '', permissions: [], isDefault: false });
  };

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
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Roles</h1>
          <div className="flex gap-2">
            <button onClick={exportCSV} className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm">
              <Download className="w-5 h-5" />
            </button>
            <button onClick={handleAddRole} className="p-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white shadow-md">
              <Plus className="w-5 h-5" />
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search roles..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-full border border-slate-300 bg-white/80 text-sm"
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
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRoles.map(r => (
                  <tr key={r.id} className="border-t border-slate-200 hover:bg-white/70">
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="px-2 py-1">{(r.permissions || []).join(', ')}</td>
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
                    <td colSpan={3} className="px-2 py-6 text-center text-slate-400">No roles found.</td>
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
      height: '32px'
    }}
  >
    <Icon className="w-[14px] h-[14px]" />
  </button>
);

const RoleEditModal = ({ role, onClose, onSave }) => {
  const [name, setName] = useState(role?.name || '');
  const [permissions, setPermissions] = useState(role?.permissions || []);
  const [isDefault, setIsDefault] = useState(role?.isDefault || false);

  const togglePermission = (perm) => {
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]
    );
  };

  const handleSubmit = () => {
    if (!name.trim()) return;
    onSave({ ...role, name: name.trim(), permissions, isDefault });
  };

  return (
    // 🔆 Full-page blur, no dark overlay
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
              onChange={e => setName(e.target.value)}
              className="w-full mt-1 border border-slate-300 rounded-[1rem] px-3 py-2 bg-white/80"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Permissions</label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
              {ALL_PERMISSIONS.map(p => (
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

          <div>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                className="accent-blue-500"
              />
              Set as Default Role
            </label>
            <p className="text-xs text-slate-500 mt-1">
              This role will be automatically assigned to newly created users.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700">Cancel</button>
          <button onClick={handleSubmit} className="px-4 py-2 rounded-full bg-blue-500 hover:bg-blue-600 text-white">Save</button>
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

  // If context is empty, load users first
  useEffect(() => {
    if (!allUsers || allUsers.length === 0) {
      (async () => {
        await refreshUsers();
      })();
    }
  }, [allUsers, refreshUsers]);

  useEffect(() => {
    const initiallySelected = (allUsers || [])
      .filter(u => (u.roles || []).some(r => r.id === role.id))
      .map(u => u.id);
    setSelectedUserIds(initiallySelected);
    setFilteredUsers(allUsers || []);
  }, [allUsers, role.id]);

  useEffect(() => {
    const filtered = (allUsers || []).filter(u =>
      (u.fullName || '').toLowerCase().includes(search.toLowerCase())
    );
    setFilteredUsers(filtered);
  }, [search, allUsers]);

  const toggleUser = (id) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    const roleSummary = { id: role.id, name: role.name };
    const updatedRoleUsers = [];

    for (const user of allUsers || []) {
      const userRef = doc(db, 'users', user.id);
      let userRoles = Array.isArray(user.roles) ? [...user.roles] : [];
      const shouldHaveRole = selectedUserIds.includes(user.id);

      if (shouldHaveRole) {
        if (!userRoles.some(r => r.id === role.id)) {
          userRoles.push(roleSummary);
        }
        updatedRoleUsers.push({ id: user.id, fullName: user.fullName });
      } else {
        userRoles = userRoles.filter(r => r.id !== role.id);
      }

      await setDoc(userRef, { ...user, roles: userRoles });
    }

    const roleRef = doc(db, 'roles', role.id);
    await setDoc(roleRef, { ...role, users: updatedRoleUsers }, { merge: true });

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
          // 🔹 Centralized loading screen
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
    Please hold on while we update user roles in the system. This may take a few seconds.
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
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 rounded-full border border-slate-300 bg-white/80 text-sm shadow-sm focus:outline-none"
                />
              </div>

              <div
                className="border border-slate-200 rounded-[1.5rem] bg-white/60 backdrop-blur-sm shadow-inner overflow-y-auto p-2 space-y-1"
                style={{ maxHeight: '250px', minHeight: '100px' }}
              >
                {filteredUsers.map(user => (
                  <label
                    key={user.id}
                    className="flex items-center gap-2 text-sm rounded-lg hover:bg-white/70 transition p-2 pl-3"
                  >
                    <input
                      type="checkbox"
                      checked={selectedUserIds.includes(user.id)}
                      onChange={() => toggleUser(user.id)}
                      className="accent-blue-500 w-4 h-4"
                    />
                    <span className="truncate">{user.fullName || 'Unnamed User'}</span>
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


