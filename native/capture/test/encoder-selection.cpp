#include "../encoder-selection.hpp"
#include <cassert>
struct Choice {
  std::string id, backend;
  int adapter;
  bool available;
  std::string gpuType = "unknown";
};
int main() {
  assert(cinegather::retryEncoderFailure("encoder-initialization"));
  assert(!cinegather::retryEncoderFailure("audio-initialization"));
  assert(!cinegather::retryEncoderFailure("window-unavailable"));

  const std::vector<Choice> choices = {{"amf:4098:1:1:0", "amf", 0, true},
                                       {"nvenc:4318:2:2:1", "nvenc", 1, true},
                                       {"x264", "x264", 0, true}};
  const auto automatic = cinegather::encoderCandidates(choices, "auto");
  assert(automatic.size() == 3 && automatic[0].backend == "nvenc" &&
         automatic[0].adapter == 1 && automatic[1].backend == "amf");
  const auto manual = cinegather::encoderCandidates(choices, "amf:4098:1:1:0");
  assert(manual.size() == 1 && manual[0].adapter == 0);
  for (const std::string missing : {"nvenc:4318:2:2:0", "not-valid"}) {
    bool failed = false;
    try {
      cinegather::encoderCandidates(choices, missing);
    } catch (...) {
      failed = true;
    }
    assert(failed);
  }
  auto unavailable = choices;
  unavailable[1].available = false;
  bool failed = false;
  try {
    cinegather::encoderCandidates(unavailable, choices[1].id);
  } catch (...) {
    failed = true;
  }
  assert(failed);
  assert(cinegather::encoderCandidates(unavailable, "auto")[0].backend ==
         "amf");

  auto hybrid = choices;
  hybrid[0].gpuType = "integrated";
  hybrid[1].gpuType = "discrete";
  const auto preferred = cinegather::encoderCandidates(hybrid, "auto");
  assert(preferred[0].id == hybrid[0].id);
  assert(preferred[1].id == hybrid[1].id);
  assert(preferred[2].backend == "x264");
  assert(cinegather::encoderCandidates(hybrid, hybrid[1].id)[0].id ==
         hybrid[1].id);
  hybrid[0].available = false;
  assert(cinegather::encoderCandidates(hybrid, "auto")[0].id == hybrid[1].id);
  hybrid[1].gpuType = "unknown";
  assert(cinegather::encoderCandidates(hybrid, "auto")[0].id == hybrid[1].id);
  hybrid[0].available = true;
  hybrid.push_back({"qsv:32902:10:1:2", "qsv", 2, true, "integrated"});
  hybrid[0].gpuType = "discrete";
  assert(cinegather::encoderCandidates(hybrid, "auto")[0].backend == "qsv");
  assert(cinegather::encoderCandidates(hybrid, hybrid.back().id)[0].adapter == 2);
  hybrid.back().available = false;
  assert(cinegather::encoderCandidates(hybrid, "auto")[0].backend == "nvenc");
  auto equal = choices;
  equal.insert(equal.begin(), {"nvenc:4318:3:3:2", "nvenc", 2, true});
  const auto stable = cinegather::encoderCandidates(equal, "auto");
  assert(stable[0].id == equal[0].id && stable[1].id == choices[1].id);
}
