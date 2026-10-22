"""Connect process-filtered Core Audio PCM to the pinned OBS audio source."""
from pathlib import Path
import sys
root=Path(sys.argv[1])
p=root/'mac-sck-common.h'
s=p.read_text().replace('    SCStream *disp;', '    NSObject *process_audio;\n    SCStream *disp;');p.write_text(s)
p=root/'mac-sck-audio-capture.m'
s=p.read_text().replace('#include "mac-sck-common.h"','#include "mac-sck-common.h"\n#include "process-audio.h"')
s=s.replace('    if (sc->disp && !sc->capture_failed) {','    if (sc->process_audio) {\n        cg_stop_process_audio(sc->process_audio);\n        [sc->process_audio release];\n        sc->process_audio = nil;\n    }\n    if (sc->disp && !sc->capture_failed) {')
old='    SCContentFilter *content_filter;'
assert s.count(old)==1
s=s.replace(old,'''    if (@available(macOS 14.2, *)) {
        obs_data_t *settings = obs_source_get_settings(sc->source);
        sc->process_audio = [cg_start_process_audio(sc->source,
            sc->audio_capture_type == ScreenCaptureAudioDesktopStream,
            obs_data_get_string(settings, "application"),
            obs_data_get_string(settings, "excluded_application")) retain];
        obs_data_release(settings);
        return sc->process_audio != nil;
    }
    // Older systems retain app-only capture. Never silently use an unfiltered mix.
    if (sc->audio_capture_type == ScreenCaptureAudioDesktopStream) return false;
    SCContentFilter *content_filter;''')
p.write_text(s)
