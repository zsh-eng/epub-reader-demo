export interface PlaybackStep {
  label: string;
  run(): Promise<void>;
  pauseAfter?: boolean;
}
export interface PlaybackPlan {
  name: string;
  prepare(): Promise<void>;
  steps: PlaybackStep[];
  complete?(): void;
}
export interface PlaybackView {
  name: string;
  phase:
    | "idle"
    | "preparing"
    | "paused"
    | "running"
    | "pausing"
    | "stopping"
    | "complete"
    | "failed";
  steps: string[];
  completed: number;
  current: string;
  error: string;
}

/** Runs settled steps. Pause and Stop never pretend to cancel a committed request. */
export class LabPlayback {
  private plan?: PlaybackPlan;
  private view: PlaybackView = {
    name: "",
    phase: "idle",
    steps: [],
    completed: 0,
    current: "",
    error: "",
  };
  private listeners = new Set<() => void>();
  private active = false;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(delayMs = 600) {
    this.delayMs = delayMs;
  }
  private readonly delayMs: number;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.view;
  private update(change: Partial<PlaybackView>) {
    if (this.disposed) return;
    this.view = { ...this.view, ...change };
    this.listeners.forEach((listener) => listener());
  }
  async load(plan: PlaybackPlan, play = false) {
    if (this.active || this.view.phase === "running")
      throw new Error("Pause playback before loading a sequence.");
    clearTimeout(this.timer);
    this.plan = plan;
    this.active = true;
    this.update({
      name: plan.name,
      phase: "preparing",
      steps: plan.steps.map((step) => step.label),
      completed: 0,
      current: "Preparing clients",
      error: "",
    });
    try {
      await plan.prepare();
      if (this.disposed) return;
      if (this.getSnapshot().phase === "stopping") {
        this.clear();
        return;
      }
      this.update({ phase: "paused", current: plan.steps[0]?.label ?? "" });
    } catch (error) {
      this.update({
        phase: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.active = false;
    }
    if (play && this.view.phase === "paused") this.play();
  }
  play() {
    if (this.active || !this.plan || this.view.phase !== "paused") return;
    this.update({ phase: "running" });
    void this.advance(false);
  }
  step() {
    if (this.active || !this.plan || this.view.phase !== "paused") return;
    this.update({ phase: "running" });
    void this.advance(true);
  }
  pause() {
    if (this.view.phase !== "running") return;
    clearTimeout(this.timer);
    this.update({ phase: this.active ? "pausing" : "paused" });
  }
  stop() {
    clearTimeout(this.timer);
    if (this.active) this.update({ phase: "stopping" });
    else this.clear();
  }
  restart() {
    if (this.active || !this.plan || this.view.phase === "running")
      return Promise.resolve();
    return this.load(this.plan);
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }
  private clear() {
    this.plan = undefined;
    this.update({
      phase: "idle",
      current: "",
      error: "",
      steps: [],
      completed: 0,
      name: "",
    });
  }
  private async advance(single: boolean) {
    if (
      this.disposed ||
      !this.plan ||
      this.active ||
      this.view.phase !== "running"
    )
      return;
    const plan = this.plan;
    const step = plan.steps[this.view.completed];
    if (!step) {
      this.finish();
      return;
    }
    this.active = true;
    this.update({ current: step.label });
    try {
      await step.run();
      if (this.disposed) return;
      if (this.getSnapshot().phase === "stopping") {
        this.clear();
        return;
      }
      const completed = this.view.completed + 1;
      this.update({ completed });
      if (completed === plan.steps.length) {
        this.finish();
        return;
      }
      const paused =
        single || step.pauseAfter || this.getSnapshot().phase === "pausing";
      this.update({
        phase: paused ? "paused" : "running",
        current: plan.steps[completed]!.label,
      });
      if (!paused)
        this.timer = setTimeout(() => void this.advance(false), this.delayMs);
    } catch (error) {
      if (this.getSnapshot().phase === "stopping") this.clear();
      else
        this.update({
          phase: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
    } finally {
      this.active = false;
    }
  }
  private finish() {
    this.plan?.complete?.();
    this.update({ phase: "complete", current: "Complete" });
  }
}
