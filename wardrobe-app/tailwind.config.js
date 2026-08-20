/** @type {import('tailwindcss').Config} */
// eslint-config-expo already declares these as Node globals, so this repo's
// own lint is unaffected; the comment exists for Codacy's separate ESLint
// config, which does not.
// eslint-disable-next-line no-redeclare
/* global module, require */
module.exports = {
  // Every directory holding a className must be listed here — a file outside
  // these globs renders with its styles silently missing, not with an error.
  content: [
    "./App.tsx",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./navigation/**/*.{js,jsx,ts,tsx}",
    "./screens/**/*.{js,jsx,ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  theme: { extend: {} },
  plugins: [],
};
