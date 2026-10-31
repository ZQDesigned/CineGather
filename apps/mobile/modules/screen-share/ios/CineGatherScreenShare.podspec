Pod::Spec.new do |s|
  s.name = 'CineGatherScreenShare'
  s.version = '0.1.0'
  s.summary = 'CineGather native screen and playback publisher'
  s.author = 'ZQDesigned'
  s.homepage = 'https://github.com/ZQDesigned/CineGather'
  s.license = { :type => 'MIT' }
  s.source = { :git => 'https://github.com/ZQDesigned/CineGather.git' }
  s.platforms = { :ios => '16.4' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.dependency 'LiveKitWebRTC'
  s.source_files = '*.{swift,h,m,mm}', 'Shared/*.{h,m,mm}'
  s.public_header_files = 'Shared/CGScreenPublisher.h'
  s.frameworks = 'ReplayKit', 'AVFoundation', 'CoreMedia'
  s.user_target_xcconfig = { 'OTHER_LDFLAGS[sdk=iphoneos*]' => '$(inherited) -weak_framework ScreenCaptureKit' }
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20', 'OTHER_LDFLAGS[sdk=iphoneos*]' => '$(inherited) -weak_framework ScreenCaptureKit' }
end
