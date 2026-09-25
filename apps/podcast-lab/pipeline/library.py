"""Build bounded library metadata from cached RSS; audio remains separate.

No live feed access here. feeds.py owns conditional downloading. This snapshot
can be rebuilt offline without redoing transcription or hosted inference.
"""

import argparse
import gzip
import hashlib
import json
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

from benchmark_sources import NS, duration
from feeds import atomic, catalog
from metadata import plain_text


def web_url(value, fallback):
    parsed = urlparse(value or "")
    return value if parsed.scheme in {"https", "http"} and parsed.netloc else fallback


def published_iso(value):
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (ValueError, TypeError):
        try:
            return datetime.fromisoformat(value).astimezone(timezone.utc).isoformat()
        except (ValueError, TypeError):
            return ""


def build(root, catalog_entries=None, output=None):
    shows, episodes = [], []
    for entry in catalog() if catalog_entries is None else catalog_entries:
        slug = entry["id"]
        folder = root if slug == "ezra" else root / "benchmark" / slug
        source_path = folder / "source.json"
        source = (
            json.loads(source_path.read_text())
            if source_path.exists()
            else {
                "show": entry["title"],
                "feed": entry["feed"],
                "audioURL": "",
            }
        )
        feed = root / "feeds" / slug / "feed.xml"
        if not feed.exists():
            feed = folder / "feed.xml"
        if feed.exists():
            channel = ET.fromstring(feed.read_bytes()).find("channel")
        else:
            # A previously prepared single episode is sufficient for a library.
            channel = ET.Element("channel")
            ET.SubElement(channel, "title").text = source["show"]
            ET.SubElement(channel, "description").text = source.get(
                "showDescription", ""
            )
        show = {
            "id": slug,
            "title": channel.findtext("title") or entry["title"],
            "creator": channel.findtext(NS + "author")
            or entry.get("creator")
            or channel.findtext("title"),
            "description": plain_text(channel.findtext("description"), 900),
            "feed": entry["feed"],
            "artwork": f"/shows/{slug}/artwork",
            "cached": feed.exists(),
        }
        shows.append(show)
        prepared_path = folder / "episode.json"
        prepared = (
            json.loads(prepared_path.read_text()) if prepared_path.exists() else None
        )
        seen = set()
        # Newest publication dates first even when an RSS host uses archive order.
        items = sorted(
            channel.findall("item"),
            key=lambda i: published_iso(i.findtext("pubDate")),
            reverse=True,
        )
        for item in items:
            enclosure = item.find("enclosure")
            if enclosure is None:
                continue
            audio = enclosure.get("url", "")
            if not audio.startswith(("https://", "http://")):
                continue
            title = item.findtext("title") or "Untitled episode"
            guid = item.findtext("guid") or audio
            if guid in seen or len(seen) >= 100:
                continue
            seen.add(guid)
            ready = (
                audio == source["audioURL"]
                or (bool(source.get("guid")) and guid == source["guid"])
            ) and prepared is not None
            local_duration = prepared["duration"] if ready else None
            published = published_iso(item.findtext("pubDate"))
            episodes.append(
                {
                    "id": hashlib.sha256(f"{slug}:{guid}".encode()).hexdigest()[:20],
                    "showId": slug,
                    "title": title,
                    "description": plain_text(item.findtext("description"), 1600),
                    "published": published,
                    "duration": local_duration
                    if ready
                    else duration(item.findtext(NS + "duration")),
                    "audioURL": audio,
                    "source": web_url(item.findtext("link"), source["feed"]),
                    "preparedId": slug if ready else None,
                }
            )
        # Preserve a prepared older episode even when it has left the feed window.
        if (
            not any(e["showId"] == slug and e["preparedId"] for e in episodes)
            and prepared is not None
        ):
            data = prepared
            episodes.append(
                {
                    "id": hashlib.sha256(
                        f"{slug}:{source.get('guid') or source['audioURL']}".encode()
                    ).hexdigest()[:20],
                    "showId": slug,
                    "title": data["title"],
                    "description": data["summary"],
                    "published": published_iso(data["published"]),
                    "duration": data["duration"],
                    "audioURL": source["audioURL"],
                    "source": web_url(source["source"], source["feed"]),
                    "preparedId": slug,
                }
            )
    episodes.sort(key=lambda e: e["published"], reverse=True)
    result = {"shows": shows, "episodes": episodes}
    target = output or root / "library.json"
    encoded = json.dumps(result, separators=(",", ":")).encode()
    atomic(target, encoded)
    atomic(target.with_suffix(target.suffix + ".gz"), gzip.compress(encoded, mtime=0))
    print(
        f"Library: {len(shows)} shows, {len(episodes)} episodes, {sum(bool(e['preparedId']) for e in episodes)} prepared"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", type=Path, default=Path(".local"))
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    build(args.root, catalog(args.catalog) if args.catalog else None, args.output)
