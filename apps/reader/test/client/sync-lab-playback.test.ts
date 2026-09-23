import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LabPlayback,
  type PlaybackPlan,
} from "@/features/sync-lab/core/playback";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => vi.useRealTimers());

describe("scenario playback boundaries", () => {
  it("finishes an active request before pausing and resumes from a manual edit", async () => {
    const request = deferred();
    let value = "initial";
    const observed: string[] = [];
    const player = new LabPlayback(1);
    await player.load({
      name: "test",
      prepare: async () => {},
      steps: [
        { label: "request", run: () => request.promise },
        {
          label: "inspect",
          run: async () => {
            observed.push(value);
          },
        },
      ],
    });
    player.play();
    player.pause();
    expect(player.getSnapshot().phase).toBe("pausing");
    request.resolve();
    await vi.waitFor(() => expect(player.getSnapshot().phase).toBe("paused"));
    expect(player.getSnapshot().completed).toBe(1);
    expect(observed).toEqual([]);
    value = "manual edit";
    player.play();
    await vi.waitFor(() => expect(player.getSnapshot().phase).toBe("complete"));
    expect(observed).toEqual(["manual edit"]);
    player.dispose();
  });
  it("steps once, restores the prepared baseline, and pauses between timed steps", async () => {
    vi.useFakeTimers();
    let value = 0;
    const prepare = vi.fn(async () => {
      value = 0;
    });
    const player = new LabPlayback(600);
    const plan: PlaybackPlan = {
      name: "counter",
      prepare,
      steps: [1, 2, 3].map((index) => ({
        label: String(index),
        run: async () => {
          value++;
        },
      })),
    };
    await player.load(plan);
    player.step();
    await vi.advanceTimersByTimeAsync(0);
    expect(value).toBe(1);
    expect(player.getSnapshot().phase).toBe("paused");
    player.play();
    await vi.advanceTimersByTimeAsync(0);
    player.pause();
    await vi.advanceTimersByTimeAsync(1000);
    expect(value).toBe(2);
    await player.restart();
    expect(value).toBe(0);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(player.getSnapshot().completed).toBe(0);
    player.dispose();
  });
  it("stops after the active write without starting the next step", async () => {
    const request = deferred();
    const next = vi.fn(async () => {});
    const player = new LabPlayback(1);
    await player.load({
      name: "stop",
      prepare: async () => {},
      steps: [
        { label: "write", run: () => request.promise },
        { label: "next", run: next },
      ],
    });
    player.play();
    player.stop();
    expect(player.getSnapshot().phase).toBe("stopping");
    request.resolve();
    await vi.waitFor(() => expect(player.getSnapshot().phase).toBe("idle"));
    expect(next).not.toHaveBeenCalled();
    player.dispose();
  });
  it("keeps a failed step visible and does not continue", async () => {
    const next = vi.fn(async () => {});
    const player = new LabPlayback(1);
    await player.load(
      {
        name: "error",
        prepare: async () => {},
        steps: [
          {
            label: "verify",
            run: async () => {
              throw new Error("State changed");
            },
          },
          { label: "next", run: next },
        ],
      },
      true,
    );
    await vi.waitFor(() => expect(player.getSnapshot().phase).toBe("failed"));
    expect(player.getSnapshot()).toMatchObject({
      completed: 0,
      current: "verify",
      error: "State changed",
    });
    expect(next).not.toHaveBeenCalled();
    player.dispose();
  });
  it("pauses at an explicit inspection point", async () => {
    const next = vi.fn(async () => {});
    const player = new LabPlayback(1);
    await player.load(
      {
        name: "inspect",
        prepare: async () => {},
        steps: [
          { label: "lost response", run: async () => {}, pauseAfter: true },
          { label: "retry", run: next },
        ],
      },
      true,
    );
    await vi.waitFor(() => expect(player.getSnapshot().phase).toBe("paused"));
    expect(player.getSnapshot().completed).toBe(1);
    expect(next).not.toHaveBeenCalled();
    player.dispose();
  });
});
