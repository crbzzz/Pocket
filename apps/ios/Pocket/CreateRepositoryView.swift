import PocketCore
import SafariServices
import SwiftUI

struct CreateRepositoryView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @State private var name = ""
  @State private var description = ""
  @State private var owner = ""
  @State private var isPrivate = true
  @State private var browser: CreationLink?
  @State private var submitted: RepositoryCreationDraft?
  @State private var checking = false
  @State private var status: String?
  @FocusState private var editingName: Bool

  private var owners: [String] {
    let account = store.accountName.contains("@") ? "@me" : store.accountName
    return Array(Set([account] + store.installations.map(\.account))).sorted()
  }
  private var draft: RepositoryCreationDraft {
    RepositoryCreationDraft(
      name: name, description: description,
      owner: owner.isEmpty ? owners.first ?? "@me" : owner, isPrivate: isPrivate)
  }
  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Owner", selection: $owner) {
            ForEach(owners, id: \.self) { Text($0 == "@me" ? "My GitHub account" : $0).tag($0) }
          }
          TextField("Repository name", text: $name)
            .textInputAutocapitalization(.never).autocorrectionDisabled().focused($editingName)
          TextField("Description (optional)", text: $description, axis: .vertical).lineLimit(2...4)
          Picker("Visibility", selection: $isPrivate) {
            Label("Private", systemImage: "lock").tag(true)
            Label("Public", systemImage: "globe").tag(false)
          }
        } footer: {
          Text("Confirm the creation on GitHub. Add a README there to start coding immediately.")
        }
        Section {
          Button {
            guard let url = draft.githubURL else { return }
            submitted = draft
            status = nil
            browser = CreationLink(url: url)
          } label: {
            Label("Create on GitHub", systemImage: "plus")
              .frame(maxWidth: .infinity, alignment: .center)
          }.disabled(!draft.isValid || checking || store.isConnectingGitHub)
        }
        if submitted != nil {
          Section {
            if checking {
              HStack {
                ProgressView()
                Text("Looking for your repository…")
              }
            }
            if let status { Text(status).font(.subheadline).foregroundStyle(PocketStyle.muted) }
            Button {
              Task {
                await store.chooseRepositories()
                await findRepository()
              }
            } label: {
              Label("Allow Pocket access", systemImage: "lock.open")
            }.disabled(
              checking || store.isConnectingGitHub || store.configuration?.githubAppUrl == nil)
            Button("Refresh repositories", systemImage: "arrow.clockwise") {
              Task { await findRepository() }
            }.disabled(checking || store.isConnectingGitHub)
          }
        }
      }.scrollContentBackground(.hidden).background(PocketStyle.paper)
        .navigationTitle("New repository").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        }
        .tint(PocketStyle.accent)
        .onAppear {
          if owner.isEmpty {
            owner = store.accountName.contains("@") ? "@me" : store.accountName
            editingName = true
          }
        }
        .sheet(item: $browser, onDismiss: { Task { await findRepository() } }) { link in
          GitHubCreationBrowser(url: link.url).ignoresSafeArea()
        }
    }
  }
  private func findRepository() async {
    guard !checking, let submitted else { return }
    checking = true
    defer { checking = false }
    await store.loadInstallations()
    guard store.repositoryError == nil else {
      status = store.repositoryError
      return
    }
    for installation in store.installations {
      await store.connect(installationId: installation.id)
      guard store.repositoryError == nil else {
        status = store.repositoryError
        return
      }
    }
    if let project = store.projects.first(where: {
      $0.name.caseInsensitiveCompare(submitted.name) == .orderedSame
        && (submitted.owner == "@me"
          || $0.owner.caseInsensitiveCompare(submitted.owner) == .orderedSame)
    }) {
      store.select(project)
      store.tab = .chat
      dismiss()
    } else {
      status = "Once the repository is created, allow Pocket access to it on GitHub, then refresh."
    }
  }
}

private struct CreationLink: Identifiable {
  let id = UUID()
  let url: URL
}
private struct GitHubCreationBrowser: UIViewControllerRepresentable {
  let url: URL
  func makeCoordinator() -> Coordinator { Coordinator(onFinish: { dismiss() }) }
  func makeUIViewController(context: Context) -> SFSafariViewController {
    let controller = SFSafariViewController(url: url)
    controller.delegate = context.coordinator
    controller.preferredControlTintColor = UIColor(PocketStyle.accent)
    return controller
  }
  func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
  @Environment(\.dismiss) private var dismiss
  @MainActor class Coordinator: NSObject, @preconcurrency SFSafariViewControllerDelegate {
    let onFinish: () -> Void
    init(onFinish: @escaping () -> Void) { self.onFinish = onFinish }
    func safariViewControllerDidFinish(_ controller: SFSafariViewController) { onFinish() }
  }
}
