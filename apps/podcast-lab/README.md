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
stream directly from their enclosure URL when opened. Selection also queues
background preparation on this Mac. The browser contains no API key.
Stop the server with Control-C.

Real streaming was checked in desktop Chromium with Plain English and Dwarkesh:
playback, a ten-minute seek with HTTP 206 byte-range responses, browsing during
playback, and checkpoint restoration after switching episodes. This does not
verify every host or Safari/iPhone. The preparation pipeline now starts on episode
selection while streaming continues. A failed stream
shows a compact error; Play reloads it and restores the saved position.

## Library and show feeds

The personal catalog contains **the 20 shows from your screenshots**, with
1,336 cached entries on this refresh. `feeds.json` records the selected feed URLs
and Apple directory provenance. The “Your Episodes” playlist is not a show.
Decoder, Darknet Diaries and 99PI remain local benchmark fixtures and are excluded
from the personal library. Only the existing Ezra episode is prepared locally;
other episodes stream on selection and enter the local preparation queue.

Home has a single horizontally scrolling show shelf and recent episodes. All
shows displays the full grid. Each show has a creator credit, RSS link and Follow
control. New browser profiles initially follow this personal catalog; existing
follow choices remain under user control. Search matches titles, creators and
descriptions. The catalog does not infer guest appearances or a social network.

Refresh manually from the app directory:

```sh
bun run feeds:refresh
# Revalidate early, still with conditional HTTP requests:
bun run feeds:refresh --force
# Rebuild from disk with no network:
python3 pipeline/library.py .local
```

`pipeline/feeds.py` uses at most three workers, a one-hour freshness interval,
ETag/If-None-Match and Last-Modified/If-Modified-Since. A 304 reuses cached XML.
Invalid responses and network failures preserve the last good snapshot. Each
response has a 20 MiB bound; the catalog and RSS files are replaced atomically.
Refresh never fetches an episode enclosure. A warm refresh of all 20 shows
reported **zero downloaded bytes**. Publishers without validators can still
require a full RSS response after the freshness interval.

`pipeline/library.py` deduplicates GUIDs, sorts by publication time, keeps at most
100 recent episodes per show, and preserves prepared older episodes. It separates
metadata from audio/transcripts, retains UTC publication dates, and matches local
audio by URL/GUID rather than title. The 2.12 MB JSON snapshot has a prebuilt
653 KB gzip representation. The local server uses HTTP validators, so unchanged
metadata can return 304 instead of retransmitting the catalog.

Artwork is fetched once per source URL, resized to at most 384 px and stored as
WebP quality 80. The 20 covers total **264 KB**, with a largest file of 37 KB.
Original image bytes are not retained. Covers load lazily and decode asynchronously.
TanStack Query caches/deduplicates metadata and transcript requests. Each feed
mounts at most 20 rows. Search strings and the show index are built once.
Browsing retains the same audio element and each episode's playback checkpoint.
Browser tests confirm that personal-library browsing makes no external requests.

**Current boundary:** refresh is a command, not a scheduled job or UI control.
The browser loads the bounded catalog at startup; it is not server-paginated.
This is suitable for this 20-show prototype, not a claim about an unlimited feed
archive or 120 fps. Arbitrary feed imports, OPML, accounts and sync are not
connected. Cached playback requires the loopback server.

## Background preparation

Opening an unprepared episode starts a same-origin POST to
`/api/preparations/:episodeId`. The server accepts catalog IDs only, looks up the
source itself, and deduplicates repeat requests. One episode runs at a time.
A cross-process file lock prevents two local speech models from running together
if the server restarts. The UI polls the selected job every 1.5 seconds; it shows
actual stages rather than an estimated percentage:

1. Download with resumable HTTP ranges; show bytes and percentage when the host
   supplies a total size. Unknown totals show received bytes without a percentage.
   Progress is written at most twice per second (plus completion) and polled by
   the UI every 1.5 seconds. Hash the complete saved file before transcription.
2. Convert to mono 16 kHz PCM, then run Parakeet MLX and Senko sequentially.
   Parakeet uses 90-second chunks with 10-second overlap internally; the app waits
   for its full result, then separates speakers for the full recording.
3. Run Jev's complete-sequence detector and Luna enrichment concurrently. Jev
   uses three-minute windows starting every 90 seconds, with up to four windows
   in flight. Luna receives the complete speaker blocks in one call for names
   and chapters. Results are not pipelined from partial ASR chunks.
4. Validate the audio/transcript hashes, materialize paragraphs, and mark ready.

