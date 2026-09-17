import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Copy,
  Play,
  SkipForward,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { READER_HISTORY_LIMIT } from "../jump-history";
import { ReaderHistoryFooterPreview } from "./ReaderHistoryFooterPreview";
import {
  ACTION_TYPES,
  EXAMPLES,
  actionLabel,
  createPlayground,
  loadPlayground,
  runPlaygroundAction,
  savePlayground,
  type ActionType,
  type PlaygroundAction,
} from "./jump-history-playground";

const selectClass =
  "h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm";

/** A manual test surface for history semantics, separate from real book data. */
export function ReaderJumpHistoryDebug() {
  const [session, setSession] = useState(loadPlayground);
  const [animateStrip, setAnimateStrip] = useState(true);
  const [kind, setKind] = useState<ActionType>("highlight");
  const [destination, setDestination] = useState("H1");
  const [exampleIndex, setExampleIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const { snapshot, preview, log } = session;
  const { entries, cursor } = snapshot;
  const current = entries[cursor];
  const example = EXAMPLES[exampleIndex];
  const nextAction = example.actions[step];
  const json = JSON.stringify(snapshot, null, 2);

  useEffect(() => {
    try {
      savePlayground(snapshot);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [snapshot]);

  function run(action: PlaygroundAction, animate = true) {
    setAnimateStrip(animate);
    setSession(runPlaygroundAction(session, action));
    setCopyStatus("");
  }
  function reset() {
    setAnimateStrip(false);
    setSession(createPlayground());
    setStep(0);
    setCopyStatus("");
  }
  function runExample(all: boolean) {
    setAnimateStrip(true);
    const end = all ? example.actions.length : step + 1;
    let next = session;
    for (const action of example.actions.slice(step, end))
      next = runPlaygroundAction(next, action);
    setSession(next);
    setStep(end);
    setCopyStatus("");
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl space-y-7">
        <header>
          <Link
            to="/settings"
            className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" /> Settings
          </Link>
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Reader · Debug
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Jump history playground
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Run typed movements between named locations. This uses the Reader’s
            history controller with sample positions and separate saved debug
            state.
          </p>
        </header>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="order-2 min-w-0 space-y-5 lg:order-1">
            <section
              className="rounded-2xl border border-border p-5"
              aria-labelledby="movement-heading"
            >
              <h2 id="movement-heading" className="font-semibold">
                Run a movement
              </h2>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!destination.trim()) return;
                  run({ type: "visit", kind, destination: destination.trim() });
                }}
              >
                <div className="grid gap-4 sm:grid-cols-[1.5fr_1fr]">
                  <label className="space-y-2 text-sm">
                    <span>Action type</span>
                    <select
                      className={selectClass}
                      value={kind}
                      onChange={(event) =>
                        setKind(event.target.value as ActionType)
                      }
                    >
                      {ACTION_TYPES.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2 text-sm">
                    <span>Destination</span>
                    <Input
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      maxLength={40}
                      placeholder="81, 140, or H1…"
                      className="rounded-xl text-base"
                    />
                  </label>
                </div>
                <Button
                  type="submit"
                  disabled={!destination.trim()}
                  className="w-full rounded-xl"
                >
                  <Play /> Run action
                </Button>
              </form>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => run({ type: "end-group" })}
                >
                  End group
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => run({ type: "relayout" })}
                >
                  Simulate relayout
                </Button>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Use a new destination to move, or repeat one to test a no-op.
                Enter a page from 1–1200 or a named location such as H1. “End
                group” models closing a picker.
              </p>
            </section>

            <section
              className="rounded-2xl border border-border p-5"
              aria-labelledby="examples-heading"
            >
              <h2 id="examples-heading" className="font-semibold">
                Step through an example
              </h2>
              <label className="mt-4 block">
                <span className="sr-only">Example</span>
                <select
                  className={selectClass}
                  value={exampleIndex}
                  onChange={(event) => {
                    setExampleIndex(Number(event.target.value));
                    reset();
                  }}
                >
                  {EXAMPLES.map((item, index) => (
                    <option key={item.name} value={index}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {example.description} Selecting an example resets the trail to
                A.
              </p>
              <div
                className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm"
                data-testid="next-history-action"
              >
                <span className="block text-xs text-muted-foreground">
                  {step} / {example.actions.length} steps
                </span>
                <span className="mt-1 block font-medium">
                  {nextAction
                    ? actionLabel(nextAction)
                    : "Example complete. Try Back or a new movement."}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="rounded-xl"
                  disabled={!nextAction}
                  onClick={() => runExample(false)}
                >
                  <SkipForward /> Next step
                </Button>
                <Button
                  variant="outline"
                  className="rounded-xl"
                  disabled={!nextAction}
                  onClick={() => runExample(true)}
                >
                  Run remaining
                </Button>
                <Button variant="ghost" className="rounded-xl" onClick={reset}>
                  <RotateCcw /> Reset to A
                </Button>
              </div>
            </section>

            <section aria-labelledby="activity-heading" className="px-1">
              <h2 id="activity-heading" className="text-sm font-semibold">
                Recent actions
              </h2>
              <ol aria-label="Action log" className="mt-3 space-y-3 text-sm">
                {log.length === 0 && (
                  <li className="text-muted-foreground">
                    Choose an action or step through an example.
                  </li>
                )}
                {log.map((item) => (
                  <li key={item.id} className="border-l-2 border-border pl-3">
                    <p className="font-medium">
                      <span className="mr-2 font-mono text-xs text-muted-foreground">
                        {item.id}
                      </span>
                      {item.action}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {item.result}
                    </p>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="contents lg:order-2 lg:block lg:min-w-0 lg:space-y-5">
            <div className="order-1">
              <ReaderHistoryFooterPreview
                session={session}
                animate={animateStrip}
                onAction={run}
                nextActionLabel={
                  nextAction ? actionLabel(nextAction) : "Example complete"
                }
                canStep={Boolean(nextAction)}
                onStep={() => runExample(false)}
              />
            </div>
            <section
              className="order-3 overflow-hidden rounded-2xl border border-border"
              aria-labelledby="trail-heading"
            >
              <div className="border-b border-border bg-muted/50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Committed location
                    </p>
                    <p
                      data-testid="history-location"
                      className="mt-1 break-all text-3xl font-semibold tracking-tight"
                    >
                      {current.anchor.blockId}
                    </p>
                  </div>
                  <div className="text-right text-xs leading-6 text-muted-foreground">
                    <p>
                      Cursor{" "}
                      <span
                        data-testid="history-cursor"
                        className="font-mono text-foreground"
                      >
                        {cursor}
                      </span>
                    </p>
                    <p>
                      <span data-testid="history-count">{entries.length}</span>{" "}
                      / {READER_HISTORY_LIMIT} entries
                    </p>
                  </div>
                </div>
                {preview && (
                  <p className="mt-3 text-sm" data-testid="history-preview">
                    Preview: <strong>{preview}</strong> · not committed
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl"
                    disabled={cursor <= 0}
                    onClick={() => run({ type: "back" })}
                  >
                    <ArrowLeft /> Back
                  </Button>
                  <Button
                    variant="outline"
                    className="flex-1 rounded-xl"
                    disabled={cursor >= entries.length - 1}
                    onClick={() => run({ type: "forward" })}
                  >
                    Forward <ArrowRight />
                  </Button>
                </div>
              </div>
              <div className="p-5">
                <h2 id="trail-heading" className="font-semibold">
                  The array
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Indexes start at zero. Back and Forward move the cursor.
                </p>
                <ol
                  aria-label="History entries"
                  className="mt-4 max-h-80 space-y-1 overflow-y-auto"
                >
                  {entries.map((entry, index) => (
                    <li
                      key={index}
                      data-current={index === cursor ? "true" : "false"}
                      aria-current={index === cursor ? "location" : undefined}
                      className={cn(
                        "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-sm",
                        index === cursor
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted/50",
                      )}
                    >
                      <span className="font-mono text-xs opacity-60">
                        {index}
                      </span>
                      <div className="min-w-0">
                        <p className="break-all font-medium">
                          {entry.anchor.blockId}
                        </p>
                        <p className="mt-0.5 text-xs opacity-65">
                          {entry.kind}
                        </p>
                      </div>
                      <span className="text-xs opacity-80">
                        {index === cursor
                          ? "Current"
                          : index < cursor
                            ? "Back"
                            : "Forward"}
                      </span>
                    </li>
                  ))}
                </ol>
                <p
                  className="mt-4 min-h-5 text-xs leading-relaxed text-muted-foreground"
                  role="status"
                >
                  {log[0]?.result ??
                    `Ready at ${current.anchor.blockId}. Choose a movement or use Back and Forward.`}
                </p>
              </div>
            </section>

            <section
              className="order-4 overflow-hidden rounded-2xl border border-border"
              aria-labelledby="json-heading"
            >
              <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
                <h2 id="json-heading" className="text-sm font-semibold">
                  Raw state
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(json);
                      setCopyStatus("Copied");
                    } catch {
                      setCopyStatus("Copy failed");
                    }
                  }}
                >
                  <Copy /> {copyStatus || "Copy JSON"}
                </Button>
              </div>
              <pre
                data-testid="history-json"
                className="max-h-96 overflow-auto p-5 font-mono text-xs leading-relaxed"
              >
                {json}
              </pre>
            </section>
            <p className="order-5 px-1 text-xs leading-relaxed text-muted-foreground">
              {storageError
                ? "Debug state could not be saved. Actions still work in this session."
                : "Saved locally for this playground. Reload this page to test persistence. Real book history is unchanged."}
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
