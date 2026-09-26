# Progressive podcast analysis

Active for new preparation jobs. Existing ready episodes are not reprocessed.
The app downloads and hashes the whole audio file first. Analysis then publishes
cumulative snapshots; it does not analyse an incomplete network download.

## Release points

| Pass | Audio analysed | Interactive transcript |
| --- | --- | --- |
| First | 0–6:30 | Through 5:00 |
| Second | 0–31:30 | Through 30:00 |
| Final | Full episode | Full episode |

The extra 90 seconds provide context for promotion boundaries. Omit a prefix
pass if its end plus context reaches the episode end. A short episode therefore
has one or two passes. Draft text appears during the first ASR pass; completed
snapshots remain visible during later work.

Each pass runs Parakeet MLX, then Senko. It then runs Luna and Jev concurrently.
Speech models remain sequential under the existing worker lock. This first
implementation repeats the cumulative audio prefix for both local models. It
trades extra computation for simpler, consistent speaker assignment; it is not
incremental acoustic clustering or a low-latency streaming model.

## Fresh speaker naming

Senko can renumber IDs between runs. Each Luna call receives all blocks from
**that pass**, plus episode/show metadata and its analysis scope. It independently
names those IDs. No earlier Senko ID or name map enters the next request.

The player receives rows, names, chapters, portraits and skip ranges in one
snapshot. It replaces that snapshot as a unit. A changed acoustic ID cannot
inherit a previous pass's name. Evidence checks still apply; uncertain names
remain unassigned. Short prefixes can have weaker speaker evidence.

Calls are independent, ephemeral Luna requests. There is no persistent chat or
assumed provider input-cache saving. Identical complete enrichment requests can
reuse the app's local checkpoint.

## Jev windows and safe coverage

Jev retains its 180-second windows, 90-second stride, bounded parallel requests,
and complete promotional-sequence boundary selection. It receives podcast and
episode descriptions with timed text. Acoustic IDs are excluded from those
windows: a Senko renumbering alone must not invalidate cached classifications.

All passes share a request cache keyed by the full model, questions and input.
Unchanged windows reuse local responses. Changed ASR text, boundaries or context
correctly require new calls.

A partial pass publishes only ranges ending inside its displayed coverage and
having following transcript context. An unresolved trailing promotion stays
audible until a later pass resolves it. This is a conservative publication rule,
not a guarantee of advertising recall. Final results retain the detector's
existing behavior and known accuracy limitations.

## Checkpoints and recovery

`pipeline/progressive.py` coordinates `.local/prepared/<episodeId>/passes/`.
Each pass records an immutable manifest with the exact audio hash, coverage,
context end and recipe. Different audio or milestone settings cannot reuse it.

- Model outputs and enrichment/classification requests remain private checkpoints.
- `published.json` is the completed pass checkpoint.
- The worker atomically replaces `analysis.json`, then its small
  `analysis-state.json` pointer. The payload carries its own revision and coverage.
- The API exposes partial analysis and the exact local audio only after publication.
- The final pass writes `episode.json`; the worker then marks the job ready.
- Retry retains the last usable snapshot and resumes missing work. It never
  republishes an older completed pass over a newer one.
- Successful pass PCM files are removed; compressed source audio and model
  checkpoints remain for audit and retry.

## Player behavior

The first snapshot switches playback to the exact hashed local MP3 before any
skip applies. It retains play/pause, speed, skip preference and time. This handoff
can briefly buffer. Publisher streams may have different dynamic ads, so keeping
the same seconds is only an approximate position match.

Later snapshots keep the same loaded media. They retain manual scroll position
by transcript time and measured screen offset. A selected transcript passage
defers replacement until selection is cleared. A newly detected skip under the
playhead stays audible for that pass; seeking into it later permits normal skip
behavior. Coverage is shown while the remaining analysis runs. Browsing does not
start jobs or cancel an existing one; playback/explicit preparation starts work.

## Validation

Production-wiring integration tests cover retry after the second pass fails,
fresh IDs and names in each snapshot, audio identity, shared Jev cache reuse,
held trailing promotions, partial byte-range playback and final publication.
Browser tests cover media retention at 1.25×, selection deferral, scroll retention,
new skip behavior, navigation and duplicate preparation requests.

A real-model check used a cached 100-second Ezra clip and **scaled** release
points of 20, 50 and 100 seconds, without lookahead. It published at approximately
31.9, 60.4 and 95.6 seconds elapsed. Every row referenced a name map from its own
pass and every published row/skip ended within coverage. The final result had
21 paragraphs and one promotion range; early passes had no accepted skips.
These measurements validate wiring, not five-minute latency or speaker/ad
accuracy. Repeated Senko startup alone took about 14–15 seconds per pass.

Next performance work should compare normal 5/30-minute milestones on longer
cached episodes and measure model reuse. Do not infer a speedup from the short
smoke test or treat a partial empty skip list as verified ad-free audio.
