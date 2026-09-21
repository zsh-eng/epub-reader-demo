#!/usr/bin/env python3
"""Compile the production repository/model and run focused domain-sync tests."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from production_tag_catalog import production_tag_catalog

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--configuration", choices=["debug", "release"], default="debug")
parser.add_argument("--performance", action="store_true", help="Run only the 1k/10k performance checks")
arguments = parser.parse_args()
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
    (target / "Catalog.swift").write_text(production_tag_catalog(root))
    (target / "Models.swift").write_text("import Foundation\n" + models)
    (target / "ArticleSyncRepository.swift").write_text((root / "Sources/ArticleSyncRepository.swift").read_text())
    test_name = "ArticleSyncPerformanceChecks.swift" if arguments.performance else "ArticleSyncRepositoryTests.swift"
    (tests / test_name).write_text((root / "Tests" / test_name).read_text())
    subprocess.run(["swift", "test", "--package-path", str(package), "-c", arguments.configuration], check=True)
