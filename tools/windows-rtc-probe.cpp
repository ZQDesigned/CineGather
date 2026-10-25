// Test-only RTC probe: isolate OBS output lifecycle from the bundled transport.
#include <rtc/rtc.hpp>
#include <curl/curl.h>
#include <chrono>
#include <iostream>
#include <thread>
static size_t writeData(char *p, size_t a, size_t b, void *out) {
  static_cast<std::string *>(out)->append(p, a * b);
  return a * b;
}
int main(int argc, char **argv) {
  if (argc != 2 || std::string(argv[1]).rfind("http://127.0.0.1:", 0) != 0) return 2;
  rtc::InitLogger(rtc::LogLevel::Debug, [](rtc::LogLevel, std::string text) {
    if (text.find("DTLS") != std::string::npos || text.find("ICE state") != std::string::npos)
      std::cerr << text << "\n";
  });
  rtc::Configuration cfg;
  cfg.disableAutoGathering = true;
  auto pc = std::make_shared<rtc::PeerConnection>(cfg);
  pc->onStateChange([](rtc::PeerConnection::State state) { std::cerr << "RTC state " << int(state) << "\n"; });
  rtc::Description::Video video("1", rtc::Description::Direction::SendOnly);
  video.addH264Codec(96);
  video.addSSRC(123456, "test", "test", "video");
  auto track = pc->addTrack(video);
  pc->setLocalDescription();
  std::string offer = *pc->localDescription();
  CURL *c = curl_easy_init();
  auto *headers = curl_slist_append(nullptr, "Content-Type: application/sdp");
  std::string answer;
  curl_easy_setopt(c, CURLOPT_URL, argv[1]);
  curl_easy_setopt(c, CURLOPT_HTTPHEADER, headers);
  curl_easy_setopt(c, CURLOPT_POSTFIELDS, offer.c_str());
  curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, writeData);
  curl_easy_setopt(c, CURLOPT_WRITEDATA, &answer);
  curl_easy_setopt(c, CURLOPT_TIMEOUT, 8L);
  auto result = curl_easy_perform(c);
  curl_easy_cleanup(c);
  curl_slist_free_all(headers);
  if (result != CURLE_OK) return 3;
  pc->setRemoteDescription(rtc::Description(answer, "answer"));
  pc->gatherLocalCandidates();
  for (int i = 0; i < 100 && pc->state() != rtc::PeerConnection::State::Connected; ++i)
    std::this_thread::sleep_for(std::chrono::milliseconds(100));
  const bool connected = pc->state() == rtc::PeerConnection::State::Connected && track->isOpen();
  std::cout << "Bundled transport connected: " << connected << "\n";
  pc->close();
  return connected ? 0 : 4;
}
