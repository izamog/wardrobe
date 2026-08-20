// eslint-config-expo already declares this as a Node global, so this repo's
// own lint is unaffected; the comment exists for Codacy's separate ESLint
// config, which does not.
// eslint-disable-next-line no-redeclare
/* global module */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo", "nativewind/babel"],
  };
};
