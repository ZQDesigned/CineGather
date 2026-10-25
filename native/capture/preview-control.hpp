#pragma once
#include <callback/proc.h>
#include <obs.h>
#include <stdexcept>
#include <string>

namespace cinegather {
inline std::string previewControl(obs_output_t *output, const char *command,
                                  const std::string &sdp = {}) {
  if (!output) throw std::runtime_error("preview-inactive");
  calldata_t call;
  calldata_init(&call);
  calldata_set_string(&call, "command", command);
  calldata_set_string(&call, "sdp", sdp.c_str());
  const bool found = proc_handler_call(obs_output_get_proc_handler(output), "local_preview", &call);
  const char *rawError = calldata_string(&call, "error");
  const char *rawOffer = calldata_string(&call, "offer");
  const std::string error = rawError ? rawError : "";
  const std::string offer = rawOffer ? rawOffer : "";
  calldata_free(&call);
  if (!found || !error.empty()) throw std::runtime_error("preview-unavailable");
  return offer;
}
inline void previewStats(obs_output_t *output, obs_data_t *status) {
  if (!output) return;
  calldata_t call;
  calldata_init(&call);
  calldata_set_string(&call, "command", "stats");
  if (proc_handler_call(obs_output_get_proc_handler(output), "local_preview", &call)) {
    obs_data_set_bool(status, "previewActive", calldata_bool(&call, "active"));
    obs_data_set_int(status, "previewFrames", calldata_int(&call, "frames"));
    obs_data_set_int(status, "previewBytes", calldata_int(&call, "bytes"));
    obs_data_set_int(status, "previewDroppedFrames", calldata_int(&call, "dropped"));
    obs_data_set_int(status, "previewConnections", calldata_int(&call, "connections"));
  }
  calldata_free(&call);
}
} // namespace cinegather
