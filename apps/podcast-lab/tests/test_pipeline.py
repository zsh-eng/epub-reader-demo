"""Behavior checks with controlled HTTP; never call a podcast host in tests."""

import http.server
import io
import itertools
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from align import align
from classify import run as classify_episode
from download import download
from paragraphs import make_paragraphs


class DownloadIntegration(unittest.TestCase):
    def test_resume_and_changed_representation(self):
        content = b"new podcast bytes " * 512
        requests = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(dict(self.headers))
                offset = int(self.headers.get("Range", "bytes=0-")[6:-1])
                resume = bool(offset and self.headers.get("If-Range") == '"v2"')
                self.send_response(206 if resume else 200)
                if resume:
                    self.send_header(
                        "Content-Range",
                        f"bytes {offset}-{len(content) - 1}/{len(content)}",
                    )
                self.send_header("ETag", '"v2"')
                data = content[offset:] if resume else content
                if self.path != "/unknown":
                    self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for validator, partial in [
                ('"v2"', content[:99]),
                ('"old"', b"old representation"),
            ]:
                with tempfile.TemporaryDirectory() as d:
                    path = Path(d) / "episode.mp3"
                    url = f"http://127.0.0.1:{server.server_port}/audio"
                    path.with_suffix(".mp3.part").write_bytes(partial)
                    path.with_suffix(".mp3.download.json").write_text(
                        json.dumps({"url": url, "validator": validator})
                    )
                    updates = []
                    first = download(
                        url,
                        path,
                        lambda received, total, updates=updates: updates.append(
                            (received, total)
                        ),
                    )
                    self.assertEqual(
                        updates[0],
                        (len(partial) if validator == '"v2"' else 0, len(content)),
                    )
                    self.assertEqual(updates[-1], (len(content), len(content)))
                    self.assertEqual(path.read_bytes(), content)
                    self.assertEqual(requests[-1]["Range"], f"bytes={len(partial)}-")
                    before = len(requests)
                    self.assertEqual(download(url, path), first)
                    self.assertEqual(len(requests), before)
            with tempfile.TemporaryDirectory() as d:
                updates = []
                path = Path(d) / "unknown.mp3"
                download(
                    f"http://127.0.0.1:{server.server_port}/unknown",
                    path,
                    lambda received, total, updates=updates: updates.append(
                        (received, total)
                    ),
                )
                self.assertEqual(updates[-1], (len(content), 0))
                self.assertEqual(path.read_bytes(), content)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_words_keep_subwords_and_speaker_changes(self):
        asr = {
            "sentences": [
                {
                    "tokens": [
                        {"text": " Hello", "start": 0, "end": 0.3},
                        {"text": " world", "start": 0.4, "end": 0.7},
                        {"text": "!", "start": 0.7, "end": 0.8},
                        {"text": " Yes", "start": 1, "end": 1.3},
                    ]
                }
            ]
        }
        blocks = align(
            asr,
            [
                {"speaker": 1, "start": 0, "end": 0.9},
                {"speaker": 2, "start": 1, "end": 2},
            ],
        )
        self.assertEqual([b["text"] for b in blocks], ["Hello world!", "Yes"])
        self.assertEqual([b["speaker"] for b in blocks], ["1", "2"])
        self.assertEqual(blocks[0]["words"][1]["end"], 0.8)

    def test_alignment_bounds_silence_and_sorts_chunk_stitching(self):
        asr = {
            "sentences": [
                {"tokens": [{"text": " First", "start": 0, "end": 20}]},
                {"tokens": [{"text": " Third", "start": 30, "end": 31}]},
                {"tokens": [{"text": " Second", "start": 22, "end": 23}]},
            ]
        }
        blocks = align(asr, [{"speaker": 1, "start": 0, "end": 32}])
        self.assertEqual([b["text"] for b in blocks], ["First", "Second", "Third"])
        self.assertEqual(blocks[0]["end"], 2)
        self.assertTrue(
            all(a["end"] <= b["start"] for a, b in itertools.pairwise(blocks))
        )


