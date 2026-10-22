#include "../audio-exclusions.h"
#include <cassert>
int main() {
  assert(cg_audio_bundle_is_excluded("city.zqdesigned.cinegather", "city.zqdesigned.cinegather"));
  assert(cg_audio_bundle_is_excluded("city.zqdesigned.cinegather.helper.Renderer", "city.zqdesigned.cinegather"));
  assert(cg_audio_bundle_is_excluded("city.zqdesigned.cinegather.libobsprobe", "com.github.Electron"));
  assert(cg_audio_bundle_is_excluded("com.github.Electron.helper", "com.github.Electron"));
  assert(!cg_audio_bundle_is_excluded("com.github.Electron", "city.zqdesigned.cinegather"));
  assert(!cg_audio_bundle_is_excluded("city.zqdesigned.cinegather-other", "city.zqdesigned.cinegather"));
  assert(!cg_audio_bundle_is_excluded("com.apple.Safari", "city.zqdesigned.cinegather"));
  assert(!cg_audio_bundle_is_excluded("", ""));
  assert(!cg_audio_bundle_is_excluded(nullptr, nullptr));
}
