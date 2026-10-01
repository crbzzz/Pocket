import PocketCore
import SwiftUI

struct SavesView: View {
  @Environment(PocketStore.self) private var store
  @State private var restore: PocketSave?
  @State private var deletion: PocketSave?
  var body: some View {
    List {
      if let project = store.project {
        Section {
          ForEach(store.saves) { save in
            VStack(alignment: .leading, spacing: 9) {
              HStack {
                Label("Checkpoint #\(save.number)", systemImage: "square.stack.3d.up")
                  .font(.subheadline.weight(.semibold))
                Spacer()
                Menu {
                  Button("Use as starting point", systemImage: "arrow.counterclockwise") { restore = save }
                  Button("Delete checkpoint", systemImage: "trash", role: .destructive) { deletion = save }.disabled(save.canDelete == false)
                } label: { Image(systemName: "ellipsis").padding(8) }
                  .accessibilityLabel("Checkpoint actions")
              }
              Text(save.title).font(.body).lineLimit(3)
              Text("\(save.branch ?? project.branch) · \(timeAgo(save.createdAt))")
                .font(.caption).foregroundStyle(PocketStyle.muted)
            }.padding(.vertical, 6)
              .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                if save.canDelete != false { Button("Delete", systemImage: "trash", role: .destructive) { deletion = save } }
              }
          }
        } header: { Text(project.name) }
      }
    }.listStyle(.plain).scrollContentBackground(.hidden)
      .overlay {
        if store.saves.isEmpty { ContentUnavailableView("No checkpoints", systemImage: "square.stack.3d.up", description: Text("Completed tasks save a starting point for your next changes.")) }
      }
      .pocketToolbar().task { await store.loadSaves() }.refreshable { await store.loadSaves() }
      .confirmationDialog("Restore checkpoint #\(restore?.number ?? 0)?", isPresented: Binding(get: { restore != nil }, set: { if !$0 { restore = nil } }), titleVisibility: .visible) {
        if let save = restore {
          Button("Use as starting point") { restore = nil; Task { await store.restore(save) } }
        }
      } message: { Text("Your next task will start from this checkpoint.") }
      .confirmationDialog("Delete this checkpoint?", isPresented: Binding(get: { deletion != nil }, set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
        if let save = deletion {
          Button("Delete checkpoint", role: .destructive) { deletion = nil; Task { await store.deleteCheckpoint(save) } }
        }
      } message: { Text("This saved version will be permanently removed. Your GitHub repository is unchanged.") }
  }
}
