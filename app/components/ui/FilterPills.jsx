'use client';

import { AnimatePresence, motion } from 'framer-motion';

export default function FilterPills({
  options = [],       // [{ value: 'all', label: 'All' }, ...]
  value,
  onChange,
  className = '',
  size = 'sm',
}) {
  const base =
    size === 'sm'
      ? 'text-sm rounded-full px-3 py-1 shadow-sm'
      : 'text-base rounded-full px-4 py-2 shadow-sm';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        className={`flex flex-wrap gap-2 ${className}`}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`${base} ${
              value === opt.value
                ? 'bg-blue-500 hover:bg-blue-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-800'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </motion.div>
    </AnimatePresence>
  );
}
