"""Sequence classification retains montage interiors; no sentence-level gate."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from sequences import VERSION, run


class SequenceIntegration(unittest.TestCase):
    def test_whole_interval_keeps_ordinary_sounding_clips_and_rejects_mixed_span(self):
        for verification, expected in (("promotion", 1), ("mixed", 0)):
            requests = []

            def respond(request, timeout, requests=requests, verification=verification):
                body = json.loads(request.data)
                requests.append(body)
                answers = {}
                for key, question in body["questions"].items():
                    choice = {
                        "sequence": "self_promotion",
                        "start": "u0000",
                        "end": "u0002",
                        "complete": verification,
                    }[key]
                    if key == "sequence" and body["state"]["transcript"][0]["id"] == "u0003":
                        choice = "content"
                    answers[key] = {
                        "type": "choice",
                        "choice": choice,
                        "probabilities": {
                            c: float(c == choice) for c in question["criteria"]
                        },
                    }
                return io.BytesIO(json.dumps({"answers": answers}).encode())

            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                texts = ["Our anniversary.", "I test mattresses.", "Subscribe today."]
                blocks = [
                    {
                        "id": f"b{i}",
                        "speaker": f"speaker{i}",
                        "start": i * 2,
                        "end": i * 2 + 1,
                        "words": [{"text": text, "start": i * 2, "end": i * 2 + 1}],
                    }
                    for i, text in enumerate(texts)
                ]
                (root / "blocks.json").write_text(json.dumps(blocks))
                (root / "source.json").write_text(
                    json.dumps(
                        {
                            "show": "Show",
                            "title": "AI discussion",
                            "showDescription": "Interviews. Subscribe today for more.",
                            "description": "China and AI policy.",
                        }
                    )
                )
                (root / "episode.mp3.download.json").write_text(
                    json.dumps({"sha256": "exact-audio-hash"})
                )
                (root / "judge.json").write_text("DO NOT SEND REFERENCE LABELS")
                with (
                    patch("classify.urllib.request.urlopen", side_effect=respond),
                    patch.dict("os.environ", {"JEV_API_KEY": "test-only"}),
                ):
                    run(root)
                    result = json.loads((root / f"{VERSION}.json").read_text())
                    self.assertEqual(len(result["candidates"]), expected)
                    self.assertEqual(result["sourceHash"], "exact-audio-hash")
                    self.assertEqual(len(requests), 3)
                    self.assertEqual(
                        [list(r["questions"]) for r in requests],
                        [["sequence"], ["end", "start"], ["complete"]],
                    )
                    self.assertEqual(
                        requests[0]["state"]["show"]["description"], "Interviews."
                    )
                    self.assertNotIn(
                        "DO NOT SEND REFERENCE LABELS", json.dumps(requests)
                    )
                    if expected:
                        candidate = result["candidates"][0]
                        self.assertEqual((candidate["start"], candidate["end"]), (0, 5))
                        self.assertEqual(candidate["blockIds"], ["b0", "b1", "b2"])
                        self.assertIn("I test mattresses.", candidate["text"])
                    run(root)
                    self.assertEqual(len(requests), 3)
                    # A later diarization can rename every voice. Jev's unchanged
                    # spoken window must reuse the cache, not depend on those IDs.
                    for b in blocks:
                        b["speaker"] = "renumbered"
                    (root / "blocks.json").write_text(json.dumps(blocks))
                    run(root, through=10)
                    partial = json.loads((root / f"{VERSION}.json").read_text())
                    self.assertEqual(partial["candidates"], [])
                    self.assertEqual(len(requests), 3)
                    if expected:
                        blocks.append(
                            {
                                "id": "b3",
                                "speaker": "host",
                                "start": 10,
                                "end": 11,
                                "words": [
                                    {
                                        "text": "Now the interview.",
                                        "start": 10,
                                        "end": 11,
                                    }
                                ],
                            }
                        )
                        (root / "blocks.json").write_text(json.dumps(blocks))
                        run(root, through=6)
                        partial = json.loads((root / f"{VERSION}.json").read_text())
                        self.assertEqual(
                            [(c["start"], c["end"]) for c in partial["candidates"]],
                            [(0, 5)],
                        )


if __name__ == "__main__":
    unittest.main()
