# Undertone · podcast tracer bullet

One downloaded episode, local speech recognition, speaker-separated transcript,
Jev promotion suggestions, and a small listening interface. **No RSS app, native
app, accounts, or sync yet.** Undertone is a working name.

## Try it on this Mac

From the Workbench root:

```sh
bun run dev:podcast
```

Open **http://127.0.0.1:4378**. The prepared episode is stored in `.local/`.
Use a chapter or transcript passage to seek. Press Space to play. Scrolling stops
transcript following; **Follow along** returns to playback. Promotion cards let
you listen to a detected range. **Undo** replays a skipped range without skipping
it again during that pass. Ordinary scrubbing and restored playback positions
still respect the Skip promotions switch. Playback position is stored against
the exact audio hash.

The player uses actual cached audio and model results. It makes no external
requests and contains no API key. Stop its server with Control-C.

## What the experiment found

The full **67:43** download of *The “But China!” Dilemma Driving the A.I. Race*
from The Ezra Klein Show was used. Dynamic ads made its downloaded duration
longer than the feed's duration.

| Stage | Measured result |
| --- | --- |
| Parakeet MLX, whole episode | 130.4 s inference; 134.5 s with model loading |
| Senko CoreML, whole episode | 11.0 s inference; 111.7 s including first-run setup |
| Jev, final classification pass | 47.6 s; four requests in flight at most |
| GPT-6 Luna via Codex | Generated 10 chapters and evidence-linked speaker labels |
| Suggested skips | 2 ranges, 84.64 s total |

These are single runs on this 16 GB Apple Silicon Mac. They are not a repeated
benchmark or a claim about iPhone speed. RSS memory measurements do not capture
all GPU/ANE memory.

**The hypothesis is partly supported.** Local transcription is fast enough and
the end-to-end listening flow works. Classification is not ready for unattended
use. A text review marked 138.56 s of promotion: detected ranges cover 61.1% of
that reference, with no detected seconds outside it. The opening trailer and
part of the anniversary montage are missed. This was a development sample used
while changing the prompt, not a held-out test or an audio-reviewed gold standard.
No paid third-party ad was verified in this particular download.

Speaker separation also merges some short ad voices with interview speakers.
Names are inferred from the introduction and can be wrong. Initials are used
instead of unverified portraits. Chapter boundaries start at existing speaker
blocks; they are not editorially verified. ASR has occasional spelling errors
and bad word spans. Display spans are capped at two seconds and cannot overlap
the next word; the unmodified model output remains available locally.

See [validation.json](validation.json) for measured values and
[tests/reference.json](tests/reference.json) for the review scope and audio hash.

## Models and the Redux comparison

The installed `parakeet-mlx 0.5.0` uses MLX/Metal with
`mlx-community/parakeet-tdt-0.6b-v3`. Spokenly has a separate
`parakeet-tdt-0.6b-v2-coreml` model in its app container. Its local pipeline uses
FluidAudio/CoreML. We inspected model filenames, not personal dictation data.
Spokenly was not used as an inference service in this experiment.

Redux can be installed and run locally through Moondream Photon without a
cloud API key. On the **same cached 180-second clip**:

| Runtime | Inference | Loading + inference |
| --- | ---: | ---: |
| Parakeet MLX / Metal | 6.025 s | 8.005 s |
| Redux / CPU | 6.335 s | 18.230 s |
| Redux / Metal | 9.302 s | 15.099 s |

Redux was not faster here. Its CPU path may still be useful where GPU capacity
or model storage matters. Model loading includes different cache/download
conditions; compare inference columns, not startup columns. No reference
transcript was available for a word-error-rate comparison. Ultra was researched
but not installed or benchmarked. Keep MLX as the default until broader tests.

Primary references:

