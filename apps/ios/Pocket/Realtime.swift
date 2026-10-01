import Foundation

/// One authenticated Supabase channel per foreground session. No idle polling.
@MainActor
final class PocketRealtime {
  private var socket: URLSessionWebSocketTask?
  private var receiveTask: Task<Void, Never>?
  private var heartbeat: Task<Void, Never>?
  private(set) var connected = false
  private var reference = 0
  func start(
    url: String, key: String, token: String, onChange: @escaping @MainActor () async -> Void
  ) {
    stop()
    guard var components = URLComponents(string: url), components.scheme == "https",
      let subject = Self.subject(token)
    else { return }
    components.scheme = "wss"
    components.path = "/realtime/v1/websocket"
    components.queryItems = [.init(name: "apikey", value: key), .init(name: "vsn", value: "1.0.0")]
    guard let endpoint = components.url else { return }
    let task = URLSession.shared.webSocketTask(with: endpoint)
    socket = task
    task.resume()
    receiveTask = Task { [weak self] in
      guard let self else { return }
      do {
        try await send(
          topic: "realtime:pocket-jobs", event: "phx_join",
          payload: [
            "config": [
              "broadcast": ["self": false], "presence": ["key": ""],
              "postgres_changes": [
                [
                  "event": "*", "schema": "public", "table": "jobs",
                  "filter": "user_id=eq.\(subject)",
                ]
              ],
            ], "access_token": token,
          ])
        while !Task.isCancelled {
          let message = try await task.receive()
          let data: Data
          switch message {
          case .string(let text): data = Data(text.utf8)
          case .data(let bytes): data = bytes
          @unknown default: continue
          }
          guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let event = object["event"] as? String
          else { continue }
          if event == "phx_reply", object["topic"] as? String == "realtime:pocket-jobs",
            let payload = object["payload"] as? [String: Any],
            payload["status"] as? String == "ok"
          {
            connected = true
          }
          if event == "postgres_changes" { await onChange() }
          if event == "phx_error" || event == "phx_close" { break }
        }
      } catch { /* Active tasks fall back to bounded polling in PocketStore. */  }
      connected = false
    }
    heartbeat = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(25))
        guard !Task.isCancelled, let self else { break }
        do { try await send(topic: "phoenix", event: "heartbeat", payload: [:]) } catch {
          connected = false
          break
        }
      }
    }
  }
  func stop() {
    receiveTask?.cancel()
    heartbeat?.cancel()
    socket?.cancel(with: .goingAway, reason: nil)
    socket = nil
    receiveTask = nil
    heartbeat = nil
    connected = false
  }
  private func send(topic: String, event: String, payload: [String: Any]) async throws {
    reference += 1
    let data = try JSONSerialization.data(withJSONObject: [
      "topic": topic, "event": event, "payload": payload, "ref": String(reference),
    ])
    guard let text = String(data: data, encoding: .utf8), let socket else { return }
    try await socket.send(.string(text))
  }
  private static func subject(_ jwt: String) -> String? {
    let parts = jwt.split(separator: ".")
    guard parts.count == 3 else { return nil }
    var base64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(
      of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    guard let data = Data(base64Encoded: base64),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let sub = object["sub"] as? String, UUID(uuidString: sub) != nil
    else { return nil }
    return sub
  }
}
