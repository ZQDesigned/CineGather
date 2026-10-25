#pragma once
#include <algorithm>
#include <stdexcept>
#include <string>
#include <vector>
namespace cinegather {
// Only automatic selection may cross backend/adapter boundaries.
template <class Choice>
std::vector<Choice> encoderCandidates(const std::vector<Choice> &choices,
                                      const std::string &requested) {
  std::vector<Choice> result;
  for (const auto &choice : choices)
    if ((requested == "auto" && choice.available) || choice.id == requested)
      result.push_back(choice);
  if (result.empty() || (requested != "auto" && !result.front().available))
    throw std::runtime_error("encoder-unavailable");
  if (requested == "auto")
    std::stable_sort(
        result.begin(), result.end(), [](const Choice &a, const Choice &b) {
          auto rank = [](const std::string &backend) {
            return backend == "nvenc" ? 0 : backend == "amf" ? 1 : 2;
          };
          return rank(a.backend) < rank(b.backend);
        });
  return result;
}
} // namespace cinegather
