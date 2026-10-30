/* global __dirname, require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Metro configuration is CommonJS. */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");
const config = getDefaultConfig(__dirname);
const root = path.resolve(__dirname, "../..");
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const previous = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
  new RegExp(`^${escape(root)}/(?:\\.local|\\.git|\\.superpowers|docs)(?:/|$)`),
  /\/apps\/mobile\/(?:ios\/Pods|ios\/build|android\/build|android\/\.gradle|android\/app\/build)(?:\/|$)/,
];
const resolve = config.resolver.resolveRequest;
// Desktop and mobile have different renderer versions. Every mobile dependency
// must use the mobile React instance, including hoisted native SDK components.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "react" || moduleName.startsWith("react/"))
    return {
      type: "sourceFile",
      filePath: require.resolve(moduleName, { paths: [__dirname] }),
    };
  return resolve
    ? resolve(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
