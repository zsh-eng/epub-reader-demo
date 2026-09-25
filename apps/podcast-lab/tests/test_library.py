"""RSS materialization uses stable identities and never puts HTML in the UI."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from library import build


class LibraryIntegration(unittest.TestCase):
    def test_cached_feed_preserves_dates_and_does_not_match_duplicate_titles(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {
                "show": "Test show",
                "title": "Repeated title",
                "audioURL": "https://example.com/local.mp3",
                "feed": "https://example.com/rss",
                "source": "https://example.com/episode",
            }
            (root / "source.json").write_text(json.dumps(source))
            (root / "episode.json").write_text(
                json.dumps(
                    {
                        "title": "Repeated title",
                        "summary": "Local episode",
                        "published": "Thu, 24 Sep 2026 10:00:00 GMT",
                        "duration": 610,
                    }
                )
            )
            (root / "feed.xml").write_text(
                """<rss><channel><title>Test show</title><item><title>Repeated title</title><guid>new</guid><pubDate>Fri, 25 Sep 2026 10:00:00 GMT</pubDate><description>&lt;b&gt;New episode&lt;/b&gt;</description><link>javascript:alert(1)</link><enclosure url="https://example.com/new.mp3"/></item><item><title>Repeated title</title><guid>old</guid><pubDate>Thu, 24 Sep 2026 10:00:00 GMT</pubDate><enclosure url="https://example.com/local.mp3"/></item></channel></rss>"""
            )
            build(root)
            data = json.loads((root / "library.json").read_text())
            self.assertEqual(len(data["shows"]), 1)
            newer, older = data["episodes"]
            self.assertIsNone(newer["preparedId"])
            self.assertEqual(newer["description"], "New episode")
            self.assertEqual(newer["source"], source["feed"])
            self.assertEqual(older["preparedId"], "ezra")
            self.assertEqual(older["duration"], 610)
            self.assertEqual(older["published"], "2026-09-24T10:00:00+00:00")
            original_ids = [e["id"] for e in data["episodes"]]
            build(root)
            self.assertEqual(
                [
                    e["id"]
                    for e in json.loads((root / "library.json").read_text())["episodes"]
                ],
                original_ids,
            )
            (root / "feed.xml").unlink()
            build(root)
            self.assertEqual(
                len(json.loads((root / "library.json").read_text())["episodes"]), 1
            )


if __name__ == "__main__":
    unittest.main()
