/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo fingerprint configuration runs in Node. */
const { DEFAULT_SOURCE_SKIPS, SourceSkips } = require("expo/fingerprint");
module.exports = {
  // Extra only contains JavaScript configuration (API origin, OTA revision).
  // Native modules, config plugins, permissions, certificates and versions remain hashed.
  sourceSkips: DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigExtraSection,
  extraSources: [
    {
      type: "dir",
      filePath: "modules",
      reasons: ["CineGather native modules"],
    },
    {
      type: "dir",
      filePath: "plugins",
      reasons: ["CineGather native configuration"],
    },
    {
      type: "file",
      filePath: "resources/update-certificate.pem",
      reasons: ["Update trust root"],
    },
  ],
};
