import { computeFileId } from "@/lib/files/file-id";
import {
  FileRemoteRequestError,
  type FileRemoteApi,
} from "@/lib/files/file-remote-api";
import type { FileId, RemoteFile } from "@/lib/files/types";
import {
  compareSyncVersions,
  DEFAULT_SYNC_PULL_LIMIT,
  MAX_SYNC_FUTURE_CLOCK_SKEW_MS,
  syncDeviceIdSchema,
  syncPullBodySchema,
  syncPushBodySchema,
  syncRecordSchema,
  type SyncPullBody,
  type SyncPullResponse,
  type SyncPushChange,
  type SyncPushResponse,
  type SyncRecord,
} from "@/lib/sync-v2/protocol";
import type { SyncV2Remote } from "@/lib/sync-v2/sync";

export interface MemoryServerEvent {
  operation:
    | "pull"
    | "push"
    | "file-put"
    | "file-get"
    | "file-list"
    | "file-delete";
  phase: "request" | "result" | "error";
  deviceId?: string;
  detail: unknown;
}

/** Records are JSON data; immutable Blob bytes use structured cloning for snapshots. */
export interface MemoryServerSnapshot {
  nextSequence: number;
  records: SyncRecord[];
  files: { metadata: RemoteFile; blob: Blob }[];
}

/** One simulated account. Uses the production protocol and compacted-log semantics. */
export class MemorySyncServer implements SyncV2Remote {
  private records = new Map<string, SyncRecord>();
  private storedFiles = new Map<FileId, { metadata: RemoteFile; blob: Blob }>();
  private nextSequence = 1;
  private readonly now: () => number;
  private readonly onEvent: (event: MemoryServerEvent) => void;

  constructor(
    options: {
      now?: () => number;
      onEvent?: (event: MemoryServerEvent) => void;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.onEvent = options.onEvent ?? (() => {});
  }

  readonly files: FileRemoteApi = {
    put: (id, blob, mediaType) =>
      this.request("file-put", { id, size: blob.size }, async () => {
        if ((await computeFileId(blob)) !== id)
          throw new FileRemoteRequestError(
            "File content does not match ID",
            400,
          );
        const metadata = {
          id,
          fileSize: blob.size,
          mediaType: mediaType || "application/octet-stream",
          createdAt: this.storedFiles.get(id)?.metadata.createdAt ?? this.now(),
        };
        this.storedFiles.set(id, { metadata, blob });
        return { ...metadata };
      }),
    get: (id) =>
      this.request("file-get", { id }, () => {
        const file = this.storedFiles.get(id);
        if (!file) throw new FileRemoteRequestError("File not found", 404);
        return file.blob;
      }),
    list: () =>
      this.request("file-list", {}, () =>
        Array.from(this.storedFiles.values(), ({ metadata }) => ({
          ...metadata,
        })).sort(
          (a, b) =>
            b.createdAt - a.createdAt ||
            (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
        ),
      ),
    delete: (id) =>
      this.request("file-delete", { id }, () => {
        if (!this.storedFiles.delete(id))
          throw new FileRemoteRequestError("File not found", 404);
      }),
  };

  pull(deviceId: string, request: SyncPullBody): Promise<SyncPullResponse> {
    return this.request(
      "pull",
      request,
      () => {
        syncDeviceIdSchema.parse(deviceId);
        const body = syncPullBodySchema.parse(request);
        const currentHead = Math.max(
          0,
          ...Array.from(this.records.values(), (record) => record.serverSeq),
        );
        const head = body.head ?? currentHead;
        if (body.cursor > currentHead || head > currentHead)
          throw new Error("Cursor or head exceeds the current stream");
        const limit = body.limit ?? DEFAULT_SYNC_PULL_LIMIT;
        const candidates = Array.from(this.records.values())
          .filter(
            (record) =>
              record.serverSeq > body.cursor &&
              record.serverSeq <= head &&
              (!body.excludeOwnDevice || record.deviceId !== deviceId),
          )
          .sort((a, b) => a.serverSeq - b.serverSeq);
        const hasMore = candidates.length > limit;
        const records = structuredClone(candidates.slice(0, limit));
        return {
          records,
          head,
          hasMore,
          cursor: hasMore ? records[records.length - 1]!.serverSeq : head,
        };
      },
      deviceId,
    );
  }

  push(
    deviceId: string,
    changes: readonly SyncPushChange[],
  ): Promise<SyncPushResponse> {
    return this.request(
      "push",
      { changes },
      () => {
        syncDeviceIdSchema.parse(deviceId);
        syncPushBodySchema.parse({ changes });
        if (
          changes.some(
            (change) =>
              change.hlc.wallTimeMs >
              this.now() + MAX_SYNC_FUTURE_CLOCK_SKEW_MS,
          )
        )
          throw new Error("HLC wall time is too far in the future");
        return {
          results: changes.map((change) => {
            // SQLite AUTOINCREMENT allocates a sequence even for a rejected conflict.
            const candidate = {
              ...structuredClone(change),
              deviceId,
              serverSeq: this.nextSequence++,
            };
            const previous = this.records.get(change.key);
            if (previous && compareSyncVersions(candidate, previous) <= 0)
              return { accepted: false, winner: structuredClone(previous) };
            this.records.set(change.key, candidate);
            return { accepted: true, winner: structuredClone(candidate) };
          }),
        };
      },
      deviceId,
    );
  }

  seedRecords(records: readonly SyncRecord[]): void {
    for (const record of records) {
      syncRecordSchema.parse(record);
      this.records.set(record.key, structuredClone(record));
      this.nextSequence = Math.max(this.nextSequence, record.serverSeq + 1);
    }
  }

  snapshot(): MemoryServerSnapshot {
    return {
      nextSequence: this.nextSequence,
      records: structuredClone(Array.from(this.records.values())),
      files: Array.from(this.storedFiles.values(), ({ metadata, blob }) => ({
        metadata: { ...metadata },
        blob,
      })),
    };
  }

  restore(snapshot: MemoryServerSnapshot): void {
    this.records.clear();
    this.seedRecords(snapshot.records);
    this.nextSequence = snapshot.nextSequence;
    this.storedFiles = new Map(
      snapshot.files.map(({ metadata, blob }) => [
        metadata.id,
        { metadata: { ...metadata }, blob },
      ]),
    );
  }

  private async request<T>(
    operation: MemoryServerEvent["operation"],
    detail: unknown,
    run: () => T | Promise<T>,
    deviceId?: string,
  ): Promise<T> {
    this.onEvent({ operation, phase: "request", detail, deviceId });
    try {
      const result = await run();
      this.onEvent({ operation, phase: "result", detail: result, deviceId });
      return result;
    } catch (error) {
      this.onEvent({
        operation,
        phase: "error",
        detail: error instanceof Error ? error.message : String(error),
        deviceId,
      });
      throw error;
    }
  }
}
