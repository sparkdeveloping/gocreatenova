const colors = require("tailwindcss/colors");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],

  safelist: [
    "bg-blue-500",
    "bg-green-500",
    "bg-purple-500",
    "bg-slate-900",
    "bg-gradient-to-b",
    "from-blue-500",
    "to-blue-600",
    "hover:from-blue-500",
    "hover:to-blue-700",
  ],

  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#2563eb", // Blue-600
          light: "#3b82f6",   // Blue-500
          dark: "#1d4ed8",    // Blue-700
        },
        secondary: {
          DEFAULT: "#a855f7", // Purple-500
          dark: "#7e22ce",    // Purple-700
        },
        accent: {
          DEFAULT: "#22c55e", // Green-500
          dark: "#16a34a",    // Green-600
        },
        neutral: {
          DEFAULT: "#0f172a", // Slate-900
          light: "#1e293b",   // Slate-700
        },
        danger: {
          DEFAULT: "#ef4444", // Red-500
          dark: "#dc2626",    // Red-600
        },
      },
    },
  },

  plugins: [require("daisyui")],

  daisyui: {
    themes: [
      {
        light: {
          /* Base theme values (manually defined, v4-safe) */
          "base-100": "#ffffff",
          "base-200": "#f2f2f2",
          "base-300": "#e5e6e6",
          "base-content": "#1f2937",

          /* Primary */
          primary: colors.blue[600],
          "primary-focus": colors.blue[700],
          "primary-content": "#ffffff",

          /* Secondary */
          secondary: colors.purple[500],
          "secondary-focus": colors.purple[700],
          "secondary-content": "#ffffff",

          /* Accent */
          accent: colors.green[500],
          "accent-focus": colors.green[600],
          "accent-content": "#ffffff",

          /* Neutral */
          neutral: colors.slate[900],
          "neutral-focus": colors.slate[800],
          "neutral-content": "#ffffff",

          /* Status colors */
          info: colors.sky[500],
          success: colors.green[500],
          warning: colors.amber[500],
          error: colors.red[500],
        },
      },
    ],
  },
};
