import SwiftUI
import UIKit

enum PocketStyle {
  private static func adaptive(_ light: UInt32, _ dark: UInt32) -> Color {
    func color(_ hex: UInt32) -> UIColor {
      UIColor(
        red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
        blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
    return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? color(dark) : color(light) })
  }
  static let paper = adaptive(0xF5F7F8, 0x101419)
  static let card = adaptive(0xFFFFFF, 0x1B222B)
  static let soft = adaptive(0xE7EDF0, 0x27323D)
  static let ink = adaptive(0x18232C, 0xEDF2F5)
  static let muted = adaptive(0x5D6D79, 0xA0AFBD)
  static let line = adaptive(0xD8E1E5, 0x35424E)
  static let accent = adaptive(0x146C60, 0x9AE5CE)
  static let highlight = accent
  static let success = accent
  static let red = adaptive(0xBA3D44, 0xFF969C)
}

extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 255) / 255,
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
      .background(primary ? PocketStyle.accent : PocketStyle.soft, in: Capsule())
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
    } description: {
      if !detail.isEmpty { Text(detail) }
    }
  }
}
func timeAgo(_ value: String) -> String {
  let parser = ISO8601DateFormatter()
  parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  guard let date = parser.date(from: value) else { return "Recently" }
  if date.timeIntervalSinceNow > -60 { return "Just now" }
  return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
}
