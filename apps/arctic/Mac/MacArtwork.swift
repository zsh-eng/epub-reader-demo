import AppKit
import CryptoKit

/// Original, deterministic colour fields inspired by the soft grain in OpenAI's
/// news covers. Sixteen 320×200 bitmaps cost ~4 MiB, with no network or scroll-time
/// drawing. Their URL seed stays stable across filtering and reuse.
actor MacArtwork {
  static let shared = MacArtwork()
  private var cache: [Int: CGImage] = [:]
  func image(for url: URL) -> CGImage? {
    let seed = Int(Array(SHA256.hash(data: Data(url.absoluteString.utf8)))[0]) % 16
    if let image = cache[seed] { return image }
    let palettes: [[[Double]]] = [
      [[0.35, 0.86, 0.72], [0.23, 0.65, 0.82], [0.79, 0.91, 0.60]],
      [[0.59, 0.44, 0.77], [0.88, 0.69, 0.81], [0.98, 0.76, 0.70]],
      [[0.33, 0.68, 0.55], [0.70, 0.85, 0.76], [0.85, 0.91, 0.75]],
      [[0.77, 0.65, 0.86], [0.94, 0.79, 0.86], [0.90, 0.73, 0.62]],
    ]
    let colours = palettes[seed % palettes.count]
    let width = 320
    let height = 200
    var bytes = [UInt8](repeating: 255, count: width * height * 4)
    var noise = UInt64(seed + 1)
    for y in 0..<height {
      for x in 0..<width {
        let u = Double(x) / Double(width)
        let v = Double(y) / Double(height)
        let phase = Double(seed) * 0.7
        let a = 0.5 + 0.5 * sin(u * 2.6 + v * 2.1 + phase + 0.7 * sin(v * 3.1))
        let b = 0.5 + 0.5 * cos(v * 2.4 - u * 2.3 + phase)
        noise = noise &* 6_364_136_223_846_793_005 &+ 1
        let grain = (Double((noise >> 32) & 255) / 255 - 0.5) * 0.026
        for channel in 0..<3 {
          let field = colours[0][channel] * (1 - a) + colours[1][channel] * a
          let value = field * (1 - b * 0.48) + colours[2][channel] * b * 0.48 + grain
          bytes[(y * width + x) * 4 + channel] = UInt8(min(255, max(0, value * 255)))
        }
      }
    }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData),
      let image = CGImage(
        width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32,
        bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
        provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    else { return nil }
    cache[seed] = image
    return image
  }
}
