Pod::Spec.new do |s|
  s.name = 'ReaderRuntime'
  s.version = '0.1.0'
  s.summary = 'Offline web assets and EPUB import for Reader'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Reader'
  s.homepage = 'https://reader.zsheng.app'
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'ReaderWeb' => ['Resources/web'] }
  s.frameworks = 'Network'
  s.swift_version = '5.9'
end
