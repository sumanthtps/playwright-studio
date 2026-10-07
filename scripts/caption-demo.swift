// Add a caption below each original capture without obscuring the VS Code UI.
import AppKit
import Foundation

struct Scene: Decodable { let file: String; let title: String; let caption: String }
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let scenes = try JSONDecoder().decode([Scene].self, from: Data(contentsOf: root.appendingPathComponent("scripts/demo-scenes.json")))
for (index, scene) in scenes.enumerated() {
    guard let source = NSImage(contentsOf: root.appendingPathComponent("images/demo/\(scene.file)")) else { fatalError("Missing capture: \(scene.file)") }
    let width = 1280, height = 800, captionHeight = 100
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height + captionHeight,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor(calibratedRed: 0.025, green: 0.055, blue: 0.09, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: width, height: height + captionHeight).fill()
    let scale = min(CGFloat(width) / source.size.width, CGFloat(height) / source.size.height)
    let size = NSSize(width: source.size.width * scale, height: source.size.height * scale)
    source.draw(in: NSRect(x: (CGFloat(width) - size.width) / 2, y: CGFloat(captionHeight) + (CGFloat(height) - size.height) / 2, width: size.width, height: size.height))
    (scene.title as NSString).draw(at: NSPoint(x: 24, y: 53), withAttributes: [.font: NSFont.systemFont(ofSize: 25, weight: .semibold), .foregroundColor: NSColor.white])
    (scene.caption as NSString).draw(at: NSPoint(x: 24, y: 20), withAttributes: [.font: NSFont.systemFont(ofSize: 15), .foregroundColor: NSColor(calibratedWhite: 0.78, alpha: 1)])
    (String(format: "v2.0   %02d / %02d", index + 1, scenes.count) as NSString).draw(at: NSPoint(x: width - 174, y: 57), withAttributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 16, weight: .medium), .foregroundColor: NSColor.systemGreen])
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("\(index).png"))
}
