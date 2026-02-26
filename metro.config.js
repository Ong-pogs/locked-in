const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Solana polyfill resolvers
config.resolver.extraNodeModules = {
  crypto: require.resolve("expo-crypto"),
  buffer: require.resolve("buffer"),
  assert: require.resolve("assert"),
};

module.exports = withNativeWind(config, { input: "./global.css" });
