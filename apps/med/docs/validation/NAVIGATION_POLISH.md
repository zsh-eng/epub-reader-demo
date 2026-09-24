# File navigation and palette validation

Validated on 20 September 2026 in Chromium on macOS.

- 70 browser tests passed across all eight suites. Checks include focus after opening from Changes and the picker, saved-query selection and replacement, in-file symbol preview, cancellation and scroll restoration, stale source results, and blank-line cursor width.
- TypeScript, Oxlint, formatting, and the production build passed.
- The production screenshot uses this repository and the installed Universal Ctags parser. The browser reported no page errors; one main file viewer and no separate symbol-preview viewer were mounted.

![In-file symbol search](symbol-navigation.png)

Cursor movement uses a 65 ms ease-out transition. This is the configured animation duration, not a measured response time. Scroll and initial placement do not animate. Reduced-motion settings disable the transition. Palettes remain instantaneous.

File symbols use the displayed snapshot and keep the current viewer. Escape restores the original cursor, preferred column, selected lines, scroll position, and prior search highlight. Enter keeps the preview position without reading the file again. Project symbols retain their separate preview. Saved symbol queries are scoped by source, mode, and file; file and content queries retain their existing source scope.
