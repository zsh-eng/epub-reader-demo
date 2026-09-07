import { SourcePicker } from "./SourcePicker";
import { ExperimentTools } from "./ExperimentTools";
import { LabPlayback, type PlaybackPlan } from "./core/playback";
import { PlaybackControls, ScenarioControls } from "./PlaybackControls";
import { RecordingControls } from "./RecordingControls";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Plus, RotateCcw } from "lucide-react";
import { SyncLabController } from "./core/controller";
import {
  captureLocalSeed,
  createDemoSeed,
  listSourceBooks,
  type SourceBook,
} from "./core/seed";
import { ClientCard } from "./ClientCard";
import { EventTimeline, FileInspector, RecordInspector } from "./Inspector";
import type { ClientPreset } from "./types";
import "./sync-lab.css";

/** Standalone debug workspace; app providers and pagination workers load only in app frames. */
export default function SyncLab() {
  const [controller] = useState(() => new SyncLabController());
  const view = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const [player] = useState(() => new LabPlayback());
  const playback = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const hasPlayback = playback.phase !== "idle";
  const playbackBusy = ["preparing", "running", "pausing", "stopping"].includes(
    playback.phase,
  );
  const [sourceBooks, setSourceBooks] = useState<SourceBook[]>();
  const [preset, setPreset] = useState<ClientPreset>("metadata");
  const [bookId, setBookId] = useState("");
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [working, setWorking] = useState(0);
  const [panel, setPanel] = useState<"Records" | "Events" | "Files" | "Tools">(
    "Records",
  );
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    window.__syncLabHost = controller;
    return () => {
      player.dispose();
      delete window.__syncLabHost;
      void controller.dispose();
    };
  }, [controller, player]);
  const books = view.server.records.flatMap((record) => {
    if (JSON.parse(record.key)[0] !== "books") return [];
    const row = JSON.parse(record.value) as {
      id: string;
      title?: string;
      isDeleted: boolean;
    };
    return row.title && !row.isDeleted ? [row] : [];
  });
  const selectedBook = books.some((book) => book.id === bookId)
    ? bookId
    : (books[0]?.id ?? "");
  const ready =
    view.clients.length > 0 &&
    view.clients.every((client) => client.endpoint && !client.busy);
  const locked = working > 0 || view.busy;
  const run = (action: () => Promise<unknown>) => {
    setError("");
    setWorking((count) => count + 1);
    void action()
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => setWorking((count) => count - 1));
  };
  const load = (plan: PlaybackPlan, play: boolean) => {
    void player.load(plan, play).catch((reason) => setError(String(reason)));
  };
  const start = async (source: "demo" | "local", selectedIds?: string[]) => {
    const seed =
      source === "demo"
        ? await createDemoSeed()
        : await captureLocalSeed(selectedIds);
    if (!seed.rows.books?.length)
      throw new Error(
        "Your local library has no books. Import a book in the Library, or use the demo.",
      );
    await controller.setSeed(seed);
    await controller.spawn("downloaded");
    await controller.spawn("metadata");
    setSourceBooks(undefined);
  };
  const hasSource = !!view.seedName || view.clients.length > 0;
  return (
    <main className="sync-lab">
      {sourceBooks && (
        <SourcePicker
          books={sourceBooks}
          busy={locked}
          onClose={() => setSourceBooks(undefined)}
          onCapture={(ids) => run(() => start("local", ids))}
        />
      )}
      <header className="lab-topbar">
        <a
          href="/settings"
          className="lab-back"
          title="Close lab and return to Reader"
          onClick={(event) => {
            event.preventDefault();
            run(async () => {
              await controller.dispose();
              location.assign("/settings");
            });
          }}
        >
          <ArrowLeft size={14} />
        </a>
        <h1>Sync Lab</h1>
        <div
          className="lab-mode-switch"
          role="group"
          aria-label="Presentation mode"
        >
          <button
            disabled={locked || recording || playbackBusy}
            aria-pressed={view.mode === "inspector"}
            onClick={() => run(() => controller.setMode("inspector"))}
          >
            Inspector
          </button>
          <button
            disabled={locked || recording || playbackBusy}
            aria-pressed={view.mode === "app"}
            onClick={() => run(() => controller.setMode("app"))}
          >
            App views
          </button>
        </div>
        <span className="lab-status">
          {view.clients.length} clients · {view.server.records.length} records ·{" "}
          {view.server.files.length} files
        </span>
        <span className="lab-source-label" title={view.seedName}>
          {view.seedName || "No source"}
        </span>
        {locked && (
          <span className="lab-working" role="status">
            Working…
          </span>
        )}
      </header>
      {error && (
        <div className="lab-alert" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <PlaybackControls
        player={player}
        view={playback}
        locked={locked}
        ready={ready}
        run={run}
      />
      <div className="lab-workbench">
        <section className="lab-client-pane" aria-label="Clients">
          <div className="lab-client-toolbar">
            {hasSource ? (
              <>
                <select
                  aria-label="Active book"
                  disabled={hasPlayback}
                  value={selectedBook}
                  onChange={(event) => setBookId(event.target.value)}
                >
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="New client preset"
                  value={preset}
                  onChange={(event) =>
                    setPreset(event.target.value as ClientPreset)
                  }
                >
                  <option value="empty">Empty</option>
                  <option value="metadata">Metadata only</option>
                  <option value="downloaded">Downloaded</option>
                  <option value="position">Downloaded · position 65%</option>
                </select>
                <button
                  className="lab-button"
                  disabled={
                    locked ||
                    recording ||
                    hasPlayback ||
                    view.clients.length >= 4
                  }
                  onClick={() => run(() => controller.spawn(preset))}
                >
                  <Plus size={13} />
                  Add client
                </button>
                <button
                  className="lab-icon"
                  aria-label="Reset experiment"
                  title="Reset experiment"
                  disabled={locked || recording || hasPlayback}
                  onClick={() => run(() => controller.reset())}
                >
                  <RotateCcw size={14} />
                </button>
              </>
            ) : (
              <>
                <button
                  className="lab-button"
                  disabled={locked}
                  onClick={() => run(() => start("demo"))}
                >
                  Start with demo
                </button>
                <button
                  className="lab-button"
                  disabled={locked}
                  onClick={() =>
                    run(async () => {
                      const books = await listSourceBooks();
                      if (!books.length)
                        throw new Error(
                          "No local books. Import a book in Reader or use the demo.",
                        );
                      setSourceBooks(books);
                    })
                  }
                >
                  Copy my library
                </button>
                <button
                  className="lab-button"
                  disabled={locked}
                  onClick={() => {
                    setPanel("Tools");
                    upload.current?.click();
                  }}
                >
                  Import checkpoint
                </button>
              </>
            )}
          </div>
          <div
            className={`lab-clients lab-clients-${view.mode}`}
            inert={playbackBusy}
          >
            {view.clients.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                controller={controller}
                mode={view.mode}
                bookId={selectedBook}
                run={run}
                lockLifecycle={recording || locked || hasPlayback}
              />
            ))}
            {!view.clients.length && (
              <p className="lab-empty-small">
                {hasSource
                  ? "No clients. Add a client to use the current server state."
                  : "Select a source to create an isolated experiment."}
              </p>
            )}
          </div>
        </section>
        <aside className="lab-inspector-dock" aria-label="Inspection tools">
          <div
            className="lab-dock-tabs"
            role="tablist"
            aria-label="Inspection panels"
          >
            {(["Records", "Events", "Files", "Tools"] as const).map((name) => (
              <button
                key={name}
                id={`lab-tab-${name}`}
                role="tab"
                tabIndex={panel === name ? 0 : -1}
                aria-selected={panel === name}
                aria-controls={`lab-panel-${name}`}
                onClick={() => setPanel(name)}
                onKeyDown={(event) => {
                  const names = [
                    "Records",
                    "Events",
                    "Files",
                    "Tools",
                  ] as const;
                  const index = names.indexOf(name);
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % 4
                      : event.key === "ArrowLeft"
                        ? (index + 3) % 4
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? 3
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  setPanel(names[next]);
                  document.getElementById(`lab-tab-${names[next]}`)?.focus();
                }}
              >
                {name}
                {name === "Events" && <span>{view.events.length}</span>}
              </button>
            ))}
          </div>
          <div className="lab-dock-content">
            <div
              role="tabpanel"
              id="lab-panel-Records"
              aria-labelledby="lab-tab-Records"
              hidden={panel !== "Records"}
            >
              <RecordInspector view={view} />
            </div>
            <div
              role="tabpanel"
              id="lab-panel-Events"
              aria-labelledby="lab-tab-Events"
              hidden={panel !== "Events"}
            >
              <EventTimeline
                view={view}
                clear={() => controller.clearEvents()}
              />
            </div>
            <div
              role="tabpanel"
              id="lab-panel-Files"
              aria-labelledby="lab-tab-Files"
              hidden={panel !== "Files"}
            >
              <FileInspector view={view} bookId={selectedBook} />
            </div>
            <div
              role="tabpanel"
              id="lab-panel-Tools"
              aria-labelledby="lab-tab-Tools"
              hidden={panel !== "Tools"}
            >
              <ScenarioControls
                controller={controller}
                bookId={selectedBook}
                disabled={
                  locked ||
                  recording ||
                  hasPlayback ||
                  !ready ||
                  view.clients.length < 2
                }
                load={load}
              />
              <RecordingControls
                controller={controller}
                locked={locked || hasPlayback}
                load={load}
                run={run}
                onRecordingChange={setRecording}
              />
              <ExperimentTools
                controller={controller}
                view={view}
                locked={locked}
                recording={recording || hasPlayback}
                ready={ready}
                run={run}
                upload={upload}
              />
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
