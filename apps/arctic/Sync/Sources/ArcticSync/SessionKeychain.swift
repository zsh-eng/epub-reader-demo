import Foundation
import Security

/// Kept separate from the Jev key. This device-only credential is not synchronized.
public enum SessionKeychain {
  private static func query(server: URL) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "com.zsheng.ArticleReader.sync-session",
      kSecAttrAccount as String: server.absoluteString,
    ]
  }
  public static func save(_ session: ArcticSession) throws {
    let data = try JSONEncoder().encode(session)
    let base = query(server: session.server)
    let status = SecItemUpdate(
      base as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecSuccess { return }
    guard status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    var item = base
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let added = SecItemAdd(item as CFDictionary, nil)
    guard added == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(added))
    }
  }
  public static func load(server: URL) throws -> ArcticSession? {
    var item = query(server: server)
    item[kSecReturnData as String] = true
    item[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(item as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
    return try JSONDecoder().decode(ArcticSession.self, from: data)
  }
  public static func clear(server: URL) throws {
    let status = SecItemDelete(query(server: server) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
  }
}
