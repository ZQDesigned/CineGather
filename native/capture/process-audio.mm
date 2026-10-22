// SPDX-License-Identifier: MIT
// Core Audio supplies process-filtered PCM; OBS retains mixing, resampling,
// timestamps, encoding and WHIP transport. No virtual output device is selected.
#import <AppKit/AppKit.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudio/CATapDescription.h>
#import <CoreAudio/AudioHardwareTapping.h>
#import <AudioToolbox/AudioToolbox.h>
#include <libproc.h>
#include <atomic>
#include "process-audio.h"
#include "audio-exclusions.h"

static OSStatus readProperty(AudioObjectID object, AudioObjectPropertySelector selector, void *data, UInt32 *size) {
  AudioObjectPropertyAddress address = {selector, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  return AudioObjectGetPropertyData(object, &address, 0, nullptr, size, data);
}
static NSString *processBundle(pid_t pid) {
  NSString *bundle = [NSRunningApplication runningApplicationWithProcessIdentifier:pid].bundleIdentifier;
  if (bundle.length) return bundle;
  // Resolve newly created services before Launch Services publishes their identity.
  char bytes[PROC_PIDPATHINFO_MAXSIZE] = {};
  if (proc_pidpath(pid, bytes, sizeof(bytes)) > 0) {
    NSString *path = [NSString stringWithUTF8String:bytes];
    NSRange boundary = [path rangeOfString:@".app/Contents/"];
    if (boundary.location != NSNotFound)
      return [NSBundle bundleWithPath:[path substringToIndex:boundary.location + 4]].bundleIdentifier ?: @"";
  }
  return @"";
}
static bool belongsTo(pid_t pid, NSString *family) {
  if (cg_audio_bundle_family(processBundle(pid).UTF8String, family.UTF8String)) return true;
  // Audio services and other children may not have an SCRunningApplication.
  for (int depth = 0; pid > 1 && depth < 32; depth++) {
    if (cg_audio_bundle_family(processBundle(pid).UTF8String, family.UTF8String)) return true;
    proc_bsdinfo info = {};
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) break;
    pid = info.pbi_ppid;
  }
  return false;
}

