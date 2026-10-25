// Isolated Windows OBS host. The desktop renderer never receives native
// pointers.
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include "encoder-selection.hpp"
#include <algorithm>
#include <atomic>
#include <audioclient.h>
#include <cctype>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <dxgi1_2.h>
#include <filesystem>
#include <graphics/vec2.h>
#include <memory>
#include <mutex>
#include <obs-module.h>
#include <obs.h>
#include <regex>
#include <stdexcept>
#include <string>
#include <thread>
#include <tlhelp32.h>
#include <util/base.h>
#include <util/platform.h>
#include <vector>
#include <wincodec.h>
#include <wincrypt.h>
#include <windows.h>
#include <winrt-capture.h>
#include <wrl/client.h>
using Microsoft::WRL::ComPtr;
namespace fs = std::filesystem;
using Data = std::unique_ptr<obs_data_t, decltype(&obs_data_release)>;
using Array =
    std::unique_ptr<obs_data_array_t, decltype(&obs_data_array_release)>;
static Data data() { return Data(obs_data_create(), obs_data_release); }
static Array array() {
  return Array(obs_data_array_create(), obs_data_array_release);
}
static void check(bool ok, const char *error) {
  if (!ok)
    throw std::runtime_error(error);
}
static std::string utf8(const std::wstring &s) {
  if (s.empty())
    return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0,
                              nullptr, nullptr);
  std::string r(n, 0);
  WideCharToMultiByte(CP_UTF8, 0, s.data(), int(s.size()), r.data(), n, nullptr,
                      nullptr);
  return r;
}
static std::wstring wide(const std::string &s) {
  if (s.empty())
    return {};
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0);
  std::wstring r(n, 0);
  MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), r.data(), n);
  return r;
}
static fs::path executable() {
  wchar_t p[32768];
  DWORD n = GetModuleFileNameW(nullptr, p, 32768);
  check(n > 0 && n < 32768, "host-path");
  return fs::path(std::wstring(p, n));
}
static DWORD ownerPid;
static HANDLE ownerProcess;
static fs::path rootDir, working;
static obs_scene_t *scene;
static obs_source_t *videoSource, *audioSource;
static obs_encoder_t *videoEncoder, *audioEncoder;
static obs_service_t *service;
static obs_output_t *output;
static std::atomic<int> outputPhase{0}, stopCode{-1};
static uint64_t deadlineNs;
static uint64_t captureSequence = 0;
static int configuredWidth = 0, configuredHeight = 0, configuredFps = 0;
static bool engineReady = false, quitting = false, deviceFallback = false;
static std::string requestedEncoder = "auto", selectedEncoder, selectedBackend,
                   lastFailure;
struct Adapter {
  UINT index, vendor, device, subsys;
  std::string name, key;
};
static std::vector<Adapter> adapters;
struct Choice {
  std::string id, backend, obsId, name;
  int adapter;
  bool available;
};
static std::vector<Choice> choices;
struct Attempt {
  std::string id, backend, result;
};
static std::vector<Attempt> attempts;
struct EncoderError {
  std::string backend, stage, code;
  int64_t at;
};
static std::mutex errorMutex;
static std::vector<EncoderError> encoderErrors;
static std::atomic<bool> nvencRerouted{false};
static std::atomic<int> transportFailure{0}, transportHttpStatus{0},
    transportDetail{0};
