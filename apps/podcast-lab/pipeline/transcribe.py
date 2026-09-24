"""Separate processes keep MLX and CoreML/Photon memory from overlapping."""

import argparse
import dataclasses
import json
import resource
import time
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("engine", choices=["mlx", "redux", "diarize"])
p.add_argument("audio", type=Path)
p.add_argument("output", type=Path)
p.add_argument("--device", default="cpu")
a = p.parse_args()
t = time.monotonic()
if a.engine == "mlx":
    from parakeet_mlx import from_pretrained

    model = from_pretrained("mlx-community/parakeet-tdt-0.6b-v3")
    loaded = time.monotonic()
    result = dataclasses.asdict(
        model.transcribe(a.audio, chunk_duration=90, overlap_duration=10)
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
