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
  theme: {
    extend: {
      // Locked design system — see design.md at the project root. Every
      // screen reaches for these named colors/fonts rather than Tailwind's
      // default slate/emerald/rose palette or an inline hex value, so the
      // system stays in one place instead of drifting screen by screen.
      colors: {
        // White, not the original grey `#F7F7F7` — see design.md § Amendments
        // round 11. The header, tab bar and every BottomBar footer share this
        // token (design.md § Chrome), so the one change here is what makes
        // top/bottom chrome white app-wide; item photos keep their own grey
        // gradient backdrop, which was never this token to begin with (see
        // § Item grid rows).
        paper: "#FFFFFF",
        "paper-2": "#EFEFEF",
        ink: "#1A1714",
        "ink-muted": "#6B6259",
        rule: "#DEDEDE",
        // Aliased to `ink`/`ink-muted` rather than a distinct hue — see
        // design.md § Amendments round 11. The palette is neutral by
        // request (nothing should visually compete with a photographed
        // garment's own colour), so "accent" no longer means a separate
        // colour, just where `ink` gets used for the single most prominent
        // action or selected state on a screen. Kept as its own token,
        // not collapsed into `ink` at every call site, so a future
        // amendment is still the one-place change design.md's round 2
        // established this token for.
        accent: "#1A1714",
        "accent-muted": "#6B6259",
        // Positive/"match" verdicts only (components/ItemGrid.tsx's Badge) —
        // deliberately not the brand accent, which also means "primary
        // action" everywhere else in the app: reusing it for "this pairing
        // is correct" made a correct verdict read as just another neutral
        // button rather than a clear positive signal against the red
        // "dismatch" badge. See design.md § Theme.
        success: "#2E6E49",
      },
      // Per-role type system — see design.md § Typography for the full
      // role → weight mapping this mirrors exactly. Every custom font here
      // is its own distinct named font file (expo-google-fonts ships one
      // family per weight, not a single variable font), so Tailwind's
      // generic font-weight utilities (font-medium, font-semibold, …) do
      // nothing once one of these is applied — reach for the named token
      // for the actual weight, not a weight utility alongside it.
      fontFamily: {
        // Playfair Display 400 — screen titles only (the nav header; see
        // navigation/RootNavigator.tsx, which sets this by raw fontFamily
        // string since header options aren't styled through a className).
        title: ["PlayfairDisplay_400Regular"],
        // Public Sans 300 — an item's own brand name only (ItemGridRow's
        // label band). Public Sans ships no 330 weight as a static file
        // (only 100/200/300/…/900), so 300 is the nearest available. Same
        // font file as `sans-light` below — kept as a separate token because
        // this one name is reserved for the brand-name role specifically,
        // not "whatever happens to be 300 weight."
        brand: ["PublicSans_300Light"],
        // Public Sans 300 — big statistics numbers (a forecast temperature,
        // a cost-per-wear figure) at their normal size; bumped to `sans`
        // (400) only above the large-size threshold (see design.md).
        "sans-light": ["PublicSans_300Light"],
        // Public Sans 400 — the default body/UI weight: category tabs, list
        // row labels, tab bar labels, item metadata, body copy, and large
        // (above-threshold) statistic numbers.
        sans: ["PublicSans_400Regular"],
        // Public Sans 500 — "Wearing today", list row values, month title,
        // days-of-week, buttons/CTAs.
        "sans-medium": ["PublicSans_500Medium"],
        // Public Sans 600 — emphasis: prices, counts.
        "sans-semibold": ["PublicSans_600SemiBold"],
      },
    },
  },
  plugins: [],
};
