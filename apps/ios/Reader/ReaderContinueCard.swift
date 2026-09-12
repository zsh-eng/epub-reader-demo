import UIKit

struct ReaderRecentBook {
  let id, title, activity: String
  let cover: UIImage?
  init?(_ message: [String: Any]) {
    guard let id = message["id"] as? String, let title = message["title"] as? String,
          let activity = message["activity"] as? String else { return nil }
    self.id = id; self.title = title; self.activity = activity
    let encoded = (message["cover"] as? String ?? "").split(separator: ",", maxSplits: 1).last.map(String.init) ?? ""
    cover = Data(base64Encoded: encoded).flatMap(UIImage.init(data:))
  }
}

/// The web navigation's circular book cover and quiet resume card.
func readerContinueCard(_ book: ReaderRecentBook, colors: ReaderNativeColors, action: @escaping () -> Void) -> UIView {
  let button = readerButton("Continue reading \(book.title)", action: action)
  button.configuration?.title = nil
  readerCard(button.surface, colors: colors, fill: 0.35, border: 0.6)
  button.surface.layer.cornerRadius = 24
  let caption = readerCaption("Continue reading", tracking: 1.4)
  caption.textColor = colors.detail
  let image = UIImageView(image: book.cover ?? readerIcon("book-open", size: 28))
  image.contentMode = book.cover == nil ? .center : .scaleAspectFill
  image.tintColor = colors.detail; image.backgroundColor = colors.soft
  image.layer.cornerRadius = 48; image.layer.borderWidth = 5; image.layer.borderColor = colors.canvas.cgColor
  image.clipsToBounds = true
  NSLayoutConstraint.activate([image.widthAnchor.constraint(equalToConstant: 96), image.heightAnchor.constraint(equalToConstant: 96)])
  let title = UILabel(); title.text = book.title; title.font = ReaderFont.literary(16); title.textColor = colors.ink
  title.lineBreakMode = .byTruncatingTail
  let activity = readerCaption(book.activity, tracking: 1.2); activity.textColor = colors.detail
  let labels = UIStackView(arrangedSubviews: [title, activity]); labels.axis = .vertical; labels.alignment = .center; labels.spacing = 4
  let stack = UIStackView(arrangedSubviews: [caption, image, labels]); stack.axis = .vertical; stack.alignment = .center; stack.spacing = 12
  stack.isUserInteractionEnabled = false; stack.translatesAutoresizingMaskIntoConstraints = false; button.addSubview(stack)
  NSLayoutConstraint.activate([
    stack.leadingAnchor.constraint(equalTo: button.leadingAnchor, constant: 16), stack.trailingAnchor.constraint(equalTo: button.trailingAnchor, constant: -16), stack.topAnchor.constraint(equalTo: button.topAnchor, constant: 12), stack.bottomAnchor.constraint(equalTo: button.bottomAnchor, constant: -16),
    title.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor), activity.widthAnchor.constraint(lessThanOrEqualTo: stack.widthAnchor),
  ])
  return button
}
