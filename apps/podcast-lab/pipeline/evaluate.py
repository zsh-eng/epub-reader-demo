"""Compare detections with a text-reviewed development reference, never call it WER."""

import json
from pathlib import Path

root = Path(".local")
reference = json.loads(Path("tests/reference.json").read_text())
episode = json.loads((root / "episode.json").read_text())
if reference["audioHash"] != episode["audioHash"]:
    raise ValueError("Reference belongs to different audio bytes")
expected = reference["promotions"]
detected = episode["skips"]
overlap = sum(
    max(0, min(a["end"], b["end"]) - max(a["start"], b["start"]))
    for a in expected
    for b in detected
)
expected_seconds = sum(a["end"] - a["start"] for a in expected)
detected_seconds = sum(a["end"] - a["start"] for a in detected)
report = {
    "audioHash": episode["audioHash"],
    "durationSeconds": episode["duration"],
    "referenceMethod": reference["method"],
    "referencePromotionSeconds": round(expected_seconds, 2),
    "suggestedSkipSeconds": round(detected_seconds, 2),
    "overlapSeconds": round(overlap, 2),
    "uncoveredPromotionSeconds": round(expected_seconds - overlap, 2),
    "outsideReferenceSeconds": round(detected_seconds - overlap, 2),
    "coverageOfDevelopmentReference": round(overlap / expected_seconds, 4),
    "transcriptRows": len(episode["rows"]),
    "chapters": len(episode["chapters"]),
    "limits": reference["limitations"],
}
for file in (
    "asr",
    "diarization",
    "mlx-benchmark",
    "redux-benchmark",
    "redux-mps-benchmark",
):
    p = root / f"{file}.json"
    if p.exists():
        report[file] = json.loads(p.read_text())["metrics"]
report["asr"]["device"] = "Metal"
report["diarization"]["device"] = "CoreML/CPU"
report["measurementNote"] = (
    "First-run device labels corrected from the CLI default; timings unchanged. RSS excludes a complete accounting of GPU/ANE allocations. Single runs, not a controlled repeated benchmark."
)
report["classificationSeconds"] = json.loads(
    (root / "classification.json").read_text()
)["seconds"]
Path("validation.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
