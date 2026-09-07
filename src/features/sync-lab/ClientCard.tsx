import { useState } from "react";
import {
  ArrowDownToLine,
  ChevronDown,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import type { LabView, SyncLabController } from "./core/controller";
import type { LabMode } from "./types";

export function ClientCard({
  client,
  controller,
  mode,
  bookId,
  run,
  lockLifecycle,
}: {
  lockLifecycle: boolean;
  client: LabView["clients"][number];
  controller: SyncLabController;
  mode: LabMode;
  bookId: string;
  run: (action: () => Promise<unknown>) => void;
}) {
  const [note, setNote] = useState(client.name);
  const [progress, setProgress] = useState(35);
  const [protocolOpen, setProtocolOpen] = useState(false);
  const network = client.networkState;
  const ready = !!client.endpoint && !client.busy;
  const command = (type: "sync" | "pull" | "push") =>
    run(() => controller.command(client.id, { type }));
  return (
    <article className="lab-client" aria-label={client.name}>
      <header className="lab-client-header">
        <div className="lab-client-name">
          <h2>{client.name}</h2>
          <span>
            {client.preset} · {client.endpoint ? "ready" : "starting"}
          </span>
        </div>
        <button
          className="lab-icon"
          title="Restart client"
          aria-label={`Restart ${client.name}`}
          disabled={!ready || lockLifecycle}
          onClick={() => run(() => controller.restart(client.id))}
        >
          <RefreshCw size={15} />
        </button>
        <button
          className="lab-icon"
          title="Discard client"
          aria-label={`Discard ${client.name}`}
          disabled={lockLifecycle}
          onClick={() => run(() => controller.remove(client.id))}
        >
          <Trash2 size={15} />
        </button>
      </header>
      <div className="lab-client-status">
        <button
          className={`lab-connection ${network.online ? "" : "is-offline"}`}
          onClick={() => controller.setOnline(client.id, !network.online)}
        >
          {network.online ? <Wifi size={14} /> : <WifiOff size={14} />}{" "}
          {network.online ? "Online" : "Offline"}
        </button>
        <span>{client.inspection?.outbox.length ?? 0} pending</span>
        <span>cursor {client.inspection?.state?.pullCursor ?? 0}</span>
      </div>
      <div className="lab-sync-controls">
        <button
          className="lab-button lab-button-primary"
          disabled={!ready || !network.online}
          onClick={() => command("sync")}
        >
          {client.busy ? "Working…" : "Sync now"}
        </button>
        <button
          className="lab-button"
          disabled={!ready || !network.online}
          onClick={() => command("pull")}
        >
          Pull
        </button>
        <button
          className="lab-button"
          disabled={!ready || !network.online}
          onClick={() => command("push")}
        >
          Push
        </button>
      </div>
      <iframe
        key={`${mode}-${client.revision}`}
        title={`${client.name} app`}
        className={mode === "app" ? "lab-phone" : "lab-headless-frame"}
        src={`/?labClient=${client.id}&labMode=${mode}&revision=${client.revision}`}
      />
      <div className="lab-client-body">
        <label className="lab-checkbox">
          <input
            type="checkbox"
            checked={client.autoSync}
            onChange={(event) =>
              controller.setAutoSync(client.id, event.target.checked)
            }
          />{" "}
          Auto sync (30s)
        </label>
        <details className="lab-details" open={mode === "inspector"}>
          <summary>
            Local actions <ChevronDown size={14} />
          </summary>
          <label className="lab-field">
            Shared note (same ID)
            <textarea
              aria-label={`${client.name} shared note`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={2}
            />
          </label>
          <div className="lab-row">
            <button
              className="lab-button"
              disabled={!ready || !bookId}
              onClick={() =>
                run(() =>
                  controller.command(client.id, {
                    type: "note",
                    bookId,
                    content: note,
                  }),
                )
              }
            >
              Save note
            </button>
            <button
              className="lab-button lab-button-quiet"
              disabled={!ready || !bookId}
              onClick={() =>
                run(() =>
                  controller.command(client.id, {
                    type: "delete-note",
                    bookId,
                  }),
                )
              }
            >
              Delete note
            </button>
          </div>
          <label className="lab-field">
            Chapter 1 position{" "}
            <span className="lab-range">
              <input
                aria-label={`${client.name} reading position`}
                type="range"
                min="0"
                max="100"
                value={progress}
                onChange={(event) => setProgress(Number(event.target.value))}
              />
              <output>{progress}%</output>
            </span>
          </label>
          <div className="lab-row">
            <button
              className="lab-button"
              disabled={!ready || !bookId}
              onClick={() =>
                run(() =>
                  controller.command(client.id, {
                    type: "checkpoint",
                    bookId,
                    progress,
                  }),
                )
              }
            >
              Set position
            </button>
            <button
              className="lab-button"
              disabled={!ready || !bookId}
              onClick={() =>
                run(() =>
                  controller.command(client.id, { type: "download", bookId }),
                )
              }
            >
              <ArrowDownToLine size={13} /> EPUB
            </button>
          </div>
        </details>
        <details className="lab-details">
          <summary>
            Network & clock <ChevronDown size={14} />
          </summary>
          <label className="lab-field">
            Latency (ms)
            <input
              type="number"
              min="0"
              max="10000"
              step="100"
              value={network.latencyMs}
              onChange={(event) =>
                controller.configure(client.id, {
                  latencyMs: Math.max(
                    0,
                    Math.min(10000, Number(event.target.value)),
                  ),
                })
              }
            />
          </label>
          <label className="lab-field">
            HLC offset (s)
            <input
              type="number"
              min="-600"
              max="600"
              value={client.clockOffset / 1000}
              onChange={(event) =>
                controller.configure(client.id, {
                  clockOffset: Number(event.target.value) * 1000,
                })
              }
            />
          </label>
          <p className="lab-hint">
            HLC only; server limit +300s. App timers use real time.
          </p>
          <div className="lab-row lab-wrap">
            <button
              className="lab-button"
              onClick={() => controller.offlineFor(client.id, 10)}
            >
              Offline for 10s
            </button>
            <button
              className="lab-button"
              onClick={() =>
                controller.configure(client.id, { failure: "request" })
              }
            >
              {network.failNext ? "Failure armed" : "Fail next request"}
            </button>
            <button
              className="lab-button"
              onClick={() =>
                controller.configure(client.id, { failure: "response" })
              }
            >
              {network.loseNextResponse
                ? "Response loss armed"
                : "Lose next write response"}
            </button>
          </div>
        </details>
        <details
          className="lab-details"
          open={protocolOpen}
          onToggle={(event) => setProtocolOpen(event.currentTarget.open)}
        >
          <summary>
            Protocol state <ChevronDown size={14} />
          </summary>
          <p className="lab-hint">Device {client.id}</p>
          {protocolOpen && (
            <pre className="lab-protocol">
              {JSON.stringify(
                {
                  state: client.inspection?.state,
                  outbox: client.inspection?.outbox,
                },
                null,
                2,
              )}
            </pre>
          )}
        </details>
        {client.error && (
          <p className="lab-error" role="status">
            {client.error}
          </p>
        )}
      </div>
    </article>
  );
}
