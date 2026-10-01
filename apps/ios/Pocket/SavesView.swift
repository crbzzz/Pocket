import PocketCore
import SwiftUI

struct SavesView: View {
  @Environment(PocketStore.self) private var store
  @State private var restore: PocketSave?
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        PageHeading(
          eyebrow: "A little peace of mind.", title: "Room to experiment.",
          subtitle: "Every finished task is a Save. Come back to it whenever you like.")
        ForEach(store.saves) { save in
          Card {
            HStack(spacing: 14) {
              Text("#\(save.number)").font(.system(size: 25, design: .serif)).foregroundStyle(
                PocketStyle.muted)
              VStack(alignment: .leading, spacing: 8) {
                Text(save.title).font(.system(size: 12, weight: .medium)).foregroundStyle(
                  PocketStyle.ink)
                Text(timeAgo(save.createdAt)).font(.system(size: 10)).foregroundStyle(
                  PocketStyle.muted)
              }
              Spacer(minLength: 0)
              Button("Restore") { restore = save }.buttonStyle(PocketButtonStyle())
            }
          }
        }
        if store.saves.isEmpty {
          EmptyPocket(
            symbol: "square.stack", title: "A safety net for your ideas.",
            detail: "Your first finished task creates your first Save.")
        }
        Card {
          VStack(alignment: .leading, spacing: 10) {
            Label("Try the ‘what if.’", systemImage: "lock.shield").font(
              .system(size: 18, design: .serif)
            ).foregroundStyle(PocketStyle.accent)
            Text(
              "A restore selects the starting point for your next task. Your existing Saves and remote branch stay intact."
            ).font(.system(size: 11)).foregroundStyle(PocketStyle.muted).lineSpacing(4)
          }
        }
      }.padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 30)
    }.pocketToolbar().task { await store.loadSaves() }.refreshable { await store.loadSaves() }
      .confirmationDialog(
        "Restore Save #\(restore?.number ?? 0)?",
        isPresented: Binding(get: { restore != nil }, set: { if !$0 { restore = nil } }),
        titleVisibility: .visible
      ) {
        if let save = restore {
          Button("Restore as starting point") {
            Task { await store.restore(save) }
            restore = nil
          }
        }
        Button("Cancel", role: .cancel) { restore = nil }
      } message: {
        Text("Your next task will start from this Git checkpoint. Nothing is force-pushed.")
      }
  }
}
