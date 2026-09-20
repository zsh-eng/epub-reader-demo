#!/usr/bin/env python3
"""Run production import checks without an iOS simulator.

Usage: python3 check-reading-list.py /path/to/SwiftSoup [Chrome-export.html]
Pass an existing SwiftSoup checkout to keep validation offline.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "Sources/ArticleStore.swift").read_text()
models = source[source.index("struct SavedArticle:"):source.index("struct ImportSummary:")]
parser = source[source.index("enum ReadingListImport {"):source.index("/// Paste, save and speculative")]
with tempfile.TemporaryDirectory(prefix="arctic-import-check-") as directory:
    package = Path(directory)
    target = package / "Sources/ImportChecks"
    target.mkdir(parents=True)
    dependency = json.dumps(str(Path(sys.argv[1]).resolve()))
    (package / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nimport PackageDescription\n'
        'let package = Package(name: "ImportChecks", platforms: [.macOS(.v13)], '
        f'dependencies: [.package(path: {dependency})], '
        'targets: [.executableTarget(name: "ImportChecks", dependencies: ["SwiftSoup"])])\n'
    )
    (target / "Import.swift").write_text("import Foundation\nimport SwiftSoup\n" + models + parser)
    (target / "Checks.swift").write_text((root / "Tests/ReadingListImportChecks.swift").read_text())
    subprocess.run(["swift", "run", "--package-path", str(package), "-c", "release", "ImportChecks", *sys.argv[2:]], check=True)
