"""Prepare one catalog episode. Atomic status is the only worker log sent to UI.

A global file lock keeps local speech models sequential, including across server
restarts. Completed outputs are reused only within an immutable audio manifest.
Hosted text stages overlap after the local models exit; audio stays on this Mac.
"""

import fcntl
import json
import os
import sys
import time
from pathlib import Path

APP = Path(__file__).resolve().parents[1]


def atomic(path, value):
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value))
    temp.replace(path)


def prepare(root):
    phase = "queued"

    def status(next_phase, detail, **extra):
        nonlocal phase
        phase = next_phase
        atomic(
            root / "status.json",
            {
                "id": root.name,
                "phase": phase,
                "detail": detail,
                "ownerPID": os.getpid(),
                **extra,
            },
        )

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
            last_report = 0.0

            def download_progress(received, total):
                nonlocal last_report
                now = time.monotonic()
                if now - last_report < 0.5 and received != total:
                    return
                last_report = now
                status(
                    "downloading",
                    "Downloading audio",
                    downloadedBytes=received,
                    totalBytes=total or None,
                )

            audio = download(
                source["audioURL"], root / "episode.mp3", download_progress
            )
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
            from progressive import analyse

            analyse(root, status)
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
