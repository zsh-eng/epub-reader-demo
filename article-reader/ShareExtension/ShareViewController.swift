import ImageIO
import LinkPresentation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Hosts a native sheet with a stable bottom action row. Its detent follows the
/// preview's measured height, so the card unfolds upward without moving Save.
final class ShareViewController: UIViewController, UISheetPresentationControllerDelegate {
  private var didPresent = false
  private weak var savePanel: SaveArticleViewController?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewIsAppearing(_ animated: Bool) {
    super.viewIsAppearing(animated)
    // iOS 26 wraps the extension root. Only the presented sheet is opaque.
    var wrapper: UIView? = view
    while let current = wrapper {
      current.backgroundColor = .clear
      wrapper = current.superview
    }
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !didPresent, let context = extensionContext else { return }
    didPresent = true
    let panel = SaveArticleViewController(context: context)
    savePanel = panel
    panel.modalPresentationStyle = .pageSheet
    if let sheet = panel.sheetPresentationController {
      sheet.detents = [
        .custom(identifier: .init("save-article")) { [weak panel] context in
          min(panel?.contentHeight ?? 260, context.maximumDetentValue)
        }
      ]
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
      sheet.prefersEdgeAttachedInCompactHeight = true
      sheet.delegate = self
    }
    present(panel, animated: true)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    savePanel?.cancelWork()
    extensionContext?.completeRequest(returningItems: nil)
  }
}

private final class SaveArticleViewController: UIHostingController<ShareSaveView> {
  private let model: ShareSaveModel
  fileprivate var contentHeight: CGFloat = 260

  init(context: NSExtensionContext) {
    let model = ShareSaveModel(context: context)
    self.model = model
    super.init(rootView: ShareSaveView(model: model))
    // Extension host notifications are the reliable lifecycle source here; this
    // UIKit-hosted subtree does not own a SwiftUI App scene.
    NotificationCenter.default.addObserver(
      self, selector: #selector(hostDidBecomeActive),
      name: .NSExtensionHostDidBecomeActive, object: context)
    NotificationCenter.default.addObserver(
      self, selector: #selector(hostWillResignActive),
      name: .NSExtensionHostWillResignActive, object: context)
    model.heightDidChange = { [weak self] height in
      // Resolve detents after SwiftUI finishes the current layout pass.
      DispatchQueue.main.async { self?.resize(to: height) }
    }
  }

  @MainActor required dynamic init?(coder aDecoder: NSCoder) { fatalError("Use init(context:)") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    view.accessibilityIdentifier = "share-content"
    model.start()
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    model.isVisible = true
  }

  override func viewWillDisappear(_ animated: Bool) {
    model.isVisible = false
    super.viewWillDisappear(animated)
  }

  @objc private func hostDidBecomeActive() { model.hostIsActive = true }
  @objc private func hostWillResignActive() { model.hostIsActive = false }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    if isBeingDismissed || presentingViewController == nil { cancelWork() }
  }

  func cancelWork() { model.cancelWork() }

  private func resize(to height: CGFloat) {
    let height = max(240, height + 28)
    guard abs(height - contentHeight) > 1 else { return }
    contentHeight = height
    guard let sheet = sheetPresentationController else { return }
    let updateDetent = {
      sheet.detents = [
        .custom(identifier: .init("save-article")) { context in
          min(height, context.maximumDetentValue)
        }
      ]
      sheet.selectedDetentIdentifier = .init("save-article")
    }
    if UIAccessibility.isReduceMotionEnabled {
      updateDetent()
    } else {
      sheet.animateChanges(updateDetent)
    }
  }
}

/// Preview work is optional. The save file is committed before classification;
/// dismissal can cancel all network work without losing the user's save.
@MainActor
private final class ShareSaveModel: ObservableObject {
  @Published var url: URL?
  @Published var title: String?
  @Published var image: UIImage?
  @Published var isSaved = false
  @Published var isTagging = false
  @Published var isVisible = false
  @Published var hostIsActive = true
  @Published var tagNames: [String]?
  @Published var message: String?
  @Published var error: String?
  var heightDidChange: ((CGFloat) -> Void)?
  private var bodyHeight: CGFloat = 0
  private var footerHeight: CGFloat = 80

