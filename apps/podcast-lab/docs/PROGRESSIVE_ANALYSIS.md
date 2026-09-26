# Progressive podcast analysis

Proposal, not active behavior. Draft ASR text already appears during transcription.
Speaker naming, chapters, and skipping currently wait for full ASR and Senko.

## Suggested release points

Treat 5 minutes, 30 minutes, and the end as cumulative audio positions. Stop at
sentence or complete promotional-sequence boundaries rather than an exact clock
cut. For a short episode, omit milestones beyond its duration.

| Audio available | Result to publish |
| --- | --- |
| First 5 minutes plus boundary context | Initial speaker map, introductory chapters, complete promotion ranges |
| Through 30 minutes | New speaker evidence, chapter additions, more completed promotion ranges |
| Remainder | Remaining results and final consistency checks |

Jev should keep its existing 180-second windows, 90-second stride, and bounded
parallelism. Do not send one 30-minute classification block. Schedule windows
when their transcript context is available. Hold promotions that reach an
unfinished analysis edge; use the next window to resolve the endpoint. A long
promotion may need expanded context, not a forced cut at the window boundary.

## Stable speaker identity comes first

The installed Senko implementation renumbers speakers by total speaking time.
Its SPEAKER_01 from a five-minute prefix can be a different person at 30 minutes.
The current wrapper retains segments but discards speaker centroids.

Persist episode-local voice identities and reconcile later clusters using
centroids and shared-time overlap. Ambiguous matches remain unnamed. Luna may
supply names backed by transcript/metadata evidence; it must not establish an
acoustic identity by guessing from speaking style. Store corrections explicitly.

First benchmark prefix diarization against the full run on cached audio. Keep
MLX and CoreML model allocation controlled; repeated loading and repeated prefix
analysis may erase the latency gain. Do not assume the current full-file Senko
call provides an incremental clustering interface.

## Luna continuation

Use one persisted, explicitly addressed session per audio hash and prompt version.
The current `--ephemeral` one-shot process must change before it can be resumed.
Never use `--last` when multiple episodes can be queued.

Send stable instructions and show metadata first. Append each new batch in a
new message with stable speaker/block IDs. Request additions or corrections,
not another complete transcript or chapter list. Keep validated speaker maps,
chapters, and the analysis position in application storage, independent of the
conversation, so a lost session can be rebuilt without duplicate UI entries.

[Codex supports resuming an explicit session](https://learn.chatgpt.com/docs/non-interactive-mode).
[Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
can reuse matching context, but a session alone does not guarantee a cache hit.
Preserve earlier messages; append new ones. Measure available cache usage and
latency. API continuation still accounts for earlier context as input;
[conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
is not free context. API pricing does not establish Codex subscription usage.

## Player and retry rules

- Switch to the exact hashed local download before applying any skip range.
  Publisher-stream timestamps may differ because of dynamic ads.
- Show the analysis coverage, for example “Skips ready through 5:00”. Unprocessed
  audio remains playable, but has no automatic skip guarantee.
- Keep uncovered or ambiguous intervals audible. A newly published range must
  not suddenly jump playback when the listener is already inside it.
- Publish versioned results atomically. Keys include audio hash, model/prompt
  version, and covered interval. Retry the failed stage only; deduplicate ranges.
- Retain the current paragraph, selection, playback position, and scroll anchor
  as speaker names, portraits, and chapters arrive.

## Separate implementation commits

1. Checkpoint coordinator and stable acoustic speaker identity.
2. Persisted Luna continuation with validated incremental results and recovery.
3. Jev partial coverage and conservative promotion-edge handling.
4. Player coverage, exact-audio handoff, and in-place result updates.

Validate on cached episodes before activation: first useful result latency,
cache use, host/guest swaps, promotions across both milestone boundaries, new
late speakers, interrupted/repeated jobs, and seek beyond analyzed coverage.
