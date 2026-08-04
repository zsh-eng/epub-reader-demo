import type {
  SqlDriver,
  SqlExecutor,
  SqlParameters,
  SqlRow,
  SqlRunResult,
} from "../sqlite/index.js";
import type {
  SqliteWasmAllResult,
  SqliteWasmOpenResult,
  SqliteWasmRunResult,
  SqliteWasmStorage,
  SqliteWasmWorkerRequestPayload,
  SqliteWasmWorkerResponse,
} from "./protocol.js";

export type { SqliteWasmStorage } from "./protocol.js";

export interface SqliteWasmDriverOptions {
  readonly filename?: string;
  readonly storage?: SqliteWasmStorage;
  readonly workerFactory?: () => Worker;
}

export interface SqliteWasmDriver extends SqlDriver {
  readonly filename: string;
  readonly storage: SqliteWasmStorage;
  close(): Promise<void>;
}

/** Opens a dedicated-worker SQLite database backed by OPFS by default. */
export async function createSqliteWasmDriver(
  options: SqliteWasmDriverOptions = {},
): Promise<SqliteWasmDriver> {
  const storage = options.storage ?? "opfs";
  const filename =
    storage === "memory"
      ? ":memory:"
      : (options.filename ?? "/local-sync.sqlite3");
  const worker = options.workerFactory?.() ?? createDefaultWorker();
  const rpc = new SqliteWasmRpc(worker);

  try {
    const opened = await rpc.request<SqliteWasmOpenResult>({
      type: "open",
      filename,
      storage,
    });
    return new WorkerSqliteWasmDriver(rpc, opened);
  } catch (error) {
    rpc.terminate();
    throw error;
  }
}

class WorkerSqliteWasmDriver implements SqliteWasmDriver {
  readonly filename: string;
  readonly storage: SqliteWasmStorage;

  // Reserving this queue for the whole callback keeps other worker messages
  // from entering an active transaction between awaited operations.
  private operationTail: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | undefined;

  constructor(
    private readonly rpc: SqliteWasmRpc,
    opened: SqliteWasmOpenResult,
  ) {
    this.filename = opened.filename;
    this.storage = opened.storage;
  }

  run(sql: string, parameters: SqlParameters): Promise<SqlRunResult> {
    return this.enqueue(() => this.runDirect(sql, parameters));
  }

  all<TRow = SqlRow>(
    sql: string,
    parameters: SqlParameters,
  ): Promise<readonly TRow[]> {
    return this.enqueue(() => this.allDirect<TRow>(sql, parameters));
  }

  transaction<TResult>(
    work: (transaction: SqlExecutor) => Promise<TResult>,
  ): Promise<TResult> {
    return this.enqueue(async () => {
      await this.runDirect("begin immediate", []);

      const transaction: SqlExecutor = {
        run: (sql, parameters) => this.runDirect(sql, parameters),
        all: <TRow = SqlRow>(sql: string, parameters: SqlParameters) =>
          this.allDirect<TRow>(sql, parameters),
      };

      try {
        const result = await work(transaction);
        await this.runDirect("commit", []);
        return result;
      } catch (error) {
        await this.runDirect("rollback", []);
        throw error;
      }
    });
  }

  close(): Promise<void> {
    this.closePromise ??= this.enqueue(async () => {
      try {
        await this.rpc.request({ type: "close" });
      } finally {
        this.rpc.terminate();
      }
    });
    return this.closePromise;
  }

  private async runDirect(
    sql: string,
    parameters: SqlParameters,
  ): Promise<SqlRunResult> {
    return this.rpc.request<SqliteWasmRunResult>({
      type: "run",
      sql,
      parameters,
    });
  }

  private async allDirect<TRow = SqlRow>(
    sql: string,
    parameters: SqlParameters,
  ): Promise<readonly TRow[]> {
    const result = await this.rpc.request<SqliteWasmAllResult>({
      type: "all",
      sql,
      parameters,
    });
    return result.rows as readonly TRow[];
  }

  private enqueue<TResult>(
    operation: () => Promise<TResult>,
  ): Promise<TResult> {
    const result = this.operationTail.then(operation);
    this.operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/**
 * Minimal request-response bridge over Worker.postMessage(). Request IDs map
 * each worker response back to the Promise returned to its caller.
 */
class SqliteWasmRpc {
  private readonly pending = new Map<
    number,
    {
      readonly resolve: (result: unknown) => void;
      readonly reject: (error: Error) => void;
    }
  >();
  private nextRequestId = 1;
  private terminated = false;

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", this.handleMessage);
    worker.addEventListener("error", this.handleWorkerError);
  }

  request<TResult = void>(
    payload: SqliteWasmWorkerRequestPayload,
  ): Promise<TResult> {
    if (this.terminated) {
      return Promise.reject(new Error("SQLite worker has been terminated"));
    }

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return new Promise<TResult>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (result) => resolve(result as TResult),
        reject,
      });
      this.worker.postMessage({ ...payload, id });
    });
  }

  terminate(): void {
    if (this.terminated) {
      return;
    }

    this.terminated = true;
    this.worker.terminate();
    this.rejectPending(new Error("SQLite worker was terminated"));
  }

  private readonly handleMessage = (
    event: MessageEvent<SqliteWasmWorkerResponse>,
  ): void => {
    const response = event.data;
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      return;
    }

    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.result);
      return;
    }

    const error = new Error(response.error.message);
    error.name = response.error.name;
    error.stack = response.error.stack;
    pending.reject(error);
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    const error =
      event.error instanceof Error ? event.error : new Error(event.message);
    this.terminated = true;
    this.worker.terminate();
    this.rejectPending(error);
  };

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function createDefaultWorker(): Worker {
  return new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
    name: "local-sync-sqlite-wasm",
  });
}