- [Parakeet MLX](https://github.com/senstella/parakeet-mlx)
- [Senko: local speaker separation and limitations](https://github.com/narcotic-sh/senko)
- [Redux and Ultra release](https://moondream.ai/blog/introducing-parakeet-redux-and-ultra)
- [Redux model card and licence](https://huggingface.co/moondream/parakeet-redux)
- [Photon local runtime](https://moondream.ai/photon)
- [Spokenly: Parakeet and FluidAudio](https://spokenly.app/blog/parakeet-vs-whisper)
- [Jev API](https://api.typesafe.ai/docs)
- [Codex non-interactive execution](https://learn.chatgpt.com/docs/non-interactive-mode)

## Reproduce the pipeline

Prerequisites: Apple Silicon, FFmpeg, Python, uv, Bun, the Codex CLI signed in,
and `JEV_API_KEY` in the process environment. **Luna is hosted inference through
the local CLI, not a local model.** Jev and Luna receive transcript text.
Audio transcription and diarization run locally. DeepSeek was not used: its API
key was unavailable, so the explicitly allowed Luna fallback was used.

```sh
# From apps/podcast-lab
uv venv --python 3.13 .venv
uv pip install --python .venv/bin/python -r requirements.lock

# This Mac already has this isolated uv tool. On a fresh Mac:
uv tool install 'parakeet-mlx==0.5.0'

# Download once, convert, transcribe, diarize, classify, enrich, prepare UI.
python3 pipeline/run.py

# Or stop before sending any transcript to hosted models:
python3 pipeline/run.py --local-only
```

`PARAKEET_PYTHON` overrides the existing MLX tool's Python path. `--data-dir`
selects a different experiment directory; set `PODCAST_DATA_DIR` to that absolute
path when starting the player. The default selected episode is fixed in
`pipeline/run.py`. Its feed is read once to locate the enclosure and metadata;
there is no feed-reader product code. If the episode leaves the public feed,
a cached `source.json` is needed.

The runner resumes checkpoints. To rerun a model stage, move its generated JSON
aside first. To change the audio or processing recipe, use a fresh data directory.
Downloads have a `.part` file and HTTP validator; an interrupted transfer resumes
with Range/If-Range, or restarts if the server changes the representation. The
completed file is verified by SHA-256. It is never edited to remove ads.

MP3 stays compressed for playback. STT uses mono 16 kHz PCM, not another lossy
codec. The WAV is a regenerable working file. Raw audio, transcripts, generated
artwork thumbnails, model outputs, logs, and local environments are Git-ignored.
The player serves a 640 px WebP cover and 130 waveform bins, not the source WAV.

Jev receives joined words from one detected speaker, split at speaker changes,
pauses over two seconds, or 45 seconds. Display paragraphs are separate from
these classification blocks. Each request to `/v1/systemone` uses model
`jev-1.13.0`, `state.target` (the block text), and
`state.surrounding_context` (speaker-labelled blocks overlapping 45 seconds
before and after it). The current Jev requests do **not** include the
episode description. That description is saved in `source.json` and sent only
to Luna for chapter/name enrichment. The general show description is not
currently collected. A future context experiment should include both as
separate background fields, without treating promotional show-note copy as
evidence that a spoken passage is an advertisement.

Three independent `noul` questions ask about paid third-party sponsorship,
publisher self-promotion, and credits. A coarse score of at least 0.5 triggers
refinement at sentence endings or 14 seconds. Refined requests retain the same
context; a highest score of at least 0.85 becomes a candidate. Both cutoffs are
provisional, not calibrated probabilities. Credits are not automatically skipped.
At most four requests run concurrently. Results are cached by the complete
model, questions, and input. Adjacent same-category candidates merge across
gaps up to 2.5 seconds only when no unclassified speech occupies the gap.

This grouping is incomplete: 38 of 166 blocks are shorter than three seconds.
Fast montage speaker changes produce fragments, and a low coarse score prevents
refinement. The next experiment should group complete promotional sequences
across speakers; sentence-level refinement can then locate their boundaries.

## Player boundaries and performance

- The local server supports bounded, suffix and open-ended byte ranges for seek.
- Only explicit player routes are exposed. Model logs and credentials are not.
- 297 speaker paragraphs replace the former 12-word lines. Paragraphs prefer
  sentence endings after 40 words and stop at 75 words or about 32 seconds.
  Speaker changes, pauses, and detected promotion boundaries remain separate.
- Only the viewport plus 350 px on each side is mounted, with any focused row
  retained. Measured variable heights replace estimates while preserving the
  first visible paragraph. DOM order matches reading order.
- Playback highlights a sentence or short section inside each paragraph without
  rebuilding the list or measuring layout on playback ticks.
- Removing unused word-level data reduced the player JSON from 1,044,923 to
  213,007 bytes. Raw word timings remain in the local pipeline artifacts.
- Seek feedback follows input immediately. Manual scrolling cancels following;
  reduced-motion mode removes smooth scroll. There is no claimed 120 fps result.
- The same audio element survives chapter and transcript navigation.
- Only Undo and Listen and check bypass a promotion, for one pass. Leaving the
  range or seeking elsewhere clears that exception. Ordinary seeks into a
  promotion, and restored playback inside one, still skip when playback starts.
  Refreshing restores position, speed and skip setting.
- Artwork and episode assets are cached locally. The server binds to loopback.

## Checks

```sh
bun run build           # Strict TypeScript check + small browser bundle
bun run lint
bun run test            # Range server, interrupted download and alignment
bun run test:e2e        # Real local episode; no podcast-host requests
uvx ruff check pipeline tests/test_pipeline.py
```

Browser checks cover chapter seek, manual/follow scrolling, a bounded row count,
automatic skipping, Undo without immediate re-skip, playback resume, phone
layout, paragraph seeking and highlighting, variable-height row spacing, keyboard
controls, and reduced motion. Screenshots and failure traces
stay in `.local/`. Tests do not claim audio-boundary accuracy or physical-device
frame rates.

Next validation should use several independent episodes with paid ads, host-read
ads, trailers, and ordinary product discussion. Listen to candidate boundaries,
measure missed ads and skipped editorial seconds, and test speaker names outside
ad montages. Improve grouping/context first. Do not lower the skip threshold or
build RSS infrastructure to hide those gaps.
