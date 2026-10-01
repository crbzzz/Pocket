import SwiftUI

struct SettingsView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.openURL) private var openURL
  @State private var installation = ""
  @State private var signingIn = false
  var body: some View {
    @Bindable var store = store
    ScrollView {
      VStack(alignment: .leading, spacing: 25) {
        PageHeading(
          eyebrow: "Make yourself at home.", title: "Small details. Your way.",
          subtitle: "A quieter, more personal workspace.")
        settingsSection("Connection") {
          VStack(alignment: .leading, spacing: 15) {
            Label("GitHub", systemImage: "link").font(.system(size: 13, weight: .medium))
            Text(
              store.demoMode
                ? "Local demo repositories. No account connected."
                : store.signedIn
                  ? "Signed in with GitHub through Supabase."
                  : "Connect the repositories you authorize."
            ).font(.system(size: 11)).foregroundStyle(PocketStyle.muted)
            if !store.demoMode && !store.signedIn {
              Button {
                signingIn = true
                Task {
                  await store.signIn()
                  signingIn = false
                }
              } label: {
                HStack {
                  if signingIn { ProgressView() }
                  Text("Sign in with GitHub")
                }
              }.buttonStyle(PocketButtonStyle(primary: true)).disabled(signingIn)
            }
            if !store.demoMode && store.signedIn {
              if let url = store.configuration?.githubAppUrl.flatMap(URL.init(string:)) {
                Button("Install Pocket GitHub App") { openURL(url) }.buttonStyle(
                  PocketButtonStyle())
              }
              Button("Authorize repository access") { Task { await store.authorizeGitHub() } }
                .buttonStyle(PocketButtonStyle(primary: true))
              Text("After installation, enter the installation ID from the GitHub URL.").font(
                .system(size: 10)
              ).foregroundStyle(PocketStyle.muted)
              TextField("Installation ID", text: $installation).keyboardType(.numberPad).font(
                .system(size: 12)
              ).padding(10).background(PocketStyle.soft, in: RoundedRectangle(cornerRadius: 6))
              Button("Sync authorized repositories") {
                if let id = Int(installation) { Task { await store.connect(installationId: id) } }
              }.buttonStyle(PocketButtonStyle(primary: true)).disabled(Int(installation) == nil)
              Button("Sign out", role: .destructive) { Task { await store.signOut() } }.font(
                .system(size: 11))
            }
          }
        }
        settingsSection("Models & usage") {
          VStack(spacing: 18) {
            HStack {
              Text("Default model")
              Spacer()
              Picker("Model", selection: $store.modelId) {
                ForEach(store.models) { model in Text(model.name).tag(model.id) }
              }.labelsHidden()
            }
            HStack {
              Text("Task budget")
              Spacer()
              Picker("Budget", selection: $store.maxCostCents) {
                Text("$1").tag(100)
                Text("$3").tag(300)
                Text("$8").tag(800)
              }.labelsHidden()
            }
            HStack {
              Text("Recorded model cost")
              Spacer()
              Text(
                Double(store.jobs.reduce(0) { $0 + ($1.report?.costCents ?? 0) }) / 100,
                format: .currency(code: "USD")
              ).foregroundStyle(PocketStyle.accent)
            }
            Text(
              "Only providers configured on the server are available. Sandbox charges are separate."
            ).font(.system(size: 9)).foregroundStyle(PocketStyle.muted).frame(
              maxWidth: .infinity, alignment: .leading)
          }.font(.system(size: 12))
        }
        settingsSection("Preferences") {
          Toggle(
            isOn: Binding(
              get: { store.notifications },
              set: { value in Task { await store.enableNotifications(value) } })
          ) {
            VStack(alignment: .leading, spacing: 6) {
              Text("Task completion notifications").font(.system(size: 12))
              Text(
                "Local notifications while Pocket is active. Background push delivery is not configured yet."
              ).font(.system(size: 9)).foregroundStyle(PocketStyle.muted)
            }
          }
        }
        settingsSection("Security") {
          VStack(alignment: .leading, spacing: 17) {
            Label("Every push requires your approval", systemImage: "lock.shield")
            Label("Ephemeral cloud sandboxes", systemImage: "cloud")
            Label("Credentials stay in Keychain or on the server", systemImage: "key")
          }.font(.system(size: 11)).foregroundStyle(PocketStyle.muted)
        }
        settingsSection("Development") {
          VStack(alignment: .leading, spacing: 15) {
            TextField("Pocket API URL", text: $store.apiURL).font(
              .system(size: 12, design: .monospaced)
            ).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
            Toggle("Local demo", isOn: $store.demoMode).font(.system(size: 12))
            Text(
              "HTTP is allowed only on localhost. Production requires HTTPS and configured Supabase Auth."
            ).font(.system(size: 9)).foregroundStyle(PocketStyle.muted)
            Button("Apply & reconnect") {
              store.savePreferences()
              store.projects = []
              store.jobs = []
              store.saves = []
              Task { await store.load() }
            }.buttonStyle(PocketButtonStyle())
          }
        }
        Text("Pocket · Ship from anywhere.").font(.system(size: 10, design: .serif))
          .foregroundStyle(PocketStyle.muted).frame(maxWidth: .infinity).padding(.vertical, 15)
      }.padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 30)
    }.pocketToolbar().onChange(of: store.modelId) { _, _ in store.savePreferences() }.onChange(
      of: store.maxCostCents
    ) { _, _ in store.savePreferences() }
  }
  private func settingsSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content)
    -> some View
  {
    VStack(alignment: .leading, spacing: 12) {
      Text(title.uppercased()).font(.system(size: 9, weight: .medium)).tracking(1.5)
        .foregroundStyle(PocketStyle.muted)
      Card { content() }
    }
  }
}
