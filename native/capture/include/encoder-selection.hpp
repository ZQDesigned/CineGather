#pragma once
#include <algorithm>
#include <stdexcept>
#include <string>
#include <vector>
namespace cinegather {
inline bool retryEncoderFailure(const std::string &code) {
  return code == "encoder-unavailable" || code == "encoder-create" ||
         code == "encoder-initialization" || code == "encoder-adapter-reroute" ||
         code == "graphics-initialization" || code == "graphics-adapter-mismatch";
}
// Only automatic selection may cross backend/adapter boundaries.
template <class Choice>
std::vector<Choice> encoderCandidates(const std::vector<Choice> &choices,
                                      const std::string &requested, int captureAdapter = -1) {
  std::vector<Choice> result;
  for (const auto &choice : choices)
    if ((requested == "auto" && choice.available) || choice.id == requested)
      result.push_back(choice);
  // Even software encoding should render/capture on the source GPU when known.
  for (auto &choice : result)
    if (choice.backend == "x264" && captureAdapter >= 0)
      choice.adapter = captureAdapter;
  if (result.empty() || (requested != "auto" && !result.front().available))
    throw std::runtime_error("encoder-unavailable");
  if (requested == "auto")
    std::stable_sort(
        result.begin(), result.end(), [captureAdapter](const Choice &a, const Choice &b) {
          auto rank = [](const std::string &backend) {
            return backend == "nvenc" ? 0 : backend == "amf" ? 1 : backend == "qsv" ? 2 : 3;
          };
          auto deviceRank = [captureAdapter](const Choice &c) {
            if (c.backend == "x264")
              return 2;
            return captureAdapter >= 0 && c.adapter == captureAdapter ? 0 : 1;
          };
          if (deviceRank(a) != deviceRank(b))
            return deviceRank(a) < deviceRank(b);
          return rank(a.backend) < rank(b.backend);
        });
  return result;
}
} // namespace cinegather
