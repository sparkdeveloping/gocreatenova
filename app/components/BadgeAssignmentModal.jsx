'use client';

import { useRef, useState, useEffect, useMemo } from 'react';
import Webcam from 'react-webcam';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getFirestore, doc, updateDoc } from 'firebase/firestore';
import { getStorage, ref as storageRef, uploadString, getDownloadURL } from 'firebase/storage';
import { app } from '../lib/firebase';

export default function BadgeAssignmentModal({ user, onClose }) {
  if (!user) return null;

  // Firebase
  const db = useMemo(() => getFirestore(app), []);
  const storage = useMemo(() => getStorage(app), []);
  const webcamRef = useRef(null);

  // UI
  const [step, setStep] = useState(1);            // 1=capture+inputs, 2=confirm, 3=preview/print
  const [useUpload, setUseUpload] = useState(false);
  const [existingMode, setExistingMode] = useState(false); // viewing an existing badge

  // Badge state
  const [photo, setPhoto] = useState(null); // data URL or https URL
  const [badgeId, setBadgeId] = useState(user?.badge?.id || '');
  const [doorNumber, setDoorNumber] = useState(user?.badge?.doorNumber || '');
  const [sinceYear, setSinceYear] = useState(new Date().getFullYear());

  // --------- derived role (no selector) ----------
  const role = useMemo(() => {
    const arr = Array.isArray(user?.roles) ? user.roles.map(r => String(r).toLowerCase()) : [];
    if (arr.some(r => r.includes('staff'))) return 'Staff';
    if (arr.some(r => r.includes('mentor'))) return 'Mentor';
    if (arr.some(r => r.includes('student tech') || r.includes('studenttech'))) return 'Student Tech';
    return 'Member';
  }, [user?.roles]);

  // If a badge already exists, jump to preview
  useEffect(() => {
    const hasExisting = !!user?.badge?.id;
    if (hasExisting) {
      setExistingMode(true);
      setStep(3);
      setBadgeId(user.badge.id || '');
      setDoorNumber(user.badge.doorNumber || '');
      if (user.badge.photoURL) setPhoto(user.badge.photoURL);
    }
  }, [user]);

  // Derive "Since" year (and backfill creationTimestamp if missing)
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ts =
          typeof user?.creationTimestamp === 'number'
            ? user.creationTimestamp
            : user?.creationTimestamp?.seconds;

        if (ts) {
          if (mounted) setSinceYear(new Date(ts * 1000).getFullYear());
        } else {
          const nowSec = Math.floor(Date.now() / 1000);
          await updateDoc(doc(db, 'users', user.id), { creationTimestamp: nowSec });
          if (mounted) setSinceYear(new Date(nowSec * 1000).getFullYear());
        }
      } catch {
        if (mounted) setSinceYear(new Date().getFullYear());
      }
    })();
    return () => { mounted = false; };
  }, [db, user]);

  // Animations
  const panel = {
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: 'easeOut' } },
    exit:    { opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.20, ease: 'easeIn' } },
  };

  // Capture / Upload
  const capturePhoto = () => {
    const img = webcamRef.current?.getScreenshot();
    if (!img) return;
    setPhoto(img);
    setStep(2);
  };

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      setPhoto(reader.result);
      setStep(2);
    };
    reader.readAsDataURL(file);
  };

  // Upload the photo if it's a data URL; return an https URL (or null if none)
  const uploadPhotoIfNeeded = async () => {
    if (!photo) return null;
    if (/^https?:\/\//i.test(photo)) return photo; // already hosted
    const path = `badges/${user.id}_${Date.now()}.jpg`;
    const ref = storageRef(storage, path);
    await uploadString(ref, photo, 'data_url');
    const url = await getDownloadURL(ref);
    return url;
  };

  // Persist/override badge object
  const assignBadge = async () => {
    const photoURL = await uploadPhotoIfNeeded();
    const payload = {
      id: badgeId,
      doorNumber,
      ...(photoURL ? { photoURL } : {}),
    };
    // override old object in one write
    await updateDoc(doc(db, 'users', user.id), { badge: payload });
    if (photoURL) setPhoto(photoURL);
    setExistingMode(true);
    setStep(3);
  };

  const handleAssignOnly = async () => {
    await assignBadge();
    onClose?.();
  };

  const handleAssignAndPrint = async () => {
    await assignBadge();
    const closeAfterPrint = () => {
      onClose?.();
      window.removeEventListener('afterprint', closeAfterPrint);
    };
    window.addEventListener('afterprint', closeAfterPrint);
    window.print();
    // fallback (Safari sometimes misses afterprint)
    setTimeout(closeAfterPrint, 1400);
  };

  // Role → background
  const cardBg = useMemo(() => {
    switch (role) {
      case 'Student Tech': return '/background_blue.svg';
      case 'Mentor':       return '/background_gray.svg';
      case 'Member':       return '/background_yellow.svg';
      case 'Staff':        return '/background.svg';
      default:             return '/background.svg';
    }
  }, [role]);

  // Shared radii
  const FRAME_RADIUS = 18;
  const MINI_RADIUS  = 14;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'transparent', backdropFilter: 'blur(8px) saturate(115%)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <motion.div
        key="modal"
        initial={{ opacity: 0, scale: 0.98, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: 0.25 } }}
        exit={{ opacity: 0, scale: 0.98, y: 20 }}
        className="relative w-[92vw] max-w-[600px]"
      >
        {/* Major card */}
        <div
          className="rounded-[28px] p-6"
          style={{
            background: 'rgba(255,255,255,0.8)',
            border: '1px solid rgba(255,255,255,0.55)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.6)',
            color: '#111',
          }}
        >
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Badge Preview</h2>
            <button
              aria-label="Close"
              onClick={onClose}
              className="rounded-full no-print"
              style={{
                width: 36, height: 36, background: 'rgba(255,255,255,0.9)',
                display: 'grid', placeItems: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
              }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Steps */}
          <AnimatePresence mode="wait">
            {/* STEP 1 — capture + inputs */}
            {step === 1 && (
              <motion.div key="step1" {...panel} className="space-y-5">
                <div className="flex gap-2">
                  <button
                    onClick={() => setUseUpload(false)}
                    className="rounded-full px-4 py-2 font-medium text-white"
                    style={{ background: useUpload ? 'gray' : 'blue' }}
                  >
                    Use Webcam
                  </button>
                  <label
                    className="cursor-pointer rounded-full px-4 py-2 font-medium text-white"
                    style={{ background: useUpload ? 'blue' : 'gray' }}
                  >
                    Upload Photo
                    <input type="file" accept="image/*" onChange={onUpload} className="hidden" />
                  </label>
                </div>

                {/* CR80 scaffold */}
                <div
                  className="mx-auto relative rounded-[16px] overflow-hidden"
                  style={{
                    width: '2.125in',
                    height: '3.370in',
                    backgroundImage: `url(${cardBg})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    boxShadow: '0 14px 34px rgba(0,0,0,0.18)',
                    padding: '0.33in 0.2in 0.22in 0.25in',
                  }}
                >
                  {/* Rounded photo frame (fill) */}
                  <div
                    style={{
                      width: '1.35in',
                      height: '1.35in',
                      borderRadius: `${FRAME_RADIUS}px`,
                      border: '6px solid #fff',
                      overflow: 'hidden',
                      boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
                      marginLeft: '-0.12in',
                      marginTop: '-0.12in',
                      background: 'rgba(0,0,0,0.06)',
                    }}
                  >
                    {!useUpload ? (
                      <Webcam
                        ref={webcamRef}
                        audio={false}
                        screenshotFormat="image/jpeg"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
                        videoConstraints={{ facingMode: 'user' }}
                      />
                    ) : photo ? (
                      <img
                        src={photo}
                        alt="Uploaded"
                        draggable={false}
                        className="block"
                        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center text-sm">Choose a photo…</div>
                    )}
                  </div>

                  {!useUpload && (
                    <div style={{ marginTop: '0.18in' }}>
                      <button
                        onClick={capturePhoto}
                        className="rounded-xl px-4 py-2 font-semibold text-white"
                        style={{ background: 'blue' }}
                      >
                        Take Photo
                      </button>
                    </div>
                  )}

                  {/* Text block */}
                  <div className="leading-tight" style={{ marginTop: '0.16in', fontSize: '15px' }}>
                    <div className="font-bold" style={{ fontSize: '19px' }}>
                      {user.fullName || user.name || 'Name Here'}
                    </div>
                    <div
                      className="mt-1 rounded-full"
                      style={{
                        height: '4px', width: '1.15in',
                        background:
                          role === 'Student Tech' ? '#0499DB'
                          : role === 'Member' ? '#F7C948'
                          : role === 'Mentor' ? '#A0A0A0'
                          : '#000',
                      }}
                    />
                    <div className="mt-1 uppercase font-semibold">{role}</div>
                    <div className="mt-[2px]" style={{ fontSize: '12px', opacity: 0.8 }}>Since {sinceYear}</div>
                  </div>

                  {/* Logo */}
                  <img src="/Logo.svg" alt="GoCreate" style={{ position: 'absolute', right: '0.2in', bottom: '0.2in', height: 32, width: 'auto' }} />
                </div>

                {/* Inputs */}
                <div className="space-y-3">
                  <input
                    value={badgeId}
                    onChange={(e) => setBadgeId(e.target.value)}
                    placeholder="Scan Badge ID"
                    className="w-full rounded-xl px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.92)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}
                  />
                  <input
                    value={doorNumber}
                    onChange={(e) => setDoorNumber(e.target.value)}
                    placeholder="Enter Door Number"
                    className="w-full rounded-xl px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.92)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.06)' }}
                  />
                </div>

                {/* Nav */}
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setStep(2)}
                    disabled={!badgeId || !doorNumber || !photo}
                    className="rounded-full px-4 py-2 font-semibold text-white"
                    style={{ background: 'blue', opacity: !badgeId || !doorNumber || !photo ? 0.5 : 1 }}
                  >
                    Next
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 2 — confirm */}
            {step === 2 && (
              <motion.div key="step2" {...panel} className="space-y-5">
                <div
                  className="grid grid-cols-5 gap-4 rounded-2xl p-4"
                  style={{ background: 'rgba(255,255,255,0.85)', boxShadow: '0 10px 24px rgba(0,0,0,0.12)' }}
                >
                  {/* Mini card thumb */}
                  <div className="col-span-2 flex items-start justify-center">
                    <div
                      className="relative overflow-hidden rounded-xl"
                      style={{
                        width: '1.3in',
                        height: '2.06in',
                        backgroundImage: `url(${cardBg})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        padding: '0.2in 0.12in 0.12in 0.15in',
                        boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
                      }}
                    >
                      <div
                        style={{
                          width: '0.82in',
                          height: '0.82in',
                          borderRadius: `${MINI_RADIUS}px`,
                          border: '4px solid #fff',
                          overflow: 'hidden',
                          boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
                          marginLeft: '-0.08in',
                          marginTop: '-0.08in',
                          background: 'rgba(0,0,0,0.06)',
                        }}
                      >
                        {photo && (
                          <img
                            src={photo}
                            alt="Captured"
                            draggable={false}
                            className="block"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Details */}
                  <div className="col-span-3 space-y-1">
                    <div className="text-base font-semibold">{user.fullName || user.name}</div>
                    <div className="uppercase text-sm">{role}</div>
                    <div className="mt-2 text-sm"><span style={{ opacity: 0.7 }}>Badge ID:</span> {badgeId || '—'}</div>
                    <div className="text-sm"><span style={{ opacity: 0.7 }}>Door #:</span> {doorNumber || '—'}</div>
                    <div className="mt-1 text-sm" style={{ opacity: 0.75 }}>
                      The “Since” year on the card will be <span style={{ opacity: 1 }}>{sinceYear}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between">
                  <button onClick={() => setStep(1)} className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: 'gray' }}>
                    Back
                  </button>
                  <button onClick={() => setStep(3)} className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: 'blue' }}>
                    Next
                  </button>
                </div>
              </motion.div>
            )}

            {/* STEP 3 — full preview / print */}
            {step === 3 && (
              <motion.div key="step3" {...panel} className="space-y-5">
                <div className="flex w-full justify-center">
                  <div id="print-root">
                    <div
                      className="relative rounded-[16px] print-card"
                      style={{
                        width: '2.125in',
                        height: '3.370in',
                        backgroundImage: `url(${cardBg})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        boxShadow: '0 18px 36px rgba(0,0,0,0.18)',
                        padding: '0.33in 0.2in 0.22in 0.25in',
                      }}
                    >
                      {/* Rounded photo frame */}
                      <div
                        style={{
                          width: '1.35in',
                          height: '1.35in',
                          borderRadius: `${FRAME_RADIUS}px`,
                          border: '6px solid #fff',
                          overflow: 'hidden',
                          boxShadow: '0 8px 18px rgba(0,0,0,0.18)',
                          marginLeft: '-0.12in',
                          marginTop: '-0.12in',
                          background: 'rgba(0,0,0,0.06)',
                        }}
                      >
                        {photo && (
                          <img
                            src={photo}
                            alt="Captured"
                            draggable={false}
                            className="block"
                            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
                          />
                        )}
                      </div>

                      {/* Text content */}
                      <div className="leading-tight" style={{ marginTop: '0.14in', fontSize: '15px' }}>
                        <div className="font-bold" style={{ fontSize: '19px' }}>
                          {user.fullName || user.name || 'Name Here'}
                        </div>
                        <div
                          className="mt-1 rounded-full"
                          style={{
                            height: '4px', width: '1.15in',
                            background:
                              role === 'Student Tech' ? '#0499DB'
                              : role === 'Member' ? '#F7C948'
                              : role === 'Mentor' ? '#A0A0A0'
                              : '#000',
                          }}
                        />
                        <div className="mt-1 uppercase font-semibold">{role}</div>
                        <div className="mt-[2px]" style={{ fontSize: '12px', opacity: 0.8 }}>
                          Since {sinceYear}
                        </div>
                      </div>

                      <img src="/Logo.svg" alt="GoCreate" style={{ position: 'absolute', right: '0.2in', bottom: '0.2in', height: 32, width: 'auto' }} />
                    </div>
                  </div>
                </div>

                {/* Actions */}
                {existingMode ? (
                  <div className="no-print flex justify-between">
                    <button onClick={onClose} className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: 'gray' }}>
                      Close
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setTimeout(() => window.print(), 100)}
                        className="rounded-full px-4 py-2 font-semibold text-white"
                        style={{ background: 'green' }}
                      >
                        Reprint
                      </button>
                      <button
                        onClick={() => { setExistingMode(false); setUseUpload(false); setStep(1); }}
                        className="rounded-full px-4 py-2 font-semibold text-white"
                        style={{ background: 'blue' }}
                      >
                        New Badge
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="no-print flex justify-between">
                    <button onClick={() => setStep(2)} className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: 'gray' }}>
                      Back
                    </button>
                    <div className="flex gap-2">
                      <button onClick={handleAssignAndPrint} className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: 'green' }}>
                        Assign & Print
                      </button>
                      <button onClick={handleAssignOnly} className="rounded-full px-4 py-2 font-semibold text-white" style={{ background: 'blue' }}>
                        Assign Only
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Print rules (card only) */}
        <style jsx global>{`
          @media print {
            @page { size: 2.125in 3.370in; margin: 0; }
            html, body {
              margin: 0; padding: 0; height: 100%; width: 100%;
              display: flex; justify-content: center; align-items: center;
              overflow: hidden; -webkit-print-color-adjust: exact; print-color-adjust: exact;
              background: #fff !important;
            }
            .no-print { display: none !important; }
            body * { visibility: hidden !important; }
            #print-root, #print-root * { visibility: visible !important; }
            #print-root {
              position: fixed; inset: 0; margin: auto;
              width: 2.125in !important; height: 3.370in !important;
            }
            #print-root .print-card {
              width: 2.125in !important; height: 3.370in !important;
              box-shadow: none !important; border: none !important;
            }
          }
        `}</style>
      </motion.div>
    </div>
  );
}
