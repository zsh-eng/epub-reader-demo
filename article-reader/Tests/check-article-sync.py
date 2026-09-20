#!/usr/bin/env python3
"""Compile the production repository/model and run focused domain-sync tests."""
import json
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "Sources/ArticleStore.swift").read_text()
models = source[source.index("struct SavedArticle:"):source.index("struct ImportSummary:")]
with tempfile.TemporaryDirectory(prefix="arctic-domain-check-") as directory:
    package = Path(directory)
    target = package / "Sources/ArticleSyncBridge"
    tests = package / "Tests/ArticleSyncBridgeTests"
    target.mkdir(parents=True)
    tests.mkdir(parents=True)
    (package / "Package.swift").write_text(
        '// swift-tools-version: 6.0\nimport PackageDescription\n'
        'let package = Package(name: "ArticleSyncBridge", platforms: [.macOS(.v14)], '
        f'dependencies: [.package(path: {json.dumps(str(root / "Sync"))})], '
        'targets: [.target(name: "ArticleSyncBridge", dependencies: [.product(name: "ArcticSync", package: "Sync")]), '
        '.testTarget(name: "ArticleSyncBridgeTests", dependencies: ["ArticleSyncBridge", .product(name: "ArcticSync", package: "Sync")])])\n'
    )
    (target / "Models.swift").write_text("import Foundation\n" + models)
    (target / "ArticleSyncRepository.swift").write_text((root / "Sources/ArticleSyncRepository.swift").read_text())
    (tests / "ArticleSyncRepositoryTests.swift").write_text((root / "Tests/ArticleSyncRepositoryTests.swift").read_text())
    subprocess.run(["swift", "test", "--package-path", str(package)], check=True)
