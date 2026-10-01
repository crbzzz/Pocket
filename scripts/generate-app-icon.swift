import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Rasterize Pocket's geometric vector mark at the exact App Store dimensions.
let side = 1024
let context = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
context.setFillColor(CGColor(red: 0.055, green: 0.055, blue: 0.063, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: side, height: side))
context.setStrokeColor(CGColor(red: 0.96, green: 0.96, blue: 0.97, alpha: 1))
context.setLineWidth(44)
context.setLineCap(.round)
context.setLineJoin(.round)
context.move(to: CGPoint(x: 292, y: 664))
context.addLine(to: CGPoint(x: 449, y: 512))
context.addLine(to: CGPoint(x: 292, y: 360))
context.strokePath()
context.move(to: CGPoint(x: 515, y: 360))
context.addLine(to: CGPoint(x: 730, y: 360))
context.strokePath()
let image = context.makeImage()!
let path = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "apps/ios/Pocket/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
let url = URL(fileURLWithPath: path)
let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Could not export icon") }
print("Generated \(path)")
