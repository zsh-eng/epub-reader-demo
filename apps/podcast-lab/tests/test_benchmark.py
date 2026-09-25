"""Offline checks for benchmark boundaries, scoring, and Jev request wiring."""

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from benchmark import intersect, merge_candidates, metrics, sequence, units_from_blocks
from classify import request_judgments


class BenchmarkIntegration(unittest.TestCase):
    def test_sentence_units_keep_speaker_changes_and_word_times(self):
        blocks = [
            {"speaker": "a", "words": [{"text": "Try", "start": 1, "end": 1.5}]},
            {
                "speaker": "b",
                "words": [
                    {"text": "this.", "start": 1.5, "end": 2},
                    {"text": "Next.", "start": 5, "end": 6},
                ],
            },
        ]
        units = units_from_blocks(blocks)
        self.assertEqual(
            [(u["text"], u["start"], u["end"]) for u in units],
            [("Try this.", 1, 2), ("Next.", 5, 6)],
        )
        self.assertEqual(units[0]["speakers"], ["a", "b"])

    def test_metrics_do_not_double_count_overlaps_or_silent_gaps(self):
        result = metrics([(0, 10), (5, 15)], [(0, 8), (7, 12), (20, 22)])
        self.assertEqual(result["referenceSeconds"], 15)
        self.assertEqual(result["missedSeconds"], 3)
        self.assertEqual(result["outsideReferenceSeconds"], 2)
        self.assertEqual(intersect([(0, 10)], [(1, 2), (8, 9)]), [(1, 2), (8, 9)])

    def test_merging_never_covers_unclassified_words_or_long_missing_audio(self):
        def c(a, b):
            return {"start": a, "end": b, "category": "sponsor", "score": 0.9}

        candidates = [c(0, 3), c(4, 6), c(8, 9), c(20, 21)]
        words = [{"start": 7, "end": 7.5}]
        self.assertEqual(
            [(r["start"], r["end"]) for r in merge_candidates(candidates, words)],
            [(0, 6), (8, 9), (20, 21)],
        )
        self.assertEqual(candidates[0]["end"], 3)

    def test_batched_choice_has_exact_targets_metadata_and_no_judge_labels(self):
        requests = []

        def respond(request, timeout):
            body = json.loads(request.data)
            requests.append(body)
            answers = {
                key: {
                    "type": "choice",
                    "choice": "sponsor" if i == 0 else "content",
                    "confidence": 1,
                    "probabilities": {
                        c: float(c == ("sponsor" if i == 0 else "content"))
                        for c in q["criteria"]
                    },
                }
                for i, (key, q) in enumerate(body["questions"].items())
            }
            return io.BytesIO(json.dumps({"answers": answers}).encode())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            units = [
                {
                    "id": f"u{i:04d}",
                    "start": i,
                    "end": i + 0.5,
                    "speakers": ["a" if i == 0 else "b"],
                    "text": t,
                }
                for i, t in enumerate(["Buy this.", "The interview."])
            ]
            (root / "units.json").write_text(json.dumps(units))
            (root / "source.json").write_text(
                json.dumps(
                    {
                        "show": "Show",
                        "title": "Episode",
                        "showDescription": "Context",
                        "description": "Topic",
                    }
                )
            )
            (root / "judge.json").write_text(
                json.dumps({"secretReference": "must not reach Jev"})
            )
            with (
                patch("classify.urllib.request.urlopen", side_effect=respond),
                patch.dict("os.environ", {"JEV_API_KEY": "test-only"}),
            ):
                sequence(root, choice=True)
                result = json.loads((root / "choice-v4.json").read_text())
                self.assertEqual([u["id"] for u in result["candidates"]], ["u0000"])
                self.assertEqual(len(requests), 1)
                body = requests[0]
                self.assertEqual(len(body["questions"]), 2)
                self.assertIn(
                    "targets[1].text", body["questions"]["u0001"]["instructions"]
                )
                self.assertEqual(body["state"]["show"]["description"], "Context")
                self.assertNotIn("secretReference", json.dumps(body))
                sequence(root, choice=True)
                self.assertEqual(len(requests), 1)
                source = json.loads((root / "source.json").read_text())
                source["description"] = "Changed topic"
                (root / "source.json").write_text(json.dumps(source))
                sequence(root, choice=True)
                self.assertEqual(len(requests), 2)

    def test_invalid_choice_response_is_not_cached(self):
        body = {
            "model": "jev-1.13.0",
            "state": "x",
            "questions": {
                "target": {
                    "type": "choice",
                    "instructions": "Type?",
                    "criteria": {"content": "Content", "sponsor": "Ad"},
                }
            },
        }
        answer = {
            "answers": {
                "target": {
                    "type": "choice",
                    "choice": "invented",
                    "probabilities": {"content": 0.5, "sponsor": 0.5},
                }
            }
        }
        with (
            tempfile.TemporaryDirectory() as directory,
            patch(
                "classify.urllib.request.urlopen",
                return_value=io.BytesIO(json.dumps(answer).encode()),
            ),
            patch.dict("os.environ", {"JEV_API_KEY": "test-only"}),
        ):
            with self.assertRaises(ValueError):
                request_judgments(body, Path(directory))
            self.assertEqual(list(Path(directory).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
