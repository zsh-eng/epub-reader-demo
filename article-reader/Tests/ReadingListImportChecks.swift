import Foundation

@main struct ReadingListImportChecks {
  static func main() throws {
    let html = """
      <a href="https://example.com/first" ADD_DATE="1700000000">First &amp; earliest</a>
      <a href="https://example.com/second" ADD_DATE="1700000001">Second</a>
      <a href="https://example.com/first">Duplicate</a>
      <a href="https://example.com/missing" ADD_DATE="invalid">Missing date</a>
      <a href="javascript:alert(1)">Ignore</a>
      """
    let entries = try ReadingListImport.parse(html)
    precondition(entries.count == 4)
    precondition(entries[0].title == "First & earliest")
    precondition(entries[0].savedAt?.timeIntervalSince1970 == 1_700_000_000)
    let now = Date(timeIntervalSince1970: 1_800_000_000)
    let first = ReadingListImport.merge(entries, into: [], now: now)
    precondition(first.added.count == 3 && first.duplicates == 1)
    precondition(first.articles.map(\.url.lastPathComponent) == ["first", "second", "missing"])
    precondition(first.articles[2].savedAt == now)
    precondition(Set(first.articles.compactMap(\.importBatchID)).count == 1)
    let encoded = try JSONEncoder().encode(first.articles)
    let restored = try JSONDecoder().decode([SavedArticle].self, from: encoded)
    precondition(restored[0].savedAt == entries[0].savedAt)
    precondition(restored[0].importBatchID == first.articles[0].importBatchID)
    let repeated = ReadingListImport.merge(
      entries, into: restored, now: now.addingTimeInterval(100))
    precondition(repeated.added.isEmpty && repeated.duplicates == 4)
    precondition(repeated.articles[0].savedAt == restored[0].savedAt)
    var history = restored[1]
    history.isSaved = false
    history.isArchived = true
    history.lastVisitedAt = now
    let mergedHistory = ReadingListImport.merge(entries, into: [history], now: now)
    let revived = mergedHistory.articles.first { $0.id == history.id }!
    precondition(revived.saved && revived.isArchived == false)
    precondition(revived.savedAt == entries[1].savedAt && revived.lastVisitedAt == now)
    let longHTML = (0..<10_000).map {
      "<a href='https://example.com/item-\($0)' ADD_DATE='\(1_700_000_000 + $0)'>Story \($0)</a>"
    }.joined()
    let began = ContinuousClock.now
    let longEntries = try ReadingListImport.parse(longHTML)
    let longResult = ReadingListImport.merge(longEntries, into: [], now: now)
    precondition(longResult.added.count == 10_000)
    precondition(longResult.articles.first?.url.lastPathComponent == "item-0")
    precondition(longResult.articles.last?.savedAt?.timeIntervalSince1970 == 1_700_009_999)
    print(
      "PASS: dates, entities, unsafe URLs, duplicates, source order, missing dates, history revival, persistence; 10,000 import: \(began.duration(to: .now))"
    )
    if CommandLine.arguments.count > 1 {
      let real = try ReadingListImport.parse(
        String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
      precondition(real.allSatisfy { $0.savedAt != nil })
      print("PASS: supplied Chrome export has \(real.count) valid links with source dates")
    }
  }
}
