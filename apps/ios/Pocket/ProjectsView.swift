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
        PageHeading(title: "Repositories")
        HStack {
          Text("Connected").font(.system(size: 12, weight: .medium)).foregroundStyle(
            PocketStyle.accent)
          Text("\(store.projects.count)").font(.caption).padding(5).background(
            PocketStyle.soft, in: RoundedRectangle(cornerRadius: 4))
          Spacer()
          Button {
            Task { await store.syncRepositories() }
          } label: {
            if store.isSigningIn || store.isDiscoveringRepositories {
              ProgressView()
            } else {
              Label(store.projects.isEmpty ? "Connect" : "Sync", systemImage: store.projects.isEmpty ? "plus" : "arrow.triangle.2.circlepath")
            }
          }.buttonStyle(PocketButtonStyle()).disabled(store.isSigningIn || store.isDiscoveringRepositories)
        }
        HStack {
          Image(systemName: "magnifyingglass")
          TextField("Search repositories", text: $search).font(.subheadline)
        }.foregroundStyle(PocketStyle.muted).padding(12).background(
          PocketStyle.soft, in: RoundedRectangle(cornerRadius: 8))
        LazyVStack(spacing: 12) {
          ForEach(filtered) { project in
            Button {
              store.select(project)
              store.tab = .chat
            } label: {
              ProjectRow(
                project: project, status: store.jobs.first { $0.projectId == project.id }?.status)
            }.buttonStyle(.plain)
          }
        }
        if store.isLoading || store.isDiscoveringRepositories { ProgressView().frame(maxWidth: .infinity) }
        if filtered.isEmpty && !store.isLoading && !store.isDiscoveringRepositories {
          EmptyPocket(
            symbol: "chevron.left.forwardslash.chevron.right", title: store.repositoryError == nil ? "No repositories" : "Sync interrupted",
            detail: search.isEmpty
              ? (store.repositoryError ?? "Connect GitHub to choose your repositories.")
              : "No repositories match your search.")
        }
        if let recent = store.jobs.first(where: { $0.status == .completed }) {
          Text("RECENT TASK").font(.system(size: 9, weight: .medium)).tracking(1.5)
            .foregroundStyle(PocketStyle.muted)
          Card {
            HStack(alignment: .top, spacing: 12) {
              Image(systemName: "checkmark.circle.fill").foregroundStyle(PocketStyle.accent)
              VStack(alignment: .leading, spacing: 8) {
                Text("Ready to review").font(.system(size: 12, weight: .medium))
                Text(
                  "\(recent.report?.files.count ?? 0) files changed · \(timeAgo(recent.updatedAt))"
                ).font(.caption).foregroundStyle(PocketStyle.muted)
                if recent.demo {
                  Text("Simulated demo result").font(.subheadline).foregroundStyle(
                    PocketStyle.muted)
                }
              }
              Spacer(minLength: 0)
              Button("Review") { store.selectJob(recent, tab: .changes) }.buttonStyle(
                PocketButtonStyle())
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
        systemName: "chevron.left.forwardslash.chevron.right"
      )
      .font(.system(size: 21, weight: .light)).foregroundStyle(PocketStyle.accent).frame(
        width: 44, height: 44
      ).background(PocketStyle.soft, in: RoundedRectangle(cornerRadius: 12))
      VStack(alignment: .leading, spacing: 7) {
        Text(project.name).font(.body.weight(.medium)).foregroundStyle(PocketStyle.ink)
        Text(project.description).font(.subheadline).foregroundStyle(PocketStyle.muted)
          .lineLimit(2)
        HStack(spacing: 10) {
          Text(project.language)
          Label(project.branch, systemImage: "arrow.triangle.branch")
          if status?.isActive == true { Text("Working").foregroundStyle(PocketStyle.accent) }
        }.font(.subheadline).foregroundStyle(PocketStyle.muted)
      }.frame(maxWidth: .infinity, alignment: .leading)
      Image(systemName: "chevron.right").font(.system(size: 11, weight: .light)).foregroundStyle(
        PocketStyle.muted)
    }.padding(18).background(PocketStyle.card, in: RoundedRectangle(cornerRadius: 19)).overlay(
      RoundedRectangle(cornerRadius: 19).stroke(PocketStyle.line.opacity(0.7))
    ).contentShape(Rectangle())
  }
}
