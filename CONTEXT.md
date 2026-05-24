# Epub Reader

This context describes the language used for the reader experience and its diagnostic tooling.

## Language

**Reader Page Debug Dump**:
A portable diagnostic payload copied from a currently rendered reader page or spread so the same content, layout, typography, and pagination inputs can be reproduced in reader debug tooling.
_Avoid_: Debug snapshot, page snapshot, fixture unless the payload is checked into tests as a stable test input.

**Reader Diagnostic Harness**:
A programmatic debugging surface for the reader that can inspect current reader state, navigate through pages or chapters, collect Reader Page Debug Dumps, and report layout or pagination invariant failures without relying on manual visual inspection.
_Avoid_: Pagination Diagnostics when referring to the broader reader-level harness; use Pagination Diagnostics only for engine-level pagination metrics and traces.

**Reader Diagnostic Profile**:
A named set of reader conditions used by the Reader Diagnostic Harness to make scans reproducible across runs, such as the reading viewport, spread shape, typography, and alignment mode. It is distinct from the user's ordinary reader settings.
_Avoid_: Preset, test settings, browser size.

**Reader Diagnostic Route**:
A reader route intended for programmatic diagnostic runs rather than human reading or manual tweaking. It renders reader content under a Reader Diagnostic Profile and exposes the Reader Diagnostic Harness without ordinary reader chrome.
_Avoid_: Debug reader when referring to the programmatic route; the debug reader is the human-facing diagnostic panel.

**In-Memory Diagnostic EPUB**:
An EPUB file supplied directly to the Reader Diagnostic Harness for a diagnostic run without importing it into the library or creating persistent reader state.
_Avoid_: Diagnostic book when the EPUB has not been added to the library.

**Publisher Book Styling**:
Typography and layout cues supplied by the EPUB itself that remain part of the reading experience alongside the user's reader settings.
_Avoid_: Original typography/layout, book font, book layout when referring to the umbrella concept.

**Publisher Heading Font**:
The EPUB-supplied font family used for heading text when Publisher Book Styling is honored. Non-heading prose may keep publisher spacing, sizing, alignment, and indentation cues while still using the user's selected reading font.
_Avoid_: Book font when referring only to heading font preservation.

## Reader Invariants

Reader text should remain native flowing paragraph text in the DOM. Do not render precomputed pagination lines as explicit per-line block boxes just to force wrapping, because that breaks expected text-selection behaviours such as triple-clicking to select a whole paragraph.

Pagination and diagnostics should instead make the measured layout agree with the native paragraph renderer, or reserve conservative vertical space when browser font metrics create repeatable overflow.

## Example Dialogue

Dev: "The current page wraps oddly on mobile. Can you copy a Reader Page Debug Dump?"

Domain expert: "Yes, then load that dump in the reader debug view to reproduce the same page geometry and content."
