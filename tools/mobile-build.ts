import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import mobileRelease from "../apps/mobile/mobile-release.json";
const root = resolve(import.meta.dir, "..");
const app = resolve(root, "apps/mobile");
const sdk = process.env.ANDROID_HOME ?? resolve(homedir(), "Android/SDK");
const java =
  process.env.JAVA_HOME ??
  "/opt/homebrew/Cellar/openjdk@17/17.0.20.1/libexec/openjdk.jdk/Contents/Home";
const signing = resolve(
  process.env.CINEGATHER_MOBILE_SIGNING_DIRECTORY ??
    resolve(homedir(), ".config/cinegather/mobile-signing"),
);
const output = resolve(root, ".local/mobile/artifacts");
async function command(
  args: string[],
  env: Record<string, string | undefined>,
  cwd = app,
) {
  const child = Bun.spawn(args, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (await child.exited)
    throw new Error(`Mobile build command failed: ${args[0]}`);
}
if (Bun.argv[2] === "ios") {
  const child = Bun.spawn(["python3", resolve(root, "tools/mobile-ios.py")], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}
if (Bun.argv[2] !== "android")
  throw new Error(
    "Usage: bun tools/mobile-build.ts android|ios (local production APK or self-sign IPA; no upload)",
  );
if (!existsSync(sdk) || !existsSync(java))
  throw new Error(
    "Configure ANDROID_HOME and JAVA_HOME for local Android build",
  );
const lock = resolve(root, ".local/mobile/build.lock");
mkdirSync(resolve(root, ".local/mobile"), { recursive: true });
try {
  mkdirSync(lock);
} catch {
  throw new Error(
    "A mobile build is already running; inspect .local/mobile/build.lock before retrying",
  );
}
try {
  writeFileSync(resolve(lock, "pid"), String(process.pid));
  mkdirSync(signing, { recursive: true, mode: 0o700 });
  const store = resolve(signing, "cinegather.keystore"),
    passwordPath = resolve(signing, "password");
  if (!existsSync(store) && !existsSync(passwordPath)) {
    writeFileSync(passwordPath, randomBytes(36).toString("base64url"), {
      mode: 0o600,
    });
    await command(
      [
        resolve(java, "bin/keytool"),
        "-genkeypair",
        "-keystore",
        store,
        "-alias",
        "cinegather",
        "-storepass:file",
        passwordPath,
        "-keypass:file",
        passwordPath,
        "-keyalg",
        "RSA",
        "-keysize",
        "3072",
        "-validity",
        "10000",
        "-dname",
        "CN=CineGather, O=ZQDesigned, C=CN",
        "-noprompt",
      ],
      process.env,
    );
    chmodSync(store, 0o600);
  }
  if (!existsSync(store) || !existsSync(passwordPath))
    throw new Error(
      "Incomplete signing state; restore the original keystore/password before rebuilding",
    );
  const password = readFileSync(passwordPath, "utf8").trim();
  const env = {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SDK_ROOT: sdk,
    JAVA_HOME: java,
    EXPO_PUBLIC_API_ORIGIN: "https://cgplat.zqdesigned.city",
    CG_MOBILE_UPDATE_ORIGIN: "https://cgplat.zqdesigned.city",
    CG_MOBILE_CHANNEL: "stable",
    CG_MOBILE_VERSION: mobileRelease.version,
    CG_MOBILE_REVISION: String(mobileRelease.revision),
    NODE_ENV: "production",
    CINEGATHER_ANDROID_KEYSTORE: store,
    CINEGATHER_ANDROID_STORE_PASSWORD: password,
    CINEGATHER_ANDROID_KEY_ALIAS: "cinegather",
    CINEGATHER_ANDROID_KEY_PASSWORD: password,
  };
  await command(
    [
      "bunx",
      "expo",
      "prebuild",
      "--platform",
      "android",
      "--no-clean",
      "--no-install",
    ],
    env,
  );
  await command(["bun", resolve(root, "tools/third-party.ts"), "mobile"], env);
  const assets = resolve(app, "android/app/src/main/assets");
  mkdirSync(assets, { recursive: true });
  copyFileSync(
    resolve(output, "MOBILE_THIRD_PARTY_NOTICES.txt"),
    resolve(assets, "THIRD_PARTY_NOTICES.txt"),
  );
  mkdirSync(output, { recursive: true });
  const workers = resolve(root, ".local/mobile/native-workers.gradle");
  mkdirSync(resolve(root, ".local/mobile"), { recursive: true });
  writeFileSync(
    workers,
    `allprojects { afterEvaluate { p -> if (p.plugins.hasPlugin('com.android.library') || p.plugins.hasPlugin('com.android.application')) { p.android.defaultConfig.externalNativeBuild.cmake.arguments.addAll(['-DCMAKE_JOB_POOLS=cinegather_compile=2', '-DCMAKE_JOB_POOL_COMPILE=cinegather_compile']) } } }`,
  );
  await command(
    [
      "./gradlew",
      ":app:assembleRelease",
      "-PreactNativeArchitectures=arm64-v8a",
      "--max-workers=2",
      "--console=plain",
      "-I",
      workers,
    ],
    env,
    resolve(app, "android"),
  );
  const version = JSON.parse(
    readFileSync(resolve(app, "package.json"), "utf8"),
  ).version;
  const target = resolve(output, `CineGather-${version}-android-arm64.apk`);
  await Bun.write(
    target,
    Bun.file(
      resolve(app, "android/app/build/outputs/apk/release/app-release.apk"),
    ),
  );
  console.log(`Signed Android APK: ${target}`);
} finally {
  rmSync(lock, { recursive: true, force: true });
}
