#pragma once
#include <obs.h>
#include <chrono>
#include <stdexcept>
#include <thread>
#include <utility>

namespace cinegather {
// A replacement source is prepared off-output. Its audio stays muted until the
// scene becomes the output, so failed selection cannot leak a different app.
struct CaptureScene {
  obs_scene_t *scene = nullptr;
  obs_source_t *video = nullptr;
  obs_source_t *audio = nullptr;
  bool warming = false;
  CaptureScene() = default;
  CaptureScene(const CaptureScene &) = delete;
  CaptureScene &operator=(const CaptureScene &) = delete;
  void unwarm() {
    if (!warming) return;
    obs_source_dec_showing(obs_scene_get_source(scene));
    obs_source_dec_active(obs_scene_get_source(scene));
    warming = false;
  }
  ~CaptureScene() {
    unwarm();
    if (scene) obs_scene_release(scene);
    if (video) obs_source_release(video);
    if (audio) obs_source_release(audio);
  }
  template <typename Authorized> void warm(int width, int height, Authorized authorized) {
    if (!scene || !video) throw std::runtime_error("source-create");
    obs_source_set_muted(video, true);
    if (audio) obs_source_set_muted(audio, true);
    auto *item = obs_scene_add(scene, video);
    if (!item) throw std::runtime_error("source-create");
    obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
    vec2 bounds;
    vec2_set(&bounds, float(width), float(height));
    obs_sceneitem_set_bounds(item, &bounds);
    if (audio) obs_scene_add(scene, audio);
    auto *root = obs_scene_get_source(scene);
    obs_source_inc_active(root);
    obs_source_inc_showing(root);
    warming = true;
    const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(2500);
    while (!obs_source_get_width(video) || !obs_source_get_height(video)) {
      if (!authorized()) throw std::runtime_error("lease-expired");
      if (std::chrono::steady_clock::now() >= until) throw std::runtime_error("source-unavailable");
      std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    if (!authorized()) throw std::runtime_error("lease-expired");
  }
  void commit(obs_scene_t *&activeScene, obs_source_t *&activeVideo, obs_source_t *&activeAudio) {
    if (activeAudio) obs_source_set_muted(activeAudio, true);
    obs_set_output_source(0, obs_scene_get_source(scene));
    if (audio) obs_source_set_muted(audio, false);
    unwarm();
    std::swap(scene, activeScene);
    std::swap(video, activeVideo);
    std::swap(audio, activeAudio);
  }
};
}
