"""Prepare small local portraits from reviewed profile sources, never raw search hits.

The catalog is keyed by a named person, not episode-specific acoustic IDs.
Only host/guest labels qualify. Missing portraits retain the player's initials.
Original image bytes are discarded; the player receives content-addressed WebP.
"""

import hashlib
import json
import sys
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

CATALOG = Path(__file__).resolve().parents[1] / "avatar-sources.json"


def prepare_avatars(root):
    sources = json.loads(CATALOG.read_text())
    speakers = json.loads((root / "enrichment.json").read_text())["speakers"]
    names = {
        s["name"]
        for s in speakers
        if s["confidence"] != "unknown" and s["role"].lower() in {"host", "guest"}
    }
    folder = root / "avatars"
    folder.mkdir(exist_ok=True)
    manifest = root / "avatars.json"
    cached = json.loads(manifest.read_text()) if manifest.exists() else {}
    output = {}
    for source in sources:
        name = source["name"]
        if name not in names:
            continue
        recipe = hashlib.sha256(
            json.dumps(
                {"source": source, "recipe": "96px-webp-q82-v1"}, sort_keys=True
            ).encode()
        ).hexdigest()
        previous = cached.get(name)
        if (
            previous
            and previous["recipe"] == recipe
            and (folder / previous["file"]).exists()
        ):
            output[name] = previous
            continue
        try:
            request = urllib.request.Request(
                source["imageURL"], headers={"User-Agent": "UndertoneLocalPreview/1.0"}
            )
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
            if len(raw) > 8 * 1024 * 1024:
                raise ValueError("Portrait exceeds 8 MB")
            with Image.open(BytesIO(raw)) as original:
                portrait = ImageOps.fit(
                    ImageOps.exif_transpose(original).convert("RGB"),
                    (96, 96),
                    method=Image.Resampling.LANCZOS,
                )
                encoded = BytesIO()
                portrait.save(encoded, "WEBP", quality=82, method=6)
            data = encoded.getvalue()
            filename = hashlib.sha256(data).hexdigest() + ".webp"
            (folder / filename).write_bytes(data)
            output[name] = {
                **source,
                "recipe": recipe,
                "file": filename,
                "bytes": len(data),
            }
            print(f"{name}: 96x96 WebP, {len(data)} bytes")
        except (OSError, ValueError, urllib.error.URLError) as error:
            print(
                f"Portrait unavailable for {name}: {type(error).__name__}; using initials"
            )
    manifest.write_text(json.dumps(output, indent=2))


if __name__ == "__main__":
    prepare_avatars(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".local"))
