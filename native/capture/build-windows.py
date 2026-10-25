#!/usr/bin/env python3
"""Build the Windows libobs host and capture-clock-corrected WHIP plugin."""

import hashlib, json, os, pathlib, re, shutil, subprocess, sys, tarfile, urllib.request, zipfile

root = pathlib.Path(__file__).resolve().parents[2]
vendor = root / ".local/native-vendor"
work = root / ".local/native-runtime/windows"
runtime = work / "obs"
build = work / "build"
vendor.mkdir(parents=True, exist_ok=True)
build.mkdir(parents=True, exist_ok=True)
pins = [
    (
        "OBS-Studio-32.2.2-Windows-x64.zip",
        "https://github.com/obsproject/obs-studio/releases/download/32.2.2/OBS-Studio-32.2.2-Windows-x64.zip",
        "4d6e40e3ab155f56b30de517380566a206d74b63cdf5ad49aa596924768f97e1",
    ),
    (
        "obs-studio-32.2.2.tar.gz",
        "https://codeload.github.com/obsproject/obs-studio/tar.gz/refs/tags/32.2.2",
        "35d3cd0979d65664fada7119fdb612eca7c34b61a1623a330caec74bf72626c4",
    ),
    (
        "simde-0.8.2.tar.gz",
        "https://codeload.github.com/simd-everywhere/simde/tar.gz/refs/tags/v0.8.2",
        "ed2a3268658f2f2a9b5367628a85ccd4cf9516460ed8604eed369653d49b25fb",
    ),
    (
        "libdatachannel-0.24.2.tar.gz",
        "https://codeload.github.com/paullouisageneau/libdatachannel/tar.gz/refs/tags/v0.24.2",
        "91a4795c98e13e91935127ab7880109309bf35b5e5a96c8fcc08e08322576402",
    ),
]
for name, url, digest in pins:
    p = vendor / name
    if not p.exists():
        urllib.request.urlretrieve(url, p)
    if hashlib.sha256(p.read_bytes()).hexdigest() != digest:
        raise RuntimeError("Pinned source/runtime hash mismatch: " + name)
    target = vendor / (
        "obs-windows-32.2.2" if name.endswith(".zip") else name.removesuffix(".tar.gz")
    )
    if not target.exists():
        if name.endswith(".zip"):
            with zipfile.ZipFile(p) as z:
                z.extractall(target)
        else:
            with tarfile.open(p) as t:
                t.extractall(vendor, filter="data")
obs = vendor / "obs-studio-32.2.2"
original = vendor / "obs-windows-32.2.2"
# Pin headers even when an extracted cache already exists.
curl = vendor / "curl-8.16.0"
archive = vendor / "curl-8.16.0.tar.gz"
if not archive.exists():
    urllib.request.urlretrieve("https://curl.se/download/curl-8.16.0.tar.gz", archive)
if (
    hashlib.sha256(archive.read_bytes()).hexdigest()
    != "a21e20476e39eca5a4fc5cfb00acf84bbc1f5d8443ec3853ad14c26b3c85b970"
):
    raise RuntimeError("curl source checksum mismatch")
if not (curl / "include/curl/curl.h").exists():
    with tarfile.open(archive) as t:
        t.extractall(vendor, filter="data")
(build / "obsconfig.h").write_text(
    '#pragma once\n#define OBS_DATA_PATH "data"\n#define OBS_PLUGIN_PATH "obs-plugins/64bit"\n#define OBS_PLUGIN_DESTINATION "obs-plugins/64bit"\n#define OBS_RELEASE_CANDIDATE 0\n#define OBS_BETA 0\n#define OBS_INSTALL_PREFIX ""\n'
)
if "--prepare-only" in sys.argv:
    print(str(original))
    sys.exit(0)
if os.name != "nt":
    raise RuntimeError("The patched OBS C++ plugin must be built with MSVC on Windows")
