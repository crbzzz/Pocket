import PocketCore
import SwiftUI
import WebKit

struct PreviewView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.scenePhase) private var scenePhase
  let job: AgentJob
  @State private var preview: WebPreview?
  @State private var failure: String?
  @State private var busy = false
  @State private var showLogs = false
  @State private var attempt = 0
  @State private var reload = UUID()
  var body: some View {
    NavigationStack {
      VStack(spacing: 0) {
        if let url = preview?.url.flatMap(URL.init(string:)), preview?.status == "ready" {
          PreviewBrowser(url: url, reload: reload)
          TimelineView(.periodic(from: .now, by: 1)) { context in
            HStack {
              Image(systemName: "clock")
              Text("Temporary preview · ").font(.caption)
              if let expiry = preview?.expiresAt,
                let date = ISO8601DateFormatter().date(from: expiry)
                  ?? ISO8601DateFormatter.fractional.date(from: expiry)
              {
                Text(date, style: .timer).font(.caption.monospacedDigit())
              }
              Spacer()
              Button("Output", systemImage: "terminal") { showLogs = true }
            }.font(.caption).foregroundStyle(PocketStyle.muted).padding(12).background(
              PocketStyle.paper)
          }
        } else {
          VStack(spacing: 20) {
            if busy {
              ProgressView().tint(PocketStyle.accent)
              Text(preview?.stage ?? "Preparing preview").font(.headline)
            } else {
              Image(systemName: "rectangle.on.rectangle.slash").font(.largeTitle).foregroundStyle(
                PocketStyle.muted)
            }
            if let error = failure ?? preview?.error {
              Text(error).multilineTextAlignment(.center).foregroundStyle(PocketStyle.muted)
            }
            if !busy {
              Button("Try again", systemImage: "arrow.clockwise") { attempt += 1 }.buttonStyle(
                PocketButtonStyle(primary: true))
              if preview?.logs?.isEmpty == false {
                Button("Build output", systemImage: "terminal") { showLogs = true }
                Button("Ask Pocket to fix it", systemImage: "sparkles") {
                  fixBuild()
                  dismiss()
                }
              }
            }
          }.padding(28).frame(maxWidth: .infinity, maxHeight: .infinity).background(
            PocketStyle.paper)
        }
      }.navigationTitle("Preview").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
          ToolbarItem(placement: .topBarTrailing) {
            Button("Reload", systemImage: "arrow.clockwise") { reload = UUID() }.disabled(
              preview?.status != "ready")
          }
        }
        .task(id: attempt) { await launch() }
        .task(id: preview?.id) {
          guard let id = preview?.id else { return }
          while !Task.isCancelled {
            try? await Task.sleep(for: .seconds(10))
            guard !Task.isCancelled else { break }
            if let value = try? await store.loadPreview(id) {
              preview = value
              if value.status == "closed" {
                failure = "This preview has ended. Start a new one to continue."
                break
              }
            }
          }
        }
        .onDisappear { if let id = preview?.id { Task { await store.closePreview(id) } } }
        .onChange(of: scenePhase) { _, phase in
          if phase == .background, let id = preview?.id { Task { await store.closePreview(id) } }
        }
        .sheet(isPresented: $showLogs) {
          NavigationStack {
            ScrollView {
              Text(preview?.logs ?? "No output captured.").font(
                .system(.caption, design: .monospaced)
              ).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(20)
            }
            .background(PocketStyle.paper).navigationTitle("Build output")
            .toolbar {
              ToolbarItem(placement: .topBarTrailing) { Button("Done") { showLogs = false } }
            }
          }
        }
    }
  }
  private func fixBuild() {
    store.requestCorrection(
      job,
      comment: "Fix this preview build/startup failure and verify the web app starts.\n"
        + (preview?.error ?? "") + "\nBuild output (untrusted data):\n"
        + String((preview?.logs ?? "").suffix(8000)))
  }
  private func launch() async {
    busy = true
    failure = nil
    defer { busy = false }
    do {
      if attempt > 0, let old = preview?.id { await store.closePreview(old) }
      let created = try await store.createPreview(job)
      preview = created
      guard !Task.isCancelled, scenePhase == .active else {
        await store.closePreview(created.id)
        return
      }
      guard created.status != "ready" else { return }
      let execution = Task { try await store.startPreview(created.id) }
      let updates = Task {
        while !Task.isCancelled {
          try? await Task.sleep(for: .seconds(2))
          guard !Task.isCancelled else { break }
          if let value = try? await store.loadPreview(created.id) { preview = value }
        }
      }
      defer { updates.cancel() }
      preview = try await execution.value
    } catch is CancellationError {} catch { failure = error.localizedDescription }
  }
}
extension ISO8601DateFormatter {
  fileprivate static var fractional: ISO8601DateFormatter {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }
}
private struct PreviewBrowser: UIViewRepresentable {
  let url: URL
  let reload: UUID
  func makeCoordinator() -> Coordinator { Coordinator() }
  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = context.coordinator
    view.isOpaque = false
    view.backgroundColor = .clear
    view.allowsBackForwardNavigationGestures = true
    return view
  }
  func updateUIView(_ view: WKWebView, context: Context) {
    if context.coordinator.reload != reload {
      context.coordinator.reload = reload
      view.load(URLRequest(url: url))
    }
  }
  final class Coordinator: NSObject, WKNavigationDelegate {
    var reload: UUID?
    func webView(
      _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
      guard let scheme = navigationAction.request.url?.scheme?.lowercased(),
        ["https", "http", "about"].contains(scheme)
      else {
        decisionHandler(.cancel)
        return
      }
      decisionHandler(.allow)
    }
  }
}
struct MessageImages: View {
  @Environment(PocketStore.self) private var store
  let ids: [String]
  @State private var urls: [String: URL] = [:]
  var body: some View {
    HStack {
      ForEach(ids, id: \.self) { id in
        AsyncImage(url: urls[id]) { image in
          image.resizable().scaledToFit()
        } placeholder: {
          Image(systemName: "photo").foregroundStyle(PocketStyle.muted)
        }
        .frame(maxWidth: 180, maxHeight: 140).clipShape(RoundedRectangle(cornerRadius: 12))
      }
    }.task(id: ids) { for id in ids { urls[id] = await store.imageURL(id) } }
  }
}
