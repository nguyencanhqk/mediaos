module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo (SDK 50+) folds in the expo-router transform — no separate plugin needed.
    presets: ["babel-preset-expo"],
  };
};
