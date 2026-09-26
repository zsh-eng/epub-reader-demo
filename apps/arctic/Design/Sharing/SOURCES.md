> Historical first studies. The current native templates and generated material studies are in [PosterLab](PosterLab/index.html).

# Arctic sharing references

Open [the visual board](index.html). It works offline and includes ten original CSS/SVG studies. The format control compares 4:5 feed and 9:16 story composition. These are design explorations coordinated with the native export theme names. They use placeholder copy and browser fonts; exact native composition and long-text behavior must be reviewed in the app.

## References

Reviewed 26 September 2026. Source links lead to the publisher or designer, not an image aggregator.

| Source | What was observed | Arctic application |
| --- | --- | --- |
| [Strange Pilgrims official links](https://linktr.ee/strangepilgrims) and the two screenshots supplied by the user | The supplied literary carousel uses a shared painting, serif hierarchy, centered book covers, and inset prose. | Stable title/source zones; lead → passage → reflection sequence. Use article imagery and original fields, not the reference painting or book covers. |
| [The Paris Review — Pentagram / Matt Willey](https://www.pentagram.com/work/the-paris-review) | The case study describes archival minimalism, more cover space for art, and warm book-like paper. | Quiet colophon, clear reading area, less decorative chrome. This is an interpretation, not a reproduction. |
| [The Atlantic — Pentagram / Luke Hayman and Michael Bierut](https://www.pentagram.com/work/the-atlantic) | The editorial system pairs serif and sans, with a stable information band. | Serif content plus small sans metadata. Source stays in the same position as content changes. |
| [Yurr Magazine — Spencer Curnow](https://spencercurnow.com/work/yurr) | The designer describes Instagram issues rendered from a repeatable typographic system and structured content. | Treat a carousel as a small edition; render content into a consistent system rather than manually composing every slide. |

The Instagram-specific observation is based on the user's two screenshots and the Yurr designer's own case study. A complete Instagram feed was not audited. No claim of “best performing” social content is made.

## Ten original studies

1. **Paper:** image field, large serif title, small source. Recommended lead for articles with a suitable image. The demo uses an original ice-strata SVG.
2. **Ink:** warm dark surface, thin glacier rule, large text. Recommended quote-only treatment. A long quote needs pagination, not a smaller font.
3. **Ice:** a small geometric ice form and inset personal-note label. Use for a reflection, distinct from an author's quoted text.

4. **Signal:** oversized typographic shape and a strict red field.
5. **Dusk:** a plum-to-ink atmosphere and pale italic text.
6. **Cutout:** offset paper scraps and a continuous italic sentence.
7. **Field:** an original branch illustration and specimen-like credit.
8. **Folio:** a pale lavender literary page with a margin rule.
9. **Ribbon:** emphatic sans type on a rose field, with contrasting editorial bands.
10. **Index:** a list of takeaways on a ticket-like page.

Each template uses a discreet icon-only credit. The theme picker can isolate a direction. The expanded palette was explicitly requested by the user; new colours apply to these design studies and the native story artwork, not app chrome.

All sample copy in the ten studies is original placeholder copy, not attributed to a real author. The first three fields use existing Arctic values: Paper `#fffcf0`, Ink `#100f0f`, light accent `#217db5`, dark accent `#73d1f2`, and blends of these values. The other seven studies introduce separate editorial palettes to test the requested broader directions. System sans and Georgia approximate the native typographic contrast; final SwiftUI work must use the app's actual fonts.

## Asset provenance

- `references/strange-pilgrims-cover.jpg`: user attachment `codex-clipboard-98269e35-6678-4708-be37-066452a4f3a5.jpg`.
- `references/strange-pilgrims-carousel.jpg`: user attachment `codex-clipboard-74d7cfd4-eb11-484c-96de-1f0e067d57da.jpg`.
- These screenshots are retained for this design review only. They are not bundled into Arctic or used in exported user content.
- All SVG geometry and sample text in `index.html` were created for this board. No external fonts, remote image requests, or generated raster assets are required.

## Native implementation and further checks

Measure long quotes, CJK text, author/title wrapping, and source placement at real export sizes. Check feed and story safe areas separately. Preserve quoted text exactly; paginate rather than clip. Use cached article imagery when appropriate. Keep the no-image option equally considered. The production picker now offers ten coordinated directions in `Sources/PassageStory.swift`. The browser studies are not pixel-identical native screenshots. Native exports remain 9:16; the board's 4:5 mode is a design study.
