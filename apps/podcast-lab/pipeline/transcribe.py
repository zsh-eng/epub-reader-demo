"""Separate processes keep MLX and CoreML/Photon memory from overlapping."""

import argparse
import dataclasses
import json
import math
import resource
import time
import wave
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("engine", choices=["mlx", "redux", "diarize"])
p.add_argument("audio", type=Path)
p.add_argument("output", type=Path)
p.add_argument("--device", default="cpu")
p.add_argument("--status", type=Path)
a = p.parse_args()


def report(detail, **progress):
    if not a.status:
        return
    # Keep the parent worker's identity: it owns this job between child stages.
    state = json.loads(a.status.read_text())
    state.update(detail=detail, **progress)
    temp = a.status.with_suffix(a.status.suffix + ".tmp")
    temp.write_text(json.dumps(state))
    temp.replace(a.status)


t = time.monotonic()
if a.engine == "mlx":
    report("Loading transcription model")
    from parakeet_mlx import from_pretrained

    model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
    loaded = time.monotonic()
    # Preparation always supplies PCM WAV. Other CLI callers need no status.
    total_chunks = 1
    if a.status:
        with wave.open(str(a.audio)) as audio:
            duration = audio.getnframes() / audio.getframerate()
        total_chunks = 1 if duration <= 90 else math.ceil(duration / 80)
    report("Transcribing on your Mac", completedChunks=0, totalChunks=total_chunks)
    started_chunks = 0

    def chunk_started(position, total):
        global started_chunks
        started_chunks += 1
        # MLX calls back BEFORE inference. Only the preceding chunks are done.
        report(
            "Transcribing on your Mac",
            completedChunks=started_chunks - 1,
            totalChunks=total_chunks,
        )

    result = dataclasses.asdict(
        model.transcribe(
            a.audio,
            chunk_duration=90,
            overlap_duration=10,
            chunk_callback=chunk_started if a.status else None,
        )
    )
    report(
        "Transcription complete",
        completedChunks=total_chunks,
        totalChunks=total_chunks,
    )
elif a.engine == "redux":
    import moondream as md

    with md.photon("moondream/parakeet-redux", device=a.device) as model:
        loaded = time.monotonic()
        result = model.transcribe(audio=str(a.audio), timestamps="word")
else:
    import senko

    model = senko.Diarizer(device="auto", warmup=True, quiet=False)
    loaded = time.monotonic()
    result = model.diarize(str(a.audio), generate_colors=False)
    result = {"segments": result["merged_segments"]}
finished = time.monotonic()
metrics = {
    "engine": a.engine,
    "device": "Metal"
    if a.engine == "mlx"
    else "CoreML/CPU"
    if a.engine == "diarize"
    else a.device,
    "loadSeconds": round(loaded - t, 3),
    "inferenceSeconds": round(finished - loaded, 3),
    "totalSeconds": round(finished - t, 3),
    "peakRSSBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
}
a.output.write_text(
    json.dumps(
        {"metrics": metrics, "result": result},
        indent=2,
        default=lambda o: o.item() if hasattr(o, "item") else o.tolist(),
    )
)
print(json.dumps(metrics), flush=True)
