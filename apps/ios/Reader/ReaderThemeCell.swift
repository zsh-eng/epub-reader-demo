import UIKit

/// Exact ThemePanel composition: title strip, Preview caption, current reader
/// font, and the original 144 pt two-column cards. CSS supplies every palette.
final class ReaderThemeGrid: UIStackView {
  init(themes: [ReaderNativeTheme], selected: String, font: String, onSelect: @escaping (String) -> Void) {
    super.init(frame: .zero)
    axis = .vertical; spacing = 12
    let order = ["light", "dark", "night", "flexoki-light", "flexoki-dark"]
    let themes = order.compactMap { id in themes.first { $0.id == id } }
    for offset in stride(from: 0, to: themes.count, by: 2) {
      let row = UIStackView(); row.distribution = .fillEqually; row.spacing = 12
      for theme in themes[offset..<min(offset + 2, themes.count)] {
        let card = readerButton(theme.title) { onSelect(theme.id) }
        card.configuration?.title = nil
        card.backgroundColor = theme.colors.canvas
        card.layer.cornerRadius = 20; card.clipsToBounds = true
        card.layer.borderWidth = selected == theme.id ? 2 : 1
        card.layer.borderColor = theme.colors.rule.withAlphaComponent(selected == theme.id ? 1 : 0.5).cgColor
        card.accessibilityTraits = selected == theme.id ? [.button, .selected] : [.button]
        let name = readerCaption(theme.title, tracking: 1.6); name.textColor = theme.colors.detail
        let rule = UIView(); rule.backgroundColor = theme.colors.rule.withAlphaComponent(0.6)
        let preview = readerCaption("Preview", tracking: 1.4); preview.textColor = theme.colors.detail
        let sample = UILabel(); sample.numberOfLines = 3
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 4
        sample.attributedText = NSAttributedString(string: "In a hole in the ground there lived a hobbit.", attributes: [.font: ReaderFont.reading(font, size: 14), .foregroundColor: theme.colors.ink, .paragraphStyle: paragraph])
        for item in [name, rule, preview, sample] { card.addSubview(item); item.translatesAutoresizingMaskIntoConstraints = false; item.isUserInteractionEnabled = false }
        NSLayoutConstraint.activate([
          card.heightAnchor.constraint(greaterThanOrEqualToConstant: 144),
          name.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12), name.topAnchor.constraint(equalTo: card.topAnchor, constant: 8), name.trailingAnchor.constraint(lessThanOrEqualTo: card.trailingAnchor, constant: -12),
          rule.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 8), rule.leadingAnchor.constraint(equalTo: card.leadingAnchor), rule.trailingAnchor.constraint(equalTo: card.trailingAnchor), rule.heightAnchor.constraint(equalToConstant: 1),
          preview.topAnchor.constraint(equalTo: rule.bottomAnchor, constant: 12), preview.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12),
          sample.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12), sample.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12), sample.topAnchor.constraint(greaterThanOrEqualTo: preview.bottomAnchor, constant: 10), sample.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -12),
        ])
        if selected == theme.id {
          let check = UIImageView(image: readerIcon("check", size: 12)); check.tintColor = theme.colors.canvas; check.backgroundColor = theme.colors.ink; check.layer.cornerRadius = 10; check.contentMode = .center
          card.addSubview(check); check.translatesAutoresizingMaskIntoConstraints = false
          NSLayoutConstraint.activate([check.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12), check.topAnchor.constraint(equalTo: card.topAnchor, constant: 12), check.widthAnchor.constraint(equalToConstant: 20), check.heightAnchor.constraint(equalToConstant: 20)])
        }
        row.addArrangedSubview(card)
      }
      if row.arrangedSubviews.count == 1 { row.addArrangedSubview(UIView()) }
      addArrangedSubview(row)
    }
  }
  required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
