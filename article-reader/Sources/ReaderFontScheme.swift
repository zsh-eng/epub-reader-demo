import Foundation
import WebKit

/// Only bundled fonts can be addressed. A URL never becomes a filesystem path.
enum ReaderFontAsset: String, CaseIterable {
  case dmSans = "DMSans"
  case garamond = "EBGaramond"

  var family: String { self == .dmSans ? "DM Sans" : "EB Garamond" }
  var url: URL { URL(string: "arctic-font://bundle/\(rawValue).ttf")! }

  init?(request: URLRequest) {
    guard let url = request.url, url.scheme == "arctic-font", url.host == "bundle",
      url.user == nil, url.password == nil, url.port == nil,
      url.query == nil, url.fragment == nil, (request.httpMethod ?? "GET") == "GET",
      let asset = Self.allCases.first(where: { url.path == "/" + $0.rawValue + ".ttf" })
    else { return nil }
    self = asset
  }

  var css: String {
    "@font-face { font-family: '\(family)'; font-style: normal; font-weight: 100 900; font-display: swap; src: url('\(url.absoluteString)') format('truetype'); }"
  }
}

/// There are exactly two assets, shared across all warm Reader documents.
private actor ReaderFontBytes {
  static let shared = ReaderFontBytes()
  private var cached: [ReaderFontAsset: Data] = [:]

  func data(for asset: ReaderFontAsset) throws -> Data {
    if let data = cached[asset] { return data }
    guard
      let file = Bundle.main.url(
        forResource: asset.rawValue, withExtension: "ttf", subdirectory: "Fonts")
    else { throw URLError(.fileDoesNotExist) }
    let data = try Data(contentsOf: file)
    cached[asset] = data
    return data
  }
}

/// Fonts stay local, including when the HTML has an opaque origin. Cancellation
/// removes the request before returning, so WebKit never receives a late reply.
@MainActor final class ReaderFontScheme: NSObject, WKURLSchemeHandler {
  private var requests: [ObjectIdentifier: Task<Void, Never>] = [:]

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let asset = ReaderFontAsset(request: urlSchemeTask.request) else {
      urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
      return
    }
    let id = ObjectIdentifier(urlSchemeTask)
    requests[id] = Task { [weak self] in
      do {
        let data = try await ReaderFontBytes.shared.data(for: asset)
        guard let self, !Task.isCancelled, self.requests.removeValue(forKey: id) != nil else {
          return
        }
        let response = HTTPURLResponse(
          url: asset.url, statusCode: 200, httpVersion: "HTTP/1.1",
          headerFields: [
            "Content-Type": "font/ttf", "Content-Length": String(data.count),
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "public, max-age=31536000, immutable",
          ])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
      } catch {
        guard let self, !Task.isCancelled, self.requests.removeValue(forKey: id) != nil else {
          return
        }
        urlSchemeTask.didFailWithError(error)
      }
    }
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
    requests.removeValue(forKey: ObjectIdentifier(urlSchemeTask))?.cancel()
  }
}
