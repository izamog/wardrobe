// Flat config. eslint-config-expo brings the TypeScript parser, React and
// React Hooks rules, and the React Native globals.
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', '.expo-export/*', 'expo-env.d.ts'],
  },
]);
