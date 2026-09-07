import Dexie from "dexie";

const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SESSION_ID = new RegExp(`^${UUID_PATTERN}$`);
const CLIENT_DATABASE = new RegExp(`^sync-lab-(${UUID_PATTERN})-lab-.+`);

export interface LabSessionLease {
  supported: boolean;
  release(): Promise<void>;
}

export interface LabCleanupResult {
  supported: boolean;
  deletedDatabases: number;
  activeSessions: number;
  failures: { databaseName: string; message: string }[];
}

function lockName(sessionId: string): string {
  if (!SESSION_ID.test(sessionId))
    throw new Error("Invalid Sync Lab session ID.");
  return `sync-lab-session-${sessionId}`;
}

function locks(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks;
}

/**
 * The parent holds this lease until its client databases have been removed.
 * Browser context destruction also releases it, so abandoned databases can be
 * reclaimed without a time-based guess about another tab's activity.
 */
export async function acquireLabSession(
  sessionId: string,
): Promise<LabSessionLease> {
  const name = lockName(sessionId);
  const manager = locks();
  if (!manager) return { supported: false, release: async () => {} };

  return new Promise<LabSessionLease>((resolve, reject) => {
    let release!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const lifetime = manager.request(
      name,
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          reject(
            new Error(
              "This Sync Lab session is already active in another tab.",
            ),
          );
          return;
        }
        resolve({
          supported: true,
          async release() {
            release();
            await lifetime;
          },
        });
        await held;
      },
    );
    void lifetime.catch(reject);
  });
}

/** Delete only recognized client databases while holding their session lease. */
export async function cleanupAbandonedLabDatabases(
  currentSessionId: string,
): Promise<LabCleanupResult> {
  lockName(currentSessionId);
  const manager = locks();
  const result: LabCleanupResult = {
    supported: !!manager,
    deletedDatabases: 0,
    activeSessions: 0,
    failures: [],
  };
  // Without arbitration, an old-looking database may belong to a live tab.
  if (!manager) return result;

  const groups = new Map<string, string[]>();
  for (const databaseName of await Dexie.getDatabaseNames()) {
    const match = CLIENT_DATABASE.exec(databaseName);
    if (!match || match[1] === currentSessionId) continue;
    const sessionId = match[1]!;
    const names = groups.get(sessionId) ?? [];
    names.push(databaseName);
    groups.set(sessionId, names);
  }

  for (const [sessionId, databaseNames] of groups) {
    await manager.request(
      lockName(sessionId),
      { mode: "exclusive", ifAvailable: true },
      async (lock) => {
        if (!lock) {
          result.activeSessions++;
          return;
        }
        for (const databaseName of databaseNames) {
          try {
            await Dexie.delete(databaseName);
            result.deletedDatabases++;
          } catch (error) {
            result.failures.push({
              databaseName,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
    );
  }
  return result;
}
