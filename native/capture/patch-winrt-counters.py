"""Add numeric capture-arrival/copy counters to pinned OBS WGC, without recording pixels."""

from pathlib import Path
import sys

p = Path(sys.argv[1]) / "winrt-capture.cpp"
s = p.read_text()
s = """#include <atomic>
#include <cstdint>
static std::atomic<uint64_t> cg_arrived{0},cg_copied{0},cg_capture_ns{0};
extern "C" __declspec(dllexport) void cg_capture_stats(uint64_t* arrived,uint64_t* copied,uint64_t* timestamp){
 *arrived=cg_arrived.load();*copied=cg_copied.load();*timestamp=cg_capture_ns.load();
}
""" + s
marker = "const winrt::Windows::Graphics::SizeInt32 frame_content_size = frame.ContentSize();"
assert s.count(marker) == 1
s = s.replace(
    marker,
    marker
    + "\n        ++cg_arrived;cg_capture_ns=uint64_t(frame.SystemRelativeTime().count())*100;",
)
assert s.count("texture_written = true;") == 1
s = s.replace(
    "texture_written = true;", "texture_written = true;\n                ++cg_copied;"
)
p.write_text(s)
