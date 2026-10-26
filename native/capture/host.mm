#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>
#include <atomic>
#include <chrono>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <obs.h>
#include <poll.h>
#include <stdexcept>
#include <string>
#include <thread>
#include <unistd.h>
#include <util/base.h>
#include "preview-control.hpp"
#include "source-swap.hpp"

// SPDX-License-Identifier: MIT
// Direct libobs host. Commands arrive only through the parent-owned stdio pipe.
static obs_scene_t *scene = nullptr;
static obs_source_t *windowSource = nullptr, *audioSource = nullptr;
static obs_output_t *output = nullptr;
static obs_encoder_t *videoEncoder = nullptr, *audioEncoder = nullptr;
static obs_service_t *service = nullptr;
static bool engineReady = false;
static NSString *frameworks, *plugins, *working;
static NSMutableArray *loaded;
static std::atomic<bool> quitting(false);
static int parentPid = 0;
static std::atomic<int64_t> deadlineNs(0);
static int64_t monotonicNs() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
static std::atomic<uint64_t> audioBlocks(0);
static std::atomic<double> audioPeak(0);
static std::atomic<int> outputPhase(0), outputStopCode(-1);
static void outputStarted(void *, calldata_t *) { outputPhase = 2; }
static void outputStopped(void *, calldata_t *data) {
  int code = (int)calldata_int(data, "code");
  outputStopCode = code;
  outputPhase = code ? 3 : 0;
}

