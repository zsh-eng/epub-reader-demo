import UIKit

/// Native counterpart of NotebookNote: inset secondary cards, a quiet quote,
/// body text, and location metadata. UITableView owns scrolling and swipe actions.
final class ReaderNoteCell: UITableViewCell {
  private let card = UIStackView()
  private let quote = UILabel()
  private let body = UILabel()
  private let location = UILabel()
  override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
    super.init(style: style, reuseIdentifier: reuseIdentifier)
    backgroundColor = .clear
    selectionStyle = .none
    card.axis = .vertical
    card.spacing = 10
    card.isLayoutMarginsRelativeArrangement = true
    card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 14, leading: 16, bottom: 12, trailing: 16)
    card.layer.cornerRadius = 16
    card.layer.cornerCurve = .continuous
    quote.font = ReaderFont.body(12)
    quote.numberOfLines = 2
    body.font = ReaderFont.body(15)
    body.numberOfLines = 0
    location.font = ReaderFont.body(11)
    location.numberOfLines = 2
    for label in [quote, body, location] {
      label.adjustsFontForContentSizeCategory = true
      card.addArrangedSubview(label)
    }
    card.setCustomSpacing(14, after: body)
    contentView.addSubview(card)
    card.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 16), card.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -16),
      card.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4), card.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -4),
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
  func configure(_ note: ReaderNativeNote, colors: ReaderNativeColors, editing: Bool) {
    card.backgroundColor = colors.soft
    card.layer.borderWidth = editing ? 1 : 0
    card.layer.borderColor = colors.detail.cgColor
    quote.text = "“\(note.quote)”"
    quote.isHidden = note.quote.isEmpty
    quote.textColor = colors.detail
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineSpacing = 4
    body.attributedText = NSAttributedString(string: note.text, attributes: [.font: ReaderFont.body(15), .foregroundColor: colors.ink, .paragraphStyle: paragraph])
    let date = Date(timeIntervalSince1970: note.createdAt / 1000).formatted(date: .abbreviated, time: .omitted)
    location.text = "\(note.chapter) · \(note.page > 0 ? "Page \(note.page)" : "Location unavailable")\n\(date)"
    location.textColor = colors.detail
    accessibilityLabel = [note.text, note.quote, location.text ?? ""].filter { !$0.isEmpty }.joined(separator: ". ")
    accessibilityHint = "Use the actions menu to copy, edit, or delete."
  }
}
