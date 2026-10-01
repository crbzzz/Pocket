import AuthenticationServices
import CryptoKit
import Security
import SwiftUI

struct AuthSession: Codable, Sendable {
  let access_token: String
  let refresh_token: String
  let expires_in: Int
  let provider_token: String?
  var user: AuthUser?
  var savedAt: Date?
  var expiry: Date { (savedAt ?? Date()).addingTimeInterval(Double(expires_in)) }
}
struct AuthUser: Codable, Sendable {
  let email: String?
  let user_metadata: Metadata?
  struct Metadata: Codable, Sendable {
    let user_name: String?
    let preferred_username: String?
  }
  var displayName: String {
    user_metadata?.user_name ?? user_metadata?.preferred_username ?? email ?? "GitHub"
  }
}
enum SessionVault {
  static let service = "app.pocket.session"
  static func read() -> AuthSession? {
    var result: CFTypeRef?
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "supabase", kSecReturnData as String: true,
    ]
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return try? JSONDecoder().decode(AuthSession.self, from: data)
  }
  static func save(_ session: AuthSession) throws {
    let data = try JSONEncoder().encode(session)
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service,
      kSecAttrAccount as String: "supabase",
    ]
    SecItemDelete(query as CFDictionary)
    var item = query
    item[kSecValueData as String] = data
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw AuthFailure.keychain }
  }
  static func clear() {
    SecItemDelete(
      [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        as CFDictionary)
  }
}
enum AuthFailure: LocalizedError {
  case configuration, callback, keychain, rejected
  case provider(String)
  var errorDescription: String? {
    switch self {
    case .configuration: "GitHub sign-in is not configured for this build."
    case .provider(let message): message
    case .callback: "GitHub sign-in did not return an authorization code."
    case .keychain: "Couldn’t securely save your session."
    case .rejected: "Sign-in failed. Please try again."
    }
  }
}
@MainActor @Observable
final class PocketAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
  @ObservationIgnored private var webSession: ASWebAuthenticationSession?
  var session: AuthSession? = SessionVault.read()
  var supabaseURL: String {
    Bundle.main.object(forInfoDictionaryKey: "SupabaseURL") as? String ?? ""
  }
  var publicKey: String {
    Bundle.main.object(forInfoDictionaryKey: "SupabasePublishableKey") as? String ?? ""
  }
  func signIn() async throws {
    guard let base = URL(string: supabaseURL), base.scheme == "https", !publicKey.isEmpty else {
      throw AuthFailure.configuration
    }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
      throw AuthFailure.rejected
    }
    let verifier = Data(bytes).base64URLEncoded
    let challenge = Data(SHA256.hash(data: Data(verifier.utf8))).base64URLEncoded
    var url = URLComponents(
      url: base.appendingPathComponent("auth/v1/authorize"), resolvingAgainstBaseURL: false)!
    url.queryItems = [
      URLQueryItem(name: "provider", value: "github"),
      URLQueryItem(name: "redirect_to", value: "pocket://auth-callback"),
      URLQueryItem(name: "code_challenge", value: challenge),
      URLQueryItem(name: "code_challenge_method", value: "s256"),
    ]
    let callback: URL = try await withCheckedThrowingContinuation { continuation in
      webSession = ASWebAuthenticationSession(url: url.url!, callbackURLScheme: "pocket") {
        callback, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let callback {
          continuation.resume(returning: callback)
        } else {
          continuation.resume(throwing: AuthFailure.callback)
        }
      }
      webSession?.presentationContextProvider = self
      if webSession?.start() != true { continuation.resume(throwing: AuthFailure.rejected) }
    }
    defer { webSession = nil }
    let parameters = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    if let message = parameters.first(where: { $0.name == "error_description" })?.value {
      throw AuthFailure.provider(message)
    }
    guard let code = parameters.first(where: { $0.name == "code" })?.value else {
      throw AuthFailure.callback
    }
    session = try await exchange(
      grant: "pkce", body: ["auth_code": code, "code_verifier": verifier])
    try SessionVault.save(session!)
  }
  func token() async throws -> String {
    guard let current = session else { throw AuthFailure.rejected }
    if current.expiry.timeIntervalSinceNow < 60 {
      let renewed = try await exchange(
        grant: "refresh_token", body: ["refresh_token": current.refresh_token])
      session = AuthSession(
        access_token: renewed.access_token, refresh_token: renewed.refresh_token,
        expires_in: renewed.expires_in,
        provider_token: renewed.provider_token ?? current.provider_token,
        user: renewed.user ?? current.user, savedAt: Date())
      try SessionVault.save(session!)
    }
    return session!.access_token
  }
  private func exchange(grant: String, body: [String: String]) async throws -> AuthSession {
    guard let url = URL(string: "\(supabaseURL)/auth/v1/token?grant_type=\(grant)") else {
      throw AuthFailure.configuration
    }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue(publicKey, forHTTPHeaderField: "apikey")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(body)
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
      struct AuthError: Decodable {
        let msg: String?
        let error_description: String?
      }
      if let failure = try? JSONDecoder().decode(AuthError.self, from: data),
        let message = failure.msg ?? failure.error_description
      {
        throw AuthFailure.provider(message)
      }
      throw AuthFailure.rejected
    }
    var result = try JSONDecoder().decode(AuthSession.self, from: data)
    result.savedAt = Date()
    return result
  }
  func authorizeGitHubApp(_ url: URL) async throws {
    let callback: URL = try await withCheckedThrowingContinuation { continuation in
      webSession = ASWebAuthenticationSession(url: url, callbackURLScheme: "pocket") {
        callback, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let callback {
          continuation.resume(returning: callback)
        } else {
          continuation.resume(throwing: AuthFailure.callback)
        }
      }
      webSession?.presentationContextProvider = self
      if webSession?.start() != true { continuation.resume(throwing: AuthFailure.rejected) }
    }
    defer { webSession = nil }
    guard
      URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: {
        $0.name == "success" && $0.value == "true"
      }) == true
    else { throw AuthFailure.rejected }
  }
  func signOut() async {
    if let token = session?.access_token, let url = URL(string: "\(supabaseURL)/auth/v1/logout") {
      var request = URLRequest(url: url)
      request.httpMethod = "POST"
      request.setValue(publicKey, forHTTPHeaderField: "apikey")
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      _ = try? await URLSession.shared.data(for: request)
    }
    session = nil
    SessionVault.clear()
  }
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
      .first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
}
extension Data {
  fileprivate var base64URLEncoded: String {
    base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(
      of: "/", with: "_"
    ).replacingOccurrences(of: "=", with: "")
  }
}
