// WASAPI process loopback. No injection, virtual audio driver, or microphone access.
// stdout: framed stereo PCM16 / 48 kHz; stderr: a single READY or ERROR status.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <mmdeviceapi.h>
#include <tlhelp32.h>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include <vector>
#include <string>
#include <set>

// Public AUDIOCLIENT_ACTIVATION_PARAMS ABI, also usable with MinGW headers
// predating audioclientactivationparams.h. See Microsoft's Win32 metadata.
struct ProcessActivation { uint32_t type; uint32_t pid; uint32_t mode; };
static_assert(sizeof(ProcessActivation) == 12);

class Activation final : public IActivateAudioInterfaceCompletionHandler {
  std::atomic<ULONG> references{1};
  IUnknown* marshaler = nullptr;
public:
  Activation() { CoCreateFreeThreadedMarshaler(this, &marshaler); }
  HANDLE completed = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HRESULT result = E_FAIL;
  IAudioClient* client = nullptr;
  ~Activation() { if (client) client->Release(); if (marshaler) marshaler->Release(); CloseHandle(completed); }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++references; }
  ULONG STDMETHODCALLTYPE Release() override {
    ULONG remaining = --references;
    if (!remaining) delete this;
    return remaining;
  }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void** object) override {
    if (!object) return E_POINTER;
    *object = nullptr;
    if (iid == __uuidof(IMarshal) && marshaler) return marshaler->QueryInterface(iid, object);
    if (iid == __uuidof(IUnknown) || iid == __uuidof(IAgileObject) ||
        iid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
      *object = static_cast<IActivateAudioInterfaceCompletionHandler*>(this);
      AddRef();
      return S_OK;
    }
    return E_NOINTERFACE;
  }
  HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation* operation) override {
    IUnknown* unknown = nullptr;
    HRESULT activation = E_FAIL;
    result = operation->GetActivateResult(&activation, &unknown);
    if (SUCCEEDED(result)) result = activation;
    if (SUCCEEDED(result) && unknown)
      result = unknown->QueryInterface(__uuidof(IAudioClient), reinterpret_cast<void**>(&client));
    if (unknown) unknown->Release();
    SetEvent(completed);
    return S_OK;
  }
};

static bool descendant(DWORD pid, DWORD root) {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) return true; // Fail closed.
  std::vector<PROCESSENTRY32W> entries;
  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  if (Process32FirstW(snapshot, &entry)) do { entries.push_back(entry); } while (Process32NextW(snapshot, &entry));
  CloseHandle(snapshot);
  for (size_t i = 0; pid && i <= entries.size(); ++i) {
    if (pid == root) return true;
    DWORD parent = 0;
    for (const auto& process : entries) if (process.th32ProcessID == pid) { parent = process.th32ParentProcessID; break; }
    if (parent == pid) break;
    pid = parent;
  }
  return false;
}

