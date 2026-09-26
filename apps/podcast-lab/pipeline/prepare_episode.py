"""Prepare one catalog episode. Atomic status is the only worker log sent to UI.

A global file lock keeps local speech models sequential, including across server
restarts. Completed outputs are reused only within an immutable audio manifest.
Hosted text stages overlap after the local models exit; audio stays on this Mac.
"""

import concurrent.futures
import fcntl
import json
import os
import subprocess
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def atomic(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value))
    temp.replace(path)


def prepare(root):
    phase = "queued"

    def status(next_phase, detail):
        nonlocal phase
        phase = next_phase
        atomic(
            root / "status.json",
            {
                "id": root.name,
                "phase": phase,
                "detail": detail,
                "ownerPID": os.getpid(),
            },
        )

    def stage(engine, output, python):
        if (root / output).exists():
            return
        temp = root / (output + ".tmp")
        subprocess.run(
            [
                str(python),
                str(APP / "pipeline/transcribe.py"),
                engine,
                str(root / "episode.wav"),
                str(temp),
            ],
            check=True,
            timeout=3600,
        )
        temp.replace(root / output)

    status("queued", "Waiting for local preparation")
    try:
        with (root.parent / "worker.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if not os.environ.get("JEV_API_KEY"):
                status(
                    "failed",
                    "Jev is not configured on this Mac. Set JEV_API_KEY on the server, then retry.",
                )
                return
            source = json.loads((root / "source.json").read_text())
            from download import download

            status("downloading", "Downloading audio")
            audio = download(source["audioURL"], root / "episode.mp3")
            manifest = {
                "audioHash": audio["sha256"],
                "recipe": "background-1",
                "asr": "parakeet-v3",
                "diarization": "senko",
            }
            manifest_file = root / "manifest.json"
            if (
                manifest_file.exists()
                and json.loads(manifest_file.read_text()) != manifest
            ):
                raise ValueError("Audio identity changed")
            atomic(manifest_file, manifest)
            status("converting", "Preparing audio")
            if not (root / "episode.wav").exists():
                temp = root / "episode.partial.wav"
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-nostdin",
                        "-v",
                        "error",
                        "-i",
                        str(root / "episode.mp3"),
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        "-c:a",
                        "pcm_s16le",
                        str(temp),
                    ],
                    check=True,
                    timeout=600,
                )
                temp.replace(root / "episode.wav")
            status("transcribing", "Transcribing on your Mac")
            mlx = Path(
                os.environ.get(
                    "PARAKEET_PYTHON",
                    str(Path.home() / ".local/share/uv/tools/parakeet-mlx/bin/python"),
                )
            )
            stage("mlx", "asr.json", mlx)
            status("speakers", "Separating speakers")
            stage("diarize", "diarization.json", APP / ".venv/bin/python")
            from align import align

            blocks = align(
                json.loads((root / "asr.json").read_text())["result"],
                json.loads((root / "diarization.json").read_text())["result"][
                    "segments"
                ],
            )
            if not blocks:
                status("failed", "No speech was found in this audio.")
                return
            atomic(root / "blocks.json", blocks)
            status("analysing", "Finding chapters and promotions")
            from enrich import run as enrich
            from sequences import VERSION
            from sequences import run as classify

            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                jobs = [pool.submit(classify, root), pool.submit(enrich, root)]
                for job in jobs:
                    job.result()
            status("finishing", "Finishing your transcript")
            from prepare_player import prepare as materialize

            materialize(root, f"{VERSION}.json")
            # Public episode.json is only exposed after this atomic ready marker.
            status("ready", "Transcript ready")
            # PCM is a large, regenerable intermediate. Keep the original MP3 and
            # small model checkpoints for retry, audit and exact-timestamp playback.
            (root / "episode.wav").unlink(missing_ok=True)
    except Exception:
        import traceback

        traceback.print_exc()  # private local worker.log, never a browser response
        status("failed", f"Could not finish {phase}. Retry to continue.")
        raise


if __name__ == "__main__":
    prepare(Path(sys.argv[1]).resolve())
