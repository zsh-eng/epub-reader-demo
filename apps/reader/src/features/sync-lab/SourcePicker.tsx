import { useEffect, useRef, useState } from "react";
import type { SourceBook } from "./core/seed";

/** Select source books before any binary bytes are read or client databases are created. */
export function SourcePicker({
  books,
  busy,
  onClose,
  onCapture,
}: {
  books: SourceBook[];
  busy: boolean;
  onClose: () => void;
  onCapture: (ids: string[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(
    () => new Set(books.slice(0, 1).map((book) => book.id)),
  );
  const [search, setSearch] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="lab-source-dialog"
      ref={dialog}
      onCancel={(event) => {
        if (busy) event.preventDefault();
        else onClose();
      }}
      aria-labelledby="source-title"
    >
      <header>
        <h2 id="source-title">Copy local books</h2>
        <p>Copies selected records and available file bytes.</p>
      </header>
      <input
        aria-label="Find source books"
        placeholder="Find a book…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="lab-source-options">
        {books
          .filter((book) =>
            `${book.title} ${book.author}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((book) => (
            <label key={book.id}>
              <input
                type="checkbox"
                checked={selected.has(book.id)}
                disabled={busy}
                onChange={(event) =>
                  setSelected((previous) => {
                    const next = new Set(previous);
                    if (event.target.checked) next.add(book.id);
                    else next.delete(book.id);
                    return next;
                  })
                }
              />
              <span>
                <strong>{book.title}</strong>
                <small>{book.author}</small>
              </span>
            </label>
          ))}
      </div>
      <footer>
        <button
          className="lab-button lab-button-quiet"
          disabled={busy}
          onClick={() => setSelected(new Set(books.map((book) => book.id)))}
        >
          Select all
        </button>
        <div className="lab-row">
          <button className="lab-button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="lab-button lab-button-primary"
            disabled={busy || !selected.size}
            onClick={() => onCapture([...selected])}
          >
            {busy
              ? "Copying…"
              : `Copy ${selected.size} selected ${selected.size === 1 ? "book" : "books"}`}
          </button>
        </div>
      </footer>
    </dialog>
  );
}
