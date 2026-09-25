"""Freeze three public feed episodes and exact downloaded audio for repeatable tests."""

import concurrent.futures
import json
import subprocess
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
FEEDS = {
    "decoder": "https://feeds.megaphone.fm/recodedecode",
    "darknet": "https://podcast.darknetdiaries.com/",
    "99pi": "https://feeds.simplecast.com/BqbsxVfO",
}
NS = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"


def duration(text):
    if not text:
        return 0
    value = 0
    for part in text.split(":"):
        value = value * 60 + float(part)
    return value


def prepare(root, slug, feed):
    folder = root / slug
    folder.mkdir(parents=True, exist_ok=True)
    source_path = folder / "source.json"
    if not source_path.exists():
        with urllib.request.urlopen(feed, timeout=60) as response:
            raw = response.read()
        (folder / "feed.xml").write_bytes(raw)
        channel = ET.fromstring(raw).find("channel")
        item = next(
            i
            for i in channel.findall("item")
            if i.find("enclosure") is not None
            and 900 <= duration(i.findtext(NS + "duration")) <= 5400
            and i.findtext(NS + "episodeType", "full") == "full"
        )
        image = channel.find(NS + "image")
        source = {
            "title": item.findtext("title"),
            "show": channel.findtext("title"),
            "showDescription": channel.findtext("description") or "",
            "description": item.findtext("description") or "",
            "published": item.findtext("pubDate"),
            "source": item.findtext("link") or feed,
            "audioURL": item.find("enclosure").get("url"),
            "artworkURL": image.get("href") if image is not None else "",
            "feed": feed,
            "guid": item.findtext("guid"),
        }
        source_path.write_text(json.dumps(source, indent=2))
    source = json.loads(source_path.read_text())
    from download import download

    result = download(source["audioURL"], folder / "episode.mp3")
    print(f"{slug}: {source['title']} ({result['bytes']} bytes)", flush=True)
    return {
        "slug": slug,
        "title": source["title"],
        "show": source["show"],
        "feed": feed,
        "source": source["source"],
        "audioHash": result["sha256"],
    }


if __name__ == "__main__":
    root = Path(sys.argv[1]).resolve()
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        jobs = [pool.submit(prepare, root, slug, feed) for slug, feed in FEEDS.items()]
        episodes = [job.result() for job in jobs]
    (root / "episodes.json").write_text(json.dumps(episodes, indent=2))
    for episode in episodes:
        folder = root / episode["slug"]
        print(f"Local processing: {episode['slug']}", flush=True)
        with (folder / "local-pipeline.log").open("w") as log:
            subprocess.run(
                [
                    sys.executable,
                    str(APP / "pipeline/run.py"),
                    "--data-dir",
                    str(folder),
                    "--local-only",
                ],
                stdout=log,
                stderr=log,
                check=True,
            )
        print(f"Local processing complete: {episode['slug']}", flush=True)
