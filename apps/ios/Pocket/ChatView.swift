import PocketCore
import SwiftUI

struct ChatView: View {
  @Environment(PocketStore.self) private var store
  @State private var memory = false
  @FocusState private var composing: Bool
  var body: some View {
    @Bindable var store = store
    ScrollViewReader { proxy in
      ScrollView {
        VStack(alignment: .leading, spacing: 23) {
          PageHeading(
            eyebrow: "From thought to shipped.", title: "What’s on your mind?",
            subtitle: "One message. A little less on your plate.")
          if let project = store.project {
            HStack(spacing: 6) {
              Menu {
                ForEach(store.projects) { p in Button(p.name) { store.select(p) } }
              } label: {
                Text(project.name).font(.system(size: 12, weight: .medium))
              }
              Text("/").foregroundStyle(PocketStyle.muted)
              Menu {
                ForEach(project.branches, id: \.self) { b in Button(b) { store.branch(b) } }
              } label: {
                Label(project.branch, systemImage: "arrow.triangle.branch").font(.system(size: 10))
              }
              Spacer(minLength: 3)
              Menu {
                ForEach(store.models) { m in
                  Button {
                    store.modelId = m.id
                    store.savePreferences()
                  } label: {
                    Label(m.name, systemImage: store.modelId == m.id ? "checkmark" : "circle")
                  }
                }
              } label: {
                HStack(spacing: 4) {
                  Text(store.models.first { $0.id == store.modelId }?.name ?? "Auto")
                  Image(systemName: "chevron.down")
                }.font(.system(size: 10))
              }
            }.foregroundStyle(PocketStyle.accent).padding(.vertical, 13)
            Rectangle().fill(PocketStyle.line).frame(height: 1)
            Button {
              memory = true
            } label: {
              Label("Project memory", systemImage: "square.text.square").font(.system(size: 10))
            }.foregroundStyle(PocketStyle.muted)
          }
          if let job = store.currentJob {
            HStack {
              Spacer(minLength: 15)
              Text(job.prompt).font(.system(size: 12)).lineSpacing(5).padding(17).foregroundStyle(
                PocketStyle.accent
              ).background(
                PocketStyle.soft,
                in: UnevenRoundedRectangle(
                  topLeadingRadius: 12, bottomLeadingRadius: 12, bottomTrailingRadius: 3,
                  topTrailingRadius: 12))
            }
            VStack(alignment: .leading, spacing: 13) {
              HStack(spacing: 6) {
                PocketMark().scaleEffect(0.55).frame(width: 13, height: 15)
                Text("POCKET").tracking(1.2)
                Text("· \(timeAgo(job.updatedAt))")
              }.font(.system(size: 9)).foregroundStyle(PocketStyle.muted)
              Text(
                job.report?.summary ?? job.error
                  ?? "I’ll work through this and bring the changes back for your review."
              ).font(.system(size: 12)).foregroundStyle(PocketStyle.muted).lineSpacing(5)
                .textSelection(.enabled)
              JobCard(job: job)
            }
          } else {
            EmptyPocket(
              symbol: "bubble.left", title: "Your next idea starts here.",
              detail: "Ask Pocket to fix something, build something, or explore a possibility.")
          }
          VStack(alignment: .leading, spacing: 10) {
            TextField("Ask Pocket to build, fix, or explore…", text: $store.draft, axis: .vertical)
              .lineLimit(3...8).font(.system(size: 12)).lineSpacing(4).focused($composing)
            HStack {
              Label("You’re in control of what ships.", systemImage: "lock.shield").font(
                .system(size: 8)
              ).foregroundStyle(PocketStyle.muted)
              Spacer()
              Button {
                composing = false
                Task { await store.send() }
              } label: {
                if store.isSending {
                  ProgressView().tint(PocketStyle.paper)
                } else {
                  Image(systemName: "arrow.up")
                }
              }.buttonStyle(PocketButtonStyle(primary: true)).disabled(
                store.isSending
                  || store.draft.trimmingCharacters(in: .whitespacesAndNewlines).count < 3
                  || store.project == nil || store.models.isEmpty
              ).accessibilityLabel("Send task")
            }
          }.padding(16).background(PocketStyle.card, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(PocketStyle.line)).id("composer")
          Text(
            store.demoMode
              ? "Demo workspace · simulated execution"
              : "Cloud execution · your computer can stay offline"
          ).font(.system(size: 9)).foregroundStyle(PocketStyle.muted).frame(maxWidth: .infinity)
        }.padding(.horizontal, 24).padding(.top, 26).padding(.bottom, 30)
      }.onChange(of: composing) { _, value in
        if value { withAnimation { proxy.scrollTo("composer", anchor: .bottom) } }
      }
    }.pocketToolbar().sheet(isPresented: $memory) { MemoryView() }
  }
}
struct JobCard: View {
  @Environment(PocketStore.self) private var store
  let job: AgentJob
  var body: some View {
    Card {
      VStack(alignment: .leading, spacing: 16) {
        HStack(spacing: 8) {
          if job.status.isActive {
            ProgressView().controlSize(.small)
          } else {
            Image(systemName: job.status == .completed ? "checkmark.circle" : "clock")
          }
          Text(job.status.label).font(.system(size: 12, weight: .medium))
        }.foregroundStyle(PocketStyle.accent)
        if job.status.isActive {
          ForEach([JobStatus.analyzing, .planning, .editing, .testing], id: \.self) { phase in
            HStack(spacing: 8) {
              Image(
                systemName: JobStatus.allCases.firstIndex(of: phase)! < JobStatus.allCases
                  .firstIndex(of: job.status)! ? "checkmark" : "circle"
              ).font(.system(size: 10))
              Text(phase.label).font(.system(size: 11))
            }.foregroundStyle(phase == job.status ? PocketStyle.accent : PocketStyle.muted)
          }
          Button("Cancel task", role: .destructive) { Task { await store.cancel(job) } }.font(
            .system(size: 11))
        } else if let report = job.report {
          DiffStats(report: report)
          ForEach(report.checks) { check in
            Label(
              "\(check.name) · \(check.status)",
              systemImage: check.status == "passed" ? "checkmark" : "exclamationmark.circle"
            ).font(.system(size: 10)).foregroundStyle(
              check.status == "failed" ? PocketStyle.red : PocketStyle.muted)
          }
          HStack {
            Button {
              store.selectJob(job, tab: .changes)
            } label: {
              Label("Review changes", systemImage: "arrow.right")
            }.buttonStyle(PocketButtonStyle(primary: true))
            Button {
              store.tab = .saves
            } label: {
              Image(systemName: "square.stack")
            }.buttonStyle(PocketButtonStyle()).accessibilityLabel("View Saves")
          }
        } else {
          Button("Try again") { store.draft = job.prompt }.buttonStyle(PocketButtonStyle())
        }
        if job.demo {
          Text("Demo result. No repository was modified.").font(.system(size: 9)).foregroundStyle(
            PocketStyle.muted)
        }
      }
    }
  }
}
struct DiffStats: View {
  let report: AgentReport
  var body: some View {
    HStack(spacing: 13) {
      Text("\(report.files.count) files changed").foregroundStyle(PocketStyle.ink)
      Text("+\(report.additions)").foregroundStyle(PocketStyle.accent)
      Text("−\(report.deletions)").foregroundStyle(PocketStyle.red)
    }.font(.system(size: 11, weight: .medium))
  }
}
struct MemoryView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.dismiss) private var dismiss
  var body: some View {
    NavigationStack {
      ScrollView {
        if let project = store.project {
          VStack(alignment: .leading, spacing: 25) {
            PageHeading(
              eyebrow: "Pocket Memory", title: project.name,
              subtitle: "A little context. A lot less explaining.")
            memorySection("Stack", values: project.memory.stack)
            memorySection("Current objective", values: [project.memory.objective])
            memorySection("Important decisions", values: project.memory.decisions)
            memorySection("Recent work", values: project.memory.recentWork)
          }.padding(24)
        }
      }.background(PocketStyle.paper).toolbar {
        ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
      }
    }
  }
  private func memorySection(_ title: String, values: [String]) -> some View {
    VStack(alignment: .leading, spacing: 11) {
      Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(PocketStyle.accent)
      ForEach(Array(values.enumerated()), id: \.offset) { _, text in
        Text(text).font(.system(size: 12)).lineSpacing(5).foregroundStyle(PocketStyle.muted)
      }
    }
  }
}
