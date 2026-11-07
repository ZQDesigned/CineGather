#include "capture-progress.hpp"
#include <cassert>
#include <cstdint>
#include <cstdlib>
#include <memory>
#include <stdexcept>
#include <string>
struct obs_data_t {
  bool accepted = false;
};
using Data = std::unique_ptr<obs_data_t>;
static Data data() { return std::make_unique<obs_data_t>(); }
static int64_t obs_data_get_int(obs_data_t *, const char *) { return 20000; }
static const char *obs_data_get_string(obs_data_t *, const char *key) {
  return std::string(key) == "server" ? "https://fixture.invalid/whip"
                                      : "fixture";
}
static void obs_data_set_bool(obs_data_t *d, const char *, bool v) {
  d->accepted = v;
}
static uint64_t os_gettime_ns() { return 1000; }
static void check(bool ok, const char *error) {
  if (!ok)
    throw std::runtime_error(error);
}
static uint64_t startupDeadlineNs = 0, deadlineNs = 0;
static bool started = false;
static void startCapture(obs_data_t *) { started = true; }
static void stopCapture() { started = false; }
// Calling status reproduces the original synchronous, graphics-dependent
// snapshot. Production start must ACK without ever executing this function.
static Data status() { std::_Exit(21); }
static cinegather::CaptureProgress progress([](const std::string &) {});
using Stage = cinegather::CaptureProgress::Stage;
static Data handleStart(obs_data_t *command) {
  std::string type = "start";
  PRODUCTION_START
  throw std::runtime_error("missing-start");
}
int main() {
  obs_data_t config;
  auto result = handleStart(&config);
  assert(started);
  assert(result->accepted);
  assert(deadlineNs > 0 && startupDeadlineNs == 0);
}
