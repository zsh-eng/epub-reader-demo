import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// ImageIO downsamples directly from compressed bytes: never decode a full-size
/// publisher photograph just to draw a small card. Re-encoding also drops metadata.
enum PreviewImageCodec {
  static func thumbnail(_ data: Data, pixels: Int) -> CGImage? {
    guard
      let source = CGImageSourceCreateWithData(
        data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
    else { return nil }
    return CGImageSourceCreateThumbnailAtIndex(
      source, 0,
      [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceThumbnailMaxPixelSize: pixels,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceShouldCacheImmediately: true,
      ] as CFDictionary)
  }

  static func compact(_ data: Data) -> Data? {
    guard let image = thumbnail(data, pixels: 1200) else { return nil }
    if hasAlpha(data) { return encode(image, type: UTType.png.identifier, quality: 1) }
    guard let jpeg = encode(image, type: UTType.jpeg.identifier, quality: 0.8) else { return nil }
    // Native HEIC encoding is optional. Keep the smaller successful result;
    // JPEG remains a fast, portable fallback on devices without this encoder.
    if encoders.contains(UTType.heic.identifier),
      let heic = encode(image, type: UTType.heic.identifier, quality: 0.7),
      heic.count < jpeg.count
    {
      return heic
    }
    return jpeg
  }

  /// Display derivatives favour fast native decoding. Encoding HEIC again for
  /// every small size adds CPU work; the compact master already saves storage.
  static func displayThumbnail(_ data: Data, pixels: Int) -> Data? {
    guard let image = thumbnail(data, pixels: pixels) else { return nil }
    return encode(
      image, type: hasAlpha(data) ? UTType.png.identifier : UTType.jpeg.identifier,
      quality: 0.8)
  }

  static func placeholder(_ data: Data) -> Data? {
    guard let image = thumbnail(data, pixels: 24) else { return nil }
    return encode(
      image, type: hasAlpha(data) ? UTType.png.identifier : UTType.jpeg.identifier,
      quality: 0.4)
  }

  /// Cached HEIC is for native images. Saved Reader HTML uses universally
  /// supported JPEG/PNG so offline WebKit rendering does not depend on HEIC.
  static func webDataURL(_ data: Data) -> String {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let type = CGImageSourceGetType(source) as String?
    else { return "" }
    if type == UTType.png.identifier {
      return "data:image/png;base64," + data.base64EncodedString()
    }
    if type == UTType.jpeg.identifier {
      return "data:image/jpeg;base64," + data.base64EncodedString()
    }
    guard let image = thumbnail(data, pixels: 1200),
      let jpeg = encode(image, type: UTType.jpeg.identifier, quality: 0.8)
    else { return "" }
    return "data:image/jpeg;base64," + jpeg.base64EncodedString()
  }

  private static let encoders = CGImageDestinationCopyTypeIdentifiers() as! [String]
  private static func hasAlpha(_ data: Data) -> Bool {
    // An opaque HEIC can decode into an alpha-capable bitmap. Source metadata
    // distinguishes real transparency from that decoded memory layout.
    guard let source = CGImageSourceCreateWithData(data as CFData, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
    else { return false }
    return properties[kCGImagePropertyHasAlpha] as? Bool ?? false
  }
  private static func encode(_ image: CGImage, type: String, quality: Double) -> Data? {
    let result = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(result, type as CFString, 1, nil)
    else { return nil }
    CGImageDestinationAddImage(
      destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(destination) ? result as Data : nil
  }
}
