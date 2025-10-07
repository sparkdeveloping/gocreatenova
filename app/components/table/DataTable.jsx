'use client';

import { motion } from 'framer-motion';

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.1 } },
};

const rowVar = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0 },
};

export default function DataTable({
  columns = [],     // [{ key, header, accessor(row) | render(row), className, thClassName, exportable }]
  rows = [],
  onRowClick,       // (row, event) => void
  rowKey = (r) => r.id || r.badgeId || r.email || JSON.stringify(r),
  tableClass = 'w-full text-sm text-left text-gray-800',
}) {
  return (
    <div className="backdrop-blur-md bg-white/50 border-0 rounded-[2rem] shadow-lg shadow-gray-200/70 overflow-x-auto p-4">
      <table className={tableClass}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.header} className={`px-2 py-1 ${c.thClassName || ''}`}>
                {c.header}
              </th>
            ))}
            
          </tr>
        </thead>

        <motion.tbody variants={container} initial="hidden" animate="visible">
          {rows.map((row) => (
            <motion.tr
              key={rowKey(row)}
              variants={rowVar}
              whileHover={{ scale: 1.01 }}
              className="cursor-pointer bg-gray-50 hover:bg-gray-100 rounded-xl shadow-sm hover:shadow-md transition-all"
              onClick={(e) => {
                // Prevent row open if clicking on interactive child
                const tag = e.target.tagName?.toLowerCase();
                if (['button', 'svg', 'path', 'a', 'input'].includes(tag)) return;
                onRowClick && onRowClick(row, e);
              }}
            >
              {columns.map((c) => (
                <td key={c.header} className={`px-2 py-1 ${c.className || ''}`}>
                  {c.render
                    ? c.render(row)
                    : typeof c.accessor === 'function'
                    ? c.accessor(row)
                    : c.key
                    ? safe(row[c.key])
                    : ''}
                </td>
              ))}

              {/* Actions column is expected to be appended by caller as last column via c.render,
                  but to keep API simple we reserve a final cell and let caller pass actionsRenderer */}
              {/** If you want to pass actions per row, provide a column with header 'Actions' and render; 
               * here we add a placeholder to maintain layout if not provided.
               */}
            </motion.tr>
          ))}
        </motion.tbody>
      </table>
    </div>
  );
}

function safe(v) {
  if (v == null) return 'N/A';
  return String(v);
}
