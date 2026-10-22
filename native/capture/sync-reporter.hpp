#pragma once
#include "timing.hpp"
#include <rtc/rtc.hpp>
#include <util/platform.h>

// OBS' stock reporter associates packet RTP with send time. Encoder/buffering
// delays differ by medium, so use the common OBS capture clock for both tracks.
class CaptureTimeReporter : public rtc::MediaHandler {
  rtc::RtcpSrReporter reporter;
  uint64_t captureNtp = 0;

public:
  const std::shared_ptr<rtc::RtpPacketizationConfig> rtpConfig;
  inline static cinegather::MediaClock clock{
      int64_t(os_gettime_ns() / 1000),
      std::chrono::duration_cast<std::chrono::microseconds>(
          std::chrono::system_clock::now().time_since_epoch())
          .count()};
  explicit CaptureTimeReporter(
      std::shared_ptr<rtc::RtpPacketizationConfig> config)
      : reporter(config), rtpConfig(config) {}
  void captureTime(int64_t us) { captureNtp = clock.ntp(us); }
  void outgoing(rtc::message_vector &messages,
                const rtc::message_callback &send) override {
    reporter.outgoing(messages, [&](rtc::message_ptr message) {
      if (message->size() >= rtc::RtcpSr::Size(0)) {
        auto sr = reinterpret_cast<rtc::RtcpSr *>(message->data());
        if (sr->header.payloadType() == 200)
          sr->setNtpTimestamp(captureNtp);
      }
      send(message);
    });
  }
  uint32_t lastReportedTimestamp() const {
    return reporter.lastReportedTimestamp();
  }
  void setNeedsToReport() {}
};
