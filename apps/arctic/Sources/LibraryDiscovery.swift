import SwiftUI

/// Static marks render immediately and make no favicon requests at launch.
struct ArcticPublisher: Identifiable {
  let name: String
  let mark: String
  let address: String
  var id: String { address }
  var url: URL { URL(string: address)! }
  static let all = [
    ArcticPublisher(name: "NY Times", mark: "N", address: "https://www.nytimes.com/"),
    ArcticPublisher(name: "Financial Times", mark: "FT", address: "https://www.ft.com/"),
    ArcticPublisher(name: "Economist", mark: "E", address: "https://www.economist.com/"),
    ArcticPublisher(name: "New Yorker", mark: "NY", address: "https://www.newyorker.com/"),
    ArcticPublisher(name: "The Atlantic", mark: "A", address: "https://www.theatlantic.com/"),
  ]
}

struct LibraryDiscovery: View {
  let open: (URL) -> Void
  let weekly: () -> Void

  var body: some View {
    ScrollView(.horizontal) {
      HStack(alignment: .top, spacing: 18) {
        Button(action: weekly) {
          VStack(spacing: 8) {
            Image(systemName: "star.fill").font(.system(size: 22, weight: .medium))
              .foregroundStyle(ArcticBrand.accent)
              .frame(width: 58, height: 58)
              .background(ArcticBrand.accent.opacity(0.1), in: Circle())
              .overlay(Circle().strokeBorder(ArcticBrand.accent.opacity(0.4), lineWidth: 1))
            Text("This week").font(.caption2.weight(.medium))
          }
        }.accessibilityLabel("Favourites this week").accessibilityIdentifier("weekly-favourites")
        ForEach(ArcticPublisher.all) { publisher in
          Button {
            open(publisher.url)
          } label: {
            VStack(spacing: 8) {
              Text(publisher.mark).font(.system(size: 23, weight: .semibold, design: .serif))
                .frame(width: 58, height: 58)
                .background(ReaderTheme.secondary, in: Circle())
                .overlay(Circle().strokeBorder(ReaderTheme.border.opacity(0.35), lineWidth: 1))
              Text(publisher.name).font(.caption2).lineLimit(1)
            }.frame(width: 68)
          }.accessibilityLabel("Browse " + publisher.name)
            .accessibilityHint("Opens through Unwall")
            .accessibilityIdentifier("publisher-" + (publisher.url.host ?? ""))
        }
      }.padding(.horizontal, 20).padding(.vertical, 4)
    }.scrollIndicators(.hidden).buttonStyle(ArcticPressStyle())
      .foregroundStyle(ReaderTheme.foreground)
      .padding(.bottom, 10)
  }
}

/// Week starts Monday in the user's current time zone. Undated legacy favourites
/// stay in All: do not invent a date when adding the new optional timestamp.
enum WeeklyFavourites {
  static func articles(_ articles: [SavedArticle], now: Date = .now, calendar: Calendar = .current)
    -> [SavedArticle]
  {
    var calendar = calendar
    calendar.firstWeekday = 2
    calendar.minimumDaysInFirstWeek = 4
    guard let week = calendar.dateInterval(of: .weekOfYear, for: now) else { return [] }
    return articles.filter {
      guard $0.saved, $0.favourite, let date = $0.favouritedAt else { return false }
      return date >= week.start && date < week.end
    }.sorted { ($0.favouritedAt ?? .distantPast) > ($1.favouritedAt ?? .distantPast) }
  }
}

struct WeeklyFavouritesSheet: View {
  let store: ArticleStore
  let open: (URL) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var all = false

  var body: some View {
    let week = WeeklyFavourites.articles(store.articles)
    let articles = all ? store.articles.filter { $0.saved && $0.favourite } : week
    NavigationStack {
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "star.fill").font(.system(size: 32)).foregroundStyle(
              ArcticBrand.accent)
            Text(all ? "Worth keeping." : "The week's\ngood finds.")
              .font(.system(size: 38, weight: .regular, design: .serif)).tracking(-1)
            Text(
              all
                ? "All your favourites, including archived articles."
                : "\(week.count) \(week.count == 1 ? "favourite" : "favourites") · Monday to Sunday"
            )
            .font(.subheadline).foregroundStyle(.secondary)
          }.padding(.top, 20).padding(.bottom, 6)
          Picker("Collection", selection: $all) {
            Text("This week").tag(false)
            Text("All favourites").tag(true)
          }.pickerStyle(.segmented)
          if articles.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
              Text("Something will stay with you.").font(.system(.title3, design: .serif))
              Text("Favourite an article to keep it here.").font(.subheadline).foregroundStyle(
                .secondary)
            }.padding(.vertical, 32)
          }
          ForEach(articles) { article in
            Button {
              dismiss()
              open(article.url)
            } label: {
              VStack(alignment: .leading, spacing: 10) {
                if let image = article.imageURL {
                  ArticleThumbnail(url: image, pixels: 960).frame(height: 190)
                    .clipShape(RoundedRectangle(cornerRadius: 20))
                }
                Text(article.title).font(.system(size: 23, weight: .medium, design: .serif))
                  .lineLimit(3)
                  .frame(maxWidth: .infinity, alignment: .leading)
                Text(article.url.host ?? "").font(.caption).foregroundStyle(.secondary)
              }
            }.buttonStyle(ArcticPressStyle()).accessibilityIdentifier(
              "weekly-article-" + article.id.uuidString)
          }
        }.padding(.horizontal, 24).padding(.bottom, 32)
      }.background(ReaderTheme.background)
        .navigationTitle("Favourites").navigationBarTitleDisplayMode(.inline)
        .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    }.tint(ArcticBrand.accent).presentationDragIndicator(.visible)
  }
}
