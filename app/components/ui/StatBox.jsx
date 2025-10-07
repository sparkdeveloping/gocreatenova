'use client';

export default function StatBox({ label, count }) {
  return (
    <div>
      <div className="text-2xl font-bold text-black">{count}</div>
      <div className="text-sm text-gray-800">{label}</div>
    </div>
  );
}