vswhere = (
    pathlib.Path(os.environ.get("ProgramFiles(x86)", "C:/Program Files (x86)"))
    / "Microsoft Visual Studio/Installer/vswhere.exe"
)
vs = subprocess.check_output(
    [
        str(vswhere),
        "-latest",
        "-products",
        "*",
        "-requires",
        "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
        "-property",
        "installationPath",
    ],
    text=True,
).strip()
vcvars = pathlib.Path(vs) / "VC/Auxiliary/Build/vcvars64.bat"
env_script = build / "vcenv.cmd"
env_script.write_text(
    '@echo off\ncall "' + str(vcvars) + '" >nul\nif errorlevel 1 exit /b 1\nset\n'
)
raw = subprocess.check_output(["cmd", "/d", "/c", str(env_script)], text=True)
env = {
    **{key.upper(): value for key, value in os.environ.items()},
    **dict(
        (line.split("=", 1)[0].upper(), line.split("=", 1)[1])
        for line in raw.splitlines()
        if "=" in line and not line.startswith("=")
    ),
}


def command(args):
    executable = shutil.which(str(args[0]), path=env.get("PATH"))
    if not executable:
        raise RuntimeError("Build tool missing: " + str(args[0]))
    return [executable, *[str(a) for a in args[1:]]]


def run(args, **kw):
    return subprocess.run(command(args), env=env, check=True, **kw)


def output(args):
    return subprocess.check_output(command(args), env=env, text=True)


if runtime.exists():
    shutil.rmtree(runtime)
for p in [
    runtime / "bin/64bit",
    runtime / "obs-plugins/64bit",
    runtime / "data/obs-plugins",
    runtime / "data/libobs",
]:
    p.mkdir(parents=True, exist_ok=True)
shutil.copytree(original / "data/libobs", runtime / "data/libobs", dirs_exist_ok=True)
shutil.copy2(
    work / "CGProcessAudioHost.exe", runtime / "bin/64bit/CGProcessAudioHost.exe"
)
plugins = ["win-capture", "obs-nvenc", "obs-ffmpeg", "obs-x264", "obs-webrtc"]
queue = []
copied = {}
hashes = {}


def copy_binary(source, target):
    key = source.name.lower()
    if key in copied:
        return
    shutil.copy2(source, target)
    copied[key] = target
    queue.append((source, target))
    hashes[str(target.relative_to(runtime))] = hashlib.sha256(
        source.read_bytes()
    ).hexdigest()


for name in [
    "obs.dll",
    "libobs-d3d11.dll",
    "libobs-winrt.dll",
    "obs-amf-test.exe",
    "obs-nvenc-test.exe",
]:
    copy_binary(original / "bin/64bit" / name, runtime / "bin/64bit" / name)
for name in plugins:
    copy_binary(
        original / "obs-plugins/64bit" / (name + ".dll"),
        runtime / "obs-plugins/64bit" / (name + ".dll"),
    )
    src = original / "data/obs-plugins" / name
    if src.exists():
        shutil.copytree(src, runtime / "data/obs-plugins" / name, dirs_exist_ok=True)
redist = pathlib.Path(
    env.get("VCTOOLSREDISTDIR", str(pathlib.Path(vs) / "VC/Redist/MSVC"))
)
crt = list(redist.glob("x64/Microsoft.VC*.CRT")) or list(
    redist.glob("*/x64/Microsoft.VC*.CRT")
)
lookup = {p.name.lower(): p for p in (original / "bin/64bit").glob("*.dll")}
for folder in crt:
    for p in folder.glob("*.dll"):
        lookup[p.name.lower()] = p
# Copy only the dependency closure; Qt/CEF and the OBS frontend are excluded.
for source, target in queue:
    for name in re.findall(
        r"^\s+([A-Za-z0-9_.-]+\.dll)\s*$",
        output(["dumpbin", "/dependents", source]),
        re.M | re.I,
    ):
        key = name.lower()
        if key in lookup:
            copy_binary(lookup[key], runtime / "bin/64bit" / lookup[key].name)
        elif not (
            key.startswith(("api-ms-", "ext-ms-"))
            or (pathlib.Path(env["SYSTEMROOT"]) / "System32" / name).exists()
        ):
            raise RuntimeError("Missing DLL dependency: " + name)


def import_library(name, dll):
    exports = []
    for line in output(["dumpbin", "/exports", dll]).splitlines():
        m = re.match(r"^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\S+)", line)
        if m:
            exports.append(m.group(1))
    if not exports:
        raise RuntimeError("No DLL exports: " + name)
    definition = build / (name + ".def")
    definition.write_text(
        "LIBRARY " + dll.name + "\nEXPORTS\n" + "\n".join(exports) + "\n"
    )
    lib = build / (name + ".lib")
    run(
        [
            "lib",
            "/nologo",
            "/def:" + str(definition),
            "/machine:x64",
            "/out:" + str(lib),
        ],
        stdout=subprocess.DEVNULL,
    )
    return lib


