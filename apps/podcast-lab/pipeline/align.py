"""Align acoustic speaker turns to word timestamps, then retain bounded context."""

import json
from pathlib import Path


def align(asr, diarization, max_seconds=45):
    turns = sorted(diarization, key=lambda d: d["start"])
    words = []
    cursor = 0
    raw_words = []
    # Parakeet tokens are subwords. Reassemble words before speaker assignment.
    for sentence in asr["sentences"]:
        merged = []
        for token in sentence["tokens"]:
            text = token["text"]
            if not text.strip():
                continue
            if not merged or text.startswith(" "):
                merged.append(
                    {"text": text.strip(), "start": token["start"], "end": token["end"]}
                )
            else:
                merged[-1]["text"] += text
                merged[-1]["end"] = token["end"]
        raw_words.extend(merged)
    # Chunk stitching can put punctuation tokens out of order or stretch a word
    # across a music break. Sort once and bound display spans, retaining ASR times.
    raw_words.sort(key=lambda w: (w["start"], w["end"]))
    for i, word in enumerate(raw_words):
        word["end"] = max(
            word["start"],
            min(
                word["end"],
                word["start"] + 2.0,
                raw_words[i + 1]["start"] if i + 1 < len(raw_words) else word["end"],
            ),
        )
        while cursor < len(turns) and turns[cursor]["end"] <= word["start"]:
            cursor += 1
        candidates = []
        for turn in turns[cursor:]:
            if turn["start"] >= word["end"]:
                break
            overlap = min(turn["end"], word["end"]) - max(turn["start"], word["start"])
            if overlap > 0:
                candidates.append((overlap, str(turn["speaker"])))
        word["speaker"] = max(candidates)[1] if candidates else "unknown"
        if not candidates:
            nearby = turns[max(0, cursor - 1) : cursor + 1]
            closest = min(
                nearby,
                key=lambda t: min(
                    abs(t["start"] - word["start"]), abs(t["end"] - word["end"])
                ),
                default=None,
            )
            if (
                closest
                and min(
                    abs(closest["start"] - word["start"]),
                    abs(closest["end"] - word["end"]),
                )
                <= 0.35
            ):
                word["speaker"] = str(closest["speaker"])
        words.append(word)
    blocks = []
    for word in words:
        if (
            not blocks
            or blocks[-1]["speaker"] != word["speaker"]
            or word["end"] - blocks[-1]["start"] > max_seconds
            or word["start"] - blocks[-1]["end"] > 2
        ):
            blocks.append(
                {
                    "id": f"b{len(blocks):04d}",
                    "speaker": word["speaker"],
                    "start": word["start"],
                    "end": word["end"],
                    "words": [],
                    "text": "",
                }
            )
        block = blocks[-1]
        block["words"].append(word)
        block["end"] = word["end"]
        block["text"] = " ".join(w["text"] for w in block["words"])
    return blocks


if __name__ == "__main__":
    root = Path(".local")
    blocks = align(
        json.loads((root / "asr.json").read_text())["result"],
        json.loads((root / "diarization.json").read_text())["result"]["segments"],
    )
    (root / "blocks.json").write_text(json.dumps(blocks, indent=2))
    print(f"{len(blocks)} blocks, {len({b['speaker'] for b in blocks})} speaker labels")