  private let context: NSExtensionContext
  private let metadataProvider = LPMetadataProvider()
  private var linkTask: Task<Void, Never>?
  private var previewTask: Task<Void, Never>?
  private var taggingTask: Task<Void, Never>?
  private var imageLoadProgress: Progress?
  private var pendingTaggingResult: SharedTaggingResult?

  init(context: NSExtensionContext) {
    self.context = context
    metadataProvider.timeout = 8
  }

  func start() { linkTask = Task { await readLink() } }

  func measureBody(_ height: CGFloat) {
    bodyHeight = height
    heightDidChange?(bodyHeight + footerHeight)
  }

  func measureFooter(_ height: CGFloat) {
    footerHeight = height
    heightDidChange?(bodyHeight + footerHeight)
  }

  private func readLink() async {
    let items = context.inputItems as? [NSExtensionItem] ?? []
    for provider in items.flatMap({ $0.attachments ?? [] }) {
      for type in [UTType.url.identifier, UTType.plainText.identifier]
      where provider.hasItemConformingToTypeIdentifier(type) {
        let item = try? await provider.loadItem(forTypeIdentifier: type, options: nil)
        guard !Task.isCancelled else { return }
        let text = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
        guard let url = SharedInbox.webURL(text) else { continue }
        self.url = url
        previewTask = Task { await loadPreview(for: url) }
        return
      }
    }
    error = "No article link found. Share a link from Safari, Chrome, or another app."
  }

  private func loadPreview(for url: URL) async {
    do {
      #if DEBUG
        // The reserved fixture host makes the actual extension reveal testable
        // without publisher timing. This path is absent from release builds.
        if url.host == "fixture.example" {
          try await Task.sleep(for: .seconds(1.5))
          try Task.checkCancellation()
          title = "The quiet art of paying attention"
          image = Self.fixtureImage()
          return
        }
      #endif
      let metadata = try await metadataProvider.startFetchingMetadata(for: url)
      guard !Task.isCancelled else { return }
      let candidate = metadata.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if !candidate.isEmpty && candidate != url.absoluteString { title = candidate }
      guard let provider = metadata.imageProvider else { return }
      let data: Data? = try await withCheckedThrowingContinuation { continuation in
        imageLoadProgress = provider.loadDataRepresentation(
          forTypeIdentifier: UTType.image.identifier
        ) {
          data, error in
          if let error {
            continuation.resume(throwing: error)
          } else {
            continuation.resume(returning: data)
          }
        }
      }
      guard !Task.isCancelled, let data,
        let source = CGImageSourceCreateWithData(data as CFData, nil),
        let thumbnail = CGImageSourceCreateThumbnailAtIndex(
          source, 0,
          [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 800,
          ] as CFDictionary)
      else { return }
      image = UIImage(cgImage: thumbnail)
    } catch {
      // A publisher can refuse previews. The original URL remains saveable.
    }
  }

  #if DEBUG
    private static func fixtureImage() -> UIImage {
      let size = CGSize(width: 640, height: 320)
      return UIGraphicsImageRenderer(size: size).image { context in
        let colours = [UIColor.systemGray6.cgColor, UIColor.systemGray4.cgColor] as CFArray
        if let gradient = CGGradient(
          colorsSpace: CGColorSpaceCreateDeviceRGB(), colors: colours,
          locations: [0, 1])
        {
          context.cgContext.drawLinearGradient(
            gradient, start: .zero,
            end: CGPoint(x: size.width, y: size.height), options: [])
        }
        let leaf = UIImage(systemName: "leaf.fill")?
          .withTintColor(.secondaryLabel, renderingMode: .alwaysOriginal)
        leaf?.draw(in: CGRect(x: 275, y: 115, width: 90, height: 90))
      }
    }
  #endif

  func save() {
    guard !isSaved, let url else { return }
    do {
      let transfer = try SharedInbox.save(url, title: title)
      isSaved = true
      error = nil
      UIAccessibility.post(notification: .announcement, argument: "Saved to Arctic")
      guard TaggingPreferences.enabled else { return }
      guard !TaggingPreferences.credentialFailure else {
        message = "Update your API key in Arctic to add tags."
        return
      }
      isTagging = true
      taggingTask = Task { await classify(transfer) }
    } catch { self.error = error.localizedDescription }
  }

