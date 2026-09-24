import Foundation
import Vision
import ImageIO

struct Region: Codable {
    let id: String, name: String, kind: String
    let x: Int, y: Int, width: Int, height: Int, z: Int
    let text: String, fontFamily: String, color: String
    let fontSize: Int
}
struct Result: Codable { let layers: [Region] }

do {
    guard CommandLine.arguments.count == 2,
          let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw NSError(domain: "OCR", code: 1, userInfo: [NSLocalizedDescriptionKey: "Cannot read image"])
    }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = false
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    let width = Double(image.width), height = Double(image.height)
    let layers = (request.results ?? []).enumerated().compactMap { index, observation -> Region? in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        let x = max(0, Int(floor(box.minX * width)) - 2)
        let y = max(0, Int(floor((1 - box.maxY) * height)) - 2)
        let w = min(image.width - x, Int(ceil(box.width * width)) + 4)
        let h = min(image.height - y, Int(ceil(box.height * height)) + 4)
        return Region(id: UUID().uuidString, name: String(candidate.string.prefix(40)), kind: "text",
          x: x, y: y, width: w, height: h, z: index, text: candidate.string,
          fontFamily: "Inter", color: "#ffffff", fontSize: max(8, Int(box.height * height)))
    }
    FileHandle.standardOutput.write(try JSONEncoder().encode(Result(layers: layers)))
} catch {
    FileHandle.standardError.write(Data(error.localizedDescription.utf8))
    exit(1)
}
