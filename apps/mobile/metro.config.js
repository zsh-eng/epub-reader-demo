const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const config = getDefaultConfig(__dirname);
const nativeReact = path.dirname(require.resolve("react/package.json"));

// The website uses a newer React patch. Every native dependency must resolve
// to the React version that matches this Expo SDK's React Native renderer.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/")) {
    return context.resolveRequest(
      context,
      moduleName === "react"
        ? nativeReact
        : path.join(nativeReact, moduleName.slice("react/".length)),
      platform,
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
