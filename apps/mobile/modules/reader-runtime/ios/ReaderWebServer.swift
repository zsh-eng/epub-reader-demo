import Foundation
import Network

/// A read-only HTTP origin for bundled browser assets and staged EPUBs. It binds
/// only to loopback, never exposes arbitrary device paths, and closes each
/// connection after its response. EPUB bytes bypass the string message bridge.
final class ReaderWebServer {
  static let port: UInt16 = 18765
  let origin = "http://127.0.0.1:\(ReaderWebServer.port)"
  let inbox = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    .appendingPathComponent("Reader Imports", isDirectory: true)
  private let queue = DispatchQueue(label: "app.reader.web-server")
  private var listener: NWListener?
  private var webRoot: URL?

  func start(completion: @escaping (Result<String, Error>) -> Void) {
    queue.async {
      if self.listener != nil { completion(.success(self.origin)); return }
      guard let bundleURL = Bundle.main.url(forResource: "ReaderWeb", withExtension: "bundle"),
            let bundle = Bundle(url: bundleURL),
            let root = bundle.url(forResource: "web", withExtension: nil),
            FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path)
      else { completion(.failure(RuntimeError.missingWebAssets)); return }
      self.webRoot = root
      do {
        let parameters = NWParameters.tcp
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: Self.port)!)
        let listener = try NWListener(using: parameters)
        var answered = false
        listener.stateUpdateHandler = { state in
          guard !answered else { return }
          switch state {
          case .ready:
            answered = true
            self.listener = listener
            completion(.success(self.origin))
          case .failed(let error):
            answered = true
            listener.cancel()
            completion(.failure(error))
          default: break
          }
        }
        listener.newConnectionHandler = { connection in
          connection.start(queue: self.queue)
          self.readRequest(connection, buffered: Data())
        }
        listener.start(queue: self.queue)
      } catch { completion(.failure(error)) }
    }
  }

  func importDirectory(_ id: String) throws -> URL {
    let directory = inbox.appendingPathComponent(id, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory
  }

  func importDescriptor(id: String, name: String) -> [String: String] {
    ["id": id, "name": name, "url": "\(origin)/native-import/\(id)"]
  }

  private func readRequest(_ connection: NWConnection, buffered: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, complete, error in
      var request = buffered
      if let data { request.append(data) }
      guard request.count <= 32_768, error == nil else { connection.cancel(); return }
      if request.range(of: Data("\r\n\r\n".utf8)) != nil {
        self.respond(connection, request: request)
      } else if complete {
        connection.cancel()
      } else {
        self.readRequest(connection, buffered: request)
      }
    }
  }

  private func respond(_ connection: NWConnection, request: Data) {
    let firstLine = String(decoding: request, as: UTF8.self).components(separatedBy: "\r\n")[0]
    let parts = firstLine.split(separator: " ")
    guard parts.count == 3, parts[0] == "GET",
          let path = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding,
          path.hasPrefix("/"), !path.split(separator: "/").contains(".."), !path.contains("\\"),
          let root = webRoot
    else { send(connection, status: "400 Bad Request", data: Data(), type: "text/plain"); return }

    let file: URL
    if path.hasPrefix("/native-import/") {
      let id = String(path.dropFirst("/native-import/".count))
      guard UUID(uuidString: id) != nil else {
        send(connection, status: "404 Not Found", data: Data(), type: "text/plain"); return
      }
      file = inbox.appendingPathComponent(id).appendingPathComponent("book.epub")
    } else if path.hasPrefix("/api/") {
      send(connection, status: "503 Service Unavailable", data: Data(), type: "text/plain"); return
    } else {
      let candidate = root.appendingPathComponent(String(path.dropFirst()))
      var isDirectory: ObjCBool = false
      if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue {
        file = candidate
      } else if URL(fileURLWithPath: path).pathExtension.isEmpty {
        file = root.appendingPathComponent("index.html")
      } else {
        send(connection, status: "404 Not Found", data: Data(), type: "text/plain"); return
      }
    }
    guard let bytes = try? Data(contentsOf: file, options: .mappedIfSafe) else {
      send(connection, status: "404 Not Found", data: Data(), type: "text/plain"); return
    }
    send(connection, status: "200 OK", data: bytes, type: mimeType(file.pathExtension))
  }

  private func send(_ connection: NWConnection, status: String, data: Data, type: String) {
    let headers = "HTTP/1.1 \(status)\r\nContent-Type: \(type)\r\nContent-Length: \(data.count)\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
    connection.send(content: Data(headers.utf8), completion: .contentProcessed { error in
      guard error == nil else { connection.cancel(); return }
      connection.send(content: data, completion: .contentProcessed { _ in connection.cancel() })
    })
  }

  private func mimeType(_ ext: String) -> String {
    switch ext.lowercased() {
    case "html": return "text/html; charset=utf-8"
    case "js", "mjs": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json": return "application/json"
    case "wasm": return "application/wasm"
    case "woff": return "font/woff"
    case "woff2": return "font/woff2"
    case "ttf": return "font/ttf"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "webp": return "image/webp"
    case "epub": return "application/epub+zip"
    default: return "application/octet-stream"
    }
  }
}
