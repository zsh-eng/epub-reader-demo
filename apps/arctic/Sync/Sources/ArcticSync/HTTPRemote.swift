import CryptoKit
import Foundation

public struct ArcticSession: Codable, Sendable {
  public let accountID: String
  public let email: String
  public let server: URL
  // The signed cookie stays in Keychain. It must not enter a domain record or log.
  let cookie: String
}
private final class NoRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
}

/// Each transport belongs to one account. Retirement gates both requests and
/// credential refreshes. No shared browser cookies are used.
public actor HTTPRemote: SyncRemote {
  private var identity: ArcticSession
  private let performRequest: @Sendable (URLRequest) async throws -> (Data, URLResponse)
  private let cancelRequests: @Sendable () -> Void
  private let persistSession: @Sendable (ArcticSession) throws -> Void
  private var retired = false
  public init(identity: ArcticSession) throws {
    try Self.validateServer(identity.server)
    self.identity = identity
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    config.urlCache = nil
    config.timeoutIntervalForRequest = 30
    let session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    performRequest = { try await session.data(for: $0) }
    cancelRequests = { session.invalidateAndCancel() }
    persistSession = { try SessionKeychain.save($0) }
  }

  /// Internal injection keeps lifetime tests off the network and the real Keychain.
  init(
    identity: ArcticSession,
    performRequest: @escaping @Sendable (URLRequest) async throws -> (Data, URLResponse),
    cancelRequests: @escaping @Sendable () -> Void,
    persistSession: @escaping @Sendable (ArcticSession) throws -> Void
  ) throws {
    try Self.validateServer(identity.server)
    self.identity = identity
    self.performRequest = performRequest
    self.cancelRequests = cancelRequests
    self.persistSession = persistSession
  }
  public static func signIn(server: URL, email: String, password: String) async throws
    -> ArcticSession
  {
    try validateServer(server)
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    let session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    var request = URLRequest(url: server.appending(path: "api/auth/sign-in/email"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue(server.absoluteString, forHTTPHeaderField: "Origin")
    request.httpBody = try JSONEncoder().encode(["email": email, "password": password])
    try Task.checkCancellation()
    let (data, response) = try await session.data(for: request)
    try Task.checkCancellation()
    let http = try checked(response)
    struct SignedIn: Decodable {
      struct User: Decodable {
        let id: String
        let email: String
      }
      let user: User
    }
    let user = try JSONDecoder().decode(SignedIn.self, from: data).user
    guard let cookie = sessionCookie(http, server: server), !user.id.isEmpty else {
      throw SyncFailure.invalidResponse
    }
    return ArcticSession(accountID: user.id, email: user.email, server: server, cookie: cookie)
  }
  /// The only native code exchange endpoint. The single-use code is not a session token.
  static func exchangeNativeCode(server: URL, code: String, verifier: String) async throws
    -> ArcticSession
  {
    try validateServer(server)
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.httpShouldSetCookies = false
    let session = URLSession(configuration: config, delegate: NoRedirects(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    var request = URLRequest(url: server.appending(path: "api/arctic/auth/exchange"))
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["code": code, "verifier": verifier])
    try Task.checkCancellation()
    let (data, response) = try await session.data(for: request)
    try Task.checkCancellation()
    let http = try checked(response)
    struct Exchanged: Decodable {
      struct User: Decodable {
        let id: String
        let email: String
      }
      let user: User
    }
    let user = try JSONDecoder().decode(Exchanged.self, from: data).user
    guard let cookie = sessionCookie(http, server: server), !user.id.isEmpty else {
      throw SyncFailure.invalidResponse
    }
    return ArcticSession(accountID: user.id, email: user.email, server: server, cookie: cookie)
  }

  public func pull(deviceID: String, cursor: Int64, head: Int64?) async throws -> SyncPull {
    var query = [
      URLQueryItem(name: "cursor", value: String(cursor)),
      URLQueryItem(name: "excludeOwnDevice", value: "false"),
      URLQueryItem(name: "limit", value: "200"),
    ]
    if let head { query.append(URLQueryItem(name: "head", value: String(head))) }
    let data = try await request(path: "api/arctic/sync/v2/pull", deviceID: deviceID, query: query)
    return try JSONDecoder().decode(SyncPull.self, from: data)
  }
  public func push(deviceID: String, changes: [SyncChange]) async throws -> SyncPush {
    struct Body: Encodable { let changes: [SyncChange] }
    let data = try await request(
      path: "api/arctic/sync/v2/push", method: "POST",
      body: JSONEncoder().encode(Body(changes: changes)), deviceID: deviceID)
    return try JSONDecoder().decode(SyncPush.self, from: data)
  }
  public func upload(_ bytes: Data, deviceID: String) async throws -> String {
    guard bytes.count <= 8 * 1024 * 1024 else { throw SyncFailure.invalidRecord }
    let id = Self.fileID(bytes)
    _ = try await request(
      path: "api/arctic/files/\(id)", method: "PUT", body: bytes, deviceID: deviceID,
      contentType: "application/octet-stream")
    return id
  }
  public func download(_ id: String, deviceID: String) async throws -> Data {
    guard id.range(of: "^sha256:[a-f0-9]{64}$", options: .regularExpression) != nil else {
      throw SyncFailure.invalidRecord
    }
    let bytes = try await request(path: "api/arctic/files/\(id)", deviceID: deviceID)
    guard bytes.count <= 8 * 1024 * 1024, Self.fileID(bytes) == id else {
      throw SyncFailure.invalidResponse
    }
    return bytes
  }
  public func signOut() async throws {
    _ = try await request(path: "api/auth/sign-out", method: "POST", body: Data("{}".utf8))
  }
  /// Retirement is permanent. Callers must await this before replacing/clearing
  /// this server's Keychain entry during an account switch or local sign-out.
  public func cancel() {
    retired = true
    cancelRequests()
  }
  public static func fileID(_ bytes: Data) -> String {
    "sha256:" + SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
  }
  private func request(
    path: String, method: String = "GET", body: Data? = nil, deviceID: String? = nil,
    query: [URLQueryItem] = [], contentType: String = "application/json"
  ) async throws -> Data {
    try requireActive()
    let url = identity.server.appending(path: path).appending(queryItems: query)
    var request = URLRequest(url: url)
    request.httpMethod = method
    request.httpBody = body
    request.setValue(identity.cookie, forHTTPHeaderField: "Cookie")
    request.setValue(identity.server.absoluteString, forHTTPHeaderField: "Origin")
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    if let deviceID { request.setValue(deviceID, forHTTPHeaderField: "X-Device-ID") }
    let (data, response) = try await performRequest(request)
    // Actor reentrancy allows cancel() while the network result is pending. A
    // completed URLSession response can still arrive after invalidation.
    try requireActive()
    let http = try Self.checked(response)
    if let cookie = Self.sessionCookie(http, server: identity.server) {
      let refreshed = ArcticSession(
        accountID: identity.accountID, email: identity.email, server: identity.server,
        cookie: cookie)
      try persistSession(refreshed)
      identity = refreshed
    }
    return data
  }
  private func requireActive() throws {
    guard !retired else { throw CancellationError() }
    try Task.checkCancellation()
  }

  private static func validateServer(_ url: URL) throws {
    guard url.scheme == "https", url.host != nil, url.user == nil, url.password == nil,
      url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/"
    else { throw SyncFailure.invalidServer }
  }
  private static func checked(_ response: URLResponse) throws -> HTTPURLResponse {
    guard let http = response as? HTTPURLResponse else { throw SyncFailure.invalidResponse }
    if http.statusCode == 401 { throw SyncFailure.unauthorized }
    guard (200..<300).contains(http.statusCode) else {
      throw SyncFailure.httpStatus(http.statusCode)
    }
    return http
  }
  private static func sessionCookie(_ response: HTTPURLResponse, server: URL) -> String? {
    let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, field in
      if let key = field.key as? String, let value = field.value as? String { result[key] = value }
    }
    guard
      let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: server).first(where: {
        $0.name == "__Secure-better-auth.session_token" && !$0.value.isEmpty
      })
    else { return nil }
    return HTTPCookie.requestHeaderFields(with: [cookie])["Cookie"]
  }
}
