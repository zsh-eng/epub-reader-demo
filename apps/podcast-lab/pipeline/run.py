"""Repeat the one-episode experiment; checkpoints are bound to exact audio bytes."""

import argparse
import concurrent.futures
import json
import os
import subprocess
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
FEED = "https://feeds.simplecast.com/82FI35Px"
EPISODE_ID = "f3e11617-fc5d-4268-9dcc-fb47bec1433d"


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=APP / ".local")
    parser.add_argument(
        "--local-only",
        action="store_true",
        help="Stop after transcription/diarization; no transcript sent to hosted models",
    )
    args = parser.parse_args()
    root = args.data_dir.resolve()
    root.mkdir(parents=True, exist_ok=True)
    source_path = root / "source.json"
    if not source_path.exists():
        with urllib.request.urlopen(FEED, timeout=45) as response:
            rss = ET.fromstring(response.read())
        channel = rss.find("channel")
        item = next(
            i
            for i in channel.findall("item")
            if EPISODE_ID in i.find("enclosure").get("url")
        )
        ns = "{http://www.itunes.com/dtds/podcast-1.0.dtd}"
        source = {
            "title": item.findtext("title"),
            "show": channel.findtext("title"),
            "showDescription": channel.findtext("description")
            or channel.findtext(ns + "summary")
            or "",
            "published": item.findtext("pubDate"),
            "description": item.findtext("description"),
            "source": item.findtext("link"),
            "audioURL": item.find("enclosure").get("url"),
            "artworkURL": channel.find(ns + "image").get("href"),
            "feed": FEED,
        }
        source_path.write_text(json.dumps(source, indent=2))
    source = json.loads(source_path.read_text())
    from download import download

    audio = download(source["audioURL"], root / "episode.mp3")
    manifest = {
        "audioHash": audio["sha256"],
        "recipe": "podcast-lab-1",
        "asr": "mlx-community/parakeet-tdt-0.6b-v3",
        "asrRuntime": "parakeet-mlx-0.5.0",
        "asrChunkSeconds": 90,
        "asrOverlapSeconds": 10,
        "diarization": "senko-0.1.0",
    }
    manifest_path = root / "manifest.json"
    if manifest_path.exists() and json.loads(manifest_path.read_text()) != manifest:
        raise ValueError(
            "Audio or recipe changed. Choose a fresh --data-dir to avoid stale timestamps."
        )
    manifest_path.write_text(json.dumps(manifest, indent=2))
    # Run heavy stages in separate processes, sequentially, on 16 GB machines.
    mlx_python = Path(
        os.environ.get(
            "PARAKEET_PYTHON",
            str(Path.home() / ".local/share/uv/tools/parakeet-mlx/bin/python"),
        )
    )
    local_python = APP / ".venv/bin/python"

    def stage(engine, output, python):
        if (root / output).exists():
            return
        subprocess.run(
            [
                str(python),
                str(APP / "pipeline/transcribe.py"),
                engine,
                str(root / "episode.wav"),
                str(root / output),
            ],
            check=True,
        )

    if not (root / "episode.wav").exists():
        subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(root / "episode.mp3"),
                "-ac",
                "1",
                "-ar",
                "16000",
                "-c:a",
                "pcm_s16le",
                str(root / "episode.wav"),
            ],
            check=True,
        )
    stage("mlx", "asr.json", mlx_python)
    stage("diarize", "diarization.json", local_python)
    from align import align

    blocks = align(
        json.loads((root / "asr.json").read_text())["result"],
        json.loads((root / "diarization.json").read_text())["result"]["segments"],
    )
    (root / "blocks.json").write_text(json.dumps(blocks, indent=2))
    if args.local_only:
        print(
            "Local transcription and speaker separation complete. No transcript was sent to Jev or Codex."
        )
        return
    if not os.environ.get("JEV_API_KEY"):
        raise RuntimeError(
            "Set JEV_API_KEY in the process environment. Do not put it in the browser or repository."
        )
    from classify import run as classify
    from enrich import run as enrich

    # Hosted text work can overlap without retaining two local speech models.
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(classify, root)]
        jobs.append(pool.submit(enrich, root))
        for job in jobs:
            job.result()
    subprocess.run(
        [str(local_python), str(APP / "pipeline/assets.py"), str(root)], check=True
    )
    from prepare_player import prepare

    prepare(root)
    print(f"Player data ready in {root}. Run bun run dev in {APP}.")


if __name__ == "__main__":
    run()
