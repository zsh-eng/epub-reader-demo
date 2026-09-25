"""Build bounded library metadata from cached RSS; audio remains separate.

No live feed access here. benchmark_sources/run own downloading. This snapshot
can be rebuilt offline without redoing transcription or hosted inference.
"""

import hashlib
import json
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

from benchmark_sources import NS, duration
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


def build(root):
    shows, episodes = [], []
    for slug in ["ezra", "decoder", "darknet", "99pi"]:
        folder = root if slug == "ezra" else root / "benchmark" / slug
        if not (folder / "source.json").exists():
            continue
        source = json.loads((folder / "source.json").read_text())
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
            "title": channel.findtext("title"),
            "creator": channel.findtext(NS + "author") or channel.findtext("title"),
            "description": plain_text(channel.findtext("description"), 900),
            "feed": source["feed"],
            "artwork": f"/shows/{slug}/artwork",
        }
        shows.append(show)
        for item in channel.findall("item")[:100]:
            enclosure = item.find("enclosure")
            if enclosure is None:
                continue
            audio = enclosure.get("url", "")
            if not audio.startswith(("https://", "http://")):
                continue
            title = item.findtext("title") or "Untitled episode"
            guid = item.findtext("guid") or audio
            ready = (
                audio == source["audioURL"]
                or (bool(source.get("guid")) and guid == source["guid"])
            ) and (folder / "episode.json").exists()
            local_duration = (
                json.loads((folder / "episode.json").read_text())["duration"]
                if ready
                else None
            )
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
            and (folder / "episode.json").exists()
        ):
            data = json.loads((folder / "episode.json").read_text())
            episodes.append(
                {
                    "id": hashlib.sha256(
                        f"{slug}:{source['audioURL']}".encode()
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
    (root / "library.json").write_text(json.dumps(result, separators=(",", ":")))
    print(
        f"Library: {len(shows)} shows, {len(episodes)} episodes, {sum(bool(e['preparedId']) for e in episodes)} prepared"
    )


if __name__ == "__main__":
    build(Path(sys.argv[1] if len(sys.argv) > 1 else ".local"))
