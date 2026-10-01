import PocketCore
import SwiftUI

struct ChangesView: View {
  @Environment(PocketStore.self) private var store
  @State private var shipping: String?
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        PageHeading(
          eyebrow: "A closer look.", title: "The details matter.",
          subtitle: "Every change. Yours to review.")
        if let job = store.currentJob, let report = job.report {
          Text("\(store.project?.name ?? "") / \(job.branch)").font(.system(size: 11))
            .foregroundStyle(PocketStyle.muted)
          DiffStats(report: report)
          if job.demo {
            Text("Demo diff · checks are simulated").font(.system(size: 10)).foregroundStyle(
              PocketStyle.muted)
          }
          ForEach(report.files) { file in DiffFileView(file: file) }
          ForEach(report.checks) { check in
            VStack(alignment: .leading, spacing: 6) {
              Label(
                "\(check.name): \(check.status)",
                systemImage: check.status == "passed"
                  ? "checkmark.circle" : "exclamationmark.circle"
              ).font(.system(size: 11, weight: .medium))
              Text(check.detail).font(.system(size: 9, design: .monospaced)).lineLimit(8)
                .textSelection(.enabled)
            }.foregroundStyle(check.status == "failed" ? PocketStyle.red : PocketStyle.muted)
          }
          HStack(spacing: 8) {
            Button {
              shipping = "pr"
            } label: {
              Label("Create PR", systemImage: "arrow.triangle.pull")
            }.buttonStyle(PocketButtonStyle(primary: true)).disabled(!report.canShip)
            Button {
              shipping = "push"
            } label: {
              Label("Push branch", systemImage: "arrow.up")
            }.buttonStyle(PocketButtonStyle()).disabled(!report.canShip)
          }
          HStack(spacing: 16) {
            Button("Request changes") {
              store.draft = "Please adjust the previous changes: "
              store.tab = .chat
            }
            Button("View Save") { store.tab = .saves }
          }.font(.system(size: 11)).padding(.vertical, 5)
          Text("Nothing ships automatically. Your base branch stays protected.").font(
            .system(size: 9)
          ).foregroundStyle(PocketStyle.muted)
        } else {
          EmptyPocket(
            symbol: "arrow.triangle.branch", title: "Good work deserves a second look.",
            detail: "Start a task and Pocket will bring the changes here.")
          Button("Open chat") { store.tab = .chat }.buttonStyle(PocketButtonStyle(primary: true))
        }
      }.padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 30)
    }.pocketToolbar().task(id: store.currentJob?.id) { await store.loadDiff() }.sheet(
      item: Binding(get: { shipping.map { ShipSheetKind(id: $0) } }, set: { shipping = $0?.id })
    ) { kind in ShipSheet(kind: kind.id) }
  }
}
private struct ShipSheetKind: Identifiable { let id: String }
struct DiffFileView: View {
  let file: DiffFile
  @State private var expanded = true
  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      ScrollView(.horizontal) {
        LazyVStack(alignment: .leading, spacing: 0) {
          ForEach(file.lines) { line in
            HStack(alignment: .top, spacing: 8) {
              Text("\(line.id + 1)").foregroundStyle(PocketStyle.muted).frame(
                width: 23, alignment: .trailing)
              Text(line.text.isEmpty ? " " : line.text).foregroundStyle(foreground(line.kind))
                .fixedSize(horizontal: true, vertical: false).textSelection(.enabled)
            }.font(.system(size: 10, design: .monospaced)).padding(.vertical, 3).padding(
              .horizontal, 6
            ).frame(maxWidth: .infinity, alignment: .leading).background(background(line.kind))
          }
        }
      }.padding(.top, 8)
    } label: {
      HStack(spacing: 5) {
        Image(systemName: "doc")
        Text(file.path).lineLimit(2)
        Spacer(minLength: 2)
        Text("+\(file.additions)").foregroundStyle(PocketStyle.accent)
        Text("−\(file.deletions)").foregroundStyle(PocketStyle.red)
      }.font(.system(size: 9, design: .monospaced))
    }.padding(12).background(PocketStyle.card, in: RoundedRectangle(cornerRadius: 9)).overlay(
      RoundedRectangle(cornerRadius: 9).stroke(PocketStyle.line)
    ).tint(PocketStyle.muted)
  }
  private func foreground(_ kind: DiffLine.Kind) -> Color {
    switch kind {
    case .addition: PocketStyle.accent
    case .deletion: PocketStyle.red
    case .hunk: PocketStyle.muted
    case .context: PocketStyle.ink
    }
  }
  private func background(_ kind: DiffLine.Kind) -> Color {
    switch kind {
    case .addition: PocketStyle.soft
    case .deletion: PocketStyle.red.opacity(0.07)
    default: .clear
    }
  }
}
struct ShipSheet: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  let kind: String
  @State private var title = ""
  @State private var busy = false
  @State private var key = UUID().uuidString
  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 23) {
        PageHeading(
          eyebrow: "Review → Ship",
          title: kind == "pr" ? "Ready to open a PR?" : "Ready to push a branch?",
          subtitle: "A new branch. Your approval. Every time.")
        TextField("Commit title", text: $title).font(.system(size: 13)).padding(14).background(
          PocketStyle.card, in: RoundedRectangle(cornerRadius: 8))
        if store.demoMode {
          Text("This is a demo action. No GitHub repository will be changed.").font(
            .system(size: 11)
          ).foregroundStyle(PocketStyle.muted)
        }
        if store.currentJob?.report?.checks.contains(where: { $0.status == "skipped" }) == true {
          Text("Some checks were skipped. Review this change before approving.").font(
            .system(size: 11)
          ).foregroundStyle(PocketStyle.red)
        }
        Button {
          busy = true
          Task {
            let result = await store.ship(kind: kind, title: title, key: key)
            busy = false
            if let result {
              dismiss()
              if let url = result.url.flatMap(URL.init(string:)), url.scheme == "https",
                url.host == "github.com"
              {
                openURL(url)
              }
            }
          }
        } label: {
          HStack {
            if busy { ProgressView() }
            Text(kind == "pr" ? "Approve & create PR" : "Approve & push branch")
          }.frame(maxWidth: .infinity)
        }.buttonStyle(PocketButtonStyle(primary: true)).disabled(
          busy || title.trimmingCharacters(in: .whitespacesAndNewlines).count < 3
            || title.count > 200)
        Spacer()
      }.padding(24).background(PocketStyle.paper).toolbar {
        ToolbarItem(placement: .topBarTrailing) { Button("Cancel") { dismiss() }.disabled(busy) }
      }.onAppear { title = String((store.currentJob?.prompt ?? "Pocket changes").prefix(160)) }
    }.presentationDetents([.medium, .large])
  }
}
