// swiftc Sources/PreviewImageCodec.swift Checks/PreviewImageCodecChecks.swift -o /tmp/arctic-image-codec-check
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main struct PreviewImageCodecChecks {
  static func main() throws {
    let svg = Data(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><circle cx='16' cy='16' r='14' fill='gold'/></svg>"
        .utf8)
    precondition(PreviewImageCodec.compact(svg) == svg)
    let svgURL = PreviewImageCodec.webDataURL(svg)
    precondition(svgURL.hasPrefix("data:image/svg+xml;base64,"))
    precondition(Data(base64Encoded: String(svgURL.split(separator: ",")[1])) == svg)
    for invalid in [
      "<html><svg/></html>", "<svg xmlns='http://www.w3.org/2000/svg'>",
      "<!DOCTYPE svg><svg xmlns='http://www.w3.org/2000/svg'/>",
    ] {
      precondition(PreviewImageCodec.compact(Data(invalid.utf8)) == nil)
      precondition(PreviewImageCodec.webDataURL(Data(invalid.utf8)).isEmpty)
    }
    print("SVG favicon survives cache and Reader embedding; invalid documents rejected")
    let resource = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
      .deletingLastPathComponent()
      .appending(path: "Resources/Assets.xcassets/OnboardingArticle.imageset/glacial-longings.jpg")
    let fixtureData = try Data(contentsOf: resource)
    let fixture = PreviewImageCodec.thumbnail(fixtureData, pixels: 4000)!
    let photoContext = context(width: 1600, height: 1200, alpha: false)
    photoContext.interpolationQuality = .high
    photoContext.draw(fixture, in: CGRect(x: 0, y: 0, width: 1600, height: 1200))
    let photo = photoContext.makeImage()!
    let original = encode(photo, type: UTType.jpeg.identifier, quality: 0.95)
    let small = PreviewImageCodec.thumbnail(original, pixels: 1200)!
    let baseline = encode(small, type: UTType.jpeg.identifier, quality: 0.85)
    let compact = PreviewImageCodec.compact(original)!
    let compactImage = PreviewImageCodec.thumbnail(compact, pixels: 4000)!
    precondition(compactImage.width == 1200 && compactImage.height == 900)
    precondition(compact.count < baseline.count)
    print(
      "1600×1200 source: \(original.count) bytes; baseline JPEG85: \(baseline.count); compact \(type(compact)): \(compact.count), 1200×900"
    )

    let rotated = encode(photo, type: UTType.jpeg.identifier, quality: 0.85, orientation: 6)
    let oriented = PreviewImageCodec.thumbnail(rotated, pixels: 240)!
    precondition(oriented.width == 180 && oriented.height == 240)

    let transparentContext = context(width: 64, height: 64, alpha: true)
    transparentContext.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 0.5))
    transparentContext.fill(CGRect(x: 16, y: 16, width: 32, height: 32))
    let transparent = encode(
      transparentContext.makeImage()!, type: UTType.png.identifier, quality: 1)
    let compactAlpha = PreviewImageCodec.compact(transparent)!
    precondition(type(compactAlpha) == UTType.png.identifier)
    let alphaImage = PreviewImageCodec.thumbnail(compactAlpha, pixels: 64)!
    let sample = context(width: 64, height: 64, alpha: true)
    sample.draw(alphaImage, in: CGRect(x: 0, y: 0, width: 64, height: 64))
    let sampleBytes = sample.data!.assumingMemoryBound(to: UInt8.self)
    precondition(sampleBytes[3] == 0)
    precondition((120...136).contains(Int(sampleBytes[(32 * 64 + 32) * 4 + 3])))
    let alphaPlaceholder = PreviewImageCodec.placeholder(compactAlpha)!
    precondition(type(alphaPlaceholder) == UTType.png.identifier)
    precondition(
      type(PreviewImageCodec.displayThumbnail(compactAlpha, pixels: 32)!) == UTType.png.identifier)

    let web = PreviewImageCodec.webDataURL(compact)
    precondition(web.hasPrefix("data:image/jpeg;base64,"))
    let webBytes = Data(base64Encoded: String(web.split(separator: ",", maxSplits: 1)[1]))!
    precondition(type(webBytes) == UTType.jpeg.identifier)
    precondition(PreviewImageCodec.webDataURL(compactAlpha).hasPrefix("data:image/png;base64,"))
    // Exercise HEIC conversion even if a device chooses JPEG as the smaller cache encoding.
    if (CGImageDestinationCopyTypeIdentifiers() as! [String]).contains(UTType.heic.identifier) {
      let heic = encode(small, type: UTType.heic.identifier, quality: 0.7)
      precondition(PreviewImageCodec.webDataURL(heic).hasPrefix("data:image/jpeg;base64,"))
    }
    let invalid = Data("This is not an image".utf8)
    precondition(PreviewImageCodec.compact(invalid) == nil)
    precondition(PreviewImageCodec.thumbnail(invalid, pixels: 96) == nil)
    precondition(PreviewImageCodec.placeholder(invalid) == nil)
    precondition(PreviewImageCodec.displayThumbnail(invalid, pixels: 96) == nil)
    precondition(PreviewImageCodec.webDataURL(invalid).isEmpty)
    print(
      "Codec checks passed: size bounds, byte savings, alpha, EXIF orientation, Reader MIME, invalid input."
    )
  }

  private static func context(width: Int, height: Int, alpha: Bool) -> CGContext {
    CGContext(
      data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue
        | (alpha ? CGImageAlphaInfo.premultipliedLast : CGImageAlphaInfo.noneSkipLast).rawValue)!
  }

  private static func type(_ data: Data) -> String {
    CGImageSourceGetType(CGImageSourceCreateWithData(data as CFData, nil)!)! as String
  }

  private static func encode(_ image: CGImage, type: String, quality: Double, orientation: Int = 1)
    -> Data
  {
    let data = NSMutableData()
    let destination = CGImageDestinationCreateWithData(data, type as CFString, 1, nil)!
    CGImageDestinationAddImage(
      destination, image,
      [
        kCGImageDestinationLossyCompressionQuality: quality,
        kCGImagePropertyOrientation: orientation,
      ] as CFDictionary)
    precondition(CGImageDestinationFinalize(destination))
    return data as Data
  }
}
