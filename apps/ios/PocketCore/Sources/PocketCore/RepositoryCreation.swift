import Foundation

public struct RepositoryCreationDraft: Sendable {
  public let name: String
  public let description: String
  public let owner: String
  public let isPrivate: Bool

  public init(name: String, description: String, owner: String, isPrivate: Bool) {
    self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    self.description = description.trimmingCharacters(in: .whitespacesAndNewlines)
    self.owner = owner
    self.isPrivate = isPrivate
  }
  public var isValid: Bool {
    !name.isEmpty && name.count <= 100 && name != "." && name != ".."
      && name.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil
      && description.count <= 350
  }
  public var githubURL: URL? {
    guard isValid else { return nil }
    var url = URLComponents(string: "https://github.com/new")!
    url.queryItems = [
      URLQueryItem(name: "owner", value: owner),
      URLQueryItem(name: "name", value: name),
      URLQueryItem(name: "description", value: description),
      URLQueryItem(name: "visibility", value: isPrivate ? "private" : "public"),
    ]
    return url.url
  }
}
