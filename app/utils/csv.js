// Client-only utility (used inside client components)
import { saveAs } from 'file-saver';

export function exportRowsToCSV(filename, columns, rows) {
  // Only include columns that are exportable (default true)
  const exportableCols = columns.filter((c) => c.exportable !== false);

  const header = exportableCols.map((c) => c.header);
  const dataRows = rows.map((row) =>
    exportableCols.map((c) => {
      if (typeof c.csvAccessor === 'function') return sanitize(c.csvAccessor(row));
      if (typeof c.accessor === 'function') return sanitize(c.accessor(row));
      if (c.key) return sanitize(row[c.key]);
      return '';
    })
  );

  const csv = [header, ...dataRows].map((r) => r.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  saveAs(blob, filename);
}

function csvEscape(value) {
  const v = value ?? '';
  const str = String(v);
  // Wrap in quotes if contains comma/quote/newline
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function sanitize(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toLocaleDateString();
  return v;
}
