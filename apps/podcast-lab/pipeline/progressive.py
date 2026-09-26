"""Publish cumulative, independently named analysis snapshots for exact audio.

Speech models remain sequential. Each stage owns a complete speaker mapping;
no acoustic ID is carried from one Senko run into another naming request.
"""

import concurrent.futures
import json
import os
import shutil
import subprocess
from pathlib import Path

APP = Path(__file__).resolve().parents[1]
RECIPE = "cumulative-v1"


def atomic(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, separators=(",", ":")))
    temp.replace(path)


def analyse(root, status, *, milestones=(300, 1800), lookahead=90):
    from align import align
    from avatars import prepare_avatars
    from enrich import run as enrich
    from prepare_player import prepare as materialize
    from sequences import VERSION
    from sequences import run as classify

    root = root.resolve()
    source = json.loads((root / "source.json").read_text())
    identity = json.loads((root / "episode.mp3.download.json").read_text())
    duration = float(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(root / "episode.mp3"),
            ],
            text=True,
        )
    )
    # Avoid a redundant prefix pass when the whole episode is almost available.
    ends = [t for t in milestones if t + lookahead < duration] + [duration]
    mlx = Path(
        os.environ.get(
            "PARAKEET_PYTHON",
            str(Path.home() / ".local/share/uv/tools/parakeet-mlx/bin/python"),
        )
    )

    def publish(payload):
        atomic(root / "analysis.json", payload)
        atomic(
            root / "analysis-state.json",
            {
                "analysisRevision": payload["analysisRevision"],
                "coverageEnd": payload["coverageEnd"],
                "analysisComplete": payload["analysisComplete"],
            },
        )

    for revision, end in enumerate(ends, 1):
        final = revision == len(ends)
        context_end = min(duration, end + lookahead)
        folder = root / "passes" / f"{RECIPE}-{revision}"
        folder.mkdir(parents=True, exist_ok=True)
        manifest = {
            "audioHash": identity["sha256"],
            "end": end,
            "contextEnd": context_end,
            "final": final,
            "recipe": RECIPE,
        }
        saved = folder / "manifest.json"
        if saved.exists() and json.loads(saved.read_text()) != manifest:
            raise ValueError(
                "Analysis checkpoint belongs to different audio or milestones"
            )
        atomic(saved, manifest)
        completed = folder / "published.json"
        if completed.exists():
            payload = json.loads(completed.read_text())
            # On retry, never publish an older revision over the last good one.
            state = root / "analysis-state.json"
            old = (
                json.loads(state.read_text()).get("analysisRevision", 0)
                if state.exists()
                else 0
            )
            if revision >= old:
                publish(payload)
            continue
        for name in ("episode.mp3", "episode.mp3.download.json"):
            if not (folder / name).exists():
                os.link(root / name, folder / name)
        atomic(
            folder / "source.json",
            {
                **source,
                "analysisScope": "Complete episode"
                if final
                else f"Episode prefix through {context_end:.1f} seconds. Later audio is not yet available. Name the current speaker IDs afresh; supply chapters only for this prefix.",
            },
        )
        if not (folder / "episode.wav").exists():
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-nostdin",
                    "-v",
                    "error",
                    "-i",
                    str(root / "episode.mp3"),
                    "-t",
                    str(context_end),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    "-c:a",
                    "pcm_s16le",
                    str(folder / "episode.partial.wav"),
                ],
                check=True,
                timeout=600,
            )
            (folder / "episode.partial.wav").replace(folder / "episode.wav")
        for engine, filename, python, phase in (
            ("mlx", "asr.json", mlx, "transcribing"),
            ("diarize", "diarization.json", APP / ".venv/bin/python", "speakers"),
        ):
            status(
                phase,
                f"{'Transcribing' if engine == 'mlx' else 'Separating speakers'} through {int(end // 60)}:{int(end % 60):02d}",
                targetSeconds=end,
            )
            output = folder / filename
            # Existing full-episode checkpoints remain usable on interrupted old jobs.
            if final and not output.exists() and (root / filename).exists():
                shutil.copyfile(root / filename, output)
            if not output.exists():
                temp = folder / (filename + ".tmp")
                subprocess.run(
                    [
                        str(python),
                        str(APP / "pipeline/transcribe.py"),
                        engine,
                        str(folder / "episode.wav"),
                        str(temp),
                        *(
                            ["--status", str(root / "status.json")]
                            if engine == "mlx"
                            else []
                        ),
                    ],
                    check=True,
                    timeout=3600,
                )
                temp.replace(output)
        blocks = align(
            json.loads((folder / "asr.json").read_text())["result"],
            json.loads((folder / "diarization.json").read_text())["result"]["segments"],
        )
        if not blocks:
            if final:
                raise ValueError("No speech found")
            (folder / "episode.wav").unlink(missing_ok=True)
            continue
        atomic(folder / "blocks.json", blocks)
        status("analysing", "Finding names, chapters and promotions", targetSeconds=end)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [
                pool.submit(enrich, folder),
                pool.submit(
                    classify, folder, cache_root=root, through=None if final else end
                ),
            ]
            for job in jobs:
                job.result()
        status("finishing", "Publishing transcript", targetSeconds=end)
        prepare_avatars(folder, root.parent.parent)
        materialize(folder, f"{VERSION}.json", through=None if final else end)
        payload = json.loads((folder / "episode.json").read_text())
        payload.update(
            analysisRevision=revision, coverageEnd=end, analysisComplete=final
        )
        atomic(completed, payload)
        publish(payload)
        (folder / "episode.wav").unlink(missing_ok=True)
    payload = json.loads((root / "analysis.json").read_text())
    if not payload["analysisComplete"]:
        raise ValueError("Final analysis was not published")
    atomic(root / "episode.json", payload)
