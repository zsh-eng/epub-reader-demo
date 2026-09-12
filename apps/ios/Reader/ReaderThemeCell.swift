import UIKit

/// Theme previews use resolved CSS colors, including unselected themes. This
/// preserves ThemePanel's cards without a second hand-maintained native palette.
final class ReaderThemeCell: UITableViewCell {
  init(themes: [ReaderNativeTheme], selected: String, onSelect: @escaping (String) -> Void) {
    super.init(style: .default, reuseIdentifier: nil)
    backgroundColor = .clear
    selectionStyle = .none
    let grid = UIStackView()
    grid.axis = .vertical
    grid.spacing = 12
    for offset in stride(from: 0, to: themes.count, by: 2) {
      let row = UIStackView()
      row.axis = .horizontal
      row.distribution = .fillEqually
      row.spacing = 12
      for theme in themes[offset..<min(offset + 2, themes.count)] {
        let card = UIButton(type: .custom)
        card.backgroundColor = theme.colors.canvas
        card.layer.cornerRadius = 20
        card.layer.cornerCurve = .continuous
        card.layer.borderWidth = selected == theme.id ? 2 : 0.5
        card.layer.borderColor = theme.colors.rule.cgColor
        card.accessibilityLabel = theme.title
        card.accessibilityTraits = selected == theme.id ? [.button, .selected] : [.button]
        card.addAction(UIAction { _ in onSelect(theme.id) }, for: .touchUpInside)
        let name = UILabel()
        name.text = theme.title.uppercased() + (selected == theme.id ? "  ✓" : "")
        name.font = ReaderFont.body(10, weight: .semibold)
        name.textColor = theme.colors.detail
        name.numberOfLines = 0
        let sample = UILabel()
        sample.text = "In a hole in the ground there lived a hobbit."
        sample.font = ReaderFont.literary(18)
        sample.textColor = theme.colors.ink
        sample.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [name, sample])
        stack.axis = .vertical
        stack.spacing = 12
        stack.isUserInteractionEnabled = false
        card.addSubview(stack)
        stack.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
          stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 12), stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -12),
          stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14), stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
          card.heightAnchor.constraint(greaterThanOrEqualToConstant: 132),
        ])
        row.addArrangedSubview(card)
      }
      if row.arrangedSubviews.count == 1 { row.addArrangedSubview(UIView()) }
      grid.addArrangedSubview(row)
    }
    contentView.addSubview(grid)
    grid.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      grid.leadingAnchor.constraint(equalTo: contentView.leadingAnchor), grid.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      grid.topAnchor.constraint(equalTo: contentView.topAnchor), grid.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}
