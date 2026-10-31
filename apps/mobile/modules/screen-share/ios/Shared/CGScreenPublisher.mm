#import "CGScreenPublisher.h"
#import <LiveKitWebRTC/LiveKitWebRTC.h>
#import <AVFoundation/AVFoundation.h>
#import <os/lock.h>
#import <mach/mach_time.h>
#include <deque>
#include <atomic>
#include <algorithm>

// Playback PCM has its own ADM and never enters the call microphone ADM.
@interface CGPlaybackDevice : NSObject<LKRTCAudioDevice>
- (void)append:(CMSampleBufferRef)sample;
@property(nonatomic, readonly) uint64_t buffers;
@end
@implementation CGPlaybackDevice {
  id<LKRTCAudioDeviceDelegate> _delegate;
  NSThread *_thread;
  std::atomic<bool> _recording;
  BOOL _initialized,_playing;
  os_unfair_lock _lock;
  std::deque<int16_t> _pcm;
  AVAudioConverter *_converter;
  AVAudioFormat *_inputFormat;
  std::atomic<uint64_t> _buffers;
}
- (instancetype)init { if((self=[super init])) { _lock=OS_UNFAIR_LOCK_INIT;_recording=false; } return self; }
- (double)deviceInputSampleRate { return 48000; }
- (double)deviceOutputSampleRate { return 48000; }
- (NSTimeInterval)inputIOBufferDuration { return .01; }
- (NSTimeInterval)outputIOBufferDuration { return .01; }
- (NSInteger)inputNumberOfChannels { return 2; }
- (NSInteger)outputNumberOfChannels { return 2; }
- (NSTimeInterval)inputLatency { return .01; }
- (NSTimeInterval)outputLatency { return 0; }
- (BOOL)isInitialized { return _initialized; }
- (BOOL)initializeWithDelegate:(id<LKRTCAudioDeviceDelegate>)delegate { _delegate=delegate;_initialized=YES;return YES; }
- (BOOL)terminateDevice { [self stopRecording];_delegate=nil;_initialized=NO;return YES; }
- (BOOL)isPlayoutInitialized { return YES; }
- (BOOL)initializePlayout { return YES; }
- (BOOL)isPlaying { return _playing; }
- (BOOL)startPlayout { _playing=YES;return YES; }
- (BOOL)stopPlayout { _playing=NO;return YES; }
- (BOOL)isRecordingInitialized { return YES; }
- (BOOL)initializeRecording { return YES; }
- (BOOL)isRecording { return _recording.load(); }
- (BOOL)startRecording {
  if(_recording.exchange(true)) return YES;
  _thread=[[NSThread alloc] initWithTarget:self selector:@selector(pump) object:nil];
  _thread.name=@"CineGatherPlaybackPCM";_thread.qualityOfService=NSQualityOfServiceUserInteractive;[_thread start];return YES;
}
- (BOOL)stopRecording {
  _recording=false;
  while(_thread && ![_thread isFinished] && [NSThread currentThread]!=_thread) [NSThread sleepForTimeInterval:.001];
  _thread=nil;return YES;
}
- (void)pump { @autoreleasepool {
  uint64_t frames=0;
  while(_recording) { @autoreleasepool {
    NSTimeInterval begin=[NSDate timeIntervalSinceReferenceDate];
    int16_t samples[960]={0};
    os_unfair_lock_lock(&_lock);
    NSUInteger n=MIN((NSUInteger)960,_pcm.size());for(NSUInteger i=0;i<n;i++){samples[i]=_pcm.front();_pcm.pop_front();}
    os_unfair_lock_unlock(&_lock);
    AudioBufferList list={1,{{2,sizeof(samples),samples}}};
    AudioTimeStamp stamp={0};stamp.mSampleTime=frames;stamp.mHostTime=mach_absolute_time();stamp.mFlags=kAudioTimeStampSampleTimeValid|kAudioTimeStampHostTimeValid;
    AudioUnitRenderActionFlags flags=0;
    _delegate.deliverRecordedData(&flags,&stamp,0,480,&list,NULL,nil);
    frames+=480;
    [NSThread sleepForTimeInterval:MAX(0,.01-([NSDate timeIntervalSinceReferenceDate]-begin))];
  }}
} }
- (uint64_t)buffers { return _buffers; }
- (void)append:(CMSampleBufferRef)sample {
  // Serial capture queue owns converter; a bounded FIFO bridges to the ADM's
  // single audio thread. No sample buffers are retained across callbacks.
  CMAudioFormatDescriptionRef desc=CMSampleBufferGetFormatDescription(sample);
  if(!desc) return;
  AVAudioFormat *format=[[AVAudioFormat alloc] initWithCMAudioFormatDescription:desc];
  if(!format) return;
  AVAudioFrameCount frames=(AVAudioFrameCount)CMSampleBufferGetNumSamples(sample);
  if(frames==0 || frames>48000) return;
  AVAudioPCMBuffer *input=[[AVAudioPCMBuffer alloc] initWithPCMFormat:format frameCapacity:frames];input.frameLength=frames;
  OSStatus result=CMSampleBufferCopyPCMDataIntoAudioBufferList(sample,0,(int32_t)frames,input.mutableAudioBufferList);
  if(result!=noErr) return;
  AVAudioFormat *output=[[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatInt16 sampleRate:48000 channels:2 interleaved:YES];
  if(![_inputFormat isEqual:format]) { _inputFormat=format;_converter=[[AVAudioConverter alloc] initFromFormat:format toFormat:output]; }
  AVAudioFrameCount capacity=(AVAudioFrameCount)ceil(frames*48000/format.sampleRate)+32;
  AVAudioPCMBuffer *converted=[[AVAudioPCMBuffer alloc] initWithPCMFormat:output frameCapacity:capacity];
  __block BOOL supplied=NO;NSError *error=nil;
  [_converter convertToBuffer:converted error:&error withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount count, AVAudioConverterInputStatus *status){
    if(supplied){*status=AVAudioConverterInputStatus_NoDataNow;return nil;}supplied=YES;*status=AVAudioConverterInputStatus_HaveData;return input;
  }];
  if(error || !converted.frameLength) return;
  const int16_t *data=(const int16_t *)converted.audioBufferList->mBuffers[0].mData;
  os_unfair_lock_lock(&_lock);
  size_t count=converted.frameLength*2;
  if(_pcm.size()+count>48000/5*2) _pcm.clear(); // cap queued audio to 200ms
  _pcm.insert(_pcm.end(),data,data+count);_buffers++;
  os_unfair_lock_unlock(&_lock);
}
@end