Audio keeps playing while the job runs, including while browsing. When ready,
the player switches to the **analyzed local MP3** and installs its transcript and
skip ranges together. It keeps the same audio element and preserves play/pause,
speed, skip preference and playback time. A brief loading pause is possible.
Publisher streams can contain different dynamic ads from the downloaded file;
retained seconds are approximate across that handoff. We do not apply downloaded
skip ranges to the original publisher stream. A prepared episode reopens locally
and appears in Downloads, including after reload.

Jobs and model checkpoints live in `.local/prepared/<episodeId>/`, separate from
the RSS snapshot. Completed stages are retained for retry. Failed jobs offer
**Retry preparation** while ordinary audio playback remains available. Browser
navigation does not stop work. After a server interruption, reselect/retry the
episode to resume queued or stopped work; an existing live worker is rejoined.
The large PCM intermediate is removed after success. Raw logs, source metadata
and credentials are not public HTTP routes. The server needs its existing
`JEV_API_KEY`, local speech runtimes and Codex login; it sends transcript text to
Jev and Luna, never audio. No automatic avatar search is part of this job.

Validation: the actual POST/worker path completed a 100-second cached Ezra clip,
producing 21 transcript paragraphs, two chapters and one 0.40–28.16 promotion
range. Parakeet took 8.46 seconds including loading, Senko 18.32 seconds, and the
hosted work took about 14 seconds. This is an integration check, not an accuracy
or full-episode latency benchmark. Browser tests cover streaming during work,
background completion, media handoff, retry, selection changes and reload.
Routine tests disable real model jobs and use local audio at the network boundary.

## Latest three-show check

The new [classification benchmark](BENCHMARK.md) compares six variants on Decoder
and Darknet Diaries, plus a frozen-policy check on 99% Invisible. Batched choices
reach 97.6% and 100% of Luna-labelled ad speech on the development shows, but include
2.08 seconds of Decoder's introduction and regress on the original montage.
The newer sequence/boundary follow-up now catches the complete Ezra montage;
that episode's preview uses it. It reaches 99.94% Ezra promotion-duration coverage,
100% Darknet promotion-speech coverage and 94.65% Decoder promotion-speech coverage,
with no extra editorial speech against these text references. 99PI proposes no
promotion skips. Background preparation uses this sequence policy; the older
CLI experiment retains its baseline classifier. Decoder still has misses. See
the report for boundary errors, hashes and evaluation limits.

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
`.local/experiments/metadata-context/`. This was the earlier preview policy; the current Ezra preview uses the sequence
follow-up described in BENCHMARK.md.

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
units, batched questions, categorical decisions and complete passages. The six earlier variants were not promoted. `pipeline/sequences.py` now provides
an opt-in sequence detector and boundary locator; see BENCHMARK.md for the latest
four-episode comparison and remaining Decoder limitations.

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

## Motion

Cached cover art moves from its library card into the show or listening view
in 240 ms. Sidebar navigation is immediate, without cover travel or page arrival. Page arrivals take 180 ms; play/pause icons crossfade in 150 ms and
skip notices enter/leave in 180 ms without moving content. Fine pointers get a
small cover lift. The scrubber, search results and virtual transcript remain
direct; no animation delays playback or list updates.

The cover transition uses `motion/mini`; simple feedback uses CSS. Only opacity
and transforms animate. Rapid navigation cancels old transitions and restores
the destination cover. Keyboard navigation is immediate. Reduced motion removes
cover travel, scaling and the rotating loading ring. High contrast or reduced
transparency replaces glass with solid surfaces. The minified player bundle is
62 KB (before motion: 47 KB); this is not a measured frame-rate result.

Streams show actual buffered ranges from the media element and a loading ring
only while playback waits for data. They do not show an invented waveform.

## Checks

```sh
bun run build           # Strict TypeScript check + small browser bundle
bun run lint
bun run test            # Range server, interrupted download and alignment
bun run test:e2e        # Real local episode; no podcast-host requests
# Optional: real publisher audio. Requires the personal .local/library.json.
PODCAST_LIVE_STREAM=1 bun run test:e2e tests/streaming.spec.ts
uvx ruff check pipeline tests/test_pipeline.py
```

Browser checks cover chapter seek, manual/follow scrolling, a bounded row count,
automatic skipping, Undo without immediate re-skip, playback resume, phone
layout, paragraph seeking and highlighting, variable-height row spacing, keyboard
controls, reduced motion, interrupted cover transitions, and stream error recovery.
The routine suite uses a 64 KB local MP3 prefix for the stream recovery check.
Screenshots and failure traces
stay in `.local/`. Tests do not claim audio-boundary accuracy or physical-device
frame rates.

The three-show evaluation is recorded in [BENCHMARK.md](BENCHMARK.md). The next
validation should listen to candidate boundaries and use a fresh held-out episode
with ads. Do not treat model agreement as verified audio-boundary accuracy.
