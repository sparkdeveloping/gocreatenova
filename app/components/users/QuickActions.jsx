'use client';

import { Calendar, DollarSign, ScanLine } from 'lucide-react';

export default function QuickActions({ onBadgeClick, onReserveClick, onPayClick }) {
  const pill =
    'rounded-full px-3 py-1 text-sm font-medium flex items-center gap-1 shadow-sm transition hover:scale-105';

  return (
    <div className="flex flex-wrap gap-2">
      <button
        className={`${pill} bg-purple-100 hover:bg-purple-200 text-purple-600`}
        onClick={(e) => {
          e.stopPropagation();
          onBadgeClick && onBadgeClick(e);
        }}
        type="button"
      >
        <ScanLine className="w-4 h-4" />
        Badge
      </button>

      <button
        className={`${pill} bg-green-100 hover:bg-green-200 text-green-600`}
        onClick={(e) => {
          e.stopPropagation();
          onReserveClick && onReserveClick(e);
        }}
        type="button"
      >
        <Calendar className="w-4 h-4" />
        Reserve
      </button>

      <button
        className={`${pill} bg-blue-100 hover:bg-blue-200 text-blue-600`}
        onClick={(e) => {
          e.stopPropagation();
          onPayClick && onPayClick(e);
        }}
        type="button"
      >
        <DollarSign className="w-4 h-4" />
        Pay
      </button>
    </div>
  );
}
