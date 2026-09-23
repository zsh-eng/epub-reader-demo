# Timing comparison helpers

`compare-videos.mjs` combines two separately recorded operations into one MP4. Both timers start at zero. Playback is three times slower by default. Each timer shows **real elapsed time**, stops at its measured completion time, and keeps the completed screen visible. The output holds both completed screens for three more seconds.

Requirements: Node, this repository's Playwright dependency and Chromium browser, plus `ffmpeg` and `ffprobe` with the `libx264` encoder. No audio is retained. Timer text is rendered with Chromium canvas, so FFmpeg does not need the optional `drawtext` filter.

## Capture

Record each run under the same conditions: viewport, source file, theme, cache state, and completion rule. Record at least one frame after completion (a short final hold is preferable). Record a start marker against the recording's timeline and an elapsed duration from a monotonic clock. Do not include browser startup or setup in just one run.

Completion must mean the same thing on both sides, for example: the file is loaded and its highlighted lines have been painted. A request finishing or a worker responding does not prove the browser has painted the result. Document the rule and each run's environment with the recording.

For a prepared Playwright Chromium page, use the capture primitive:

```js
import { recordTimedOperation } from "./helpers/record-timed-operation.mjs";

const recording = await recordTimedOperation(page, {
  output: "/tmp/shiki.mp4",
  run: async () => releaseFileResponse(),
  waitUntilComplete: async () => {
    await page.waitForFunction(() => window.exampleHighlightedAndPainted);
  },
});
// Put recording.video, startSeconds, and durationSeconds into a comparison side.
```

This records CDP screencast frames, using each frame's capture timestamp. Start and completion markers use the browser's epoch plus monotonic performance clock. The returned `.mp4.json` includes those markers and the captured frame timestamps. This avoids guessing the initial offset of a Playwright video. Prepare the page before calling it, use a fresh page per run, and keep the same capture method for both engines. The helper overwrites the requested video and JSON report.

The measured interval starts immediately before `run` and ends after `waitUntilComplete` resolves. It includes callback dispatch and completion polling overhead. The helper adds a screenshot after completion to guarantee a final visible state. It does not decide when the app is complete. CDP can emit sparse frames or add capture overhead; keep this visible timing separate from uncaptured benchmark numbers. The encoded recording uses 60 fps by default, but this does not create additional captured frames.

## Compose

Create a manifest; video and output paths are relative to the manifest directory:

```json
{
  "output": "comparison.mp4",
  "slowMotion": 3,
  "holdSeconds": 3,
  "fps": 30,
  "panelWidth": 960,
  "left": {
    "video": "shiki.webm",
    "label": "Shiki · Bun HTTP/2",
    "startSeconds": 0.6,
    "durationSeconds": 1.8
  },
  "right": {
    "video": "twinkleplop.webm",
    "label": "Twinkleplop · Bun HTTP/2",
    "startSeconds": 0.5,
    "durationSeconds": 0.2
  }
}
```

```sh
node helpers/compare-videos.mjs --manifest /path/to/comparison.json
```

The command writes the MP4 and a `.mp4.json` report with exact frame counts and timer completion frames. It overwrites those two outputs. It preserves the input recordings. Use `FFMPEG` and `FFPROBE` environment variables, or `ffmpeg` and `ffprobe` manifest fields, to select executable paths. Code can also import `compareVideos(manifest, baseDirectory)`.

## Timing and display limits

- Each source is trimmed to its start marker, then slowed by the same factor. The first recorded frame at or after completion is frozen for that side. Nothing loops or restarts.
- A side completes at output frame `ceil(durationSeconds * slowMotion * fps)`. Thus timer completion is rounded up by less than one output frame. The final hold is rounded to output frames, with at least one final frame.
- Source captures have their own frame resolution. A 25 fps recording can locate a visual event only to about 40 ms, regardless of the timer's three decimal places. The timer displays the supplied measurement; it does not infer timing from pixels.
- Repeated output frames create slow motion; the helper does not interpolate new images. This keeps the actual captured content unchanged.
- Both panels fit within the specified width without cropping. Different aspect ratios receive padding. Use equal source dimensions for the clearest comparison.
- This is a visual comparison, not statistical evidence. Keep repeated benchmark samples and their medians separate from the representative video.
