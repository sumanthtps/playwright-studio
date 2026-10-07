// Add a caption below each original capture without obscuring the VS Code UI.
import AppKit
import Foundation

struct Scene: Decodable { let file: String; let title: String; let caption: String }
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let scenes = try JSONDecoder().decode([Scene].self, from: Data(contentsOf: root.appendingPathComponent("scripts/demo-scenes.json")))
for (index, scene) in scenes.enumerated() {
    guard let source = NSImage(contentsOf: root.appendingPathComponent("images/demo/\(scene.file)")) else { fatalError("Missing capture: \(scene.file)") }
    let width = Int(source.size.width), height = Int(source.size.height)
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height + 88,
        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
    NSColor(calibratedRed: 0.025, green: 0.055, blue: 0.09, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: width, height: height + 88).fill()
    source.draw(in: NSRect(x: 0, y: 88, width: width, height: height))
    (scene.title as NSString).draw(at: NSPoint(x: 24, y: 48), withAttributes: [.font: NSFont.systemFont(ofSize: 23, weight: .semibold), .foregroundColor: NSColor.white])
    (scene.caption as NSString).draw(at: NSPoint(x: 24, y: 20), withAttributes: [.font: NSFont.systemFont(ofSize: 15), .foregroundColor: NSColor(calibratedWhite: 0.78, alpha: 1)])
    (String(format: "%02d / %02d", index + 1, scenes.count) as NSString).draw(at: NSPoint(x: width - 105, y: 50), withAttributes: [.font: NSFont.monospacedDigitSystemFont(ofSize: 16, weight: .medium), .foregroundColor: NSColor.systemGreen])
    NSGraphicsContext.restoreGraphicsState()
    try bitmap.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("\(index).png"))
}
