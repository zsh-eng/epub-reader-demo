# Three-show classification check

## Sequence and boundary follow-up

The Ezra preview now uses **boundaries-v8**: three complete promotion ranges,
including the full NYT anniversary montage. The original sentence classifier
remains the default batch pipeline; this experiment is selected explicitly with
`prepare_player.py --classification boundaries-v8.json`.

| Episode | Labelled promotion speech caught | Extra editorial speech skipped | Whole-break coverage |
| --- | ---: | ---: | ---: |
| Ezra Klein | 100% | 0 s | 99.94% |
| Decoder | 94.65% | 0 s | 88.34% |
| Darknet Diaries | 100% | 0 s | 100% |
| 99% Invisible | No labelled promotions | 0 s | No proposed skips |

Ezra changes from seven fragments / 110.24 seconds to three ranges / 138.48
seconds. The text reference is 138.56 seconds; the opening trailer's endpoint
differs by 0.08 seconds. The 38.80-second anniversary montage is intact.
Decoder still loses a mixed editorial/subscription unit and has transcript gaps.
Its final merged ranges include 2.24 seconds outside the reference **in pauses**;
zero extra *transcribed speech* is not zero boundary error.

The first sequence trial (v7) caught Ezra but included 16.8 seconds of extra
editorial speech on Decoder and treated 99PI's credits as self-promotion. V8 adds
an explicit credits class and whole-interval verification. This removes those
speech errors at the cost of some Decoder recall. It is not uniformly better
than the earlier v4 on recall, and is not promoted as the general classifier.

The method:

1. Keep the editorial opening of the RSS show/episode descriptions; remove common
   subscription/credits footers. A topic mismatch alone is never an ad signal.
2. Inspect overlapping 180-second windows with a 90-second stride across all voices.
3. Ask Jev whether there is a promotional **sequence** in the window.
4. Select its first and last transcript IDs through categorical choices. Sentence
   timestamps locate boundaries; sentence meanings are not independently gated.
5. Check the proposed interval as a whole: promotion, mixed, credits, or content.
   Reject mixed/uncertain ranges. Repeat on the suffix for additional breaks.
6. Merge overlaps. Keep decisions and input hashes for audit. Bind preview output
   to the downloaded audio hash and transcript hash before replacing player data.

There are at most four requests in flight. Full requests are cached. First v8
runs took 25.31 / 34.89 / 18.42 / 6.90 seconds respectively, with cached audio and
ASR; timings are single runs and can include reusable classification calls.
The frozen references never enter Jev requests. All four episodes are now
**development/regression data**, including 99PI. These figures measure agreement
with text references, not independent audio-boundary accuracy or generalization.

See [sequence-results.json](sequence-results.json) for hashes, both trials,
baselines, final intervals and separate speech/whole-break metrics.

```sh
python3 pipeline/sequences.py .local
python3 pipeline/sequences.py .local/benchmark/decoder
python3 pipeline/benchmark.py evaluate .local/benchmark/decoder --version boundaries-v8
python3 pipeline/prepare_player.py --classification boundaries-v8.json
```

## Earlier six-variant experiment

The following results predate the sequence/boundary follow-up. Those six variants
were not promoted because they regressed on the original Ezra montage.

## Results

GPT-6 Luna labelled each full transcript independently, before seeing any Jev
results. Decoder and Darknet Diaries were development cases. `choice-v4` was
selected before running or inspecting its 99% Invisible result. Later development
variants did not replace that held-out policy.

| Exact downloaded episode | Baseline ad-speech coverage | Choice v4 coverage | Speech outside Luna's ad labels |
| --- | ---: | ---: | ---: |
| Decoder — *I have some questions for Mark Zuckerberg* | 94.7% | **97.6%** | **2.08 s** (baseline: 0) |
| Darknet Diaries — *178: Ubiquiti* | 92.2% | **100%** | 0 s |
| 99% Invisible — *The Rocky Statue* | No labelled ads | No proposed ad skips | 0 s |

“Ad-speech coverage” counts the duration of aligned words inside Luna's sponsor
and self-promotion labels. It is **agreement with a text judge**, not human-verified
accuracy. The judge's boundaries use sentence units capped at about 12 seconds;
a mixed unit can contain both editorial and promotional words.

Whole-break coverage is lower: **88.8% for Decoder**, **100% for Darknet**. Decoder
has long gaps in the transcript, including inside the Delta read. Text cannot
establish the missing audio's content. We do not fill those gaps merely to raise
a score. Whole-break extra time can include silence; the speech metric excludes it.

