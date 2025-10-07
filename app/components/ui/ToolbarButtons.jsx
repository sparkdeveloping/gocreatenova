'use client';

import { Download, LayoutGrid, Table2 } from 'lucide-react';
import { exportRowsToCSV } from '@/app/utils/csv';

export function ExportCSVButton({ filename = 'users.csv', columns, rows }) {
  return (
    <button
      onClick={() => exportRowsToCSV(filename, columns, rows)}
      className="backdrop-blur-md bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-[1rem] p-2 shadow-sm"
      type="button"
      aria-label="Export CSV"
    >
      <Download className="w-5 h-5" />
    </button>
  );
}

export function ViewToggleButton({ viewMode, setViewMode }) {
  const next = viewMode === 'card' ? 'table' : 'card';
  return (
    <button
      onClick={() => setViewMode(next)}
      className="backdrop-blur-md bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-[1rem] p-2 shadow-sm"
      type="button"
      aria-label="Toggle view"
    >
      {viewMode === 'card' ? <Table2 className="w-5 h-5" /> : <LayoutGrid className="w-5 h-5" />}
    </button>
  );
}
