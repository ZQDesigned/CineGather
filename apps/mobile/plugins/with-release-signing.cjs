/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins run in Node. */
const { withAppBuildGradle } = require("expo/config-plugins");
module.exports = (config) =>
  withAppBuildGradle(config, (mod) => {
    let source = mod.modResults.contents;
    const marker = "// CineGather release signing";
    if (!source.includes(marker)) {
      source = source.replace(
        "signingConfigs {",
        `signingConfigs {
        ${marker}
        cinegatherRelease {
            def keyPath = System.getenv("CINEGATHER_ANDROID_KEYSTORE")
            if (keyPath) {
                storeFile file(keyPath)
                storePassword System.getenv("CINEGATHER_ANDROID_STORE_PASSWORD")
                keyAlias System.getenv("CINEGATHER_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("CINEGATHER_ANDROID_KEY_PASSWORD")
            }
        }`,
      );
      const start = source.indexOf("release {");
      if (start < 0) throw new Error("Expo release build type not found");
      const before = source.slice(0, start),
        after = source
          .slice(start)
          .replace(
            "signingConfig signingConfigs.debug",
            "signingConfig signingConfigs.cinegatherRelease",
          );
      source = before + after;
      source += `
// Never silently sign a distributed APK with the generated development key.
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.project == project && it.name.toLowerCase().contains("release") }) {
        for (key in ["CINEGATHER_ANDROID_KEYSTORE", "CINEGATHER_ANDROID_STORE_PASSWORD", "CINEGATHER_ANDROID_KEY_ALIAS", "CINEGATHER_ANDROID_KEY_PASSWORD"]) {
            if (!System.getenv(key)) throw new GradleException("Missing private release signing environment: " + key)
        }
    }
}
`;
    }
    mod.modResults.contents = source;
    return mod;
  });
