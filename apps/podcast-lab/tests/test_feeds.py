"""Exercise conditional refresh against a local HTTP publisher, without live hosts."""

import json
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from feeds import refresh_feed
from library import build


class FeedIntegration(unittest.TestCase):
    def test_conditional_refresh_freshness_and_last_good_offline_snapshot(self):
        requests = []
        mode = ["ok"]
        xml = b'<rss><channel><title>Personal show</title><item><guid>same</guid><title>Episode</title><pubDate>Fri, 25 Sep 2026 10:00:00 GMT</pubDate><enclosure url="https://example.com/never-download.mp3"/></item></channel></rss>'

        class Publisher(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                requests.append(dict(self.headers))
                if mode[0] == "error":
                    self.send_response(503)
                    self.end_headers()
                    return
                if mode[0] == "invalid":
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b"<html>broken feed</html>")
                    return
                if self.headers.get("If-None-Match") == '"one"':
                    self.send_response(304)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("ETag", '"one"')
                self.send_header("Last-Modified", "Fri, 25 Sep 2026 10:00:00 GMT")
                self.end_headers()
                self.wfile.write(xml)

        server = ThreadingHTTPServer(("127.0.0.1", 0), Publisher)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                show = {
                    "id": "personal",
                    "title": "Personal show",
                    "feed": f"http://127.0.0.1:{server.server_port}/feed",
                }
                self.assertEqual(
                    refresh_feed(show, root, now=10000)["status"], "updated"
                )
                build(root, [show])
                snapshot = (root / "library.json").read_bytes()
                self.assertEqual(len(json.loads(snapshot)["episodes"]), 1)
                self.assertEqual(refresh_feed(show, root, now=10001)["status"], "fresh")
                self.assertEqual(len(requests), 1)
                self.assertEqual(
                    refresh_feed(show, root, now=14000)["status"], "unchanged"
                )
                self.assertEqual(requests[-1]["If-None-Match"], '"one"')
                self.assertIn("If-Modified-Since", requests[-1])
                for status in ("error", "invalid"):
                    mode[0] = status
                    self.assertEqual(
                        refresh_feed(show, root, force=True, now=18000)["status"],
                        "stale",
                    )
                    self.assertEqual(
                        (root / "feeds/personal/feed.xml").read_bytes(), xml
                    )
                    build(root, [show])
                    self.assertEqual((root / "library.json").read_bytes(), snapshot)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == "__main__":
    unittest.main()
