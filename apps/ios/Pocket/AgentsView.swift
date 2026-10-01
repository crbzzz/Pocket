import PocketCore
import SwiftUI

struct AgentsView: View {
  @Environment(PocketStore.self) private var store
  @State private var deletion: AgentJob?
  var body: some View {
    List {
      ForEach(store.jobs) { job in
        Button { store.selectJob(job, tab: .chat) } label: {
          HStack(alignment: .top, spacing: 12) {
            if job.status.isActive { ProgressView() }
            else {
              Image(systemName: job.status == .completed ? "checkmark.circle" : job.status == .failed ? "exclamationmark.circle" : "minus.circle")
                .foregroundStyle(job.status == .failed ? .orange : PocketStyle.accent)
            }
            VStack(alignment: .leading, spacing: 7) {
              Text(job.prompt).font(.body.weight(.medium)).foregroundStyle(PocketStyle.ink).lineLimit(3)
              Text("\(store.projects.first { $0.id == job.projectId }?.name ?? "Repository") · \(job.branch)")
                .font(.subheadline).foregroundStyle(PocketStyle.muted)
              HStack {
                Text(job.status.label)
                Spacer()
                Text(timeAgo(job.createdAt))
              }.font(.caption).foregroundStyle(PocketStyle.muted)
            }
          }.padding(.vertical, 8)
        }.buttonStyle(.plain)
          .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if job.status.isActive {
              Button("Cancel", systemImage: "stop.circle", role: .destructive) { Task { await store.cancel(job) } }
            } else {
              Button("Delete", systemImage: "trash", role: .destructive) { deletion = job }
            }
          }
          .contextMenu {
            Button("Open conversation", systemImage: "bubble.left") { store.selectJob(job, tab: .chat) }
            if !job.status.isActive {
              Button("Delete activity", systemImage: "trash", role: .destructive) { deletion = job }
            }
          }
      }
    }.listStyle(.plain).scrollContentBackground(.hidden)
      .overlay {
        if store.jobs.isEmpty { ContentUnavailableView("No activity yet", systemImage: "clock", description: Text("Start a conversation to work on a repository.")) }
      }
      .pocketToolbar().refreshable { await store.load() }
      .confirmationDialog("Delete this activity?", isPresented: Binding(get: { deletion != nil }, set: { if !$0 { deletion = nil } }), titleVisibility: .visible) {
        if let job = deletion {
          Button("Delete activity", role: .destructive) { deletion = nil; Task { await store.deleteActivity(job) } }
        }
      } message: { Text("The conversation will be removed from your history. Its checkpoints remain available.") }
  }
}