  private func classify(_ transfer: SharedArticleTransfer) async {
    defer { isTagging = false }
    let credentialRevision = TaggingPreferences.credentialRevision
    do {
      guard let key = try JevKeychain.read(), !key.isEmpty else {
        message = "Add your Jev API key in Arctic to turn on automatic tags."
        return
      }
      await previewTask?.value
      try Task.checkCancellation()
      guard TaggingPreferences.enabled && !TaggingPreferences.credentialFailure,
        TaggingPreferences.credentialRevision == credentialRevision
      else { return }
      guard let title else {
        message = "Tags will be added when you open Arctic."
        return
      }
      let tags = try await JevClient.classify(title: title, description: "", apiKey: key)
      try Task.checkCancellation()
      guard TaggingPreferences.enabled,
        TaggingPreferences.credentialRevision == credentialRevision
      else { return }
      // Publish once to a different directory. The app may already have imported
      // the save request; this completion must never recreate that request.
      let result = SharedTaggingResult(
        id: transfer.id, url: transfer.url, title: title, subtitle: nil,
        tagNames: tags,
        inputFingerprint: ArticleTagCatalog.identity(title: title, description: ""),
        categoryVersion: ArticleTagCatalog.version, feedbackPresented: false)
      if tags.isEmpty {
        try SharedInbox.saveTaggingResult(result)
      } else {
        // Publish the receipt only after the chips enter the visible sheet.
        // If the extension exits first, the app can finish the saved article.
        pendingTaggingResult = result
      }
      tagNames = tags
      UIAccessibility.post(
        notification: .announcement,
        argument: tags.isEmpty ? "No matching tags" : "Added tags: " + tags.joined(separator: ", "))
    } catch is CancellationError {
      // The main app resumes pending work from the durable save request.
    } catch JevError.invalidKey {
      guard TaggingPreferences.credentialRevision == credentialRevision else { return }
      TaggingPreferences.credentialFailure = true
      TaggingPreferences.lastError = JevError.invalidKey.localizedDescription
      message = "Your article is saved. Update your API key in Arctic to add tags."
    } catch {
      message = "Your article is saved. Tags can finish when you open Arctic."
    }
  }

  func presentTagFeedback() {
    guard var result = pendingTaggingResult else { return }
    result.feedbackPresented = true
    do {
      try SharedInbox.saveTaggingResult(result)
      pendingTaggingResult = nil
    } catch { self.error = "Could not keep these tags. Arctic will try again." }
  }

  func cancelWork() {
    isVisible = false
    linkTask?.cancel()
    previewTask?.cancel()
    taggingTask?.cancel()
    imageLoadProgress?.cancel()
    metadataProvider.cancel()
  }

  func close() {
    cancelWork()
    context.completeRequest(returningItems: nil)
  }
}

private struct ShareSaveView: View {
  @ObservedObject var model: ShareSaveModel
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var reveal: AnyTransition {
    reduceMotion ? .opacity : .opacity.combined(with: .offset(y: 10))
  }