static const char *transportStage() {
  switch (transportFailure.load()) {
  case 1:
    return "http-request";
  case 2:
    return "http-status";
  case 3:
    return "empty-answer";
  case 4:
    return "resource-url";
  case 5:
    return "invalid-sdp";
  case 6:
    return "ice";
  case 7:
    return "initialization";
  default:
    return "none";
  }
}
static void logging(int level, const char *format, va_list args, void *) {
  if (level > LOG_INFO)
    return;
  char buffer[4096];
  vsnprintf(buffer, sizeof(buffer), format, args);
  std::string text = buffer, lower = text;
  std::transform(lower.begin(), lower.end(), lower.begin(),
                 [](unsigned char c) { return char(std::tolower(c)); });
  if (lower.find("non-texture encoder") != std::string::npos &&
      lower.find("nvenc") != std::string::npos)
    nvencRerouted = true;
  if (lower.find("whip") != std::string::npos) {
    if (lower.find("did not provide a resource url") != std::string::npos)
      transportDetail = 1;
    if (lower.find("failed to build resource url") != std::string::npos)
      transportDetail = 2;
    if (lower.find("invalid resource url") != std::string::npos)
      transportDetail = 3;
    if (lower.find("response code") != std::string::npos) {
      transportFailure = 2;
      std::smatch match;
      if (std::regex_search(lower, match,
                            std::regex("response code ([0-9]{3})")))
        transportHttpStatus = std::stoi(match[1].str());
    } else if (lower.find("connect failed:") != std::string::npos)
      transportFailure = 1;
    else if (lower.find("no data returned") != std::string::npos)
      transportFailure = 3;
    else if (lower.find("resource url") != std::string::npos &&
             level <= LOG_WARNING)
      transportFailure = 4;
    else if (lower.find("invalid sdp") != std::string::npos ||
             lower.find("remote description") != std::string::npos)
      transportFailure = 5;
    else if (lower.find("state is now: failed") != std::string::npos)
      transportFailure = 6;
    else if (lower.find("error:") != std::string::npos)
      transportFailure = 7;
  }
  if (level > LOG_WARNING)
    return;
  std::string backend = lower.find("nvenc") != std::string::npos  ? "nvenc"
                        : lower.find("amf") != std::string::npos  ? "amf"
                        : lower.find("x264") != std::string::npos ? "x264"
                                                                  : "";
  if (backend.empty())
    return;
  std::string stage = lower.find("driver") != std::string::npos    ? "driver"
                      : lower.find("adapter") != std::string::npos ? "adapter"
                      : lower.find("session") != std::string::npos ? "session"
                      : lower.find("initial") != std::string::npos
                          ? "initialize"
                      : lower.find("format") != std::string::npos ||
                              lower.find("profile") != std::string::npos
                          ? "format"
                          : "encoder";
  std::smatch match;
  std::string code = "not-reported";
  if (std::regex_search(
          text, match,
          std::regex("(?:NV_ENC_ERR_[A-Z_]+|AMF_[A-Z_]+|0[xX][0-9A-Fa-f]{8})")))
    code = match.str();
  int64_t at = std::chrono::duration_cast<std::chrono::milliseconds>(
                   std::chrono::system_clock::now().time_since_epoch())
                   .count();
  std::lock_guard<std::mutex> lock(errorMutex);
  if (encoderErrors.size() == 32)
    encoderErrors.erase(encoderErrors.begin());
  encoderErrors.push_back({backend, stage, code, at});
} // Raw messages, window titles and WHIP credentials are never persisted.
static void rtcLog(int, const char *) {}
static void enumerateAdapters() {
  ComPtr<IDXGIFactory1> factory;
  check(SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory))),
        "dxgi-enumeration");
  for (UINT i = 0;; i++) {
    ComPtr<IDXGIAdapter1> a;
    if (factory->EnumAdapters1(i, &a) == DXGI_ERROR_NOT_FOUND)
      break;
    DXGI_ADAPTER_DESC1 d{};
    if (FAILED(a->GetDesc1(&d)) || (d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE))
      continue;
    std::string key = std::to_string(d.VendorId) + ":" +
                      std::to_string(d.DeviceId) + ":" +
                      std::to_string(d.SubSysId) + ":" + std::to_string(i);
    adapters.push_back(
        {i, d.VendorId, d.DeviceId, d.SubSysId, utf8(d.Description), key});
  }
}
static bool encoderExists(const char *id) {
  const char *name;
  for (size_t i = 0; obs_enum_encoder_types(i, &name); i++)
    if (std::strcmp(name, id) == 0)
      return true;
  return false;
}
static void refreshChoices() {
  choices.clear();
  for (const auto &a : adapters) {
    if (a.vendor == 0x10de)
      choices.push_back({"nvenc:" + a.key, "nvenc", "obs_nvenc_h264_tex",
                         "NVIDIA NVENC (" + a.name + ")", int(a.index),
                         encoderExists("obs_nvenc_h264_tex")});
    if (a.vendor == 0x1002)
      choices.push_back({"amf:" + a.key, "amf", "h264_texture_amf",
                         "AMD AMF (" + a.name + ")", int(a.index),
                         encoderExists("h264_texture_amf")});
  }
  choices.push_back({"x264", "x264", "obs_x264", "软件编码 (x264)", 0,
                     encoderExists("obs_x264")});
}
static Data encoderList() {
  auto result = data();
  auto list = array();
  for (const auto &c : choices) {
    auto row = data();
    obs_data_set_string(row.get(), "id", c.id.c_str());
    obs_data_set_string(row.get(), "name", c.name.c_str());
    obs_data_set_string(row.get(), "backend", c.backend.c_str());
    obs_data_set_bool(row.get(), "available", c.available);
    obs_data_set_bool(row.get(), "hardware", c.backend != "x264");
    obs_data_set_int(row.get(), "adapterIndex", c.adapter);
    obs_data_array_push_back(list.get(), row.get());
  }
  obs_data_set_array(result.get(), "encoders", list.get());
  auto cards = array();
  for (const auto &a : adapters) {
    auto row = data();
    obs_data_set_int(row.get(), "index", a.index);
    obs_data_set_int(row.get(), "vendorId", a.vendor);
    obs_data_set_int(row.get(), "deviceId", a.device);
    obs_data_set_string(row.get(), "name", a.name.c_str());
    obs_data_array_push_back(cards.get(), row.get());
  }
  obs_data_set_array(result.get(), "adapters", cards.get());
  return result;
}
static DWORD windowPid(HWND hwnd);
static DWORD windowPid(HWND hwnd) {
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  return pid;
}
static bool ownProcess(DWORD pid) {
  // Process tree is validated by executable identity as well as the exact
  // parent.
  if (pid == ownerPid || pid == GetCurrentProcessId())
    return true;
  HANDLE p = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!p)
    return true;
  wchar_t name[32768];
  DWORD size = 32768;
  bool own = false;
  if (QueryFullProcessImageNameW(p, 0, name, &size)) {
    std::wstring file = fs::path(std::wstring(name, size)).filename().wstring();
    own = _wcsicmp(file.c_str(), L"CineGather.exe") == 0 ||
          _wcsicmp(file.c_str(), L"CGScreenCaptureHost.exe") == 0;
  }
  CloseHandle(p);
  return own;
}
static std::string windowExe(HWND hwnd) {
  HANDLE p =
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, windowPid(hwnd));
  if (!p)
    return {};
  wchar_t name[32768];
  DWORD size = 32768;
  std::string out;
  if (QueryFullProcessImageNameW(p, 0, name, &size))
    out = utf8(fs::path(std::wstring(name, size)).filename().wstring());
  CloseHandle(p);
  return out;
}
struct Monitor {
  int64_t id;
  HMONITOR handle;
  std::string key, name;
};
static std::vector<Monitor> monitors;
static void refreshMonitors() {
  monitors.clear();
  obs_properties_t *props = obs_get_source_properties("monitor_capture");
  if (!props)
    return;
  obs_property_t *p = obs_properties_get(props, "monitor_id");
  if (p) {
    for (size_t i = 0; i < obs_property_list_item_count(p); i++) {
      const char *key = obs_property_list_item_string(p, i);
      if (!key || !*key)
        continue;
      uint32_t hash = 2166136261u;
      for (const char *x = key; *x; x++)
        hash = (hash ^ uint8_t(*x)) * 16777619u;
      monitors.push_back({int64_t(hash ? hash : 1), nullptr, key,
                          obs_property_list_item_name(p, i)});
    }
  }
  obs_properties_destroy(props);
}
static Data windows() {
  auto result = data();
  auto list = array();
  EnumWindows(
      [](HWND hwnd, LPARAM value) -> BOOL {
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd) ||
            !GetWindowTextLengthW(hwnd) || ownProcess(windowPid(hwnd)))
          return TRUE;
        auto row = data();
        wchar_t title[1024];
        GetWindowTextW(hwnd, title, 1024);
        std::string exe = windowExe(hwnd);
        if (exe.empty())
          return TRUE;
        obs_data_set_int(row.get(), "windowId",
                         int64_t(reinterpret_cast<uintptr_t>(hwnd)));
        obs_data_set_int(row.get(), "pid", windowPid(hwnd));
        obs_data_set_string(row.get(), "title", utf8(title).c_str());
        obs_data_set_string(row.get(), "application", exe.c_str());
        obs_data_set_string(row.get(), "bundleId", exe.c_str());
        obs_data_array_push_back(reinterpret_cast<obs_data_array_t *>(value),
                                 row.get());
        return TRUE;
      },
      reinterpret_cast<LPARAM>(list.get()));
  obs_data_set_array(result.get(), "windows", list.get());
  refreshMonitors();
  auto displays = array();
  for (const auto &m : monitors) {
    auto d = data();
    obs_data_set_int(d.get(), "displayId", m.id);
    obs_data_set_string(d.get(), "name", m.name.c_str());
    obs_data_array_push_back(displays.get(), d.get());
  }
  obs_data_set_array(result.get(), "displays", displays.get());
  return result;
}
// Pin capture to the selected HWND+PID rather than OBS title matching, which
// can otherwise switch to a different same-title window of the same app.
struct ExactWindow {
  HWND hwnd;
  DWORD pid;
  obs_source_t *source;
  winrt_capture *capture = nullptr;
  bool tried = false;
};
static void *exactCreate(obs_data_t *settings, obs_source_t *source) {
  auto hwnd =
      reinterpret_cast<HWND>(uintptr_t(obs_data_get_int(settings, "windowId")));
  DWORD pid = DWORD(obs_data_get_int(settings, "pid"));
  if (!IsWindow(hwnd) || windowPid(hwnd) != pid || ownProcess(pid))
    return nullptr;
  return new ExactWindow{hwnd, pid, source};
}
static void exactHide(void *raw) {
  auto *w = static_cast<ExactWindow *>(raw);
  if (w->capture) {
    obs_enter_graphics();
    winrt_capture_free(w->capture);
    obs_leave_graphics();
    w->capture = nullptr;
  }
  w->tried = false;
}
static void exactTick(void *raw, float) {
  auto *w = static_cast<ExactWindow *>(raw);
  if (!obs_source_showing(w->source) || !obs_source_enabled(w->source) ||
      !IsWindow(w->hwnd) || windowPid(w->hwnd) != w->pid || IsIconic(w->hwnd)) {
    exactHide(raw);
    return;
  }
  if (!w->capture && !w->tried) {
    w->tried = true;
    obs_enter_graphics();
    w->capture = winrt_capture_init_window(FALSE, w->hwnd, TRUE, TRUE);
    obs_leave_graphics();
  }
}
static void exactDestroy(void *raw) {
  exactHide(raw);
  delete static_cast<ExactWindow *>(raw);
}
static void exactRender(void *raw, gs_effect_t *) {
  auto *w = static_cast<ExactWindow *>(raw);
  if (IsWindow(w->hwnd) && windowPid(w->hwnd) == w->pid && w->capture &&
      winrt_capture_active(w->capture))
    winrt_capture_render(w->capture);
}
static uint32_t exactWidth(void *raw) {
  auto *w = static_cast<ExactWindow *>(raw);
  return w->capture ? winrt_capture_width(w->capture) : 0;
}
static uint32_t exactHeight(void *raw) {
  auto *w = static_cast<ExactWindow *>(raw);
  return w->capture ? winrt_capture_height(w->capture) : 0;
}
static HMONITOR monitorHandle(const std::string &key) {
  struct State {
    const std::string *key;
    HMONITOR found;
  } state{&key, nullptr};
  EnumDisplayMonitors(
      nullptr, nullptr,
      [](HMONITOR m, HDC, LPRECT, LPARAM raw) -> BOOL {
        auto *state = reinterpret_cast<State *>(raw);
        MONITORINFOEXA info{};
        info.cbSize = sizeof(info);
        DISPLAY_DEVICEA device{};
        device.cb = sizeof(device);
        if (GetMonitorInfoA(m, &info) &&
            (EnumDisplayDevicesA(info.szDevice, 0, &device,
                                 EDD_GET_DEVICE_INTERFACE_NAME) &&
                 *state->key == device.DeviceID ||
             *state->key == info.szDevice)) {
          state->found = m;
          return FALSE;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&state));
  return state.found;
}
static std::string jpeg(HBITMAP bitmap, int width, int height) {
  ComPtr<IWICImagingFactory> factory;
  ComPtr<IWICBitmap> image;
  ComPtr<IWICFormatConverter> converter;
  ComPtr<IWICBitmapEncoder> encoder;
  ComPtr<IWICBitmapFrameEncode> frame;
  ComPtr<IStream> stream;
  check(
      SUCCEEDED(CoCreateInstance(CLSID_WICImagingFactory, nullptr,
                                 CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&factory))),
      "preview-factory");
  check(SUCCEEDED(factory->CreateBitmapFromHBITMAP(
            bitmap, nullptr, WICBitmapIgnoreAlpha, &image)),
        "preview-image");
  check(SUCCEEDED(factory->CreateFormatConverter(&converter)),
        "preview-converter");
  check(SUCCEEDED(converter->Initialize(
            image.Get(), GUID_WICPixelFormat24bppBGR, WICBitmapDitherTypeNone,
            nullptr, 0, WICBitmapPaletteTypeCustom)),
        "preview-format");
  check(SUCCEEDED(CreateStreamOnHGlobal(nullptr, TRUE, &stream)),
        "preview-stream");
  check(SUCCEEDED(factory->CreateEncoder(GUID_ContainerFormatJpeg, nullptr,
                                         &encoder)),
        "preview-encoder");
  check(SUCCEEDED(encoder->Initialize(stream.Get(), WICBitmapEncoderNoCache)),
        "preview-encoder-init");
  check(SUCCEEDED(encoder->CreateNewFrame(&frame, nullptr)), "preview-frame");
  check(SUCCEEDED(frame->Initialize(nullptr)), "preview-frame-init");
  frame->SetSize(width, height);
  WICPixelFormatGUID format = GUID_WICPixelFormat24bppBGR;
  frame->SetPixelFormat(&format);
  check(SUCCEEDED(frame->WriteSource(converter.Get(), nullptr)) &&
            SUCCEEDED(frame->Commit()) && SUCCEEDED(encoder->Commit()),
        "preview-encode");
  HGLOBAL mem = nullptr;
  check(SUCCEEDED(GetHGlobalFromStream(stream.Get(), &mem)), "preview-memory");
  STATSTG stat{};
  stream->Stat(&stat, STATFLAG_NONAME);
  check(stat.cbSize.QuadPart < 40000, "preview-size");
  auto *bytes = static_cast<BYTE *>(GlobalLock(mem));
  DWORD size = 0;
  CryptBinaryToStringA(bytes, DWORD(stat.cbSize.QuadPart),
                       CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, nullptr,
                       &size);
  std::string encoded(size, 0);
  CryptBinaryToStringA(bytes, DWORD(stat.cbSize.QuadPart),
                       CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF,
                       encoded.data(), &size);
  GlobalUnlock(mem);
  if (!encoded.empty() && encoded.back() == 0)
    encoded.pop_back();
  return "data:image/jpeg;base64," + encoded;
}
static std::string thumbnail(obs_data_t *request) {
  HDC screen = GetDC(nullptr);
  HDC sourceDC = nullptr, target = CreateCompatibleDC(screen);
  HBITMAP sourceBitmap = nullptr, targetBitmap = nullptr;
  std::string encoded;
  HGDIOBJ oldSource = nullptr, oldTarget = nullptr;
  try {
    RECT rect{};
    bool window = obs_data_has_user_value(request, "windowId");
    HWND hwnd = nullptr;
    if (window) {
      hwnd = reinterpret_cast<HWND>(
          uintptr_t(obs_data_get_int(request, "windowId")));
      check(IsWindow(hwnd) &&
                windowPid(hwnd) == DWORD(obs_data_get_int(request, "pid")) &&
                !ownProcess(windowPid(hwnd)),
            "preview-window");
      check(GetWindowRect(hwnd, &rect), "preview-bounds");
    } else {
      refreshMonitors();
      int64_t id = obs_data_get_int(request, "displayId");
      auto found = std::find_if(monitors.begin(), monitors.end(),
                                [&](const Monitor &m) { return m.id == id; });
      check(found != monitors.end(), "preview-display");
      MONITORINFO info{};
      info.cbSize = sizeof(info);
      check(GetMonitorInfo(monitorHandle(found->key), &info),
            "preview-monitor");
      rect = info.rcMonitor;
    }
    int w = rect.right - rect.left, h = rect.bottom - rect.top;
    check(w > 0 && h > 0 && w <= 8192 && h <= 8192 &&
              int64_t(w) * h <= 20000000,
          "preview-dimensions");
    double scale = std::min(224.0 / w, 144.0 / h);
    int width = std::max(1, int(w * scale)),
        height = std::max(1, int(h * scale));
    targetBitmap = CreateCompatibleBitmap(screen, width, height);
    check(target && targetBitmap, "preview-dc");
    oldTarget = SelectObject(target, targetBitmap);
    SetStretchBltMode(target, HALFTONE);
    if (window) {
      sourceDC = CreateCompatibleDC(screen);
      sourceBitmap = CreateCompatibleBitmap(screen, w, h);
      check(sourceDC && sourceBitmap, "preview-source");
      oldSource = SelectObject(sourceDC, sourceBitmap);
      check(PrintWindow(hwnd, sourceDC, 2), "preview-print");
      check(StretchBlt(target, 0, 0, width, height, sourceDC, 0, 0, w, h,
                       SRCCOPY),
            "preview-scale");
    } else
      check(StretchBlt(target, 0, 0, width, height, screen, rect.left, rect.top,
                       w, h, SRCCOPY | CAPTUREBLT),
            "preview-screen");
    encoded = jpeg(targetBitmap, width, height);
  } catch (...) {
    encoded.clear();
  }
  if (oldSource)
    SelectObject(sourceDC, oldSource);
  if (oldTarget)
    SelectObject(target, oldTarget);
  if (sourceBitmap)
    DeleteObject(sourceBitmap);
  if (targetBitmap)
    DeleteObject(targetBitmap);
  if (sourceDC)
    DeleteDC(sourceDC);
  if (target)
    DeleteDC(target);
  ReleaseDC(nullptr, screen);
  return encoded;
}
static Data thumbnails(obs_data_t *command) {
  auto result = data();
  auto out = array();
  Array requests(obs_data_get_array(command, "sources"),
                 obs_data_array_release);
  check(requests && obs_data_array_count(requests.get()) <= 4, "preview-count");
  for (size_t i = 0; i < obs_data_array_count(requests.get()); i++) {
    Data request(obs_data_array_item(requests.get(), i), obs_data_release);
    auto row = data();
    obs_data_set_string(row.get(), "id",
                        obs_data_get_string(request.get(), "id"));
    obs_data_set_string(row.get(), "thumbnail",
                        thumbnail(request.get()).c_str());
    obs_data_array_push_back(out.get(), row.get());
  }
  obs_data_set_array(result.get(), "items", out.get());
  return result;
}
// Audio stays in its existing isolated WASAPI helper. Its QPC timestamps use
// the same clock as OBS video; job cleanup prevents capture surviving this
// host.
struct ProcessAudio {
  obs_source_t *source;
  HANDLE job = nullptr, process = nullptr, pipe = nullptr, control = nullptr;
  std::thread reader;
  std::atomic<bool> failed{false};
  std::atomic<uint64_t> frames{0}, timestampFallbacks{0}, delayNs{0};
};
static bool readAll(HANDLE pipe, void *dst, DWORD size) {
  auto *bytes = static_cast<uint8_t *>(dst);
  while (size) {
    DWORD n = 0;
    if (!ReadFile(pipe, bytes, size, &n, nullptr) || !n)
      return false;
    size -= n;
    bytes += n;
  }
  return true;
}
static void destroyAudio(void *raw) {
  auto *a = static_cast<ProcessAudio *>(raw);
  if (a->job)
    TerminateJobObject(a->job, 0);
  if (a->reader.joinable())
    a->reader.join();
  if (a->pipe)
    CloseHandle(a->pipe);
  if (a->control)
    CloseHandle(a->control);
  if (a->process)
    CloseHandle(a->process);
  if (a->job)
    CloseHandle(a->job);
  delete a;
}
static ProcessAudio *launchAudio(obs_source_t *source, const char *mode,
                                 uint64_t hwnd) {
  auto *a = new ProcessAudio{source};
  HANDLE outRead = nullptr, outWrite = nullptr, errRead = nullptr,
         errWrite = nullptr, inputRead = nullptr;
  SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, TRUE};
  if (!CreatePipe(&outRead, &outWrite, &sa, 0) ||
      !CreatePipe(&errRead, &errWrite, &sa, 0) ||
      !CreatePipe(&inputRead, &a->control, &sa, 0)) {
    if (outRead)
      CloseHandle(outRead);
    if (outWrite)
      CloseHandle(outWrite);
    if (errRead)
      CloseHandle(errRead);
    if (errWrite)
      CloseHandle(errWrite);
    if (inputRead)
      CloseHandle(inputRead);
    if (a->control)
      CloseHandle(a->control);
    delete a;
    return nullptr;
  }
  SetHandleInformation(a->control, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(errRead, HANDLE_FLAG_INHERIT, 0);
  a->job = CreateJobObjectW(nullptr, nullptr);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!a->job ||
      !SetInformationJobObject(a->job, JobObjectExtendedLimitInformation,
                               &limits, sizeof(limits))) {
    CloseHandle(outRead);
    CloseHandle(outWrite);
    CloseHandle(errRead);
    CloseHandle(errWrite);
    CloseHandle(inputRead);
    destroyAudio(a);
    return nullptr;
  }
  std::wstring command =
      L"\"" +
      (executable().parent_path() / L"CGProcessAudioHost.exe").wstring() +
      L"\" " + wide(mode) + L" " + std::to_wstring(hwnd) + L" " +
      std::to_wstring(ownerPid);
  STARTUPINFOW si{};
  si.cb = sizeof(si);
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = outWrite;
  si.hStdError = errWrite;
  si.hStdInput = inputRead;
  PROCESS_INFORMATION pi{};
  bool launched = CreateProcessW(nullptr, command.data(), nullptr, nullptr,
                                 TRUE, CREATE_NO_WINDOW | CREATE_SUSPENDED,
                                 nullptr, nullptr, &si, &pi) != FALSE;
  CloseHandle(inputRead);
  CloseHandle(outWrite);
  CloseHandle(errWrite);
  if (launched && !AssignProcessToJobObject(a->job, pi.hProcess)) {
    TerminateProcess(pi.hProcess, 1);
    launched = false;
  }
  if (launched) {
    a->process = pi.hProcess;
    ResumeThread(pi.hThread);
  } else if (pi.hProcess)
    CloseHandle(pi.hProcess);
  if (pi.hThread)
    CloseHandle(pi.hThread);
  bool ready = false;
  std::string error;
  const auto until = std::chrono::steady_clock::now() + std::chrono::seconds(3);
  while (launched && std::chrono::steady_clock::now() < until) {
    DWORD available = 0;
    if (PeekNamedPipe(errRead, nullptr, 0, nullptr, &available, nullptr) &&
        available) {
      char bytes[256];
      DWORD got = 0;
      if (ReadFile(errRead, bytes, std::min<DWORD>(available, 256), &got,
                   nullptr))
        error.append(bytes, got);
      if (error.find("READY") != std::string::npos) {
        ready = true;
        break;
      }
      if (error.find("ERROR") != std::string::npos)
        break;
    }
    if (WaitForSingleObject(a->process, 0) == WAIT_OBJECT_0)
      break;
    Sleep(10);
  }
  CloseHandle(errRead);
  if (!ready) {
    CloseHandle(outRead);
    destroyAudio(a);
    return nullptr;
  }
  a->pipe = outRead;
  a->reader = std::thread([a]() {
    uint32_t bytes, flags;
    uint64_t timestamp;
    while (readAll(a->pipe, &bytes, 4) && readAll(a->pipe, &flags, 4) &&
           readAll(a->pipe, &timestamp, 8)) {
      if (!bytes || bytes > 192000 || bytes % 4)
        break;
      std::vector<uint8_t> pcm(bytes);
      if (!readAll(a->pipe, pcm.data(), bytes))
        break;
      obs_source_audio packet{};
      packet.data[0] = pcm.data();
      packet.frames = bytes / 4;
      packet.speakers = SPEAKERS_STEREO;
      packet.format = AUDIO_FORMAT_16BIT;
      packet.samples_per_sec = 48000;
      const uint64_t now = os_gettime_ns();
      if (!timestamp || (flags & AUDCLNT_BUFFERFLAGS_TIMESTAMP_ERROR)) {
        packet.timestamp = now;
        a->timestampFallbacks++;
      } else
        packet.timestamp = timestamp * 100;
      a->frames += packet.frames;
      a->delayNs = now > packet.timestamp ? now - packet.timestamp : 0;
      obs_source_output_audio(a->source, &packet);
    }
    a->failed = true;
  });
  return a;
}
static void *createAudio(obs_data_t *settings, obs_source_t *source) {
  uint64_t hwnd = obs_data_get_int(settings, "windowId");
  auto *a = launchAudio(source, hwnd ? "window" : "screen", hwnd);
  if (!a) {
    a = launchAudio(source, "device", hwnd);
    if (a)
      deviceFallback = true;
  }
  return a;
}
static const char *audioName(void *) { return "CineGather process audio"; }
static uint32_t patternWidth(void *) { return 1920; }
static uint32_t patternHeight(void *) { return 1080; }
static void *patternCreate(obs_data_t *, obs_source_t *) {
  return reinterpret_cast<void *>(1);
}
static void patternDestroy(void *) {}
static void patternRender(void *, gs_effect_t *) {
  vec4 color;
  vec4_set(&color, 0.25f, 0.35f, 0.6f, 1);
  gs_effect_t *effect = obs_get_base_effect(OBS_EFFECT_SOLID);
  gs_effect_set_vec4(gs_effect_get_param_by_name(effect, "color"), &color);
  while (gs_effect_loop(effect, "Solid"))
    gs_draw_sprite(nullptr, 0, 1920, 1080);
}
static void outputStarted(void *, calldata_t *) { outputPhase = 2; }
static void outputStopped(void *, calldata_t *d) {
  stopCode = int(calldata_int(d, "code"));
  outputPhase = 3;
}
static void stopCapture() {
  // Detach/release capture before waiting on WHIP signaling teardown.
  if (videoSource)
    obs_source_set_enabled(videoSource, false);
  if (audioSource)
    obs_source_set_muted(audioSource, true);
  obs_set_output_source(0, nullptr);
  if (scene) {
    obs_scene_release(scene);
    scene = nullptr;
  }
  if (videoSource) {
    obs_source_release(videoSource);
    videoSource = nullptr;
  }
  if (audioSource) {
    auto *a = static_cast<ProcessAudio *>(obs_obj_get_data(audioSource));
    if (a && a->job)
      TerminateJobObject(a->job, 0);
    obs_source_release(audioSource);
    audioSource = nullptr;
  }
  if (output) {
    signal_handler_disconnect(obs_output_get_signal_handler(output), "start",
                              outputStarted, nullptr);
    signal_handler_disconnect(obs_output_get_signal_handler(output), "stop",
                              outputStopped, nullptr);
    obs_output_force_stop(output);
    obs_output_release(output);
    output = nullptr;
  }
  if (service) {
    obs_service_release(service);
    service = nullptr;
  }
  if (videoEncoder) {
    obs_encoder_release(videoEncoder);
    videoEncoder = nullptr;
  }
  if (audioEncoder) {
    obs_encoder_release(audioEncoder);
    audioEncoder = nullptr;
  }
  deadlineNs = 0;
  outputPhase = 0;
}
static Data status() {
  auto d = data();
  obs_data_set_string(d.get(), "transportFailure", transportStage());
  obs_data_set_string(d.get(), "transportDetail",
                      transportDetail == 1   ? "missing-location"
                      : transportDetail == 2 ? "relative-base"
                      : transportDetail == 3 ? "invalid-resource"
                                             : "none");
  obs_data_set_int(d.get(), "transportHttpStatus", transportHttpStatus);
  obs_data_set_int(d.get(), "captureSequence", captureSequence);
  obs_data_set_int(d.get(), "configuredWidth", configuredWidth);
  obs_data_set_int(d.get(), "configuredHeight", configuredHeight);
  obs_data_set_int(d.get(), "configuredFps", configuredFps);
  obs_data_set_bool(d.get(), "screenPermission", true);
  obs_data_set_string(d.get(), "outputPhase",
                      outputPhase == 2   ? "active"
                      : outputPhase == 1 ? "starting"
                      : outputPhase == 3 ? "failed"
                                         : "stopped");
  obs_data_set_int(d.get(), "sourceWidth",
                   videoSource ? obs_source_get_width(videoSource) : 0);
  obs_data_set_int(d.get(), "sourceHeight",
                   videoSource ? obs_source_get_height(videoSource) : 0);
  obs_data_set_bool(d.get(), "sourcesActive", videoSource != nullptr);
  obs_data_set_bool(d.get(), "outputActive",
                    output && obs_output_active(output));
  obs_data_set_bool(d.get(), "videoSourceActive",
                    videoSource && obs_source_active(videoSource));
  obs_data_set_bool(d.get(), "audioSourceActive",
                    audioSource && obs_source_active(audioSource));
  obs_data_set_string(d.get(), "requestedEncoder", requestedEncoder.c_str());
  obs_data_set_string(d.get(), "selectedEncoder", selectedEncoder.c_str());
  obs_data_set_string(d.get(), "encoderBackend", selectedBackend.c_str());
  obs_data_set_bool(d.get(), "hardwareEncoder",
                    !selectedBackend.empty() && selectedBackend != "x264");
  obs_data_set_bool(d.get(), "deviceAudioFallback", deviceFallback);
  obs_data_set_string(d.get(), "encoderFailure", lastFailure.c_str());
  obs_data_set_int(d.get(), "outputStopCode", stopCode);
  obs_data_set_double(d.get(), "activeFps", obs_get_active_fps());
  if (output) {
    obs_data_set_int(d.get(), "outputTotalFrames",
                     obs_output_get_total_frames(output));
    obs_data_set_int(d.get(), "outputSkippedFrames",
                     obs_output_get_frames_dropped(output));
    obs_data_set_int(d.get(), "outputBytes",
                     obs_output_get_total_bytes(output));
    obs_data_set_double(d.get(), "outputCongestion",
                        obs_output_get_congestion(output));
  }
  obs_data_set_double(d.get(), "averageFrameRenderTime",
                      obs_get_average_frame_time_ns());
  obs_data_set_int(d.get(), "renderTotalFrames", obs_get_total_frames());
  obs_data_set_int(d.get(), "renderSkippedFrames", obs_get_lagged_frames());
  if (audioSource) {
    auto *a = static_cast<ProcessAudio *>(obs_obj_get_data(audioSource));
    if (a) {
      obs_data_set_int(d.get(), "audioFramesCaptured", a->frames);
      obs_data_set_int(d.get(), "audioTimestampFallbacks",
                       a->timestampFallbacks);
      obs_data_set_double(d.get(), "audioCaptureDelayMs",
                          double(a->delayNs) / 1e6);
    }
    if (a && a->failed)
      obs_data_set_string(d.get(), "audioCaptureError",
                          "声音采集已中断，请重新共享");
  }
  auto list = array();
  for (const auto &attempt : attempts) {
    auto row = data();
    obs_data_set_string(row.get(), "id", attempt.id.c_str());
    obs_data_set_string(row.get(), "backend", attempt.backend.c_str());
    obs_data_set_string(row.get(), "result", attempt.result.c_str());
    obs_data_array_push_back(list.get(), row.get());
  }
  obs_data_set_array(d.get(), "encoderAttempts", list.get());
  auto errors = array();
  {
    std::lock_guard<std::mutex> lock(errorMutex);
    for (const auto &e : encoderErrors) {
      auto row = data();
      obs_data_set_string(row.get(), "backend", e.backend.c_str());
      obs_data_set_string(row.get(), "stage", e.stage.c_str());
      obs_data_set_string(row.get(), "code", e.code.c_str());
      obs_data_set_int(row.get(), "at", e.at);
      obs_data_array_push_back(errors.get(), row.get());
    }
  }
  obs_data_set_array(d.get(), "encoderErrors", errors.get());
  return d;
}
static void resetVideo(int adapter, int width, int height, int fps) {
  obs_video_info vi{};
  std::string graphics = (rootDir / "bin/64bit/libobs-d3d11.dll").u8string();
  vi.graphics_module = graphics.c_str();
  vi.adapter = adapter;
  vi.fps_num = fps;
  vi.fps_den = 1;
  vi.base_width = vi.output_width = width;
  vi.base_height = vi.output_height = height;
  vi.output_format = VIDEO_FORMAT_NV12;
  vi.gpu_conversion = true;
  vi.colorspace = VIDEO_CS_709;
  vi.range = VIDEO_RANGE_PARTIAL;
  vi.scale_type = OBS_SCALE_BICUBIC;
  check(obs_reset_video(&vi) == OBS_VIDEO_SUCCESS, "graphics-initialization");
}
static void createVideoEncoder(const Choice &c, int bitrate) {
  auto settings = data();
  obs_data_set_string(settings.get(), "rate_control", "CBR");
  obs_data_set_int(settings.get(), "bitrate", bitrate);
  obs_data_set_int(settings.get(), "keyint_sec", 1);
  obs_data_set_string(settings.get(), "profile", "baseline");
  obs_data_set_int(settings.get(), "bf", 0);
  obs_data_set_int(settings.get(), "bframes", 0);
  obs_data_set_bool(settings.get(), "lookahead", false);
  obs_data_set_bool(settings.get(), "psycho_aq", false);
  obs_data_set_string(settings.get(), "preset",
                      c.backend == "x264"  ? "veryfast"
                      : c.backend == "amf" ? "balanced"
                                           : "p4");
  obs_data_set_bool(settings.get(), "pre_analysis", false);
  obs_data_set_string(settings.get(), "tune",
                      c.backend == "x264" ? "zerolatency" : "ll");
  videoEncoder = obs_video_encoder_create(c.obsId.c_str(), "CineGather H264",
                                          settings.get(), nullptr);
  check(videoEncoder, "encoder-create");
  obs_encoder_set_video(videoEncoder, obs_get_video());
}
static void startCapture(obs_data_t *config, bool synthetic = false) {
  check(!output, "already-sharing");
  ++captureSequence;
  transportFailure = 0;
  transportHttpStatus = 0;
  transportDetail = 0;
  requestedEncoder = obs_data_get_string(config, "encoder");
  if (requestedEncoder.empty())
    requestedEncoder = "auto";
  attempts.clear();
  lastFailure.clear();
  selectedEncoder.clear();
  selectedBackend.clear();
  auto options = cinegather::encoderCandidates(choices, requestedEncoder);
  const std::string server = obs_data_get_string(config, "server");
  const bool localWhip = synthetic && server.rfind("http://127.0.0.1:", 0) == 0;
  check(!synthetic || server.empty() || localWhip, "probe-endpoint");
  const std::string quality = obs_data_get_string(config, "quality");
  int width = quality == "saver" ? 1280 : 1920,
      height = quality == "saver" ? 720 : 1080,
      fps = quality == "game" ? 60 : 30,
      bitrate = quality == "saver"  ? 2000
                : quality == "game" ? 8000
                                    : 5000;
  configuredWidth = width;
  configuredHeight = height;
  configuredFps = fps;
  for (const auto &c : options) {
    try {
      check(c.available, "encoder-unavailable");
      resetVideo(c.adapter, width, height, fps);
      deviceFallback = false;
      scene = obs_scene_create("CineGather native scene");
      check(scene, "scene-create");
      auto settings = data();
      if (synthetic)
        videoSource =
            obs_source_create("cg_test_pattern", "CineGather synthetic pattern",
                              settings.get(), nullptr);
      else if (obs_data_has_user_value(config, "displayId")) {
        refreshMonitors();
        int64_t id = obs_data_get_int(config, "displayId");
        auto found = std::find_if(monitors.begin(), monitors.end(),
                                  [&](const Monitor &m) { return m.id == id; });
        check(found != monitors.end(), "display-unavailable");
        obs_data_set_string(settings.get(), "monitor_id", found->key.c_str());
        obs_data_set_bool(settings.get(), "capture_cursor", false);
        obs_data_set_int(settings.get(), "method", 2);
        videoSource = obs_source_create("monitor_capture", "CineGather screen",
                                        settings.get(), nullptr);
      } else {
        auto hwnd = reinterpret_cast<HWND>(
            uintptr_t(obs_data_get_int(config, "windowId")));
        check(IsWindow(hwnd) &&
                  windowPid(hwnd) == DWORD(obs_data_get_int(config, "pid")) &&
                  !ownProcess(windowPid(hwnd)),
              "window-unavailable");
        obs_data_set_int(settings.get(), "windowId", int64_t(uintptr_t(hwnd)));
        obs_data_set_int(settings.get(), "pid", windowPid(hwnd));
        videoSource = obs_source_create("cg_hwnd_capture", "CineGather window",
                                        settings.get(), nullptr);
      }
      check(videoSource, "source-create");
      obs_source_set_muted(videoSource, true);
      auto *item = obs_scene_add(scene, videoSource);
      obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
      vec2 bounds;
      vec2_set(&bounds, float(width), float(height));
      obs_sceneitem_set_bounds(item, &bounds);
      obs_set_output_source(0, obs_scene_get_source(scene));
      createVideoEncoder(c, bitrate);
      if (!synthetic && obs_data_get_bool(config, "systemAudio")) {
        audioSource = obs_source_create(
            "cg_process_audio", "CineGather shared audio", config, nullptr);
        check(audioSource && obs_obj_get_data(audioSource),
              "audio-initialization");
        obs_source_set_audio_mixers(audioSource, 1);
        obs_scene_add(scene, audioSource);
        auto audioSettings = data();
        obs_data_set_int(audioSettings.get(), "bitrate", 160);
        audioEncoder = obs_audio_encoder_create(
            "ffmpeg_opus", "CineGather Opus", audioSettings.get(), 0, nullptr);
        check(audioEncoder, "opus-create");
        obs_encoder_set_audio(audioEncoder, obs_get_audio());
      }
      auto serviceSettings = data();
      obs_data_set_string(serviceSettings.get(), "server",
                          obs_data_get_string(config, "server"));
      obs_data_set_string(serviceSettings.get(), "bearer_token",
                          obs_data_get_string(config, "token"));
      if (!synthetic || localWhip) {
        service = obs_service_create("whip_custom", "CineGather WHIP",
                                     serviceSettings.get(), nullptr);
        check(service, "whip-service");
      }
      output = obs_output_create(synthetic && !localWhip ? "cg_packet_probe"
                                 : audioEncoder          ? "whip_output"
                                                         : "whip_output_video",
                                 "CineGather native output", nullptr, nullptr);
      check(output, "output-create");
      obs_output_set_video_encoder(output, videoEncoder);
      if (audioEncoder)
        obs_output_set_audio_encoder(output, audioEncoder, 0);
      if (service)
        obs_output_set_service(output, service);
      signal_handler_connect(obs_output_get_signal_handler(output), "start",
                             outputStarted, nullptr);
      signal_handler_connect(obs_output_get_signal_handler(output), "stop",
                             outputStopped, nullptr);
      outputPhase = 1;
      stopCode = -1;
      nvencRerouted = false;
      check(obs_output_initialize_encoders(output, 0),
            "encoder-initialization");
      check(c.backend != "nvenc" || !nvencRerouted, "encoder-adapter-reroute");
      check(obs_output_start(output), "encoder-initialization");
      selectedEncoder = c.id;
      selectedBackend = c.backend;
      attempts.push_back({c.id, c.backend, "started"});
      return;
    } catch (const std::exception &e) {
      lastFailure = e.what();
      attempts.push_back({c.id, c.backend, lastFailure});
      stopCapture();
      if (requestedEncoder != "auto" ||
          !cinegather::retryEncoderFailure(lastFailure))
        throw;
    }
  }
  throw std::runtime_error("all-encoders-failed");
}
struct Probe {
  obs_output_t *output;
  std::atomic<uint64_t> frames{0}, bytes{0};
};
static const char *probeName(void *) { return "CineGather packet probe"; }
static void *probeCreate(obs_data_t *, obs_output_t *o) { return new Probe{o}; }
static void probeDestroy(void *p) { delete static_cast<Probe *>(p); }
static bool probeStart(void *p) {
  auto *q = static_cast<Probe *>(p);
  if (!obs_output_initialize_encoders(q->output, 0))
    return false;
  obs_output_begin_data_capture(q->output, 0);
  return true;
}
static void probeStop(void *p, uint64_t) {
  auto *q = static_cast<Probe *>(p);
  obs_output_end_data_capture(q->output);
  obs_output_signal_stop(q->output, OBS_OUTPUT_SUCCESS);
}
static void probePacket(void *p, encoder_packet *packet) {
  if (packet) {
    auto *q = static_cast<Probe *>(p);
    q->frames++;
    q->bytes += packet->size;
  }
}
static Data runProbe(obs_data_t *config) {
  auto result = data();
  if (output) {
    obs_data_set_string(result.get(), "status", "skipped-sharing");
    return result;
  }
  obs_data_set_string(config, "quality", "cinema");
  try {
    startCapture(config, true);
    const bool localWhip =
        std::strlen(obs_data_get_string(config, "server")) > 0;
    auto *p =
        localWhip ? nullptr : static_cast<Probe *>(obs_obj_get_data(output));
    auto frames = [&]() {
      return p ? p->frames.load()
               : uint64_t(obs_output_get_total_frames(output));
    };
    uint64_t end =
        os_gettime_ns() + (localWhip ? 8000000000ull : 3000000000ull);
    while (os_gettime_ns() < end && frames() < 45 &&
           WaitForSingleObject(ownerProcess, 0) == WAIT_TIMEOUT &&
           outputPhase != 3)
      Sleep(10);
    obs_data_set_string(result.get(), "status",
                        frames() >= 30 ? "ok" : "timeout");
    obs_data_set_int(result.get(), "framesEncoded", frames());
    obs_data_set_int(result.get(), "bytesEncoded",
                     p ? p->bytes.load() : obs_output_get_total_bytes(output));
    obs_data_set_int(result.get(), "width", 1920);
    obs_data_set_int(result.get(), "height", 1080);
    obs_data_set_int(result.get(), "targetFps", 30);
    obs_data_set_bool(result.get(), "synthetic", true);
    auto snapshot = status();
    obs_data_set_obj(result.get(), "encoder", snapshot.get());
  } catch (const std::exception &e) {
    obs_data_set_string(result.get(), "status", "failed");
    obs_data_set_string(result.get(), "reason", e.what());
    auto snapshot = status();
    obs_data_set_obj(result.get(), "encoder", snapshot.get());
  }
  stopCapture();
  return result;
}
static void init() {
  base_set_log_handler(logging, nullptr);
  check(obs_startup("zh-CN", working.u8string().c_str(), nullptr),
        "obs-startup");
  engineReady = true;
  obs_add_data_path(((rootDir / "data/libobs").u8string() + "/").c_str());
  enumerateAdapters();
  resetVideo(0, 1920, 1080, 30);
  obs_audio_info2 audio{};
  audio.samples_per_sec = 48000;
  audio.speakers = SPEAKERS_STEREO;
  audio.max_buffering_ms = 1000;
  audio.fixed_buffering = false;
  check(obs_reset_audio2(&audio), "audio-reset");
  for (const char *name :
       {"win-capture", "obs-nvenc", "obs-ffmpeg", "obs-x264", "obs-webrtc"}) {
    obs_module_t *module = nullptr;
    std::string dll = (rootDir / "obs-plugins/64bit" /
                       (std::string(name) + ".dll"))
                          .u8string(),
                resources = (rootDir / "data/obs-plugins" / name).u8string();
    int code = obs_open_module(&module, dll.c_str(), resources.c_str());
    if (code == 0)
      obs_init_module(module);
  }
  obs_post_load_modules();
  auto *rtc = GetModuleHandleW(L"datachannel.dll");
  auto initLogger =
      reinterpret_cast<void (*)(int, void (*)(int, const char *))>(
          GetProcAddress(rtc, "rtcInitLogger"));
  if (initLogger)
    initLogger(3, rtcLog);
  obs_source_info exact{};
  exact.id = "cg_hwnd_capture";
  exact.type = OBS_SOURCE_TYPE_INPUT;
  exact.output_flags =
      OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW | OBS_SOURCE_SRGB;
  exact.get_name = audioName;
  exact.create = exactCreate;
  exact.destroy = exactDestroy;
  exact.video_tick = exactTick;
  exact.hide = exactHide;
  exact.video_render = exactRender;
  exact.get_width = exactWidth;
  exact.get_height = exactHeight;
  obs_register_source(&exact);
  obs_source_info a{};
  a.id = "cg_process_audio";
  a.type = OBS_SOURCE_TYPE_INPUT;
  a.output_flags = OBS_SOURCE_AUDIO;
  a.get_name = audioName;
  a.create = createAudio;
  a.destroy = destroyAudio;
  obs_register_source(&a);
  obs_source_info pattern{};
  pattern.id = "cg_test_pattern";
  pattern.type = OBS_SOURCE_TYPE_INPUT;
  pattern.output_flags = OBS_SOURCE_VIDEO | OBS_SOURCE_CUSTOM_DRAW;
  pattern.get_name = audioName;
  pattern.create = patternCreate;
  pattern.destroy = patternDestroy;
  pattern.get_width = patternWidth;
  pattern.get_height = patternHeight;
  pattern.video_render = patternRender;
  obs_register_source(&pattern);
  obs_output_info probe{};
  probe.id = "cg_packet_probe";
  probe.flags = OBS_OUTPUT_VIDEO | OBS_OUTPUT_ENCODED;
  probe.get_name = probeName;
  probe.create = probeCreate;
  probe.destroy = probeDestroy;
  probe.start = probeStart;
  probe.stop = probeStop;
  probe.encoded_packet = probePacket;
  probe.encoded_video_codecs = "h264";
  obs_register_output(&probe);
  refreshChoices();
}
static Data handle(obs_data_t *command) {
  std::string type = obs_data_get_string(command, "type");
  if (type == "status" || type == "requestPermission")
    return status();
  if (type == "windows")
    return windows();
  if (type == "encoders")
    return encoderList();
  if (type == "thumbnails")
    return thumbnails(command);
  if (type == "probe")
    return runProbe(command);
  if (type == "stop") {
    stopCapture();
    return status();
  }
  if (type == "shutdown") {
    stopCapture();
    quitting = true;
    auto d = data();
    obs_data_set_bool(d.get(), "shutdown", true);
    return d;
  }
  if (type == "renew") {
    int remaining = int(obs_data_get_int(command, "remainingMs"));
    check(output && remaining > 0 && remaining <= 30000, "lease-renewal");
    deadlineNs = os_gettime_ns() + uint64_t(remaining) * 1000000;
    return status();
  }
  if (type == "start") {
    int remaining = int(obs_data_get_int(command, "remainingMs"));
    check(remaining > 0 && remaining <= 30000, "lease-deadline");
    std::string server = obs_data_get_string(command, "server"),
                token = obs_data_get_string(command, "token");
    check(server.size() < 4096 && token.size() < 8192 &&
              (server.rfind("https://", 0) == 0 ||
               server.rfind("http://127.0.0.1:", 0) == 0 ||
               server.rfind("http://localhost:", 0) == 0),
          "publication-endpoint");
    uint64_t expires = os_gettime_ns() + uint64_t(remaining) * 1000000;
    startCapture(command);
    if (os_gettime_ns() >= expires) {
      stopCapture();
      throw std::runtime_error("lease-expired");
    }
    deadlineNs = expires;
    return status();
  }
  throw std::runtime_error("unknown-command");
}
static bool verifyParent(DWORD expected) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE)
    return false;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  bool found = false;
  if (Process32FirstW(snapshot, &entry)) {
    do {
      if (entry.th32ProcessID == GetCurrentProcessId()) {
        found = entry.th32ParentProcessID == expected;
        break;
      }
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);
  return found;
}
int wmain(int argc, wchar_t **argv) {
  if (argc != 4) {
    std::fputs("CG_HOST_ERROR arguments\n", stderr);
    return 2;
  }
  ownerPid = wcstoul(argv[2], nullptr, 10);
  if (!verifyParent(ownerPid) || wcscmp(argv[3], L"stdio") != 0) {
    std::fputs("CG_HOST_ERROR owner\n", stderr);
    return 2;
  }
  working = argv[1];
  rootDir = executable().parent_path().parent_path().parent_path();
  ownerProcess = OpenProcess(SYNCHRONIZE, FALSE, ownerPid);
  if (!ownerProcess) {
    std::fputs("CG_HOST_ERROR owner-process\n", stderr);
    return 2;
  }
  SetCurrentDirectoryW(executable().parent_path().c_str());
  SetDllDirectoryW(executable().parent_path().c_str());
  SetHandleInformation(GetStdHandle(STD_INPUT_HANDLE), HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(GetStdHandle(STD_OUTPUT_HANDLE), HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(GetStdHandle(STD_ERROR_HANDLE), HANDLE_FLAG_INHERIT, 0);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  fs::create_directories(working);
  try {
    init();
    std::string input;
    HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
    while (!quitting && WaitForSingleObject(ownerProcess, 0) == WAIT_TIMEOUT) {
      if (deadlineNs && os_gettime_ns() >= deadlineNs)
        stopCapture();
      DWORD available = 0;
      if (!PeekNamedPipe(in, nullptr, 0, nullptr, &available, nullptr))
        break;
      if (!available) {
        Sleep(10);
        continue;
      }
      char bytes[4096];
      DWORD n = 0;
      if (!ReadFile(in, bytes, std::min<DWORD>(available, 4096), &n, nullptr) ||
          !n)
        break;
      input.append(bytes, n);
      if (input.size() > 32768)
        break;
      size_t pos;
      while ((pos = input.find('\n')) != std::string::npos) {
        std::string line = input.substr(0, pos);
        input.erase(0, pos + 1);
        auto response = data();
        try {
          Data command(obs_data_create_from_json(line.c_str()),
                       obs_data_release);
          check(bool(command), "malformed-command");
          auto result = handle(command.get());
          obs_data_set_bool(response.get(), "ok", true);
          obs_data_set_obj(response.get(), "data", result.get());
        } catch (const std::exception &e) {
          stopCapture();
          obs_data_set_bool(response.get(), "ok", false);
          obs_data_set_string(response.get(), "error", e.what());
        }
        const char *json = obs_data_get_json(response.get());
        std::fputs(json ? json : "{}", stdout);
        std::fputc('\n', stdout);
        std::fflush(stdout);
      }
    }
  } catch (const std::exception &error) {
    const std::string code = error.what();
    std::fprintf(stderr, "CG_HOST_ERROR %s\n",
                 std::regex_match(code, std::regex("[a-z-]{1,80}"))
                     ? code.c_str()
                     : "initialization");
    if (engineReady) {
      stopCapture();
      obs_shutdown();
    }
    return 2;
  }
  stopCapture();
  if (engineReady)
    obs_shutdown();
  CloseHandle(ownerProcess);
  CoUninitialize();
  return 0;
}
