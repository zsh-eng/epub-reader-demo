import Foundation

@main struct ReaderFontChecks {
  static func main() throws {
    for asset in ReaderFontAsset.allCases {
      precondition(ReaderFontAsset(request: URLRequest(url: asset.url)) == asset)
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
    print(
      "Font allowlist: valid fonts, unsupported schemes, hosts, paths, traversal, query, credentials, ports, fragments and methods passed."
    )
  }
}
