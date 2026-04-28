import type { SyncedReadingCheckpoint } from "@/lib/db";
import { compareHLC } from "@/lib/sync/hlc/hlc";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useReaderCheckpointsQuery } from "../data/reader-cache/hooks";

export interface ReaderHandoffSessionStart {
  bookId: string;
  currentDeviceId: string;
  currentDeviceCheckpoint: SyncedReadingCheckpoint | null;
  startedAt: number;
}

export interface ReaderHandoffPromptState {
  show: boolean;
  checkpoint: SyncedReadingCheckpoint | null;
}

export interface UseReaderHandoffPromptOptions {
  bookId?: string;
  currentDeviceId?: string;
  /**
   * Stable session start timestamp. Passing this from the caller keeps the
   * handoff baseline tied to reader-open time instead of hook render timing.
   */
  sessionStartedAt?: number;
}

export interface UseReaderHandoffPromptResult {
  promptState: ReaderHandoffPromptState;
  dismissPrompt: () => void;
}

function useStableSessionStartedAt(explicitStartedAt: number | undefined) {
  const startedAtRef = useRef<number | null>(null);

  if (explicitStartedAt !== undefined) {
    return explicitStartedAt;
  }

  if (startedAtRef.current === null) {
    startedAtRef.current = Date.now();
  }

  return startedAtRef.current;
}

function isCheckpointForRemoteDevice(
  checkpoint: SyncedReadingCheckpoint,
  currentDeviceId: string,
): boolean {
  return checkpoint.deviceId !== currentDeviceId;
}

function compareCheckpointsByHlc(
  a: SyncedReadingCheckpoint,
  b: SyncedReadingCheckpoint,
): number {
  return compareHLC(a._hlc, b._hlc);
}

export function getLatestRemoteReadingCheckpoint(
  checkpoints: SyncedReadingCheckpoint[],
  currentDeviceId: string,
): SyncedReadingCheckpoint | null {
  let latestCheckpoint: SyncedReadingCheckpoint | null = null;

  for (const checkpoint of checkpoints) {
    if (!isCheckpointForRemoteDevice(checkpoint, currentDeviceId)) {
      continue;
    }

    if (
      latestCheckpoint === null ||
      compareCheckpointsByHlc(checkpoint, latestCheckpoint) > 0
    ) {
      latestCheckpoint = checkpoint;
    }
  }

  return latestCheckpoint;
}

export function captureReaderHandoffSessionStart(options: {
  bookId: string;
  checkpoints: SyncedReadingCheckpoint[];
  currentDeviceId: string;
  startedAt: number;
}): ReaderHandoffSessionStart {
  const currentDeviceCheckpoint =
    options.checkpoints.find(
      (checkpoint) => checkpoint.deviceId === options.currentDeviceId,
    ) ?? null;

  return {
    bookId: options.bookId,
    currentDeviceId: options.currentDeviceId,
    currentDeviceCheckpoint,
    startedAt: options.startedAt,
  };
}

export function getLatestUnreadRemoteReadingCheckpoint(
  checkpoints: SyncedReadingCheckpoint[],
  sessionStart: ReaderHandoffSessionStart,
): SyncedReadingCheckpoint | null {
  const latestRemoteCheckpoint = getLatestRemoteReadingCheckpoint(
    checkpoints,
    sessionStart.currentDeviceId,
  );
  if (latestRemoteCheckpoint === null) return null;

  if (
    sessionStart.currentDeviceCheckpoint !== null &&
    compareCheckpointsByHlc(
      latestRemoteCheckpoint,
      sessionStart.currentDeviceCheckpoint,
    ) <= 0
  ) {
    return null;
  }

  return latestRemoteCheckpoint;
}

function shouldShowPrompt(
  checkpoint: SyncedReadingCheckpoint | null,
  dismissedCheckpointHlc: string | null,
): boolean {
  if (checkpoint === null) return false;
  if (dismissedCheckpointHlc === null) return true;

  return compareHLC(checkpoint._hlc, dismissedCheckpointHlc) > 0;
}

/**
 * Derives the reader handoff prompt from the book's per-device checkpoints.
 *
 * React Query remains the source of truth for loading and invalidation. This
 * hook only captures the current device's checkpoint at session start, then
 * derives whether a newer remote checkpoint should prompt the reader.
 */
export function useReaderHandoffPrompt({
  bookId,
  currentDeviceId,
  sessionStartedAt: explicitSessionStartedAt,
}: UseReaderHandoffPromptOptions): UseReaderHandoffPromptResult {
  const sessionStartedAt = useStableSessionStartedAt(explicitSessionStartedAt);
  const checkpointsQuery = useReaderCheckpointsQuery(bookId);
  const checkpoints = checkpointsQuery.data?.checkpoints ?? [];
  const [sessionStart, setSessionStart] =
    useState<ReaderHandoffSessionStart | null>(null);
  const [dismissedCheckpointHlc, setDismissedCheckpointHlc] = useState<
    string | null
  >(null);

  useEffect(() => {
    setSessionStart(null);
    setDismissedCheckpointHlc(null);
  }, [bookId, currentDeviceId, sessionStartedAt]);

  useEffect(() => {
    if (
      sessionStart !== null ||
      !bookId ||
      !currentDeviceId ||
      !checkpointsQuery.isSuccess
    ) {
      return;
    }

    setSessionStart(
      captureReaderHandoffSessionStart({
        bookId,
        checkpoints,
        currentDeviceId,
        startedAt: sessionStartedAt,
      }),
    );
  }, [
    bookId,
    checkpoints,
    checkpointsQuery.isSuccess,
    currentDeviceId,
    sessionStart,
    sessionStartedAt,
  ]);

  const latestUnreadCheckpoint = useMemo(() => {
    if (sessionStart === null) return null;

    return getLatestUnreadRemoteReadingCheckpoint(checkpoints, sessionStart);
  }, [checkpoints, sessionStart]);

  const promptState = useMemo<ReaderHandoffPromptState>(
    () => ({
      show: shouldShowPrompt(latestUnreadCheckpoint, dismissedCheckpointHlc),
      checkpoint: latestUnreadCheckpoint,
    }),
    [dismissedCheckpointHlc, latestUnreadCheckpoint],
  );

  const dismissPrompt = useCallback(() => {
    if (latestUnreadCheckpoint === null) return;

    setDismissedCheckpointHlc(latestUnreadCheckpoint._hlc);
  }, [latestUnreadCheckpoint]);

  return {
    promptState,
    dismissPrompt,
  };
}
