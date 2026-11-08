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

  const std::vector<Choice> choices = {{"amf:4098:1:1:0", "amf", 0, true, "integrated"},
                                       {"nvenc:4318:2:2:1", "nvenc", 1, true, "discrete"},
                                       {"qsv:32902:3:3:2", "qsv", 2, true, "discrete"},
                                       {"x264", "x264", 0, true}};

  // A screen attached to a discrete GPU must not prefer an integrated GPU.
  const auto discrete = cinegather::encoderCandidates(choices, "auto", 1);
  assert(discrete.size() == 4 && discrete[0].adapter == 1);
  assert(discrete[1].adapter == 0 && discrete[2].adapter == 2);
  assert(discrete.back().backend == "x264");
  assert(cinegather::encoderCandidates(choices, "auto", 0)[0].backend == "amf");
  // Intel Arc is treated like other capture GPUs, regardless of vendor ranking.
  assert(cinegather::encoderCandidates(choices, "auto", 2)[0].backend == "qsv");
  auto intelIntegrated = choices;
  intelIntegrated[2].gpuType = "integrated";
  assert(cinegather::encoderCandidates(intelIntegrated, "auto", 2)[0].backend == "qsv");

  auto unavailable = choices;
  unavailable[1].available = false;
  const auto fallback = cinegather::encoderCandidates(unavailable, "auto", 1);
  assert(fallback.size() == 3 && fallback[0].backend == "amf");
  assert(fallback[1].backend == "qsv" && fallback[2].backend == "x264");
  // Unknown source mappings use deterministic hardware order, not GPU type.
  assert(cinegather::encoderCandidates(choices, "auto")[0].backend == "nvenc");
  assert(cinegather::encoderCandidates(choices, "auto", 99)[0].backend == "nvenc");

  // A manual choice stays exclusive even when it is on a different GPU.
  const auto manual = cinegather::encoderCandidates(choices, choices[0].id, 1);
  assert(manual.size() == 1 && manual[0].adapter == 0);
  for (const std::string missing : {choices[1].id, std::string("not-valid")}) {
    bool failed = false;
    try {
      cinegather::encoderCandidates(unavailable, missing, 0);
    } catch (...) {
      failed = true;
    }
    assert(failed);
  }
  assert(cinegather::encoderCandidates(choices, "x264", 2).size() == 1);
  for (auto &c : unavailable)
    c.available = c.backend == "x264";
  const auto software = cinegather::encoderCandidates(unavailable, "auto", 2);
  assert(software.size() == 1 && software[0].backend == "x264");
  assert(software[0].adapter == 2); // CPU encoding still captures on the source GPU.
  for (auto &c : unavailable)
    c.available = false;
  bool failed = false;
  try {
    cinegather::encoderCandidates(unavailable, "auto", 2);
  } catch (...) {
    failed = true;
  }
  assert(failed);

  auto equal = choices;
  equal.insert(equal.begin(), {"nvenc:4318:4:4:3", "nvenc", 3, true});
  const auto stable = cinegather::encoderCandidates(equal, "auto");
  assert(stable[0].adapter == 3 && stable[1].adapter == 1);
}
