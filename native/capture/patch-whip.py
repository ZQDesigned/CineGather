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
