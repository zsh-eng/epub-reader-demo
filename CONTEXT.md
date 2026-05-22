# Epub Reader

This context describes the language used for the reader experience and its diagnostic tooling.

## Language

**Reader Page Debug Dump**:
A portable diagnostic payload copied from a currently rendered reader page or spread so the same content, layout, typography, and pagination inputs can be reproduced in reader debug tooling.
_Avoid_: Debug snapshot, page snapshot, fixture unless the payload is checked into tests as a stable test input.

## Example Dialogue

Dev: "The current page wraps oddly on mobile. Can you copy a Reader Page Debug Dump?"

Domain expert: "Yes, then load that dump in the reader debug view to reproduce the same page geometry and content."
