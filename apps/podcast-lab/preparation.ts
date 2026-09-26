import { mkdir, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import type { FeedEpisode, Show } from "./web/library";

export type Preparation = {
  id: string;
  phase: string;
  detail: string;
  ownerPID: number;
};
export type Runner = (root: string) => Promise<void>;
const terminal = new Set(["ready", "failed"]);

/** One local worker at a time. Only catalog IDs can enter the queue; URLs and
 * model credentials never come from a browser request. Disk checkpoints survive
 * reloads and failed stages. The Python worker also holds a cross-process lock. */
export class Preparations {
  private starts = new Map<string, Promise<Preparation | null>>();
  private pending = new Map<string, Promise<void>>();
  private tail = Promise.resolve();
  constructor(
    readonly dataDir: string,
    private runner: Runner = runWorker,
  ) {}
  folder(id: string) {
    return join(this.dataDir, "prepared", id);
  }

  async status(id: string): Promise<Preparation> {
    const file = Bun.file(join(this.folder(id), "status.json"));
    if (!(await file.exists()))
      return { id, phase: "idle", detail: "", ownerPID: 0 };
    const state: Preparation = await file.json();
    const published = Bun.file(join(this.folder(id), "analysis-state.json"));
    if (await published.exists()) Object.assign(state, await published.json());
    if (!terminal.has(state.phase)) {
      try {
        if (state.ownerPID <= 0) throw new Error("No worker");
        process.kill(state.ownerPID, 0);
      } catch {
        return {
          ...state,
          phase: "failed",
          detail: "Preparation was interrupted. Retry to continue.",
        };
      }
    }
    return state;
  }
  async ready() {
    const ids = await readdir(join(this.dataDir, "prepared")).catch(
      () => [] as string[],
    );
    const states = await Promise.all(
      ids
        .filter((id) => /^[a-f0-9]{20}$/.test(id))
        .map((id) => this.status(id)),
    );
    return states.filter((s) => s.phase === "ready").map((s) => s.id);
  }
  start(id: string): Promise<Preparation | null> {
    const existing = this.starts.get(id);
    if (existing) return existing;
    const work = this.enqueue(id).finally(() => this.starts.delete(id));
    this.starts.set(id, work);
    return work;
  }
  private async enqueue(id: string): Promise<Preparation | null> {
    if (!/^[a-f0-9]{20}$/.test(id)) return null;
    if (this.pending.has(id)) return this.status(id);
    const state = await this.status(id);
    if (state.phase !== "idle" && state.phase !== "failed") return state;
    const library: { episodes: FeedEpisode[]; shows: Show[] } = await Bun.file(
      join(this.dataDir, "library.json"),
    ).json();
    const episode = library.episodes.find((e) => e.id === id);
    const show = library.shows.find((s) => s.id === episode?.showId);
    if (!episode || !show || episode.preparedId) return null;
    const root = this.folder(id);
    await mkdir(root, { recursive: true });
    // Preserve the exact original source on retry, even if the RSS feed changed.
    if (!(await Bun.file(join(root, "source.json")).exists())) {
      await Bun.write(
        join(root, "source.json"),
        JSON.stringify({
          ...episode,
          show: show.title,
          showCreator: show.creator,
          showDescription: show.description,
          feed: show.feed,
        }),
      );
    }
    const queued = {
      id,
      phase: "queued",
      detail: "Waiting for local preparation",
      ownerPID: process.pid,
    };
    await this.write(root, queued);
    // Reserve synchronously before any worker starts. Each request joins a single
    // chain, so repeated selections never allocate another speech model.
    const work = this.tail
      .then(async () => {
        try {
          await this.runner(root);
        } catch {
          const latest = await this.status(id);
          if (!terminal.has(latest.phase))
            await this.write(root, {
              id,
              phase: "failed",
              detail:
                "Preparation stopped. Retry to continue from the last completed stage.",
              ownerPID: 0,
            });
        }
      })
      .finally(() => this.pending.delete(id));
    this.pending.set(id, work);
    this.tail = work;
    return queued;
  }
  private async write(root: string, state: Preparation) {
    await Bun.write(join(root, "status.json.tmp"), JSON.stringify(state));
    await rename(join(root, "status.json.tmp"), join(root, "status.json"));
  }
}

async function runWorker(root: string) {
  const log = Bun.file(join(root, "worker.log"));
  const worker = Bun.spawn(
    [
      join(import.meta.dir, ".venv/bin/python"),
      join(import.meta.dir, "pipeline/prepare_episode.py"),
      root,
    ],
    { cwd: import.meta.dir, stdout: log, stderr: log },
  );
  const code = await worker.exited;
  if (code !== 0) throw new Error("Preparation worker failed");
}
