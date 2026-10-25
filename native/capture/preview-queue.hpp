#pragma once
#include <cstdint>
#include <deque>
#include <optional>
#include <vector>

namespace cinegather {
struct PreviewPacket {
  std::vector<uint8_t> bytes;
  int64_t timestamp;
};
// The caller serializes access. No scaling, transcoding or frame-rate limiter.
// A slow receiver can only lose its own preview; it never blocks publication.
class PreviewQueue {
  std::deque<PreviewPacket> packets;
  size_t bytes = 0;
  bool waitingForKeyframe = true;
public:
  uint64_t dropped = 0;
  void clear() {
    packets.clear();
    bytes = 0;
    waitingForKeyframe = true;
  }
  bool push(const uint8_t *data, size_t size, int64_t timestamp, bool keyframe) {
    if (!data || !size || size > 2 * 1024 * 1024 ||
        packets.size() >= 8 || bytes + size > 4 * 1024 * 1024) {
      dropped += packets.size() + 1;
      clear();
      return false;
    }
    if (waitingForKeyframe && !keyframe) {
      ++dropped;
      return false;
    }
    waitingForKeyframe = false;
    packets.push_back({std::vector<uint8_t>(data, data + size), timestamp});
    bytes += size;
    return true;
  }
  std::optional<PreviewPacket> pop() {
    if (packets.empty()) return std::nullopt;
    auto packet = std::move(packets.front());
    packets.pop_front();
    bytes -= packet.bytes.size();
    return packet;
  }
};
} // namespace cinegather
