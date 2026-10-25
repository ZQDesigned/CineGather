#pragma once
#include "preview-queue.hpp"
#include "timing.hpp"
#include <atomic>
#include <callback/proc.h>
#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <rtc/rtc.hpp>
#include <sstream>
#include <stdexcept>
#include <thread>

namespace cinegather {
inline bool loopbackCandidate(const rtc::Candidate &candidate) {
  std::istringstream fields(candidate.candidate());
  std::string foundation, component, transport, priority, address;
  fields >> foundation >> component >> transport >> priority >> address;
  return (address == "127.0.0.1" || address == "::1") &&
         candidate.type() == rtc::Candidate::Type::Host &&
         candidate.transportType() == rtc::Candidate::TransportType::Udp;
}

// A second transport, not a second encoder. Encoded frames are copied only
// while the local video track is open. Sending never holds OBS's packet thread.
class LocalPreview {
  struct Session {
    struct Signals {
      std::atomic<bool> open{false};
      std::mutex mutex;
      std::condition_variable ready;
      bool gathered = false, stopped = false;
    };
    std::shared_ptr<Signals> signals = std::make_shared<Signals>();
    std::shared_ptr<rtc::PeerConnection> peer;
    std::shared_ptr<rtc::Track> track;
    std::mutex mutex;
    std::condition_variable ready;
    PreviewQueue queue;
    std::atomic<bool> stopped{false};
    std::atomic<uint64_t> sent{0}, bytes{0}, dropped{0};
    std::thread sender;
    Session() {
      rtc::Configuration config;
      config.bindAddress = "127.0.0.1";
      config.disableAutoNegotiation = true;
      config.iceServers.clear();
      peer = std::make_shared<rtc::PeerConnection>(config);
      const auto state = signals;
      peer->onGatheringStateChange([state](auto gathering) {
        if (gathering == rtc::PeerConnection::GatheringState::Complete) {
          std::lock_guard<std::mutex> lock(state->mutex);
          state->gathered = true;
          state->ready.notify_all();
        }
      });
      rtc::Description::Video video("preview", rtc::Description::Direction::SendOnly);
      video.addH264Codec(96, "42e02a");
      const uint32_t ssrc = 1;
      video.addSSRC(ssrc, "preview", "preview", "preview-video");
      auto configRtp = std::make_shared<rtc::RtpPacketizationConfig>(ssrc, "preview", 96, 90000);
      auto packetizer = std::make_shared<rtc::H264RtpPacketizer>(
          rtc::H264RtpPacketizer::Separator::StartSequence, configRtp, 1200);
      packetizer->addToChain(std::make_shared<rtc::RtcpSrReporter>(configRtp));
      packetizer->addToChain(std::make_shared<rtc::RtcpNackResponder>(512));
      track = peer->addTrack(video);
      track->setMediaHandler(packetizer);
      track->onOpen([state] { state->open = true; });
      track->onClosed([state] { state->open = false; });
      sender = std::thread([this] {
        for (;;) {
          std::optional<PreviewPacket> packet;
          {
            std::unique_lock<std::mutex> lock(mutex);
            ready.wait(lock, [&] { return stopped || (packet = queue.pop()).has_value(); });
            if (stopped) break;
          }
          if (!signals->open) continue;
          try {
            track->sendFrame(reinterpret_cast<const rtc::byte *>(packet->bytes.data()),
                             packet->bytes.size(), rtc::FrameInfo(
                                 rtpTimestamp(0, packet->timestamp, 90000)));
            ++sent;
            bytes += packet->bytes.size();
          } catch (...) {
            ++dropped;
            std::lock_guard<std::mutex> lock(mutex);
            queue.clear();
          }
        }
      });
    }
    ~Session() { stop(); }
    void stop() {
      {
        std::lock_guard<std::mutex> lock(mutex);
        if (stopped.exchange(true)) return;
      }
      signals->open = false;
      {
        std::lock_guard<std::mutex> lock(signals->mutex);
        signals->stopped = true;
        signals->ready.notify_all();
      }
      ready.notify_all();
      if (sender.joinable()) sender.join();
      track->close();
      peer->close();
      std::lock_guard<std::mutex> lock(mutex);
      queue.clear();
    }
    std::string offer() {
      peer->setLocalDescription(rtc::Description::Type::Offer);
      std::unique_lock<std::mutex> lock(signals->mutex);
      if (!signals->ready.wait_for(lock, std::chrono::seconds(3), [&] {
            return signals->gathered || signals->stopped;
          }) || signals->stopped)
        throw std::runtime_error("preview-negotiation-timeout");
      auto description = peer->localDescription();
      if (!description || description->candidates().empty())
        throw std::runtime_error("preview-loopback-unavailable");
      for (const auto &candidate : description->candidates())
        if (!loopbackCandidate(candidate)) throw std::runtime_error("preview-loopback-required");
      return std::string(*description);
    }
    void answer(const std::string &sdp) {
      rtc::Description description(sdp, rtc::Description::Type::Answer);
      // The receiver can reach our loopback candidate. Discard LAN, mDNS,
      // STUN and TURN candidates instead of resolving or dialing them.
      const auto candidates = description.extractCandidates();
      for (const auto &candidate : candidates)
        if (loopbackCandidate(candidate)) description.addCandidate(candidate);
      peer->setRemoteDescription(description);
    }
    void push(const uint8_t *data, size_t size, int64_t timestamp, bool keyframe) {
      if (stopped || !signals->open) return;
      std::lock_guard<std::mutex> lock(mutex);
      if (stopped) return;
      queue.push(data, size, timestamp, keyframe);
      ready.notify_one();
    }
  };
  std::mutex mutex;
  std::shared_ptr<Session> session;
  uint64_t stoppedFrames = 0, stoppedBytes = 0, stoppedDrops = 0, connections = 0;
  std::shared_ptr<Session> current() {
    std::lock_guard<std::mutex> lock(mutex);
    return session;
  }
public:
  ~LocalPreview() { stop(); }
  void stop() {
    std::shared_ptr<Session> old;
    {
      std::lock_guard<std::mutex> lock(mutex);
      old = std::move(session);
    }
    if (!old) return;
    old->stop();
    std::lock_guard<std::mutex> lock(mutex);
    stoppedFrames += old->sent;
    stoppedBytes += old->bytes;
    stoppedDrops += old->dropped + old->queue.dropped;
  }
  void push(const uint8_t *data, size_t size, int64_t timestamp, bool keyframe) noexcept {
    try {
      if (auto active = current()) active->push(data, size, timestamp, keyframe);
    } catch (...) {} // A preview failure must not fail the WHIP publication.
  }
  void command(calldata_t *call) noexcept {
    try {
      const std::string type = calldata_string(call, "command");
      if (type == "start") {
        stop();
        auto next = std::make_shared<Session>();
        {
          std::lock_guard<std::mutex> lock(mutex);
          session = next;
          ++connections;
        }
        const auto offer = next->offer();
        calldata_set_string(call, "offer", offer.c_str());
      } else if (type == "answer") {
        auto active = current();
        if (!active) throw std::runtime_error("preview-inactive");
        active->answer(calldata_string(call, "sdp"));
      } else if (type == "stop") stop();
      else if (type == "stats") {
        std::lock_guard<std::mutex> lock(mutex);
        calldata_set_bool(call, "active", session && session->signals->open);
        calldata_set_int(call, "connections", connections);
        calldata_set_int(call, "frames", stoppedFrames + (session ? session->sent.load() : 0));
        calldata_set_int(call, "bytes", stoppedBytes + (session ? session->bytes.load() : 0));
        uint64_t drops = stoppedDrops;
        if (session) {
          std::lock_guard<std::mutex> queued(session->mutex);
          drops += session->dropped + session->queue.dropped;
        }
        calldata_set_int(call, "dropped", drops);
      } else throw std::runtime_error("preview-command");
    } catch (...) {
      stop();
      calldata_set_string(call, "error", "preview-unavailable");
    }
  }
};
} // namespace cinegather
