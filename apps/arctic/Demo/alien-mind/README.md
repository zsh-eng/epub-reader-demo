# Native Arctic × Jev replay

Open **Sort and filter → Article replay** in the Swift app. The scene starts automatically, loops, and has no onboarding footer or replay button. Its height adapts up to 560 points, compared with the 400-point onboarding illustration. Close it with the top-right cross.

The scene reuses the onboarding card, moving touch indicator, and real `ConnectedTagReveal` / `TagRevealPill` components. It follows the system appearance, stops when hidden or backgrounded, and shows a static saved card with Reduce Motion. No replay changes library data or makes network calls.

Review `Sources/ArticleReplayView.swift`, the shared components in `Sources/OnboardingIllustrations.swift`, then the entry point in `Sources/ArticleReaderApp.swift` (paths relative to `apps/arctic/`). The bundled fixture is `Resources/Fixtures/alien-mind-replay.json`, copied from the measured production result below. The OG image lives in `Resources/Assets.xcassets/AlienMindReplay.imageset`.

The HTML scene, web render script and web player have been removed. Existing MP4/render validation files are historical artifacts from the superseded web version, not checks of the native scene.

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

## Timing

The native tag processing phase uses the measured 0.911414-second production duration. The remaining pauses are presentation timing. The displayed tags come from the recorded result; no labels were forced. The native screen is a designed replay, not a fresh Jev request.

## Classification probe

`test-jev.py` compiles the captured Swift parser/client and uses the existing `JEV_API_KEY` environment. It skips modes with saved results. The full-context diagnostic explicitly bypasses the normal client character cap; the production fixture does not. All three original request/response/result triplets remain here for review.

## Native validation

The iPhone 17 Pro simulator build and both focused native replay UI tests pass.
They cover successive loops, background/resume, dismissal/reopening, no library
save, dark appearance and Reduce Motion. Final article, tagging, saved-library
and dark screenshots were inspected. Changed Swift files pass strict
`swift-format` lint.

The existing `testDemonstrationsCompleteAndReplay` check fails at its unrelated
onboarding privacy/footer spacing assertion (`706 < 706`). The same failure was
reproduced once on unchanged commit `7d65c0b` in an isolated baseline build.
No connected-phone build or installation was performed.
