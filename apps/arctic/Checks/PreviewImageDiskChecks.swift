import CryptoKit
import Foundation
import ImageIO

enum TestMode { static let enabled = true }

@main struct PreviewImageDiskChecks {
  static func main() async throws {
    let arguments = CommandLine.arguments
    let fixture = URL(fileURLWithPath: arguments[1])
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let compact = PreviewImageCodec.compact(try Data(contentsOf: fixture))!
    let url = URL(string: "https://fixture.example/older-cached-image.jpg")!
    let key = SHA256.hash(data: Data(url.absoluteString.utf8)).map { String(format: "%02x", $0) }
      .joined()
    let master = directory.appending(path: key + ".image")
    // Model a real older cache: a compact master exists, but no tiny preview.
    try compact.write(to: master)
    let disk = PreviewImageDisk(directory: directory)
    let immediatePreview = await disk.preview(for: url, regenerateFromMaster: false)
    precondition(immediatePreview == nil)
    precondition(
      !FileManager.default.fileExists(atPath: master.appendingPathExtension("preview").path))
    let preview = await disk.preview(for: url)
    precondition(preview != nil)
    precondition(
      FileManager.default.fileExists(atPath: master.appendingPathExtension("preview").path))
    let tiny = PreviewImageCodec.thumbnail(preview!, pixels: 4000)!
    precondition(max(tiny.width, tiny.height) == 24)

    for pixels in [96, 256, 960] {
      let bytes = await disk.thumbnailData(for: url, pixels: pixels)!
      let image = PreviewImageCodec.thumbnail(bytes, pixels: 4000)!
      precondition(max(image.width, image.height) == pixels)
      precondition(
        FileManager.default.fileExists(
          atPath: master.appendingPathExtension("thumb-v1-\(pixels)").path))
      print("Persistent \(pixels)-pixel thumbnail: \(bytes.count) bytes")
    }
    let expected = await disk.thumbnailData(for: url, pixels: 256)
    // Deleting the master proves a new actor reads the persisted display file,
    // rather than re-encoding or trying the network to build it again.
    try FileManager.default.removeItem(at: master)
    let reopened = PreviewImageDisk(directory: directory)
    let restored = await reopened.thumbnailData(for: url, pixels: 256)
    precondition(restored == expected)
    try FileManager.default.removeItem(at: master.appendingPathExtension("preview"))
    let restoredPreview = await reopened.preview(for: url, regenerateFromMaster: false)
    precondition(restoredPreview != nil)
    let regenerated = PreviewImageCodec.thumbnail(restoredPreview!, pixels: 4000)!
    precondition(max(regenerated.width, regenerated.height) == 24)
    let uncached = await reopened.preview(
      for: URL(string: "https://fixture.example/never-fetched")!)
    precondition(uncached == nil)

    try compact.write(to: master)
    try FileManager.default.removeItem(at: master.appendingPathExtension("thumb-v1-960"))
    let cancelled = Task {
      withUnsafeCurrentTask { $0?.cancel() }
      return await reopened.thumbnailData(for: url, pixels: 960)
    }
    let cancelledResult = await cancelled.value
    precondition(cancelledResult == nil)
    precondition(
      !FileManager.default.fileExists(atPath: master.appendingPathExtension("thumb-v1-960").path))
    // Offer independent expensive transforms together, then verify a persisted
    // hot read still returns correctly while they run. Latency is diagnostic,
    // not a hardware-dependent test threshold.
    var coldURLs: [URL] = []
    for index in 0..<12 {
      let cold = URL(string: "https://fixture.example/cold-\(index)")!
      let hash = SHA256.hash(data: Data(cold.absoluteString.utf8)).map {
        String(format: "%02x", $0)
      }.joined()
      try compact.write(to: directory.appending(path: hash + ".image"))
      coldURLs.append(cold)
    }
    await withTaskGroup(of: Void.self) { group in
      for cold in coldURLs {
        group.addTask { _ = await reopened.thumbnailData(for: cold, pixels: 960) }
      }
      for _ in 0..<12 { await Task.yield() }
      let start = CFAbsoluteTimeGetCurrent()
      let hot = await reopened.thumbnailData(for: url, pixels: 256)
      let elapsed = (CFAbsoluteTimeGetCurrent() - start) * 1000
      precondition(hot == expected)
      print("Hot derivative read under 12 cold transformations: \(elapsed) ms")
    }
    print(
      "Image disk checks passed: legacy preview regeneration, nonblocking preview miss, preview from display without master, persisted display sizes, offline reopen, local-only miss, cancelled generation, concurrent hot reads."
    )
  }
}
