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
# Preserve OBS' actpass offer. Pion 4.1.6 may advertise active while using
# the inverse of an explicit active offer internally, stalling both DTLS peers.
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

# Mirror the original encoded H264 frames to an optional loopback-only peer.
p=Path(sys.argv[1])/'whip-output.h'
s=p.read_text().replace('#include "sync-reporter.hpp"', '#include "sync-reporter.hpp"\n#include "local-preview.hpp"')
s=s.replace('obs_output_t *output;', 'obs_output_t *output;\n cinegather::LocalPreview local_preview;')
p.write_text(s)
p=p.with_suffix('.cpp');s=p.read_text()
needle='\t  last_audio_timestamp(0)\n{\n}'
assert s.count(needle)==1
s=s.replace(needle, '\t  last_audio_timestamp(0)\n{\n proc_handler_add(obs_output_get_proc_handler(output), "void local_preview(in string command, in string sdp, out string offer, out string error)", [](void *context, calldata_t *call) { static_cast<WHIPOutput *>(context)->local_preview.command(call); }, this);\n}')
s=s.replace('void WHIPOutput::Data(struct encoder_packet *packet)\n{', 'void WHIPOutput::Data(struct encoder_packet *packet)\n{\n if (packet && packet->type == OBS_ENCODER_VIDEO) local_preview.push(packet->data, packet->size, packet->dts_usec, packet->keyframe);')
s=s.replace('void WHIPOutput::StopThread(bool signal)\n{', 'void WHIPOutput::StopThread(bool signal)\n{\n local_preview.stop();')
p.write_text(s)
