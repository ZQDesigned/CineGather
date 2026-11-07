// Compile the production HWND source callbacks against a controllable graphics
// lock. A stalled video/driver thread must not stall command-thread size reads.
#include <atomic>
#include <cassert>
#include <chrono>
#include <cstdint>
#include <mutex>
#include <thread>
using HWND = uintptr_t;
using DWORD = unsigned;
struct obs_source_t {};
struct gs_effect_t {};
struct winrt_capture {};
constexpr int FALSE = 0, TRUE = 1;
static std::recursive_mutex graphics;
static winrt_capture capture;
static uint32_t frameWidth = 1920, frameHeight = 1080;
static bool iconic = false;
void obs_enter_graphics() { graphics.lock(); }
void obs_leave_graphics() { graphics.unlock(); }
bool IsWindow(HWND h) { return h == 12; }
DWORD windowPid(HWND) { return 34; }
bool ownProcess(DWORD) { return false; }
bool IsIconic(HWND) { return iconic; }
bool obs_source_showing(obs_source_t *) { return true; }
bool obs_source_enabled(obs_source_t *) { return true; }
uint64_t obs_data_get_int(void *, const char *) { return 0; }
using obs_data_t = void;
void winrt_capture_free(winrt_capture *) {}
winrt_capture *winrt_capture_init_window(int, HWND, int, int) {
  return &capture;
}
bool winrt_capture_active(winrt_capture *) { return true; }
void winrt_capture_render(winrt_capture *) {}
uint32_t winrt_capture_width(winrt_capture *c) { return c ? frameWidth : 0; }
uint32_t winrt_capture_height(winrt_capture *c) { return c ? frameHeight : 0; }
// Production progress declarations and exact window callbacks inserted here.
PRODUCTION_CALLBACKS
int main() {
  ExactWindow window{12, 34, nullptr};
  // Match the original incident: video/WinRT owns graphics while control asks
  // for source dimensions. The watchdog is independent of this blocked thread.
  std::atomic<bool> entered{false};
  std::mutex sourceFilter;
  sourceFilter.lock(); // OBS size queries hold the source's filter mutex.
  std::thread video([&] {
    graphics.lock();
    entered = true;
    sourceFilter.lock(); // Rendering uses graphics -> source filter order.
    sourceFilter.unlock();
    graphics.unlock();
  });
  while (!entered)
    std::this_thread::yield();
  std::atomic<bool> done{false};
  std::thread watchdog([&] {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    if (!done)
      std::_Exit(19);
  });
  assert(exactWidth(&window) == 0 && exactHeight(&window) == 0);
  done = true;
  sourceFilter.unlock();
  video.join();
  watchdog.join();
  exactTick(&window, 0);
  assert(exactWidth(&window) == 1920 && exactHeight(&window) == 1080);
  frameWidth = 1280;
  frameHeight = 720;
  exactTick(&window, 0);
  assert(exactWidth(&window) == 1280 && exactHeight(&window) == 720);
  iconic = true;
  exactTick(&window, 0);
  assert(exactWidth(&window) == 0 && exactHeight(&window) == 0);
}
