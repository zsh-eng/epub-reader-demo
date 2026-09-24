"""Readable display paragraphs, independent of the classifier's speaker blocks.

Join adjacent words from the same detected speaker, including across ASR block
limits. Prefer sentence endings after 40 words; cap at 75 words or 32 seconds.
Never merge across a speaker change, two-second pause, or detected skip boundary.
"""

import re


def ends_sentence(text):
    return bool(re.search(r'[.!?]["”’)]*$', text)) and text not in {
        "Mr.",
        "Mrs.",
        "Dr.",
        "U.S.",
        "A.I.",
        "e.g.",
        "i.e.",
    }


def make_parts(words):
    parts = []
    current = []
    for word in words:
        current.append(word)
        if ends_sentence(word["text"]) or len(current) >= 28:
            parts.append(current)
            current = []
    if current:
        parts.append(current)
    return [
        {
            "start": part[0]["start"],
            "end": part[-1]["end"],
            "text": " ".join(w["text"] for w in part),
        }
        for part in parts
    ]


def make_paragraphs(blocks, skips):
    rows = []
    current = []
    block_ids = []
    region = None

    def flush():
        if not current:
            return
        words = list(current)
        rows.append(
            {
                "id": f"p{len(rows):04d}",
                "blockId": block_ids[0],
                "blockIds": list(dict.fromkeys(block_ids)),
                "speaker": words[0]["speaker"],
                "start": words[0]["start"],
                "end": words[-1]["end"],
                "words": words,
                "parts": make_parts(words),
                "text": " ".join(w["text"] for w in words),
            }
        )
        current.clear()
        block_ids.clear()

    for block in blocks:
        for word in block["words"]:
            word_region = next(
                (s["id"] for s in skips if s["start"] <= word["start"] < s["end"]), None
            )
            if current and (
                current[-1]["speaker"] != word["speaker"]
                or word["start"] - current[-1]["end"] > 2
                or word_region != region
            ):
                flush()
            region = word_region
            current.append(word)
            block_ids.append(block["id"])
            if (
                (len(current) >= 40 and ends_sentence(word["text"]))
                or len(current) >= 75
                or word["end"] - current[0]["start"] >= 32
            ):
                flush()
    flush()
    return rows
