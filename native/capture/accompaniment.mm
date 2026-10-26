// SPDX-License-Identifier: MIT
// Audio-only mode of the existing, permissioned helper. No video or SFU runtime.
#import <AppKit/AppKit.h>
#include "process-audio.h"
#include "audio-exclusions.h"
#include <media-io/audio-resampler.h>
#include <atomic>
#include <deque>
#include <mutex>
#include <thread>
#include <poll.h>
#include <signal.h>
#include <fcntl.h>
#include <unistd.h>
#include <vector>

static NSArray *applications(const char *own) {
  NSMutableArray *result = [NSMutableArray array];
  for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
    if (app.activationPolicy != NSApplicationActivationPolicyRegular || !app.bundleIdentifier.length || app.terminated ||
        cg_audio_bundle_is_excluded(app.bundleIdentifier.UTF8String, own)) continue;
    [result addObject:@{@"key":app.bundleIdentifier, @"name":app.localizedName ?: app.bundleIdentifier,
      @"identity":[NSString stringWithFormat:@"%d:%.6f",app.processIdentifier,app.launchDate.timeIntervalSince1970], @"target":app.bundleIdentifier}];
  }
  return result;
}
struct PcmOutput {
  std::mutex mutex;
  std::deque<std::vector<uint8_t>> queue;
  size_t bytes = 0;
  std::atomic<bool> running{true}, failed{false};
  audio_resampler_t *resampler = nullptr;
  uint32_t rate = 0;
  audio_format format = AUDIO_FORMAT_UNKNOWN;
  ~PcmOutput() { audio_resampler_destroy(resampler); }
};
static void pcm(void *raw, const obs_source_audio *audio) {
  auto& out = *static_cast<PcmOutput*>(raw);
  if (!out.running || !audio->frames || audio->frames > 48000) return;
  if (out.rate != audio->samples_per_sec || out.format != audio->format) {
    audio_resampler_destroy(out.resampler);
    resample_info input{audio->samples_per_sec,audio->format,SPEAKERS_STEREO}, output{48000,AUDIO_FORMAT_16BIT,SPEAKERS_STEREO};
    out.resampler = audio_resampler_create(&output,&input);
    out.rate=audio->samples_per_sec;out.format=audio->format;
  }
  uint8_t *data[MAX_AV_PLANES]{};uint32_t frames=0;uint64_t offset=0;
  if (!out.resampler || !audio_resampler_resample(out.resampler,data,&frames,&offset,audio->data,audio->frames) || frames > 4800) { out.failed=true;return; }
  if (!frames) return;
  const uint32_t bytes=frames*4,flags=0;const uint64_t timestamp=(audio->timestamp > offset ? audio->timestamp-offset : 0)/100;
  std::vector<uint8_t> packet(16+bytes);
  memcpy(packet.data(),&bytes,4);memcpy(packet.data()+4,&flags,4);memcpy(packet.data()+8,&timestamp,8);memcpy(packet.data()+16,data[0],bytes);
  // Never let a blocked IPC consumer stall Core Audio's real-time callback.
  std::unique_lock<std::mutex> lock(out.mutex,std::try_to_lock);
  if (!lock.owns_lock()) return;
  while (!out.queue.empty() && out.bytes+packet.size()>20000) {out.bytes-=out.queue.front().size();out.queue.pop_front();}
  out.bytes+=packet.size();out.queue.push_back(std::move(packet));
}
int cg_accompaniment_main(int argc,const char **argv) {
  @autoreleasepool {
    const char *own=argc>3?argv[3]:"city.zqdesigned.cinegather";
    if (strcmp(argv[1],"--audio-applications")==0) {
      NSData *json=[NSJSONSerialization dataWithJSONObject:applications(own) options:0 error:nil];
      fwrite(json.bytes,1,json.length,stdout);return 0;
    }
    if (argc!=4 || strcmp(argv[1],"--accompaniment")!=0) return 2;
    if (@available(macOS 14.2,*)) {} else {fprintf(stderr,"ERROR os-version 80004002\n");return 2;}
    NSString *target=[NSString stringWithUTF8String:argv[2]];
    bool valid=false;
    for (NSDictionary *app in applications(own)) if ([app[@"target"] isEqual:target]) valid=true;
    if (!valid) {fprintf(stderr,"ERROR target 80070005\n");return 2;}
    signal(SIGPIPE,SIG_IGN);
    fcntl(STDOUT_FILENO,F_SETFL,fcntl(STDOUT_FILENO,F_GETFL)|O_NONBLOCK);
    PcmOutput out;
    NSObject *capture=cg_start_application_pcm(argv[2],own,pcm,&out);
    if (!capture) {fprintf(stderr,"ERROR capture 80004005\n");return 2;}
    const pid_t parent=getppid();
    fprintf(stderr,"READY\n");fflush(stderr);
    std::thread writer([&] {
      while (out.running) {
        std::vector<uint8_t> packet;
        {std::lock_guard<std::mutex> lock(out.mutex);if (!out.queue.empty()) {packet=std::move(out.queue.front());out.queue.pop_front();out.bytes-=packet.size();}}
        if (packet.empty()) {usleep(2000);continue;}
        size_t offset=0;
        while (offset<packet.size() && out.running) {
          pollfd fd{STDOUT_FILENO,POLLOUT,0};
          if (poll(&fd,1,100)<=0) continue;
          ssize_t count=write(STDOUT_FILENO,packet.data()+offset,packet.size()-offset);
          if (count<0 && (errno==EAGAIN || errno==EINTR)) continue;
          if (count<=0) {out.running=false;break;}offset+=count;
        }
      }
    });
    while (out.running && getppid()==parent) {
      pollfd fd{STDIN_FILENO,POLLIN,0};
      if (poll(&fd,1,200)>0) break; // Stop byte, pipe EOF or parent gone.
      if (out.failed || cg_application_pcm_failed(capture) || ![NSRunningApplication runningApplicationsWithBundleIdentifier:target].count) {out.failed=true;break;}
    }
    cg_stop_process_audio(capture);out.running=false;writer.join();
    if (out.failed) fprintf(stderr,"ERROR capture-ended 80004005\n");
    return out.failed?1:0;
  }
}