The 99% Invisible download is a useful negative control. It does **not** establish
held-out ad recall. Dynamic ad insertion can produce different audio elsewhere;
[benchmark-results.json](benchmark-results.json) records the exact audio hashes,
transcript hashes, reference intervals, model versions, timings and every score.

Credits remain audible. If credits were also skipped, v4 would include **11.12 s**
outside Luna's non-editorial speech labels on Darknet, including an introduction
and a joke. On 99% Invisible it covers **81.5%** of labelled credit speech and adds
**2.4 s** outside those labels. “All non-podcast content” is not solved.

## What was tested

| Variant | Change | Development finding |
| --- | --- | --- |
| Baseline | Speaker blocks; coarse Noul gate; sentence refinement | Short fragments can be lost before refinement. |
| Context v1 | Every sentence; 90 seconds of context on either side | More context alone did not reliably help. |
| Context v2 | Explicit sequence-membership description | Did not improve both shows. |
| Sequence v3 | Shared passage, batched Noul questions, exact target paths; include the current show's promotion | 100% Darknet ad speech; 90.6% Decoder. |
| Choice v4 | One categorical choice per target: content, sponsor, self-promotion, credits; accept non-content probability ≥0.70 | Best development ad-speech coverage; 2.08 s editorial spill on Decoder. |
| Connected v5 | Recover v4 fragments only between strong v3 anchors within 20 seconds | Lower coverage than v4; did not remove the existing spill. |
| Passage v6 | Overlapping five-sentence passages across speakers; explicit mixed category; accept ≥0.85 | Clear whole reads detected, but mixed boundaries and montages were missed. |

V4 requests contain:

```text
state:
  show: { title, description }
  episode: { title, description }
  passage: chronological sentence units, across speakers, ±90 seconds
  targets: up to 12 units
questions:
  one Choice per target, referencing targets[i].text explicitly
  criteria: content / sponsor / self_promotion / credits
```

Metadata is background only. Jev never receives Luna's labels. Each request is
cached by its complete model, input and question definitions; at most four run
concurrently. Neighbouring same-category detections merge across ≤2.5 seconds
only if no unclassified words occupy the gap.

On these single runs, v4 took **7.47 / 13.32 / 8.48 seconds** for
Decoder / Darknet / 99% Invisible, compared with **39.92 / 30.26 / 40.63 seconds**
for the baseline. These are elapsed calls, not repeated latency measurements.
Local Parakeet transcription took **50.14 / 70.75 / 46.59 seconds** including
model loading. The app still uses one-shot processing.

[TypeSafe's question documentation](https://docs.typesafe.ai/primitives) supports
shared-state batching and explicit target paths.
[Choice](https://docs.typesafe.ai/primitives/choice) is appropriate for mutually
exclusive categories. These policy thresholds are experimental, not calibrated
error guarantees. Luna uses the signed-in Codex CLI with structured output, an
empty working directory, no requested tools and a read-only sandbox; inference
is hosted. See [OpenAI's evaluation guide](https://developers.openai.com/blog/eval-skills).

## Regression check and next decision

On the original Ezra Klein development episode, v4 detects **76.9%** of the
text-reviewed promotion interval duration versus the player's **79.6%**. It still
splits the anniversary montage. V6 reaches only **53.3%**. Neither replaces the
player's `classification.json` or `episode.json`.

The next useful test is a boundary review of ambiguous sequences, with audio
checks for transcript gaps and a fresh held-out episode containing ads. A slower
model could resolve ambiguous breaks after Jev finds candidates; that is not
implemented here. More prompt changes on these same episodes would not prove
general reliability.

## Reproduce without repeated podcast-host requests

From `apps/podcast-lab`, with the dependencies in README installed:

```sh
# Reads each public RSS feed once, downloads exact audio once, then runs local
# ASR/diarization sequentially to bound memory. Existing source/downloads resume.
python3 pipeline/benchmark_sources.py .local/benchmark

# Run for decoder, darknet, and 99pi. Freeze references before tuning:
python3 pipeline/benchmark.py judge .local/benchmark/decoder

# Original baseline (source files below are under this app):
PYTHONPATH=pipeline python3 -c 'from pathlib import Path; from classify import run; run(Path(".local/benchmark/decoder"))'

# Selected experimental policy and its scores:
python3 pipeline/benchmark.py choice .local/benchmark/decoder
python3 pipeline/benchmark.py evaluate .local/benchmark/decoder --version choice-v4
```

`JEV_API_KEY` comes from the shell environment; it is never served to the browser.
Judge output is frozen against its full prompt and exact audio identity. Use a
fresh experiment directory if the judge inputs change. Raw audio, transcripts,
prompts, responses and logs stay in ignored `.local/benchmark/`. No source audio
or transcript is committed. The frozen `episodes.json` records public feed URLs.
