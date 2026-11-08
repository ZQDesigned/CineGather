#include "../capture-progress.hpp"
#include <cassert>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>
#include <vector>
using Progress = cinegather::CaptureProgress;
static std::mutex graphics;
static std::atomic<bool> entered{false};
static void enter() {
  entered = true;
  graphics.lock();
}
static void leave() {
  graphics.unlock();
}
int main() {
  std::vector<std::string> events;
  std::mutex eventsMutex;
  std::atomic<double> now{0};
  Progress progress(
      [&](const std::string &e) {
        std::lock_guard<std::mutex> l(eventsMutex);
        events.push_back(e);
      },
      [&] { return now.load(); });
  {
    auto command = progress.beginCommand(Progress::Command::Start, Progress::Source::Window);
    graphics.lock();
    std::thread rendering([&] {
      auto init = progress.span(Progress::Stage::WindowInit);
      cinegather::CaptureGraphicsLock lock(progress, Progress::Stage::WindowInitGraphics, enter,
                                           leave);
      now = 1900;
      progress.poll();
    });
    while (!entered)
      std::this_thread::yield();
    // Wait until the worker's scope exists; enter() runs after registration.
    now = 600;
    progress.poll();
    {
      std::lock_guard<std::mutex> l(eventsMutex);
      bool waiting = false;
      for (const auto &e : events)
        if (e.find("window-init-graphics") != e.npos && e.find("waiting") != e.npos)
          waiting = true;
      assert(waiting);
    }
    auto count = events.size();
    progress.poll();
    assert(events.size() == count); // rate bounded
    now = 900;
    graphics.unlock();
    rendering.join();
  }
  assert(graphics.try_lock());
  graphics.unlock();
  auto before = events.size();
  {
    auto command = progress.beginCommand(Progress::Command::Status, Progress::Source::Window);
    auto query = progress.span(Progress::Stage::StatusSize, false);
  }
  assert(events.size() == before); // normal periodic diagnostics do not spam
  try {
    auto command = progress.beginCommand(Progress::Command::Start, Progress::Source::Screen);
    auto stage = progress.span(Progress::Stage::Scene);
    throw 1;
  } catch (...) {
  }
  for (const auto &e : events)
    std::cout << e << "\n";
}
