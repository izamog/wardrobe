// Flat config. eslint-config-expo brings the TypeScript parser, React and
// React Hooks rules, and the React Native globals.
//
// eslint-config-expo already declares these as Node globals, so this repo's
// own lint is unaffected; the comment below exists for Codacy's separate
// ESLint config, which does not.
// eslint-disable-next-line no-redeclare
/* global require, module */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', '.expo-export/*', 'expo-env.d.ts'],
  },
  // Complexity, read from the real TypeScript/JSX AST rather than Lizard's
  // line-based parser, which repeatedly misattributes function boundaries in
  // this codebase's generics- and JSX-heavy style (verified against several
  // files where it counted imported calls, ternaries and even `return`
  // statements as function definitions). Warnings only, so a new finding
  // doesn't fail `npm run lint` outright — Codacy still surfaces it.
  {
    rules: {
      complexity: ['warn', 10],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
    },
  },
]);
