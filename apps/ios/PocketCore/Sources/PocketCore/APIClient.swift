import Foundation

public enum APIError: LocalizedError, Sendable {
  case invalidResponse
  case server(Int, String)
  case insecureEndpoint
  public var errorDescription: String? {
    switch self {
    case .invalidResponse: "Pocket returned an unreadable response."
    case .server(_, let message): message
    case .insecureEndpoint: "Use HTTPS for your Pocket server. HTTP is available only on localhost."
    }
  }
}
public struct PocketAPI: Sendable {
  public let baseURL: URL
  private let session: URLSession
  public init(baseURL: URL, session: URLSession = .shared) throws {
    let local = ["localhost", "127.0.0.1", "::1"].contains(baseURL.host)
    guard baseURL.scheme == "https" || (baseURL.scheme == "http" && local) else {
      throw APIError.insecureEndpoint
    }
    self.baseURL = baseURL
    self.session = session
  }
  public func get<T: Decodable & Sendable>(_ path: String, token: String) async throws -> T {
    try await request(path, token: token, body: nil, idempotencyKey: nil)
  }
  public func post<T: Decodable & Sendable, B: Encodable & Sendable>(
    _ path: String, body: B, token: String, idempotencyKey: String = UUID().uuidString
  ) async throws -> T {
    try await request(
      path, token: token, body: JSONEncoder().encode(body), idempotencyKey: idempotencyKey)
  }
  private func request<T: Decodable & Sendable>(
    _ path: String, token: String, body: Data?, idempotencyKey: String?
  ) async throws -> T {
    var request = URLRequest(url: baseURL.appendingPathComponent("v1").appendingPathComponent(path))
    request.timeoutInterval = 35
    request.httpMethod = body == nil ? "GET" : "POST"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
    }
    let (data, response) = try await session.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    guard (200..<300).contains(http.statusCode) else {
      let error = try? JSONDecoder().decode(ErrorBody.self, from: data)
      throw APIError.server(
        http.statusCode, error?.error ?? "Couldn’t reach Pocket. Please try again.")
    }
    return try JSONDecoder().decode(T.self, from: data)
  }
  private struct ErrorBody: Decodable { let error: String }
}
