
'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Sun, Clock, Calendar, MapPin, ImageIcon, ArrowLeft } from 'lucide-react';

export default function CornerUtilities() {
  const router = useRouter();
  const pathname = usePathname();
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options = { weekday: 'long', month: 'long', day: 'numeric' };
      setCurrentDate(now.toLocaleDateString(undefined, options));
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const showBackButton = pathname !== '/' && pathname !== '/dashboard';

  return (
    <>
        {/* Background blobs */}
      <div className="absolute w-[700px] h-[700px] bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse -top-40 -left-40"></div>
      <div className="absolute w-[600px] h-[600px] bg-blue-300 rounded-full mix-blend-multiply filter blur-2xl opacity-30 animate-pulse top-60 right-20"></div>

      {/* Top left: Weather + Back button if needed */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        {showBackButton && (
          <button
            onClick={() => router.back()}
            className="backdrop-blur-md bg-white/60 border border-slate-200 rounded-xl p-2 shadow-sm hover:bg-white/70 transition"
          >
            <ArrowLeft className="w-5 h-5 text-slate-700" />
          </button>
        )}
        <div className="backdrop-blur-md bg-white/60 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 text-base text-slate-700 shadow-sm">
          <Sun className="w-5 h-5" />
          Sunny • 88°F
        </div>
      </div>

      {/* Top right: Date + Time */}
      <div className="absolute top-4 right-4 backdrop-blur-md bg-white/60 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-3 text-base text-slate-700 shadow-sm">
        <Calendar className="w-4 h-4" />
        {currentDate}
        <Clock className="w-4 h-4 ml-3" />
        {currentTime}
      </div>

      {/* Bottom left: Gallery */}
      <Link
        href="/gallery"
        className="absolute bottom-4 left-4 backdrop-blur-md bg-white/60 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 text-sm text-slate-700 hover:bg-white/70 shadow-sm transition"
      >
        <ImageIcon className="w-4 h-4" />
        Gallery
      </Link>

      {/* Bottom right: Map */}
      <Link
        href="/map"
        className="absolute bottom-4 right-4 backdrop-blur-md bg-white/60 border border-slate-200 rounded-xl px-3 py-2 flex items-center gap-2 text-sm text-slate-700 hover:bg-white/70 shadow-sm transition"
      >
        <MapPin className="w-4 h-4" />
        Map
      </Link>

      {/* Bottom center: Logo */}
      <div className="absolute bottom-4 inset-x-0 flex justify-center">
        <Image src="/logo.svg" alt="GoCreate Nova Logo" width={120} height={40} className="opacity-80" />
      </div>
    </>
  );
}
