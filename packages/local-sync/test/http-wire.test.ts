import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  parseSyncPullQuery,
  parseSyncPullResponse,
  parseSyncPushBody,
  parseSyncPushResponse,
} from "../src/http/index.js";
import type {
  ServerPullRequest,
  ServerPushRequest,
} from "../src/server/index.js";

describe("HTTP sync wire validation", () => {
  it("parses strict JSON push records without accepting namespace fields", () => {
    const body = parseSyncPushBody({
      records: [
        record(),
        record({
          recordId: "book-2",
          operation: "delete",
          payload: {
            id: "book-2",
            nested: { retained: true },
            values: [1, "two", null],
          },
        }),
      ],
    });
    const request = {
      appName: "reader",
      userId: "user-1",
      deviceId: "device-1",
      records: body.records,
    } satisfies ServerPushRequest;

    expect(request.records).toHaveLength(2);
    expect(request.records[1]).toMatchObject({
      operation: "delete",
      payload: { nested: { retained: true } },
    });
    expect(() =>
      parseSyncPushBody({
        appName: "spoofed-app",
        userId: "spoofed-user",
        records: [],
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects non-JSON values, unsafe integers, and oversized push batches", () => {
    expect(() =>
      parseSyncPushBody({
        records: [record({ payload: { id: "book-1", bad: undefined } })],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      parseSyncPushBody({
        records: [
          record({
            hlc: { wallTimeMs: Number.MAX_SAFE_INTEGER + 1, counter: 0 },
          }),
        ],
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      parseSyncPushBody({
        records: Array.from({ length: 501 }, (_, index) =>
          record({ recordId: `book-${index}` }),
        ),
      }),
    ).toThrow(z.ZodError);
  });

  it("parses canonical decimal pull queries into server request values", () => {
    const query = parseSyncPullQuery({
      cursor: "42",
      tableName: "highlights",
      scopeId: "book-1",
      limit: "500",
    });
    const request = {
      appName: "reader",
      userId: "user-1",
      ...query,
    } satisfies ServerPullRequest;

    expect(request).toEqual({
      appName: "reader",
      userId: "user-1",
      cursor: 42,
      tableName: "highlights",
      scopeId: "book-1",
      limit: 500,
    });
    expect(() => parseSyncPullQuery({ cursor: "01" })).toThrow(z.ZodError);
    expect(() => parseSyncPullQuery({ cursor: "0", limit: "5001" })).toThrow(
      z.ZodError,
    );
    expect(() =>
      parseSyncPullQuery({ cursor: "0", scopeId: "book-1" }),
    ).toThrow(z.ZodError);
  });

  it("rejects non-query values and authentication fields in pull queries", () => {
    expect(() => parseSyncPullQuery({ cursor: 0 })).toThrow(z.ZodError);
    expect(() =>
      parseSyncPullQuery({
        cursor: "0",
        userId: "spoofed-user",
      }),
    ).toThrow(z.ZodError);
  });

  it("validates push outcomes as current server winners", () => {
    const response = parseSyncPushResponse({
      outcomes: [
        {
          accepted: false,
          record: sequencedRecord({ serverSeq: 7 }),
        },
      ],
    });

    expect(response).toMatchObject({
      outcomes: [
        {
          accepted: false,
          record: { recordId: "book-1", serverSeq: 7 },
        },
      ],
    });
    expect(() =>
      parseSyncPushResponse({
        outcomes: [
          { accepted: "yes", record: sequencedRecord({ serverSeq: 1 }) },
        ],
      }),
    ).toThrow(z.ZodError);
  });

  it("validates pull response shapes", () => {
    const response = parseSyncPullResponse({
      records: [
        sequencedRecord({ recordId: "book-1", serverSeq: 2 }),
        sequencedRecord({ recordId: "book-2", serverSeq: 7 }),
      ],
      cursor: 7,
      hasMore: true,
    });

    expect(response.records.map(({ serverSeq }) => serverSeq)).toEqual([2, 7]);
    expect(() =>
      parseSyncPullResponse({
        records: [sequencedRecord({ serverSeq: 7 })],
        cursor: "7",
        hasMore: false,
      }),
    ).toThrow(z.ZodError);
    expect(() =>
      parseSyncPullResponse({
        records: [sequencedRecord({ serverSeq: 7 })],
        cursor: 7,
        hasMore: false,
        userId: "spoofed-user",
      }),
    ).toThrow(z.ZodError);
  });
});

interface RecordOptions {
  readonly tableName?: string;
  readonly recordId?: string;
  readonly operation?: "delete" | "put";
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly hlc?: {
    readonly wallTimeMs: number;
    readonly counter: number;
  };
  readonly serverSeq?: number;
}

function record(options: RecordOptions = {}) {
  const recordId = options.recordId ?? "book-1";
  return {
    tableName: options.tableName ?? "books",
    recordId,
    operation: options.operation ?? "put",
    payload: options.payload ?? { id: recordId, title: "Example" },
    hlc: options.hlc ?? { wallTimeMs: 100, counter: 0 },
    deviceId: "device-1",
    schemaVersion: 1,
  };
}

function sequencedRecord(
  options: RecordOptions & { readonly serverSeq: number },
) {
  return { ...record(options), serverSeq: options.serverSeq };
}
