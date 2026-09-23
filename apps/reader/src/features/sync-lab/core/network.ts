import type { FileRemoteApi } from "@/lib/files/file-remote-api";
import type { SyncV2Remote } from "@/lib/sync-v2/sync";

export interface ClientNetworkState {
  online: boolean;
  latencyMs: number;
  failNext: boolean;
  loseNextResponse: boolean;
}
export interface ClientNetworkEvent {
  operation: string;
  phase: "request" | "result" | "error";
  detail: string;
}

/** Controls one client's sync and file requests without changing browser connectivity. */
export class ClientNetwork {
  private state: ClientNetworkState;
  private readonly onEvent: (event: ClientNetworkEvent) => void;

  constructor(
    options: {
      online?: boolean;
      latencyMs?: number;
      onEvent?: (event: ClientNetworkEvent) => void;
    } = {},
  ) {
    this.state = {
      online: options.online ?? true,
      latencyMs: options.latencyMs ?? 0,
      failNext: false,
      loseNextResponse: false,
    };
    this.onEvent = options.onEvent ?? (() => {});
  }

  configure(
    options: Partial<Pick<ClientNetworkState, "online" | "latencyMs">>,
  ): void {
    if (
      options.latencyMs !== undefined &&
      (!Number.isFinite(options.latencyMs) || options.latencyMs < 0)
    )
      throw new Error("Latency must be a non-negative finite number");
    Object.assign(this.state, options);
  }
  failNext(): void {
    this.state.failNext = true;
  }
  loseNextResponse(): void {
    this.state.loseNextResponse = true;
  }
  snapshot(): ClientNetworkState {
    return { ...this.state };
  }
  restore(state: ClientNetworkState): void {
    this.configure(state);
    this.state = { ...state };
  }

  syncRemote(remote: SyncV2Remote): SyncV2Remote {
    return {
      pull: (deviceId, request) =>
        this.run("pull", false, () => remote.pull(deviceId, request)),
      push: (deviceId, changes) =>
        this.run("push", true, () => remote.push(deviceId, changes)),
    };
  }
  fileRemote(remote: FileRemoteApi): FileRemoteApi {
    return {
      put: (id, blob, mediaType) =>
        this.run("file-put", true, () => remote.put(id, blob, mediaType)),
      get: (id) => this.run("file-get", false, () => remote.get(id)),
      list: () => this.run("file-list", false, () => remote.list()),
      delete: (id) => this.run("file-delete", true, () => remote.delete(id)),
    };
  }

  private async run<T>(
    operation: string,
    mutation: boolean,
    request: () => Promise<T>,
  ): Promise<T> {
    this.onEvent({ operation, phase: "request", detail: "Request started" });
    try {
      if (!this.state.online) throw new Error("Client is offline");
      if (this.state.failNext) {
        this.state.failNext = false;
        throw new Error("Simulated request failure before delivery");
      }
      const loseResponse = mutation && this.state.loseNextResponse;
      if (loseResponse) this.state.loseNextResponse = false;
      if (this.state.latencyMs > 0)
        await new Promise<void>((resolve) =>
          setTimeout(resolve, this.state.latencyMs),
        );
      if (!this.state.online)
        throw new Error("Client went offline before delivery");
      const result = await request();
      if (loseResponse) throw new Error("Response lost after server commit");
      if (!this.state.online)
        throw new Error("Client went offline before receiving response");
      this.onEvent({ operation, phase: "result", detail: "Response received" });
      return result;
    } catch (error) {
      this.onEvent({
        operation,
        phase: "error",
        detail: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