  var body: some View {
    VStack(spacing: 0) {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Label(
            model.isSaved ? "Saved to Arctic" : "Save to Arctic",
            systemImage: model.isSaved ? "checkmark.circle.fill" : "tray.and.arrow.down"
          )
          .font(.headline)
          .foregroundStyle(model.isSaved ? ArcticBrand.accent : Color.primary)
          ConnectedTagReveal(
            isProcessing: model.isTagging, tags: model.tagNames ?? [], cornerRadius: 22,
            onRevealed: model.presentTagFeedback
          ) {
            VStack(spacing: 0) {
              articleCard
              if let tags = model.tagNames, !tags.isEmpty {
                tagResult(tags)
              }
            }
            .background(
              Color(uiColor: .secondarySystemBackground), in: RoundedRectangle(cornerRadius: 22))
          }
          .environment(\.scenePhase, model.isVisible && model.hostIsActive ? .active : .inactive)
          if let message = model.message {
            Text(message).font(.subheadline).foregroundStyle(.secondary)
          }
          if let error = model.error {
            Text(error).font(.subheadline).foregroundStyle(.secondary)
              .accessibilityIdentifier("share-error")
          }
        }
        .padding(.horizontal, 24)
        .padding(.top, 28)
        .padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onGeometryChange(for: CGFloat.self) {
          $0.size.height
        } action: {
          model.measureBody($0)
        }
      }
      .scrollBounceBehavior(.basedOnSize)
      footer
    }
    .background(Color(uiColor: .systemBackground))
    .animation(
      reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.28, dampingFraction: 1),
      value: model.title
    )
    .animation(
      reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.28, dampingFraction: 1),
      value: model.image != nil
    )
    .animation(.easeOut(duration: 0.2), value: model.isSaved)
    .animation(
      reduceMotion ? .easeOut(duration: 0.18) : .spring(response: 0.28, dampingFraction: 1),
      value: model.tagNames
    )
  }

  private var articleCard: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let image = model.image {
        Image(uiImage: image)
          .resizable().scaledToFill()
          .frame(height: 154).clipped()
          .accessibilityHidden(true)
          .transition(reveal)
      }
      VStack(alignment: .leading, spacing: 10) {
        if let title = model.title {
          Text(title)
            .font(.system(.title3, design: .serif).weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("share-preview-title")
            .transition(reveal)
        }
        Text(
          model.title == nil
            ? (model.url?.absoluteString ?? "Reading link…")
            : (model.url?.host?.replacingOccurrences(of: "www.", with: "") ?? "")
        )
        .font(model.title == nil ? .body : .caption)
        .foregroundStyle(.secondary)
        .lineLimit(model.title == nil ? 3 : 1)
        .truncationMode(.middle)
        .accessibilityIdentifier("share-link")
      }
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Color(uiColor: .secondarySystemBackground))
    .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    .accessibilityValue(model.isTagging ? "Adding tags" : "")
    .overlay {
      RoundedRectangle(cornerRadius: 22, style: .continuous)
        .strokeBorder(Color.primary.opacity(0.06), lineWidth: 1)
    }
  }

  private func tagResult(_ tags: [String]) -> some View {
    LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), alignment: .leading)], spacing: 8) {
      ForEach(Array(tags.enumerated()), id: \.element) { index, tag in
        TagRevealPill(name: tag, index: index)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(18)
    .background(
      Color(uiColor: .secondarySystemBackground),
      in: RoundedRectangle(cornerRadius: 20, style: .continuous)
    )
    .accessibilityIdentifier("share-added-tags")
  }

  private var footer: some View {
    HStack(spacing: 12) {
      if !model.isSaved {
        Button("Cancel", action: model.close)
          .buttonStyle(ShareActionButtonStyle(primary: false))
          .accessibilityIdentifier("share-cancel")
      }
      Button(model.isSaved ? "Done" : "Save") {
        if model.isSaved { model.close() } else { model.save() }
      }
      .buttonStyle(ShareActionButtonStyle(primary: true))
      .disabled(!model.isSaved && model.url == nil)
      .accessibilityIdentifier(model.isSaved ? "share-done" : "share-save")
      .accessibilityLabel(model.isSaved ? "Done" : "Save article")
    }
    .padding(.horizontal, 24)
    .padding(.top, 8)
    .padding(.bottom, 18)
    .background(Color(uiColor: .systemBackground))
    .onGeometryChange(for: CGFloat.self) {
      $0.size.height
    } action: {
      model.measureFooter($0)
    }
  }
}

private struct ShareActionButtonStyle: ButtonStyle {
  var primary: Bool
  @Environment(\.isEnabled) private var isEnabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.body.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 54)
      .foregroundStyle(primary ? ArcticBrand.onAccent : Color.primary)
      .background(
        primary ? ArcticBrand.accent : Color(uiColor: .secondarySystemBackground), in: Capsule()
      )
      .overlay { Capsule().strokeBorder(Color.primary.opacity(primary ? 0 : 0.12), lineWidth: 1) }
      .opacity(!isEnabled ? 0.4 : configuration.isPressed ? 0.7 : 1)
      .contentShape(Capsule())
  }
}
