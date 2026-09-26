"""Exercise production naming validation with only hosted inference replaced."""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pipeline"))
from enrich import run


class EnrichmentIntegration(unittest.TestCase):
    def test_host_metadata_reaches_model_and_unsubstantiated_names_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = {
                "title": "A guest",
                "description": "An interview",
                "show": "A show",
                "showCreator": "Alice Example",
            }
            (root / "source.json").write_text(json.dumps(source))
            (root / "blocks.json").write_text(
                json.dumps(
                    [
                        {
                            "id": "b0",
                            "speaker": "voice1",
                            "start": 0,
                            "end": 2,
                            "text": "Today I am interviewing Bob.",
                        },
                    ]
                )
            )
            prompts = []

            def inference(command, **kwargs):
                prompts.append(kwargs["input"])
                Path(command[command.index("-o") + 1]).write_text(
                    json.dumps(
                        {
                            "speakers": [
                                {
                                    "id": "voice1",
                                    "name": "Alice Example",
                                    "role": "Host",
                                    "nameSource": "showCreator",
                                    "confidence": "likely",
                                    "evidenceBlockId": "b0",
                                    "evidenceQuote": "Today I am interviewing Bob.",
                                }
                            ],
                            "chapters": [{"blockId": "b0", "title": "Discussion"}],
                            "summary": "A conversation.",
                        }
                    )
                )

            with patch("enrich.subprocess.run", side_effect=inference):
                run(root)
                self.assertIn("Alice Example", prompts[0])
                self.assertEqual(
                    json.loads((root / "enrichment.json").read_text())["speakers"][0][
                        "confidence"
                    ],
                    "likely",
                )
                run(root)
                self.assertEqual(len(prompts), 1)
                source["showCreator"] = "A publishing company"
                (root / "source.json").write_text(json.dumps(source))
                with self.assertRaisesRegex(ValueError, "creator metadata"):
                    run(root)
                self.assertEqual(len(prompts), 2)


if __name__ == "__main__":
    unittest.main()
