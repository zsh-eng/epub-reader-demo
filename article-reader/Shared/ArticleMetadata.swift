import Foundation
import SwiftSoup

/// Card metadata and a small, plain-text context for classification. The excerpt
/// is a paragraph heuristic, not a replacement for the Reader's full extraction.
struct ArticleMetadata: Sendable {
  let title: String
  let description: String
  let taggingText: String
  let imageURL: URL?
  let faviconURL: URL?

  static func fetch(_ url: URL) async throws -> Self {
    var request = URLRequest(url: url, timeoutInterval: 8)
    request.setValue(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      forHTTPHeaderField: "User-Agent")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 8
    configuration.timeoutIntervalForResource = 8
    let session = URLSession(configuration: configuration)
    defer { session.invalidateAndCancel() }
    let (data, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse,
      (200..<300).contains(response.statusCode),
      let html = String(data: data, encoding: .utf8)
    else { throw URLError(.cannotDecodeContentData) }
    try Task.checkCancellation()
    return try parse(html, baseURL: response.url ?? url)
  }

  static func parse(_ html: String, baseURL: URL) throws -> Self {
    let document = try SwiftSoup.parse(html)
    func meta(_ names: [String]) throws -> String {
      for name in names {
        let value = clean(
          try document.select("meta[property='\(name)'], meta[name='\(name)']")
            .first()?.attr("content") ?? "")
        if !value.isEmpty { return value }
      }
      return ""
    }
    func resourceURL(_ value: String) -> URL? {
      guard !value.isEmpty,
        let url = URL(string: value, relativeTo: baseURL)?.absoluteURL,
        ["https", "http", "file"].contains(url.scheme ?? "")
      else { return nil }
      return url
    }
    let headline = try meta(["og:title", "twitter:title"])
    let fallbackTitle = clean(try document.title())
    let title =
      headline.isEmpty
      ? (fallbackTitle.isEmpty ? (baseURL.host ?? baseURL.absoluteString) : fallbackTitle)
      : headline
    let description = try meta(["og:description", "description", "twitter:description"])
    let imageURL = resourceURL(try meta(["og:image", "twitter:image"]))
    let iconElement = try document.select("link[rel][href]").first { element in
      let roles = try element.attr("rel").lowercased().split(whereSeparator: \.isWhitespace)
      return roles.contains("icon") || roles.contains("apple-touch-icon")
    }
    let faviconURL = resourceURL(try iconElement?.attr("href") ?? "")
    let normalizedTitle = normalized(title)
    let normalizedDescription = normalized(description)
    let repeatsTitle =
      !normalizedTitle.isEmpty
      && (normalizedDescription == normalizedTitle
        || (normalizedDescription.hasPrefix(normalizedTitle)
          && normalizedDescription.count < normalizedTitle.count + 50))
    var context = description
    if description.count < 100 || repeatsTitle {
      // Read content paragraphs only after removing common navigation and hidden
      // elements. A metadata-only page still keeps its available description.
      try document.select(
        "script, style, noscript, template, nav, header, footer, aside, form, [hidden], [aria-hidden=true], [role=navigation], [role=banner], [role=contentinfo]"
      ).remove()
      var paragraphs = try document.select("article p, main p, [role=main] p")
      if paragraphs.isEmpty() { paragraphs = try document.select("body p") }
      var chunks: [String] = description.isEmpty || repeatsTitle ? [] : [description]
      var seen = Set(chunks.map(normalized))
      var length = chunks.joined(separator: "\n\n").count
      for paragraph in paragraphs {
        let text = clean(try paragraph.text())
        let key = normalized(text)
        guard text.count >= 40, key != normalizedTitle, seen.insert(key).inserted else { continue }
        chunks.append(String(text.prefix(2500 - length)))
        length += text.count + 2
        if length >= 2500 { break }
      }
      if !chunks.isEmpty { context = chunks.joined(separator: "\n\n") }
    }
    return Self(
      title: title, description: description, taggingText: String(context.prefix(2500)),
      imageURL: imageURL, faviconURL: faviconURL)
  }

  private static func clean(_ text: String) -> String {
    text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
  }

  private static func normalized(_ text: String) -> String {
    text.lowercased().filter { $0.isLetter || $0.isNumber }
  }
}