obs_lib = import_library("obs", runtime / "bin/64bit/obs.dll")
winrt_lib = import_library("libobs-winrt", runtime / "bin/64bit/libobs-winrt.dll")
rtc_lib = import_library("datachannel", runtime / "bin/64bit/datachannel.dll")
curl_lib = import_library("libcurl", runtime / "bin/64bit/libcurl.dll")
flags = [
    "/nologo",
    "/std:c++17",
    "/utf-8",
    "/EHsc",
    "/O2",
    "/MD",
    "/DWIN32_LEAN_AND_MEAN",
    "/DNOMINMAX",
    "/D_CRT_SECURE_NO_WARNINGS",
    "/I" + str(obs / "libobs"),
    "/I" + str(obs / "libobs-winrt"),
    "/I" + str(vendor / "simde-0.8.2"),
    "/I" + str(build),
    "/I" + str(root / "native/capture"),
]
if os.environ.get("CG_PROTOCOL_TEST") == "1":
    run(["cl", *flags, "/DRTC_ENABLE_MEDIA=1", "/I" + str(vendor / "libdatachannel-0.24.2/include"), "/I" + str(curl / "include"), root / "tools/windows-rtc-probe.cpp", "/Fe:" + str(build / "CGProtocolProbe.exe"), "/Fo:" + str(build / "protocol-probe.obj"), "/link", rtc_lib, curl_lib])
# Preserve the pinned OBS WGC implementation; add only numeric frame counters.
winrt = build / "winrt"
winrt.mkdir(exist_ok=True)
for name in [
    "winrt-capture.cpp",
    "winrt-capture.h",
    "winrt-dispatch.cpp",
    "winrt-dispatch.h",
]:
    shutil.copy2(obs / "libobs-winrt" / name, winrt / name)
run([sys.executable, root / "native/capture/patch-winrt-counters.py", winrt])
headers = [
    "d3d11.h",
    "DispatcherQueue.h",
    "dwmapi.h",
    "obs-module.h",
    "util/windows/ComPtr.hpp",
    "Windows.Graphics.Capture.Interop.h",
    "windows.graphics.directx.direct3d11.interop.h",
    "winrt/Windows.Foundation.Metadata.h",
    "winrt/Windows.Graphics.Capture.h",
    "winrt/Windows.System.h",
]
pch = winrt / "common.hpp"
pch.write_text("\n".join("#include <" + h + ">" for h in headers) + "\n")
winrt_objects = []
for name in ["winrt-capture", "winrt-dispatch"]:
    obj = winrt / (name + ".obj")
    winrt_objects.append(obj)
    run(
        [
            "cl",
            *flags,
            "/D_SILENCE_EXPERIMENTAL_COROUTINE_DEPRECATION_WARNINGS",
            "/FI" + str(pch),
            "/c",
            winrt / (name + ".cpp"),
            "/Fo:" + str(obj),
        ]
    )
run(
    [
        "link",
        "/nologo",
        "/DLL",
        "/OUT:" + str(runtime / "bin/64bit/libobs-winrt.dll"),
        "/IMPLIB:" + str(build / "winrt-patched.lib"),
        *winrt_objects,
        obs_lib,
        "d3d11.lib",
        "dxgi.lib",
        "dwmapi.lib",
        "windowsapp.lib",
        "runtimeobject.lib",
        "CoreMessaging.lib",
        "user32.lib",
        "ole32.lib",
        "oleaut32.lib",
    ]
)
winrt_lib = import_library("libobs-winrt", runtime / "bin/64bit/libobs-winrt.dll")
run(
    [
        "cl",
        *flags,
        root / "native/capture/windows-host.cpp",
        "/Fe:" + str(runtime / "bin/64bit/CGScreenCaptureHost.exe"),
        "/Fo:" + str(build / "host.obj"),
        "/link",
        obs_lib,
        winrt_lib,
        "dxgi.lib",
        "d3d11.lib",
        "user32.lib",
        "gdi32.lib",
        "ole32.lib",
        "windowscodecs.lib",
        "crypt32.lib",
        "uuid.lib",
        "mmdevapi.lib",
    ]
)
whip = build / "whip"
whip.mkdir(exist_ok=True)
for name in [
    "obs-webrtc.cpp",
    "whip-output.cpp",
    "whip-output.h",
    "whip-service.cpp",
    "whip-service.h",
    "whip-utils.h",
]:
    shutil.copy2(obs / "plugins/obs-webrtc" / name, whip / name)
