import SwiftUI

struct SettingsView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.openURL) private var openURL
  @Environment(\.dismiss) private var dismiss
  @State private var advanced = false
  var body: some View {
    @Bindable var store = store
    Form {
      Section("Account") {
        Label(store.signedIn ? store.accountName : "GitHub", systemImage: "person.crop.circle")
        if store.signedIn {
          Button("Sign out", role: .destructive) { Task { await store.signOut() } }
        } else {
          Button { Task { await store.signIn() } } label: {
            HStack {
              Text("Sign in with GitHub")
              if store.isSigningIn { Spacer(); ProgressView() }
            }
          }.disabled(store.isSigningIn)
        }
      }
      if !store.demoMode && store.signedIn {
        Section("Repository access") {
          if store.configuration?.githubAppUrl != nil {
            Button { Task { await store.chooseRepositories() } } label: {
              HStack {
                Label("Choose repositories on GitHub", systemImage: "arrow.up.right.square")
                if store.isConnectingGitHub { Spacer(); ProgressView() }
              }
            }
          }
          Button("Connect organization repositories") { Task { await store.authorizeGitHub() } }
            .disabled(store.isConnectingGitHub)
          ForEach(store.installations) { installation in
            Button {
              Task { await store.connect(installationId: installation.id) }
            } label: {
              HStack {
                Label(installation.account, systemImage: "folder")
                Spacer()
                if store.isSyncing { ProgressView() } else {
                  Image(systemName: "arrow.triangle.2.circlepath")
                }
              }
            }.disabled(store.isSyncing)
          }
          Button("Sync repositories") { Task { await store.syncRepositories() } }
            .disabled(store.isDiscoveringRepositories)

        }
      }
      Section("Models & usage") {
        Picker("Default model", selection: $store.modelId) {
          ForEach(store.models) { model in Text(model.name).tag(model.id) }
        }.disabled(store.models.isEmpty)
        Picker("Task budget", selection: $store.maxCostCents) {
          Text("$1").tag(100)
          Text("$3").tag(300)
          Text("$8").tag(800)
        }
        LabeledContent("Model usage") {
          Text(Double(store.jobs.reduce(0) { $0 + ($1.report?.costCents ?? 0) }) / 100,
            format: .currency(code: "USD"))
        }
      }
      Section {
        Toggle("Notify when tasks finish", isOn: Binding(
          get: { store.notifications },
          set: { value in Task { await store.enableNotifications(value) } }
        ))
      } footer: {
        Text("Notifications are available while Pocket is open.")
      }
      if store.demoMode {
        Section { Label("Demo workspace", systemImage: "play.circle") } footer: {
          Text("Explore with sample repositories. Tasks in this workspace are simulated.")
        }
      }
      #if DEBUG
      Section {
        Button("Developer settings") { advanced = true }.foregroundStyle(.secondary)
      }
      #endif
    }
    .navigationTitle("Settings").navigationBarTitleDisplayMode(.inline)
    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
    .tint(PocketStyle.ink)
    .sheet(isPresented: $advanced) {
      NavigationStack {
        Form {
          Section("Development connection") {
            TextField("API URL", text: $store.apiURL)
              .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            Toggle("Demo workspace", isOn: $store.demoMode)
            Button("Apply") {
              store.savePreferences()
              store.projects = []; store.jobs = []; store.saves = []
              advanced = false
              Task { await store.load() }
            }
          }
        }.navigationTitle("Developer settings").navigationBarTitleDisplayMode(.inline)
          .toolbar { ToolbarItem(placement: .confirmationAction) {
            Button("Done") { advanced = false }
          } }
      }
    }
    .task { await store.loadInstallations() }
    .onChange(of: store.modelId) { _, _ in store.savePreferences() }
    .onChange(of: store.maxCostCents) { _, _ in store.savePreferences() }
  }
}
