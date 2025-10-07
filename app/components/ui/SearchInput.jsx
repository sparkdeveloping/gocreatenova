'use client';

import { Search } from 'lucide-react';

export default function SearchInput({ value, onChange, placeholder = 'Search...' }) {
  return (
    <div className="relative w-full max-w-xs">
      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#94a3b8]" />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-8 pr-3 py-0.5 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm w-full h-9"
      />
    </div>
  );
}
