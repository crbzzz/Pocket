import AuthenticationServices
import PocketCore
import SwiftUI
import UserNotifications

@MainActor @Observable
final class PocketStore {
  enum Tab: String, CaseIterable { case projects, chat, changes, saves, agents, settings }
  var tab: Tab = .chat
  var projects: [Project] = []
  var jobs: [AgentJob] = []
  var models: [AgentModel] = []
  var saves: [PocketSave] = []
  var selectedProjectId: String? = UserDefaults.standard.string(forKey: "selectedProjectId")
  var selectedJobId: String?
  var modelId = UserDefaults.standard.string(forKey: "modelId") ?? "auto"
  var draft = ""
  var configuration: APIConfiguration?
  var isLoading = false
  var isSending = false
  var error: String?
  var connectionError: String?
  var isSigningIn = false
  var demoEntered = false
  struct GitHubInstallation: Decodable, Identifiable, Sendable {
    let id: Int
    let account: String
  }
  var installations: [GitHubInstallation] = []
  var isSyncing = false
  var isDiscoveringRepositories = false
  var repositoryError: String?
  var showSettings = false
  var isComposing = false
  var newConversation = false
  var accountName: String { auth.session?.user?.displayName ?? "GitHub" }
  var notice: String?
  var apiURL = PocketStore.initialAPIURL()
  private static func initialAPIURL() -> String {
    let saved = UserDefaults.standard.string(forKey: "apiURL")
    let configured = Bundle.main.object(forInfoDictionaryKey: "PocketAPIURL") as? String
    if let configured, !configured.isEmpty, !configured.contains("$(") {
      // Migrate stale development IP addresses after a rebuild or cloud deployment.
      if saved == nil || URL(string: saved ?? "")?.scheme == "http" { return configured }
    }
    return saved ?? "http://127.0.0.1:4310"
  }
  private static func initialDemoMode() -> Bool {
    if Bundle.main.object(forInfoDictionaryKey: "PocketBackendMode") as? String == "production" {
      return false
    }
    return UserDefaults.standard.object(forKey: "demoMode") as? Bool ?? true
  }
  var demoMode = PocketStore.initialDemoMode()
  var notifications = UserDefaults.standard.bool(forKey: "notifications")
  var maxCostCents = UserDefaults.standard.object(forKey: "budget") as? Int ?? 300
  private var polling: Task<Void, Never>?
  private var refreshing = false
  let auth = PocketAuth()
  private let realtime = PocketRealtime()
  var signedIn: Bool { auth.session != nil }
  var project: Project? { projects.first { $0.id == selectedProjectId } ?? projects.first }
  var projectJobs: [AgentJob] {
    jobs.filter { $0.projectId == project?.id && $0.branch == project?.branch }
  }
  var currentJob: AgentJob? {
    newConversation ? nil : (projectJobs.first { $0.id == selectedJobId } ?? projectJobs.first)
  }
  var api: PocketAPI {
    get throws {
      guard let url = URL(string: apiURL), url.host != nil else {
        throw APIError.insecureEndpoint
      }
      #if DEBUG
        return try PocketAPI(baseURL: url, allowDevelopmentNetwork: demoMode)
      #else
        return try PocketAPI(baseURL: url)
      #endif
    }
  }
  private func token() async throws -> String {
    demoMode ? "pocket-local-demo" : try await auth.token()
  }
  func load() async {
    guard !isLoading else { return }
    isLoading = true
    defer { isLoading = false }
    do {
      let token = try await token()
      let client = try api
      async let p: [Project] = client.get("projects", token: token)
      async let j: [AgentJob] = client.get("jobs", token: token)
      async let m: [AgentModel] = client.get("models", token: token)
      async let c: APIConfiguration = client.get("config", token: token)
      (projects, jobs, models, configuration) = try await (p, j, m, c)
      connectionError = nil
      selectedProjectId = project?.id
      if !models.contains(where: { $0.id == modelId }) { modelId = models.first?.id ?? "auto" }
      await loadSaves()
      if !demoMode && projects.isEmpty { await syncRepositories() }
      startPolling()
    } catch APIError.unreachable(let endpoint) {
      connectionError = "API unavailable: \(endpoint)"
    } catch { self.error = error.localizedDescription }
  }
  func select(_ project: Project) {
    selectedProjectId = project.id
    selectedJobId = nil
    UserDefaults.standard.set(project.id, forKey: "selectedProjectId")
    Task {
      await loadSaves()
      guard !demoMode else { return }
      do {
        let branches: [String] = try await api.get("projects/\(project.id)/branches", token: token())
        if let index = projects.firstIndex(where: { $0.id == project.id }) { projects[index].branches = branches }
      } catch { self.error = error.localizedDescription }
    }
  }
  func selectJob(_ job: AgentJob, tab: Tab) {
    newConversation = false
    selectedProjectId = job.projectId
    selectedJobId = job.id
    branch(job.branch)
    self.tab = tab
    Task { await loadSaves() }
  }
  func branch(_ branch: String) {
    if let index = projects.firstIndex(where: { $0.id == project?.id }) {
      projects[index].branch = branch
    }
  }
  func send() async {
    guard !isSending, let project, draft.trimmingCharacters(in: .whitespacesAndNewlines).count >= 3
    else { return }
    isSending = true
    defer { isSending = false }
    do {
      let token = try await token()
      let request = TaskRequest(
        projectId: project.id, branch: project.branch, prompt: draft, modelId: modelId,
        maxCostCents: maxCostCents)
      let job: AgentJob = try await api.post("jobs", body: request, token: token)
      newConversation = false
      jobs.insert(job, at: 0)
      selectedJobId = job.id
      draft = ""
      tab = .chat
      startPolling()
    } catch { self.error = error.localizedDescription }
  }
  func cancel(_ job: AgentJob) async {
    do {
      let updated: AgentJob = try await api.post(
        "jobs/\(job.id)/cancel", body: [String: String](), token: token())
      if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index] = updated }
    } catch { self.error = error.localizedDescription }
  }
  func deleteActivity(_ job: AgentJob) async {
    struct Result: Decodable, Sendable { let deleted: Bool }
    do {
      let _: Result = try await api.delete("jobs/\(job.id)", token: token())
      jobs.removeAll { $0.id == job.id }
      if selectedJobId == job.id { selectedJobId = nil; newConversation = true }
    } catch { self.error = error.localizedDescription }
  }
  func deleteCheckpoint(_ save: PocketSave) async {
    struct Result: Decodable, Sendable { let deleted: Bool }
    do {
      let _: Result = try await api.delete("projects/\(save.projectId)/saves/\(save.id)", token: token())
      saves.removeAll { $0.id == save.id }
      await load()
    } catch { self.error = error.localizedDescription }
  }
  func loadSaves() async {
    guard let project else {
      saves = []
      return
    }
    do {
      let result: [PocketSave] = try await api.get("projects/\(project.id)/saves", token: token())
      if self.project?.id == project.id { saves = result }
    } catch {
      self.error = error.localizedDescription
    }
  }
  func loadDiff() async {
    guard let job = currentJob else { return }
    do {
      let full: AgentJob = try await api.get("jobs/\(job.id)", token: token())
      if let index = jobs.firstIndex(where: { $0.id == job.id }) { jobs[index] = full }
    } catch { self.error = error.localizedDescription }
  }
  func restore(_ save: PocketSave) async {
    do {
      let p: Project = try await api.post(
        "projects/\(save.projectId)/restore",
        body: ["saveId": save.id, "branch": project?.branch ?? "main"], token: token())
      if let index = projects.firstIndex(where: { $0.id == p.id }) { projects[index] = p }
      notice = "Save #\(save.number) selected for your next task."
    } catch { self.error = error.localizedDescription }
  }
  func ship(kind: String, title: String, key: String) async -> ShipResult? {
    guard let job = currentJob else { return nil }
    struct Approval: Encodable, Sendable {
      let kind: String
      let title: String
      let approved = true
    }
    do {
      let result: ShipResult = try await api.post(
        "jobs/\(job.id)/ship", body: Approval(kind: kind, title: title), token: token(),
        idempotencyKey: key)
      notice = result.message ?? "Your branch is ready on GitHub."
      return result
    } catch {
      self.error = error.localizedDescription
      return nil
    }
  }
  func signIn() async {
    guard !isSigningIn else { return }
    isSigningIn = true
    defer { isSigningIn = false }
    do {
      try await auth.signIn()
      tab = .chat
      // Identity sign-in works independently of the demo API. Never expose real
      // account tokens to the development HTTP endpoint.

    } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
      // Closing the browser leaves the current account unchanged.
    } catch { self.error = error.localizedDescription }
  }
  var isConnectingGitHub = false
  func chooseRepositories() async {
    guard !isConnectingGitHub,
      let address = configuration?.githubAppUrl, let url = URL(string: address),
      url.scheme == "https", url.host == "github.com" else { return }
    isConnectingGitHub = true
    defer { isConnectingGitHub = false }
    do {
      try await auth.authorizeGitHubApp(url)
      await loadInstallations()
      for installation in installations { await connect(installationId: installation.id) }
    } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
      await loadInstallations()
      for installation in installations { await connect(installationId: installation.id) }
    } catch { self.error = error.localizedDescription }
  }
  func authorizeGitHub() async {
    struct Link: Decodable, Sendable { let url: String }
    do {
      let link: Link = try await api.get("github/authorize", token: token())
      guard let url = URL(string: link.url), url.scheme == "https", url.host == "github.com" else {
        throw AuthFailure.rejected
      }
      try await auth.authorizeGitHubApp(url)
      await loadInstallations()
      for installation in installations { await connect(installationId: installation.id) }

    } catch let failure as ASWebAuthenticationSessionError where failure.code == .canceledLogin {
      // Closing authorization leaves repository access unchanged.
    } catch { self.error = error.localizedDescription }
  }
  func syncRepositories() async {
    guard !isDiscoveringRepositories else { return }
    if !signedIn { await signIn(); return }
    if demoMode { showSettings = true; return }
    isDiscoveringRepositories = true
    defer { isDiscoveringRepositories = false }
    await loadInstallations()
    guard repositoryError == nil else { return }
    if installations.isEmpty { showSettings = true; return }
    for installation in installations {
      await connect(installationId: installation.id)
      if repositoryError != nil { break }
    }
  }
  func loadInstallations() async {
    guard signedIn && !demoMode else { return }
    do {
      installations = try await api.get("github/installations", token: token())
      repositoryError = nil
    } catch APIError.server(let status, _) where status == 401 {
      installations = []
      repositoryError = "Sign in again to refresh GitHub access."
      self.error = repositoryError
    } catch {
      repositoryError = "Couldn't refresh GitHub access. Try again."
      self.error = error.localizedDescription
    }
  }
  func connect(installationId: Int) async {
    guard !isSyncing else { return }
    isSyncing = true
    defer { isSyncing = false }
    struct Connect: Encodable, Sendable { let installationId: Int }
    do {
      projects = try await api.post(
        "github/connect", body: Connect(installationId: installationId),
        token: token())
      selectedProjectId = project?.id
      repositoryError = nil
    } catch {
      repositoryError = "Couldn't sync your repositories. Try again."
      self.error = error.localizedDescription
    }
  }
  func signOut() async {
    stopPolling()
    await auth.signOut()
    projects = []
    jobs = []
    saves = []
    selectedJobId = nil
    configuration = nil
    installations = []
    demoEntered = false
    connectionError = nil
  }
  func savePreferences() {
    UserDefaults.standard.set(apiURL, forKey: "apiURL")
    UserDefaults.standard.set(demoMode, forKey: "demoMode")
    UserDefaults.standard.set(modelId, forKey: "modelId")
    UserDefaults.standard.set(maxCostCents, forKey: "budget")
  }
  func enableNotifications(_ enabled: Bool) async {
    if enabled {
      notifications =
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [
          .alert, .sound,
        ])) == true
    } else {
      notifications = false
    }
    UserDefaults.standard.set(notifications, forKey: "notifications")
  }
  func startPolling() {
    if !demoMode && jobs.contains(where: { $0.status.isActive }) && !realtime.connected {
      Task { await connectRealtime() }
    }
    guard polling == nil else { return }
    polling = Task { [weak self] in
      while !Task.isCancelled {
        try? await Task.sleep(for: .seconds(2))
        guard !Task.isCancelled, let self else { break }
        // No network polling for idle users. Reload on foreground to recover completed cloud work.
        if self.jobs.contains(where: { $0.status.isActive }) && !self.realtime.connected {
          await self.refresh()
        }
      }
    }
    Task { await refresh() }
  }
  private func connectRealtime() async {
    guard !demoMode, jobs.contains(where: { $0.status.isActive }),
      let token = try? await auth.token()
    else { return }
    realtime.start(url: auth.supabaseURL, key: auth.publicKey, token: token) { [weak self] in
      await self?.refresh()
    }
  }

  func stopPolling() {
    polling?.cancel()
    polling = nil
    realtime.stop()
  }
  private func refresh() async {
    guard !refreshing, !isLoading, demoMode || signedIn else { return }
    refreshing = true
    defer { refreshing = false }
    do {
      let updated: [AgentJob] = try await api.get("jobs", token: token())
      let finished = updated.filter { j in
        j.status == .completed && jobs.contains(where: { $0.id == j.id && $0.status.isActive })
      }
      jobs = updated.map { job in
        if let old = jobs.first(where: { $0.id == job.id && $0.updatedAt == job.updatedAt }),
          old.report?.files.contains(where: { !$0.patch.isEmpty }) == true
        {
          return old
        }
        return job
      }
      if !jobs.contains(where: { $0.status.isActive }) { realtime.stop() }
      if !finished.isEmpty {
        await loadSaves()
        projects = try await api.get("projects", token: token())
        if notifications {
          let content = UNMutableNotificationContent()
          content.title = "Pocket finished your task."
          content.body = "Your changes are ready to review."
          content.sound = .default
          try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: finished[0].id, content: content, trigger: nil))
        }
      }
    } catch {
      if jobs.contains(where: { $0.status.isActive }) { self.error = error.localizedDescription }
    }
  }
}