API_AVAILABLE(macos(14.2))
@interface CGProcessAudio : NSObject {
@public
  std::atomic<bool> blocked, failed;
  obs_source_t *source;
  AudioObjectID tap, device;
  AudioDeviceIOProcID io;
  AudioStreamBasicDescription format;
}
@property(nonatomic, copy) NSString *application;
@property(nonatomic, copy) NSString *own;
@property BOOL system;
@property BOOL stopped;
@property(nonatomic, strong) CATapDescription *tapDescription;
@property(nonatomic, strong) dispatch_queue_t control;
@property(nonatomic, strong) dispatch_source_t monitor;
@property(nonatomic, copy) AudioObjectPropertyListenerBlock listener;
@property(nonatomic, copy) AudioObjectPropertyListenerBlock formatListener;
@property(nonatomic, strong) NSArray<NSNumber *> *processes;
- (NSArray<NSNumber *> *)selectedProcesses;
- (BOOL)refresh;
- (void)fail;
- (void)invalidate;
@end
@implementation CGProcessAudio
- (NSArray<NSNumber *> *)selectedProcesses {
  AudioObjectPropertyAddress address = {kAudioHardwarePropertyProcessObjectList,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject,&address,0,nullptr,&size) != noErr) return nil;
  NSMutableData *data = [NSMutableData dataWithLength:size];
  if (AudioObjectGetPropertyData(kAudioObjectSystemObject,&address,0,nullptr,&size,data.mutableBytes) != noErr) return nil;
  NSMutableArray *result = [NSMutableArray array];
  const AudioObjectID *objects = (const AudioObjectID *)data.bytes;
  for (UInt32 i=0;i<size/sizeof(AudioObjectID);i++) {
    pid_t pid = 0; UInt32 bytes = sizeof(pid);
    if (readProperty(objects[i],kAudioProcessPropertyPID,&pid,&bytes) != noErr) continue;
    bool own = pid == getpid() || belongsTo(pid,@"city.zqdesigned.cinegather") || (self.own.length && belongsTo(pid,self.own));
    if (self.system ? own : (!own && belongsTo(pid,self.application))) [result addObject:@(objects[i])];
  }
  [result sortUsingSelector:@selector(compare:)];
  return result;
}
- (void)fail {
  failed.store(true);blocked.store(true);
  obs_data_t *state = obs_source_get_private_settings(source);
  obs_data_set_bool(state,"cg_audio_exclusion_failed",true);
  obs_data_release(state);
}
- (BOOL)refresh {
  if (self.stopped || failed.load()) return NO;
  NSArray *processes = [self selectedProcesses];
  if (!processes) { [self fail]; return NO; }
  if (![processes isEqual:self.processes]) {
    blocked.store(true);
    self.tapDescription.processes = processes;
    CATapDescription *description = self.tapDescription;
    AudioObjectPropertyAddress address = {kAudioTapPropertyDescription,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    if (AudioObjectSetPropertyData(tap,&address,0,nullptr,sizeof(description),&description) != noErr) { [self fail]; return NO; }
    self.processes = processes;
  }
  blocked.store(false);
  return YES;
}
- (void)invalidate {
  if (self.stopped) return;
  self.stopped = YES;blocked.store(true);
  if (self.monitor) { dispatch_source_cancel(self.monitor); self.monitor=nil; }
  AudioObjectPropertyAddress processes={kAudioHardwarePropertyProcessObjectList,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
  if (self.listener) AudioObjectRemovePropertyListenerBlock(kAudioObjectSystemObject,&processes,self.control,self.listener);
  AudioObjectPropertyAddress tapFormat={kAudioTapPropertyFormat,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
  if (self.formatListener && tap) AudioObjectRemovePropertyListenerBlock(tap,&tapFormat,self.control,self.formatListener);
  if (io && device) { AudioDeviceStop(device,io); AudioDeviceDestroyIOProcID(device,io);io=nullptr; }
  if (device) { AudioHardwareDestroyAggregateDevice(device); device=0; }
  if (tap) { AudioHardwareDestroyProcessTap(tap);tap=0; }
}
@end

NSObject *cg_start_process_audio(obs_source_t *source, bool system, const char *application, const char *own) {
  if (@available(macOS 14.2,*)) {
    CGProcessAudio *capture=[CGProcessAudio new];capture->source=source;capture->blocked=true;capture->failed=false;
    capture.system=system;capture.application=[NSString stringWithUTF8String:application ?: ""];
    capture.own=[NSString stringWithUTF8String:own ?: ""];
    capture.control=dispatch_queue_create("city.cinegather.audio-filter",DISPATCH_QUEUE_SERIAL);
    capture.processes=[capture selectedProcesses];
    if (!capture.processes) return nil;
    capture.tapDescription=system?[[CATapDescription alloc]initStereoGlobalTapButExcludeProcesses:capture.processes]:[[CATapDescription alloc]initStereoMixdownOfProcesses:capture.processes];
    capture.tapDescription.privateTap=YES;capture.tapDescription.muteBehavior=CATapUnmuted;
    capture.tapDescription.name=@"CineGather filtered shared audio";
    if (AudioHardwareCreateProcessTap(capture.tapDescription,&capture->tap) != noErr) return nil;
    UInt32 size=sizeof(capture->format);
    if (readProperty(capture->tap,kAudioTapPropertyFormat,&capture->format,&size)!=noErr || capture->format.mFormatID!=kAudioFormatLinearPCM || !(capture->format.mFormatFlags&kAudioFormatFlagIsFloat) || capture->format.mChannelsPerFrame!=2) { cg_stop_process_audio(capture);return nil; }
    NSDictionary *aggregate=@{@kAudioAggregateDeviceNameKey:@"CGScreenCaptureHost private capture",@kAudioAggregateDeviceUIDKey:NSUUID.UUID.UUIDString,@kAudioAggregateDeviceIsPrivateKey:@YES,@kAudioAggregateDeviceIsStackedKey:@NO,@kAudioAggregateDeviceTapAutoStartKey:@YES,@kAudioAggregateDeviceTapListKey:@[@{@kAudioSubTapUIDKey:capture.tapDescription.UUID.UUIDString,@kAudioSubTapDriftCompensationKey:@YES}]};
    if (AudioHardwareCreateAggregateDevice((__bridge CFDictionaryRef)aggregate,&capture->device)!=noErr) { cg_stop_process_audio(capture);return nil; }
    __weak CGProcessAudio *weak=capture;
    OSStatus status=AudioDeviceCreateIOProcIDWithBlock(&capture->io,capture->device,nullptr,^(const AudioTimeStamp *now,const AudioBufferList *input,const AudioTimeStamp *inputTime,AudioBufferList *out,const AudioTimeStamp *outTime){
      CGProcessAudio *active=weak;
      if (!active || active->blocked.load() || !input->mNumberBuffers || !input->mBuffers[0].mData) return;
      obs_source_audio audio={};
      bool planar=active->format.mFormatFlags&kAudioFormatFlagIsNonInterleaved;
      for (UInt32 i=0;i<input->mNumberBuffers && i<MAX_AV_PLANES;i++) audio.data[i]=(const uint8_t *)input->mBuffers[i].mData;
      audio.frames=input->mBuffers[0].mDataByteSize/active->format.mBytesPerFrame;
      audio.samples_per_sec=(uint32_t)active->format.mSampleRate;audio.speakers=SPEAKERS_STEREO;
      audio.format=planar?AUDIO_FORMAT_FLOAT_PLANAR:AUDIO_FORMAT_FLOAT;
      audio.timestamp=AudioConvertHostTimeToNanos((inputTime->mFlags&kAudioTimeStampHostTimeValid)?inputTime->mHostTime:now->mHostTime);
      obs_source_output_audio(active->source,&audio);
    });
    if (status!=noErr) { cg_stop_process_audio(capture);return nil; }
    capture.listener=^(UInt32 count,const AudioObjectPropertyAddress *addresses){CGProcessAudio *active=weak;if(active&&!active.stopped){active->blocked=true;[active refresh];}};
    AudioObjectPropertyAddress processAddress={kAudioHardwarePropertyProcessObjectList,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    if (AudioObjectAddPropertyListenerBlock(kAudioObjectSystemObject,&processAddress,capture.control,capture.listener)!=noErr) { cg_stop_process_audio(capture);return nil; }
    capture.formatListener=^(UInt32 count,const AudioObjectPropertyAddress *addresses){CGProcessAudio *active=weak;if(active&&!active.stopped)[active fail];};
    AudioObjectPropertyAddress formatAddress={kAudioTapPropertyFormat,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
    if (AudioObjectAddPropertyListenerBlock(capture->tap,&formatAddress,capture.control,capture.formatListener)!=noErr) { cg_stop_process_audio(capture);return nil; }
    capture.monitor=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,capture.control);
    dispatch_source_set_timer(capture.monitor,dispatch_time(DISPATCH_TIME_NOW,250*NSEC_PER_MSEC),250*NSEC_PER_MSEC,25*NSEC_PER_MSEC);
    dispatch_source_set_event_handler(capture.monitor,^{CGProcessAudio *active=weak;if(active&&!active.stopped)[active refresh];});dispatch_resume(capture.monitor);
    if (![capture refresh] || AudioDeviceStart(capture->device,capture->io)!=noErr) { cg_stop_process_audio(capture);return nil; }
    return capture;
  }
  return nil;
}
void cg_stop_process_audio(NSObject *object) {
  if (@available(macOS 14.2,*)) {
    CGProcessAudio *capture=(CGProcessAudio *)object;
    // Serialize teardown with process-list changes. Stop waits for I/O callbacks.
    dispatch_sync(capture.control,^{[capture invalidate];});
  }
}
