import SwiftUI

struct RootView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  private var isActivity: Bool { [.agents, .changes, .saves].contains(store.tab) }
  var body: some View {
    @Bindable var store = store
    ZStack {
      PocketBackdrop()
      if store.signedIn || store.demoEntered {
        workspace
      } else {
        VStack(spacing: 28) {
          Spacer()
          PocketOrb(size: 80)
          Text("Pocket").font(.system(size: 36, weight: .semibold)).tracking(-1)
            .foregroundStyle(PocketStyle.ink)
          Spacer()
          Button {
            Task { await store.signIn() }
          } label: {
            HStack(spacing: 10) {
              if store.isSigningIn { ProgressView().tint(PocketStyle.paper) }
              Text("Sign in with GitHub").font(.system(size: 16, weight: .semibold))
              Image(systemName: "arrow.right")
            }.frame(maxWidth: .infinity).padding(.vertical, 5)
          }.buttonStyle(PocketButtonStyle(primary: true)).disabled(store.isSigningIn)
          if store.demoMode {
            Button("Explore demo") { store.demoEntered = true }
              .font(.system(size: 13)).foregroundStyle(PocketStyle.muted).disabled(store.isSigningIn)
          }
        }.padding(28).padding(.bottom, 32)
      }
    }
      .task(id: "\(store.signedIn)-\(store.demoEntered)") {
        if store.signedIn || store.demoEntered {
          await store.load()
          await store.auth.refreshProfileIfNeeded()
        }
      }
      .sheet(isPresented: $store.showSettings) { NavigationStack { SettingsView() } }
      .alert(
        "Pocket",
        isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })
      ) {
        Button("OK") { store.error = nil }
      } message: {
        Text(store.error ?? "")
      }
      .alert(
        "Done",
        isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })
      ) {
        Button("OK") { store.notice = nil }
      } message: {
        Text(store.notice ?? "")
      }
  }
  private var workspace: some View {
    NavigationStack {
      Group {
        switch store.tab {
        case .projects: ProjectsView()
        case .agents, .changes, .saves:
          VStack(spacing: 0) {
            Picker("Activity", selection: Binding(get: { store.tab }, set: { store.tab = $0 })) {
              Text("Tasks").tag(PocketStore.Tab.agents)
              Text("Changes").tag(PocketStore.Tab.changes)
              Text("Checkpoints").tag(PocketStore.Tab.saves)
            }.pickerStyle(.segmented).padding(.horizontal, 20).padding(.vertical, 12)
            switch store.tab {
            case .changes: ChangesView()
            case .saves: SavesView()
            default: AgentsView()
            }
          }
        default: ChatView()
        }
      }
    }.tint(PocketStyle.accent)
      .safeAreaInset(edge: .top, spacing: 0) {
        if store.connectionError != nil {
          HStack {
            Image(systemName: "wifi.slash")
            Text("Unable to connect").font(.footnote)
            Spacer()
            Button("Retry") { Task { await store.load() } }.font(.footnote.weight(.semibold))
          }.foregroundStyle(.secondary).padding(.horizontal, 20).padding(.vertical, 8)
            .background(PocketStyle.card)
        }
      }
  }

}
struct PocketToolbar: ViewModifier {
  @Environment(PocketStore.self) private var store
  func body(content: Content) -> some View {
    content.navigationBarTitleDisplayMode(.inline).background(PocketStyle.paper)
      .toolbarBackground(PocketStyle.paper, for: .navigationBar)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Menu {
            Button { store.tab = .chat } label: { Label("Chat", systemImage: "bubble.left") }
            Button { store.tab = .projects } label: { Label("Repositories", systemImage: "folder") }
            Button { store.tab = .agents } label: { Label("Activity", systemImage: "clock") }
          } label: {
            HStack(spacing: 7) {
              Image(systemName: "line.3.horizontal")
              Text(store.tab == .projects ? "Repositories" : [.agents, .changes, .saves].contains(store.tab) ? "Activity" : "Chat")
                .font(.subheadline.weight(.semibold))
              Image(systemName: "chevron.down").font(.caption2.weight(.semibold))
            }.foregroundStyle(PocketStyle.ink).fixedSize()
          }.accessibilityLabel("Navigate Pocket")
        }
        ToolbarItem(placement: .topBarTrailing) {
          if store.signedIn {
            Button { store.showSettings = true } label: {
              AsyncImage(url: store.auth.session?.user?.avatarURL) { image in
                image.resizable().scaledToFill()
              } placeholder: {
                Image(systemName: "person.crop.circle").resizable().scaledToFit()
                  .foregroundStyle(PocketStyle.muted).padding(3)
              }
              .frame(width: 32, height: 32)
              .background(PocketStyle.card)
              .clipShape(Circle())
              .overlay(Circle().stroke(PocketStyle.line, lineWidth: 0.75))
              .frame(width: 44, height: 44)
            }.accessibilityLabel("Account and settings")
          } else {
            Button {
              Task { await store.signIn() }
            } label: {
              if store.isSigningIn { ProgressView() } else { Text("Sign in with GitHub") }
            }.font(.subheadline.weight(.medium)).disabled(store.isSigningIn)
          }
        }

      }
  }
}
extension View { func pocketToolbar() -> some View { modifier(PocketToolbar()) } }
