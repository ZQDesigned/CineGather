// SPDX-License-Identifier: MIT
#import <AppKit/AppKit.h>
#include <poll.h>
#include <unistd.h>
int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    NSMutableArray *windows = [NSMutableArray new];
    for (int i=0; i<2; ++i) {
      NSWindow *w = [[NSWindow alloc] initWithContentRect:NSMakeRect(60+i*100,120+i*100,640,360) styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
      w.title = i ? @"CG Switch Blue" : @"CG Switch Red";
      w.backgroundColor = i ? [NSColor colorWithRed:0.03 green:0.08 blue:0.95 alpha:1] : [NSColor colorWithRed:0.95 green:0.04 blue:0.03 alpha:1];
      [w orderFrontRegardless]; [windows addObject:w];
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT,0), ^{
      pollfd fd{STDIN_FILENO,POLLIN,0}; poll(&fd,1,-1);
      dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
    });
    [NSApp run];
  }
}
