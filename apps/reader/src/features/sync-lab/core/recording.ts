import { waitForLabClients } from "./client-readiness";
import type { PlaybackPlan } from "./playback";
import type { ClientCommand } from "../types";
import type { LabSnapshot, SyncLabController } from "./controller";
import { validateLabSnapshot } from "./snapshot-file";

export type LabAction =
  | { type: "command"; id: string; command: ClientCommand }
  | { type: "online"; id: string; online: boolean }
  | {
      type: "configure";
      id: string;
      options: {
        latencyMs?: number;
        clockOffset?: number;
        failure?: "request" | "response";
      };
    }
  | { type: "auto"; id: string; enabled: boolean }
  | { type: "clock"; ms: number };
export interface LabRecording {
  version: 1;
  name: string;
  baseline: LabSnapshot;
  steps: { action: LabAction; expectedError?: string }[];
}
export type LabActionObserver = (action: LabAction, error?: string) => void;

type RecordingController = Pick<
  SyncLabController,
  | "checkpoint"
  | "restore"
  | "subscribe"
  | "command"
  | "setOnline"
  | "configure"
  | "setAutoSync"
  | "advanceClock"
> & {
  onAction?: LabActionObserver;
  getSnapshot(): {
    mode: string;
    clients: { id: string; endpoint?: unknown; busy: boolean }[];
  };
};
const MAX_STEPS = 200;

/**
 * Records settled inspector actions and their outcomes. Replay uses fresh client
 * processes and reports a mismatch when an action behaves differently. It does
 * not record Reader gestures, elapsed real time, or concurrent request ordering.
 */
export class LabRecorder {
  private baseline: LabSnapshot | undefined;
  private steps: LabRecording["steps"] = [];
  private name = "Inspector sequence";
  private recording = false;
  private running = false;
  private overflow = false;
  private disposed = false;
  private readonly abort = new AbortController();
  private readonly previousObserver: LabActionObserver | undefined;
  private readonly observer: LabActionObserver;
  private readonly readyTimeoutMs: number;
  private readonly controller: RecordingController;

  constructor(
    controller: RecordingController,
    options: { readyTimeoutMs?: number } = {},
  ) {
    this.controller = controller;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 15_000;
    this.previousObserver = controller.onAction;
    this.observer = (action, error) => {
      this.previousObserver?.(action, error);
      if (!this.recording || this.running) return;
      if (this.steps.length >= MAX_STEPS) {
        this.overflow = true;
        return;
      }
      this.steps.push({
        action: structuredClone(action),
        ...(error ? { expectedError: error } : {}),
      });
    };
    controller.onAction = this.observer;
  }
  get isRecording(): boolean {
    return this.recording;
  }
  get stepCount(): number {
    return this.steps.length;
  }

  async start(name = "Inspector sequence"): Promise<void> {
    this.requireIdle();
    if (this.controller.getSnapshot().mode !== "inspector")
      throw new Error("Record sequences in Inspector mode");
    this.running = true;
    try {
      this.baseline = await this.controller.checkpoint("Recording start");
      await this.waitForClients(
        this.baseline.clients.map((client) => client.id),
      );
      this.name = name;
      this.steps = [];
      this.overflow = false;
      this.recording = true;
    } finally {
      this.running = false;
    }
  }

  stop(): LabRecording {
    if (!this.recording || !this.baseline)
      throw new Error("No recording is active");
    if (this.controller.getSnapshot().clients.some((client) => client.busy))
      throw new Error(
        "Wait for pending client actions before stopping the recording",
      );
    this.recording = false;
    if (this.overflow)
      throw new Error("Recording exceeded 200 steps; start a shorter sequence");
    return {
      version: 1,
      name: this.name,
      baseline: this.baseline,
      steps: structuredClone(this.steps),
    };
  }

  createPlayback(recording: LabRecording): PlaybackPlan {
    this.requireIdle();
    if (recording.version !== 1 || recording.steps.length > MAX_STEPS)
      throw new Error("Invalid recording version or step count");
    validateLabSnapshot(recording.baseline);
    const ids = new Set(recording.baseline.clients.map((client) => client.id));
    for (const { action } of recording.steps) {
      if (action.type !== "clock" && !ids.has(action.id))
        throw new Error("Recording references a client outside its baseline");
    }
    const clientNames = new Map(
      recording.baseline.clients.map((client) => [client.id, client.name]),
    );
    return {
      name: recording.name,
      prepare: async () => {
        await this.controller.restore(recording.baseline);
        await this.waitForClients([...ids]);
      },
      steps: recording.steps.map((step, index) => ({
        label:
          step.action.type === "clock"
            ? "Advance sync clock"
            : `${clientNames.get(step.action.id) ?? step.action.id} · ${step.action.type === "command" ? step.action.command.type : step.action.type}`,
        run: async () => {
          if (this.disposed) throw new Error("Recorder was disposed");
          let error: string | undefined;
          try {
            await this.execute(step.action);
          } catch (failure) {
            error =
              failure instanceof Error ? failure.message : String(failure);
          }
          if (error !== step.expectedError)
            throw new Error(
              `Replay step ${index + 1} (${step.action.type}) differed: expected ${step.expectedError ? `error “${step.expectedError}”` : "success"}; received ${error ? `error “${error}”` : "success"}`,
            );
        },
      })),
    };
  }

  async replay(recording: LabRecording): Promise<void> {
    const plan = this.createPlayback(recording);
    this.running = true;
    try {
      await plan.prepare();
      for (const step of plan.steps) await step.run();
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.recording = false;
    this.abort.abort();
    if (this.controller.onAction === this.observer)
      this.controller.onAction = this.previousObserver;
  }

  private requireIdle(): void {
    if (this.disposed) throw new Error("Recorder was disposed");
    if (this.running || this.recording)
      throw new Error("Finish the current recording or replay first");
  }
  private async execute(action: LabAction): Promise<void> {
    switch (action.type) {
      case "command":
        await this.controller.command(action.id, action.command);
        return;
      case "online":
        this.controller.setOnline(action.id, action.online);
        return;
      case "configure":
        this.controller.configure(action.id, action.options);
        return;
      case "auto":
        this.controller.setAutoSync(action.id, action.enabled);
        return;
      case "clock":
        this.controller.advanceClock(action.ms);
        return;
    }
  }
  private waitForClients(ids: string[]): Promise<void> {
    return waitForLabClients(
      this.controller,
      ids,
      this.abort.signal,
      this.readyTimeoutMs,
    );
  }
}
