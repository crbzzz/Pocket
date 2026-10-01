import Foundation

public struct ProjectMemory: Codable, Sendable, Equatable {
  public let stack: [String]
  public let objective: String
  public let decisions: [String]
  public let recentWork: [String]
}
public struct Project: Codable, Identifiable, Sendable, Equatable {
  public let id: String
  public let name: String
  public let owner: String
  public let description: String
  public let language: String
  public let color: String
  public var branch: String
  public let branches: [String]
  public let memory: ProjectMemory
  public let updatedAt: String
}
public struct AgentModel: Codable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let description: String
  public let provider: String
  public let maxCostCents: Int
}
public enum JobStatus: String, Codable, Sendable, CaseIterable {
  case queued, analyzing, planning, editing, testing, completed, failed, cancelled
  public var isActive: Bool { ![.completed, .failed, .cancelled].contains(self) }
  public var label: String {
    switch self {
    case .queued: "Queued"
    case .analyzing: "Analyzing repository"
    case .planning: "Planning changes"
    case .editing: "Editing files"
    case .testing: "Running checks"
    case .completed: "Ready for review"
    case .failed: "Needs attention"
    case .cancelled: "Cancelled"
    }
  }
}
public struct DiffFile: Codable, Identifiable, Sendable {
  public var id: String { path }
  public let path: String
  public let additions: Int
  public let deletions: Int
  public let patch: String
  public var lines: [DiffLine] {
    patch.components(separatedBy: "\n").enumerated().map {
      DiffLine(id: $0.offset, text: $0.element)
    }
  }
}
public struct DiffLine: Identifiable, Sendable {
  public let id: Int
  public let text: String
  public enum Kind: Sendable { case addition, deletion, hunk, context }
  public var kind: Kind {
    if text.hasPrefix("+++") || text.hasPrefix("---") { return .hunk }
    if text.hasPrefix("+") { return .addition }
    if text.hasPrefix("-") { return .deletion }
    if text.hasPrefix("@@") || text.hasPrefix("diff ") { return .hunk }
    return .context
  }
}
public struct Check: Codable, Identifiable, Sendable {
  public var id: String { name + detail }
  public let name: String
  public let status: String
  public let detail: String
}
public struct AgentReport: Codable, Sendable {
  public let summary: String
  public let files: [DiffFile]
  public let checks: [Check]
  public let snapshotRef: String
  public let baseRef: String
  public let costCents: Int
  public var additions: Int { files.reduce(0) { $0 + $1.additions } }
  public var deletions: Int { files.reduce(0) { $0 + $1.deletions } }
  public var canShip: Bool { !checks.contains { $0.status == "failed" } }
}
public struct AgentJob: Codable, Identifiable, Sendable {
  public let id: String
  public let projectId: String
  public let branch: String
  public let prompt: String
  public let modelId: String
  public let status: JobStatus
  public let maxCostCents: Int
  public let createdAt: String
  public let updatedAt: String
  public let report: AgentReport?
  public let error: String?
  public let demo: Bool
}
public struct PocketSave: Codable, Identifiable, Sendable {
  public let id: String
  public let projectId: String
  public let jobId: String
  public let number: Int
  public let title: String
  public let snapshotRef: String
  public let createdAt: String
}
public struct APIConfiguration: Codable, Sendable {
  public let demo: Bool
  public let githubAppUrl: String?
}
public struct ShipResult: Codable, Sendable {
  public let branch: String
  public let url: String?
  public let message: String?
  public let demo: Bool
}
public struct TaskRequest: Encodable, Sendable {
  public let projectId: String
  public let branch: String
  public let prompt: String
  public let modelId: String
  public let maxCostCents: Int
  public init(projectId: String, branch: String, prompt: String, modelId: String, maxCostCents: Int)
  {
    self.projectId = projectId
    self.branch = branch
    self.prompt = prompt
    self.modelId = modelId
    self.maxCostCents = maxCostCents
  }
}
