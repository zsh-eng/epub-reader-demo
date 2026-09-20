import Foundation

@main struct ReaderFontChecks {
  static func main() throws {
    for asset in ReaderFontAsset.allCases {
      precondition(ReaderFontAsset(request: URLRequest(url: asset.url)) == asset)
      precondition(asset.css.contains(asset.url.absoluteString))
      precondition(!asset.css.contains("base64"))
    }
    for value in [
      "file:///etc/passwd", "https://bundle/DMSans.ttf", "arctic-font://other/DMSans.ttf",
      "arctic-font://bundle/Other.ttf", "arctic-font://bundle/Fonts/DMSans.ttf",
      "arctic-font://bundle/../Info.plist", "arctic-font://bundle/%2e%2e%2fInfo.plist",
      "arctic-font://bundle/DMSans.ttf?path=/etc/passwd", "arctic-font://user@bundle/DMSans.ttf",
      "arctic-font://bundle:999/DMSans.ttf", "arctic-font://bundle/DMSans.ttf#fragment",
    ] {
      precondition(ReaderFontAsset(request: URLRequest(url: URL(string: value)!)) == nil, value)
    }
    var request = URLRequest(url: ReaderFontAsset.dmSans.url)
    request.httpMethod = "POST"
    precondition(ReaderFontAsset(request: request) == nil)
    let root = URL(filePath: CommandLine.arguments[1])
    let oldCSS = try ReaderFontAsset.allCases.map { asset in
      let bytes = try Data(contentsOf: root.appending(path: asset.rawValue + ".ttf"))
      return
        "@font-face { font-family: '\(asset.family)'; font-style: normal; font-weight: 100 900; src: url(data:font/ttf;base64,\(bytes.base64EncodedString())) format('truetype'); }"
    }.joined(separator: "\n")
    let newCSS = ReaderFontAsset.allCases.map(\.css).joined(separator: "\n")
    print(
      "Font CSS: \(oldCSS.utf8.count) bytes -> \(newCSS.utf8.count) bytes; \(oldCSS.utf8.count - newCSS.utf8.count) fewer bytes per new article."
    )
    print(
      "Font allowlist: valid fonts, unsupported schemes, hosts, paths, traversal, query, credentials, ports, fragments and methods passed."
    )
  }
}
