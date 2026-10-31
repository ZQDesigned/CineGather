#import <Foundation/Foundation.h>
#import <CoreMedia/CoreMedia.h>
NS_ASSUME_NONNULL_BEGIN
@interface CGScreenPublisher : NSObject
@property(nonatomic, copy, nullable) void (^status)(NSString *state, NSString *reason);
@property(nonatomic, readonly) NSDictionary *diagnostics;
- (void)start:(NSDictionary *)options completion:(void (^)(NSError *_Nullable))completion;
- (void)video:(CMSampleBufferRef)sample;
- (void)video:(CMSampleBufferRef)sample rotation:(NSInteger)rotation;
- (void)audio:(CMSampleBufferRef)sample;
- (void)stop;
@end
NS_ASSUME_NONNULL_END
