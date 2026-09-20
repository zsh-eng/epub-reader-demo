import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Note, NoteInput, NoteMutation } from "../../shared/protocol";
import { tokens, ui } from "../theme.stylex";

export interface NoteTarget {
  path: string;
  side: "old" | "new";
  line: number;
  endLine?: number;
}

function lineLabel(target: NoteTarget) {
  const side = target.side === "old" ? "L" : "R";
  return target.endLine && target.endLine !== target.line
    ? `lines ${side}${target.line} to ${side}${target.endLine}`
    : `line ${side}${target.line}`;
}

function CommentHeading({ target, reply = false }: { target: NoteTarget; reply?: boolean }) {
  return (
    <div {...stylex.props(styles.heading)}>
      <span aria-hidden="true" {...stylex.props(styles.avatar)}>
        Y
      </span>
      <span>You</span>
      <span {...stylex.props(ui.grow)} />
      <span {...stylex.props(styles.location)}>
        {reply ? "Reply" : `Local comment on ${lineLabel(target)}`}
      </span>
    </div>
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
      <div {...stylex.props(styles.editorBody)}>
        <div aria-hidden="true" {...stylex.props(styles.content, styles.mirror)}>
          {text + "\n"}
        </div>
        <textarea
          ref={input}
          value={text}
          readOnly={saving}
          rows={1}
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
          {...stylex.props(styles.content, styles.textarea)}
        />
      </div>
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
      <CommentHeading target={target} reply={!!parentId} />
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
  onReply,
  onMutate,
}: {
  note: Note;
  reply?: boolean;
  onReply?: () => void;
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
      <CommentHeading target={note} reply={reply} />
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
        <>
          <p {...stylex.props(styles.content)}>{note.text}</p>
          <div {...stylex.props(styles.actions)}>
            <span {...stylex.props(ui.grow)} />
            {onReply && (
              <button
                type="button"
                {...stylex.props(ui.button, styles.smallButton)}
                onClick={onReply}
              >
                Reply
              </button>
            )}
            <button
              type="button"
              {...stylex.props(ui.button, styles.smallButton)}
              aria-label={reply ? "Edit reply" : "Edit"}
              disabled={removing}
              onClick={() => setEditing(true)}
            >
              Edit
            </button>
            <button
              type="button"
              {...stylex.props(ui.button, styles.smallButton)}
              aria-label={reply ? "Delete reply" : "Delete review note"}
              disabled={removing}
              onClick={() => void remove()}
            >
              {removing ? "Deleting…" : "Delete"}
            </button>
          </div>
        </>
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
  const [pendingReply, setPendingReply] = useState<{
    text: string;
    previousIds: Set<string>;
  } | null>(null);
  const replySaved =
    pendingReply &&
    replies.some(
      (reply) => !pendingReply.previousIds.has(reply.id) && reply.text === pendingReply.text,
    );
  return (
    <article aria-label={`Comment thread at ${lineLabel(note)}`} {...stylex.props(styles.card)}>
      <ThreadMessage
        key={note.id}
        note={note}
        onMutate={onMutate}
        onReply={replying ? undefined : () => setReplying(true)}
      />
      {replies.map((reply) => (
        <ThreadMessage key={reply.id} note={reply} reply onMutate={onMutate} />
      ))}
      {replying && !replySaved && (
        <NoteComposer
          target={note}
          parentId={note.id}
          onSave={async (reply) => {
            setPendingReply({
              text: reply.text,
              previousIds: new Set(replies.map((item) => item.id)),
            });
            try {
              await onMutate({ type: "add", note: reply });
            } catch (error) {
              setPendingReply(null);
              throw error;
            }
          }}
          onCancel={() => {
            setPendingReply(null);
            setReplying(false);
          }}
        />
      )}
    </article>
  );
}

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    marginBlock: 8,
    marginInline: 10,
    maxWidth: 760,
    padding: 16,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.border, ":focus-within": tokens.muted },
    borderRadius: 12,
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 13,
  },
  embedded: {
    borderWidth: 0,
    borderTopWidth: 1,
    borderRadius: 0,
    margin: 0,
    marginTop: 12,
    paddingInline: 0,
    paddingBottom: 0,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 28,
    color: tokens.muted,
  },
  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
    flexShrink: 0,
    borderRadius: "50%",
    color: tokens.canvas,
    backgroundColor: tokens.muted,
    fontSize: 11,
  },
  location: { color: tokens.muted, fontSize: 12, textAlign: "right" },
  // Use identical text geometry for drafts, edits, and saved comments.
  content: {
    boxSizing: "border-box",
    minWidth: 0,
    width: "100%",
    minHeight: 76,
    margin: 0,
    paddingBlock: 14,
    paddingInline: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 400,
    lineHeight: "22px",
    letterSpacing: "normal",
  },
  editorBody: { display: "grid" },
  mirror: { gridRowStart: 1, gridColumnStart: 1, visibility: "hidden", pointerEvents: "none" },
  textarea: {
    gridRowStart: 1,
    gridColumnStart: 1,
    height: "100%",
    resize: "none",
    overflow: "hidden",
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    outline: "none",
  },
  actions: { display: "flex", alignItems: "center", gap: 6, minHeight: 30 },
  hint: { fontSize: 10, color: tokens.faint },
  smallButton: { minHeight: 30, paddingBlock: 3, fontSize: 12 },
  submit: {
    minHeight: 30,
    paddingBlock: 3,
    paddingInline: 14,
    borderRadius: 9,
    fontSize: 12,
    fontWeight: 600,
    color: tokens.canvas,
    backgroundColor: tokens.text,
    opacity: { default: 1, ":hover": 0.85, ":disabled": 0.45 },
  },
  reply: {
    marginTop: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  stale: { color: tokens.warning, fontSize: 11, lineHeight: 1.6, marginBlock: 5 },
  error: { color: tokens.red, fontSize: 11, marginBlock: 5 },
});
