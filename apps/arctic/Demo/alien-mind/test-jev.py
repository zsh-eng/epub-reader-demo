"""Compile the captured Arctic parser/client; save every request and response without headers.
Run with JEV_API_KEY supplied by the existing shell/Keychain environment.
Only full-context diagnostic bypasses the client's character limit, explicitly.
"""
import pathlib,subprocess,json,os
ROOT=pathlib.Path(__file__).resolve().parent
build=ROOT/'build'; (build/'Sources/Probe').mkdir(parents=True,exist_ok=True)
dep=pathlib.Path.home()/'Library/Developer/Xcode/DerivedData/ArticleReader-ffbjruhntarrjihiwucogzvxcayl/SourcePackages/checkouts/SwiftSoup'
(build/'Package.swift').write_text('// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name:"Probe",platforms:[.macOS(.v14)],dependencies:[.package(path:'+json.dumps(str(dep))+')],targets:[.executableTarget(name:"Probe",dependencies:["SwiftSoup"],swiftSettings:[.swiftLanguageMode(.v5)])])')
s=(ROOT/'reference/ArticleTagging.swift').read_text()
s=s[:s.index('enum TaggingPreferences')]+s[s.index('enum JevError'):]
s=s.replace('String(description.prefix(2500)),\n      ],','String(description.prefix(ProcessInfo.processInfo.environment["FULL_CONTEXT"] == "1" ? 100000 : 2500)),\n      ],')
s=s.replace('let (data, response) = try await session.data(for: request)', '''try body?.write(to: URL(fileURLWithPath: ProcessInfo.processInfo.environment["RESULT_PREFIX"]! + "-request.json"))
    let (data, response) = try await session.data(for: request)
    try data.write(to: URL(fileURLWithPath: ProcessInfo.processInfo.environment["RESULT_PREFIX"]! + "-response.json"))''')
(build/'Sources/Probe/Tagging.swift').write_text(s)
(build/'Sources/Probe/Metadata.swift').write_text((ROOT/'reference/ArticleMetadata.swift').read_text())
(build/'Sources/Probe/Main.swift').write_text('''import Foundation
@main struct Main {
 static func main() async throws {
 let env = ProcessInfo.processInfo.environment
 let root = URL(fileURLWithPath: env["DEMO_ROOT"]!)
 let source = try JSONSerialization.jsonObject(with: Data(contentsOf: root.appendingPathComponent("article-source.json"))) as! [String:Any]
 let metadata = try ArticleMetadata.parse(source["html"] as! String, baseURL: URL(string:"https://openai.com/index/an-alien-mind/")!)
 let mode = env["PROBE_MODE"]!
 var context = metadata.taggingText
 if mode == "metadata" { context = metadata.description }
 if mode == "full" { context = metadata.description + "\\n\\nArticle text: " + (source["paragraphs"] as! [String]).filter { $0.count >= 40 }.joined(separator:"\\n\\n") }
 let started = Date()
 let tags = try await JevClient.classify(title:metadata.title,description:context,apiKey:env["JEV_API_KEY"]!)
 let result: [String:Any] = ["mode":mode,"title":metadata.title,"description":metadata.description,"imageURL":metadata.imageURL?.absoluteString ?? "","context":context,"durationSeconds":Date().timeIntervalSince(started),"selected":tags,"threshold":JevClient.threshold,"model":JevClient.model,"catalog":ArticleTagCatalog.all.map { ["id":$0.id,"name":$0.name,"classificationName":ArticleTagCatalog.classificationName(for:$0),"detail":$0.detail] }]
 try JSONSerialization.data(withJSONObject:result,options:[.prettyPrinted,.sortedKeys]).write(to:URL(fileURLWithPath:env["RESULT_PREFIX"]! + "-result.json"))
 print(mode + ": " + tags.joined(separator:", "))
 }
}''')
subprocess.run(['swift','build','-c','release','--package-path',str(build)],check=True)
if not os.environ.get('JEV_API_KEY'): raise SystemExit('JEV_API_KEY not set; use the configured shell environment.')
for mode in ['production','metadata','full']:
 prefix=ROOT/mode
 if pathlib.Path(str(prefix)+'-result.json').exists():
  print(mode+': saved result exists; no repeat call'); continue
 env=dict(os.environ,DEMO_ROOT=str(ROOT),PROBE_MODE=mode,RESULT_PREFIX=str(prefix),FULL_CONTEXT='1' if mode=='full' else '0')
 subprocess.run([str(build/'.build/release/Probe')],env=env,check=True)
