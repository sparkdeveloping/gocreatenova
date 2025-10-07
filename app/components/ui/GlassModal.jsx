'use client';

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';


export default function GlassModal({
  open = true,
  onClose,
  children,
  size = 'md',    // <-- default narrower than before
  title,
  showClose = true,
}) {
  const maxW = {
    xs: 'max-w-[24rem]', // 384px
    sm: 'max-w-[32rem]', // 512px
    md: 'max-w-[40rem]', // 640px
    lg: 'max-w-[48rem]', // 768px
    xl: 'max-w-[56rem]', // 896px
  }[size] || 'max-w-[40rem]';

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 sm:p-6"
          style={{ backdropFilter: 'blur(8px)' }}
          onMouseDown={() => onClose?.()}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 40 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={`relative w-full ${maxW} bg-white rounded-[2rem] shadow-2xl
                        p-6 sm:p-8 max-h-[85vh] overflow-y-auto overscroll-contain`}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {showClose && (
              <button
                className="absolute top-4 right-4 text-[#94a3b8] hover:text-neutral transition"
                onClick={() => onClose?.()}
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </button>
            )}
            {title && <h3 className="text-xl font-semibold mb-4 pr-10">{title}</h3>}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
