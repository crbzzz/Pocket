import Foundation

public enum APIError: LocalizedError, Sendable {
  case invalidResponse
  case server(Int, String)
  case insecureEndpoint
  case unreachable(String)
  public var errorDescription: String? {
    switch self {
    case .invalidResponse: "Pocket returned an unreadable response."
    case .server(_, let message): message
    case .insecureEndpoint: "Use HTTPS for your Pocket server."
    case .unreachable:
      "Connection interrupted. Please try again."
    }
  }
}
public struct PocketAPI: Sendable {
  public let baseURL: URL
  private let session: URLSession
  public init(baseURL: URL, session: URLSession = .shared, allowDevelopmentNetwork: Bool = false)
    throws
  {
    let local = ["localhost", "127.0.0.1", "::1"].contains(baseURL.host)
    let development = allowDevelopmentNetwork && Self.isDevelopmentHost(baseURL.host ?? "")
    guard baseURL.scheme == "https" || (baseURL.scheme == "http" && (local || development)) else {
      throw APIError.insecureEndpoint
    }
    self.baseURL = baseURL
    self.session = session
  }
  private static func isDevelopmentHost(_ host: String) -> Bool {
    if host.lowercased().hasSuffix(".local") { return true }
    let components = host.split(separator: ".", omittingEmptySubsequences: false)
    guard components.count == 4,
      components.allSatisfy({ !$0.isEmpty && $0.allSatisfy({ $0.isASCII && $0.isNumber }) })
    else { return false }
    let parts = components.compactMap { Int($0) }
    guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else { return false }
    return parts[0] == 10 || (parts[0] == 172 && (16...31).contains(parts[1]))
      || (parts[0] == 192 && parts[1] == 168)
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
  public func startJob(_ id: String, token: String) async throws -> AgentJob {
    try await request(
      "jobs/\(id)/start", token: token, body: Data("{}".utf8), idempotencyKey: nil, timeout: 240)
  }
  public func streamJob(_ id: String, token: String, onReply: @Sendable (String) async -> Void)
    async throws -> AgentJob
  {
    var request = URLRequest(url: baseURL.appendingPathComponent("v1/jobs/\(id)/start"))
    request.httpMethod = "POST"
    request.httpBody = Data("{}".utf8)
    request.timeoutInterval = 240
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    let (bytes, response) = try await session.bytes(for: request)
    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    guard (200..<300).contains(http.statusCode) else {
      throw APIError.server(http.statusCode, "Couldn't start the response. Try again.")
    }
    if http.value(forHTTPHeaderField: "Content-Type")?.contains("text/event-stream") != true {
      var data = Data()
      for try await byte in bytes {
        data.append(byte)
        if data.count > 2_000_000 { throw APIError.invalidResponse }
      }
      return try JSONDecoder().decode(AgentJob.self, from: data)
    }
    for try await line in bytes.lines {
      guard line.hasPrefix("data: ") else { continue }
      let event = try JSONDecoder().decode(ReplyEvent.self, from: Data(line.dropFirst(6).utf8))
      if event.type == "error" { throw APIError.server(502, event.error ?? "Response interrupted") }
      if let text = event.text, event.type == "reply" { await onReply(text) }
      if let job = event.job, event.type == "done" { return job }
    }
    throw APIError.unreachable(baseURL.absoluteString)
  }
  public func startPreview(_ id: String, token: String) async throws -> WebPreview {
    try await request(
      "previews/\(id)/start", token: token, body: Data("{}".utf8), idempotencyKey: nil, timeout: 300
    )
  }
  private struct ReplyEvent: Decodable {
    let type: String
    let text: String?
    let job: AgentJob?
    let error: String?
  }
  public func delete<T: Decodable & Sendable>(_ path: String, token: String) async throws -> T {
    try await request(path, token: token, body: nil, idempotencyKey: nil, method: "DELETE")
  }
  private func request<T: Decodable & Sendable>(
    _ path: String, token: String, body: Data?, idempotencyKey: String?, method: String? = nil,
    timeout: TimeInterval = 35
  ) async throws -> T {
    var request = URLRequest(url: baseURL.appendingPathComponent("v1").appendingPathComponent(path))
    request.timeoutInterval = timeout
    request.httpMethod = method ?? (body == nil ? "GET" : "POST")
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.httpBody = body
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key")
    }
    let data: Data
    let response: URLResponse
    do {
      (data, response) = try await session.data(for: request)
    } catch let error as URLError where error.code == .cancelled {
      throw CancellationError()
    } catch let error as URLError
      where [.cannotConnectToHost, .cannotFindHost, .notConnectedToInternet, .timedOut].contains(
        error.code)
    {
      throw APIError.unreachable(baseURL.absoluteString)
    }
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
