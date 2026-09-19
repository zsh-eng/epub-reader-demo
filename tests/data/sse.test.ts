import { describe, expect, test } from "vitest";
import { readServerEvents, type ServerEvent } from "../../src/web/data/sse";

function stream(text: string, byteAtATime = false) {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (byteAtATime) for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(encoded);
      controller.close();
    },
  });
}

describe("fetch-stream SSE transport", () => {
  test("handles split UTF-8 characters, CRLF frames, comments and multiple data lines", async () => {
    const events: ServerEvent[] = [];
    await readServerEvents(
      stream(
        ": heartbeat\r\nevent: changed\r\nid: 7\r\ndata: café\r\ndata: second line\r\n\r\ndata: next\n\n",
        true,
      ),
      (event) => events.push(event),
    );
    expect(events).toEqual([
      { event: "changed", id: "7", data: "café\nsecond line" },
      { event: "message", id: "7", data: "next" },
    ]);
  });

  test("discards incomplete frames and bounds untrusted event size", async () => {
    const events: ServerEvent[] = [];
    await readServerEvents(stream("data: incomplete\n"), (event) => events.push(event));
    expect(events).toEqual([]);
    await expect(
      readServerEvents(stream(`data: ${"x".repeat(65_537)}`), () => undefined),
    ).rejects.toThrow("event size");
  });
});
