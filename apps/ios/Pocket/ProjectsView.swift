import PocketCore
import SwiftUI

struct ProjectsView: View {
  @Environment(PocketStore.self) private var store
  @State private var search = ""
  private var filtered: [Project] {
    store.projects.filter {
      search.isEmpty || $0.name.localizedCaseInsensitiveContains(search)
        || $0.description.localizedCaseInsensitiveContains(search)
    }
  }
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 28) {
        PageHeading(
          eyebrow: "A little space. A lot of possibility.", title: "Good things start here.",
          subtitle: "Your projects, ready for your next idea.")
        HStack {
          Text("All projects").font(.system(size: 12, weight: .medium)).foregroundStyle(
            PocketStyle.accent)
          Text("\(store.projects.count)").font(.system(size: 10)).padding(5).background(
            PocketStyle.soft, in: RoundedRectangle(cornerRadius: 4))
          Spacer()
          Button {
            store.tab = .settings
          } label: {
            Label("Connect", systemImage: "plus")
          }.buttonStyle(PocketButtonStyle())
        }
        HStack {
          Image(systemName: "magnifyingglass")
          TextField("Find a project…", text: $search).font(.system(size: 12))
        }.foregroundStyle(PocketStyle.muted).padding(12).background(
          PocketStyle.soft, in: RoundedRectangle(cornerRadius: 8))
        LazyVStack(spacing: 0) {
          ForEach(filtered) { project in
            Button {
              store.select(project)
              store.tab = .chat
            } label: {
              ProjectRow(
                project: project, status: store.jobs.first { $0.projectId == project.id }?.status)
            }.buttonStyle(.plain)
            Rectangle().fill(PocketStyle.line).frame(height: 1)
          }
        }
        if store.isLoading { ProgressView().frame(maxWidth: .infinity) }
        if filtered.isEmpty && !store.isLoading {
          EmptyPocket(
            symbol: "square.grid.2x2", title: "Room for your next idea.",
            detail: search.isEmpty
              ? "Connect GitHub in Settings, or start the local demo API."
              : "No projects match your search.")
        }
        if let recent = store.jobs.first(where: { $0.status == .completed }) {
          Text("PICK UP WHERE YOU LEFT OFF").font(.system(size: 9, weight: .medium)).tracking(1.5)
            .foregroundStyle(PocketStyle.muted)
          Card {
            HStack(alignment: .top, spacing: 12) {
              Image(systemName: "checkmark.circle.fill").foregroundStyle(PocketStyle.accent)
              VStack(alignment: .leading, spacing: 8) {
                Text("Ready for your review.").font(.system(size: 12, weight: .medium))
                Text(
                  "\(recent.report?.files.count ?? 0) files changed · \(timeAgo(recent.updatedAt))"
                ).font(.system(size: 10)).foregroundStyle(PocketStyle.muted)
                if recent.demo {
                  Text("Simulated demo result").font(.system(size: 9)).foregroundStyle(
                    PocketStyle.muted)
                }
              }
              Spacer(minLength: 0)
              Button("Review") { store.selectJob(recent, tab: .changes) }.buttonStyle(
                PocketButtonStyle())
            }
          }
        }
        Card {
          HStack(spacing: 13) {
            Image(systemName: "leaf").font(.system(size: 20, weight: .light)).foregroundStyle(
              PocketStyle.accent)
            VStack(alignment: .leading, spacing: 8) {
              Text("Big ideas. Pocket-sized beginnings.").font(.system(size: 18, design: .serif))
                .foregroundStyle(PocketStyle.ink)
              Text("A fix, a feature, a ‘what if.’ Just ask Pocket.").font(.system(size: 11))
                .foregroundStyle(PocketStyle.muted)
            }
          }
        }
      }.padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 30)
    }.pocketToolbar().refreshable { await store.load() }
  }
}
struct ProjectRow: View {
  let project: Project
  let status: JobStatus?
  var body: some View {
    HStack(spacing: 14) {
      Image(
        systemName: project.language == "Swift"
          ? "square.bottomhalf.filled" : project.name == "Atlas" ? "safari" : "leaf"
      )
      .font(.system(size: 21, weight: .light)).foregroundStyle(PocketStyle.accent).frame(
        width: 44, height: 44
      ).background(PocketStyle.soft, in: RoundedRectangle(cornerRadius: 12))
      VStack(alignment: .leading, spacing: 7) {
        Text(project.name).font(.system(size: 15, weight: .medium)).foregroundStyle(PocketStyle.ink)
        Text(project.description).font(.system(size: 11)).foregroundStyle(PocketStyle.muted)
          .lineLimit(2)
        HStack(spacing: 10) {
          Text(project.language)
          Label(project.branch, systemImage: "arrow.triangle.branch")
          if status?.isActive == true { Text("Working").foregroundStyle(PocketStyle.accent) }
        }.font(.system(size: 9)).foregroundStyle(PocketStyle.muted)
      }.frame(maxWidth: .infinity, alignment: .leading)
      Image(systemName: "chevron.right").font(.system(size: 11, weight: .light)).foregroundStyle(
        PocketStyle.muted)
    }.padding(.vertical, 21).contentShape(Rectangle())
  }
}
