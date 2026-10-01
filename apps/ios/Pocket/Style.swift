import SwiftUI
import UIKit

enum PocketStyle {
  static let paper = Color(uiColor: .systemBackground)
  static let card = Color(uiColor: .secondarySystemBackground)
  static let soft = Color(uiColor: .tertiarySystemFill)
  static let ink = Color.primary
  static let muted = Color.secondary
  static let line = Color(uiColor: .separator).opacity(0.35)
  static let accent = Color.primary
  static let highlight = Color.primary
  static let success = Color(uiColor: .systemGreen)
  static let red = Color(uiColor: .systemRed)
}
extension Color {
  init(hex: UInt32) {
    self.init(.sRGB, red: Double((hex >> 16) & 255) / 255,
      green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255, opacity: 1)
  }
}
struct PocketMark: View {
  var body: some View {
    Image(systemName: "terminal").font(.system(size: 23, weight: .medium))
      .frame(width: 27, height: 27).accessibilityHidden(true)
  }
}
struct PocketOrb: View {
  var size: CGFloat = 64
  var body: some View {
    Image(systemName: "terminal").font(.system(size: size * 0.46, weight: .regular))
      .foregroundStyle(PocketStyle.ink)
      .frame(width: size, height: size)
      .background(PocketStyle.card, in: RoundedRectangle(cornerRadius: size * 0.25))
      .accessibilityHidden(true)
  }
}
struct PocketBackdrop: View {
  var body: some View { PocketStyle.paper.ignoresSafeArea() }
}
struct PageHeading: View {
  let title: String
  var body: some View {
    Text(title).font(.largeTitle.bold()).foregroundStyle(PocketStyle.ink)
      .frame(maxWidth: .infinity, alignment: .leading)
  }
}
struct Card<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    content.padding(18).frame(maxWidth: .infinity, alignment: .leading)
      .background(PocketStyle.card, in: RoundedRectangle(cornerRadius: 16))
  }
}
struct PocketButtonStyle: ButtonStyle {
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  var primary = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.subheadline.weight(.semibold))
      .padding(.horizontal, 16).padding(.vertical, 12)
      .foregroundStyle(primary ? PocketStyle.paper : PocketStyle.ink)
      .background(primary ? PocketStyle.ink : PocketStyle.soft, in: Capsule())
      .opacity(configuration.isPressed ? 0.7 : 1)
      .animation(reduceMotion ? nil : .easeOut(duration: 0.15), value: configuration.isPressed)
  }
}
struct EmptyPocket: View {
  let symbol: String
  let title: String
  let detail: String
  var body: some View {
    ContentUnavailableView {
      Label(title, systemImage: symbol)
    } description: { if !detail.isEmpty { Text(detail) } }
  }
}
func timeAgo(_ value: String) -> String {
  let parser = ISO8601DateFormatter()
  parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  guard let date = parser.date(from: value) else { return "Recently" }
  return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
}
