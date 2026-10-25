#pragma once
#include <algorithm>
#include <cstdint>
#include <cstring>
#include <graphics/vec4.h>
#include <obs.h>
#include <vector>

namespace cinegather {
struct PreviewFrame {
  uint32_t width = 0, height = 0;
  std::vector<uint8_t> bgra;
};

// Read the selected OBS composition, never a second desktop capture or the SFU.
// All GPU objects and source rendering stay on OBS's graphics thread. Only a
// bounded, downscaled CPU frame leaves it; JPEG encoding runs on the pipe thread.
inline PreviewFrame previewFrame(obs_source_t *composition) {
  PreviewFrame frame;
  if (!composition)
    return frame;
  obs_video_info info{};
  if (!obs_get_video_info(&info) || !info.base_width || !info.base_height)
    return frame;
  const double scale = std::min({1.0, 960.0 / info.base_width,
                                540.0 / info.base_height});
  frame.width = std::max(1u, uint32_t(info.base_width * scale));
  frame.height = std::max(1u, uint32_t(info.base_height * scale));
  frame.bgra.resize(size_t(frame.width) * frame.height * 4);
  struct Readback {
    PreviewFrame *frame;
    obs_source_t *source;
    uint32_t width, height;
    bool copied = false;
  } read{&frame, composition, info.base_width, info.base_height};
  obs_queue_task(OBS_TASK_GRAPHICS, [](void *opaque) {
    auto &read = *static_cast<Readback *>(opaque);
    auto &frame = *read.frame;
    obs_enter_graphics();
    auto *target = gs_texrender_create(GS_BGRA, GS_ZS_NONE);
    auto *surface = gs_stagesurface_create(frame.width, frame.height, GS_BGRA);
    if (target && surface && gs_texrender_begin(target, frame.width, frame.height)) {
      vec4 black;
      vec4_set(&black, 0, 0, 0, 1);
      gs_clear(GS_CLEAR_COLOR, &black, 0, 0);
      gs_projection_push();
      gs_matrix_push();
      gs_matrix_identity();
      gs_ortho(0, float(read.width), 0, float(read.height), -100, 100);
      gs_blend_state_push();
      gs_blend_function(GS_BLEND_ONE, GS_BLEND_ZERO);
      obs_source_video_render(read.source);
      gs_blend_state_pop();
      gs_matrix_pop();
      gs_projection_pop();
      gs_texrender_end(target);
      gs_stage_texture(surface, gs_texrender_get_texture(target));
      uint8_t *bytes = nullptr;
      uint32_t stride = 0;
      if (gs_stagesurface_map(surface, &bytes, &stride)) {
        for (uint32_t y = 0; y < frame.height; ++y)
          std::memcpy(frame.bgra.data() + size_t(y) * frame.width * 4,
                      bytes + size_t(y) * stride, size_t(frame.width) * 4);
        gs_stagesurface_unmap(surface);
        read.copied = true;
      }
    }
    gs_stagesurface_destroy(surface);
    gs_texrender_destroy(target);
    obs_leave_graphics();
  }, &read, true);
  if (!read.copied)
    return {};
  return frame;
}
} // namespace cinegather
