import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Note, NoteInput, NoteMutation } from "../../shared/protocol";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export interface NoteTarget {
  path: string;
  side: "old" | "new";
  line: number;
  endLine?: number;
}

function lineLabel(target: NoteTarget) {
  return `${target.side === "old" ? "Old" : "New"} · L${target.line}${target.endLine && target.endLine !== target.line ? `–${target.endLine}` : ""}`;
}

/** Match Pierre's native utility geometry; toolbar button sizes cover line numbers. */
export function GutterNoteButton({ onClick }: { onClick(): void }) {
  return (
    <button
      type="button"
      {...stylex.props(styles.gutterButton)}
      onClick={onClick}
      aria-label="Add note to line"
      title="Add comment"
    >
      <Icon name="plus" size={13} />
    </button>
  );
}

function CommentEditor({
  label,
  initialText = "",
  submitLabel,
  onSave,
  onCancel,
}: {
  label: string;
  initialText?: string;
  submitLabel: string;
  onSave(text: string): Promise<void>;
  onCancel(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const submit = async () => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(text.trim());
      onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save comment");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={input}
        value={text}
        readOnly={saving}
        rows={2}
        aria-label={label}
        placeholder={label === "Reply text" ? "Write a reply…" : "Leave a comment…"}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            void submit();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!inFlight.current) onCancel();
          }
        }}
        {...stylex.props(styles.textarea)}
      />
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      <div {...stylex.props(styles.actions)}>
        <span {...stylex.props(styles.hint)}>⌘ / Ctrl Enter</span>
        <span {...stylex.props(ui.grow)} />
        <button
          type="button"
          {...stylex.props(ui.button, styles.smallButton)}
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          {...stylex.props(ui.button, styles.submit)}
          disabled={!text.trim() || saving}
          aria-label={submitLabel}
        >
          {saving ? "Saving…" : submitLabel === "Save note" ? "Comment" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function NoteComposer({
  target,
  parentId,
  onSave,
  onCancel,
}: {
  target: NoteTarget;
  parentId?: string;
  onSave(note: NoteInput): Promise<void>;
  onCancel(): void;
}) {
  return (
    <div {...stylex.props(styles.card, !!parentId && styles.embedded)}>
      {!parentId && (
        <div {...stylex.props(styles.heading)}>
          <Icon name="note" size={13} />
          <span>Comment</span>
          <span {...stylex.props(ui.grow)} />
          <span {...stylex.props(styles.location)}>{lineLabel(target)}</span>
        </div>
      )}
      <CommentEditor
        label={parentId ? "Reply text" : "Review note text"}
        submitLabel={parentId ? "Reply" : "Save note"}
        onSave={(text) => onSave({ ...target, text, ...(parentId ? { parentId } : {}) })}
        onCancel={onCancel}
      />
    </div>
  );
}

function ThreadMessage({
  note,
  reply = false,
  onMutate,
}: {
  note: Note;
  reply?: boolean;
  onMutate(mutation: NoteMutation): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const removeInFlight = useRef(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (removeInFlight.current) return;
    removeInFlight.current = true;
    setRemoving(true);
    setError("");
    try {
      await onMutate({ type: "remove", id: note.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete comment");
    } finally {
      removeInFlight.current = false;
      setRemoving(false);
    }
  };
  return (
    <div {...stylex.props(reply && styles.reply)}>
      <div {...stylex.props(styles.heading)}>
        <span {...stylex.props(styles.author)}>You</span>
        {reply ? (
          <span {...stylex.props(styles.location)}>replied</span>
        ) : (
          <span {...stylex.props(styles.location)}>{lineLabel(note)}</span>
        )}
        <span {...stylex.props(ui.grow)} />
        <button
          type="button"
          {...stylex.props(ui.button, styles.iconButton)}
          title={reply ? "Edit reply" : "Edit comment"}
          aria-label={reply ? "Edit reply" : "Edit"}
          disabled={removing || editing}
          onClick={() => setEditing(true)}
        >
          <Icon name="edit" size={12} />
        </button>
        <button
          type="button"
          {...stylex.props(ui.button, styles.iconButton)}
          title={reply ? "Delete reply" : "Delete comment"}
          aria-label={reply ? "Delete reply" : "Delete review note"}
          disabled={removing || editing}
          onClick={() => void remove()}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>
      {note.resolution && note.resolution !== "active" && (
        <p {...stylex.props(styles.stale)}>
          {note.resolution === "orphaned"
            ? "Original location no longer exists. Note preserved for review."
            : "Source changed since this note was written."}
        </p>
      )}
      {editing ? (
        <CommentEditor
          label={reply ? "Edit reply text" : "Edit note text"}
          initialText={note.text}
          submitLabel="Save"
          onSave={(text) => onMutate({ type: "edit", id: note.id, text })}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p {...stylex.props(styles.body)}>{note.text}</p>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

export function NoteCard({
  note,
  replies,
  onMutate,
}: {
  note: Note;
  replies: Note[];
  onMutate(mutation: NoteMutation): Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  return (
    <article aria-label={`Comment thread at ${lineLabel(note)}`} {...stylex.props(styles.card)}>
      <ThreadMessage key={note.id} note={note} onMutate={onMutate} />
      {replies.map((reply) => (
        <ThreadMessage key={reply.id} note={reply} reply onMutate={onMutate} />
      ))}
      {replying ? (
        <NoteComposer
          target={note}
          parentId={note.id}
          onSave={(reply) => onMutate({ type: "add", note: reply })}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <button
          type="button"
          {...stylex.props(ui.button, styles.replyButton)}
          onClick={() => setReplying(true)}
        >
          <Icon name="reply" size={12} />
          Reply
        </button>
      )}
    </article>
  );
}

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    marginBlock: 8,
    marginInline: 10,
    maxWidth: 660,
    paddingBlock: 9,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 7,
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  embedded: {
    borderWidth: 0,
    borderTopWidth: 1,
    borderRadius: 0,
    margin: 0,
    marginTop: 8,
    paddingInline: 0,
    paddingBottom: 0,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minHeight: 22,
    fontSize: 11,
    color: tokens.muted,
  },
  author: { color: tokens.text, fontWeight: 600 },
  location: { color: tokens.muted, fontSize: 10 },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    resize: "vertical",
    minHeight: 58,
    maxHeight: 260,
    paddingBlock: 8,
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: 1.65,
    outline: { default: "none", ":focus-visible": `1px solid ${tokens.border}` },
    outlineOffset: 3,
  },
  actions: { display: "flex", alignItems: "center", gap: 5, marginTop: 4 },
  hint: { fontSize: 10, color: tokens.faint },
  smallButton: { minHeight: 25, paddingBlock: 2, fontSize: 11 },
  submit: {
    minHeight: 25,
    paddingBlock: 2,
    paddingInline: 10,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.accent,
    backgroundColor: { default: tokens.selected, ":hover": tokens.hover },
  },
  iconButton: { minHeight: 22, width: 22, padding: 3, opacity: { default: 0.7, ":hover": 1 } },
  body: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.65, marginBlock: 5 },
  reply: {
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  replyButton: { minHeight: 24, paddingInline: 0, paddingBlock: 2, marginTop: 3, fontSize: 11 },
  stale: { color: tokens.warning, fontSize: 11, lineHeight: 1.6, marginBlock: 5 },
  error: { color: tokens.red, fontSize: 11, marginBlock: 5 },
  gutterButton: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    zIndex: 4,
    width: "1lh",
    height: "1lh",
    padding: 0,
    marginRight: "calc(-1lh + 1ch)",
    fontFamily: tokens.code,
    fontSize: "var(--diffs-font-size, 12px)",
    lineHeight: "var(--diffs-line-height, 20px)",
    borderWidth: 0,
    borderRadius: 4,
    color: tokens.canvas,
    backgroundColor: tokens.accent,
    cursor: "pointer",
    touchAction: "none",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accent}` },
    outlineOffset: 2,
  },
});
