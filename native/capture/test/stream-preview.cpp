// Native integration fixture: one real OBS encoder/output, with both WHIP
// publication and local preview consumers. No screen permission is required.
#include "../preview-control.hpp"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <iostream>
#include <obs-module.h>
#include <graphics/vec4.h>
#include <thread>
#include <vector>
#include <util/base.h>
#ifdef _WIN32
#include <windows.h>
#endif
namespace fs = std::filesystem;
static std::atomic<uint64_t> renders{0}, redFrames{0};
static const char *fixtureName(void *) { return "Stream preview fixture"; }
static void *create(obs_data_t *, obs_source_t *) { return reinterpret_cast<void *>(1); }
static void destroy(void *) {}
static uint32_t width(void *) { return 1920; }
static uint32_t height(void *) { return 1080; }
static void render(void *, gs_effect_t *) {
  const auto time = std::chrono::steady_clock::now().time_since_epoch();
  const bool alternate = (std::chrono::duration_cast<std::chrono::milliseconds>(time).count() / 500) % 2;
  ++renders;
  if (alternate) ++redFrames;
  vec4 color;
  vec4_set(&color, alternate ? 0.8f : 0.1f, 0.2f, alternate ? 0.1f : 0.8f, 1);
  auto *effect = obs_get_base_effect(OBS_EFFECT_SOLID);
  gs_effect_set_vec4(gs_effect_get_param_by_name(effect, "color"), &color);
  while (gs_effect_loop(effect, "Solid")) gs_draw_sprite(nullptr, 0, 1920, 1080);
}
static void quiet(int, const char *, va_list, void *) {}
int main(int argc, char **argv) {
  if (argc != 4) return 2;
  const fs::path runtime = argv[1];
  const int fps = std::stoi(argv[2]);
  const std::string endpoint = argv[3];
  if ((fps != 30 && fps != 60) || endpoint.rfind("http://127.0.0.1:", 0) != 0) return 2;
#ifdef _WIN32
  // OBS loads plugin dependencies with LOAD_LIBRARY_SEARCH_DEFAULT_DIRS,
  // which deliberately ignores PATH. Match the production host's DLL root.
  if (!SetDllDirectoryW((runtime / "bin/64bit").c_str())) return 9;
#endif
  base_set_log_handler(quiet, nullptr);
  if (!obs_startup("en-US", nullptr, nullptr)) return 3;
#ifdef _WIN32
  const auto data = (runtime / "data/libobs").generic_string() + "/";
  const auto graphics = (runtime / "bin/64bit/libobs-d3d11.dll").generic_string();
  const char *encoderId = "obs_x264";
  const std::vector<std::string> modules{"obs-x264", "obs-webrtc"};
#else
  const auto data = (runtime / "Frameworks/libobs.framework/Resources").generic_string() + "/";
  const auto graphics = (runtime / "Frameworks/libobs-opengl.dylib").generic_string();
  const char *encoderId = "com.apple.videotoolbox.videoencoder.ave.avc";
  const std::vector<std::string> modules{"mac-videotoolbox", "obs-webrtc"};
#endif
  obs_add_data_path(data.c_str());
  obs_video_info video{};
  video.graphics_module = graphics.c_str();
  video.fps_num = fps; video.fps_den = 1;
  video.base_width = video.output_width = 1920;
  video.base_height = video.output_height = 1080;
  video.output_format = VIDEO_FORMAT_NV12;
  video.gpu_conversion = true;
  video.scale_type = OBS_SCALE_BICUBIC;
  video.colorspace = VIDEO_CS_709;
  video.range = VIDEO_RANGE_PARTIAL;
  if (obs_reset_video(&video) != OBS_VIDEO_SUCCESS) return 4;
  for (const auto &name : modules) {
#ifdef _WIN32
    const auto path = (runtime / "obs-plugins/64bit" / (name + ".dll")).generic_string();
    const auto assets = (runtime / "data/obs-plugins" / name).generic_string();
#else
    const auto path = (runtime / "PlugIns" / (name + ".plugin") / "Contents/MacOS" / name).generic_string();
    const auto assets = (runtime / "PlugIns" / (name + ".plugin") / "Contents/Resources").generic_string();
#endif
    obs_module_t *module = nullptr;
    const int opened = obs_open_module(&module, path.c_str(), assets.c_str());
    if (opened != MODULE_SUCCESS || !obs_init_module(module)) {
      std::cerr << "preview-module-load " << name << " " << opened << std::endl;
      return 5;
    }
  }
  obs_post_load_modules();
  obs_source_info fixture{};
  fixture.id = "cg_stream_fixture"; fixture.type = OBS_SOURCE_TYPE_INPUT;
  fixture.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW;
  fixture.get_name = fixtureName; fixture.create = create; fixture.destroy = destroy;
  fixture.get_width = width; fixture.get_height = height; fixture.video_render = render;
  obs_register_source(&fixture);
  auto *source = obs_source_create(fixture.id, "Preview source", nullptr, nullptr);
  auto *scene = obs_scene_create("Preview composition");
  auto *item = obs_scene_add(scene, source);
  obs_set_output_source(0, obs_scene_get_source(scene));
  auto *settings = obs_data_create();
  obs_data_set_int(settings, "bitrate", fps == 60 ? 8000 : 5000);
  obs_data_set_int(settings, "keyint_sec", 1);
  obs_data_set_string(settings, "rate_control", "CBR");
  obs_data_set_string(settings, "profile", "baseline");
  obs_data_set_string(settings, "preset", "veryfast");
  obs_data_set_string(settings, "tune", "zerolatency");
  obs_data_set_bool(settings, "repeat_headers", true);
  obs_data_set_int(settings, "bframes", 0);
  auto *encoder = obs_video_encoder_create(encoderId, "One shared encoder", settings, nullptr);
  obs_data_release(settings);
  if (!encoder) return 6;
  obs_encoder_set_video(encoder, obs_get_video());
  settings = obs_data_create();
  obs_data_set_string(settings, "server", endpoint.c_str());
  auto *service = obs_service_create("whip_custom", "Fixture WHIP", settings, nullptr);
  obs_data_release(settings);
  auto *output = obs_output_create("whip_output_video", "Shared encoded output", nullptr, nullptr);
  obs_output_set_video_encoder(output, encoder);
  obs_output_set_service(output, service);
  if (!obs_output_start(output)) return 7;
  std::string line;
  while (std::getline(std::cin, line)) {
    auto *command = obs_data_create_from_json(line.c_str());
    if (!command) return 8;
    auto *result = obs_data_create();
    try {
      const std::string type = obs_data_get_string(command, "type");
      if (type == "offer") {
        const auto offer = cinegather::previewControl(output, "start");
        obs_data_set_string(result, "sdp", offer.c_str());
      } else if (type == "answer") {
        cinegather::previewControl(output, "answer", obs_data_get_string(command, "sdp"));
      } else if (type == "pause") cinegather::previewControl(output, "stop");
      obs_data_set_int(result, "frames", obs_output_get_total_frames(output));
      obs_data_set_int(result, "renders", renders);
      obs_data_set_int(result, "redFrames", redFrames);
      obs_data_set_bool(result, "active", obs_output_active(output));
      cinegather::previewStats(output, result);
      auto *response = obs_data_create();
      obs_data_set_bool(response, "ok", true); obs_data_set_obj(response, "data", result);
      std::string json = obs_data_get_json(response);
      json.erase(std::remove(json.begin(), json.end(), '\n'), json.end());
      json.erase(std::remove(json.begin(), json.end(), '\r'), json.end());
      std::cout << json << std::endl;
      obs_data_release(response);
      if (type == "shutdown") { obs_data_release(result); obs_data_release(command); break; }
    } catch (...) { std::cout << "{\"ok\":false,\"error\":\"preview-fixture-failed\"}" << std::endl; }
    obs_data_release(result); obs_data_release(command);
  }
  obs_output_force_stop(output); obs_output_release(output);
  obs_service_release(service); obs_encoder_release(encoder);
  obs_set_output_source(0, nullptr);
  obs_sceneitem_remove(item); obs_source_remove(obs_scene_get_source(scene));
  obs_scene_release(scene); obs_source_remove(source); obs_source_release(source);
  obs_wait_for_destroy_queue(); obs_shutdown();
}
