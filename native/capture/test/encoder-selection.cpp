#include "../encoder-selection.hpp"
#include <cassert>
struct Choice {
  std::string id, backend;
  int adapter;
  bool available;
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
}
