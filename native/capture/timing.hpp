#pragma once
#include <cstdint>
namespace cinegather {
// Convert the cumulative media timestamp, never rounded per-frame deltas.
inline uint32_t rtpTimestamp(uint32_t origin, int64_t microseconds,
                             uint32_t rate) {
  return origin + uint32_t((microseconds / 1000000) * rate +
                           (microseconds % 1000000) * rate / 1000000);
}
class MediaClock {
  int64_t monotonicOrigin, unixOrigin;

public:
  MediaClock(int64_t monotonicUs, int64_t unixUs)
      : monotonicOrigin(monotonicUs), unixOrigin(unixUs) {}
  uint64_t ntp(int64_t captureUs) const {
    int64_t us = unixOrigin + captureUs - monotonicOrigin;
    return (uint64_t(us / 1000000 + 2208988800LL) << 32) +
           (uint64_t(us % 1000000) << 32) / 1000000;
  }
};
} // namespace cinegather
