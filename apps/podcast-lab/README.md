# Undertone · podcast tracer bullet

A local podcast library and listening prototype with cached RSS metadata,
speaker-separated transcripts and Jev promotion suggestions. Undertone is a
working name. There is no native app, account system or sync yet.

## Try it on this Mac

From the Workbench root:

```sh
bun run dev:podcast
```

Open **http://127.0.0.1:4378** for Home, or **http://127.0.0.1:4378/#player**
for the current transcript. The prepared episodes are stored in `.local/`.
Use a chapter or transcript passage to seek. Press Space to play. Scrolling stops
transcript following; **Follow along** returns to playback. Promotion cards let
you listen to a detected range. **Undo** replays a skipped range without skipping
it again during that pass. Ordinary scrubbing and restored playback positions
still respect the Skip promotions switch. Playback position is stored against
the exact audio hash.

Prepared episodes use actual local audio and model results. Other RSS episodes
stream directly from their enclosure URL only when opened; their transcript and
promotion detection are marked unprepared. The browser contains no API key.
Stop the server with Control-C.

## Library and show feeds

The first library contains **four shows, 400 cached RSS entries and four prepared
episodes**: Ezra Klein, Decoder, Darknet Diaries and 99% Invisible. Home has a
current-episode card, show artwork and a recent-episode feed. Following filters
that feed to locally followed shows. Downloads lists prepared local episodes.
Each show has its own page, creator/publisher credit, Follow control and RSS link.
Search matches show, creator, episode title and description. The catalog is
show-based; it does not infer guest appearances or a social network.

`pipeline/library.py` reads cached RSS XML, keeps at most 100 items per show,
normalizes dates to UTC, strips description HTML and uses feed GUIDs for stable
IDs (enclosure URLs when GUIDs are absent). It matches prepared audio by URL/GUID,
never title alone. A prepared episode remains available if it leaves the feed.
The small `library.json` contains metadata and file references, not audio or full
transcripts. `pipeline/run.py` saves RSS and rebuilds this snapshot after preparing
an episode. Existing data can be rebuilt without network or model calls:

```sh
python3 pipeline/library.py .local
```

TanStack Query Core caches and deduplicates catalog and prepared-transcript
requests. The feed mounts only 20 episode rows per page. Cover images use the
existing local 640 px WebP files, lazy loading and asynchronous decoding. Browsing
never replaces the audio element. Switching episodes saves the old position,
cleans up transcript observers, waits for the selected metadata and restores the
new episode's checkpoint. A request sequence number rejects stale selections.
Follows and the last selected episode stay in browser local storage.

**Current boundary:** this is a fixed four-show catalog. Adding arbitrary RSS URLs,
a directory search, scheduled feed refresh, OPML import, and a Download/Prepare
job queue are not connected. Streaming does not run models in the background.
Cached local playback works without internet while the loopback server is running;
online streaming depends on the enclosure host. No 120 fps claim is made.

## Latest three-show check

The new [classification benchmark](BENCHMARK.md) compares six variants on Decoder
and Darknet Diaries, plus a frozen-policy check on 99% Invisible. Batched choices
reach 97.6% and 100% of Luna-labelled ad speech on the development shows, but include
2.08 seconds of Decoder's introduction and regress on the original montage.
The player keeps its existing detections. See the report for whole-break coverage,
credit errors, exact audio hashes, timing and the limits of a text-only judge.

The player now has one compact header and an 82 px desktop / 108 px phone control
area (plus phone safe-area inset). Unknown voices use a waveform, not initials.
Promotion passages have a skip marker, a muted inset and an Auto-skip / Preview /
Skip off label that follows the actual playback setting.

## Original one-episode experiment

The full **67:43** download of *The “But China!” Dilemma Driving the A.I. Race*
from The Ezra Klein Show was used. Dynamic ads made its downloaded duration
longer than the feed's duration.

| Stage | Measured result |
| --- | --- |
| Parakeet MLX, whole episode | 130.4 s inference; 134.5 s with model loading |
| Senko CoreML, whole episode | 11.0 s inference; 111.7 s including first-run setup |
| Jev, final classification pass | 48.5 s with descriptions; four requests in flight at most |
| GPT-6 Luna via Codex | Generated 10 chapters and evidence-linked speaker labels |
| Suggested skips | 7 ranges, 110.24 s total |

These are single runs on this 16 GB Apple Silicon Mac. They are not a repeated
benchmark or a claim about iPhone speed. RSS memory measurements do not capture
all GPU/ANE memory.

**The hypothesis is partly supported.** Local transcription is fast enough and
the end-to-end listening flow works. Classification is not ready for unattended
use. A text review marked 138.56 s of promotion. Adding the RSS show and episode
descriptions improved coverage, but boundaries remain fragmented:

| Same audio and review reference | Transcript context only | With descriptions |
| --- | ---: | ---: |
| Promotion seconds detected | 84.64 | 110.24 |
| Reference coverage | 61.1% | 79.6% |
| Detected seconds outside reference | 0 | 0 |
| Missed promotion seconds | 53.92 | 28.32 |
| Separate skip ranges | 2 | 7 |

The rerun retained the model, speaker blocks, three categories, context window,
thresholds, and reference. It added descriptions plus a rule that metadata is
background, not evidence that the spoken target is an ad. It found 23.84 of
27.84 seconds in the opening trailer, all 71.92 seconds of the app promotion,
and 14.48 of 38.80 seconds in the anniversary montage. The montage includes
isolated cuts of 0.48 and 1.28 seconds; higher coverage does not yet mean smooth
whole-break skipping. No extra bridging or lower threshold was applied.

