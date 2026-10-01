import MarkdownUI
import SwiftUI
import UIKit

struct MarkdownResponse: View {
  let content: String
  @ScaledMetric(relativeTo: .body) private var bodySize = 17.0

  var body: some View {
    Markdown(content)
      .markdownTheme(
        Theme.gitHub.text {
          FontSize(bodySize)
          ForegroundColor(PocketStyle.ink)
          BackgroundColor(.clear)
        }.code {
          FontFamilyVariant(.monospaced)
          FontSize(.em(0.88))
          ForegroundColor(PocketStyle.accent)
          BackgroundColor(.clear)
        }
      )
      .markdownTextStyle {
        FontSize(bodySize)
        ForegroundColor(PocketStyle.ink)
        BackgroundColor(.clear)
      }
      .markdownTextStyle(\.link) { ForegroundColor(PocketStyle.accent) }
      .markdownTextStyle(\.code) {
        FontFamilyVariant(.monospaced)
        FontSize(.em(0.88))
        ForegroundColor(PocketStyle.accent)
        BackgroundColor(.clear)
      }
      .markdownBlockStyle(\.heading1) { configuration in
        configuration.label
          .markdownTextStyle {
            FontWeight(.bold)
            FontSize(.em(1.5))
          }
          .markdownMargin(top: 24, bottom: 12)
      }
      .markdownBlockStyle(\.heading2) { configuration in
        configuration.label
          .markdownTextStyle {
            FontWeight(.semibold)
            FontSize(.em(1.3))
          }
          .markdownMargin(top: 22, bottom: 10)
      }
      .markdownBlockStyle(\.heading3) { configuration in
        configuration.label
          .markdownTextStyle {
            FontWeight(.semibold)
            FontSize(.em(1.12))
          }
          .markdownMargin(top: 18, bottom: 8)
      }
      .markdownBlockStyle(\.blockquote) { configuration in
        configuration.label
          .markdownTextStyle { ForegroundColor(PocketStyle.muted) }
          .padding(.leading, 14)
          .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2).fill(PocketStyle.accent).frame(width: 3)
          }
          .markdownMargin(top: 8, bottom: 16)
      }
      .markdownBlockStyle(\.codeBlock) { configuration in
        ResponseCodeBlock(configuration: configuration)
          .markdownMargin(top: 8, bottom: 16)
      }
      .markdownBlockStyle(\.table) { configuration in
        ScrollView(.horizontal) {
          configuration.label
            .markdownTableBorderStyle(.init(color: PocketStyle.line))
            .markdownTableBackgroundStyle(.alternatingRows(.clear, .clear))
            .fixedSize(horizontal: true, vertical: false)
        }.markdownMargin(top: 8, bottom: 16)
      }
      .textSelection(.enabled)
      .tint(PocketStyle.accent)
      .frame(maxWidth: .infinity, alignment: .leading)
      .environment(
        \.openURL,
        OpenURLAction { url in
          ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "")
            ? .systemAction : .discarded
        }
      )
      .contextMenu {
        Button("Copy response", systemImage: "doc.on.doc") { UIPasteboard.general.string = content }
      }
  }
}

private struct ResponseCodeBlock: View {
  let configuration: CodeBlockConfiguration
  @State private var copied = false
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text(configuration.language ?? "Code").font(.caption.weight(.medium)).foregroundStyle(
          PocketStyle.muted)
        Spacer()
        Button {
          UIPasteboard.general.string = configuration.content
          copied = true
        } label: {
          Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
            .font(.caption.weight(.medium))
        }.buttonStyle(.plain).foregroundStyle(PocketStyle.accent)
          .accessibilityLabel("Copy code")
      }.padding(.horizontal, 14).padding(.vertical, 11)
      Divider().overlay(PocketStyle.line)
      ScrollView(.horizontal) {
        configuration.label
          .markdownTextStyle {
            FontFamilyVariant(.monospaced)
            FontSize(.em(0.85))
            ForegroundColor(PocketStyle.ink)
            BackgroundColor(.clear)
          }
          .relativeLineSpacing(.em(0.2))
          .fixedSize(horizontal: true, vertical: false)
          .padding(14)
      }
    }
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(PocketStyle.line, lineWidth: 0.5))
    .clipShape(RoundedRectangle(cornerRadius: 12))
    .task(id: copied) {
      guard copied else { return }
      do {
        try await Task.sleep(for: .seconds(2))
        copied = false
      } catch {}
    }
  }
}
