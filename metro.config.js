const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Solana polyfill resolvers
config.resolver.extraNodeModules = {
  crypto: require.resolve("expo-crypto"),
  buffer: require.resolve("buffer"),
  assert: require.resolve("assert"),
};

// Allow .html and 3D assets (for the dungeon web component)
const assetExts = [
  ...config.resolver.assetExts,
  "html",
  "glb",
  "gltf",
  "bin",
  "obj",
  "mtl",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "wav",
  "mp3",
];
config.resolver.assetExts = assetExts;

module.exports = withNativeWind(config, { input: "./global.css" });


