"""Behavior checks with controlled HTTP; never call a podcast host in tests."""

import http.server
import itertools
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from align import align
from download import download


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
                    first = download(url, path)
                    self.assertEqual(path.read_bytes(), content)
                    self.assertEqual(requests[-1]["Range"], f"bytes={len(partial)}-")
                    before = len(requests)
                    self.assertEqual(download(url, path), first)
                    self.assertEqual(len(requests), before)
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


if __name__ == "__main__":
    unittest.main()
