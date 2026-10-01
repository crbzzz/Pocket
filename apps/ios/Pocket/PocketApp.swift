import PocketCore
import SwiftUI

@main
struct PocketApp: App {
  @State private var store = PocketStore()
  @Environment(\.scenePhase) private var scenePhase
  var body: some Scene {
    WindowGroup {
      RootView().environment(store).tint(PocketStyle.accent)
        .task { await store.load() }
        .onChange(of: scenePhase) { _, phase in
          if phase == .active { store.startPolling() } else { store.stopPolling() }
        }
    }
  }
}
