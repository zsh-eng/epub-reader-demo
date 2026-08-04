import type { SqlParameters, SqlRow } from "../sqlite/index.js";

export type SqliteWasmStorage = "memory" | "opfs";

export type SqliteWasmWorkerRequestPayload =
  | {
      readonly type: "open";
      readonly filename: string;
      readonly storage: SqliteWasmStorage;
    }
  | {
      readonly type: "run";
      readonly sql: string;
      readonly parameters: SqlParameters;
    }
  | {
      readonly type: "all";
      readonly sql: string;
      readonly parameters: SqlParameters;
    }
  | { readonly type: "close" };

export type SqliteWasmWorkerRequest = SqliteWasmWorkerRequestPayload & {
  readonly id: number;
};

export interface SqliteWasmOpenResult {
  readonly filename: string;
  readonly storage: SqliteWasmStorage;
}

export interface SqliteWasmRunResult {
  readonly rowsAffected: number;
}

export interface SqliteWasmAllResult {
  readonly rows: readonly SqlRow[];
}

export type SqliteWasmWorkerResponse =
  | {
      readonly id: number;
      readonly ok: true;
      readonly result: unknown;
    }
  | {
      readonly id: number;
      readonly ok: false;
      readonly error: {
        readonly name: string;
        readonly message: string;
        readonly stack: string;
      };
    };