struct WindowProcess { DWORD frame; DWORD application; };
static BOOL CALLBACK findApplication(HWND window, LPARAM parameter) {
  auto& target = *reinterpret_cast<WindowProcess*>(parameter);
  DWORD pid = 0;
  GetWindowThreadProcessId(window, &pid);
  if (pid && pid != target.frame) { target.application = pid; return FALSE; }
  return TRUE;
}
static DWORD windowProcess(HWND window) {
  if (!IsWindow(window)) return 0;
  DWORD pid = 0;
  GetWindowThreadProcessId(window, &pid);
  wchar_t name[128]{};
  GetClassNameW(window, name, 128);
  if (wcscmp(name, L"ApplicationFrameWindow") == 0) {
    WindowProcess target{pid, 0};
    EnumChildWindows(window, findApplication, reinterpret_cast<LPARAM>(&target));
    return target.application; // Never capture ApplicationFrameHost's other apps.
  }
  return pid;
}
static std::string quoted(const std::wstring& value) {
  int size = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  std::string bytes(size, '\0');
  WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), bytes.data(), size, nullptr, nullptr);
  std::string result = "\"";
  for (unsigned char c : bytes) {
    if (c == '"' || c == '\\') { result += '\\'; result += c; }
    else if (c < 32) { char escaped[7]; std::snprintf(escaped, sizeof(escaped), "\\u%04x", c); result += escaped; }
    else result += c;
  }
  return result + "\"";
}
struct Applications { DWORD owner; std::set<DWORD> seen; std::string json = "["; };
static void addApplication(Applications& apps, DWORD pid, const std::wstring& title) {
  if (!pid || apps.seen.count(pid) || apps.seen.size() >= 200 || descendant(pid, apps.owner) || descendant(apps.owner,pid)) return;
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  FILETIME created{}, exited{}, kernel{}, user{};
  if (!process) return;
  bool valid = GetProcessTimes(process, &created, &exited, &kernel, &user);
  wchar_t path[32768]{};DWORD size=32768;
  if (title.empty()) QueryFullProcessImageNameW(process,0,path,&size);
  CloseHandle(process);
  if (!valid) return;
  const wchar_t *name=wcsrchr(path,L'\\');
  std::wstring label=title.empty()?(name?name+1:path):title;
  if (label.empty()) return;
  apps.seen.insert(pid);
  if (apps.seen.size() > 1) apps.json += ',';
  auto key = std::to_string(pid);
  auto identity = key + ":" + std::to_string((uint64_t(created.dwHighDateTime) << 32) | created.dwLowDateTime);
  apps.json += "{\"key\":\"" + key + "\",\"name\":" + quoted(label) + ",\"identity\":\"" + identity + "\",\"target\":\"process:" + identity + "\"}";
}
static BOOL CALLBACK listApplication(HWND window, LPARAM context) {
  auto& apps = *reinterpret_cast<Applications*>(context);
  if (!IsWindowVisible(window) || !GetWindowTextLengthW(window)) return TRUE;
  wchar_t title[1024]{};GetWindowTextW(window,title,1024);
  addApplication(apps,windowProcess(window),title);
  return apps.seen.size() < 200;
}
static void listAudioSessions(Applications& apps) {
  IMMDeviceEnumerator* enumerator=nullptr;IMMDevice* endpoint=nullptr;
  IAudioSessionManager2* manager=nullptr;IAudioSessionEnumerator* sessions=nullptr;
  if (SUCCEEDED(CoCreateInstance(__uuidof(MMDeviceEnumerator),nullptr,CLSCTX_ALL,__uuidof(IMMDeviceEnumerator),reinterpret_cast<void**>(&enumerator)))) {
    if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender,eConsole,&endpoint)) &&
        SUCCEEDED(endpoint->Activate(__uuidof(IAudioSessionManager2),CLSCTX_ALL,nullptr,reinterpret_cast<void**>(&manager))) &&
        SUCCEEDED(manager->GetSessionEnumerator(&sessions))) {
      int count=0;sessions->GetCount(&count);
      for(int i=0;i<count;i++) {
        IAudioSessionControl* session=nullptr;IAudioSessionControl2* control=nullptr;
        if(SUCCEEDED(sessions->GetSession(i,&session))) {
          if(SUCCEEDED(session->QueryInterface(__uuidof(IAudioSessionControl2),reinterpret_cast<void**>(&control)))) {
            DWORD pid=0;if(SUCCEEDED(control->GetProcessId(&pid))) addApplication(apps,pid,L"");
            control->Release();
          }
          session->Release();
        }
      }
    }
  }
  if(sessions)sessions->Release();
  if(manager)manager->Release();
  if(endpoint)endpoint->Release();
  if(enumerator)enumerator->Release();
}
static bool writeAll(HANDLE output, const void* data, DWORD size) {
  const auto* bytes = static_cast<const uint8_t*>(data);
  while (size) {
    DWORD written = 0;
    if (!WriteFile(output, bytes, size, &written, nullptr) || !written) return false;
    bytes += written;
    size -= written;
  }
  return true;
}
static int failure(const char* stage, HRESULT hr) {
  std::fprintf(stderr, "ERROR %s %08lx\n", stage, static_cast<unsigned long>(hr));
  std::fflush(stderr);
  return 1;
}
int main(int argc, char** argv) {
  if (argc != 4) return failure("arguments", E_INVALIDARG);
  if (std::strcmp(argv[1], "list") == 0) {
    Applications apps{static_cast<DWORD>(std::strtoul(argv[3], nullptr, 10)), {}, "["};
    if (!apps.owner) return failure("owner", E_INVALIDARG);
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    EnumWindows(listApplication, reinterpret_cast<LPARAM>(&apps));
    listAudioSessions(apps);CoUninitialize();
    std::printf("%s]\n", apps.json.c_str());
    return 0;
  }
  const bool processMode = std::strcmp(argv[1], "process") == 0;
  const bool include = processMode || std::strcmp(argv[1], "window") == 0;
  const bool deviceMode = std::strcmp(argv[1], "device") == 0;
  if (!include && !deviceMode && std::strcmp(argv[1], "screen") != 0) return failure("mode", E_INVALIDARG);
  DWORD owner = static_cast<DWORD>(std::strtoul(argv[3], nullptr, 10));
  if (!owner) return failure("owner", E_INVALIDARG);
  const auto window = std::strtoull(argv[2], nullptr, 10);
  const bool hasWindow = include || (deviceMode && window != 0);
  DWORD target = processMode ? static_cast<DWORD>(window) : hasWindow ? windowProcess(reinterpret_cast<HWND>(window)) : owner;
  if (!target || (hasWindow && (descendant(target, owner) || descendant(owner,target)))) return failure("window", E_ACCESSDENIED);
  HANDLE ownerProcess = OpenProcess(SYNCHRONIZE, FALSE, owner);
  HANDLE targetProcess = OpenProcess(SYNCHRONIZE, FALSE, target);
  if (processMode) {
    const char *birth=strchr(argv[2],':');FILETIME created{},exited{},kernel{},user{};
    HANDLE query=OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION,FALSE,target);
    bool valid=query && birth && GetProcessTimes(query,&created,&exited,&kernel,&user) &&
      ((uint64_t(created.dwHighDateTime)<<32)|created.dwLowDateTime)==std::strtoull(birth+1,nullptr,10);
    if(query)CloseHandle(query);
    if(!valid)return failure("process-identity",E_ACCESSDENIED);
  }
  if (!ownerProcess || !targetProcess) return failure("process", HRESULT_FROM_WIN32(GetLastError()));
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  if (FAILED(hr)) return failure("com", hr);
  Activation* activation = nullptr;
  IActivateAudioInterfaceAsyncOperation* operation = nullptr;
  IAudioClient* audio = nullptr;
  if (deviceMode) {
    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDevice* endpoint = nullptr;
    hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
    if (FAILED(hr)) return failure("device-enumerator", hr);
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &endpoint);
    enumerator->Release();
    if (FAILED(hr)) return failure("device-endpoint", hr);
    hr = endpoint->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, reinterpret_cast<void**>(&audio));
    endpoint->Release();
    if (FAILED(hr)) return failure("device-activate", hr);
  } else {
    activation = new Activation();
    ProcessActivation parameters{1, target, include ? 0u : 1u};
    PROPVARIANT variant{};
    variant.vt = VT_BLOB;
    variant.blob.cbSize = sizeof(parameters);
    variant.blob.pBlobData = reinterpret_cast<BYTE*>(&parameters);
    hr = ActivateAudioInterfaceAsync(L"VAD\\Process_Loopback", __uuidof(IAudioClient), &variant, activation, &operation);
    if (FAILED(hr)) return failure("activate", hr);
    if (WaitForSingleObject(activation->completed, 5000) != WAIT_OBJECT_0) return failure("timeout", E_ABORT);
    if (FAILED(activation->result) || !activation->client) return failure("activate-result", activation->result);
    audio = activation->client;
    audio->AddRef();
  }
  WAVEFORMATEX format{};
  format.wFormatTag = WAVE_FORMAT_PCM;
  format.nChannels = 2;
  format.nSamplesPerSec = 48000;
  format.wBitsPerSample = 16;
  format.nBlockAlign = 4;
  format.nAvgBytesPerSec = 192000;
  HANDLE ready = CreateEventW(nullptr, FALSE, FALSE, nullptr);
  HANDLE stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  hr = audio->Initialize(AUDCLNT_SHAREMODE_SHARED,
    AUDCLNT_STREAMFLAGS_LOOPBACK | (deviceMode ? 0 : AUDCLNT_STREAMFLAGS_EVENTCALLBACK) | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
    0, 0, &format, nullptr);
  if (FAILED(hr)) return failure("initialize", hr);
  if (!deviceMode) {
    hr = audio->SetEventHandle(ready);
    if (FAILED(hr)) return failure("event", hr);
  }
  IAudioCaptureClient* capture = nullptr;
  hr = audio->GetService(__uuidof(IAudioCaptureClient), reinterpret_cast<void**>(&capture));
  if (FAILED(hr)) return failure("service", hr);
  std::thread([stop]() {
    char input;
    DWORD count;
    ReadFile(GetStdHandle(STD_INPUT_HANDLE), &input, 1, &count, nullptr);
    SetEvent(stop);
  }).detach();
  hr = audio->Start();
  if (FAILED(hr)) return failure("start", hr);
  std::fprintf(stderr, "READY\n");
  std::fflush(stderr);
  HANDLE events[]{stop, ownerProcess, targetProcess, ready};
  HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
  bool running = true;
  int code = 0;
  while (running) {
    // Poll endpoint loopback too, covering systems before event-driven loopback.
    DWORD event = WaitForMultipleObjects(deviceMode ? 3 : 4, events, FALSE, deviceMode ? 10 : 2000);
    if (event == WAIT_OBJECT_0 || event == WAIT_OBJECT_0 + 1) break;
    if (event == WAIT_OBJECT_0 + 2) { code = failure("target-closed", E_ABORT); break; }
    if (event == WAIT_TIMEOUT && !deviceMode) continue;
    if (event != WAIT_OBJECT_0 + 3 && !(deviceMode && event == WAIT_TIMEOUT)) { code = failure("wait", E_FAIL); break; }
    UINT32 frames = 0;
    while (SUCCEEDED(hr = capture->GetNextPacketSize(&frames)) && frames) {
      BYTE* data = nullptr;
      DWORD flags = 0;
      UINT64 position = 0, timestamp = 0;
      hr = capture->GetBuffer(&data, &frames, &flags, &position, &timestamp);
      if (FAILED(hr)) break;
      // Fixed 16-byte LE header: byte length, flags, QPC timestamp (100 ns).
      uint32_t header[]{frames * 4, flags};
      std::vector<uint8_t> silence;
      if ((flags & AUDCLNT_BUFFERFLAGS_SILENT) || !data) { silence.resize(frames * 4, 0); data = silence.data(); }
      running = frames <= 48000 && writeAll(output, header, 8) && writeAll(output, &timestamp, 8) && writeAll(output, data, frames * 4);
      capture->ReleaseBuffer(frames);
      if (!running) break;
    }
    if (FAILED(hr)) { code = failure("read", hr); break; }
  }
  audio->Stop();
  capture->Release();
  audio->Release();
  if (operation) operation->Release();
  if (activation) activation->Release();
  CloseHandle(ready);
  CloseHandle(ownerProcess);
  CloseHandle(targetProcess);
  CoUninitialize();
  return code;
}
