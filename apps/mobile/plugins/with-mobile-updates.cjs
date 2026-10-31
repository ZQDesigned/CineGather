/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins run in Node. */
const { withAppBuildGradle } = require("expo/config-plugins");
module.exports = (config) =>
  withAppBuildGradle(config, (mod) => {
    const marker = "// CineGather fresh OTA compatibility resources";
    if (!mod.modResults.contents.includes(marker))
      mod.modResults.contents += `
${marker}
// SDK 57's resource task declares paths but no fingerprint file inputs.
// Always resolve it: stale cached native fingerprints reject compatible OTA.
tasks.configureEach { task ->
    if (task.name.startsWith("create") && task.name.endsWith("UpdatesResources")) {
        task.outputs.upToDateWhen { false }
    }
    if (task.name.startsWith("createBundle") && task.name.endsWith("JsAndAssets")) {
        task.inputs.files(file("../../app.config.ts"), file("../../mobile-release.json"))
        for (name in ["CG_MOBILE_UPDATE_ORIGIN", "EXPO_PUBLIC_API_ORIGIN", "CG_MOBILE_CHANNEL", "CG_MOBILE_REVISION", "CG_MOBILE_VERSION"]) {
            task.inputs.property("cinegather." + name, System.getenv(name) ?: "")
        }
    }
}
gradle.projectsEvaluated {
    rootProject.allprojects { p ->
        p.tasks.matching { it.name == "createExpoConfig" }.configureEach {
            outputs.upToDateWhen { false }
        }
    }
}
`;
    return mod;
  });
