# Arctic × Jev: An Alien Mind

A 32-second, 1080 × 1920, 30 fps H.264 designed replay for LinkedIn. It is a programmatic reconstruction, not a live screen recording. No post was published.

## Review order

1. `arctic-jev-linkedin.mp4`: finished video (local output, excluded from Git).
2. `scene.html`: editable composition, UI, touch path, tap times and deterministic timeline.
3. `render.mjs`: frame capture and H.264 export.
4. `production-result.json` and the request/response files: actual Jev evidence.
5. `test-jev.py` and `reference/`: reproducible Swift probe and source snapshot.

## Evidence

Article: https://openai.com/index/an-alien-mind/ — **An Alien Mind**, Jakub Pachocki, September 6, 2026.
The observed browser DOM is saved in `article-source.json`; its head metadata and main content are retained, without page scripts. The real OG image is `og.png`; its source URL is recorded in the results. No replacement artwork was generated.

Direct command-line retrieval met a Cloudflare challenge. The article loaded in the in-app browser. The actual Arctic `ArticleMetadata.parse` function was run against that captured DOM. Thus these results verify parsing and classification, not successful native fetching of this URL on an iPhone.

The probe compiles the actual Swift category catalog, parser and Jev client copied from the active main working tree at this task's start. It removes only unused Keychain/preferences code and instruments request/response capture. It calls the actual `JevClient.classify` function. The key is supplied by the existing environment; no headers or credentials are captured. No native application code or main checkout was changed.

Model: `jev-1.13.0`. Selection threshold: **0.75**. One call per input, in production / metadata / full order. All calls and scores are retained; no favorable rerun was chosen.

| Input | Characters sent | Request seconds | Technology & society | Society | Selected |
|---|---:|---:|---:|---:|---|
| production | 1288 | 0.911 | 0.90 | 0.64 | Technology & society |
| metadata | 156 | 0.712 | 0.87 | 0.64 | Technology & society |
| full | 19501 | 0.975 | 0.93 | 0.68 | Technology & society |

Production sends the title, 156-character metadata description, and the parser's first 180 words. The byline meets the paragraph-length rule and consumes seven words, leaving 173 prose words. The combined context has 204 words including its label. The 2,500-character client cap does not truncate this request.
The earlier worktree extractor used prose only when metadata was short or repetitive. This page's 156-character description would therefore have produced metadata-only input. The snapshot from main includes prose even with a substantial description.

The full-context diagnostic retains the same model, questions, definitions and threshold but explicitly bypasses the 2,500-character cap. It supplies all captured substantial paragraphs, including the late governance passages and footnotes. This is a diagnostic, not the production input used in the video.

**Why Society is absent:** its question asks about “Institutions, politics, inequality, economics, culture and civic responsibility,” using the original classification name “Society & power.” The technology category explicitly covers autonomy and power. Jev scores that category strongly and the separate Society category below threshold, even with late-article context. This evidence does not justify forcing Society or lowering a general threshold to make one demo pass. No tagging fix is included. The source snapshot still displays “Technology & society,” rather than the requested shorter “Tech.”

### All scores

| Category | Production | Metadata | Full context |
|---|---:|---:|---:|
| Engineering | 0.17 | 0.11 | 0.15 |
| Building with AI | 0.18 | 0.08 | 0.19 |
| Craft | 0.03 | 0.02 | 0.02 |
| Career | 0.15 | 0.10 | 0.16 |
| Agency | 0.21 | 0.16 | 0.25 |
| Attention | 0.07 | 0.05 | 0.04 |
| Social | 0.03 | 0.03 | 0.03 |
| Learning & writing | 0.17 | 0.13 | 0.22 |
| Life | 0.13 | 0.09 | 0.15 |
| Society | 0.64 | 0.64 | 0.68 |
| Technology & society | 0.90 | 0.87 | 0.93 |
| Practical | 0.02 | 0.02 | 0.01 |

## Timing and design

The measured 0.911-second production request begins at 7.400 s and completes at 8.311 s in the replay. It is not accelerated. The border fades over 0.65 s and tag labels follow the native reveal pattern. The remaining navigation and dwell times are editorial. The renderer has an explicit six-second maximum for future reruns; that limit did not apply to this result.

The simulated touch indicator moves with an ease-in-out curve, pauses at each target, compresses for 120 ms and emits a 420 ms ripple. The scenes follow Arctic's system sans/serif typography, neutral native surfaces, glacier-blue accent, glass controls and angular border beam. The Reader changes to the existing Ink palette as an editorial cut, not a recorded theme-setting action. The short Reader excerpt is intentionally truncated; pagination and reading-time measurements are not claimed. The library contains only this demo article.

## Rebuild

From the repository root:

```sh
node article-reader/Demo/alien-mind/render.mjs --stills
node article-reader/Demo/alien-mind/render.mjs
```

The renderer uses the bundled Playwright module and an installed Chromium binary. Override `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` on another machine. FFmpeg must be in PATH. Rendering uses saved results and makes no Jev calls.

To run the probe, use the existing zsh environment with `JEV_API_KEY`, Swift, and the local SwiftSoup checkout path in `test-jev.py`:

```sh
python3 article-reader/Demo/alien-mind/test-jev.py
```

Existing result files prevent duplicate calls. Archive the complete request/response/result triplet before an intentional rerun. `reference/` records the precise app-code snapshot; update both snapshot files together when testing a new app version.

## Source hashes

- `reference/ArticleTagging.swift`: `8d7f61e525b87921876d98116b853266e728d8741d874b6944e9dd1494c90ddf`
- `reference/ArticleMetadata.swift`: `3e873b9405cc9c05ec4eefd58d9fa709e1954f18b786d782acc5868c797a6719`
- `og.png`: `fa3ddf2f5bc101fe54c11240abd9f574d54110d34096cae35258c0c10d99fc07`

## Validation

The actual Swift probe compiled and all three calls completed. Eight representative frames were visually inspected. FFmpeg decoded all 960 frames without errors. Browser playback confirmed 1080 × 1920 dimensions and a 32-second duration. `validation.json` and `render-info.json` record export checks. The video is silent. No native build or phone test was needed because the native app was not changed.
