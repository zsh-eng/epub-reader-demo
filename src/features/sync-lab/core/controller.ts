import { acquireLabSession } from "./session-storage";
import type { LabAction } from "./recording";
import Dexie from "dexie";
import { LabStorage } from "./storage";
import { MemorySyncServer, type MemoryServerSnapshot } from "./memory-server";
import { ClientNetwork, type ClientNetworkState } from "./network";
import { writeDatabaseSnapshot, type LabSeed } from "./seed";
import {
  createSyncClientState,
  writeSyncClientState,
} from "@/lib/sync-v2/client-state";
import { encodeSyncKey, encodeSyncValue } from "@/lib/sync-v2/protocol";
import type { LabRuntimeConfig } from "../runtime";
import type {
  ClientCommand,
  ClientInspection,
  ClientPreset,
  DatabaseSnapshot,
  LabClientEndpoint,
  LabEvent,
  LabHost,
  LabMode,
} from "../types";

export interface LabClient {
  id: string;
  name: string;
  databaseName: string;
  preset: ClientPreset;
  storage: LabStorage;
  network: ClientNetwork;
  autoSync: boolean;
  clockOffset: number;
  reconnectAt: number;
  onlineListeners: Set<() => void>;
  autoListeners: Set<() => void>;
  endpoint?: LabClientEndpoint;
  inspection?: ClientInspection;
  revision: number;
  busy: boolean;
  error: string;
}
export interface LabSnapshot {
  version: 1;
  name: string;
  capturedAt: number;
  elapsedMs: number;
  server: MemoryServerSnapshot;
  clients: {
    id: string;
    name: string;
    preset: ClientPreset;
    storage: Record<string, string>;
    network: ClientNetworkState;
    clockOffset: number;
    reconnectAfterMs?: number;
    database: DatabaseSnapshot;
  }[];
}
export interface LabView {
  clients: LabClient[];
  events: LabEvent[];
  mode: LabMode;
  server: MemoryServerSnapshot;
  seedName: string;
  busy: boolean;
  elapsedMs: number;
}

