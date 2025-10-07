'use client';

import { motion } from 'framer-motion';

export default function CardShell({ children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className={`relative z-10 backdrop-blur-md bg-white/40 border-0 rounded-[2rem] shadow-xl w-full max-w-[1600px] mx-auto mt-16 mb-16 p-8 flex flex-col min-h-[calc(100vh-12rem)] ${className}`}
    >
      {children}
    </motion.div>
  );
}
