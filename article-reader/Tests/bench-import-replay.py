#!/usr/bin/env python3
"""Loopback-only metadata replay using exact ArticleStore methods and real JSON writes.
Usage: python3 Tests/bench-import-replay.py /path/to/SwiftSoup --baseline /tmp/ArticleStore.swift
The server replays Resources/Fixtures/story.html and serves its bundled cover.
Only metadata is requested by the benchmark; image decode/rendering is separate.
The harness extracts production queue/commit/cache methods unchanged apart from
measurement counters. It stubs tagging and stores 10,000 synthetic records in a
temporary directory. Publisher/user data is never accessed. Timings are host elapsed-time
measurements, not iPhone frame rates. Baseline can be exported with:
  git show d1aab68:article-reader/Sources/ArticleStore.swift > /tmp/arctic-baseline.swift
"""
import argparse, http.server, json, pathlib, subprocess, tempfile, threading, time
p=argparse.ArgumentParser();p.add_argument('swiftsoup');p.add_argument('--baseline',type=pathlib.Path);p.add_argument('--count',type=int,default=180);args=p.parse_args()
root=pathlib.Path(__file__).resolve().parents[1]
photo=(root/'Resources/Fixtures/cover.png').read_bytes()
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path.endswith('cover.png'):
   payload=photo;kind='image/png'
  else:
   # Two loopback hosts replay independent publishers with identical latency.
   time.sleep(.09+(int(self.path.split('/')[-1])%5)*.01)
   payload=(root/'Resources/Fixtures/story.html').read_bytes();kind='text/html; charset=utf-8'
  self.send_response(200);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
 def log_message(self,*_): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()

