"""Conditional, bounded RSS refresh. Browsing never runs this downloader.

Keep the last valid snapshot on failure. Only metadata and one small WebP cover
are fetched; enclosures are never requested. Validators and freshness survive
restarts. Three workers bound both requests and image decoding.
"""

import argparse
import concurrent.futures
import io
import json
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
MAX_BYTES = 20 * 1024 * 1024


def catalog(path=APP / "feeds.json"):
    return json.loads(path.read_text())


def atomic(path, data):
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def refresh_feed(show, root, force=False, now=None):
    now = time.time() if now is None else now
    folder = root / "feeds" / show["id"]
    folder.mkdir(parents=True, exist_ok=True)
    xml_path, state_path = folder / "feed.xml", folder / "http.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if xml_path.exists() and not force and now - state.get("checkedAt", 0) < 3600:
        return {"id": show["id"], "status": "fresh", "bytes": 0}
    headers = {
        "User-Agent": "Undertone/0.1 (personal podcast reader)",
        "Accept": "application/rss+xml, application/xml, text/xml",
    }
    if xml_path.exists() and state.get("url") == show["feed"]:
        for key, header in (
            ("etag", "If-None-Match"),
            ("modified", "If-Modified-Since"),
        ):
            if state.get(key):
                headers[header] = state[key]
    try:
        try:
            with urllib.request.urlopen(
                urllib.request.Request(show["feed"], headers=headers), timeout=30
            ) as response:
                raw = response.read(MAX_BYTES + 1)
                if len(raw) > MAX_BYTES:
                    raise ValueError("RSS exceeds 20 MiB limit")
                channel = ET.fromstring(raw).find("channel")
                if channel is None or not channel.findtext("title"):
                    raise ValueError("Response is not an RSS podcast")
                atomic(xml_path, raw)
                state.update(
                    url=show["feed"],
                    etag=response.headers.get("ETag"),
                    modified=response.headers.get("Last-Modified"),
                )
                status, size = "updated", len(raw)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code != 304 or not xml_path.exists():
                raise
            status, size = "unchanged", 0
        state["checkedAt"] = now
        state.pop("error", None)
        atomic(state_path, json.dumps(state).encode())
        return {"id": show["id"], "status": status, "bytes": size}
    except (OSError, ValueError, ET.ParseError) as error:
        # Do not destroy the previously valid feed or advance successful freshness.
        return {
            "id": show["id"],
            "status": "stale" if xml_path.exists() else "unavailable",
            "error": str(error),
            "bytes": 0,
        }


def cover(show, root):
    from PIL import Image, ImageOps

    folder = root / "feeds" / show["id"]
    target, manifest = folder / "artwork.webp", folder / "artwork.json"
    url = show.get("artworkURL", "")
    if not url:
        return
    if (
        target.exists()
        and manifest.exists()
        and json.loads(manifest.read_text()).get("url") == url
    ):
        return
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError("Artwork exceeds 20 MiB limit")
        with Image.open(io.BytesIO(raw)) as original:
            image = ImageOps.exif_transpose(original)
            image.thumbnail((384, 384))
            encoded = io.BytesIO()
            image.convert("RGB").save(encoded, format="WEBP", quality=80, method=4)
        atomic(target, encoded.getvalue())
        atomic(manifest, json.dumps({"url": url, "size": 384, "quality": 80}).encode())
    except (OSError, ValueError) as error:
        print(show["id"], "cover unavailable:", type(error).__name__, flush=True)


def refresh(root, shows, force=False):
    root.mkdir(parents=True, exist_ok=True)

    def process(show):
        result = refresh_feed(show, root, force)
        cover(show, root)
        print(result, flush=True)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        results = list(pool.map(process, shows))
    atomic(
        root / "feed-refresh.json",
        json.dumps({"checkedAt": time.time(), "feeds": results}, indent=2).encode(),
    )
    from library import build

    build(root, shows)
    return results


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", type=Path, default=Path(".local"))
    parser.add_argument(
        "--force",
        action="store_true",
        help="Revalidate before the one-hour freshness interval; still uses HTTP validators",
    )
    args = parser.parse_args()
    refresh(args.root, catalog(), args.force)
