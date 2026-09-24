"""Cache a display-sized show cover and a small waveform; never ship PCM to the UI."""

import json
import sys
import urllib.request
import wave
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(sys.argv[1])
if not (root / "artwork.webp").exists():
    source = json.loads((root / "source.json").read_text())
    with urllib.request.urlopen(source["artworkURL"], timeout=45) as response:
        raw = response.read()
    image = Image.open(BytesIO(raw))
    image.thumbnail((640, 640))
    image.convert("RGB").save(root / "artwork.webp", "WEBP", quality=85)
if not (root / "waveform.json").exists():
    # Read one bin at a time, rather than allocating another episode-sized array.
    with wave.open(str(root / "episode.wav"), "rb") as source:
        frames = source.getnframes()
        bins = 130
        peaks = []
        for i in range(bins):
            count = (i + 1) * frames // bins - i * frames // bins
            samples = (
                np.frombuffer(source.readframes(count), dtype=np.int16).astype(
                    np.float32
                )
                / 32768
            )
            peaks.append(float(np.sqrt(np.mean(samples**2))))
    maximum = max(peaks) or 1
    (root / "waveform.json").write_text(
        json.dumps([round(p / maximum, 3) for p in peaks])
    )
