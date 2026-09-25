import Foundation

/// Defuddle's public X source. Only explicit X post/article paths are eligible;
/// no profile, private cookie, app key, or arbitrary API endpoint is forwarded.
enum XArticlePayload {
  static func endpoint(for url: URL) -> URL? {
    guard ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
      [
        "x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com",
        "mobile.twitter.com",
      ]
      .contains(url.host?.lowercased() ?? "")
    else { return nil }
    let parts = url.pathComponents.filter { $0 != "/" }
    guard parts.count >= 3, ["status", "article"].contains(parts[1]),
      parts[0].range(of: "^[a-zA-Z0-9_]{1,15}$", options: .regularExpression) != nil,
      parts[2].range(of: "^[0-9]{1,25}$", options: .regularExpression) != nil
    else { return nil }
    return URL(string: "https://api.fxtwitter.com/\(parts[0])/status/\(parts[2])")
  }

  private static let session: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 12
    configuration.timeoutIntervalForResource = 15
    return URLSession(configuration: configuration)
  }()

  static func fetch(_ endpoint: URL) async throws -> String {
    let (bytes, response) = try await session.bytes(from: endpoint)
    defer { bytes.task.cancel() }
    guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
      throw URLError(.badServerResponse)
    }
    var data = Data()
    for try await byte in bytes {
      guard data.count < 2 * 1024 * 1024 else { throw URLError(.dataLengthExceedsMaximum) }
      data.append(byte)
    }
    try Task.checkCancellation()
    return String(decoding: data, as: UTF8.self)
  }
}
