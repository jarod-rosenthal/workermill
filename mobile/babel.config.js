module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  // Only include reanimated plugin in non-test environments
  if (process.env.NODE_ENV !== 'test') {
    plugins.push('react-native-reanimated/plugin');
  }

  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel",
    ],
    plugins,
  };
};