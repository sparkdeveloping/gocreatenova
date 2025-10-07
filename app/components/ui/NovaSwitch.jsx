'use client';
import { motion } from 'framer-motion';

export default function NovaSwitch({
  checked,
  onChange,
  label,
  helper,              // optional help text on the right
  size = 'md',         // 'sm' | 'md' | 'lg'
  disabled = false,
}) {
  const dims = {
    sm: { track: 'w-10 h-5', knob: 'w-4 h-4', dx: 20 },
    md: { track: 'w-11 h-6', knob: 'w-5 h-5', dx: 22 },
    lg: { track: 'w-12 h-7', knob: 'w-6 h-6', dx: 24 },
  }[size];

  const toggle = () => !disabled && onChange?.(!checked);

  return (
    <div className="flex items-center justify-between gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
        }}
        className={[
          "group inline-flex items-center gap-3 cursor-pointer select-none focus:outline-none",
          disabled && "opacity-60 cursor-not-allowed",
        ].join(' ')}
      >
        <span className="text-sm">{label}</span>

        <span
          className={[
            "relative rounded-full transition-colors shadow-inner",
            "backdrop-blur-sm bg-gray-300/90",
            checked && "bg-blue-500/90",
            dims.track,
            "ring-0 group-focus-visible:ring-2 ring-blue-400"
          ].join(' ')}
        >
          <motion.span
            layout
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            className={[
              "absolute top-0.5 left-0.5 rounded-full bg-white shadow",
              dims.knob
            ].join(' ')}
            style={{ transform: checked ? `translateX(${dims.dx}px)` : 'translateX(0px)' }}
          />
        </span>
      </button>

      {helper && (
        <span className="text-xs text-gray-600">{helper}</span>
      )}
    </div>
  );
}
