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
