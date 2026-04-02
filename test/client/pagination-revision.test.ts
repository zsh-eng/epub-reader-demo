import type { PaginationEvent } from "@/lib/pagination/engine-types";
import { shouldAcceptPaginationEvent } from "@/lib/pagination/pagination-revision";
import { describe, expect, it } from "vitest";

function buildErrorEvent(
  message: string,
  revision?: number,
): PaginationEvent {
  return {
    type: "error",
    message,
    revision,
  };
}

describe("Pagination event revision gating", () => {
  it("drops stale events with older revisions", () => {
    const event = buildErrorEvent("stale", 1);
    expect(shouldAcceptPaginationEvent(event, 2)).toBe(false);
  });

  it("accepts events matching the latest posted revision", () => {
    const event = buildErrorEvent("current", 3);
    expect(shouldAcceptPaginationEvent(event, 3)).toBe(true);
  });

  it("accepts legacy events that do not include revision metadata", () => {
    const event = buildErrorEvent("legacy");
    expect(shouldAcceptPaginationEvent(event, 5)).toBe(true);
  });
});