run([sys.executable, root / "native/capture/patch-whip.py", whip])
objects = []
for name in ["obs-webrtc", "whip-output", "whip-service"]:
    obj = whip / (name + ".obj")
    objects.append(obj)
    run(
        [
            "cl",
            *flags,
            "/DRTC_ENABLE_MEDIA=1",
            "/DRTC_ENABLE_WEBSOCKET=1",
            "/I" + str(vendor / "libdatachannel-0.24.2/include"),
            "/I" + str(curl / "include"),
            "/c",
            whip / (name + ".cpp"),
            "/Fo:" + str(obj),
        ]
    )
run(
    [
        "link",
        "/nologo",
        "/DLL",
        "/OUT:" + str(runtime / "obs-plugins/64bit/obs-webrtc.dll"),
        "/IMPLIB:" + str(build / "obs-webrtc.lib"),
        *objects,
        obs_lib,
        rtc_lib,
        curl_lib,
        "ws2_32.lib",
    ]
)
# Supply app-local MSVC libraries so no machine-wide VC installation is needed.
for folder in crt:
    for dll in folder.glob("*.dll"):
        if not (runtime / "bin/64bit" / dll.name).exists():
            shutil.copy2(dll, runtime / "bin/64bit" / dll.name)
source_dir = work / "source"
if source_dir.exists():
    shutil.rmtree(source_dir)
source_dir.mkdir()
shutil.copytree(
    root / "native/capture",
    source_dir / "cinegather",
    ignore=shutil.ignore_patterns("__pycache__"),
)
shutil.copytree(
    whip, source_dir / "obs-webrtc-modified", ignore=shutil.ignore_patterns("*.obj")
)
shutil.copytree(
    winrt, source_dir / "winrt-modified", ignore=shutil.ignore_patterns("*.obj")
)
for name, _, _ in pins:
    if not name.endswith(".zip"):
        shutil.copy2(vendor / name, source_dir / name)
shutil.copy2(vendor / "curl-8.16.0.tar.gz", source_dir / "curl-8.16.0.tar.gz")
shutil.copy2(root / "tools/windows-audio-build.ts", source_dir / "windows-audio-build.ts")
shutil.copy2(obs / "COPYING", runtime / "COPYING-OBS.txt")
(runtime / "THIRD_PARTY_NOTICES.txt").write_text(
    "CGScreenCaptureHost links OBS Studio GPL-2.0-or-later. Frontend source remains MIT.\nModified host/plugin sources and pinned corresponding-source archives are available separately; see SOURCE_CODE.txt.\nlibdatachannel: MPL-2.0; curl: curl license; SIMDe: MIT; x264: GPL-2.0-or-later; FFmpeg: see OBS distribution source notices.\nApp-local Microsoft VC runtime is redistributed under the Visual Studio runtime license.\n"
)
import importlib.util
spec = importlib.util.spec_from_file_location("source_package", root / "native/capture/source-package.py")
source_package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(source_package)
version = json.loads((root / "apps/desktop/package.json").read_text(encoding="utf-8"))["version"]
source_artifact = source_package.package_sources(
    source_dir, runtime,
    root / "apps/desktop/release" / ("CineGather-" + version + "-win-x64-native-source.zip"),
)
(runtime / "manifest.json").write_text(
    json.dumps(
        {
            "obsVersion": "32.2.2",
            "correspondingSource": source_artifact,
            "platform": "win32-x64",
            "captureCounters": "WGC-arrived-copied-QPC-v1",
            "winrtOutputSha256": hashlib.sha256(
                (runtime / "bin/64bit/libobs-winrt.dll").read_bytes()
            ).hexdigest(),
            "sources": [{"file": n, "url": u, "sha256": h} for n, u, h in pins],
            "runtimeInputSha256": hashes,
            "curlSourceSha256": hashlib.sha256(
                (vendor / "curl-8.16.0.tar.gz").read_bytes()
            ).hexdigest(),
            "sync": "absolute-rtp-and-capture-ntp-v1",
            "plugins": plugins,
            "hostSourceSha256": hashlib.sha256(
                (root / "native/capture/windows-host.cpp").read_bytes()
            ).hexdigest(),
        },
        indent=2,
    )
)
print(str(runtime))
