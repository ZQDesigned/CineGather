Pod::Spec.new do |s|
  s.name = 'CineGatherRoomAudio'
  s.version = '0.1.0'
  s.summary = 'CineGather room audio lifecycle'
  s.description = 'Background room audio and interruption lifecycle for CineGather.'
  s.author = 'ZQDesigned'
  s.homepage = 'https://github.com/ZQDesigned/CineGather'
  s.license = { :type => 'MIT' }
  s.source = { :git => 'https://github.com/ZQDesigned/CineGather.git' }
  s.platforms = { :ios => '16.4' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
