# Publisher marks

Retrieved and visually checked on 26 September 2026. These are the publishers’
actual marks, not recreated letters. All five PNG/JPEG files are bundled in the asset
catalog. The shelf makes no icon requests at startup or while scrolling.

| Asset | Pixels | Stored size | Exact source |
| --- | --- | ---: | --- |
| `PublisherNYTimes` | 144 × 144 | 3,148 B | [The New York Times Apple touch icon](https://www.nytimes.com/vi-assets/static-assets/apple-touch-icon-319373aaf4524d94d38aa599c56b8655.png) |
| `PublisherFT` | 180 × 180 | 4,166 B | [Financial Times official GitHub organization avatar](https://avatars.githubusercontent.com/u/3502508?v=4&s=180) |
| `PublisherEconomist` | 180 × 180 | 3,065 B | [The Economist official GitHub organization avatar](https://avatars.githubusercontent.com/u/33934691?v=4&s=180) |
| `PublisherNewYorker` | 144 × 144 | 6,473 B | [The New Yorker Apple touch icon](https://www.newyorker.com/apple-touch-icon.png) |
| `PublisherAtlantic` | 180 × 180 | 4,846 B | [The Atlantic official GitHub organization avatar](https://avatars.githubusercontent.com/u/565305?v=4&s=180) |

## Provenance

The Times and New Yorker icons come directly from publisher-owned hosts.
The Financial Times and Economist sites reject automated asset requests here,
so their official GitHub organization avatars supply the same square brand
marks. The Atlantic’s official organization supplies a higher-resolution mark
than its 60-pixel favicon. Organization records link to the publishers’ sites:

- [Financial Times organization](https://github.com/Financial-Times), [public organization record](https://api.github.com/orgs/Financial-Times).
- [The Economist organization](https://github.com/TheEconomist), [public organization record](https://api.github.com/orgs/TheEconomist).
- [The Atlantic organization](https://github.com/theatlantic), [public organization record](https://api.github.com/orgs/theatlantic).

These publisher trademarks identify destinations. They do not imply an Arctic
partnership or endorsement. Source image bytes are unchanged.

## Rendering

Use original-color rendering, not template tinting. Fit each square in its
circular shelf mask. Keep a white backing behind transparent marks, especially
The Atlantic’s red A. FT pink and Economist red are pixels in the official
assets; do not replace them with app-theme colors. The New Yorker and Times
assets already include their light backgrounds. Use the same mark in both
interface themes, with the app’s existing outline outside the circle.

Do not enlarge the raster files on disk. The 144-pixel touch icons have about
2.5 pixels per point at the 58-point shelf size; the 180-pixel marks cover 3×.
The five compressed resources total about 21 KB, and an 8-bit RGBA representation is
about 542 KiB. They need no separate network or thumbnail cache.
