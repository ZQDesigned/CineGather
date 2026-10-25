#include "../preview-queue.hpp"
#include <cassert>
#include <vector>

int main() {
  cinegather::PreviewQueue queue;
  std::vector<uint8_t> frame(100, 7);
  assert(!queue.push(frame.data(), frame.size(), 0, false));
  assert(queue.push(frame.data(), frame.size(), 1, true));
  frame[1] = 9;
  auto first = queue.pop();
  assert(first && first->bytes[1] == 7 && first->timestamp == 1);
  for (int i = 0; i < 60; ++i) {
    frame[0] = uint8_t(i);
    assert(queue.push(frame.data(), frame.size(), i * 1000000ll / 60, false));
    auto packet = queue.pop();
    assert(packet && packet->bytes == frame);
    assert(packet->timestamp == i * 1000000ll / 60);
  }
  for (int i = 0; i < 8; ++i)
    assert(queue.push(frame.data(), frame.size(), i, false));
  assert(!queue.push(frame.data(), frame.size(), 9, false));
  assert(!queue.pop());
  assert(!queue.push(frame.data(), frame.size(), 10, false));
  assert(queue.push(frame.data(), frame.size(), 11, true));
  assert(queue.pop()->timestamp == 11);
  std::vector<uint8_t> oversized(2 * 1024 * 1024 + 1);
  assert(!queue.push(oversized.data(), oversized.size(), 12, true));
  assert(!queue.pop());
  assert(!queue.push(frame.data(), frame.size(), 13, false));
  assert(queue.push(frame.data(), frame.size(), 14, true));
  queue.clear();
  assert(!queue.pop());
  assert(!queue.push(frame.data(), frame.size(), 15, false));
  std::vector<uint8_t> large(2 * 1024 * 1024);
  assert(queue.push(large.data(), large.size(), 16, true));
  assert(queue.push(large.data(), large.size(), 17, false));
  assert(!queue.push(frame.data(), frame.size(), 18, false));
  assert(!queue.pop());
}
