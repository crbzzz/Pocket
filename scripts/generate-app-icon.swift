import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Rasterize Pocket's geometric vector mark at the exact App Store dimensions.
let side = 1024
let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 0.94, green: 0.96, blue: 0.91, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: side, height: side))
context.setStrokeColor(CGColor(red: 0.36, green: 0.44, blue: 0.30, alpha: 1))
context.setLineWidth(29)
context.setLineCap(.round)
context.setLineJoin(.round)
context.move(to: CGPoint(x: 300, y: 690))
context.addLine(to: CGPoint(x: 300, y: 410))
context.addCurve(to: CGPoint(x: 510, y: 225), control1: CGPoint(x: 300, y: 285), control2: CGPoint(x: 390, y: 225))
context.addCurve(to: CGPoint(x: 720, y: 410), control1: CGPoint(x: 630, y: 225), control2: CGPoint(x: 720, y: 285))
context.addLine(to: CGPoint(x: 720, y: 690))
context.strokePath()
context.move(to: CGPoint(x: 301, y: 737))
context.addCurve(to: CGPoint(x: 719, y: 737), control1: CGPoint(x: 405, y: 790), control2: CGPoint(x: 615, y: 790))
context.strokePath()
let image = context.makeImage()!
let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "apps/ios/Pocket/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
let url = URL(fileURLWithPath: path)
let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Could not export icon") }
print("Generated \(path)")
