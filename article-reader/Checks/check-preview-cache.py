#!/usr/bin/env python3
"""Exercise production PreviewImageDisk on macOS without UIKit or network requests."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
source = (root / "Sources/LibrarySearch.swift").read_text()
actor = source[source.index("actor PreviewImageDisk {"):]
with tempfile.TemporaryDirectory(prefix="arctic-preview-check-") as directory:
    temporary = Path(directory)
    extracted = temporary / "PreviewImageDisk.swift"
    extracted.write_text("import Foundation\nimport CryptoKit\n" + actor)
    binary = temporary / "checks"
    subprocess.run([
        "swiftc", "-O", str(extracted), str(root / "Sources/PreviewImageWorkLimit.swift"),
        str(root / "Sources/PreviewImageCodec.swift"), str(root / "Checks/PreviewImageDiskChecks.swift"),
        "-o", str(binary)
    ], check=True)
    subprocess.run([
        str(binary), str(root / "Resources/Assets.xcassets/OnboardingArticle.imageset/glacial-longings.jpg")
    ], check=True)