class ParagraphIntegration(unittest.TestCase):
    def test_joined_display_preserves_words_and_bounds_passages(self):
        tokens = [
            {
                "text": f" word{i}" + ("." if i % 20 == 19 else ""),
                "start": i * 0.2,
                "end": i * 0.2 + 0.15,
            }
            for i in range(180)
        ]
        blocks = align(
            {"sentences": [{"tokens": tokens}]},
            [{"speaker": 1, "start": 0, "end": 40}],
            max_seconds=3,
        )
        rows = make_paragraphs(blocks, [])
        self.assertLess(len(rows), len(blocks))
        self.assertTrue(any(len(row["blockIds"]) > 1 for row in rows))
        self.assertTrue(all(len(row["words"]) <= 75 for row in rows))
        original = [word for block in blocks for word in block["words"]]
        self.assertEqual([word for row in rows for word in row["words"]], original)
        for row in rows:
            self.assertEqual(
                " ".join(part["text"] for part in row["parts"]), row["text"]
            )
            self.assertTrue(
                all(len(part["text"].split()) <= 28 for part in row["parts"])
            )
        self.assertTrue(all(row["text"].endswith(".") for row in rows))

    def test_speakers_pauses_and_skip_boundaries_remain_separate(self):
        tokens = [
            {"text": f" word{i}", "start": time, "end": time + 0.4}
            for i, time in enumerate([0, 1, 2, 3, 4, 8])
        ]
        blocks = align(
            {"sentences": [{"tokens": tokens}]},
            [
                {"speaker": 1, "start": 0, "end": 4},
                {"speaker": 2, "start": 4, "end": 9},
            ],
        )
        rows = make_paragraphs(blocks, [{"id": "ad", "start": 1, "end": 3}])
        self.assertEqual(
            [row["text"] for row in rows],
            ["word0", "word1 word2", "word3", "word4", "word5"],
        )


class ClassificationIntegration(unittest.TestCase):
    def test_metadata_reaches_both_passes_and_invalidates_request_cache(self):
        requests = []

        def respond(request, timeout):
            requests.append(json.loads(request.data))
            return io.BytesIO(
                json.dumps(
                    {
                        "answers": {
                            key: {
                                "type": "noul",
                                "noul": 0.9 if key == "self_promotion" else 0.01,
                            }
                            for key in ("sponsor", "self_promotion", "credits")
                        }
                    }
                ).encode()
            )

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {
                "show": "A show",
                "showDescription": "<p>A &amp; B.</p>",
                "title": "An episode",
                "description": "<p>Topic.</p><p>Subscribe.</p>",
            }
            (root / "source.json").write_text(json.dumps(source))
            blocks = align(
                {
                    "sentences": [
                        {
                            "tokens": [
                                {"text": " Try", "start": 0, "end": 0.3},
                                {"text": " us.", "start": 0.4, "end": 0.7},
                                {"text": " Subscribe.", "start": 0.8, "end": 1.1},
                            ]
                        }
                    ]
                },
                [{"speaker": 1, "start": 0, "end": 2}],
            )
            (root / "blocks.json").write_text(json.dumps(blocks))
            with (
                patch("classify.urllib.request.urlopen", side_effect=respond),
                patch.dict("os.environ", {"JEV_API_KEY": "test-only"}),
            ):
                classify_episode(root)
                self.assertEqual(len(requests), 3)
                for body in requests:
                    self.assertEqual(body["state"]["show"]["description"], "A & B.")
                    self.assertEqual(
                        body["state"]["episode"]["description"], "Topic. Subscribe."
                    )
                    self.assertIn("surrounding_context", body["state"])
                result = json.loads((root / "classification.json").read_text())
                self.assertEqual(len(result["candidates"]), 2)
                self.assertEqual(result["metadata"]["show"]["title"], "A show")
                classify_episode(root)
                self.assertEqual(len(requests), 3)
                source["showDescription"] = "Updated show context."
                (root / "source.json").write_text(json.dumps(source))
                classify_episode(root)
                self.assertEqual(len(requests), 6)
                self.assertEqual(
                    requests[-1]["state"]["show"]["description"],
                    "Updated show context.",
                )


if __name__ == "__main__":
    unittest.main()
