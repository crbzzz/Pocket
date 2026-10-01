import PocketCore
import SwiftUI

@main
struct PocketApp: App {
  @State private var store = PocketStore()
  @Environment(\.scenePhase) private var scenePhase
  var body: some Scene {
    WindowGroup {
      RootView().environment(store).tint(PocketStyle.accent)
        .onChange(of: scenePhase) { _, phase in
          if phase == .active && (store.signedIn || store.demoEntered) {
            store.startPolling()
          } else {
            store.stopPolling()
          }
        }
    }
  }
}
