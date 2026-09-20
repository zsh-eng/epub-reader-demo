import AuthenticationServices
import CryptoKit
import Foundation
import Security

public enum NativeSignInFailure: Error, Equatable {
  case invalidCallback, failed, alreadyInProgress, unableToPresent
}

/// State and verifier exist only for this attempt. No reusable session credential
/// appears in an authorization URL, browser callback, or app deep-link handler.
public struct NativeSignInRequest: Sendable {
  public let authorizationURL: URL
  private let state: String
  private let verifier: String
  private let server: URL

  public init(server: URL) throws {
    try self.init(server: server, state: Self.randomToken(), verifier: Self.randomToken())
  }
  init(server: URL, state: String, verifier: String) throws {
    guard server.scheme == "https", server.host != nil, server.user == nil,
      server.password == nil, server.query == nil, server.fragment == nil,
      server.path.isEmpty || server.path == "/"
    else { throw SyncFailure.invalidServer }
    self.server = server
    self.state = state
    self.verifier = verifier
    authorizationURL = server.appending(path: "api/arctic/auth/start").appending(queryItems: [
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "challenge", value: Self.challenge(verifier)),
    ])
  }
  public func exchange(callback: URL) async throws -> ArcticSession {
    let code = try callbackCode(callback)
    return try await HTTPRemote.exchangeNativeCode(server: server, code: code, verifier: verifier)
  }
  func callbackCode(_ callback: URL) throws -> String {
    guard callback.scheme == "articles", callback.host == "auth", callback.path == "/callback",
      callback.user == nil, callback.password == nil, callback.port == nil,
      callback.fragment == nil,
      let query = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems,
      query.filter({ $0.name == "state" }).count == 1,
      query.first(where: { $0.name == "state" })?.value == state
    else { throw NativeSignInFailure.invalidCallback }
    if query.contains(where: { $0.name == "error" }) { throw NativeSignInFailure.failed }
    guard query.filter({ $0.name == "code" }).count == 1,
      let code = query.first(where: { $0.name == "code" })?.value,
      code.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil
    else { throw NativeSignInFailure.invalidCallback }
    return code
  }
  static func challenge(_ verifier: String) -> String {
    Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
  private static func randomToken() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
    guard status == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    return Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
  }
}

/// The caller retains this helper while sign-in is running and supplies its real
/// presentation window. A private browser session leaves Safari's account alone.
@MainActor
public final class NativeGoogleSignIn: NSObject, ASWebAuthenticationPresentationContextProviding {
  private let anchor: ASPresentationAnchor
  private var session: ASWebAuthenticationSession?
  private var signingIn = false
  private var cancelled = false
  private var exchangeTask: Task<ArcticSession, Error>?
  private var continuation: CheckedContinuation<URL, Error>?
  public init(anchor: ASPresentationAnchor) { self.anchor = anchor }
  public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    anchor
  }

  public func signIn(server: URL) async throws -> ArcticSession {
    guard !signingIn else { throw NativeSignInFailure.alreadyInProgress }
    signingIn = true
    cancelled = false
    defer {
      signingIn = false
      exchangeTask = nil
    }
    let request = try NativeSignInRequest(server: server)
    let callback = try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        let session = ASWebAuthenticationSession(
          url: request.authorizationURL, callbackURLScheme: "articles"
        ) { [weak self] url, error in
          Task { @MainActor in
            if let error {
              self?.finish(.failure(error))
              return
            }
            guard let url else {
              self?.finish(.failure(NativeSignInFailure.invalidCallback))
              return
            }
            self?.finish(.success(url))
          }
        }
        session.prefersEphemeralWebBrowserSession = true
        session.presentationContextProvider = self
        self.session = session
        if !session.start() { finish(.failure(NativeSignInFailure.unableToPresent)) }
      }
    } onCancel: {
      Task { @MainActor [weak self] in self?.cancel() }
    }
    try Task.checkCancellation()
    guard !cancelled else { throw CancellationError() }
    let exchange = Task { try await request.exchange(callback: callback) }
    exchangeTask = exchange
    return try await withTaskCancellationHandler {
      try await exchange.value
    } onCancel: {
      exchange.cancel()
    }
  }
  public func cancel() {
    cancelled = true
    exchangeTask?.cancel()
    session?.cancel()
    finish(.failure(CancellationError()))
  }
  private func finish(_ result: Result<URL, Error>) {
    let pending = continuation
    continuation = nil
    session = nil
    pending?.resume(with: result)
  }
}
