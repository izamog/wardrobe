// eslint-config-expo already declares these as Node globals, so this repo's
// own lint is unaffected; the comment exists for Codacy's separate ESLint
// config, which does not.
// eslint-disable-next-line no-redeclare
/* global require, module, __dirname */
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: "./global.css" });
