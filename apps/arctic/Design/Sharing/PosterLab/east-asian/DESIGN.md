# East Asian poster directions

Generated with the built-in image generation tool on 26 September 2026. These are original concept explorations, not reproductions of the linked reference works. English-only typography avoids decorative fake glyphs.

## Files and inspection

- `concepts.png` — 1625 × 968; three finished quote posters in a single review sheet. Left: Sumi. Centre: Seoul. Right: Hanji.
- `indigo-paper-moon.png` — 941 × 1672; reusable near-9:16 type-free artwork. Its aspect ratio differs from 9:16 by less than 0.1%; use a fixed 9:16 clipping frame. Keep the original untouched.

Both generated results were inspected at full composition size. The sample quote is correct on all three concepts. Attribution gained a terminal full stop but is otherwise correct. Tiny marks are conceptual; production must use the real Arctic mark's silhouette. The reusable background contains no text, mark or watermark. Its moon starts around the bottom quarter, with sufficient dark space above it for live text.

## Production recipes

| Edition | Palette | Type and layout | Reusable elements |
| --- | --- | --- | --- |
| Sumi | Midnight indigo #111D35, warm ivory #F3ECD9 | Literary serif, large first sentence, left aligned with 8% margins. Fine vertical rule at 5%; keep source above the moon. Use a 1.55–1.8× opening sentence only when enough text fits. | Use generated indigo-paper-moon background. Live text, rule and small real mark. |
| Seoul | Acid yellow #E4F040, cobalt #2134B8 | Condensed heavy sans for opening, bold sans below; stepped scale with a compact editorial annotation rail. Preserve readable words and logical order. | Circle/square cutout geometry is native; subtle overprint grain may be a small repeatable texture. No pre-rendered quote text. |
| Hanji | Warm paper #ECE4D5, soft plum #664752 | Book serif centred or gently left aligned within broad jar-shaped negative space. Source low inside shape; surrounding paper shares the canvas. | Native imperfect asymmetric jar path. A paper-grain asset can remain separate from text and shape. |

Use native text so long passages paginate without loss. Short quotations can use greater type contrast; long ones must reduce the opening/body ratio or share the same measured size. Respect story safe areas and keep all attribution fully readable. An original cultural reference is a starting point, not a claim that a whole country's design has one style.

## Primary references

