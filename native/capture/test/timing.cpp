#include "../timing.hpp"
#include <cassert>
#include <cstdint>
int main() {
  // Regression: summing truncated 33,333us frame deltas loses ~20ms in 180s.
  uint32_t start = 0xffff0000;
  for (int64_t frame = 0; frame <= 108000; ++frame) {
    int64_t us = frame * 1000000 / 30;
    auto actual = cinegather::rtpTimestamp(start, us, 90000);
    auto expected =
        uint32_t(uint64_t(start) + frame * 3000 - (frame % 3 ? 1 : 0));
    assert(actual == expected);
  }
  assert(cinegather::rtpTimestamp(0, 180000000, 48000) == 8640000);
  // Capture-to-NTP must ignore encoder/send scheduling and wall clock jumps.
  cinegather::MediaClock clock(1000000, 1700000000000000);
  auto a = clock.ntp(2000000);
  auto v = clock.ntp(2000000);
  assert(a == v);
  assert(clock.ntp(3000000) - a == (uint64_t(1) << 32));
}