This is one development episode, not a held-out test or an audio-reviewed gold
standard. It does not isolate metadata from model variability or prove zero
false positives. No paid third-party ad was verified in this download.
Before/after artifacts and the fetched feed are retained locally under
`.local/experiments/metadata-context/`. The preview uses the new detections.

Speaker separation also merges some short ad voices with interview speakers.
Names are inferred from the introduction and can be wrong. Named host/guest
labels can use reviewed profile portraits. Unknown speakers and detected
promotion passages use distinct segment symbols; photos do not verify acoustic identity. Chapter boundaries start at existing speaker
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

## Speaker avatars

The batch pipeline remains unchanged. `avatar-sources.json` is a small catalog
of profile images selected by search and checked against their source pages:
[Ezra Klein's profile](https://x.com/ezraklein) and
[Matt Sheehan's Carnegie profile](https://carnegieendowment.org/people/matt-sheehan).
It is not an automatic Google Images scraper or face-recognition system.

`pipeline/avatars.py` downloads each selected image once, corrects orientation,
crops to a 96 × 96 square, and encodes WebP at quality 82. Current files are
1,332 and 2,692 bytes, displayed at 24 CSS pixels. Originals are discarded.
Files have content hashes and immutable browser caching; a local manifest
retains the source, recipe, and attribution. Changing a catalog entry triggers
a new download. Missing or failed portraits retain initials without layout
movement. Scrolling only requests the small local files.

To refresh portraits without redoing transcription or hosted inference:

```sh
.venv/bin/python pipeline/avatars.py .local
python3 pipeline/prepare_player.py
```

Source links appear under About detection. Original photography remains with
its respective owner; the catalog records provenance, not a licence grant.

## Progressive transcription

The installed Parakeet MLX 0.5.0 supports two paths:

- `transcribe(..., chunk_duration=90, overlap_duration=10)`, which we use,
  returns one merged result after all chunks finish. Its `chunk_callback`
  reports sample positions, not partial transcript text.
- `transcribe_stream()` accepts audio through `add_audio()` and exposes
  `result`, `finalized_tokens`, and `draft_tokens`. Draft text may change as
  more context arrives.

Our pipeline currently writes `asr.json` after full transcription, then runs
speaker separation and classification. Streaming is available in the library
but is not connected to this player. A progressive pipeline should publish
stable text first, retain an overlap tail for corrections, and classify only
after enough surrounding context is available. Speaker names and chapter
headings can arrive later. Streaming quality and latency still need a separate
comparison against the current batch run.

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
the library reads the saved RSS snapshot. If the episode leaves the public feed,
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
before and after it). Both passes also receive `state.show` and `state.episode`,
each with a title and description from RSS. HTML is reduced to plain text,
bounded to 6,000 characters for the show and 12,000 for the episode. The prompt
treats descriptions only as background: promotional copy in show notes is not
evidence that the spoken target is an advertisement. These fields participate
in the request cache key and are recorded in `classification.json` for audit.

New downloads save the general description as `showDescription` in
`source.json`. An older cached source without it sends an empty show description;
refresh that field from its feed before comparing metadata experiments. No audio
redownload is needed. Luna continues to receive the episode description for
chapter/name enrichment.

Three independent `noul` questions ask about paid third-party sponsorship,
publisher self-promotion, and credits. A coarse score of at least 0.5 triggers
refinement at sentence endings or 14 seconds. Refined requests retain the same
context; a highest score of at least 0.85 becomes a candidate. Both cutoffs are
provisional, not calibrated probabilities. Credits are not automatically skipped.
At most four requests run concurrently. Results are cached by the complete
model, questions, and input. Adjacent same-category candidates merge across
gaps up to 2.5 seconds only when no unclassified speech occupies the gap.

This baseline grouping is incomplete: 38 of 166 blocks are shorter than three
seconds. Fast montage speaker changes produce fragments, and a low coarse score
prevents refinement. The [multi-show benchmark](BENCHMARK.md) tests cross-speaker
units, batched questions, categorical decisions and complete passages. None is
promoted automatically because the original montage regression remains.

## Player boundaries and performance

- The local server supports bounded, suffix and open-ended byte ranges for seek.
- Only explicit player routes are exposed. Model logs and credentials are not.
- 300 speaker paragraphs replace the former 12-word lines. Paragraphs prefer
  sentence endings after 40 words and stop at 75 words or about 32 seconds.
  Speaker changes, pauses, and detected promotion boundaries remain separate.
- Only the viewport plus 350 px on each side is mounted, with any focused row
  retained. Measured variable heights replace estimates while preserving the
  first visible paragraph. DOM order matches reading order.
- Playback highlights a sentence or short section inside each paragraph without
  rebuilding the list or measuring layout on playback ticks.
- Removing unused word-level data reduced the player JSON from 1,044,923 to
  213,949 bytes. Raw word timings remain in the local pipeline artifacts.
- Follow along jumps to the active sentence, then corrects its position after
  nearby rows are measured. It does not animate through estimated row offsets.
  Playback advances the view only when the active sentence leaves the readable
  area. Manual scrolling cancels following. There is no claimed 120 fps result.
- The same audio element survives chapter and transcript navigation.
- Only Undo and Listen bypass a promotion, for one pass. Leaving the
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

The three-show evaluation is recorded in [BENCHMARK.md](BENCHMARK.md). The next
validation should listen to candidate boundaries and use a fresh held-out episode
with ads. Do not treat model agreement as verified audio-boundary accuracy.
