import SwiftUI

struct RootView: View {
  @Environment(PocketStore.self) private var store
  var body: some View {
    @Bindable var store = store
    TabView(selection: $store.tab) {
      NavigationStack { ProjectsView() }.tabItem {
        Label("Projects", systemImage: "square.grid.2x2")
      }.tag(PocketStore.Tab.projects)
      NavigationStack { ChatView() }.tabItem { Label("Chat", systemImage: "bubble.left") }.tag(
        PocketStore.Tab.chat)
      NavigationStack { ChangesView() }.tabItem {
        Label("Changes", systemImage: "arrow.triangle.branch")
      }.tag(PocketStore.Tab.changes)
      NavigationStack { SavesView() }.tabItem { Label("Saves", systemImage: "square.stack") }.tag(
        PocketStore.Tab.saves)
      NavigationStack { AgentsView() }.tabItem { Label("Agents", systemImage: "bolt") }.tag(
        PocketStore.Tab.agents)
      NavigationStack { SettingsView() }.tabItem { Label("Settings", systemImage: "gearshape") }
        .tag(PocketStore.Tab.settings)
    }
    .alert(
      "Pocket",
      isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })
    ) {
      Button("OK") { store.error = nil }
    } message: {
      Text(store.error ?? "")
    }
    .alert(
      "All set",
      isPresented: Binding(get: { store.notice != nil }, set: { if !$0 { store.notice = nil } })
    ) {
      Button("OK") { store.notice = nil }
    } message: {
      Text(store.notice ?? "")
    }
  }
}
struct PocketToolbar: ViewModifier {
  @Environment(PocketStore.self) private var store
  func body(content: Content) -> some View {
    content.background(PocketStyle.paper).toolbarBackground(PocketStyle.paper, for: .navigationBar)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) { PocketMark().foregroundStyle(PocketStyle.ink) }
        ToolbarItem(placement: .principal) {
          Text("Pocket").font(.system(size: 21, weight: .semibold)).tracking(-0.6).foregroundStyle(
            PocketStyle.ink)
        }
        ToolbarItem(placement: .topBarTrailing) {
          HStack(spacing: 8) {
            if store.demoMode {
              Text("DEMO").font(.system(size: 8, weight: .medium)).tracking(1.4).foregroundStyle(
                PocketStyle.muted)
            }
            Button {
              store.tab = .settings
            } label: {
              Image(systemName: "slider.horizontal.3").font(.system(size: 15)).foregroundStyle(
                PocketStyle.muted)
            }.accessibilityLabel("Settings")
          }
        }
      }
  }
}
extension View { func pocketToolbar() -> some View { modifier(PocketToolbar()) } }
