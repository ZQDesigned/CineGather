#import <ReplayKit/ReplayKit.h>
#import "CGScreenPublisher.h"

@interface SampleHandler : RPBroadcastSampleHandler
@end
@implementation SampleHandler {
  CGScreenPublisher *_publisher;
  NSURL *_config,*_report;
  NSString *_id;
  NSTimeInterval _lastReport;
  NSString *_state,*_reason;
  BOOL _finished;
  dispatch_queue_t _samples;
  dispatch_source_t _watchdog;
}
- (void)broadcastStartedWithSetupInfo:(NSDictionary<NSString *,NSObject *> *)setupInfo {
  _samples=dispatch_queue_create("city.zqdesigned.cinegather.broadcast",DISPATCH_QUEUE_SERIAL);
  NSString *group=[[NSBundle mainBundle] objectForInfoDictionaryKey:@"CGScreenShareGroup"];
  NSURL *root=[[NSFileManager defaultManager] containerURLForSecurityApplicationGroupIdentifier:group];
  _config=[root URLByAppendingPathComponent:@"capture.json"];_report=[root URLByAppendingPathComponent:@"capture-status.json"];
  NSDictionary *options=_config ? [NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfURL:_config] ?: [NSData data] options:0 error:nil] : nil;
  if(!options || [options[@"authorizationDeadline"] doubleValue] < [NSDate date].timeIntervalSince1970 || [options[@"expiresAt"] doubleValue]/1000 < [NSDate date].timeIntervalSince1970) { [self finish:@"请先在映聚房间内发起屏幕共享"];return; }
  _id=options[@"id"];_state=@"publishing";_reason=@"";
  _publisher=[CGScreenPublisher new];
  __weak typeof(self) weak=self;
  _publisher.status=^(NSString *state,NSString *reason){ typeof(self) self=weak;if(!self)return;self->_state=state;self->_reason=reason;[self writeReport];if([state isEqual:@"failed"])[self finish:reason]; };
  dispatch_async(dispatch_get_main_queue(),^{[self->_publisher start:options completion:^(NSError *e){if(e)[weak finish:e.localizedDescription];}];});
  _watchdog=dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER,0,0,dispatch_get_main_queue());
  dispatch_source_set_timer(_watchdog,dispatch_time(DISPATCH_TIME_NOW,NSEC_PER_SEC),NSEC_PER_SEC,NSEC_PER_SEC/10);
  dispatch_source_set_event_handler(_watchdog,^{
    typeof(self) self=weak;if(!self)return;
    NSDictionary *current=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfURL:self->_config] ?: [NSData data] options:0 error:nil];
    if(![current[@"id"] isEqual:self->_id] || [current[@"expiresAt"] doubleValue]/1000 < [NSDate date].timeIntervalSince1970) { [self finish:@"共享已停止"];return; }
    [self writeReport];
  });dispatch_resume(_watchdog);
}
- (void)writeReport {
  if(!_report || !_id)return;
  NSDictionary *report=@{@"id":_id,@"state":_state ?: @"publishing",@"reason":_reason ?: @"",@"diagnostics":_publisher.diagnostics ?: @{}};
  NSData *data=[NSJSONSerialization dataWithJSONObject:report options:0 error:nil];
  [data writeToURL:_report options:NSDataWritingAtomic|NSDataWritingFileProtectionCompleteUntilFirstUserAuthentication error:nil];
}
- (void)finish:(NSString *)message {
  dispatch_async(dispatch_get_main_queue(),^{
    if(self->_finished)return;self->_finished=YES;if(![self->_state isEqual:@"failed"])self->_state=@"stopped";self->_reason=message;[self writeReport];
    [self->_publisher stop];self->_publisher=nil;
    NSDictionary *current=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfURL:self->_config] ?: [NSData data] options:0 error:nil];
    if([current[@"id"] isEqual:self->_id]) [[NSFileManager defaultManager] removeItemAtURL:self->_config error:nil];
    if(self->_watchdog){dispatch_source_cancel(self->_watchdog);self->_watchdog=nil;}
    [self finishBroadcastWithError:[NSError errorWithDomain:@"CineGather" code:1 userInfo:@{NSLocalizedDescriptionKey:message}]];
  });
}
- (void)broadcastFinished {
  _finished=YES;if(_watchdog){dispatch_source_cancel(_watchdog);_watchdog=nil;}
  dispatch_sync(_samples,^{[self->_publisher stop];self->_publisher=nil;});
  _state=@"stopped";_reason=@"系统已停止屏幕共享";[self writeReport];
  NSDictionary *current=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfURL:_config] ?: [NSData data] options:0 error:nil];
  if([current[@"id"] isEqual:_id]) [[NSFileManager defaultManager] removeItemAtURL:_config error:nil];
}
- (void)broadcastPaused { _state=@"paused";[self writeReport]; }
- (void)broadcastResumed { _state=@"active";[self writeReport]; }
- (void)processSampleBuffer:(CMSampleBufferRef)sampleBuffer withType:(RPSampleBufferType)type {
  if(_finished || !_publisher)return;
  // RP audioMic is intentionally ignored. Voice remains a separate room track.
  if(type!=RPSampleBufferTypeVideo && type!=RPSampleBufferTypeAudioApp)return;
  CFRetain(sampleBuffer);
  dispatch_sync(_samples,^{if(!self->_finished){if(type==RPSampleBufferTypeVideo){
    NSNumber *orientation=(__bridge NSNumber *)CMGetAttachment(sampleBuffer,(__bridge CFStringRef)RPVideoSampleOrientationKey,NULL);
    NSInteger rotation=orientation.integerValue==6 ? 90 : orientation.integerValue==8 ? 270 : orientation.integerValue==3 ? 180 : 0;
    [self->_publisher video:sampleBuffer rotation:rotation];
  }else [self->_publisher audio:sampleBuffer];}});
  CFRelease(sampleBuffer);
}
@end