/** Owns one experiment. Frames own app services; this host owns only controls and transport. */
export class SyncLabController implements LabHost {
  onAction?: (action: LabAction, error?: string) => void;
  readonly sessionId = crypto.randomUUID();
  readonly server: MemorySyncServer;
  private readonly lease = acquireLabSession(this.sessionId);
  private clients: LabClient[] = [];
  private events: LabEvent[] = [];
  private mode: LabMode = "inspector";
  private listeners = new Set<() => void>();
  private seed: LabSeed = { name: "", rows: {}, files: [] };
  private view!: LabView;
  private elapsedMs = 0;
  private busy = false;
  private refreshScheduled = false;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private counter = 0;
  private pendingPositions = new Set<string>();
  constructor() {
    this.server = new MemorySyncServer({
      now: () => Date.now() + this.elapsedMs,
      onEvent: (event) =>
        this.log(
          event.deviceId ?? "Server",
          `${event.operation}:${event.phase}`,
          `${event.operation.replace("file-", "File ")} ${event.phase}`,
          event.detail,
        ),
    });
    this.publish();
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private publish() {
    this.view = {
      clients: [...this.clients],
      events: [...this.events],
      mode: this.mode,
      server: this.server.snapshot(),
      seedName: this.seed.name,
      busy: this.busy,
      elapsedMs: this.elapsedMs,
    };
    this.listeners.forEach((listener) => listener());
  }
  log(
    client: string,
    kind: string,
    summary: string,
    detail?: unknown,
    key?: string,
  ) {
    this.events.push({
      id: ++this.counter,
      time: Date.now() + this.elapsedMs,
      client,
      kind,
      summary,
      detail,
      key,
    });
    if (this.events.length > 2000) this.events.shift();
    if (!this.refreshScheduled) {
      this.refreshScheduled = true;
      queueMicrotask(() => {
        this.refreshScheduled = false;
        this.publish();
        void this.refresh();
      });
    }
  }
  private requireClient(id: string) {
    const client = this.clients.find((item) => item.id === id);
    if (!client)
      throw new Error("This client is no longer part of the experiment.");
    return client;
  }
  connect(id: string): LabRuntimeConfig {
    const client = this.requireClient(id);
    return {
      databaseName: client.databaseName,
      deviceId: id,
      storage: client.storage,
      syncRemote: client.network.syncRemote(this.server),
      fileRemote: client.network.fileRemote(this.server.files),
      isOnline: () => client.network.snapshot().online,
      subscribeOnline: (listener) => {
        client.onlineListeners.add(listener);
        return () => {
          client.onlineListeners.delete(listener);
        };
      },
      autoSync: () => client.autoSync,
      subscribeAutoSync: (listener) => {
        client.autoListeners.add(listener);
        return () => {
          client.autoListeners.delete(listener);
        };
      },
      now: () => Date.now() + this.elapsedMs + client.clockOffset,
      onSyncEvent: (event) => this.event(id, event),
    };
  }
  attach(id: string, endpoint: LabClientEndpoint) {
    const client = this.requireClient(id);
    client.endpoint = endpoint;
    this.log(id, "ready", "Client ready");
    if (this.pendingPositions.delete(id)) {
      const record = this.server
        .snapshot()
        .records.find(
          (row) => JSON.parse(row.key)[0] === "books" && !row.isDeleted,
        );
      if (record)
        void this.command(id, {
          type: "checkpoint",
          bookId: JSON.parse(record.value).id,
          progress: 65,
        }).catch(() => {});
    }
  }
  event(id: string, event: { phase: string; outcome: string; key: string }) {
    this.log(
      id,
      event.phase,
      event.outcome.replaceAll("-", " "),
      event,
      event.key,
    );
  }
  async refresh() {
    await Promise.all(
      this.clients.map(async (client) => {
        const endpoint = client.endpoint;
        if (!endpoint) return;
        try {
          const inspection = await endpoint.inspect();
          if (client.endpoint === endpoint) client.inspection = inspection;
        } catch {
          /* A frame being restarted has already closed its connection. */
        }
      }),
    );
    this.publish();
  }
  async setSeed(seed: LabSeed) {
    if (this.clients.length)
      throw new Error(
        "Discard the current clients before changing the source.",
      );
    this.seed = seed;
    this.server.restore({ records: [], files: [], nextSequence: 1 });
    let seq = 0;
    const now = Date.now() + this.elapsedMs;
    this.server.seedRecords(
      Object.entries(seed.rows).flatMap(([table, rows]) =>
        rows.map((row) => ({
          key: encodeSyncKey(table, row.id),
          value: encodeSyncValue(row),
          schemaVersion: 1,
          isDeleted: row.isDeleted,
          deviceId: "lab-baseline",
          hlc: { wallTimeMs: now, counter: seq },
          serverSeq: ++seq,
        })),
      ),
    );
    for (const file of seed.files)
      await this.server.files.put(file.id, file.blob, file.mediaType);
    this.log(
      "Lab",
      "seed",
      `Captured ${seed.rows.books?.length ?? 0} books and ${seed.files.length} files`,
    );
  }
  private makeClient(
    id: string,
    name: string,
    preset: ClientPreset,
  ): LabClient {
    return {
      id,
      name,
      preset,
      databaseName: `sync-lab-${this.sessionId}-${id}`,
      storage: new LabStorage(),
      network: new ClientNetwork({
        onEvent: (event) =>
          this.log(id, event.phase, `${event.operation}: ${event.detail}`),
      }),
      autoSync: false,
      clockOffset: 0,
      reconnectAt: 0,
      onlineListeners: new Set(),
      autoListeners: new Set(),
      revision: 0,
      busy: false,
      error: "",
    };
  }
  async spawn(preset: ClientPreset) {
    await this.lease;
    if (this.clients.length >= 4)
      throw new Error("This lab supports four clients at a time.");
    const id = `lab-${crypto.randomUUID()}`;
    const client = this.makeClient(
      id,
      `Client ${["A", "B", "C", "D"].find((letter) => !this.clients.some((item) => item.name === `Client ${letter}`))!}`,
      preset,
    );
    const state = createSyncClientState(id);
    const snapshot: DatabaseSnapshot = {};
    if (preset !== "empty") {
      const records = this.server.snapshot().records;
      // A new seeded client starts from the current server, including changes
      // made since the experiment began. Its cursor describes exactly these rows.
      for (const record of records) {
        const [table] = JSON.parse(record.key) as [string, string];
        const row = JSON.parse(record.value) as Record<string, unknown>;
        (snapshot[table] ??= []).push({ ...row, isDeleted: record.isDeleted });
      }
      state.bootstrapped = true;
      state.pullCursor = Math.max(0, ...records.map((row) => row.serverSeq));
      state.hlc = records.reduce(
        (latest, record) => {
          if (
            record.hlc.wallTimeMs > latest.wallTimeMs ||
            (record.hlc.wallTimeMs === latest.wallTimeMs &&
              record.hlc.counter > latest.counter)
          )
            return { ...record.hlc };
          return latest;
        },
        { wallTimeMs: Date.now() + this.elapsedMs, counter: 0 },
      );
    }
    if (preset === "downloaded" || preset === "position")
      snapshot.files = this.server
        .snapshot()
        .files.map(({ metadata, blob }) => ({
          id: metadata.id,
          blob,
          mediaType: metadata.mediaType,
          size: metadata.fileSize,
          storedAt: metadata.createdAt,
          remotePresent: true,
        }));
    writeSyncClientState(state, client.storage);
    await writeDatabaseSnapshot(client.databaseName, snapshot);
    this.clients.push(client);
    if (preset === "position") this.pendingPositions.add(id);
    this.log(id, "spawn", `Spawned ${client.name} · ${preset}`);
    return id;
  }
  async command(id: string, command: ClientCommand) {
    const client = this.requireClient(id);
    if (!client.endpoint) throw new Error("Client is still starting.");
    client.busy = true;
    client.error = "";
    this.publish();
    try {
      await client.endpoint.command(command);
      this.log(id, "action", command.type, command);
    } catch (error) {
      client.error = error instanceof Error ? error.message : String(error);
      this.log(id, "error", client.error);
      throw error;
    } finally {
      client.busy = false;
      await this.refresh();
      this.onAction?.(
        { type: "command", id, command },
        client.error || undefined,
      );
    }
  }
  setOnline(id: string, online: boolean) {
    const client = this.requireClient(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    client.reconnectAt = 0;
    client.network.configure({ online });
    client.onlineListeners.forEach((listener) => listener());
    this.log(id, "network", online ? "Connected" : "Offline");
    this.onAction?.({ type: "online", id, online });
  }
  offlineFor(id: string, seconds: number) {
    this.setOnline(id, false);
    this.requireClient(id).reconnectAt = Date.now() + seconds * 1000;
    const timer = setTimeout(() => {
      this.timers.delete(id);
      if (this.clients.some((client) => client.id === id))
        this.setOnline(id, true);
    }, seconds * 1000);
    this.timers.set(id, timer);
  }
  setAutoSync(id: string, enabled: boolean) {
    const client = this.requireClient(id);
    client.autoSync = enabled;
    client.autoListeners.forEach((listener) => listener());
    this.publish();
    this.onAction?.({ type: "auto", id, enabled });
  }
  configure(
    id: string,
    options: {
      latencyMs?: number;
      clockOffset?: number;
      failure?: "request" | "response";
    },
  ) {
    const client = this.requireClient(id);
    if (options.latencyMs !== undefined)
      client.network.configure({ latencyMs: options.latencyMs });
    if (options.clockOffset !== undefined)
      client.clockOffset = options.clockOffset;
    if (options.failure === "request") client.network.failNext();
    if (options.failure === "response") client.network.loseNextResponse();
    this.log(id, "control", "Network / clock controls changed", options);
    this.onAction?.({ type: "configure", id, options });
  }
  advanceClock(ms: number) {
    this.elapsedMs += ms;
    this.log("Lab", "clock", `Advanced sync clocks by ${ms / 1000}s`);
    this.onAction?.({ type: "clock", ms });
  }
  async setMode(mode: LabMode) {
    if (this.mode === mode) return;
    await this.stopFrames();
    this.mode = mode;
    this.clients.forEach((client) => {
      client.revision++;
    });
    this.publish();
  }
  async restart(id: string) {
    const client = this.requireClient(id);
    await client.endpoint?.stop();
    client.endpoint = undefined;
    client.revision++;
    this.log(id, "restart", "Restarted app process; local data retained");
  }
  async remove(id: string) {
    const client = this.requireClient(id);
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    await client.endpoint?.stop();
    this.clients = this.clients.filter((item) => item !== client);
    this.publish();
    await Dexie.delete(client.databaseName);
    this.log(id, "remove", "Discarded client database");
  }
  private async stopFrames() {
    await Promise.all(
      this.clients.map(async (client) => {
        await client.endpoint?.stop();
        client.endpoint = undefined;
      }),
    );
  }
  async checkpoint(name: string): Promise<LabSnapshot> {
    if (
      this.clients.some(
        (client) => !client.endpoint || client.busy || client.autoSync,
      )
    )
      throw new Error(
        "Wait for clients to finish and pause automatic sync before saving.",
      );
    this.busy = true;
    this.publish();
    try {
      // Unmount every app and drain all clients before reading clocks or server state.
      const databases = await Promise.all(
        this.clients.map((client) => client.endpoint!.snapshot()),
      );
      const clients = this.clients.map((client, index) => ({
        id: client.id,
        name: client.name,
        preset: client.preset,
        storage: client.storage.snapshot(),
        network: client.network.snapshot(),
        clockOffset: client.clockOffset,
        reconnectAfterMs: Math.max(0, client.reconnectAt - Date.now()),
        database: databases[index]!,
      }));
      const snapshot: LabSnapshot = {
        version: 1,
        name,
        capturedAt: Date.now(),
        elapsedMs: this.elapsedMs,
        server: this.server.snapshot(),
        clients,
      };
      this.log("Lab", "snapshot", `Saved “${name}”`);
      return structuredClone(snapshot);
    } finally {
      await this.stopFrames();
      this.clients.forEach((client) => {
        client.revision++;
      });
      this.busy = false;
      this.publish();
    }
  }

  async restore(snapshot: LabSnapshot) {
    await this.lease;
    this.busy = true;
    this.publish();
    try {
      await this.clearClients();
      this.elapsedMs = snapshot.elapsedMs;
      this.server.restore(snapshot.server);
      const rows: LabSeed["rows"] = {};
      for (const record of snapshot.server.records) {
        const [table] = JSON.parse(record.key) as [string, string];
        (rows[table] ??= []).push(JSON.parse(record.value));
      }
      this.seed = {
        name: snapshot.name,
        rows,
        files: snapshot.server.files.map(({ metadata, blob }) => ({
          id: metadata.id,
          blob,
          size: metadata.fileSize,
          mediaType: metadata.mediaType,
          storedAt: metadata.createdAt,
          remotePresent: true,
        })),
      };
      for (const saved of snapshot.clients) {
        const client = this.makeClient(saved.id, saved.name, saved.preset);
        client.storage.restore(saved.storage);
        client.network.restore(saved.network);
        client.clockOffset = saved.clockOffset;
        await writeDatabaseSnapshot(client.databaseName, saved.database);
        this.clients.push(client);
        if (saved.reconnectAfterMs)
          this.offlineFor(client.id, saved.reconnectAfterMs / 1000);
      }
      this.log(
        "Lab",
        "restore",
        `Restored “${snapshot.name}”; fresh app processes`,
      );
    } finally {
      this.busy = false;
      this.publish();
    }
  }
  async clearClients() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    for (const client of [...this.clients]) await this.remove(client.id);
  }
  async reset() {
    await this.clearClients();
    await this.setSeed(this.seed);
  }
  clearEvents() {
    this.events = [];
    this.publish();
  }
  async dispose() {
    await this.clearClients();
    await (await this.lease).release();
    this.listeners.clear();
  }
}
