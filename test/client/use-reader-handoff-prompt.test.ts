import {
  captureReaderHandoffSessionStart,
  getLatestRemoteReadingCheckpoint,
  getLatestUnreadRemoteReadingCheckpoint,
  useReaderHandoffPrompt,
} from "@/components/Reader/hooks/use-reader-handoff-prompt";
import {
  readerCheckpointKeys,
  type ReaderCheckpointsData,
} from "@/components/Reader/data/reader-cache/hooks";
import type { SyncedReadingCheckpoint } from "@/lib/db";
import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientType,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

const BOOK_ID = "book-1";
const CURRENT_DEVICE_ID = "device-current";
const SESSION_STARTED_AT = 1_800_000_000_000;

function makeCheckpoint(
  overrides: Partial<SyncedReadingCheckpoint> = {},
): SyncedReadingCheckpoint {
  const bookId = overrides.bookId ?? BOOK_ID;
  const deviceId = overrides.deviceId ?? CURRENT_DEVICE_ID;
  const hlc = overrides._hlc ?? "1000-0-device-current";

  return {
    id: `resume:${deviceId}:${bookId}`,
    bookId,
    deviceId,
    currentSpineIndex: 1,
    scrollProgress: 25,
    lastRead: 1000,
    _hlc: hlc,
    _deviceId: deviceId,
    _isDeleted: 0,
    _serverTimestamp: 1000,
    ...overrides,
  };
}

function createQueryClient(): QueryClientType {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function createWrapper(queryClient: QueryClientType) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function setCheckpoints(
  queryClient: QueryClientType,
  checkpoints: SyncedReadingCheckpoint[],
): void {
  queryClient.setQueryData<ReaderCheckpointsData>(
    readerCheckpointKeys.book(BOOK_ID),
    { checkpoints },
  );
}

afterEach(() => {
  cleanup();
});

describe("reader handoff checkpoint helpers", () => {
  it("selects the newest remote checkpoint by HLC", () => {
    const olderRemote = makeCheckpoint({
      deviceId: "device-remote-a",
      _hlc: "1000-0-device-remote-a",
    });
    const newerRemote = makeCheckpoint({
      deviceId: "device-remote-b",
      _hlc: "1001-0-device-remote-b",
    });

    expect(
      getLatestRemoteReadingCheckpoint(
        [
          makeCheckpoint({ _hlc: "1002-0-device-current" }),
          olderRemote,
          newerRemote,
        ],
        CURRENT_DEVICE_ID,
      ),
    ).toBe(newerRemote);
  });

  it("ignores remote checkpoints that are not newer than the session-start current device checkpoint", () => {
    const currentCheckpoint = makeCheckpoint({
      _hlc: "1002-0-device-current",
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      _hlc: "1001-0-device-remote",
    });
    const sessionStart = captureReaderHandoffSessionStart({
      bookId: BOOK_ID,
      checkpoints: [currentCheckpoint, remoteCheckpoint],
      currentDeviceId: CURRENT_DEVICE_ID,
      startedAt: SESSION_STARTED_AT,
    });

    expect(
      getLatestUnreadRemoteReadingCheckpoint(
        [currentCheckpoint, remoteCheckpoint],
        sessionStart,
      ),
    ).toBeNull();
  });

  it("returns the latest remote checkpoint when it is newer than the session-start current device checkpoint", () => {
    const currentCheckpoint = makeCheckpoint({
      _hlc: "1000-0-device-current",
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      _hlc: "1001-0-device-remote",
    });
    const sessionStart = captureReaderHandoffSessionStart({
      bookId: BOOK_ID,
      checkpoints: [currentCheckpoint, remoteCheckpoint],
      currentDeviceId: CURRENT_DEVICE_ID,
      startedAt: SESSION_STARTED_AT,
    });

    expect(
      getLatestUnreadRemoteReadingCheckpoint(
        [currentCheckpoint, remoteCheckpoint],
        sessionStart,
      ),
    ).toBe(remoteCheckpoint);
  });
});

describe("useReaderHandoffPrompt", () => {
  it("shows an initial remote checkpoint that is newer than the session-start current device checkpoint", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({
      _hlc: "1000-0-device-current",
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      currentSpineIndex: 4,
      scrollProgress: 75,
      _hlc: "1001-0-device-remote",
    });
    setCheckpoints(queryClient, [currentCheckpoint, remoteCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(result.current.promptState.checkpoint).toBe(remoteCheckpoint);

    queryClient.clear();
  });

  it("keeps a dismissed prompt hidden until a strictly newer remote checkpoint arrives", async () => {
    const queryClient = createQueryClient();
    const currentCheckpoint = makeCheckpoint({
      _hlc: "1000-0-device-current",
    });
    const remoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      _hlc: "1001-0-device-remote",
    });
    setCheckpoints(queryClient, [currentCheckpoint, remoteCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });

    act(() => {
      result.current.dismissPrompt();
    });
    expect(result.current.promptState.show).toBe(false);

    act(() => {
      setCheckpoints(queryClient, [
        currentCheckpoint,
        {
          ...remoteCheckpoint,
          lastRead: remoteCheckpoint.lastRead + 1,
        },
      ]);
    });
    expect(result.current.promptState.show).toBe(false);

    const newerRemoteCheckpoint = makeCheckpoint({
      deviceId: "device-remote",
      currentSpineIndex: 5,
      _hlc: "1002-0-device-remote",
    });
    act(() => {
      setCheckpoints(queryClient, [currentCheckpoint, newerRemoteCheckpoint]);
    });

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(result.current.promptState.checkpoint).toEqual(
      newerRemoteCheckpoint,
    );

    queryClient.clear();
  });

  it("does not move the session-start baseline when the current device checkpoint updates", async () => {
    const queryClient = createQueryClient();
    const sessionStartCheckpoint = makeCheckpoint({
      _hlc: "1000-0-device-current",
    });
    setCheckpoints(queryClient, [sessionStartCheckpoint]);

    const { result } = renderHook(
      () =>
        useReaderHandoffPrompt({
          bookId: BOOK_ID,
          currentDeviceId: CURRENT_DEVICE_ID,
          sessionStartedAt: SESSION_STARTED_AT,
        }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(false);
    });

    const laterCurrentCheckpoint = makeCheckpoint({
      _hlc: "1003-0-device-current",
    });
    const remoteAfterSessionStart = makeCheckpoint({
      deviceId: "device-remote",
      _hlc: "1002-0-device-remote",
    });
    act(() => {
      setCheckpoints(queryClient, [
        laterCurrentCheckpoint,
        remoteAfterSessionStart,
      ]);
    });

    await waitFor(() => {
      expect(result.current.promptState.show).toBe(true);
    });
    expect(result.current.promptState.checkpoint).toEqual(
      remoteAfterSessionStart,
    );

    queryClient.clear();
  });
});