@interface CGScreenPublisher () <LKRTCPeerConnectionDelegate, NSURLSessionTaskDelegate>
@end
@implementation CGScreenPublisher {
  LKRTCPeerConnectionFactory *_factory;
  LKRTCPeerConnection *_pc;
  LKRTCVideoSource *_video;
  LKRTCVideoCapturer *_capturer;
  CGPlaybackDevice *_audio;
  LKRTCVideoTrack *_videoTrack;
  LKRTCAudioTrack *_audioTrack;
  NSURLSession *_http;
  NSURLSessionDataTask *_request;
  NSURL *_endpoint,*_resource;
  NSString *_token;
  void (^_completion)(NSError *);
  BOOL _closed,_offerSent,_connected;
  std::atomic<uint64_t> _frames;
  NSInteger _fps,_width,_height,_bitrate,_outputWidth,_outputHeight;
}
- (NSDictionary *)diagnostics { return @{@"engine":@"native-webrtc",@"capturedFrames":@(_frames.load()),@"audioBuffers":@(_audio.buffers),@"connected":@(_connected),@"width":@(_width),@"height":@(_height),@"fps":@(_fps)}; }
- (NSError *)error:(NSString *)message { return [NSError errorWithDomain:@"CineGatherScreenShare" code:1 userInfo:@{NSLocalizedDescriptionKey:message}]; }
- (void)start:(NSDictionary *)options completion:(void (^)(NSError *))completion {
  _completion=[completion copy];_closed=NO;_frames=0;_connected=NO;
  _endpoint=[NSURL URLWithString:options[@"url"]];_token=options[@"token"];
  if(!_endpoint || _endpoint.user || _endpoint.password || (![_endpoint.scheme isEqual:@"https"] && !([_endpoint.scheme isEqual:@"http"] && [@[@"localhost",@"127.0.0.1",@"::1"] containsObject:_endpoint.host]))) { [self fail:@"推流服务必须使用 HTTPS 或本机地址"];return; }
  _fps=[options[@"fps"] integerValue];_width=[options[@"width"] integerValue];_height=[options[@"height"] integerValue];_bitrate=[options[@"bitrate"] integerValue];
  _audio=[CGPlaybackDevice new];
  _factory=[[LKRTCPeerConnectionFactory alloc] initWithEncoderFactory:[LKRTCDefaultVideoEncoderFactory new] decoderFactory:[LKRTCDefaultVideoDecoderFactory new] audioDevice:_audio];
  LKRTCConfiguration *config=[LKRTCConfiguration new];config.sdpSemantics=LKRTCSdpSemanticsUnifiedPlan;
  LKRTCMediaConstraints *constraints=[[LKRTCMediaConstraints alloc] initWithMandatoryConstraints:nil optionalConstraints:nil];
  _pc=[_factory peerConnectionWithConfiguration:config constraints:constraints delegate:self];
  _video=[_factory videoSourceForScreenCast:YES];[_video adaptOutputFormatToWidth:(int)_width height:(int)_height fps:(int)_fps];
  _capturer=[[LKRTCVideoCapturer alloc] initWithDelegate:_video];
  _videoTrack=[_factory videoTrackWithSource:_video trackId:@"screen-video"];
  LKRTCRtpTransceiverInit *send=[LKRTCRtpTransceiverInit new];send.direction=LKRTCRtpTransceiverDirectionSendOnly;send.streamIds=@[@"screen"];
  LKRTCRtpEncodingParameters *encoding=[LKRTCRtpEncodingParameters new];encoding.maxBitrateBps=@(_bitrate);encoding.maxFramerate=@(_fps);send.sendEncodings=@[encoding];
  [_pc addTransceiverWithTrack:_videoTrack init:send];
  if([options[@"audio"] boolValue]) {
    LKRTCMediaConstraints *ac=[[LKRTCMediaConstraints alloc] initWithMandatoryConstraints:nil optionalConstraints:@{@"googEchoCancellation":@"false",@"googAutoGainControl":@"false",@"googNoiseSuppression":@"false",@"googHighpassFilter":@"false"}];
    _audioTrack=[_factory audioTrackWithSource:[_factory audioSourceWithConstraints:ac] trackId:@"screen-audio"];
    [_audioTrack setAudioProcessingOptions:[LKRTCAudioProcessingOptions rawOptions]];
    LKRTCRtpTransceiverInit *asend=[LKRTCRtpTransceiverInit new];asend.direction=LKRTCRtpTransceiverDirectionSendOnly;asend.streamIds=@[@"screen"];
    [_pc addTransceiverWithTrack:_audioTrack init:asend];
  }
  NSURLSessionConfiguration *network=[NSURLSessionConfiguration ephemeralSessionConfiguration];network.timeoutIntervalForRequest=15;network.timeoutIntervalForResource=20;
  _http=[NSURLSession sessionWithConfiguration:network delegate:self delegateQueue:nil];
  __weak __typeof__(self) weak=self;
  [_pc offerForConstraints:constraints completionHandler:^(LKRTCSessionDescription *sdp,NSError *error){
    dispatch_async(dispatch_get_main_queue(),^{__typeof__(self) self=weak;if(!self || self->_closed)return;if(error){[self fail:@"无法生成共享连接"];return;}
      [self->_pc setLocalDescription:sdp completionHandler:^(NSError *error){dispatch_async(dispatch_get_main_queue(),^{if(error){[weak fail:@"无法初始化共享连接"];return;}dispatch_after(dispatch_time(DISPATCH_TIME_NOW,8*NSEC_PER_SEC),dispatch_get_main_queue(),^{[weak sendOffer];});});}];
    });
  }];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,40*NSEC_PER_SEC),dispatch_get_main_queue(),^{__typeof__(self) self=weak;if(self && !self->_closed && !self->_connected)[self fail:@"共享连接超时，请重试"];});
}
- (BOOL)sameOrigin:(NSURL *)a other:(NSURL *)b { return [a.scheme isEqual:b.scheme] && [a.host isEqual:b.host] && ((a.port==nil && b.port==nil)||[a.port isEqual:b.port]); }
- (void)sendOffer {
  if(_closed || _offerSent || !_pc.localDescription) return;_offerSent=YES;
  NSMutableURLRequest *r=[NSMutableURLRequest requestWithURL:_endpoint];r.HTTPMethod=@"POST";r.HTTPBody=[_pc.localDescription.sdp dataUsingEncoding:NSUTF8StringEncoding];
  [r setValue:@"application/sdp" forHTTPHeaderField:@"Content-Type"];[r setValue:[@"Bearer " stringByAppendingString:_token] forHTTPHeaderField:@"Authorization"];
  __weak __typeof__(self) weak=self;
  _request=[_http dataTaskWithRequest:r completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){dispatch_async(dispatch_get_main_queue(),^{
    __typeof__(self) self=weak;if(!self)return;
    NSHTTPURLResponse *http=(NSHTTPURLResponse *)response;
    if(error || http.statusCode!=201 || data.length>1024*1024){if(!self->_closed)[self fail:@"推流服务连接失败，请重试"];return;}
    NSString *location=[http valueForHTTPHeaderField:@"Location"];
    NSURL *resource=location ? [[NSURL URLWithString:location relativeToURL:self->_endpoint] absoluteURL] : nil;
    if(!resource || ![self sameOrigin:resource other:self->_endpoint]){[self fail:@"推流服务返回了无效的会话地址"];return;}
    self->_resource=resource;
    if(self->_closed){[self deleteResource];return;}
    NSString *sdp=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    [self->_pc setRemoteDescription:[[LKRTCSessionDescription alloc] initWithType:LKRTCSdpTypeAnswer sdp:sdp] completionHandler:^(NSError *error){if(error)dispatch_async(dispatch_get_main_queue(),^{[weak fail:@"共享连接协商失败"];});}];
  });}];[_request resume];
}
- (void)video:(CMSampleBufferRef)sample { [self video:sample rotation:0]; }
- (void)video:(CMSampleBufferRef)sample rotation:(NSInteger)rotation {
  @synchronized(self) {
  if(_closed || !_video || !CMSampleBufferDataIsReady(sample))return;
  CVPixelBufferRef pixels=CMSampleBufferGetImageBuffer(sample);if(!pixels)return;
  size_t w=CVPixelBufferGetWidth(pixels),h=CVPixelBufferGetHeight(pixels);
  double limitW=w<h ? _height : _width,limitH=w<h ? _width : _height;
  double scale=std::min(1.0,std::min(limitW/w,limitH/h));
  NSInteger targetW=MAX(2,(NSInteger)(w*scale)/2*2),targetH=MAX(2,(NSInteger)(h*scale)/2*2);
  if(targetW!=_outputWidth || targetH!=_outputHeight){_outputWidth=targetW;_outputHeight=targetH;[_video adaptOutputFormatToWidth:(int)targetW height:(int)targetH fps:(int)_fps];}
  _frames++;
  LKRTCCVPixelBuffer *buffer=[[LKRTCCVPixelBuffer alloc] initWithPixelBuffer:pixels];
  int64_t time=(int64_t)(CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample))*NSEC_PER_SEC);
  LKRTCVideoFrame *frame=[[LKRTCVideoFrame alloc] initWithBuffer:buffer rotation:(LKRTCVideoRotation)rotation timeStampNs:time];
  [_video capturer:_capturer didCaptureVideoFrame:frame];
  }
}
- (void)audio:(CMSampleBufferRef)sample { @synchronized(self) { if(!_closed && _audioTrack) [_audio append:sample]; } }
- (void)deleteResource {
  if(!_resource)return;NSMutableURLRequest *r=[NSMutableURLRequest requestWithURL:_resource];_resource=nil;r.HTTPMethod=@"DELETE";
  [r setValue:[@"Bearer " stringByAppendingString:_token] forHTTPHeaderField:@"Authorization"];
  [[_http dataTaskWithRequest:r completionHandler:^(NSData *d,NSURLResponse *s,NSError *e){}] resume];
}
- (void)fail:(NSString *)reason { if(_closed)return;void (^done)(NSError *)=_completion;_completion=nil;if(done)done([self error:reason]);if(self.status)self.status(@"failed",reason);[self stop]; }
- (void)stop {
  @synchronized(self) {
  if(_closed)return;_closed=YES;_connected=NO;
  [_request cancel];_request=nil;
  [_pc close];_pc=nil;_video=nil;_videoTrack=nil;_audioTrack=nil;_capturer=nil;_factory=nil;[_audio stopRecording];_audio=nil;
  [self deleteResource];[_http finishTasksAndInvalidate];_token=nil;
  if(_completion){_completion([self error:@"共享已取消"]);_completion=nil;}
  }
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler { completionHandler(nil); }
- (void)peerConnection:(LKRTCPeerConnection *)pc didChangeIceGatheringState:(LKRTCIceGatheringState)state { if(state==LKRTCIceGatheringStateComplete)dispatch_async(dispatch_get_main_queue(),^{[self sendOffer];}); }
- (void)peerConnection:(LKRTCPeerConnection *)pc didChangeIceConnectionState:(LKRTCIceConnectionState)state {
  dispatch_async(dispatch_get_main_queue(),^{if(self->_closed)return;
    if(state==LKRTCIceConnectionStateConnected || state==LKRTCIceConnectionStateCompleted){if(!self->_connected){self->_connected=YES;if(self->_completion){self->_completion(nil);self->_completion=nil;}if(self.status)self.status(@"active",@"");}}
    if(state==LKRTCIceConnectionStateFailed)[self fail:@"共享网络连接已中断"];});
}
- (void)peerConnection:(LKRTCPeerConnection *)pc didChangeSignalingState:(LKRTCSignalingState)state {}
- (void)peerConnection:(LKRTCPeerConnection *)pc didAddStream:(LKRTCMediaStream *)stream {}
- (void)peerConnection:(LKRTCPeerConnection *)pc didRemoveStream:(LKRTCMediaStream *)stream {}
- (void)peerConnectionShouldNegotiate:(LKRTCPeerConnection *)pc {}
- (void)peerConnection:(LKRTCPeerConnection *)pc didGenerateIceCandidate:(LKRTCIceCandidate *)candidate {}
- (void)peerConnection:(LKRTCPeerConnection *)pc didRemoveIceCandidates:(NSArray<LKRTCIceCandidate *> *)candidates {}
- (void)peerConnection:(LKRTCPeerConnection *)pc didOpenDataChannel:(LKRTCDataChannel *)channel {}
@end
