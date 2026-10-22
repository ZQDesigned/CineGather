#!/usr/bin/env python3
"""Build the self-contained macOS capture helper from pinned sources and OBS runtime."""
import pathlib, shutil, subprocess, plistlib, hashlib, json, os, urllib.request, tarfile
root=pathlib.Path(__file__).resolve().parents[2]
work=root/'.local/native-runtime';vendor=root/'.local/native-vendor'
work.mkdir(parents=True,exist_ok=True);vendor.mkdir(parents=True,exist_ok=True)
pins=[('obs-studio-32.2.2','https://codeload.github.com/obsproject/obs-studio/tar.gz/refs/tags/32.2.2','35d3cd0979d65664fada7119fdb612eca7c34b61a1623a330caec74bf72626c4'),('simde-0.8.2','https://codeload.github.com/simd-everywhere/simde/tar.gz/refs/tags/v0.8.2','ed2a3268658f2f2a9b5367628a85ccd4cf9516460ed8604eed369653d49b25fb'),('libdatachannel-0.24.2','https://codeload.github.com/paullouisageneau/libdatachannel/tar.gz/refs/tags/v0.24.2','91a4795c98e13e91935127ab7880109309bf35b5e5a96c8fcc08e08322576402')]
for name,url,digest in pins:
 archive=vendor/(name+'.tar.gz')
 if not archive.exists():urllib.request.urlretrieve(url,archive)
 if hashlib.sha256(archive.read_bytes()).hexdigest()!=digest:raise RuntimeError('Source checksum mismatch: '+name)
 if not (vendor/name).exists():
  with tarfile.open(archive) as tar:tar.extractall(vendor,filter='data')
source=pathlib.Path(os.getenv('CINEGATHER_OBS_APP','/Applications/OBS.app'))/'Contents'
info=plistlib.loads((source/'Info.plist').read_bytes())
if info['CFBundleShortVersionString']!='32.2.2':raise RuntimeError('OBS runtime must be version 32.2.2')
subprocess.run(['codesign','--verify','--deep','--strict',str(source.parent)],check=True)
app=work/'CineGatherLibobsHost.app';contents=app/'Contents';frameworks=contents/'Frameworks';plugins=contents/'PlugIns';generated=work/'generated'
if app.exists():shutil.rmtree(app)
for p in [contents/'MacOS',frameworks,plugins,generated]:p.mkdir(parents=True,exist_ok=True)
copied=set(); binaries=[];runtime_hashes={}
def copy_runtime(name):
 if name in copied:return
 copied.add(name);src=source/'Frameworks'/name;dest=frameworks/name
 if src.is_dir():shutil.copytree(src,dest,symlinks=True);binaries.append(dest/name.replace('.framework',''))
 else:shutil.copy2(src,dest);binaries.append(dest)
copy_runtime('libobs.framework');copy_runtime('libobs-opengl.dylib')
plugin_names=['mac-capture','mac-videotoolbox','obs-ffmpeg','obs-webrtc']
for name in plugin_names:
 src=source/'PlugIns'/(name+'.plugin');dest=plugins/src.name
 shutil.copytree(src,dest,symlinks=True);binaries.append(dest/'Contents/MacOS'/name)
i=0
while i<len(binaries):
 binary=binaries[i];i+=1
 runtime_hashes[str(binary.relative_to(contents))]=hashlib.sha256(binary.read_bytes()).hexdigest()
 for line in subprocess.check_output(['otool','-L',str(binary)],text=True).splitlines()[1:]:
  dep=line.strip().split(' (')[0]
  if dep.startswith('@rpath/'):
   name=dep[7:].split('/')[0]
   if (source/'Frameworks'/name).exists():copy_runtime(name)
   else:raise RuntimeError('Unresolved dependency: '+dep)
