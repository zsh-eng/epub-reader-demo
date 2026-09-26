# European poster studies

Generated 2026-09-26 with the built-in image generator. These are **original concept posters**, not reproductions and not templates with baked-in user text.

## Outputs and inspection

- [Four poster studies](poster-concepts.png): 941 × 1672 PNG. Clockwise from top left: Swiss Overprint, Warsaw Theatre, Italian Biblioteca, Dutch Field.
- [Reusable ivory paper](ivory-paper-grain.png): 1254 × 1254 PNG, quiet uncoated-paper fibres and minute ink-like flecks. No text, motif, border or vignette.
- Inspected both outputs at full size. The contact sheet contains the requested quote in each design. The collage uses an eye/wing rather than an unrelated decoration. Italian, Swiss and Dutch have distinct hierarchy and alignment. Minor simulated paper shadows separate the studies; those belong to the concept sheet only.
- Production must render the real quote and attribution as live text. Use the paper image as a material layer, not the poster sheet as a background. The generated snowflake-like mark is only a concept; replace it with the actual tiny Arctic mark.
- The paper is visually even. Seamless tiling was requested but has **not** been edge-tested; use one scaled image across each export, not a repeating tile.

## Reference principles

1. [Museum für Gestaltung Zürich — Josef Müller-Brockmann teaching](https://museum-gestaltung.ch/de/artikel/die-lehrtaetigkeit-von-josef-mueller-brockmann). Primary museum reference for teaching formal composition. Borrow strict spatial relationships and deliberate scale contrast; do not copy an existing poster.
2. [MoMA — Recent Czech and Polish posters, 1968](https://www.moma.org/docs/press_archives/4064/releases/MOMA_1968_Jan-June_0081_58.pdf). Primary exhibition record for expressive cultural posters. Our interpretation uses one rough, metaphorical image and a restricted ink palette, not national symbols.
3. [Design Museum — Wim Crouwel](https://designmuseum.org/designers/wim-crouwel). The museum describes a systematic grid and experimental modular typography. Borrow the controlled framework that lets one element break scale dramatically. Dutch Field is a new design, not a Crouwel imitation.

Italian Biblioteca is our book-cover design direction, not a claim that Italian publishing has one universal style. These four directions describe specific graphic strategies. They do not attempt to summarize national aesthetics.

## Reusable recipes

Measurements below use a 360 × 640 point export canvas. Long quotations must paginate rather than shrink into unreadable text. Reserve at least 32 points at each edge for source and quote text. Let a motif bleed to trim only when it is not text.

| Template | Hierarchy and type | Material and palette | Layout and motif |
| --- | --- | --- | --- |
| Swiss Overprint | Opening phrase 64–80 pt narrow heavy sans; body 27–31 pt sans; source 9–10 pt medium | Ivory #F4EDDA, ink #161714, vermilion #D83B28, cobalt #1E4DAD. Paper base plus subtle dry-ink grain | Left aligned. Main opening in upper third. Quote occupies middle. Two 110–135 pt offset discs below/right, multiplied where they overlap. One vertical rule and one footer rule. Mark 12 pt. |
| Warsaw Theatre | Tall condensed serif quote 32–42 pt; italic source 11 pt | Cream #EAE0C8, near-black #1D201A, oxblood #8C302B. Rough fibres, irregular print edge | Text above a single eye/wing torn-paper metaphor. Motif at lower third. Small red ellipse balances upper right. No decorative frame. Never place collage behind body text. |
| Dutch Field | Giant quote mark 140–180 pt; dense condensed sans 32–44 pt; mono source 9 pt | Acid chartreuse #D3E12B, ink #181B12, cobalt #1651BF. Dry letterpress/riso mottling | Unequal two-column grid. Oversized punctuation owns left/top; quote aligns to a narrow column then expands. One vertical cobalt strip at right. Tiny source and fine baseline rule. |
| Italian Biblioteca | Centered high-contrast serif opening 48–62 pt, body 28–34 pt; spaced small-caps source 9 pt | Cream #F2E8D0, near-black #181917, cobalt #2255A6, vermilion #C84834. Fine paper grain | Double thin cobalt border, generous top air, centered text. Low red rising half-circle and one cobalt underline. One 12 pt Arctic mark under motif. |

### Production rules

- Keep hierarchy in the template, not in the supplied quotation: split an opening phrase only at sentence boundaries, and preserve every character.
- Use genuine font metrics when fitting. A condensed display face must not change word shapes through arbitrary horizontal scaling.
- The quote stays the highest-contrast content. Paper texture is low amplitude; motifs are outside its text box.
- Do not run noise generation or image decoding every frame. Bundle a resized paper asset and render only when the export changes.
- Screen UI obeys device light/dark settings. Export artwork keeps its chosen poster palette.
- Tiny Arctic mark only. No full wordmark and no simulated foreign-language text.

## Exact image generation prompts

### Contact sheet

```text
Use case: stylized-concept. Create a beautifully art-directed graphic design contact sheet of FOUR DIFFERENT quote posters in a clean 2x2 grid, thin warm gray gutters. Each poster is tall 9:16 portrait. Overall image portrait to allow four tall posters. Flat front view of actual artwork, NOT hanging frames or mockup photography. Must feel like award-winning printed cultural posters, deliberately tactile, extraordinary visual hierarchy, authentic ink registration and subtle paper fibre, generous negative space. Each poster contains the exact full text "Pay attention. The ordinary world is full of extraordinary things." Small attribution "A passage worth keeping". A tiny abstract geometric ice-crystal mark discreetly at bottom, NO Arctic name, NO explanatory style labels or flags.
TOP LEFT: Swiss typographic overprint tradition. Warm uncoated ivory paper, giant narrow black grotesk type arranged asymmetrically flush left, "Pay attention." very large, remaining quote smaller but beautifully spaced. One vermilion circular shape with subtly misregistered cobalt overprint, crisp grid and hairline rules, tiny source details. The ink should have real riso grain.
TOP RIGHT: Polish theatrical poster tradition. Rough cream paper, tall condensed serif text upper half, striking original hand-cut black eye/wing collage as a visual metaphor for attention in the lower third, imperfect torn paper edges, one oxblood red elliptical accent, rough ink. Poetic and surreal but not scary.
BOTTOM LEFT: Dutch experimental editorial tradition. Acid chartreuse paper, black modular typography, enormous typographic quotation mark at left, quote arranged with daring scale contrast and intentional asymmetrical spatial tension; one electric cobalt narrow vertical strip; black tiny aligned source line, energetic but readable, dry letterpress grain.
BOTTOM RIGHT: Italian literary publishing tradition. Warm cream stock, centered refined high contrast book serif, 3 typographic sizes; quote arranged as an elegant literary cover, cobalt small caps source, dramatic abstract vermilion arch/rising circle lower third and ultramarine underline, a delicate double border, quiet ink texture. Truly different from other three.
Constraints: all words correctly spelled, editorial design quality, no AI swirls, no generic digital gradients, no decorative random text, all text safely inside trim. Do not make four variations of one layout.
```

### Paper material

```text
Use case: stylized-concept. Asset type: seamless flat printed-paper texture for a quote poster app with separate live typography. Generate ONE square high-resolution material swatch: warm neutral ivory uncoated paper, extremely fine natural fibres, minute subtle gray/beige riso flecks, tactile matte surface, evenly lit absolutely flat scanned paper. Entire square evenly textured at same scale and same brightness including edges. The fibres must be visible at full resolution but quiet enough to place black body text over them. Color nearly white ivory #F4EDDA. No text, no lettering, no symbols, no object, no border, no folds, no vignette, no shadow, no lighting gradient, no tears, no large stains, no illustration. Think fine premium uncoated book paper under a scanner, not vintage stained parchment. This is a reusable background material, not a poster.
```

## Production Theatre background

[theatre-background.png](theatre-background.png), 941 × 1672, is a generated text-free production background. Inspected after one targeted image edit: the first result allowed the collage to rise too high. The final collage begins at about 88% canvas height (roughly y562 on a640pt export); the quote area and attribution ending y552 remain clear. One wine-red ink disc sits in the far upper right, clear of normal header copy. Avoid any further full-image crop that moves the bottom collage upward. This is a full-canvas background, not a tile.

### First prompt

```text
Use case: stylized-concept. Asset type: production background for an editable literary quote poster, 9:16 portrait, flat artwork not a mockup. Warm neutral ivory parchment with subtle fine natural paper fibres, even lighting. Strong Polish theatrical collage tradition: original black torn-paper eye merging into a small wing, dry ink and imperfect torn edge, evocative attention metaphor, no horror. CRITICAL COMPOSITION: quote and attribution will be placed later by software. Keep the entire top 88% of the canvas almost empty clean parchment. Confine ALL black eye/wing collage to a shallow cropped strip in the bottom 12% of the canvas, touching the bottom edge, from x8% to92% width. Small subdued wine-red rough ink circle at x90%,y8%, radius3%. No other shapes. This exact quiet region is essential: x9%..91%, y20%..87% must be clean paper and fully readable for later black text. The bottom collage must not enter that region. Elegant rough paper texture, printed matte, no shadow, no vignette, no gradient. NO text, NO letters, NO typography, NO quote marks, NO numbers, NO logos, NO border, NO watermarks. Final image must have9:16 aspect ratio.
```

### Targeted edit prompt

```text
Edit this exact poster background. Preserve the parchment texture and red ink circle unchanged. Change ONLY the black eye/wing collage. It is too tall. Vertically compress the entire collage to 55% of its present height, keep its width, and anchor it flush to the bottom edge. It must occupy only the bottom11% of the image. Nothing black may appear above y=89% of the total image height. The large clean region above must remain blank paper. No text or logo. Keep image9:16.
```
