import PocketCore
import SwiftUI

struct AgentsView: View {
  @Environment(PocketStore.self) private var store
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 25) {
        PageHeading(
          eyebrow: "Quietly getting it done.", title: "A little work in motion.",
          subtitle: "Put your phone away. Pocket keeps going.")
        LazyVStack(spacing: 15) {
          ForEach(store.jobs) { job in
            Button {
              store.selectJob(job, tab: .chat)
            } label: {
              Card {
                HStack(alignment: .top, spacing: 12) {
                  if job.status.isActive {
                    ProgressView().controlSize(.small)
                  } else {
                    Image(systemName: job.status == .completed ? "checkmark.circle" : "clock")
                      .foregroundStyle(PocketStyle.accent)
                  }
                  VStack(alignment: .leading, spacing: 10) {
                    Text(job.prompt).font(.system(size: 12)).foregroundStyle(PocketStyle.ink)
                      .lineLimit(3).lineSpacing(4)
                    Text(
                      "\(store.projects.first { $0.id == job.projectId }?.name ?? "Project") / \(job.branch) · \(timeAgo(job.createdAt))"
                    ).font(.system(size: 9)).foregroundStyle(PocketStyle.muted)
                    HStack {
                      Text(job.status.label)
                      if job.demo { Text("· Demo") }
                    }.font(.system(size: 10)).foregroundStyle(PocketStyle.accent)
                  }
                  Spacer(minLength: 0)
                }
              }
            }.buttonStyle(.plain)
          }
        }
        if store.jobs.isEmpty {
          EmptyPocket(
            symbol: "bolt", title: "Ready when you are.",
            detail: "Your running and completed tasks will appear here.")
        }
      }.padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 30)
    }.pocketToolbar().refreshable { await store.load() }
  }
}
