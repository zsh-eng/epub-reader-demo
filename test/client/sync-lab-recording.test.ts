import { describe, expect, it, vi } from "vitest";
import {
  LabRecorder,
  type LabAction,
  type LabActionObserver,
} from "@/features/sync-lab/core/recording";
import type { LabSnapshot } from "@/features/sync-lab/core/controller";
import type { ClientCommand } from "@/features/sync-lab/types";
import { createSyncClientState } from "@/lib/sync-v2/client-state";
import { SYNC_CLIENT_STATE_STORAGE_KEY } from "@/lib/sync-v2/protocol";

function fixture() {
  const baseline: LabSnapshot = {
    version: 1,
    name: "Start",
    capturedAt: 1,
    elapsedMs: 0,
    server: { records: [], files: [], nextSequence: 1 },
    clients: [
      {
        id: "lab-a",
        name: "A",
        preset: "empty",
        storage: {
          [SYNC_CLIENT_STATE_STORAGE_KEY]: JSON.stringify(
            createSyncClientState("lab-a"),
          ),
        },
        database: {},
        clockOffset: 0,
        network: {
          online: true,
          latencyMs: 0,
          failNext: false,
          loseNextResponse: false,
        },
      },
    ],
  };
  let ready = true;
  let online = true;
  const listeners = new Set<() => void>();
  const executed: LabAction[] = [];
  const publish = () => listeners.forEach((listener) => listener());
  const controller = {
    onAction: undefined as LabActionObserver | undefined,
    getSnapshot: () => ({
      mode: "inspector",
      clients: [{ id: "lab-a", endpoint: ready ? {} : undefined, busy: false }],
    }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async checkpoint() {
      ready = false;
      publish();
      return structuredClone(baseline);
    },
    async restore() {
      ready = false;
      online = true;
      executed.length = 0;
      queueMicrotask(() => {
        ready = true;
        publish();
      });
    },
    async command(id: string, command: ClientCommand) {
      const action: LabAction = { type: "command", id, command };
      executed.push(action);
      const error = !online ? "Client is offline" : undefined;
      controller.onAction?.(action, error);
      if (error) throw new Error(error);
    },
    setOnline(id: string, next: boolean) {
      online = next;
      const action: LabAction = { type: "online", id, online: next };
      executed.push(action);
      controller.onAction?.(action);
    },
    configure(
      id: string,
      options: {
        latencyMs?: number;
        clockOffset?: number;
        failure?: "request" | "response";
      },
    ) {
      const action: LabAction = { type: "configure", id, options };
      executed.push(action);
      controller.onAction?.(action);
    },
    setAutoSync(id: string, enabled: boolean) {
      const action: LabAction = { type: "auto", id, enabled };
      executed.push(action);
      controller.onAction?.(action);
    },
    advanceClock(ms: number) {
      const action: LabAction = { type: "clock", ms };
      executed.push(action);
      controller.onAction?.(action);
    },
  };
  return {
    controller,
    executed,
    baseline,
    ready() {
      ready = true;
      publish();
    },
    listeners,
  };
}
async function start(
  context: ReturnType<typeof fixture>,
  recorder: LabRecorder,
) {
  const pending = recorder.start("Offline then reconnect");
  context.ready();
  await pending;
}

describe("Sync Lab recorded inspector sequences", () => {
  it("waits for restarted clients and captures/replays expected errors in order", async () => {
    const context = fixture();
    const recorder = new LabRecorder(context.controller);
    await start(context, recorder);
    context.controller.setOnline("lab-a", false);
    await expect(
      context.controller.command("lab-a", { type: "sync" }),
    ).rejects.toThrow("offline");
    context.controller.setOnline("lab-a", true);
    context.controller.advanceClock(1000);
    await context.controller.command("lab-a", { type: "sync" });
    const recording = recorder.stop();
    expect(recording.steps).toHaveLength(5);
    expect(recording.steps[1]?.expectedError).toBe("Client is offline");
    await recorder.replay(recording);
    expect(context.executed).toEqual(
      recording.steps.map((step) => step.action),
    );
    expect(recorder.isRecording).toBe(false);
    expect(context.listeners.size).toBe(0);
    recorder.dispose();
  });
  it("reports the exact step when replay produces a different outcome", async () => {
    const context = fixture();
    const recorder = new LabRecorder(context.controller);
    await start(context, recorder);
    await context.controller.command("lab-a", { type: "sync" });
    const recording = recorder.stop();
    recording.steps[0]!.expectedError = "Client is offline";
    await expect(recorder.replay(recording)).rejects.toThrow(
      "Replay step 1 (command) differed",
    );
    recorder.dispose();
  });
  it("rejects out of baseline clients before restoring and limits recording length", async () => {
    const context = fixture();
    const recorder = new LabRecorder(context.controller);
    await start(context, recorder);
    for (let i = 0; i < 201; i++) context.controller.advanceClock(1);
    expect(() => recorder.stop()).toThrow("exceeded 200 steps");
    const restore = vi.spyOn(context.controller, "restore");
    await expect(
      recorder.replay({
        version: 1,
        name: "bad",
        baseline: context.baseline,
        steps: [{ action: { type: "online", id: "lab-other", online: true } }],
      }),
    ).rejects.toThrow("outside its baseline");
    expect(restore).not.toHaveBeenCalled();
    recorder.dispose();
  });
  it("times out observable readiness and removes its listener", async () => {
    vi.useFakeTimers();
    try {
      const context = fixture();
      const recorder = new LabRecorder(context.controller, {
        readyTimeoutMs: 100,
      });
      const pending = expect(recorder.start()).rejects.toThrow(
        "did not become ready",
      );
      await vi.advanceTimersByTimeAsync(100);
      await pending;
      expect(context.listeners.size).toBe(0);
      recorder.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
  it("cancels a pending start on disposal and restores the previous hook", async () => {
    const context = fixture();
    const previous = vi.fn();
    context.controller.onAction = previous;
    const recorder = new LabRecorder(context.controller);
    const pending = expect(recorder.start()).rejects.toThrow("disposed");
    recorder.dispose();
    await pending;
    expect(context.controller.onAction).toBe(previous);
    expect(context.listeners.size).toBe(0);
  });
});
