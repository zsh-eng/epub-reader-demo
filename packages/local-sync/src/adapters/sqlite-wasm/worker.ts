import sqlite3InitModule, {
  type Database,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import type { SqlRow } from "../sqlite/index.js";
import type {
  SqliteWasmAllResult,
  SqliteWasmOpenResult,
  SqliteWasmRunResult,
  SqliteWasmWorkerRequest,
  SqliteWasmWorkerResponse,
} from "./protocol.js";

const workerScope = self as DedicatedWorkerGlobalScope;

let database: Database | undefined;
let sqliteInitialization: Promise<Sqlite3Static> | undefined;

workerScope.onmessage = (event: MessageEvent<SqliteWasmWorkerRequest>) => {
  void respond(event.data);
};

async function respond(request: SqliteWasmWorkerRequest): Promise<void> {
  try {
    const result = await handleRequest(request);
    postResponse({ id: request.id, ok: true, result });
  } catch (error) {
    const cause = error instanceof Error ? error : new Error(String(error));
    postResponse({
      id: request.id,
      ok: false,
      error: {
        name: cause.name,
        message: cause.message,
        stack: cause.stack ?? "",
      },
    });
  }
}

async function handleRequest(
  request: SqliteWasmWorkerRequest,
): Promise<unknown> {
  switch (request.type) {
    case "open": {
      if (database !== undefined) {
        throw new Error("SQLite database is already open");
      }

      const sqlite = await initializeSqlite();
      if (request.storage === "opfs") {
        if (typeof sqlite.oo1.OpfsDb !== "function") {
          throw new Error(
            "SQLite OPFS is unavailable; durable storage requires a cross-origin-isolated worker",
          );
        }
        database = new sqlite.oo1.OpfsDb(request.filename, "c");
      } else {
        database = new sqlite.oo1.DB(":memory:", "c");
      }

      return {
        filename: database.filename,
        storage: request.storage,
      } satisfies SqliteWasmOpenResult;
    }
    case "run": {
      const openDatabase = getOpenDatabase();
      if (request.parameters.length === 0) {
        openDatabase.exec({ sql: request.sql });
      } else {
        openDatabase.exec({
          sql: request.sql,
          bind: request.parameters,
        });
      }

      return {
        rowsAffected: Number(openDatabase.changes()),
      } satisfies SqliteWasmRunResult;
    }
    case "all": {
      const openDatabase = getOpenDatabase();
      const rows =
        request.parameters.length === 0
          ? openDatabase.exec({
              sql: request.sql,
              rowMode: "object",
              returnValue: "resultRows",
            })
          : openDatabase.exec({
              sql: request.sql,
              bind: request.parameters,
              rowMode: "object",
              returnValue: "resultRows",
            });

      return {
        rows: rows as unknown as readonly SqlRow[],
      } satisfies SqliteWasmAllResult;
    }
    case "close": {
      getOpenDatabase().close();
      database = undefined;
      return undefined;
    }
  }
}

function initializeSqlite(): Promise<Sqlite3Static> {
  sqliteInitialization ??= sqlite3InitModule();
  return sqliteInitialization;
}

function getOpenDatabase(): Database {
  if (database === undefined) {
    throw new Error("SQLite database is not open");
  }
  return database;
}

function postResponse(response: SqliteWasmWorkerResponse): void {
  workerScope.postMessage(response);
}
