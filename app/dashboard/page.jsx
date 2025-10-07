'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  Wrench,
  ShoppingBag,
  GraduationCap,
  BookOpen,
  CalendarCheck,
  BadgeCheck,
  Gavel,
  AlertTriangle,
  Clock,
  Users,
  BarChartBig,
  Wallet,
  Hammer,
  ShieldCheck,
  LogOut,
  Sun,
  Calendar,
  MapPin,
  ImageIcon
} from 'lucide-react';
import { getFirestore, updateDoc, doc, query, where, collection, getDocs, serverTimestamp } from 'firebase/firestore';
import { app } from '../lib/firebase';
import CornerUtilities from '../components/CornerUtilities';
const db = getFirestore(app);

export default function DashboardPage() {
  const [member, setMember] = useState(null);
  const [sessionType, setSessionType] = useState(null);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [goodbyeCountdown, setGoodbyeCountdown] = useState(5);
  const [showGoodbye, setShowGoodbye] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const stored = localStorage.getItem('nova-user');
    if (!stored) {
      router.push('/');
      return;
    }
    const parsed = JSON.parse(stored);
    setMember(parsed);

    const checkActiveSession = async () => {
      const q = query(
        collection(db, 'sessions'),
        where('member.id', '==', parsed.id),
        where('endTime', '==', null)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const session = snapshot.docs[0];
        setCurrentSessionId(session.id);
        setSessionType(session.data().type);
      } else {
        router.push('/checkin');
      }
    };

    checkActiveSession();
  }, [router]);

  useEffect(() => {
    if (showGoodbye) {
      const interval = setInterval(() => {
        setGoodbyeCountdown((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [showGoodbye]);

  useEffect(() => {
    if (goodbyeCountdown === 0) {
      router.push('/');
    }
  }, [goodbyeCountdown, router]);

  const handleSignOut = async () => {
    try {
      if (currentSessionId) {
        const sessionDocRef = doc(db, 'sessions', currentSessionId);
        await updateDoc(sessionDocRef, { endTime: serverTimestamp() });
      }
      setShowGoodbye(true);
    } catch (err) {
      console.error('Error signing out:', err);
      alert('Error recording sign out. Please try again.');
    }
  };

  const options = [
    { icon: Wrench, label: 'tools', path: '/tools', tintClass: 'text-blue-500', hoverClass: 'hover:bg-blue-500' },
    { icon: ShoppingBag, label: 'materials', path: '/materials', tintClass: 'text-blue-500', hoverClass: 'hover:bg-blue-500' },
    { icon: GraduationCap, label: 'certifications', path: '/certifications', tintClass: 'text-yellow-500', hoverClass: 'hover:bg-yellow-500' },
    { icon: BookOpen, label: 'courses', path: '/courses', tintClass: 'text-yellow-500', hoverClass: 'hover:bg-yellow-500' },
    { icon: CalendarCheck, label: 'reservations', path: '/reservations', tintClass: 'text-teal-500', hoverClass: 'hover:bg-teal-500' },
    { icon: BadgeCheck, label: 'about', path: '/about', tintClass: 'text-teal-500', hoverClass: 'hover:bg-teal-500' },
    { icon: Gavel, label: 'bids', path: '/bids', tintClass: 'text-rose-500', hoverClass: 'hover:bg-rose-500' },
    { icon: AlertTriangle, label: 'issues', path: '/issues', tintClass: 'text-rose-500', hoverClass: 'hover:bg-rose-500' },
    { icon: Clock, label: 'sessions', path: '/sessions', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: Users, label: 'users', path: '/users', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: BarChartBig, label: 'analytics', path: '/analytics', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: Wallet, label: 'payments', path: '/payments', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: Hammer, label: 'maintenance', path: '/maintenance', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' },
    { icon: ShieldCheck, label: 'roles', path: '/roles', tintClass: 'text-slate-500', hoverClass: 'hover:bg-slate-500' }
  ];

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-slate-100 to-white flex items-center justify-center text-slate-900">
    <CornerUtilities />
      {/* Profile + grid + actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="relative z-10 backdrop-blur-md bg-white/50 border border-slate-200 rounded-[2rem] shadow-xl w-[90%] max-w-3xl p-10 space-y-6"
      >
        {!showGoodbye ? (
          <>
            {/* Profile header */}
            <div className="flex justify-between items-center flex-wrap gap-4 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-[1rem] overflow-hidden border border-slate-300 shadow-sm">
                  <Image src={member?.profileImageUrl || '/default-avatar.png'} alt="Profile" width={64} height={64} className="object-cover" />
                </div>
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-slate-900">Hey, {member?.name}</h2>
                  <p className="text-sm text-slate-600">Welcome back to GoCreate Nova</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Link href="/profile" className="px-3 py-1.5 bg-white/80 hover:bg-white rounded-[1rem] border border-slate-300 text-sm shadow-sm transition transform hover:scale-105 cursor-pointer">
                  View Profile
                </Link>
                <Link href="/groups" className="px-3 py-1.5 bg-white/80 hover:bg-white rounded-[1rem] border border-slate-300 text-sm shadow-sm transition transform hover:scale-105 cursor-pointer">
                  My Groups
                </Link>
              </div>
            </div>

            {/* Grid buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {options.map(({ icon: Icon, label, path, tintClass, hoverClass }, idx) => (
                <motion.button
                  key={idx}
                  whileHover={{ scale: 1.05 }}
                  onClick={() => router.push(path)}
                  className={`flex flex-col items-center gap-2 ${tintClass} bg-white/80 border border-slate-300 rounded-[1.5rem] min-h-[100px] px-4 py-3 shadow-sm justify-center transition ${hoverClass} hover:text-white cursor-pointer`}
                >
                  <Icon className="w-7 h-7" />
                  {label}
                </motion.button>
              ))}
            </div>

            {/* Sign out */}
            <motion.button
              whileHover={{ scale: 1.02 }}
              onClick={handleSignOut}
              className="w-full flex justify-center items-center gap-2 text-sm font-medium text-white bg-red-500/90 hover:bg-red-600 rounded-[1.5rem] py-3 shadow-sm transition mt-8 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              {sessionType === 'ClockIn' ? 'Clock Out' : 'Sign Out'}
            </motion.button>
          </>
        ) : (
          <div className="text-center space-y-3">
            <h2 className="text-xl md:text-2xl font-bold">Have a great day!</h2>
            <p className="text-xs text-slate-500">
              Returning to home screen in {goodbyeCountdown} second{goodbyeCountdown !== 1 && 's'}
            </p>
          </div>
        )}
      </motion.div>

    
    </div>
  );
}
