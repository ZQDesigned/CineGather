import hashlib
import json
import os
import pathlib
import plistlib
import shutil
import subprocess
import sys
import tempfile


root = pathlib.Path(__file__).resolve().parent.parent
app = root / "apps/mobile"
release = json.loads((app / "mobile-release.json").read_text())
version = release["version"]
build = str(release["nativeBuild"])
if sys.platform != "darwin":
    raise RuntimeError("iOS device builds require Xcode on macOS")
if json.loads((app / "package.json").read_text())["version"] != version:
    raise RuntimeError("Mobile package and release versions must match")
output = root / ".local/mobile/artifacts"
output.mkdir(parents=True, exist_ok=True)
lock = root / ".local/mobile/ios-build.lock"
lock.mkdir()
env = {
    **os.environ,
    "NODE_ENV": "production",
    "EXPO_PUBLIC_API_ORIGIN": "https://cgplat.zqdesigned.city",
    "CG_MOBILE_UPDATE_ORIGIN": "https://cgplat.zqdesigned.city",
    "CG_MOBILE_CHANNEL": "stable",
    "CG_MOBILE_VERSION": version,
    "CG_MOBILE_REVISION": str(release["revision"]),
    "NODE_BINARY": shutil.which("node"),
    "SKIP_BUNDLING": "",
    "FORCE_BUNDLING": "1",
    "EXPO_NO_TELEMETRY": "1",
}


def run(args, cwd=app):
    subprocess.run([str(x) for x in args], cwd=cwd, env=env, check=True)


def plist(path):
    return plistlib.loads(path.read_bytes())


def ad_hoc_sign(target, entitlements=None):
    args = ["codesign", "--force", "--sign", "-", "--timestamp=none"]
    if entitlements:
        args += ["--entitlements", entitlements]
    run([*args, target])


try:
    (lock / "pid").write_text(str(os.getpid()))
    run([
        "bunx", "expo", "prebuild", "--platform", "ios", "--no-clean", "--no-install"
    ])
    run(["pod", "install"], app / "ios")
    run(["bun", root / "tools/third-party.ts", "mobile"])
    archive = output / f"CineGather-{version}-ios.xcarchive"
    if archive.exists():
        shutil.rmtree(archive)
    run([
        "xcodebuild", "archive", "-workspace", "app.xcworkspace", "-scheme", "app",
        "-configuration", "Release", "-destination", "generic/platform=iOS",
        "-sdk", "iphoneos", "-jobs", "4",
        "-derivedDataPath", root / ".local/mobile/ios-release-build",
        "-archivePath", archive,
        "CODE_SIGNING_ALLOWED=NO", "CODE_SIGNING_REQUIRED=NO",
    ], app / "ios")
    built_app = archive / "Products/Applications/app.app"
    info = plist(built_app / "Info.plist")
    if info["CFBundleShortVersionString"] != version or info["CFBundleVersion"] != build:
        raise RuntimeError("The iOS archive has stale native version metadata")
    group = info["CGScreenShareGroup"]
    with tempfile.TemporaryDirectory(prefix="cinegather-ipa-") as directory:
        staging = pathlib.Path(directory)
        payload = staging / "Payload"
        payload.mkdir()
        target = payload / "app.app"
        shutil.copytree(built_app, target, symlinks=True)
        # Xcode can process Info.plist after Expo's Release cleanup build phase.
        # Remove only Expo development discovery metadata from the final payload.
        target_info = plist(target / "Info.plist")
        services = target_info.get("NSBonjourServices", [])
        services = [service for service in services if service != "_expo._tcp"]
        if services:
            target_info["NSBonjourServices"] = services
        else:
            target_info.pop("NSBonjourServices", None)
        if "Expo Dev Launcher" in target_info.get("NSLocalNetworkUsageDescription", ""):
            target_info.pop("NSLocalNetworkUsageDescription", None)
        (target / "Info.plist").write_bytes(plistlib.dumps(target_info))
        shutil.copyfile(output / "MOBILE_THIRD_PARTY_NOTICES.txt", target / "THIRD_PARTY_NOTICES.txt")
        for profile in target.rglob("*.mobileprovision"):
            profile.unlink()
        frameworks = sorted(target.rglob("*.framework"), key=lambda p: len(p.parts), reverse=True)
        for library in target.rglob("*.dylib"):
            ad_hoc_sign(library)
        for framework in frameworks:
            ad_hoc_sign(framework)
        # Ad-hoc signatures retain the capabilities for re-signing tools without
        # publishing the developer's provisioning profiles or device identifiers.
        entitlements = staging / "self-sign.entitlements"
        entitlements.write_bytes(plistlib.dumps({
            "com.apple.security.application-groups": [group],
            "get-task-allow": False,
        }))
        extensions = list((target / "PlugIns").glob("*.appex"))
        if len(extensions) != 1:
            raise RuntimeError("The screen broadcast extension is missing")
        for extension in extensions:
            extension_info = plist(extension / "Info.plist")
            if (extension_info["CFBundleShortVersionString"] != version
                or extension_info["CFBundleVersion"] != build
                or extension_info["CGScreenShareGroup"] != group):
                raise RuntimeError("Broadcast extension version or App Group mismatch")
            ad_hoc_sign(extension, entitlements)
        ad_hoc_sign(target, entitlements)
        run(["codesign", "--verify", "--deep", "--strict", target])
        destination = output / f"CineGather-{version}-ios-self-sign.ipa"
        destination.unlink(missing_ok=True)
        run(["/usr/bin/zip", "-q", "-r", "-y", destination, "Payload"], staging)
    digest = hashlib.file_digest(destination.open("rb"), "sha256").hexdigest()
    metadata = {
        "version": version, "nativeBuild": int(build), "revision": release["revision"],
        "minimumIOS": info["MinimumOSVersion"], "signing": "user-self-sign-required",
        "broadcastExtension": True, "appGroup": group,
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip(),
        "file": destination.name, "size": destination.stat().st_size, "sha256": digest,
    }
    destination.with_suffix(".build.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata))
finally:
    shutil.rmtree(lock)
