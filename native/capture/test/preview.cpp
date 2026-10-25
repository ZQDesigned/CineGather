#include "../preview.hpp"
#include <cassert>
#include <cmath>
#include <iostream>
#include <thread>

static float blue = 0.8f;
static const char *name(void *) { return "Preview fixture"; }
static void *create(obs_data_t *, obs_source_t *) { return &blue; }
static void destroy(void *) {}
static uint32_t width(void *) { return 1920; }
static uint32_t height(void *) { return 1080; }
static void render(void *, gs_effect_t *) {
  vec4 color;
  vec4_set(&color, 0.1f, 0.3f, blue, 1);
  auto *effect = obs_get_base_effect(OBS_EFFECT_SOLID);
  gs_effect_set_vec4(gs_effect_get_param_by_name(effect, "color"), &color);
  while (gs_effect_loop(effect, "Solid"))
    gs_draw_sprite(nullptr, 0, 1920, 1080);
  vec4_set(&color, 0.9f, 0.05f, 0.05f, 1);
  gs_effect_set_vec4(gs_effect_get_param_by_name(effect, "color"), &color);
  while (gs_effect_loop(effect, "Solid"))
    gs_draw_sprite(nullptr, 0, 640, 360);
}
int main(int argc, char **argv) {
  assert(argc == 3);
  assert(obs_startup("en-US", nullptr, nullptr));
  obs_add_data_path(argv[1]);
  obs_video_info info{};
  info.graphics_module = argv[2];
  info.fps_num = 30;
  info.fps_den = 1;
  info.base_width = info.output_width = 1920;
  info.base_height = info.output_height = 1080;
  info.output_format = VIDEO_FORMAT_NV12;
  assert(obs_reset_video(&info) == OBS_VIDEO_SUCCESS);
  obs_source_info fixture{};
  fixture.id = "preview-fixture";
  fixture.type = OBS_SOURCE_TYPE_INPUT;
  fixture.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW;
  fixture.get_name = name;
  fixture.create = create;
  fixture.destroy = destroy;
  fixture.get_width = width;
  fixture.get_height = height;
  fixture.video_render = render;
  obs_register_source(&fixture);
  auto *source = obs_source_create("preview-fixture", "Fixture", nullptr, nullptr);
  auto *scene = obs_scene_create("Preview test");
  auto *item = obs_scene_add(scene, source);
  obs_set_output_source(0, obs_scene_get_source(scene));
  for (int i = 0; i < 12; ++i) {
    // Change the composition, not a separate screen-capture source. A preview
    // must follow what the encoder receives (including hidden scene items).
    obs_sceneitem_set_visible(item, i % 2 == 0);
    const auto frame = cinegather::previewFrame(obs_scene_get_source(scene));
    assert(frame.width == 960 && frame.height == 540);
    assert(frame.bgra.size() == 960 * 540 * 4);
    const auto pixel = (270 * 960 + 480) * 4;
    if (i % 2 == 0) {
      assert(frame.bgra[pixel] > 160); // BGRA blue
      assert(frame.bgra[pixel + 2] < 80);
      const auto corner = (50 * 960 + 50) * 4;
      assert(frame.bgra[corner] < 80);
      assert(frame.bgra[corner + 2] > 180); // top-left remains top-left
    } else {
      assert(frame.bgra[pixel] < 5);
      assert(frame.bgra[pixel + 1] < 5);
      assert(frame.bgra[pixel + 2] < 5);
    }
  }
  assert(cinegather::previewFrame(nullptr).bgra.empty());
  obs_set_output_source(0, nullptr);
  obs_sceneitem_remove(item);
  obs_source_remove(obs_scene_get_source(scene));
  obs_scene_release(scene);
  obs_source_remove(source);
  obs_source_release(source);
  obs_wait_for_destroy_queue();
  obs_shutdown();
  std::cout << "OBS preview follows the active composition and clears without a source\n";
}
