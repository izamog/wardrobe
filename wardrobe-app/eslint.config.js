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
]);