def target(source,mode):
 models=source[source.index('struct SavedArticle:'):source.index('/// Metadata is committed')]
 fields=source[source.index('  private(set) var articles:'):source.index('  var isImportWorking:')].replace('@ObservationIgnored ','')
 methods=source[source.index('  func prioritizePreviews('):source.index('  func refreshPreview(')]
 persist=source[source.index('  private func commit('):source.index('\n}\n\nenum ReadingListImport')]
 # Add timing counters around real production publication and serialization.
 persist=persist.replace('''    if !deferred {''','''    let publicationStart = ContinuousClock.now
    if !deferred {''',1)
 persist=persist.replace('''    libraryRevision += 1''','''    libraryRevision += 1
    publicationMilliseconds.append(milliseconds(publicationStart.duration(to: .now)))''',1)
 persist=persist.replace('''JSONEncoder().encode(updated).write(to: fileURL, options: .atomic)''','''writeSnapshot(updated)''')
 persist=persist.replace('''JSONEncoder().encode(articles).write(to: fileURL, options: .atomic)''','''writeSnapshot(articles)''')
 preview=source[source.index('actor ArticlePreviewCache {'):source.index('\nenum TestMode {')]
 error=source[source.index('enum ArticleError:'):source.index('actor ArticlePreviewCache {')]
 derived=''
 if 'func updateLibraryDerivedValues()' in source:
  derived=source[source.index('  var allTags:'):source.index('  /// Unsave')]
 else:
  derived=source[source.index('  var allTags:'):source.index('  /// Unsave')]+'''\n var savedArticleIDs: [UUID] { articles.filter(\\.saved).map(\\.id) }\n'''
 pause='setLibraryScrolling(true)' if 'func setLibraryScrolling' in methods else ''
 unpause='setLibraryScrolling(false)' if pause else ''
 return '''import Foundation
import SwiftSoup
func milliseconds(_ value: Duration) -> Double { Double(value.components.seconds)*1000 + Double(value.components.attoseconds)/1e15 }
'''+models+error+preview+'''
enum TestMode { static func fixture(for url: URL) -> URL? { nil } }
@MainActor final class ReplayStore {
'''+fields+'''
 let fileURL: URL
 var publicationMilliseconds: [Double] = []
 var writes = 0
 var writeMilliseconds: [Double] = []
 init(directory: URL, count: Int, port: Int) {
  fileURL = directory.appending(path: "replay.json")
  articles = (0..<10000).map { index in
   let host = index % 2 == 0 ? "localhost" : "127.0.0.1"
   var row = SavedArticle(url: URL(string: "http://\\(host):\\(port)/article/\\(index)")!, title: "Import \\(index)")
   row.savedAt = Date(timeIntervalSince1970: Double(1700000000+index))
   if index >= count { row.taggingText = "already prepared" }
   row.tags = ["Reading", "Ideas"]
   return row
  }
 }
 func writeSnapshot(_ rows: [SavedArticle]) throws {
  let start = ContinuousClock.now
  try JSONEncoder().encode(rows).write(to: fileURL, options: .atomic)
  writes += 1
  writeMilliseconds.append(milliseconds(start.duration(to: .now)))
 }
 func downloadFile(_ id: UUID) -> URL { fileURL.deletingLastPathComponent().appending(path:id.uuidString) }
 func scheduleTagging() {}
'''+derived+methods+persist+'''
 func run(count: Int, scrolling: Bool) async throws {
  let originalDates = articles.map(\\.savedAt)
  let start = ContinuousClock.now
  '''+pause+''' 
  if !scrolling { '''+unpause+''' }
  prioritizePreviews(Array(articles.prefix(count).map(\\.url)))
  // The first ten are the viewport; later rows are background import work.
  prioritizePreviews(Array(articles.prefix(10).map(\\.url)))
  if scrolling {
   try await Task.sleep(for: .milliseconds(1500))
   print("scroll-window publications=\\(libraryRevision) buffered=\\(pendingPreviews.count) inFlight=\\(previewWorkers.count)")
   '''+('precondition(libraryRevision == 0, "Metadata published during scrolling")\n   precondition(pendingPreviews.count + previewWorkers.count <= 48)' if pause else '')+'''
   '''+unpause+'''
  }
  while !previewQueue.isEmpty || !previewWorkers.isEmpty || !pendingPreviews.isEmpty {
   try await Task.sleep(for: .milliseconds(20))
  }
  flushPendingWrites()
  let elapsed = milliseconds(start.duration(to: .now))
  precondition(articles.prefix(count).allSatisfy { $0.taggingText != nil && $0.imageURL != nil && !$0.previewFailed })
  let restored = try JSONDecoder().decode([SavedArticle].self, from: Data(contentsOf:fileURL))
  precondition(restored.map(\\.savedAt) == originalDates)
  precondition(restored.prefix(count).allSatisfy { $0.imageURL != nil })
  let derivedStart = ContinuousClock.now
  var consumed = 0
  for _ in 0..<1000 { consumed += allTags.count + savedArticleIDs.count }
  precondition(consumed > 0)
  print("RESULT "+"'''+mode+'''"+" scroll=\\(scrolling) count=\\(count) total_ms=\\(Int(elapsed)) publications=\\(libraryRevision) disk_writes=\\(writes) publication_total_ms=\\(Int(publicationMilliseconds.reduce(0,+))) write_total_ms=\\(Int(writeMilliseconds.reduce(0,+))) derived_1000_ms=\\(Int(milliseconds(derivedStart.duration(to:.now))))")
 }
}
@main struct Main {
 @MainActor static func main() async throws {
  let directory = URL(fileURLWithPath:CommandLine.arguments[1])
  let count = Int(CommandLine.arguments[2])!, port = Int(CommandLine.arguments[3])!
  let store = ReplayStore(directory:directory,count:count,port:port)
  try await store.run(count:count,scrolling:CommandLine.arguments[4] == "scroll")
 }
}
'''
try:
 with tempfile.TemporaryDirectory(prefix='arctic-replay-') as d:
  package=pathlib.Path(d);dest=package/'Sources/Replay';dest.mkdir(parents=True)
  dep=json.dumps(str(pathlib.Path(args.swiftsoup).resolve()))
  (package/'Package.swift').write_text('// swift-tools-version: 6.0\nimport PackageDescription\nlet package = Package(name:"Replay",platforms:[.macOS(.v14)],dependencies:[.package(path:'+dep+')],targets:[.executableTarget(name:"Replay",dependencies:["SwiftSoup"],swiftSettings:[.swiftLanguageMode(.v5)])])')
  (dest/'ArticleMetadata.swift').write_text((root/'Shared/ArticleMetadata.swift').read_text())
  for mode,path in [('baseline',args.baseline),('current',root/'Sources/ArticleStore.swift')]:
   if path is None: continue
   (dest/'Replay.swift').write_text(target(path.read_text(),mode))
   subprocess.run(['swift','build','--package-path',d,'-c','release'],check=True)
   for phase in ['idle','scroll']:
    subprocess.run([str(package/'.build/release/Replay'),d,str(args.count),str(server.server_port),phase],check=True)

finally: server.shutdown()