static void check(bool ok, const char *message) {
  if (!ok)
    throw std::runtime_error(message);
}
static void logging(int, const char *, va_list, void *) {
} // Upstream debug messages may contain WHIP resource credentials.
static obs_data_t *settings(NSDictionary *dict) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:dict
                                                 options:0
                                                   error:nil];
  return obs_data_create_from_json(
      [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]
          .UTF8String);
}
static void audioMeter(void *, obs_source_t *, const audio_data *audio,
                       bool muted) {
  if (muted || !audio->data[0])
    return;
  const float *p = (const float *)audio->data[0];
  double peak = 0;
  for (uint32_t i = 0; i < audio->frames; i++)
    peak = fmax(peak, fabs(p[i]));
  audioBlocks++;
  audioPeak.store(peak);
}
static void stopCapture() {
  deadlineNs = 0;
  if (output) {
    if (obs_output_active(output))
      obs_output_force_stop(output);
    for (int i = 0; i < 500 && obs_output_active(output); i++)
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    check(!obs_output_active(output), "Output did not stop");
    signal_handler_disconnect(obs_output_get_signal_handler(output), "start",
                              outputStarted, nullptr);
    signal_handler_disconnect(obs_output_get_signal_handler(output), "stop",
                              outputStopped, nullptr);
    obs_output_release(output);
    output = nullptr;
    outputPhase = 0;
  }
  if (videoEncoder) {
    obs_encoder_release(videoEncoder);
    videoEncoder = nullptr;
  }
  if (audioEncoder) {
    obs_encoder_release(audioEncoder);
    audioEncoder = nullptr;
  }
  if (service) {
    obs_service_release(service);
    service = nullptr;
  }
  obs_set_output_source(0, nullptr);
  if (scene) {
    obs_source_remove(obs_scene_get_source(scene));
    obs_scene_release(scene);
    scene = nullptr;
  }
  if (windowSource) {
    obs_source_release(windowSource);
    windowSource = nullptr;
  }
  if (audioSource) {
    obs_source_remove_audio_capture_callback(audioSource, audioMeter, nullptr);
    obs_source_release(audioSource);
    audioSource = nullptr;
  }
  obs_wait_for_destroy_queue();
}
static NSDictionary *status() {
  obs_data_t *preview = obs_data_create();
  cinegather::previewStats(output, preview);
  NSDictionary *previewStatus = [NSJSONSerialization JSONObjectWithData:
      [[NSString stringWithUTF8String:obs_data_get_json(preview)] dataUsingEncoding:NSUTF8StringEncoding]
      options:0 error:nil];
  obs_data_release(preview);
  bool audioFailed = false;
  if (audioSource) {
    obs_data_t *state = obs_source_get_private_settings(audioSource);
    audioFailed = obs_data_get_bool(state, "cg_audio_exclusion_failed");
    obs_data_release(state);
  }
  NSMutableArray *images = [NSMutableArray array];
  for (uint32_t i = 0; i < _dyld_image_count(); i++) {
    NSString *p = [NSString stringWithUTF8String:_dyld_get_image_name(i)];
    if ([p containsString:@"CGScreenCaptureHost.app"] ||
        [p hasPrefix:@"/Applications/OBS.app"])
      [images addObject:p];
  }
  NSMutableDictionary *snapshot = [@{
    @"version" : [NSString stringWithUTF8String:obs_get_version_string()],
    @"pid" : @(getpid()),
    @"engineReady" : @(engineReady),
    @"screenPermission" : @(CGPreflightScreenCaptureAccess()),
    @"runtimeImages" : images,
    @"loadedPlugins" : loaded ?: @[],
    @"activeFps" : @(engineReady ? obs_get_active_fps() : 0),
    @"averageFrameRenderTime" :
        @(engineReady ? obs_get_average_frame_time_ns() / 1000000.0 : 0),
    @"encodingSkippedFrames" :
        @(engineReady ? video_output_get_skipped_frames(obs_get_video()) : 0),
    @"renderTotalFrames" : @(engineReady ? obs_get_total_frames() : 0),
    @"renderSkippedFrames" : @(engineReady ? obs_get_lagged_frames() : 0),
    @"sourceWidth" : @(windowSource ? obs_source_get_width(windowSource) : 0),
    @"sourceHeight" : @(windowSource ? obs_source_get_height(windowSource) : 0),
    @"sourcesActive" : @(windowSource != nullptr),
    @"videoSourceActive" : @(windowSource && obs_source_active(windowSource)),
    @"audioSourceActive" : @(audioSource && obs_source_active(audioSource)),
    @"audioSourceMuted" : @(audioSource && obs_source_muted(audioSource)),
    @"audioCaptureError" : audioFailed ? @"系统声音排除规则更新失败，请重新共享" : @"",
    @"audioBlocks" : @(audioBlocks.load()),
    @"audioPeak" : @(audioPeak.load()),
    @"outputActive" : @(output && obs_output_active(output)),
    @"outputPhase" : @[ @"stopped", @"starting", @"active",
                        @"failed" ][(NSUInteger)outputPhase.load()],
    @"outputStopCode" : @(outputStopCode.load()),
    @"outputTotalFrames" : @(output ? obs_output_get_total_frames(output) : 0),
    @"outputSkippedFrames" :
        @(output ? obs_output_get_frames_dropped(output) : 0),
    @"outputBytes" : @(output ? obs_output_get_total_bytes(output) : 0),
    @"outputCongestion" : @(output ? obs_output_get_congestion(output) : 0),
    @"outputError" : output && obs_output_get_last_error(output)
        ? [NSString stringWithUTF8String:obs_output_get_last_error(output)]
        : @"",
    @"frameworks" : frameworks ?: @"",
    @"nativeAllocationCount" : @(bnum_allocs())
  } mutableCopy];
  [snapshot addEntriesFromDictionary:previewStatus ?: @{}];
  return snapshot;
}
static SCShareableContent *shareableContent(int seconds = 10) {
  __block SCShareableContent *content;
  __block NSError *error;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  [SCShareableContent
      getShareableContentExcludingDesktopWindows:YES
                             onScreenWindowsOnly:NO
                               completionHandler:^(SCShareableContent *c,
                                                   NSError *e) {
                                 content = c;
                                 error = e;
                                 dispatch_semaphore_signal(semaphore);
                               }];
  check(dispatch_semaphore_wait(
            semaphore, dispatch_time(DISPATCH_TIME_NOW, int64_t(seconds) * NSEC_PER_SEC)) ==
            0,
        "Window enumeration timed out");
  if (error)
    throw std::runtime_error(error.localizedDescription.UTF8String);
  return content;
}
static NSArray *enumerateWindows() {
  SCShareableContent *content = shareableContent();
  NSMutableArray *result = [NSMutableArray array];
  for (SCWindow *w in content.windows)
    if (w.title.length && w.owningApplication.bundleIdentifier.length &&
        ![w.owningApplication.bundleIdentifier
            hasPrefix:@"city.zqdesigned.cinegather"])
      [result addObject:@{
        @"windowId" : @(w.windowID),
        @"title" : w.title ?: @"",
        @"application" : w.owningApplication.applicationName ?: @"",
        @"bundleId" : w.owningApplication.bundleIdentifier ?: @"",
        @"pid" : @(w.owningApplication.processID)
      }];
  return result;
}
static NSArray *enumerateDisplays() {
  CGDirectDisplayID ids[32];
  uint32_t count = 0;
  check(CGGetActiveDisplayList(32, ids, &count) == kCGErrorSuccess,
        "Display enumeration failed");
  NSMutableArray *result = [NSMutableArray array];
  for (uint32_t i = 0; i < count; i++)
    [result addObject:@{
      @"displayId" : @(ids[i]),
      @"name" : [NSString stringWithFormat:@"显示器 %u", i + 1]
    }];
  return result;
}
// Preview images are single, audio-free frames, never OBS scene sources or files.
static NSData *encodeThumbnail(CGImageRef image) {
  if (!image) return nil;
  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
  NSData *data = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG
                                    properties:@{NSImageCompressionFactor: @0.65}];
  if (data.length > 40000)
    data = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG
                                properties:@{NSImageCompressionFactor: @0.35}];
  return data.length && data.length <= 40000 ? data : nil;
}
// macOS 13 fallback: stop the short-lived stream after its first complete frame.
@interface CGThumbnailFrame : NSObject <SCStreamOutput>
@property(nonatomic, strong) NSData *image;
@property(nonatomic, strong) dispatch_semaphore_t ready;
@end
@implementation CGThumbnailFrame
- (instancetype)init {
  if ((self = [super init])) _ready = dispatch_semaphore_create(0);
  return self;
}
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample
       ofType:(SCStreamOutputType)type {
  if (type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
  CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(sample, false);
  if (!attachments || !CFArrayGetCount(attachments)) return;
  NSDictionary *info = (__bridge NSDictionary *)CFArrayGetValueAtIndex(attachments, 0);
  if ([info[SCStreamFrameInfoStatus] integerValue] != SCFrameStatusComplete) return;
  @synchronized(self) {
    if (self.image) return;
    CVPixelBufferRef pixels = CMSampleBufferGetImageBuffer(sample);
    if (!pixels || CVPixelBufferLockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) return;
    CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(CVPixelBufferGetBaseAddress(pixels), CVPixelBufferGetWidth(pixels), CVPixelBufferGetHeight(pixels), 8, CVPixelBufferGetBytesPerRow(pixels), color, kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedFirst);
    CGImageRef image = context ? CGBitmapContextCreateImage(context) : nil;
    self.image = encodeThumbnail(image);
    if (image) CGImageRelease(image);
    if (context) CGContextRelease(context);
    CGColorSpaceRelease(color);
    CVPixelBufferUnlockBaseAddress(pixels, kCVPixelBufferLock_ReadOnly);
    if (self.image) dispatch_semaphore_signal(self.ready);
  }
}
@end
static NSString *captureThumbnail(SCContentFilter *filter, CGSize size) {
  if (size.width <= 0 || size.height <= 0) return @"";
  double scale = fmin(400.0 / size.width, 225.0 / size.height);
  SCStreamConfiguration *config = [SCStreamConfiguration new];
  config.width = (size_t)fmax(1, round(size.width * scale));
  config.height = (size_t)fmax(1, round(size.height * scale));
  config.showsCursor = NO;
  config.capturesAudio = NO;
  config.pixelFormat = kCVPixelFormatType_32BGRA;
  config.scalesToFit = YES;
  __block NSData *data;
  dispatch_semaphore_t ready = dispatch_semaphore_create(0);
  if (@available(macOS 14.0, *)) {
    config.ignoreShadowsSingleWindow = YES;
    config.preservesAspectRatio = YES;
    [SCScreenshotManager captureImageWithFilter:filter configuration:config
      completionHandler:^(CGImageRef image, NSError *error) {
        if (!error) data = encodeThumbnail(image);
        dispatch_semaphore_signal(ready);
      }];
    if (dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC))) return @"";
  } else {
    CGThumbnailFrame *frame = [CGThumbnailFrame new];
    SCStream *stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];
    NSError *error;
    if (![stream addStreamOutput:frame type:SCStreamOutputTypeScreen sampleHandlerQueue:dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0) error:&error]) return @"";
    [stream startCaptureWithCompletionHandler:^(NSError *e) { if (e) dispatch_semaphore_signal(frame.ready); }];
    dispatch_semaphore_wait(frame.ready, dispatch_time(DISPATCH_TIME_NOW, 3 * NSEC_PER_SEC));
    @synchronized(frame) { data = frame.image; }
    [stream stopCaptureWithCompletionHandler:^(NSError *) { dispatch_semaphore_signal(ready); }];
    dispatch_semaphore_wait(ready, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC));
  }
  return data ? [@"data:image/jpeg;base64," stringByAppendingString:[data base64EncodedStringWithOptions:0]] : @"";
}
static NSArray *sourceThumbnails(NSArray *sources) {
  check([sources isKindOfClass:[NSArray class]] && sources.count > 0 && sources.count <= 4, "Invalid preview batch");
  check(CGPreflightScreenCaptureAccess(), "Screen recording permission required");
  check(!output, "Stop sharing before refreshing previews");
  SCShareableContent *content = shareableContent(3);
  NSMutableArray *result = [NSMutableArray array];
  dispatch_group_t group = dispatch_group_create();
  for (NSDictionary *source in sources) {
    check([source isKindOfClass:[NSDictionary class]] && [source[@"id"] isKindOfClass:[NSString class]], "Invalid preview source");
    NSString *identifier = source[@"id"];
    SCContentFilter *filter;
    CGSize size = CGSizeZero;
    if (source[@"windowId"]) {
      for (SCWindow *w in content.windows) {
        if (w.windowID == [source[@"windowId"] unsignedIntValue] &&
            w.owningApplication.processID == [source[@"pid"] intValue] &&
            ![w.owningApplication.bundleIdentifier hasPrefix:@"city.zqdesigned.cinegather"]) {
          filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:w];
          size = w.frame.size;
          break;
        }
      }
    } else if (source[@"displayId"]) {
      for (SCDisplay *d in content.displays) {
        if (d.displayID == [source[@"displayId"] unsignedIntValue]) {
          filter = [[SCContentFilter alloc] initWithDisplay:d excludingWindows:@[]];
          size = CGSizeMake(d.width, d.height);
          break;
        }
      }
    }
    NSUInteger index;
    @synchronized(result) {
      index = result.count;
      [result addObject:@{ @"id":identifier, @"thumbnail":@"" }];
    }
    if (!filter) continue;
    dispatch_group_async(group, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      @autoreleasepool {
        NSString *image = @"";
        @try { image = captureThumbnail(filter, size); } @catch (NSException *) {}
        @synchronized(result) { result[index] = @{ @"id":identifier, @"thumbnail":image }; }
      }
    });
  }
  dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, 7 * NSEC_PER_SEC));
  @synchronized(result) { return [result copy]; }
}
static void rtcLog(int, const char *) {}
static void initEngine() {
  base_set_log_handler(logging, nullptr);
  __block bool startupOk = false;
  dispatch_sync(dispatch_get_main_queue(), ^{
    startupOk = obs_startup(
        "zh-CN",
        [working stringByAppendingPathComponent:@"module-config"].UTF8String,
        nullptr);
  });
  check(startupOk, "obs_startup failed");
  engineReady = true;
  // macOS libobs resolves Resources from its loaded framework bundle; no global
  // data-path registration is needed.
  obs_video_info video = {};
  NSString *graphics =
      [frameworks stringByAppendingPathComponent:@"libobs-opengl.dylib"];
  video.graphics_module = graphics.UTF8String;
  video.fps_num = 30;
  video.fps_den = 1;
  video.base_width = 1920;
  video.base_height = 1080;
  video.output_width = 1920;
  video.output_height = 1080;
  video.output_format = VIDEO_FORMAT_NV12;
  video.gpu_conversion = true;
  video.colorspace = VIDEO_CS_709;
  video.range = VIDEO_RANGE_PARTIAL;
  video.scale_type = OBS_SCALE_BICUBIC;
  check(obs_reset_video(&video) == OBS_VIDEO_SUCCESS, "obs_reset_video failed");
  obs_audio_info2 audio = {};
  audio.samples_per_sec = 48000;
  audio.speakers = SPEAKERS_STEREO;
  audio.max_buffering_ms = 1000;
  audio.fixed_buffering = false;
  check(obs_reset_audio2(&audio), "obs_reset_audio failed");
  loaded = [NSMutableArray array];
  for (NSString *name in
       @[ @"mac-capture", @"mac-videotoolbox", @"obs-ffmpeg", @"obs-webrtc" ]) {
    NSString *bundle = [plugins
        stringByAppendingPathComponent:[name
                                           stringByAppendingString:@".plugin"]];
    NSString
        *bin = [bundle
            stringByAppendingPathComponent:[@"Contents/MacOS/"
                                               stringByAppendingString:name]],
        *res = [bundle stringByAppendingPathComponent:@"Contents/Resources"];
    obs_module_t *module = nullptr;
    int code = obs_open_module(&module, bin.UTF8String, res.UTF8String);
    if (code != 0)
      throw std::runtime_error((std::string("obs_open_module ") +
                                name.UTF8String + " failed " +
                                std::to_string(code)));
    check(obs_init_module(module), "obs_init_module failed");
    [loaded addObject:name];
  }
  obs_post_load_modules();
  void *rtc =
      dlopen([frameworks stringByAppendingPathComponent:@"libdatachannel.dylib"]
                 .UTF8String,
             RTLD_NOW);
  auto logger =
      (void (*)(int, void (*)(int, const char *)))dlsym(rtc, "rtcInitLogger");
  check(logger, "RTC logger unavailable");
  logger(3, rtcLog);
}
static void prepareScene(NSDictionary *config, cinegather::CaptureScene &next) {
  NSArray *windows = enumerateWindows();
  NSNumber *windowId = config[@"windowId"];
  NSString *bundleId = config[@"application"];
  NSNumber *displayId = config[@"displayId"];
  bool valid = false;
  for (NSDictionary *w in windows)
    if ([w[@"windowId"] isEqual:windowId] &&
        [w[@"bundleId"] isEqual:bundleId] && [w[@"pid"] isEqual:config[@"pid"]])
      valid = true;
  if (displayId) {
    valid = false;
    for (NSDictionary *d in enumerateDisplays())
      if ([d[@"displayId"] isEqual:displayId])
        valid = true;
  }
  check(valid, "共享来源已关闭，请重新选择");
  next.scene = obs_scene_create("CineGather native libobs scene");
  check(next.scene, "Scene creation failed");
  obs_data_t *ws = settings(@{
    @"type" : displayId ? @0 : @1,
    @"window" : windowId ?: @0,
    @"display" : displayId ?: @0,
    @"show_cursor" : @NO,
    @"show_hidden_windows" : @YES
  });
  next.video = obs_source_create("screen_capture", "CineGather native window",
                                   ws, nullptr);
  obs_data_release(ws);
  check(next.video, "Window source creation failed");
  obs_source_set_muted(next.video, true);
  if ([config[@"systemAudio"] boolValue]) {
    obs_data_t *as = settings(@{
      @"type" : displayId ? @0 : @1,
      @"application" : bundleId ?: @"",
      @"excluded_application" : config[@"excludedApplication"] ?: @"city.zqdesigned.cinegather"
    });
    next.audio =
        obs_source_create("sck_audio_capture",
                          "CineGather native shared audio", as, nullptr);
    obs_data_release(as);
    check(next.audio, "声音采集启动失败，请检查 CGScreenCaptureHost 的系统录音权限");
    obs_source_set_audio_mixers(next.audio, 1);


  }
}
static void startCapture(NSDictionary *config) {
  check(!output, "Stop the existing output first");
  check(CGPreflightScreenCaptureAccess(),
        "请在系统设置中允许 CGScreenCaptureHost 录屏与系统录音后重试");
  if (config[@"displayId"] && [config[@"systemAudio"] boolValue]) {
    if (@available(macOS 14.2, *)) {} else
      check(false, "排除映聚的系统声音共享需要 macOS 14.2 或更新版本");
  }
  int timeout = [config[@"remainingMs"] intValue];
  check(timeout > 0 && timeout <= 30000, "Invalid lease deadline");
  deadlineNs = monotonicNs() + int64_t(timeout) * 1000000;
  NSString *quality = config[@"quality"];
  int width = [quality isEqual:@"saver"] ? 1280 : 1920,
      height = [quality isEqual:@"saver"] ? 720 : 1080,
      fps = [quality isEqual:@"game"] ? 60 : 30,
      bitrate = [quality isEqual:@"saver"]
                    ? 2000
                    : ([quality isEqual:@"game"] ? 8000 : 5000);
  obs_video_info vi = {};
  check(obs_get_video_info(&vi), "Video unavailable");
  vi.base_width = vi.output_width = width;
  vi.base_height = vi.output_height = height;
  vi.fps_num = fps;
  check(obs_reset_video(&vi) == OBS_VIDEO_SUCCESS, "Video reset failed");
  cinegather::CaptureScene next;
  prepareScene(config, next);
  auto *item = obs_scene_add(next.scene, next.video);
  obs_sceneitem_set_bounds_type(item, OBS_BOUNDS_SCALE_INNER);
  vec2 bounds; vec2_set(&bounds, width, height);
  obs_sceneitem_set_bounds(item, &bounds);
  if (next.audio) obs_scene_add(next.scene, next.audio);
  std::swap(scene, next.scene); std::swap(windowSource, next.video); std::swap(audioSource, next.audio);
  audioBlocks = 0; audioPeak = 0;
  if (audioSource) obs_source_add_audio_capture_callback(audioSource, audioMeter, nullptr);
  obs_set_output_source(0, obs_scene_get_source(scene));
  obs_data_t *vs = settings(@{
    @"rate_control" : @"CBR",
    @"bitrate" : @(bitrate),
    @"keyint_sec" : @1,
    @"profile" : @"baseline",
    @"bframes" : @NO,
    @"spatial_aq" : @NO
  });
  videoEncoder =
      obs_video_encoder_create("com.apple.videotoolbox.videoencoder.ave.avc",
                               "CineGather hardware H264", vs, nullptr);
  obs_data_release(vs);
  check(videoEncoder, "Hardware video encoder creation failed");
  obs_encoder_set_video(videoEncoder, obs_get_video());
  if (audioSource) {
    obs_data_t *aps = settings(@{@"bitrate" : @160});
    audioEncoder = obs_audio_encoder_create(
        "ffmpeg_opus", "CineGather film Opus", aps, 0, nullptr);
    obs_data_release(aps);
    check(audioEncoder, "Opus encoder creation failed");
    obs_encoder_set_audio(audioEncoder, obs_get_audio());
  }
  obs_data_t *ss = settings(
      @{@"server" : config[@"server"], @"bearer_token" : config[@"token"]});
  service =
      obs_service_create("whip_custom", "CineGather WHIP service", ss, nullptr);
  obs_data_release(ss);
  check(service, "WHIP service creation failed");
  output = obs_output_create(audioEncoder ? "whip_output" : "whip_output_video",
                             "CineGather native WHIP", nullptr, nullptr);
  check(output, "WHIP output creation failed");
  outputPhase = 1;
  outputStopCode = -1;
  signal_handler_connect(obs_output_get_signal_handler(output), "start",
                         outputStarted, nullptr);
  signal_handler_connect(obs_output_get_signal_handler(output), "stop",
                         outputStopped, nullptr);
  obs_output_set_video_encoder(output, videoEncoder);
  if (audioEncoder)
    obs_output_set_audio_encoder(output, audioEncoder, 0);
  obs_output_set_service(output, service);
  check(obs_output_start(output), "WHIP output did not start");
}
static void switchSource(NSDictionary *config) {
  check(output && outputPhase == 2 && deadlineNs > monotonicNs(), "共享已停止");
  check(CGPreflightScreenCaptureAccess(), "屏幕录制权限已失效");
  check([config[@"systemAudio"] boolValue] == bool(audioEncoder), "切换来源时请保留当前共享声音设置");
  if (config[@"displayId"] && audioEncoder) {
    if (@available(macOS 14.2, *)) {} else check(false, "系统声音共享需要 macOS 14.2 或更新版本");
  }
  obs_video_info vi = {}; check(obs_get_video_info(&vi), "Video unavailable");
  cinegather::CaptureScene next;
  prepareScene(config, next);
  next.warm(vi.base_width, vi.base_height, [] { return deadlineNs > monotonicNs(); });
  if (next.audio) {
    obs_data_t *state = obs_source_get_private_settings(next.audio);
    bool failed = obs_data_get_bool(state, "cg_audio_exclusion_failed");
    obs_data_release(state);
    check(!failed, "新来源的声音采集不可用，请检查录音权限");
  }
  if (audioSource) obs_source_remove_audio_capture_callback(audioSource, audioMeter, nullptr);
  next.commit(scene, windowSource, audioSource);
  if (audioSource) obs_source_add_audio_capture_callback(audioSource, audioMeter, nullptr);
}
static id handle(NSDictionary *command) {
  NSString *type = command[@"type"];
  if ([type isEqual:@"status"])
    return status();
  if ([type isEqual:@"preview-stop"]) {
    if (output) cinegather::previewControl(output, "stop");
    return @{};
  }
  if ([type isEqual:@"preview-start"] || [type isEqual:@"preview-answer"]) {
    check(output && outputPhase == 2 && deadlineNs > monotonicNs(), "preview-inactive");
    const auto offer = cinegather::previewControl(output,
        [type isEqual:@"preview-start"] ? "start" : "answer",
        [command[@"sdp"] isKindOfClass:NSString.class] ? [command[@"sdp"] UTF8String] : "");
    return [type isEqual:@"preview-start"] ? @{@"sdp":[NSString stringWithUTF8String:offer.c_str()]} : @{};
  }
  if ([type isEqual:@"requestPermission"]) {
    __block bool granted = false;
    dispatch_sync(dispatch_get_main_queue(), ^{
      granted = CGRequestScreenCaptureAccess();
    });
    return @{@"screenPermission" : @(granted)};
  }
  if ([type isEqual:@"windows"])
    return
        @{@"windows" : enumerateWindows(), @"displays" : enumerateDisplays()};
  if ([type isEqual:@"thumbnails"])
    return sourceThumbnails(command[@"sources"]);
  if ([type isEqual:@"renew"]) {
    int timeout = [command[@"remainingMs"] intValue];
    check(output && timeout > 0 && timeout <= 30000, "Invalid renewal");
    deadlineNs = monotonicNs() + int64_t(timeout) * 1000000;
    return status();
  }
  if ([type isEqual:@"switch-source"]) {
    switchSource(command);
    return status();
  }
  if ([type isEqual:@"start"]) {
    check(!output, "Already sharing");
    try {
      startCapture(command);
    } catch (...) {
      stopCapture();
      throw;
    }
    return status();
  }
  if ([type isEqual:@"stop"]) {
    stopCapture();
    return status();
  }
  if ([type isEqual:@"shutdown"]) {
    stopCapture();
    obs_shutdown();
    engineReady = false;
    quitting = true;
    return @{
      @"shutdown" : @YES,
      @"nativeAllocationCountAfterShutdown" : @(bnum_allocs())
    };
  }
  throw std::runtime_error("Unknown native host command");
}
static void serve() {
  @autoreleasepool {
    try {
      initEngine();
      std::string input;
      bool done = false;
      while (!quitting && !done) {
        if (getppid() != parentPid) {
          stopCapture();
          break;
        }
        if (deadlineNs.load() > 0 && monotonicNs() >= deadlineNs.load())
          stopCapture();
        pollfd poller = {STDIN_FILENO, POLLIN, 0};
        int ready = poll(&poller, 1, 100);
        if (ready <= 0)
          continue;
        char bytes[4096];
        ssize_t count = read(STDIN_FILENO, bytes, sizeof(bytes));
        if (count <= 0) {
          stopCapture();
          break;
        }
        input.append(bytes, count);
        if (input.size() > 32768) {
          stopCapture();
          break;
        }
        size_t newline;
        while ((newline = input.find('\n')) != std::string::npos) {
          @autoreleasepool {
            std::string line = input.substr(0, newline);
            input.erase(0, newline + 1);
            NSDictionary *response;
            @try {
              try {
                NSData *data = [NSData dataWithBytes:line.data()
                                              length:line.size()];
                NSDictionary *command =
                    [NSJSONSerialization JSONObjectWithData:data
                                                    options:0
                                                      error:nil];
                check([command isKindOfClass:[NSDictionary class]],
                      "Malformed command");
                response = @{@"ok" : @YES, @"data" : handle(command)};
              } catch (const std::exception &e) {
                response = @{
                  @"ok" : @NO,
                  @"error" : [NSString stringWithUTF8String:e.what()]
                };
              }
            } @catch (NSException *e) {
              response = @{@"ok" : @NO, @"error" : @"Native capture failed"};
            }
            NSData *encoded = [NSJSONSerialization dataWithJSONObject:response
                                                              options:NSJSONWritingWithoutEscapingSlashes
                                                                error:nil];
            fwrite(encoded.bytes, 1, encoded.length, stdout);
            fputc('\n', stdout);
            fflush(stdout);
          }
        }
      }
      if (engineReady) {
        stopCapture();
        obs_shutdown();
        engineReady = false;
      }
      dispatch_async(dispatch_get_main_queue(), ^{
        [NSApp terminate:nil];
      });
    } catch (...) {
      _exit(2);
    }
  }
}
int cg_accompaniment_main(int argc, const char **argv);
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc >= 2 && (!strcmp(argv[1], "--accompaniment") || !strcmp(argv[1], "--audio-applications")))
      return cg_accompaniment_main(argc, argv);
    if (argc != 2)
      return 0;
    parentPid = getppid();
    working = [NSString stringWithUTF8String:argv[1]];
    NSString *contents = [NSBundle mainBundle].bundlePath;
    frameworks =
        [contents stringByAppendingPathComponent:@"Contents/Frameworks"];
    plugins = [contents stringByAppendingPathComponent:@"Contents/PlugIns"];
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    CGMainDisplayID();
    signal(SIGPIPE, SIG_IGN);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      serve();
    });
    [NSApp run];
    return 0;
  }
}
