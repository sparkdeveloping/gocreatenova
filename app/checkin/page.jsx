'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { CalendarCheck, User, Users, Plus, MinusCircle } from 'lucide-react';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';
import { app } from '../lib/firebase';
import Shell from '../components/Shell';
import { useUser } from '../context/UserContext';

const db = getFirestore(app);

export default function CheckInPage() {
  const [isEmployee, setIsEmployee] = useState(false);
  const [showGuestModal, setShowGuestModal] = useState(false);
  const [guestList, setGuestList] = useState([{ fullName: '', phone: '' }]);
  // JS version (no TS generics)
  const [guestStep, setGuestStep] = useState('ask'); // 'ask' | 'list'
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [countdown, setCountdown] = useState(10);
  const router = useRouter();

  const { currentUser: member, loading } = useUser();

  useEffect(() => {
    if (!loading && member) {
      // robust role-name detection (works for strings or {id,name})
      const roleNames = (member.roles || []).map((r) =>
        typeof r === 'string' ? r : (r?.name || r?.id || '')
      );
      const lower = roleNames.map((n) => n.toLowerCase());
      setIsEmployee(
        lower.some((n) => ['tech', 'mentor', 'admin', 'employee', 'staff'].includes(n))
      );

      // If already has an open session, bounce to dashboard
      const checkActiveSession = async () => {
        const qRef = query(
          collection(db, 'sessions'),
          where('member.id', '==', member.id),
          where('endTime', '==', null)
        );
        const snapshot = await getDocs(qRef);
        if (!snapshot.empty) router.push('/dashboard');
      };
      checkActiveSession();
    }
  }, [loading, member, router]);

  // Auto proceed for members (no guests) with countdown
  useEffect(() => {
    if (!member || isEmployee || showGuestModal) return;
    const id = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          handleMemberGuestDecision(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [member, isEmployee, showGuestModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEmployeeClockIn = async () => {
    const memberWithId = { ...member, id: member.id || member?.docId };
    const sessionRef = await addDoc(collection(db, 'sessions'), {
      member: memberWithId,
      startTime: serverTimestamp(),
      endTime: null,
      type: 'ClockIn',
    });
    setCurrentSessionId(sessionRef.id);
    router.push('/dashboard');
  };

  const handleEmployeeCheckIn = async () => {
    const memberWithId = { ...member, id: member.id || member?.docId };
    const sessionRef = await addDoc(collection(db, 'sessions'), {
      member: memberWithId,
      startTime: serverTimestamp(),
      endTime: null,
      type: 'CheckIn',
    });
    setCurrentSessionId(sessionRef.id);
    setShowGuestModal(true);
  };

  const handleMemberGuestDecision = async (hasGuests) => {
    const memberWithId = { ...member, id: member.id || member?.docId };
    const sessionRef = await addDoc(collection(db, 'sessions'), {
      member: memberWithId,
      startTime: serverTimestamp(),
      endTime: null,
      type: 'CheckIn',
    });
    setCurrentSessionId(sessionRef.id);

    if (hasGuests) {
      setShowGuestModal(true);
      setGuestStep('list');
    } else {
      router.push('/dashboard');
    }
  };

  const completeGuestCheckIn = () => {
    setShowGuestModal(false);
    setGuestStep('ask');
    router.push('/dashboard');
  };

  const proceedGuestDecision = (hasGuests) => {
    if (hasGuests) {
      setGuestStep('list');
    } else {
      setShowGuestModal(false);
      router.push('/dashboard');
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="flex justify-center items-center min-h-screen text-sm text-slate-500">
          Loading...
        </div>
      </Shell>
    );
  }

  if (!member) {
    return (
      <Shell>
        <div className="flex justify-center items-center min-h-screen text-red-500 text-sm">
          No valid member found. Please scan again.
        </div>
      </Shell>
    );
  }

  const displayName = member.fullName || member.name || 'Member';

  return (
    <Shell>
      <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white flex items-center justify-center text-slate-900">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="relative z-10 backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl w-[90%] max-w-3xl p-10 space-y-6"
        >
          {/* Employee UI */}
          {isEmployee && !showGuestModal && (
            <div className="space-y-5 flex flex-col items-center">
              <div className="w-[80px] h-[80px] rounded-full overflow-hidden border border-slate-300 shadow-md">
                <Image
                  src={member?.profileImageUrl || '/default-avatar.png'}
                  alt="Employee Avatar"
                  width={80}
                  height={80}
                  className="object-cover"
                />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-center">
                Welcome, {displayName}
              </h2>
              <p className="text-sm text-slate-600 text-center max-w-sm">
                Please select whether you are clocking in for your shift or simply checking in to
                use resources.
              </p>
              <div className="flex gap-6">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  onClick={handleEmployeeClockIn}
                  className="flex flex-col items-center justify-center gap-2 bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] min-w-[140px] min-h-[64px] px-4 py-3 transition shadow-sm text-center"
                >
                  <CalendarCheck className="w-7 h-7" />
                  <span className="text-sm font-medium">Clock In</span>
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  onClick={handleEmployeeCheckIn}
                  className="flex flex-col items-center justify-center gap-2 bg-white/70 hover:bg-white/80 border border-slate-300 rounded-[1rem] min-w-[140px] min-h-[64px] px-4 py-3 transition shadow-sm text-center"
                >
                  <User className="w-7 h-7" />
                  <span className="text-sm font-medium">Check In</span>
                </motion.button>
              </div>
            </div>
          )}

          {/* Member UI */}
          {!isEmployee && !showGuestModal && (
            <div className="space-y-5 flex flex-col items-center">
              <div className="w-[80px] h-[80px] rounded-full overflow-hidden border border-slate-300 shadow-md">
                <Image
                  src={member?.profileImageUrl || '/default-avatar.png'}
                  alt="Member Avatar"
                  width={80}
                  height={80}
                  className="object-cover"
                />
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-center">
                Welcome, {displayName}
              </h2>
              <p className="text-sm text-slate-600 text-center max-w-sm">
                Do you have guests joining you today?
              </p>
              <div className="flex gap-6 mt-2">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  onClick={() => handleMemberGuestDecision(false)}
                  className="min-w-[140px] min-h-[56px] bg-gray-300 text-slate-800 rounded-[1.5rem] text-base hover:bg-gray-400 transition"
                >
                  No
                </motion.button>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  onClick={() => handleMemberGuestDecision(true)}
                  className="min-w-[140px] min-h-[56px] bg-blue-500 text-white rounded-[1.5rem] text-base hover:bg-blue-600 transition"
                >
                  Yes
                </motion.button>
              </div>
              <div className="text-xs text-slate-500 mt-4">
                Auto-proceeding in {countdown} seconds...
              </div>
            </div>
          )}
        </motion.div>

        {/* Guest modal */}
        {showGuestModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 50, opacity: 0 }}
              className="bg-white/80 backdrop-blur-md rounded-[2rem] p-10 w-full max-w-sm shadow-xl space-y-6 text-center"
            >
              {guestStep === 'ask' ? (
                <>
                  <Users className="w-12 h-12 text-slate-700 mx-auto mb-2" />
                  <h3 className="text-lg md:text-xl font-bold">
                    Do you have guests joining you today?
                  </h3>
                  <div className="flex justify-center gap-6 mt-4">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={() => proceedGuestDecision(false)}
                      className="min-w-[140px] min-h-[56px] bg-gray-300 text-slate-800 rounded-[1.5rem] text-base hover:bg-gray-400 transition"
                    >
                      No
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={() => proceedGuestDecision(true)}
                      className="min-w-[140px] min-h-[56px] bg-blue-500 text-white rounded-[1.5rem] text-base hover:bg-blue-600 transition"
                    >
                      Yes
                    </motion.button>
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg md:text-xl font-bold mb-4">Add Guests</h3>
                  <div className="space-y-2">
                    {guestList.map((guest, index) => (
                      <div key={index} className="flex gap-2 items-center w-full">
                        <div className="flex-1">
                          <input
                            type="text"
                            placeholder="Full Name"
                            value={guest.fullName}
                            onChange={(e) => {
                              const updated = [...guestList];
                              updated[index].fullName = e.target.value;
                              setGuestList(updated);
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                          />
                        </div>
                        <div className="flex-1">
                          <input
                            type="tel"
                            placeholder="Phone"
                            value={guest.phone}
                            onChange={(e) => {
                              const updated = [...guestList];
                              updated[index].phone = e.target.value;
                              setGuestList(updated);
                            }}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...guestList];
                            updated.splice(index, 1);
                            setGuestList(updated.length ? updated : [{ fullName: '', phone: '' }]);
                          }}
                          className="shrink-0"
                          aria-label="Remove guest"
                        >
                          <MinusCircle className="w-5 h-5 text-red-500 hover:text-red-700" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-between items-center mt-4">
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={() =>
                        setGuestList([...guestList, { fullName: '', phone: '' }])
                      }
                      className="flex items-center gap-1 text-sm text-slate-700 hover:text-slate-900"
                    >
                      <Plus className="w-4 h-4" />
                      Add Guest
                    </motion.button>

                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      onClick={completeGuestCheckIn}
                      className="bg-blue-500 text-white rounded-[1rem] px-4 py-2 text-sm hover:bg-blue-600 transition"
                    >
                      Done
                    </motion.button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </div>
    </Shell>
  );
}
