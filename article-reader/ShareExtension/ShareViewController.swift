import UIKit
import UniformTypeIdentifiers

/// Native Share-sheet entry point. Saving is local and works without launching
/// the main app or waiting for a publisher; previews load when Articles resumes.
final class ShareViewController: UIViewController, UISheetPresentationControllerDelegate {
  private var didPresent = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewIsAppearing(_ animated: Bool) {
    super.viewIsAppearing(animated)
    // iOS 26 adds opaque wrapper views around the remote extension root.
    // This root only hosts the native sheet; its wrappers must stay transparent.
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
    panel.modalPresentationStyle = .pageSheet
    if let sheet = panel.sheetPresentationController {
      sheet.detents = [
        .custom(identifier: .init("save-article")) { context in
          min(UIFontMetrics.default.scaledValue(for: 260), context.maximumDetentValue)
        }
      ]
      sheet.prefersGrabberVisible = true
      sheet.prefersScrollingExpandsWhenScrolledToEdge = false
      sheet.delegate = self
    }
    present(panel, animated: true)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    extensionContext?.completeRequest(returningItems: nil)
  }
}

private final class SaveArticleViewController: UIViewController {
  private let requestContext: NSExtensionContext

  init(context: NSExtensionContext) {
    requestContext = context
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("Use init(context:)") }

  private let titleLabel = UILabel()
  private let detailLabel = UILabel()
  private let saveButton = UIButton(type: .system)
  private var articleURL: URL?

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    view.accessibilityIdentifier = "share-content"
    preferredContentSize = CGSize(width: 400, height: 240)
    titleLabel.text = "Save to Articles"
    titleLabel.font = .preferredFont(forTextStyle: .title2)
    titleLabel.adjustsFontForContentSizeCategory = true
    detailLabel.text = "Reading link…"
    detailLabel.font = .preferredFont(forTextStyle: .body)
    detailLabel.numberOfLines = 3
    detailLabel.textColor = .secondaryLabel
    saveButton.configuration = .filled()
    saveButton.configuration?.baseBackgroundColor = .label
    saveButton.setTitle("Save article", for: .normal)
    saveButton.isEnabled = false
    saveButton.accessibilityIdentifier = "share-save"
    saveButton.addTarget(self, action: #selector(save), for: .touchUpInside)
    let cancel = UIButton(type: .system)
    cancel.setTitle("Cancel", for: .normal)
    cancel.addTarget(self, action: #selector(close), for: .touchUpInside)
    let stack = UIStackView(arrangedSubviews: [titleLabel, detailLabel, saveButton, cancel])
    stack.axis = .vertical
    stack.spacing = 18
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -24),
      stack.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24),
    ])
    Task { await readLink() }
  }

  private func readLink() async {
    let items = requestContext.inputItems as? [NSExtensionItem] ?? []
    for provider in items.flatMap({ $0.attachments ?? [] }) {
      for type in [UTType.url.identifier, UTType.plainText.identifier]
      where provider.hasItemConformingToTypeIdentifier(type) {
        let item = try? await provider.loadItem(forTypeIdentifier: type, options: nil)
        let text = (item as? URL)?.absoluteString ?? (item as? String) ?? ""
        guard let url = SharedInbox.webURL(text) else { continue }
        articleURL = url
        detailLabel.text = url.absoluteString
        saveButton.isEnabled = true
        return
      }
    }
    detailLabel.text = "No article link found. Share a link from Safari, Chrome, or another app."
  }

  @objc private func save() {
    guard let articleURL else { return }
    do {
      try SharedInbox.save(articleURL)
      titleLabel.text = "Saved to Articles"
      detailLabel.text = "Your link will appear when you next open Articles."
      saveButton.isEnabled = false
      requestContext.completeRequest(returningItems: nil)
    } catch { detailLabel.text = error.localizedDescription }
  }

  @objc private func close() { requestContext.completeRequest(returningItems: nil) }
}
