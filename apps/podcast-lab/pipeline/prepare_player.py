"""Materialize an offline player payload. Keep original audio and raw model outputs."""

import json
import subprocess
from pathlib import Path

from paragraphs import make_paragraphs


def prepare(root=Path(".local")):
    source = json.loads((root / "source.json").read_text())
    blocks = json.loads((root / "blocks.json").read_text())
    classified = json.loads((root / "classification.json").read_text())
    enrichment = json.loads((root / "enrichment.json").read_text())
    audio = json.loads((root / "episode.mp3.download.json").read_text())
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
    skips = []
    for c in sorted(classified["candidates"], key=lambda c: c["start"]):
        if c["category"] == "credits":
            continue  # Credits stay audible unless separately enabled later.
        # Bridge only a short silence, never intervening unclassified speech.
        prev = skips[-1] if skips else None
        speech_in_gap = prev and any(
            w["start"] >= prev["end"] + 0.02 and w["end"] <= c["start"] - 0.02
            for b in blocks
            for w in b["words"]
        )
        if (
            prev
            and c["category"] == prev["category"]
            and c["start"] - prev["end"] <= 2.5
            and not speech_in_gap
        ):
            prev["end"] = c["end"]
            prev["score"] = min(prev["score"], c["score"])
            prev["blockIds"].append(c["blockId"])
        else:
            skips.append(
                {
                    "id": f"skip-{len(skips)}",
                    "start": c["start"],
                    "end": c["end"],
                    "category": c["category"],
                    "score": c["score"],
                    "blockIds": [c["blockId"]],
                }
            )
    rows = make_paragraphs(blocks, skips)
    # Word timing remains in local model artifacts. The paragraph player needs
    # only sentence/part timestamps, so avoid transferring duplicate word data.
    for row in rows:
        row.pop("words")
    output = {
        "title": source["title"],
        "show": source["show"],
        "published": source["published"],
        "source": source["source"],
        "duration": duration,
        "audioHash": audio["sha256"],
        "speakers": enrichment["speakers"],
        "chapters": enrichment["chapters"],
        "summary": enrichment["summary"],
        "rows": rows,
        "skips": skips,
        "provenance": {
            "transcription": "Parakeet MLX · local",
            "diarization": "Senko CoreML · local",
            "classification": classified["model"],
            "chapters": enrichment["model"],
            "note": "Automatic suggestions, not verified ad boundaries. Some promotions are missed. Names are inferred from introductions; ad montage voices can be misassigned.",
        },
    }
    if (root / "waveform.json").exists():
        output["waveform"] = json.loads((root / "waveform.json").read_text())
    (root / "episode.json").write_text(json.dumps(output, separators=(",", ":")))
    print(
        json.dumps({"rows": len(rows), "skips": skips, "duration": duration}, indent=2)
    )


if __name__ == "__main__":
    prepare()