1. [MoMA: Ikko Tanaka collection](https://www.moma.org/artists/5800-ikko-tanaka). Study controlled graphic hierarchy and the relationship of typography to flat shapes in a Japanese poster collection. We do not copy a composition or reproduce a Tanaka work.
2. [Sulki & Min: Clarifying & Obscuring](https://www.sulki-min.com/wp/sulki-min-clarifying-obscuring/). The studio's discussion connects print material, text/image ambiguity and time in digital work. Our Seoul direction takes the permission to make type an assertive graphic object, while keeping the actual reader quote clear.
3. [The Metropolitan Museum of Art: Moon jar, Korea](https://www.metmuseum.org/art/collection/search/45432). The curatorial text describes each jar's asymmetry and construction from two hemispheres. That imperfect balance informs Hanji's negative-space silhouette.

## Exact generation prompts

### Three-poster concept sheet

```text
Use case: stylized-concept. Asset type: premium editorial quote-poster concept sheet for an article reader's image exports. Create ONE wide landscape image showing THREE equal tall 9:16 posters side-by-side, straight-on flat artwork, tiny neutral gaps, no physical mockup, no perspective or shadows outside cards. Each poster is a beautiful finished graphic design, significantly different from the others. Aim for art-book and independent design-festival quality rather than generic quote templates.

LEFT: Japanese art-book / woodblock-inspired graphic restraint. Midnight indigo handmade washi paper, deeply tactile but subtle fine grain, warm ivory elegant high-contrast literary serif typography large and asymmetrically placed. Softly worn abstract ivory moon clipped by the lower edge; one very fine ivory vertical rule. The type is deliberate and readable. No Japanese characters.

CENTER: contemporary Seoul experimental editorial poster. Acid yellow and cobalt blue, confident modular grotesque typography, adventurous line breaks and sizing, compact annotation rail, graphic square and circle cuts, subtle ink overprint registration. Integrate the word attention with an assertive scale jump but preserve the quote word-for-word. No Hangul or pseudo-Asian glyphs. Contemporary graphic design, not decorative national symbols.

RIGHT: Korean hanji literary poster. Warm mulberry-paper fibres, soft plum text and an imperfect ivory moon-jar shape as generous negative space. Large sensitive book serif, ample margins, a quiet offset edge and slight papery grain. Abstract porcelain silhouette without a rendered product photograph. The form and typography share space intelligently.

Each poster contains exactly the same quote verbatim: "Pay attention. The ordinary world is full of extraordinary things."
Each poster has small source attribution: "A passage worth keeping".
A tiny discreet three-layer ice-shelf geometric mark only, coloured to suit the poster, at most 2% of poster width. NO Arctic name. No extra titles or commentary. All English text must be correct and clear. Different hierarchies, rhythms, placement, and typographic character across the three. Do not copy a specific existing designer artwork. No sakura, mountains, flags, generic Zen symbols, fake seals, watermarks, gradients pretending to be texture, or UI chrome.
```

### Reusable indigo background

```text
Use case: stylized-concept. Asset type: reusable 9:16 portrait background for a premium literary quote-poster export. Generate flat full-bleed artwork, not a photographed object or mockup. Midnight indigo handmade paper with very fine subtle washi fibres and softly varied woodblock printing grain; deep inky blue around #111D35. Lower right edge only: a softly worn abstract warm ivory partial moon/circular shape, softly imperfect edge and visible handmade paper grain, clipped by both bottom and right edges. Shape occupies bottom 22 percent only, so top 75 percent remains an almost even dark field suitable for readable live ivory quote typography. Restrained high-quality materiality; no dramatic clouds or stars. Texture should reward close viewing and must not distract at phone size. Edge-to-edge texture with no border, frame, inset, gradient vignette, ornament or perspective. No text, no letters, no glyphs, no numbers, no symbols, no logo, no watermarks, no UI. Exactly a single tall 9:16 asset; not a contact sheet.
```

## Hanji production substrate

`hanji-background.png` is the selected 941 × 1672 generated background. Use it in a fixed 9:16 frame. The first version had a conventional jar silhouette, which narrowed beneath the source area. Two targeted image edits broadened the middle and extended the lower sides. The final image was inspected: the passage zone x32–328/y157–389 and source zone x32–328/y484–552 (360 × 640 coordinates) sit on ivory. The short foot now reaches the lower edge. There is no text or logo. Keep typography and the real small Arctic mark native.

### Original Hanji prompt

```text
Use case: stylized-concept. Asset type: reusable tall 9:16 portrait background for a premium literary quote-poster, TEXT FREE. Create a flat, full-bleed graphic paper composition. Background is muted dusty mauve mulberry/hanji paper, around #B3979B, with fine natural fibres and gentle unevenness. A single very large irregular warm ivory moon-jar silhouette (#F1E9D9) forms generous negative space for live plum text. It looks like hand-torn ivory paper set flush within the mauve field, with soft handmade edges, not a photographed or shaded ceramic product. Shape inspired by the imperfect rounded balance of a Korean moon jar. Slight asymmetry makes it tactile and human.

Critical layout expressed on a 360 x 640 coordinate grid, scale proportionally to output: jar silhouette occupies approximately x20..345 and y70..607. Its rounded broad shoulder/body must expand nearly edge to edge early, so the entire central text rectangle x32..328, y157..389 is uniform PALE IVORY. A lower source-attribution rectangle x32..328, y484..552 also must remain fully PALE IVORY. Keep the side walls broad down through y558; curve inward only beneath that to a subtle narrow low foot. A short understated irregular mouth at y70 to y100, no handles. The top and bottom margins show mauve paper. Fine subtle ivory paper fibres across the jar, but no high-contrast stains or creases in text regions.

No letters, text, numbers, pseudo-glyphs, symbols, logos, mark, watermarks or UI. No border, picture frame, lighting glare, drop shadow, photographic pottery, flowers or additional objects. Elegant restrained materiality, softly torn shape edge, high-quality book-cover paper aesthetic. Single 9:16 portrait asset.
```

### Broad-shoulder correction

```text
Edit this reusable 9:16 TEXT FREE paper background. Preserve the exact muted mauve and ivory colours, fine hanji fibres, softly torn edges, no text or logos. Change ONLY the proportions of the ivory moon-jar silhouette: it needs a very large much more RECTANGULAR, broad-shouldered middle and lower body for a real app text template. At native 360×640 coordinates, top mouth y70..95. Transition quickly out to x15..345 by y145. From y145 all the way down to y565, its side edges must stay outside x25 and x335, with only tiny handmade wavering. These side walls are nearly vertical, so ALL of the region x32..328, y157..552 is entirely ivory paper. Curve in to the low foot only in y570..610. Keep a jar-like little mouth at top and short foot at bottom, but its broad body is much wider near the top AND bottom than the input. Absolutely no narrow lower tapered belly through the attribution region; it must have very broad low haunches until y565. No added ornament, text, symbols or shadow. A sophisticated hand-cut paper silhouette with broad slightly irregular walls, like an oversized moon jar abstracted for a rectangular book cover. Top and bottom margins remain mauve.
```

### Lower-body correction (selected output)

```text
Keep this exact flat mauve/ivory hanji paper composition, colour, texture and top mouth/shoulders. Modify only the LOWER BODY: extend the broad ivory rectangular middle straight down nearly to the very bottom. The bottom inward curve must begin at 93% of the image height, with a tiny short foot at 97-99%. There should be almost no mauve below the foot. Specifically on this 941 x 1672 image, ivory side walls stay at x20 and x920 until y1515, with broad ivory filling the entire rectangle x84..858,y1264..1445. The current narrowing at y1270 is far too early and must be replaced with fully ivory paper, continuing the same fine fibres. Keep everything else the same including the upper shoulders, and no text, logos, symbols or shadows.
```
