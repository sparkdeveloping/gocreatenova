'use client';

import { useState, useEffect } from 'react';
import { getFirestore, collection, getDocs, addDoc, doc, updateDoc } from 'firebase/firestore';
import { app } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Search, Eye, Check } from 'lucide-react';
import { saveAs } from 'file-saver';
import CornerUtilities from '../components/CornerUtilities';
import { useUser } from '../context/UserContext';

export default function IssuesPage() {
  const db = getFirestore(app);
  const { currentUser } = useUser();
  const [issues, setIssues] = useState([]);
  const [filteredIssues, setFilteredIssues] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [modalIssue, setModalIssue] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    const fetchIssues = async () => {
      const querySnapshot = await getDocs(collection(db, 'issues'));
      const fetched = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setIssues(fetched);
      setFilteredIssues(fetched);
    };
    fetchIssues();
  }, []);

  useEffect(() => {
    let filtered = [...issues];

    if (statusFilter === 'open') {
      filtered = filtered.filter(i => !i.resolution);
    } else if (statusFilter === 'resolved') {
      filtered = filtered.filter(i => i.resolution);
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(i => i.type === typeFilter);
    }

    if (searchTerm) {
      filtered = filtered.filter(i =>
        i.entityName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    setFilteredIssues(filtered);
  }, [statusFilter, typeFilter, searchTerm, issues]);

  const exportCSV = () => {
    const header = ['Entity', 'Type', 'Description', 'Date Reported', 'Status', 'Resolved By', 'Resolved At', 'Notes', 'Created By'];
    const rows = filteredIssues.map(i => [
      i.entityName,
      i.type,
      i.description,
      i.reportedAt ? new Date(i.reportedAt.seconds * 1000).toLocaleDateString() : '',
      i.resolution ? 'Resolved' : 'Open',
      i.resolution?.resolvedBy || '',
      i.resolution?.resolvedAt ? new Date(i.resolution.resolvedAt.seconds * 1000).toLocaleDateString() : '',
      i.resolution?.notes || '',
      i.createdBy ? `${i.createdBy.name} (${i.createdBy.email})` : ''
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'issues.csv');
  };

  const handleCreateIssue = async (newIssue) => {
    if (!currentUser) return;
    const { entityName, type, description } = newIssue;
    const docRef = await addDoc(collection(db, 'issues'), {
      entityName,
      type,
      description,
      reportedAt: new Date(),
      createdBy: currentUser
    });
    const newEntry = {
      id: docRef.id,
      entityName,
      type,
      description,
      reportedAt: { seconds: Math.floor(Date.now() / 1000) },
            createdBy: currentUser

    };
    setIssues([newEntry, ...issues]);
  };
const handleResolveIssue = async (issueId) => {
  if (!currentUser) return;

  const issueRef = doc(db, 'issues', issueId);
  const resolution = {
    resolvedBy: currentUser,
    resolvedAt: new Date(),
    notes: 'Resolved via quick action'
  };

  await updateDoc(issueRef, { resolution });

  setIssues(prev =>
    prev.map(i =>
      i.id === issueId ? { ...i, resolution } : i
    )
  );
};

  const total = issues.length;
  const open = issues.filter(i => !i.resolution).length;
  const resolved = issues.filter(i => i.resolution).length;
  const urgent = issues.filter(i => i.type === 'urgent').length;
  const broken = issues.filter(i => i.type === 'broken machine').length;
  const employee = issues.filter(i => i.type === 'employee').length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white px-4 py-6 text-slate-900">
      <CornerUtilities />

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 backdrop-blur-md bg-white/40 border border-slate-200 rounded-[2rem] shadow-xl w-full max-w-[1600px] mx-auto mt-16 mb-16 p-8 flex flex-col min-h-[calc(100vh-12rem)]"
      >
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-3xl font-bold">Issues</h1>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm">
              <Download className="w-5 h-5" />
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search entity or description..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-full border border-slate-300 bg-white/80 text-sm"
              />
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="backdrop-blur-md bg-blue-500 hover:bg-blue-600 text-white rounded-[1rem] px-3 py-1 text-sm shadow-sm"
            >
              + New Issue
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-start gap-6 mt-2">
          <StatBox label="Total Issues" count={total} />
          <StatBox label="Open" count={open} />
          <StatBox label="Resolved" count={resolved} />
          <StatBox label="Urgent" count={urgent} />
          <StatBox label="Broken Machines" count={broken} />
          <StatBox label="Employee Issues" count={employee} />
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          {['all', 'open', 'resolved'].map(s => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setTypeFilter('all'); }}
              className={`text-sm rounded-full border px-3 py-1 ${
                statusFilter === s ? 'bg-blue-500 text-white' : 'bg-white/80 text-slate-700 border-slate-300 hover:bg-white'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        <AnimatePresence>
          {statusFilter !== 'all' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="flex flex-wrap gap-2 mt-2"
            >
              {['all', 'urgent', 'out of something', 'broken machine', 'employee'].map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`text-sm rounded-full border px-3 py-1 ${
                    typeFilter === t ? 'bg-blue-500 text-white' : 'bg-white/80 text-slate-700 border-slate-300 hover:bg-white'
                  }`}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto mt-4">
          <div className="backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl overflow-x-auto p-4">
            <table className="w-full text-sm text-left text-slate-700">
              <thead>
                <tr>
                  <th className="px-2 py-1">Entity</th>
                  <th className="px-2 py-1">Type</th>
                  <th className="px-2 py-1">Description</th>
                  <th className="px-2 py-1">Date Reported</th>
                  <th className="px-2 py-1">Status</th>
                  <th className="px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredIssues.map(i => (
                  <tr key={i.id} className="border-t border-slate-200 hover:bg-white/70 cursor-pointer">
                    <td className="px-2 py-1">{i.entityName}</td>
                    <td className="px-2 py-1">{i.type}</td>
                    <td className="px-2 py-1 truncate max-w-[200px]">{i.description}</td>
                    <td className="px-2 py-1">{i.reportedAt ? new Date(i.reportedAt.seconds * 1000).toLocaleDateString() : ''}</td>
                    <td className="px-2 py-1">{i.resolution ? 'Resolved' : 'Open'}</td>
                     <td className="px-2 py-1 flex gap-2">
  <IconButton icon={Eye} action="view" onClick={() => setModalIssue(i)} />
  {!i.resolution && (
    <IconButton icon={Check} action="resolve" onClick={() => handleResolveIssue(i.id)} />
  )}
</td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {modalIssue && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-md flex justify-center items-center z-50"
            onClick={() => setModalIssue(null)}
          >
            <motion.div
              initial={{ scale: 0.95 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="bg-white rounded-[2rem] p-6 max-w-lg w-full shadow-xl"
            >
              <h2 className="text-xl font-bold mb-2">{modalIssue.entityName}</h2>
              <p className="text-sm text-slate-600 mb-1"><strong>Type:</strong> {modalIssue.type}</p>
              <p className="text-sm text-slate-600 mb-1"><strong>Description:</strong> {modalIssue.description}</p>
              <p className="text-sm text-slate-600 mb-1"><strong>Date Reported:</strong> {modalIssue.reportedAt ? new Date(modalIssue.reportedAt.seconds * 1000).toLocaleDateString() : ''}</p>
              <p className="text-sm text-slate-600 mb-1"><strong>Status:</strong> {modalIssue.resolution ? 'Resolved' : 'Open'}</p>
              {modalIssue.createdBy && (
                <p className="text-sm text-slate-600 mb-1"><strong>Created By:</strong> {modalIssue.createdBy.name} ({modalIssue.createdBy.email})</p>
              )}
              {modalIssue.resolution && (
                <>
                  <p className="text-sm text-slate-600 mb-1"><strong>Resolved By:</strong> {modalIssue.resolution.resolvedBy}</p>
                  <p className="text-sm text-slate-600 mb-1"><strong>Resolved At:</strong> {modalIssue.resolution.resolvedAt ? new Date(modalIssue.resolution.resolvedAt.seconds * 1000).toLocaleDateString() : ''}</p>
                  <p className="text-sm text-slate-600"><strong>Notes:</strong> {modalIssue.resolution.notes}</p>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCreateModal && (
          <CreateIssueModal
            onClose={() => setShowCreateModal(false)}
            onCreate={handleCreateIssue}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const StatBox = ({ label, count }) => (
  <div>
    <div className="text-2xl font-bold">{count}</div>
    <div className="text-sm text-slate-500">{label}</div>
  </div>
);

const IconButton = ({ icon: Icon, action, onClick }) => {
  const colorMap = {
    view: 'bg-slate-900',
    resolve: 'bg-green-500'
  };
  const colorClass = colorMap[action] || 'bg-slate-900';

  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center p-2 rounded-[1rem] shadow-md hover:shadow-lg text-white ${colorClass}`}
      style={{ minWidth: '36px', minHeight: '36px' }}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
};

const CreateIssueModal = ({ onClose, onCreate }) => {
  const [entityName, setEntityName] = useState('');
  const [type, setType] = useState('urgent');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!entityName.trim() || !description.trim()) return;
    setSubmitting(true);
    await onCreate({
      entityName,
      type,
      description
    });
    setSubmitting(false);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-md flex justify-center items-center z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-[2rem] p-6 max-w-md w-full shadow-xl"
      >
        <h2 className="text-xl font-bold mb-4">New Issue</h2>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-slate-700">Entity Name</label>
            <input
              type="text"
              value={entityName}
              onChange={e => setEntityName(e.target.value)}
              className="w-full rounded-[1rem] border border-slate-300 p-2 text-sm bg-white/80"
            />
          </div>

          <div>
            <label className="text-sm text-slate-700">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full rounded-[1rem] border border-slate-300 p-2 text-sm bg-white/80"
            >
              <option value="urgent">Urgent</option>
              <option value="out of something">Out of Something</option>
              <option value="broken machine">Broken Machine</option>
              <option value="employee">Employee</option>
            </select>
          </div>

          <div>
            <label className="text-sm text-slate-700">Description</label>
            <textarea
              rows="3"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-[1rem] border border-slate-300 p-2 text-sm bg-white/80"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="rounded-[1rem] border border-slate-300 bg-white/70 px-3 py-1 text-sm hover:bg-white"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="rounded-[1rem] bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 text-sm shadow-sm"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};
