// Native build4 contains the Android ScreenFooter transition fix. Older binaries
// must not create that native footer while hot updates change its height.
export function mobileSheetLayout(platform: string, nativeBuild: number) {
  const legacyAndroid = platform === "android" && !(nativeBuild >= 4);
  return {
    nativeFooter: platform === "android" && !legacyAndroid,
    detents: legacyAndroid ? [1] : [0.6, 1],
    reserveKeyboard: platform === "ios" || legacyAndroid,
  };
}
