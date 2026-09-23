import {
  extractImageDimensionsFromBlob,
  extractImageDimensionsFromBytes,
} from "@/lib/image-dimensions";
import { describe, expect, it } from "vitest";

function uint8(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("extractImageDimensionsFromBytes", () => {
  it("reads PNG dimensions from IHDR", () => {
    const bytes = uint8(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      0x00,
      0x00,
      0x02,
      0x80,
      0x00,
      0x00,
      0x01,
      0xe0,
    );

    expect(extractImageDimensionsFromBytes(bytes)).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("reads JPEG dimensions from SOF segment", () => {
    const bytes = uint8(
      0xff,
      0xd8,
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x00,
      0x2a,
      0x00,
      0x10,
      0x03,
      0x01,
      0x11,
      0x00,
      0x02,
      0x11,
      0x00,
      0x03,
      0x11,
      0x00,
      0xff,
      0xd9,
    );

    expect(extractImageDimensionsFromBytes(bytes)).toEqual({
      width: 16,
      height: 42,
    });
  });

  it("reads GIF logical screen dimensions", () => {
    const bytes = uint8(
      0x47,
      0x49,
      0x46,
      0x38,
      0x39,
      0x61,
      0x20,
      0x03,
      0x58,
      0x02,
    );

    expect(extractImageDimensionsFromBytes(bytes)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("reads WEBP VP8X dimensions", () => {
    const bytes = uint8(
      0x52,
      0x49,
      0x46,
      0x46,
      0x16,
      0x00,
      0x00,
      0x00,
      0x57,
      0x45,
      0x42,
      0x50,
      0x56,
      0x50,
      0x38,
      0x58,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0xff,
      0x02,
      0x00,
      0x57,
      0x02,
      0x00,
    );

    expect(extractImageDimensionsFromBytes(bytes)).toEqual({
      width: 768,
      height: 600,
    });
  });

  it("reads SVG dimensions from viewBox when width and height are relative", () => {
    const svg = `<svg width="100%" height="auto" viewBox="0 0 1200 900" xmlns="http://www.w3.org/2000/svg"></svg>`;
    const bytes = new TextEncoder().encode(svg);

    expect(extractImageDimensionsFromBytes(bytes, "image/svg+xml")).toEqual({
      width: 1200,
      height: 900,
    });
  });

  it("returns null for unsupported binary data", () => {
    const bytes = uint8(0x01, 0x02, 0x03, 0x04, 0x05);
    expect(extractImageDimensionsFromBytes(bytes)).toBeNull();
  });
});

describe("extractImageDimensionsFromBlob", () => {
  it("extracts dimensions from a blob", async () => {
    const bytes = uint8(
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      0x00,
      0x00,
      0x00,
      0x40,
      0x00,
      0x00,
      0x00,
      0x20,
    );
    const blob = new Blob([bytes], { type: "image/png" });

    await expect(extractImageDimensionsFromBlob(blob)).resolves.toEqual({
      width: 64,
      height: 32,
    });
  });
});
