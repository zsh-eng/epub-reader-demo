import { useEffect, useState, useSyncExternalStore } from "react";
import { Circle, Play, Square } from "lucide-react";
import { LabRecorder, type LabRecording } from "./core/recording";
import type { SyncLabController } from "./core/controller";

/** Sequences record inspector actions and expected failures, not DOM gestures or timing. */
export function RecordingControls({
  controller,
  locked,
  run,
  onRecordingChange,
}: {
  controller: SyncLabController;
  locked: boolean;
  run: (action: () => Promise<unknown>) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [recorder] = useState(() => new LabRecorder(controller));
  const [recordings, setRecordings] = useState<LabRecording[]>([]);
  const [name, setName] = useState("My sync sequence");
  const [recording, setRecording] = useState(false);
  useEffect(() => () => recorder.dispose(), [recorder]);
  const ready =
    view.clients.length > 0 &&
    view.clients.every(
      (client) => client.endpoint && !client.busy && !client.autoSync,
    );
  return (
    <section className="lab-panel">
      <header className="lab-panel-heading">
        <h2>Record / replay</h2>
        <span className="lab-pill">
          {recording ? `${recorder.stepCount}/200 steps` : "200-step limit"}
        </span>
      </header>
      <div className="lab-tool-content">
        <p className="lab-hint">Inspector actions only; no DOM gestures.</p>
        <div className="lab-row lab-wrap">
          <input
            aria-label="Sequence name"
            value={name}
            disabled={recording}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
          />
          {recording ? (
            <button
              className="lab-button lab-button-primary"
              disabled={locked}
              onClick={() =>
                run(async () => {
                  try {
                    const result = recorder.stop();
                    setRecordings((previous) => [...previous, result]);
                  } finally {
                    setRecording(recorder.isRecording);
                    onRecordingChange(recorder.isRecording);
                  }
                })
              }
            >
              <Square size={13} /> Stop recording
            </button>
          ) : (
            <button
              className="lab-button"
              disabled={locked || !ready || view.mode !== "inspector"}
              onClick={() =>
                run(async () => {
                  await recorder.start(name || "Inspector sequence");
                  setRecording(true);
                  onRecordingChange(true);
                })
              }
            >
              <Circle size={13} /> Record sequence
            </button>
          )}
          {view.clients.some((client) => client.autoSync) && (
            <span className="lab-hint">Pause automatic sync to record.</span>
          )}
        </div>
        {recordings.map((item, index) => (
          <div className="lab-snapshot" key={index}>
            <span>
              {item.name}
              <small>{item.steps.length} steps</small>
            </span>
            <button
              className="lab-button"
              disabled={locked || recording || view.mode !== "inspector"}
              onClick={() =>
                run(async () => {
                  await recorder.replay(item);
                  controller.log(
                    "Lab",
                    "replay",
                    `Replayed “${item.name}”: all ${item.steps.length} steps matched`,
                  );
                })
              }
            >
              <Play size={13} /> Replay
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
