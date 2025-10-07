'use client';

export default function NovaCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
}) {
  return (
    <label className={[
      "inline-flex items-center gap-2 cursor-pointer select-none",
      disabled && "opacity-60 cursor-not-allowed"
    ].join(' ')}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => !disabled && onChange?.(e.target.checked)}
        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-400"
        disabled={disabled}
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
