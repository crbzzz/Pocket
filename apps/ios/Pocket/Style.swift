import SwiftUI

enum PocketStyle {
  static let accent = Color(light: 0x657A55, dark: 0xA6BB91)
  static let paper = Color(light: 0xF8FAF5, dark: 0x1B2018)
  static let card = Color(light: 0xFFFFFF, dark: 0x252B21)
  static let soft = Color(light: 0xEEF2E7, dark: 0x303A29)
  static let ink = Color(light: 0x30392A, dark: 0xE7EDD9)
  static let muted = Color(light: 0x8D9A80, dark: 0x9EAD8E)
  static let line = Color(light: 0xE3E9DB, dark: 0x38422F)
  static let red = Color(light: 0xB27D6D, dark: 0xD9A590)
}
extension Color {
  init(hex: UInt32) {
    self.init(
      .sRGB, red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255,
      blue: Double(hex & 255) / 255, opacity: 1)
  }
  init(light: UInt32, dark: UInt32) {
    self.init(
      uiColor: UIColor {
        $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light))
      })
  }
}
struct PocketMark: View {
  var body: some View {
    Path { path in
      path.move(to: CGPoint(x: 2, y: 4))
      path.addLine(to: CGPoint(x: 2, y: 15))
      path.addQuadCurve(to: CGPoint(x: 11, y: 23), control: CGPoint(x: 2, y: 23))
      path.addQuadCurve(to: CGPoint(x: 20, y: 15), control: CGPoint(x: 20, y: 23))
      path.addLine(to: CGPoint(x: 20, y: 4))
      path.move(to: CGPoint(x: 2, y: 2))
      path.addQuadCurve(to: CGPoint(x: 20, y: 2), control: CGPoint(x: 11, y: -2))
    }.stroke(style: StrokeStyle(lineWidth: 1.7, lineCap: .round, lineJoin: .round))
      .frame(width: 22, height: 25).rotationEffect(.degrees(-7)).accessibilityHidden(true)
  }
}
struct PageHeading: View {
  let eyebrow: String
  let title: String
  let subtitle: String
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        Rectangle().frame(width: 18, height: 1)
        Text(eyebrow.uppercased()).font(.system(size: 9, weight: .semibold)).tracking(1.8)
      }.foregroundStyle(PocketStyle.accent)
      Text(title).font(.system(size: 35, weight: .regular, design: .serif)).tracking(-1)
        .foregroundStyle(PocketStyle.ink)
      Text(subtitle).font(.system(size: 12)).foregroundStyle(PocketStyle.muted).lineSpacing(4)
    }.frame(maxWidth: .infinity, alignment: .leading)
  }
}
struct Card<Content: View>: View {
  @ViewBuilder var content: Content
  var body: some View {
    content.padding(18).frame(maxWidth: .infinity, alignment: .leading).background(
      PocketStyle.card, in: RoundedRectangle(cornerRadius: 12)
    ).overlay(RoundedRectangle(cornerRadius: 12).stroke(PocketStyle.line, lineWidth: 1))
  }
}
struct PocketButtonStyle: ButtonStyle {
  var primary = false
  func makeBody(configuration: Configuration) -> some View {
    configuration.label.font(.system(size: 12, weight: .medium)).padding(.horizontal, 15).padding(
      .vertical, 11
    )
    .foregroundStyle(primary ? PocketStyle.paper : PocketStyle.accent)
    .background(
      primary ? PocketStyle.accent : PocketStyle.card, in: RoundedRectangle(cornerRadius: 7)
    )
    .overlay(
      RoundedRectangle(cornerRadius: 7).stroke(
        primary ? PocketStyle.accent : PocketStyle.line, lineWidth: 1)
    )
    .opacity(configuration.isPressed ? 0.7 : 1)
  }
}
struct EmptyPocket: View {
  let symbol: String
  let title: String
  let detail: String
  var body: some View {
    VStack(spacing: 15) {
      Image(systemName: symbol).font(.system(size: 28, weight: .light))
      Text(title).font(.system(size: 24, design: .serif)).foregroundStyle(PocketStyle.ink)
      Text(detail).font(.system(size: 12)).multilineTextAlignment(.center).lineSpacing(4)
    }.foregroundStyle(PocketStyle.muted).padding(.vertical, 45).frame(maxWidth: .infinity)
  }
}
func timeAgo(_ value: String) -> String {
  let parser = ISO8601DateFormatter()
  parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  guard let date = parser.date(from: value) else { return "Recently" }
  return RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
}
