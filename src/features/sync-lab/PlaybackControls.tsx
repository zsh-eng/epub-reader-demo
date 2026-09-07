import {
  Check,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Square,
} from "lucide-react";
import { useState } from "react";
import {
  LabPlayback,
  type PlaybackView,
  type PlaybackPlan,
} from "./core/playback";
import {
  createLabScenario,
  LAB_SCENARIOS,
  type ScenarioKind,
} from "./core/scenarios";
import type { SyncLabController } from "./core/controller";

/** Keep transport visible when inspecting another tab or interacting with a paused client. */
export function PlaybackControls({
  player,
  view,
  locked,
  ready,
  run,
}: {
  player: LabPlayback;
  view: PlaybackView;
  locked: boolean;
  ready: boolean;
  run: (action: () => Promise<unknown>) => void;
}) {
  if (view.phase === "idle") return null;
  const paused = view.phase === "paused";
  const busy = ["preparing", "running", "pausing", "stopping"].includes(
    view.phase,
  );
  return (
    <section className="lab-playback" aria-label="Scenario playback">
      <div className="lab-row lab-wrap">
        <strong>{view.name}</strong>
        <span
          className="lab-pill"
          role="status"
          title="Pause stops between scripted steps. Client timers and background work remain live."
        >
          {view.phase === "pausing"
            ? "Pausing after current step"
            : view.phase === "stopping"
              ? "Stopping after current step"
              : view.phase}
        </span>
        <span className="lab-playback-position">
          {view.completed}/{view.steps.length}
        </span>
        <span className="lab-playback-current">
          {paused ? "Next: " : ""}
          {view.current}
        </span>
        {view.phase === "running" ? (
          <button className="lab-button" onClick={() => player.pause()}>
            <Pause size={13} /> Pause
          </button>
        ) : (
          <button
            className="lab-button"
            disabled={!paused || locked || !ready}
            onClick={() => player.play()}
          >
            <Play size={13} /> Play
          </button>
        )}
        <button
          className="lab-button"
          disabled={!paused || locked || !ready}
          onClick={() => player.step()}
        >
          <SkipForward size={13} /> Step
        </button>
        <button
          className="lab-icon"
          aria-label="Restart playback"
          title="Restore prepared state"
          disabled={busy || locked}
          onClick={() => run(() => player.restart())}
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="lab-icon"
          aria-label="Stop playback"
          title="Stop; keep current data"
          disabled={view.phase === "stopping"}
          onClick={() => player.stop()}
        >
          <Square size={14} />
        </button>
        <details className="lab-playback-steps">
          <summary>Steps</summary>
          <ol>
            {view.steps.map((label, index) => (
              <li
                key={index}
                aria-current={index === view.completed ? "step" : undefined}
              >
                <span>
                  {index < view.completed ? <Check size={12} /> : index + 1}
                </span>
                {label}
              </li>
            ))}
          </ol>
        </details>
      </div>
      {view.error && (
        <p className="lab-error" role="alert">
          {view.error}
        </p>
      )}
    </section>
  );
}

export function ScenarioControls({
  controller,
  bookId,
  disabled,
  load,
}: {
  controller: SyncLabController;
  bookId: string;
  disabled: boolean;
  load: (plan: PlaybackPlan, play: boolean) => void;
}) {
  const [kind, setKind] = useState<ScenarioKind>("offline-edit");
  const scenario = LAB_SCENARIOS.find((item) => item.id === kind)!;
  return (
    <section className="lab-panel">
      <header className="lab-panel-heading">
        <h2>Scenarios</h2>
      </header>
      <div className="lab-tool-content">
        <div className="lab-row lab-wrap">
          <select
            aria-label="Scenario preset"
            value={kind}
            disabled={disabled}
            onChange={(event) => setKind(event.target.value as ScenarioKind)}
          >
            {LAB_SCENARIOS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            className="lab-button"
            disabled={disabled}
            onClick={() =>
              load(createLabScenario(controller, bookId, kind), false)
            }
          >
            Set up
          </button>
          <button
            className="lab-button"
            aria-label="Play scenario"
            disabled={disabled}
            onClick={() =>
              load(createLabScenario(controller, bookId, kind), true)
            }
          >
            <Play size={13} /> Play
          </button>
        </div>
        <p className="lab-hint">{scenario.result}</p>
        <p className="lab-hint">
          Uses the first two clients and selected book. Automatic sync is
          paused.
        </p>
      </div>
    </section>
  );
}
