# Three-show classification check

**Keep the current player policy for now.** The best new variant improves ordinary
sponsor reads, but regresses on the original Ezra Klein montage. All six variants
remain experiments. The UI changes are live at http://127.0.0.1:4378.

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
