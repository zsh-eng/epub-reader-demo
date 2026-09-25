import AppKit
import OSLog
import Observation
import QuartzCore
import WebKit

/// Measurements are off by default. UI changes happen once per second, not on
/// every frame. A bounded trace contains timing only, never page text or URLs.
@MainActor @Observable final class MacDiagnostics: NSObject {
  private(set) var enabled = false
  private(set) var webFPS = 0
  private(set) var uiFPS = 0
  private(set) var webP95 = 0.0
  private(set) var uiP95 = 0.0
  private(set) var gaps = 0
  private(set) var recording = false
  private(set) var seconds = 0
  var hasTrace: Bool { !trace.isEmpty }
  @ObservationIgnored private weak var web: WKWebView?
  @ObservationIgnored private var link: CADisplayLink?
  @ObservationIgnored private var last = 0.0
  @ObservationIgnored private var lastReport = 0.0
  @ObservationIgnored private var uiSamples: [Double] = []
  @ObservationIgnored private var traceStart = 0.0
  private var trace: [Sample] = []
  @ObservationIgnored private let signposter = OSSignposter(
    subsystem: "com.zsheng.ArcticMac", category: "FrameTiming")
  private struct Sample: Codable {
    let elapsed: Double
    let source: String
    let intervalsMS: [Double]
  }
  private static let script =
    (try? String(
      contentsOf: Bundle.main.url(forResource: "reader-diagnostics", withExtension: "js")!,
      encoding: .utf8)) ?? ""
  func attach(to view: WKWebView?, enabled: Bool) {
    if web !== view || !enabled { stop() }
    self.enabled = enabled
    guard enabled, let view else { return }
    web = view
    let hz = view.window?.screen?.maximumFramesPerSecond ?? 120
    view.evaluateJavaScript(
      Self.script + "\narcticDiagnostics.start(\(hz));arcticDiagnostics.record(\(recording));",
      in: nil, in: .defaultClient
    ) { _ in }
    if link == nil {
      let link = view.displayLink(target: self, selector: #selector(tick(_:)))
      link.preferredFrameRateRange = CAFrameRateRange(
        minimum: 30, maximum: Float(hz), preferred: Float(hz))
      link.add(to: .main, forMode: .common)
      self.link = link
    }
  }
  func stop() {
    web?.evaluateJavaScript("globalThis.arcticDiagnostics?.stop()", in: nil, in: .defaultClient) {
      _ in
    }
    link?.invalidate()
    link = nil
    web = nil
    last = 0
    lastReport = 0
    uiSamples.removeAll()
    enabled = false
    if recording { recording = false }
  }
  @objc private func tick(_ link: CADisplayLink) {
    let now = link.timestamp
    if last > 0 { uiSamples.append((now - last) * 1000) }
    last = now
    if lastReport == 0 { lastReport = now }
    guard now - lastReport >= 1 else { return }
    let ordered = uiSamples.sorted()
    uiFPS = Int((Double(uiSamples.count) / (now - lastReport)).rounded())
    uiP95 = ordered.isEmpty ? 0 : ordered[min(ordered.count - 1, Int(Double(ordered.count) * 0.95))]
    append("ui", uiSamples)
    uiSamples.removeAll(keepingCapacity: true)
    lastReport = now
    if recording {
      seconds = Int(ProcessInfo.processInfo.systemUptime - traceStart)
      if seconds >= 30 { endTrace() }
    }
  }
  func receive(_ value: [String: Any]) {
    guard enabled else { return }
    webFPS = value["fps"] as? Int ?? 0
    webP95 = value["p95"] as? Double ?? 0
    gaps = value["gaps"] as? Int ?? 0
    if gaps > 0 { signposter.emitEvent("Web frame gaps", "p95 \(self.webP95) ms") }
    append("web", value["frames"] as? [Double] ?? [])
  }
  private func append(_ source: String, _ values: [Double]) {
    guard recording, trace.count < 64, !values.isEmpty else { return }
    trace.append(
      Sample(
        elapsed: ProcessInfo.processInfo.systemUptime - traceStart,
        source: source, intervalsMS: Array(values.prefix(500))))
  }
  func beginTrace() {
    trace.removeAll()
    traceStart = ProcessInfo.processInfo.systemUptime
    seconds = 0
    recording = true
    web?.evaluateJavaScript(
      "globalThis.arcticDiagnostics?.record(true)", in: nil, in: .defaultClient
    ) { _ in }
  }
  func endTrace() {
    recording = false
    web?.evaluateJavaScript(
      "globalThis.arcticDiagnostics?.record(false)", in: nil, in: .defaultClient
    ) { _ in }
  }
  func exportTrace() {
    endTrace()
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "Arctic-frame-trace.json"
    panel.allowedContentTypes = [.json]
    let snapshot = trace
    panel.begin { result in
      guard result == .OK, let url = panel.url else { return }
      Task.detached(priority: .utility) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do { try encoder.encode(snapshot).write(to: url, options: .atomic) } catch {
          _ = await MainActor.run { NSAlert(error: error).runModal() }
        }
      }
    }
  }
}
