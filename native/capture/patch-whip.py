"""Apply the capture-clock correction to the pinned OBS WHIP plugin sources."""
from pathlib import Path
import sys
p=Path(sys.argv[1])/'whip-output.h'
s=p.read_text().replace('#include <rtc/rtc.hpp>','#include <rtc/rtc.hpp>\n#include "sync-reporter.hpp"').replace('rtc::RtcpSrReporter','CaptureTimeReporter');p.write_text(s)
p=p.with_suffix('.cpp');s=p.read_text().replace('rtc::RtcpSrReporter','CaptureTimeReporter')
s=s.replace('int64_t duration = packet->dts_usec - last_audio_timestamp;', 'int64_t duration = packet->dts_usec;\n        audio_sr_reporter->captureTime(packet->sys_dts_usec);')
s=s.replace('int64_t duration = packet->dts_usec - videoLayerState->lastVideoTimestamp;', 'int64_t duration = packet->dts_usec;\n        video_sr_reporter->captureTime(packet->sys_dts_usec);')
s=s.replace('rtp_config->timestamp = rtp_config->timestamp + elapsed_timestamp;', 'rtp_config->timestamp = cinegather::rtpTimestamp(rtp_config->startTimestamp, duration, rtp_config->clockRate);')
p.write_text(s)
# Fixed stage codes only; the host never retains raw SDP/URLs/log messages.
s=p.read_text()
s=s.replace('bool WHIPOutput::Setup()\n{', 'bool WHIPOutput::Setup()\n{\n do_log(LOG_INFO, "CG_WHIP_PHASE setup");')
s=s.replace('CURLcode res = curl_easy_perform(c);','do_log(LOG_INFO, "CG_WHIP_PHASE http");\n CURLcode res = curl_easy_perform(c);',1)
s=s.replace('auto response = std::string(read_buffer);','do_log(LOG_INFO, "CG_WHIP_PHASE answer");\n auto response = std::string(read_buffer);',1)
s=s.replace('peer_connection->gatherLocalCandidates(iceServers);','do_log(LOG_INFO, "CG_WHIP_PHASE ice");\n peer_connection->gatherLocalCandidates(iceServers);',1)
p.write_text(s)
# Windows OBS' MbedTLS runtime cannot accept fragmented modern ClientHellos.
# WHIP explicitly permits an active/client-only offer (RFC 9725 section 4.4.4).
# Keep DTLS encryption and fingerprint verification; only select the client role.
s=p.read_text()
s=s.replace('auto offer_sdp = std::string(peer_connection->localDescription().value());', '''auto offer_sdp = std::string(peer_connection->localDescription().value());
#ifdef _WIN32
    const std::string setup = "a=setup:actpass";
    for (size_t pos = 0; (pos = offer_sdp.find(setup, pos)) != std::string::npos;)
        offer_sdp.replace(pos, setup.size(), "a=setup:active");
#endif''')
p.write_text(s)
# Preserve the first IDR: OBS normally starts encoding before DTLS is open and
# drops packets in Send(). Start capture only once the Windows media track opens.
s=p.read_text()
needle='\tobs_output_begin_data_capture(output, 0);'
assert s.count(needle)==1
s=s.replace(needle,'''#ifdef _WIN32
    const auto ready_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(5);
    while (std::chrono::steady_clock::now() < ready_deadline) {
        const auto state = peer_connection->state();
        if (state == rtc::PeerConnection::State::Failed || state == rtc::PeerConnection::State::Closed || state == rtc::PeerConnection::State::Disconnected)
            return;
        if (state == rtc::PeerConnection::State::Connected && (!video_track || video_track->isOpen()) && (!audio_track || audio_track->isOpen()))
            break;
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    if (peer_connection->state() != rtc::PeerConnection::State::Connected || (video_track && !video_track->isOpen()) || (audio_track && !audio_track->isOpen())) {
        do_log(LOG_ERROR, "DTLS media connection timed out");
        obs_output_signal_stop(output, OBS_OUTPUT_CONNECT_FAILED);
        return;
    }
#endif
''' + needle)
p.write_text(s)
