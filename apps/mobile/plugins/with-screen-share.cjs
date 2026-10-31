/* global require, module */
/* eslint-disable @typescript-eslint/no-require-imports -- Expo config plugins run in Node. */
const {
  withInfoPlist,
  withEntitlementsPlist,
  withXcodeProject,
  withDangerousMod,
  withPodfile,
} = require("expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");
const plist = require("@expo/plist").default;
const extension = "CineGatherBroadcast";
module.exports = function withScreenShare(config) {
  const bundle = config.ios.bundleIdentifier;
  const group = `group.${bundle}.screen-share`;
  config = withInfoPlist(config, (c) => {
    c.modResults.CGScreenShareGroup = group;
    c.modResults.UIBackgroundModes = [
      ...new Set([
        ...(c.modResults.UIBackgroundModes || []),
        "audio",
        "screen-capture",
      ]),
    ];
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    c.modResults["com.apple.security.application-groups"] = [
      ...new Set([
        ...(c.modResults["com.apple.security.application-groups"] || []),
        group,
      ]),
    ];
    return c;
  });
  config = withDangerousMod(config, [
    "ios",
    async (c) => {
      const target = path.join(c.modRequest.platformProjectRoot, extension);
      fs.mkdirSync(target, { recursive: true });
      const sources = path.join(
        c.modRequest.projectRoot,
        "modules/screen-share/ios",
      );
      for (const file of [
        "SampleHandler.m",
        "CGScreenPublisher.h",
        "CGScreenPublisher.mm",
      ]) {
        fs.copyFileSync(
          path.join(
            sources,
            file === "SampleHandler.m" ? "Broadcast" : "Shared",
            file,
          ),
          path.join(target, file),
        );
      }
      fs.writeFileSync(
        path.join(target, "Info.plist"),
        plist.build({
          CFBundleDisplayName: "映聚屏幕共享",
          CFBundleName: "$(PRODUCT_NAME)",
          CFBundleExecutable: "$(EXECUTABLE_NAME)",
          CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
          CFBundlePackageType: "XPC!",
          CFBundleShortVersionString: config.version,
          CFBundleVersion: config.ios.buildNumber || "1",
          CGScreenShareGroup: group,
          NSExtension: {
            NSExtensionPointIdentifier: "com.apple.broadcast-services-upload",
            NSExtensionPrincipalClass: "SampleHandler",
            NSExtensionAttributes: {
              RPBroadcastProcessMode: "RPBroadcastProcessModeSampleBuffer",
            },
          },
        }),
      );
      fs.writeFileSync(
        path.join(target, "Broadcast.entitlements"),
        plist.build({ "com.apple.security.application-groups": [group] }),
      );
      return c;
    },
  ]);
  config = withPodfile(config, (c) => {
    if (!c.modResults.contents.includes(`target '${extension}' do`)) {
      c.modResults.contents += `\n# CineGather ReplayKit publisher (same WebRTC binary as the host).\ntarget '${extension}' do\n  pod 'LiveKitWebRTC', '150.7871.04'\nend\n`;
    }
    return c;
  });
  config = withXcodeProject(config, (c) => {
    const project = c.modResults;
    const objects = project.hash.project.objects;
    objects.PBXContainerItemProxy ||= {};
    objects.PBXTargetDependency ||= {};
    if (project.pbxTargetByName(extension)) {
      const entry = Object.entries(project.pbxNativeTargetSection()).find(
        ([, value]) =>
          value &&
          typeof value === "object" &&
          String(value.name).replaceAll('"', "") === extension,
      );
      const app = project.getFirstTarget();
      const linked = app.firstTarget.dependencies.some(
        (dep) => objects.PBXTargetDependency[dep.value]?.target === entry[0],
      );
      if (!linked) project.addTargetDependency(app.uuid, [entry[0]]);
      return c;
    }
    const target = project.addTarget(
      extension,
      "app_extension",
      extension,
      `${bundle}.broadcast`,
    );
    project.addBuildPhase(
      [`${extension}/SampleHandler.m`, `${extension}/CGScreenPublisher.mm`],
      "PBXSourcesBuildPhase",
      "Sources",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXFrameworksBuildPhase",
      "Frameworks",
      target.uuid,
    );
    project.addBuildPhase(
      [],
      "PBXResourcesBuildPhase",
      "Resources",
      target.uuid,
    );
    const list =
      project.pbxXCConfigurationList()[
        target.pbxNativeTarget.buildConfigurationList
      ];
    for (const entry of list.buildConfigurations) {
      const settings =
        project.pbxXCBuildConfigurationSection()[entry.value].buildSettings;
      Object.assign(settings, {
        INFOPLIST_FILE: `${extension}/Info.plist`,
        CODE_SIGN_ENTITLEMENTS: `${extension}/Broadcast.entitlements`,
        IPHONEOS_DEPLOYMENT_TARGET: "16.4",
        TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CLANG_ENABLE_MODULES: "YES",
        CLANG_ENABLE_OBJC_ARC: "YES",
        CLANG_CXX_LANGUAGE_STANDARD: '"c++20"',
        GENERATE_INFOPLIST_FILE: "NO",
        CODE_SIGN_STYLE: "Automatic",
        ...(config.ios.appleTeamId
          ? { DEVELOPMENT_TEAM: config.ios.appleTeamId }
          : {}),
      });
    }
    return c;
  });
  return config;
};