expected=json.loads((root/'native/capture/runtime-lock.json').read_text())['binaries']
if runtime_hashes!=expected:raise RuntimeError('OBS runtime differs from the pinned macOS arm64 distribution')
(generated/'obsconfig.h').write_text('#pragma once\n#define OBS_DATA_PATH "data"\n#define OBS_PLUGIN_PATH "plugins"\n#define OBS_PLUGIN_DESTINATION "plugins"\n#define OBS_RELEASE_CANDIDATE 0\n#define OBS_BETA 0\n#define OBS_INSTALL_PREFIX ""\n')
# Retain the explicitly granted development identity; production signing must use a stable identity.
info={'CFBundleIdentifier':'city.zqdesigned.cinegather.libobsprobe','CFBundleName':'CineGatherLibobsHost','CFBundleExecutable':'CineGatherLibobsHost','CFBundlePackageType':'APPL','CFBundleVersion':'0.1.0','CFBundleShortVersionString':'0.1.0','NSHighResolutionCapable':True,'LSUIElement':True,'LSMinimumSystemVersion':'13.0','NSScreenCaptureUsageDescription':'映聚需要录制你在应用中选择的共享窗口。','NSAudioCaptureUsageDescription':'映聚只采集你选择的应用声音。'}
(contents/'Info.plist').write_bytes(plistlib.dumps(info))
common=['clang++','-std=c++17','-arch','arm64','-mmacosx-version-min=13.0','-O2','-Wno-nullability-completeness','-Wno-incompatible-pointer-types','-I'+str(vendor/'obs-studio-32.2.2/libobs'),'-I'+str(vendor/'simde-0.8.2'),'-I'+str(generated),'-I'+str(root/'native/capture'),'-F'+str(frameworks)]
subprocess.run(common+['-fobjc-arc',str(root/'native/capture/host.mm'),'-framework','libobs','-framework','AppKit','-framework','ScreenCaptureKit','-framework','CoreGraphics','-Wl,-rpath,@executable_path/../Frameworks','-o',str(contents/'MacOS/CineGatherLibobsHost')],check=True)
whip=work/'whip';whip.mkdir(exist_ok=True)
for name in ['obs-webrtc.cpp','whip-output.cpp','whip-output.h','whip-service.cpp','whip-service.h','whip-utils.h']:shutil.copy2(vendor/'obs-studio-32.2.2/plugins/obs-webrtc'/name,whip/name)
subprocess.run(['python3',str(root/'native/capture/patch-whip.py'),str(whip)],check=True)
subprocess.run(common+['-dynamiclib','-fvisibility=hidden','-DRTC_ENABLE_MEDIA=1','-DRTC_ENABLE_WEBSOCKET=1','-I'+str(vendor/'libdatachannel-0.24.2/include'),'-L'+str(frameworks),*[str(whip/n) for n in ['obs-webrtc.cpp','whip-output.cpp','whip-service.cpp']],'-framework','libobs','-ldatachannel','-lcurl','-Wl,-rpath,@loader_path/../../../Frameworks','-o',str(plugins/'obs-webrtc.plugin/Contents/MacOS/obs-webrtc')],check=True)
resources=contents/'Resources';resources.mkdir(exist_ok=True)
notices='CineGather source: MIT. This helper links OBS Studio (GPL-2.0-or-later).\nThe combined helper is subject to GPL terms. libdatachannel: MPL-2.0; SIMDe: MIT.\nRuntime extracted from the official signed OBS Studio 32.2.2 macOS distribution.\nNo OBS frontend/Qt/CEF is included.\nPinned source URLs and hashes are in manifest.json. Local artifacts are not a public release.\n'
(resources/'THIRD_PARTY_NOTICES.txt').write_text(notices)
shutil.copy2(vendor/'obs-studio-32.2.2/COPYING',resources/'COPYING-OBS.txt')
# Ship the actual modified plugin and helper sources, build scripts and pinned source archives.
source_dir=resources/'source';source_dir.mkdir()
shutil.copytree(root/'native/capture',source_dir/'cinegather',ignore=shutil.ignore_patterns('__pycache__'))
shutil.copytree(whip,source_dir/'obs-webrtc-modified')
for name,_,_ in pins:shutil.copy2(vendor/(name+'.tar.gz'),source_dir/(name+'.tar.gz'))
manifest={'obsVersion':'32.2.2','sources':[{'name':n,'url':u,'sha256':h} for n,u,h in pins],'runtimeInputSha256':runtime_hashes,'hostSourceSha256':hashlib.sha256((root/'native/capture/host.mm').read_bytes()).hexdigest(),'plugins':plugin_names,'sync':'absolute-rtp-and-capture-ntp-v1','distribution':'local-development; full third-party runtime corresponding-source audit required before public release'}
(resources/'manifest.json').write_text(json.dumps(manifest,indent=2))
subprocess.run(['codesign','--force','--deep','--sign',os.getenv('CINEGATHER_SIGN_IDENTITY','-'),str(app)],check=True)
print(str(app))
