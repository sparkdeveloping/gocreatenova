'use client';

import { useState, useEffect } from 'react';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
import { app } from '../lib/firebase';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BadgeCheck,
  Clock,
  ScanLine,
  Table2,
  LayoutGrid,
  Download,
  Search,
  CalendarRange,
  Sun,
  Calendar,
  MapPin,
  ImageIcon,
  ArrowLeft
} from 'lucide-react';
import { intervalToDuration } from 'date-fns';
import { saveAs } from 'file-saver';
import { DateRange } from 'react-date-range';
import Image from 'next/image';
import Link from 'next/link';
import 'react-date-range/dist/styles.css';
import 'react-date-range/dist/theme/default.css';
import CornerUtilities from '../components/CornerUtilities';

export default function SessionsPage() {
  const db = getFirestore(app);
  const [sessions, setSessions] = useState([]);
  const [filteredSessions, setFilteredSessions] = useState([]);
  const [roles, setRoles] = useState('all');
  const [viewMode, setViewMode] = useState('table');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState([{ startDate: null, endDate: null, key: 'selection' }]);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [modalSession, setModalSession] = useState(null);

  useEffect(() => {
    const fetchSessions = async () => {
      const querySnapshot = await getDocs(collection(db, 'sessions'));
      const fetched = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setSessions(fetched);
      setFilteredSessions(fetched);
    };
    fetchSessions();
  }, []);

  useEffect(() => {
    let filtered = [...sessions];

    if (roles !== 'all') {
      if (roles === 'employee') {
        filtered = filtered.filter(s => s.member.roles?.some(r => ['tech', 'mentor', 'admin', 'staff', 'employee', 'student tech'].includes(r)));
      } else {
        filtered = filtered.filter(s => s.member.roles?.includes(roles));
      }
    }

    if (searchTerm) {
      filtered = filtered.filter(s => s.member.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    const { startDate, endDate } = dateRange[0];
    if (startDate && endDate) {
      filtered = filtered.filter(s => {
        const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
        return start >= startDate && start <= endDate;
      });
    }

    setFilteredSessions(filtered);
  }, [roles, searchTerm, dateRange, sessions]);

  const formatDuration = (start, end) => {
    if (!start) return '';
    const startTime = start?.toDate ? start.toDate() : new Date(start);
    const endTime = end?.toDate ? end.toDate() : new Date(end || new Date());
    const dur = intervalToDuration({ start: startTime, end: endTime });
    const hours = dur.hours || 0;
    const mins = dur.minutes || 0;
    return `${hours}h ${mins}m`;
  };

  const readableType = (type) => {
    return type === 'ClockIn' ? 'Shift' : 'Regular';
  };

  const exportCSV = () => {
    const header = ['Name', 'Type', 'Start', 'End', 'Duration'];
    const rows = filteredSessions.map(s => {
      const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
      const end = s.endTime?.toDate ? s.endTime.toDate() : null;
      return [
        s.member.name,
        readableType(s.type),
        start.toLocaleString(),
        end ? end.toLocaleString() : 'Active',
        formatDuration(s.startTime, s.endTime)
      ];
    });
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    saveAs(blob, 'sessions.csv');
  };

  const handleSearchChange = (val) => {
    setSearchTerm(val);
    if (/^\d{4}$/.test(val)) {
      const match = sessions.find(s => s.member.badgeId === val);
      if (match) setModalSession(match);
    }
  };

  const totalSessions = filteredSessions.length;
  const memberSessions = filteredSessions.filter(s => !s.member.roles?.some(r => ['tech', 'mentor', 'admin', 'staff', 'employee', 'student tech'].includes(r))).length;
  const employeeSessions = filteredSessions.filter(s => s.member.roles?.some(r => ['tech', 'mentor', 'admin', 'staff', 'employee', 'student tech'].includes(r))).length;
  const techSessions = filteredSessions.filter(s => s.member.roles?.includes('tech')).length;
  const studentTechSessions = filteredSessions.filter(s => s.member.roles?.includes('student tech')).length;

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white px-4 py-6 text-slate-900">
   <CornerUtilities />
      {/* Main content wrapped in large glass card */}
<motion.div
  initial={{ opacity: 0, y: 10 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, ease: 'easeOut' }}
  className="relative z-10 backdrop-blur-md bg-white/40 border border-slate-200 rounded-[2rem] shadow-xl w-full max-w-[1600px] mx-auto mt-16 mb-16 p-8 flex flex-col min-h-[calc(100vh-12rem)]"
>

  {/* Header, filters, stats, session list below */}

        {/* Header and controls */}
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h1 className="text-3xl font-bold">Sessions</h1>
          <div className="flex items-center gap-2">
            <button onClick={exportCSV} className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm">
              <Download className="w-5 h-5" />
            </button>
            <button onClick={() => setViewMode(viewMode === 'card' ? 'table' : 'card')} className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm">
              {viewMode === 'card' ? <Table2 className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
            </button>
            <button onClick={() => setShowDatePicker(!showDatePicker)} className="backdrop-blur-md bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] p-2 shadow-sm">
              <CalendarRange className="w-5 h-5" />
            </button>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search name... or Scan Badge here"
                value={searchTerm}
                onChange={e => handleSearchChange(e.target.value)}
                className="pl-8 pr-3 py-1 rounded-full border border-slate-300 bg-white/80 text-sm"
              />
            </div>
          </div>
        </div>

        {/* Role filters */}
        <div className="flex flex-wrap gap-2">
          {['all', 'member', 'employee', 'staff', 'tech', 'student tech'].map(r => (
            <button
              key={r}
              onClick={() => setRoles(r)}
              className={`text-sm rounded-full border px-3 py-1 ${
                roles === r
                  ? 'bg-blue-500 text-white'
                  : r === 'employee' || r === 'staff' || r === 'tech' || r === 'student tech'
                  ? 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200'
                  : 'bg-white/80 text-slate-700 border-slate-300 hover:bg-white'
              }`}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>

        {/* Date picker */}
        {showDatePicker && (
          <DateRange
            ranges={dateRange}
            onChange={item => setDateRange([item.selection])}
            maxDate={new Date()}
          />
        )}

        {/* Stats summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-center">
          <div><div className="text-2xl font-bold">{totalSessions}</div><div className="text-sm text-slate-500">Total</div></div>
          <div><div className="text-2xl font-bold">{memberSessions}</div><div className="text-sm text-slate-500">Members</div></div>
          <div><div className="text-2xl font-bold">{employeeSessions}</div><div className="text-sm text-slate-500">Employees</div></div>
          <div><div className="text-2xl font-bold">{techSessions}</div><div className="text-sm text-slate-500">Techs</div></div>
          <div><div className="text-2xl font-bold">{studentTechSessions}</div><div className="text-sm text-slate-500">Student Techs</div></div>
        </div>



      <div className="flex-1 overflow-y-auto">
  <SessionGrid
    filteredSessions={filteredSessions}
    viewMode={viewMode}
    readableType={readableType}
    formatDuration={formatDuration}
    onSessionClick={(s) => setModalSession(s)}
    modalSession={modalSession}
    setModalSession={setModalSession}
  />
</div>

<SessionModal
  session={modalSession}
  onClose={() => setModalSession(null)}
/>
      </motion.div>
    </div>
  );
}


function SessionGrid({
  filteredSessions,
  viewMode,
  readableType,
  formatDuration,
  onSessionClick,
  modalSession,
  setModalSession
}) {
  return (
    <>
      {/* Grid or Table View */}
      {viewMode === 'card' ? (
        <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {filteredSessions.map((s) => {
            const isActive = !s.endTime;
            const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
            const end = s.endTime?.toDate ? s.endTime.toDate() : null;
            const duration = formatDuration(s.startTime, s.endTime);

            return (
              <div
                key={s.id}
                onClick={() => onSessionClick(s)}
                className="cursor-pointer backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl p-4 hover:shadow-lg transition"
              >
                <div className="flex items-center gap-2 mb-1 font-semibold">
                  <BadgeCheck className="w-4 h-4 text-slate-500" />
                  {s.member.name}
                </div>
                <div className="text-sm text-slate-500 mb-1">
                  <ScanLine className="inline w-4 h-4 mr-1" />
                  {readableType(s.type)}
                </div>
                <div className="text-sm text-slate-500 mb-1">
                  <Clock className="inline w-4 h-4 mr-1" />
                  {start.toLocaleString()}
                </div>
                <div className="text-sm mb-1">
                  {end ? (
                    <span className="text-black">{duration}</span>
                  ) : (
                    <span className="text-blue-500 font-medium">Active • {duration}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl overflow-x-auto p-4">
          <table className="w-full text-sm text-left text-slate-700">
            <thead>
              <tr>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1">Start</th>
                <th className="px-2 py-1">End</th>
                <th className="px-2 py-1">Duration</th>
              </tr>
            </thead>
            <tbody>
              {filteredSessions.map((s) => {
                const isActive = !s.endTime;
                const start = s.startTime?.toDate ? s.startTime.toDate() : new Date(s.startTime);
                const end = s.endTime?.toDate ? s.endTime.toDate() : null;
                const duration = formatDuration(s.startTime, s.endTime);

                return (
                  <tr
                    key={s.id}
                    onClick={() => onSessionClick(s)}
                    className="border-t border-slate-200 hover:bg-white/70 cursor-pointer"
                  >
                    <td className="px-2 py-1 flex items-center gap-1">
                      <BadgeCheck className="w-4 h-4 text-slate-400" />
                      {s.member.name}
                    </td>
                    <td className="px-2 py-1">{readableType(s.type)}</td>
                    <td className="px-2 py-1">{start.toLocaleString()}</td>
                    <td className="px-2 py-1">
                      {end ? (
                        end.toLocaleString()
                      ) : (
                        <span className="text-blue-500 font-medium">Active • {duration}</span>
                      )}
                    </td>
                    <td className="px-2 py-1">{end ? duration : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

     
    </>
  );
}
function SessionModal({ session, onClose }) {
  const [activeTab, setActiveTab] = useState('current');

  if (!session) return null;

  const start = session.startTime?.toDate ? session.startTime.toDate() : new Date(session.startTime);
  const end = session.endTime?.toDate ? session.endTime.toDate() : null;
  const type = session.type === 'ClockIn' ? 'Shift' : 'Regular';
  const statusVerb = session.type === 'ClockIn' ? 'Clocked' : 'Checked';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 backdrop-blur-md z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white/80 backdrop-blur-md rounded-[2rem] shadow-xl w-full max-w-md p-6 space-y-4"
        >
          {/* Modal content starts here */}
          <h2 className="text-xl font-bold">Session Details</h2>

          {/* Profile info */}
          <div className="space-y-1 text-sm text-slate-700">
            <div><strong>Name:</strong> {session.member.name}</div>
            <div><strong>Badge:</strong> {session.member.badgeId || 'N/A'}</div>
            <div><strong>Type:</strong> {type}</div>
            <Link href={`/users/${session.member.id}`}>
              <button className="mt-2 text-blue-500 text-xs hover:underline">
                View Profile
              </button>
            </Link>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-4 border-b border-slate-200">
            {['Current Session', 'All Sessions'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab === 'Current Session' ? 'current' : 'all')}
                className={`px-2 pb-1 text-sm ${
                  activeTab === (tab === 'Current Session' ? 'current' : 'all')
                    ? 'border-b-2 border-blue-500 text-blue-500'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Logs */}
          <div className="text-sm text-slate-700 space-y-1 mt-2">
            {activeTab === 'current' ? (
              <>
                <div>{statusVerb} in at {start.toLocaleString()}</div>
                {end && <div>{statusVerb} out at {end.toLocaleString()}</div>}
              </>
            ) : (
              <div>Empty logs (future feature)</div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end mt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-full bg-blue-500 text-white hover:bg-blue-600 text-sm transition"
            >
              Close
            </button>
          </div>
          {/* Modal content ends here */}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
