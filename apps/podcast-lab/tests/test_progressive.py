"""Run real checkpoint/publication wiring; replace only external model/codec calls."""

import hashlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from progressive import analyse


class ProgressiveIntegration(unittest.TestCase):
    def test_cumulative_passes_replace_voice_ids_atomically_and_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "prepared" / ("a" * 20)
            root.mkdir(parents=True)
            (root / "episode.mp3").write_bytes(b"exact-audio")
            (root / "episode.mp3.download.json").write_text(
                json.dumps({"sha256": hashlib.sha256(b"exact-audio").hexdigest()})
            )
            (root / "source.json").write_text(
                json.dumps(
                    {
                        "title": "Interview",
                        "description": "Conversation",
                        "show": "Show",
                        "showCreator": "Host Name",
                        "published": "2026-09-26",
                        "source": "https://example.com",
                    }
                )
            )
            (root / "status.json").write_text("{}")
            requests, snapshots, speech = [], [], []
            fail = [True]

            def run(command, **kwargs):
                if command[0] == "ffmpeg":
                    Path(command[-1]).write_bytes(b"pcm")
                elif "transcribe.py" in str(command):
                    engine = command[2]
                    output = Path(command[4])
                    n = int(output.parent.name.rsplit("-", 1)[1])
                    speech.append((n, engine))
                    end = [390, 690, 1000][n - 1]
                    if engine == "mlx":
                        result = {
                            "sentences": [
                                {
                                    "tokens": [
                                        {
                                            "text": " Hello.",
                                            "start": float(t),
                                            "end": float(t + 1),
                                        }
                                    ]
                                }
                                for t in range(0, end, 30)
                            ]
                        }
                    else:
                        result = {
                            "segments": [
                                {"speaker": f"voice-{n}", "start": 0, "end": end}
                            ]
                        }
                    output.write_text(json.dumps({"result": result}))
                elif "exec" in command:
                    prompt = json.loads(kwargs["input"].split("UNTRUSTED DATA:\n")[1])
                    requests.append(prompt)
                    if fail[0] and prompt["speakerIds"] == ["voice-2"]:
                        raise RuntimeError("Hosted service interrupted")
                    Path(command[command.index("-o") + 1]).write_text(
                        json.dumps(
                            {
                                "speakers": [
                                    {
                                        "id": prompt["speakerIds"][0],
                                        "name": "Host Name",
                                        "role": "Host",
                                        "nameSource": "showCreator",
                                        "confidence": "likely",
                                        "evidenceBlockId": "b0000",
                                        "evidenceQuote": "Hello.",
                                    }
                                ],
                                "chapters": [
                                    {"blockId": "b0000", "title": "Conversation"}
                                ],
                                "summary": "Interview.",
                            }
                        )
                    )
                else:
                    raise AssertionError(command)

            def respond(request, timeout):
                return io.BytesIO(
                    json.dumps(
                        {
                            "answers": {
                                "sequence": {
                                    "type": "choice",
                                    "choice": "content",
                                    "probabilities": {
                                        k: float(k == "content")
                                        for k in (
                                            "content",
                                            "sponsor",
                                            "self_promotion",
                                            "credits",
                                        )
                                    },
                                }
                            }
                        }
                    ).encode()
                )

            def status(*args, **kwargs):
                path = root / "analysis.json"
                if path.exists():
                    payload = json.loads(path.read_text())
                    if (
                        not snapshots
                        or snapshots[-1]["analysisRevision"]
                        != payload["analysisRevision"]
                    ):
                        snapshots.append(payload)

            with (
                patch("subprocess.check_output", return_value="1000"),
                patch("subprocess.run", side_effect=run),
                patch("classify.urllib.request.urlopen", side_effect=respond),
                patch.dict("os.environ", {"JEV_API_KEY": "fixture"}),
            ):
                with self.assertRaisesRegex(RuntimeError, "interrupted"):
                    analyse(root, status, milestones=(300, 600))
                first = json.loads((root / "analysis.json").read_text())
                self.assertEqual(first["coverageEnd"], 300)
                self.assertFalse((root / "episode.json").exists())
                fail[0] = False
                analyse(root, status, milestones=(300, 600))
                status()
                before = len(requests)
                analyse(root, status, milestones=(300, 600))
                self.assertEqual(len(requests), before)
            self.assertEqual([s["coverageEnd"] for s in snapshots], [300, 600, 1000])
            for i, snapshot in enumerate(snapshots, 1):
                self.assertEqual(
                    {s["id"] for s in snapshot["speakers"]}, {f"voice-{i}"}
                )
                self.assertEqual(
                    {r["speaker"] for r in snapshot["rows"]}, {f"voice-{i}"}
                )
                self.assertTrue(
                    all(r["end"] <= snapshot["coverageEnd"] for r in snapshot["rows"])
                )
            self.assertEqual(
                speech,
                [
                    (1, "mlx"),
                    (1, "diarize"),
                    (2, "mlx"),
                    (2, "diarize"),
                    (3, "mlx"),
                    (3, "diarize"),
                ],
            )
            self.assertTrue(
                json.loads((root / "episode.json").read_text())["analysisComplete"]
            )
            self.assertEqual(
                json.loads((root / "analysis-state.json").read_text())[
                    "analysisRevision"
                ],
                3,
            )
            self.assertFalse(list(root.glob("passes/*/episode.wav")))
            with (
                patch("subprocess.check_output", return_value="1000"),
                self.assertRaisesRegex(ValueError, "different audio or milestones"),
            ):
                analyse(root, status, milestones=(250, 600))


if __name__ == "__main__":
    unittest.main()
