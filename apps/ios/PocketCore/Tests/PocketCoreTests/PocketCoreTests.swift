import Foundation
import Testing

@testable import PocketCore

@Test func terminalStatusesDoNotPoll() {
  #expect(!JobStatus.completed.isActive)
  #expect(!JobStatus.failed.isActive)
  #expect(!JobStatus.cancelled.isActive)
  #expect(JobStatus.editing.isActive)
}
@Test func protectsRemoteCredentialsFromHTTP() throws {
  #expect(throws: APIError.self) { try PocketAPI(baseURL: URL(string: "http://example.com")!) }
  _ = try PocketAPI(baseURL: URL(string: "http://127.0.0.1:4310")!)
  _ = try PocketAPI(baseURL: URL(string: "https://pocket.example.com")!)
}
@Test func diffHeadersAreNotShownAsChanges() {
  #expect(DiffLine(id: 0, text: "+++ b/sidebar.tsx").kind == .hunk)
  #expect(DiffLine(id: 1, text: "+ const open = true;").kind == .addition)
  #expect(DiffLine(id: 2, text: "- const open = false;").kind == .deletion)
}
@Test func decodesProviderNeutralModelCatalog() throws {
  let data = Data(
    "[{\"id\":\"auto\",\"name\":\"Auto\",\"description\":\"Balanced\",\"provider\":\"router\",\"maxCostCents\":300}]"
      .utf8)
  let catalog = try JSONDecoder().decode([AgentModel].self, from: data)
  #expect(catalog.first?.id == "auto")
}

@Test func developmentNetworkRequiresExplicitOptIn() throws {
  for host in ["10.117.254.78", "172.16.1.2", "192.168.1.4", "mac.local"] {
    let url = URL(string: "http://\(host):4310")!
    #expect(throws: APIError.self) { try PocketAPI(baseURL: url) }
    _ = try PocketAPI(baseURL: url, allowDevelopmentNetwork: true)
  }
  for host in ["example.com", "8.8.8.8", "172.32.0.1", "192.169.1.4", "10.999.0.1", "10.1.foo.1.1"]
  {
    #expect(throws: APIError.self) {
      try PocketAPI(baseURL: URL(string: "http://\(host)")!, allowDevelopmentNetwork: true)
    }
  }
}

@Test func repositoryCreationKeepsPrivateVisibilityAndEscapesDescription() throws {
  let draft = RepositoryCreationDraft(
    name: " my-project ", description: "A & visibility=public / café", owner: "@me", isPrivate: true
  )
  let url = try #require(draft.githubURL)
  #expect(url.scheme == "https")
  #expect(url.host == "github.com")
  #expect(url.path == "/new")
  let query = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems)
  #expect(query.filter { $0.name == "visibility" }.count == 1)
  #expect(query.first { $0.name == "visibility" }?.value == "private")
  #expect(query.first { $0.name == "description" }?.value == draft.description)
  #expect(query.first { $0.name == "name" }?.value == "my-project")
}

@Test func repositoryCreationRejectsInvalidNamesAndLongDescriptions() {
  for name in ["", ".", "..", "a/b", "has spaces", String(repeating: "a", count: 101)] {
    #expect(
      RepositoryCreationDraft(name: name, description: "", owner: "@me", isPrivate: true).githubURL
        == nil)
  }
  #expect(
    RepositoryCreationDraft(
      name: "valid", description: String(repeating: "a", count: 351), owner: "@me", isPrivate: false
    ).githubURL == nil)
}

private final class CancelledRequestProtocol: URLProtocol, @unchecked Sendable {
  override class func canInit(with request: URLRequest) -> Bool { true }
  override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
  override func startLoading() { client?.urlProtocol(self, didFailWithError: URLError(.cancelled)) }
  override func stopLoading() {}
}

@Test func cancelledNetworkRequestsAreNormalCancellationRatherThanAnAlert() async throws {
  let configuration = URLSessionConfiguration.ephemeral
  configuration.protocolClasses = [CancelledRequestProtocol.self]
  let session = URLSession(configuration: configuration)
  defer { session.invalidateAndCancel() }
  let api = try PocketAPI(baseURL: URL(string: "https://pocket.example.com")!, session: session)
  do {
    let _: [AgentJob] = try await api.get("jobs", token: "test")
    Issue.record("Expected cancellation")
  } catch {
    #expect(error is CancellationError)
  }
}

@Test func diffTracksActualOldAndNewFileLineNumbers() {
  let file = DiffFile(
    path: "a.swift", additions: 1, deletions: 1,
    patch: "--- a/a.swift\n+++ b/a.swift\n@@ -10,2 +20,2 @@\n-old\n+new\n context")
  #expect(file.lines[0].oldLine == nil)
  #expect(file.lines[3].oldLine == 10)
  #expect(file.lines[3].newLine == nil)
  #expect(file.lines[4].newLine == 20)
  #expect(file.lines[5].oldLine == 11)
  #expect(file.lines[5].newLine == 21)
}
@Test func taskEncodesExplicitCheckpointAndImages() throws {
  let task = TaskRequest(
    projectId: "project", branch: "main", prompt: "Fix it", modelId: "auto", maxCostCents: 10,
    attachments: ["image"], baseJobId: "checkpoint")
  let value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(task)) as! [String: Any]
  #expect(value["baseJobId"] as? String == "checkpoint")
  #expect(value["attachments"] as? [String] == ["image"])
}
