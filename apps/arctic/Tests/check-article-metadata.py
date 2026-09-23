#!/usr/bin/env python3
"""Run offline metadata, excerpt and stored-tag checks with an existing SwiftSoup checkout."""
import json
import http.server
import threading
import time
from pathlib import Path
import subprocess
import sys
import tempfile
from production_tag_catalog import production_tag_catalog

connections = []
large_stopped = threading.Event()
large_bytes = []
class FixtureHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *_):
        pass
    def handle(self):
        # Closing a completed keep-alive connection is expected in these checks.
        try:
            super().handle()
        except ConnectionResetError:
            pass
    def do_GET(self):
        if self.path == "/large":
            self.send_response(200)
            self.send_header("Content-Length", str(20 * 1024 * 1024))
            self.end_headers()
            sent = 0
            try:
                prefix = b"<html><title>Bounded response</title><body>"
                self.wfile.write(prefix)
                sent += len(prefix)
                for _ in range(2560):
                    self.wfile.write(b" " * 8192)
                    self.wfile.flush()
                    sent += 8192
                    time.sleep(.002)
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                large_bytes.append(sent)
                large_stopped.set()
            return
        payload = b"<html><title>Small response</title></html>"
        self.send_response(200)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.path == "/slow":
            time.sleep(3)
        else:
            connections.append(self.client_address)
        try:
            self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            pass

server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
server.daemon_threads = True
threading.Thread(target=server.serve_forever, daemon=True).start()
root = Path(__file__).resolve().parents[1]
source = (root / "Sources/ArticleStore.swift").read_text()
models = source[source.index("struct SavedArticle:"):source.index("struct ImportSummary:")]
with tempfile.TemporaryDirectory(prefix="arctic-metadata-check-") as directory:
    package = Path(directory)
    target = package / "Sources/MetadataChecks"
    target.mkdir(parents=True)
    dependency = json.dumps(str(Path(sys.argv[1]).resolve()))
    (package / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nimport PackageDescription\n'
        'let package = Package(name: "MetadataChecks", platforms: [.macOS(.v13)], '
        f'dependencies: [.package(path: {dependency})], '
        'targets: [.executableTarget(name: "MetadataChecks", dependencies: ["SwiftSoup"])])\n'
    )
    (target / "Catalog.swift").write_text(production_tag_catalog(root))
    (target / "Models.swift").write_text("import Foundation\n" + models)
    (target / "Metadata.swift").write_text((root / "Shared/ArticleMetadata.swift").read_text())
    (target / "Checks.swift").write_text((root / "Tests/ArticleMetadataChecks.swift").read_text())
    subprocess.run(["swift", "run", "--package-path", str(package), "-c", "release", "MetadataChecks", f"http://127.0.0.1:{server.server_port}"], check=True)
    assert large_stopped.wait(5), "Prefix limit did not cancel the response"
    assert large_bytes[0] < 4 * 1024 * 1024, large_bytes
    assert len(connections) == 2 and connections[0] == connections[1], connections
    print("PASS: loopback 2 MiB response cancellation, cancelled task, and reused connection")
server.shutdown()
