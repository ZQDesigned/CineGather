// SPDX-License-Identifier: MIT
#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#include <cmath>
#include <atomic>
#include <poll.h>
#include <unistd.h>
int main(int argc,const char **argv) {
  @autoreleasepool {
    if(argc!=2)return 2;
    const double frequency=atof(argv[1]);__block double phase=0;
    [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    NSWindow *window=[[NSWindow alloc]initWithContentRect:NSMakeRect(40,40,300,90) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    window.title=[NSString stringWithFormat:@"CG Controlled Audio %.0f Hz",frequency];
    [window makeKeyAndOrderFront:nil];
    AVAudioEngine *engine=[AVAudioEngine new];
    AVAudioFormat *format=[[AVAudioFormat alloc]initStandardFormatWithSampleRate:48000 channels:2];
    AVAudioSourceNode *source=[[AVAudioSourceNode alloc]initWithFormat:format renderBlock:^OSStatus(BOOL *silence,const AudioTimeStamp *stamp,AVAudioFrameCount frames,AudioBufferList *data){
      for(UInt32 i=0;i<frames;i++) {float sample=.12f*sin(phase);phase+=2*M_PI*frequency/48000;
        for(UInt32 b=0;b<data->mNumberBuffers;b++) ((float*)data->mBuffers[b].mData)[i]=sample;}
      return noErr;
    }];
    [engine attachNode:source];[engine connect:source to:engine.mainMixerNode format:format];
    NSError *error=nil;if(![engine startAndReturnError:&error])return 2;
    fprintf(stderr,"READY\n");fflush(stderr);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0),^{
      pollfd fd{STDIN_FILENO,POLLIN,0};poll(&fd,1,-1);
      dispatch_async(dispatch_get_main_queue(),^{[engine stop];[NSApp terminate:nil];});
    });
    [NSApp run];return 0;
  }
}
