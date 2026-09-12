import UIKit

/// Presentation snapshots contain no database handles or EPUB bytes. The web
/// domain remains the sole writer; sequence acknowledgements protect native input.
struct ReaderNativeState: Decodable {
  let session, bookId, title, author, chapter, startLabel, error, readingStatus: String
  let acknowledged, openRequest, page, totalPages: Int
  let chromeVisible, canGoNext, canGoPrevious, paginationReady, startPending, statusPending: Bool
  let settings: ReaderNativeSettings
  let colors: ReaderNativeColors
  let draft: ReaderNativeDraft
  let notes: [ReaderNativeNote]
  let contents: [ReaderNativeChapter]
  let themes: [ReaderNativeTheme]
}

struct ReaderNativeTheme: Decodable {
  let id, title: String
  let colors: ReaderNativeColors
}

struct ReaderNativeDraft: Decodable {
  let content, quote, editingId: String
  let ready, saving: Bool
}

struct ReaderNativeNote: Decodable, Equatable {
  let id, text, kind, quote, chapter: String
  let page, chapterIndex, offset: Int
  let createdAt: Double
}

struct ReaderNativeChapter: Decodable {
  let id, title, href: String
  let depth, page: Int
}

struct ReaderNativeSettings: Decodable {
  let theme, fontFamily, textAlign: String
  let fontSize, lineHeight: Double
  let publisherBookStylingEnabled, matchPublisherBodyTextSize: Bool
  let pageAnimationsEnabled, showPageNumbers: Bool
}

struct ReaderNativeColors: Decodable {
  let background, foreground, secondary, muted, primary, border: String
  let dark: Bool
  var canvas: UIColor { UIColor(readerHex: background) }
  var ink: UIColor { UIColor(readerHex: foreground) }
  var soft: UIColor { UIColor(readerHex: secondary) }
  var detail: UIColor { UIColor(readerHex: muted) }
  var accent: UIColor { UIColor(readerHex: primary) }
}

extension UIColor {
  convenience init(readerHex: String) {
    let value = UInt32(readerHex.dropFirst(), radix: 16) ?? 0
    self.init(red: CGFloat((value >> 16) & 255) / 255,
              green: CGFloat((value >> 8) & 255) / 255,
              blue: CGFloat(value & 255) / 255, alpha: 1)
  }
}

typealias ReaderNativeCommand = ([String: Any]) -> Int
