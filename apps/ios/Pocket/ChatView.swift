import PocketCore
import SwiftUI

struct ChatView: View {
  @Environment(PocketStore.self) private var store
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var memory = false
  @FocusState private var composing: Bool
  var body: some View {
    @Bindable var store = store
    VStack(spacing: 0) {
      HStack(spacing: 10) {
        if let project = store.project {
          Menu {
            ForEach(store.projects) { p in Button(p.name) { store.select(p) } }
          } label: {
            Label(project.name, systemImage: "chevron.left.forwardslash.chevron.right")
              .font(.system(size: 13, weight: .semibold))
          }
          Menu {
            ForEach(project.branches, id: \.self) { branch in
              Button(branch) { store.branch(branch) }
            }
          } label: {
            Label(project.branch, systemImage: "arrow.triangle.branch")
              .font(.system(size: 11)).foregroundStyle(PocketStyle.muted)
          }
        } else {
          Button("Choose a repository") { store.tab = .projects }.font(
            .system(size: 13, weight: .semibold))
        }
        Spacer(minLength: 2)
        Button {
          memory = true
        } label: {
          Image(systemName: "brain")
        }
        .accessibilityLabel("Project memory").disabled(store.project == nil)
        Button {
          store.newConversation = true
          store.draft = ""
          composing = true
        } label: {
          Image(systemName: "square.and.pencil")
        }.accessibilityLabel("New conversation")
      }.foregroundStyle(PocketStyle.ink).padding(.horizontal, 22).padding(.vertical, 16)
        .background(PocketStyle.paper)
      ScrollViewReader { proxy in
        ScrollView {
          VStack(alignment: .leading, spacing: 24) {
            if store.currentJob == nil {
              VStack(spacing: 22) {
                PocketOrb(size: 56)
                Text("What can we build?").font(.system(size: 28, weight: .semibold)).tracking(-0.7)
                  .foregroundStyle(PocketStyle.ink)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                  suggestion("Fix a bug", "ladybug", "Help me fix a bug in this repository: ")
                  suggestion("Build a feature", "sparkles", "Build a feature in this repository: ")
                  suggestion(
                    "Review code", "checkmark.shield",
                    "Review the relevant code and suggest improvements: ")
                  suggestion("Add tests", "testtube.2", "Add meaningful tests for: ")
                }
              }.padding(.top, 72).padding(.bottom, 32)
            } else {
              ForEach(Array(store.projectJobs.reversed())) { job in
                HStack {
                  Spacer(minLength: 38)
                  Text(job.prompt).font(.body).lineSpacing(4).textSelection(.enabled)
                    .foregroundStyle(PocketStyle.ink).padding(16)
                    .background(PocketStyle.soft, in: RoundedRectangle(cornerRadius: 19))
                }
                VStack(alignment: .leading, spacing: 15) {
                  HStack(spacing: 8) {
                    PocketMark().scaleEffect(0.6).frame(width: 17, height: 17).foregroundStyle(
                      PocketStyle.accent)
                    Text("Pocket").font(.system(size: 12, weight: .semibold)).foregroundStyle(
                      PocketStyle.ink)
                    Text(timeAgo(job.updatedAt)).font(.system(size: 10)).foregroundStyle(
                      PocketStyle.muted)
                  }
                  if let summary = job.report?.summary ?? job.error {
                    Text(.init(summary)).font(.body).lineSpacing(4).textSelection(.enabled)
                      .foregroundStyle(PocketStyle.ink.opacity(0.9))
                  }
                  if (job.id == store.currentJob?.id || job.status.isActive) && (job.status != .completed || job.report?.files.isEmpty == false) {
                    JobCard(job: job)
                  } else if job.report?.files.isEmpty == false {
                    Button("Review changes") { store.selectJob(job, tab: .changes) }
                      .font(.system(size: 12, weight: .medium)).foregroundStyle(PocketStyle.accent)
                  }
                }
              }
            }
            Color.clear.frame(height: 1).id("conversation-end")
          }.padding(.horizontal, 22).padding(.bottom, 12)
        }.scrollDismissesKeyboard(.interactively)
          .onChange(of: store.jobs.count) { _, _ in
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.3)) {
              proxy.scrollTo("conversation-end", anchor: .bottom)
            }
          }
      }
    }
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 0) {
        VStack(alignment: .leading, spacing: 15) {
          TextField("Message Pocket", text: $store.draft, axis: .vertical)
            .lineLimit(1...6).font(.body).foregroundStyle(PocketStyle.ink)
            .focused($composing).padding(.top, 2)
          HStack {
            Menu {
              ForEach(store.models) { model in
                Button {
                  store.modelId = model.id
                  store.savePreferences()
                } label: {
                  Label(
                    model.name, systemImage: model.id == store.modelId ? "checkmark" : "sparkles")
                }
              }
            } label: {
              HStack(spacing: 6) {
                Image(systemName: "sparkles").foregroundStyle(PocketStyle.accent)
                Text(store.models.first { $0.id == store.modelId }?.name ?? "Choose model")
                Image(systemName: "chevron.down").font(.system(size: 9))
              }.font(.system(size: 12, weight: .medium)).foregroundStyle(PocketStyle.ink)
            }.accessibilityLabel("Choose model").disabled(store.models.isEmpty)
            Spacer()
            if store.demoMode {
              Text("Demo").font(.system(size: 9)).foregroundStyle(PocketStyle.muted)
            }
            Button {
              composing = false
              Task { await store.send() }
            } label: {
              Group {
                if store.isSending {
                  ProgressView().tint(PocketStyle.paper)
                } else {
                  Image(systemName: "arrow.up").font(.system(size: 17, weight: .semibold))
                }
              }.foregroundStyle(PocketStyle.paper).frame(width: 40, height: 40)
                .background(PocketStyle.highlight, in: Circle())
            }.buttonStyle(.plain).disabled(
              store.isSending || store.project == nil || store.models.isEmpty
                || store.draft.trimmingCharacters(in: .whitespacesAndNewlines).count < 3
            )
            .opacity(
              store.draft.trimmingCharacters(in: .whitespacesAndNewlines).count < 3 ? 0.4 : 1
            )
            .accessibilityLabel("Send task")
          }
        }.padding(17).background(PocketStyle.card, in: RoundedRectangle(cornerRadius: 21))

          .padding(.horizontal, 18).padding(.top, 10).padding(.bottom, 3)
      }.background(PocketStyle.paper)
    }
    .onChange(of: composing) { _, value in store.isComposing = value }
    .onDisappear { store.isComposing = false }
    .pocketToolbar().sheet(isPresented: $memory) { MemoryView() }
  }
  private func suggestion(_ title: String, _ symbol: String, _ prompt: String) -> some View {
    Button {
      store.draft = prompt
      composing = true
    } label: {
      HStack(spacing: 9) {
        Image(systemName: symbol).foregroundStyle(PocketStyle.accent)
        Text(title).foregroundStyle(PocketStyle.ink)
        Spacer(minLength: 0)
      }.font(.subheadline).padding(15)
        .background(PocketStyle.card, in: RoundedRectangle(cornerRadius: 15))

    }.buttonStyle(.plain)
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
          Text("Demo · simulated result").font(.system(size: 9)).foregroundStyle(
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
      Text("+\(report.additions)").foregroundStyle(PocketStyle.success)
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
            PageHeading(title: project.name)
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
