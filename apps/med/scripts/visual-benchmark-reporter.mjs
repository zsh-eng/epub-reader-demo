import { writeFileSync } from "node:fs";

/** Capture the visual-mode benchmark annotation without browser console logging. */
export default class VisualBenchmarkReporter {
  onTestCaseAnnotate(_test, annotation) {
    const prefix = "VISUAL_BENCHMARK ";
    if (!annotation.message.startsWith(prefix)) return;
    writeFileSync(
      "docs/validation/visual-selection-benchmark.json",
      JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          browser: "Chromium headless through Vitest browser",
          method:
            "Synthetic keydown handler time; then animation frames until the visible caret matches the logical cursor. Frame observations, not presentation timestamps. No clipboard timings included.",
          results: JSON.parse(annotation.message.slice(prefix.length)),
        },
        null,
        2,
      ) + "\n",
    );
  }
}
