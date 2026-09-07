import { memo, useState } from "react";
import { Search } from "lucide-react";
import { decodeSyncKey, decodeSyncValue } from "@/lib/sync-v2/protocol";
import type { LabView } from "./core/controller";
import type { DomainRow, LabEvent } from "./types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function RecordInspector({ view }: { view: LabView }) {
  const [table, setTable] = useState("notes");
  const [selection, setSelection] = useState("");
  const [search, setSearch] = useState("");
  const tables = [
    "books",
    "notes",
    "readingCheckpoints",
    "readingSessions",
    "highlights",
    "readingState",
    "readingSettings",
  ];
  const serverRows = view.server.records
    .filter((record) => decodeSyncKey(record.key)[0] === table)
    .map((record) => ({
      record,
      row: decodeSyncValue<DomainRow>(record.value),
    }));
  const ids = [
    ...new Set([
      ...serverRows.map(({ row }) => row.id),
      ...view.clients.flatMap(
        (client) => client.inspection?.rows[table]?.map((row) => row.id) ?? [],
      ),
    ]),
  ].filter((id) => id.toLowerCase().includes(search.toLowerCase()));
  const id = ids.includes(selection) ? selection : ids[0];
  const selectedServer = serverRows.find(({ row }) => row.id === id);
  const serverRow = selectedServer?.row;
  return (
    <section
      className="lab-panel lab-record-panel"
      aria-label="Record inspector"
    >
      <header className="lab-panel-heading">
        <select
          aria-label="Record table"
          value={table}
          onChange={(event) => setTable(event.target.value)}
        >
          {tables.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </header>
      <div className="lab-record-layout">
        <div className="lab-record-list">
          <label className="lab-search">
            <Search size={14} />
            <input
              aria-label="Find record"
              placeholder="Filter IDs"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          {ids.length ? (
            ids.map((rowId) => (
              <button
                key={rowId}
                className={rowId === id ? "is-selected" : ""}
                onClick={() => setSelection(rowId)}
              >
                {rowId}
              </button>
            ))
          ) : (
            <p className="lab-empty-small">No {table}.</p>
          )}
        </div>
        <div className="lab-record-comparison">
          <div className="lab-record-value">
            <header>
              <strong>Server</strong>
              <span>
                {selectedServer
                  ? `sequence ${selectedServer.record.serverSeq}`
                  : "Absent"}
              </span>
            </header>
            {selectedServer && (
              <p className="lab-hint">
                HLC {selectedServer.record.hlc.wallTimeMs}:
                {selectedServer.record.hlc.counter}
              </p>
            )}
            <pre>
              {serverRow ? JSON.stringify(serverRow, null, 2) : "Absent"}
            </pre>
          </div>
          {view.clients.map((client) => {
            const row = client.inspection?.rows[table]?.find(
              (row) => row.id === id,
            );
            const matches =
              !!row && !!serverRow && canonical(row) === canonical(serverRow);
            return (
              <div className="lab-record-value" key={client.id}>
                <header>
                  <strong>{client.name}</strong>
                  <span className={row && !matches ? "lab-different" : ""}>
                    {!client.inspection
                      ? "Loading"
                      : !row
                        ? "Absent"
                        : matches
                          ? "Matches server"
                          : "Different"}
                  </span>
                </header>
                <pre>{row ? JSON.stringify(row, null, 2) : "Absent"}</pre>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
export function FileInspector({
  view,
  bookId,
}: {
  view: LabView;
  bookId: string;
}) {
  const record = view.server.records.find((record) => {
    const [table, id] = decodeSyncKey(record.key);
    return table === "books" && id === bookId;
  });
  const book = record ? decodeSyncValue<DomainRow>(record.value) : undefined;
  const fileId = book?.sourceFileId as string | undefined;
  const remote = view.server.files.some((file) => file.metadata.id === fileId);
  return (
    <section className="lab-panel lab-file-panel">
      <header className="lab-panel-heading">
        <span className="lab-pill">
          {view.server.files.length} server files
        </span>
      </header>
      <div className="lab-file-grid">
        <div>
          <strong>Server EPUB</strong>
          <span>{remote ? "Available" : "Absent"}</span>
        </div>
        {view.clients.map((client) => (
          <div key={client.id}>
            <strong>{client.name}</strong>
            <span>
              {client.inspection?.files.some((file) => file.id === fileId)
                ? "EPUB present"
                : "EPUB absent"}
            </span>
            <small>
              {client.inspection?.materialized.includes(bookId)
                ? "Materialized"
                : "Not materialized"}
            </small>
          </div>
        ))}
      </div>
    </section>
  );
}
export function EventTimeline({
  view,
  clear,
}: {
  view: LabView;
  clear: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [clientId, setClientId] = useState("all");
  const names = new Map(view.clients.map((client) => [client.id, client.name]));
  const events = view.events
    .filter(
      (event) =>
        (clientId === "all" || event.client === clientId) &&
        `${event.kind} ${event.summary} ${event.key ?? ""}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    )
    .slice()
    .reverse();
  return (
    <section className="lab-panel" aria-label="Sync timeline">
      <header className="lab-panel-heading">
        <div className="lab-row">
          <select
            aria-label="Filter events by client"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
          >
            <option value="all">All clients</option>
            <option>Server</option>
            {view.clients.map((client) => (
              <option value={client.id} key={client.id}>
                {client.name}
              </option>
            ))}
          </select>
          <button className="lab-button lab-button-quiet" onClick={clear}>
            Clear
          </button>
        </div>
      </header>
      <label className="lab-search lab-timeline-search">
        <Search size={14} />
        <input
          aria-label="Search events"
          placeholder="Filter events or IDs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      </label>
      <div className="lab-timeline">
        {events.length ? (
          events.map((event) => (
            <EventRow
              key={event.id}
              event={event}
              clientName={names.get(event.client) ?? event.client}
            />
          ))
        ) : (
          <p className="lab-empty-small">No events.</p>
        )}
      </div>
      <footer className="lab-panel-footer">
        {events.length} shown / {view.events.length} events · limit 2,000
      </footer>
    </section>
  );
}

/** Collapsed events do not serialize record payloads. */
const EventRow = memo(function EventRow({
  event,
  clientName,
}: {
  event: LabEvent;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="lab-event"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <time>
          {new Date(event.time).toLocaleTimeString("en-GB", { hour12: false })}
        </time>
        <span className="lab-event-client">{clientName}</span>
        <span className={event.kind.includes("error") ? "lab-error" : ""}>
          {event.summary}
        </span>
        <span className="lab-event-kind">{event.kind}</span>
      </summary>
      {open && (
        <>
          {event.key && <code>{event.key}</code>}
          {event.detail !== undefined && (
            <pre>{JSON.stringify(event.detail, null, 2)}</pre>
          )}
        </>
      )}
    </details>
  );
});
