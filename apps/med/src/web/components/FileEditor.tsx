import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { EditorState, StateEffect, StateField, Transaction } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  drawSelection,
  keymap,
  lineNumbers,
  highlightActiveLine,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  isolateHistory,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { vim, Vim, getCM } from "@replit/codemirror-vim";
import { getFiletypeFromFileName, resolveTheme } from "@pierre/diffs";
import { useTheme } from "../themes";
import type { EditorDraft, EditorDrafts } from "../data/editor-drafts";
import type { BrowseApi } from "../data/browse";
import SyntaxWorker from "../highlighting/editor.worker?worker";
import "./FileEditor.css";

const setColors = StateEffect.define<DecorationSet>();
const colors = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    value = value.map(transaction.changes);
    for (const effect of transaction.effects) if (effect.is(setColors)) value = effect.value;
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const actions = new WeakMap<
  object,
  { save: () => void; close: () => void; saveAndClose: () => void }
>();
Vim.defineEx("write", "w", (cm) => actions.get(cm)?.save());
Vim.defineEx("quit", "q", (cm) => actions.get(cm)?.close());
Vim.defineEx("wq", undefined, (cm) => actions.get(cm)?.saveAndClose());

export default function FileEditor({
  draft,
  drafts,
  write,
  onClose,
}: {
  draft: EditorDraft;
  drafts: EditorDrafts;
  write: NonNullable<BrowseApi["write"]>;
  onClose(): void;
}) {
  const { active } = useTheme();
  const body = useRef<HTMLDivElement>(null);
  const discardOnUnmount = useRef(false);
  const view = useRef<EditorView | null>(null);
  const [mode, setMode] = useState("NORMAL");
  const [confirm, setConfirm] = useState(false);
  const [syntaxError, setSyntaxError] = useState("");
  const latest = useRef({ write, onClose });
  useLayoutEffect(() => {
    latest.current = { write, onClose };
  });
  const save = async () => {
    if (draft.saving || !draft.dirty || !draft.state) return;
    const text = draft.state.sliceDoc();
    drafts.update(draft, { saving: true, error: null });
    drafts.notify();
    try {
      const result = await latest.current.write(
        draft.file.source,
        draft.file.path,
        draft.file.identity,
        text,
      );
      drafts.update(draft, {
        file: result,
        savedText: text,
        dirty: draft.state.sliceDoc() !== text,
      });
    } catch (error) {
      drafts.update(draft, { error: error instanceof Error ? error.message : String(error) });
    } finally {
      drafts.update(draft, { saving: false });
      drafts.notify();
    }
  };
  const callbacks = useRef({ save, close: () => {} });
  const close = () => {
    if (draft.saving) return;
    if (draft.dirty) {
      setConfirm(true);
      return;
    }
    drafts.update(draft, { editing: false });
    drafts.notify();
    latest.current.onClose();
  };
  useLayoutEffect(() => {
    callbacks.current = { save, close };
  });
  useLayoutEffect(() => {
    if (!body.current) return;
    const worker = new SyntaxWorker();
    let sequence = 0,
      stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let theme: Awaited<ReturnType<typeof resolveTheme>> | undefined;
    const schedule = (immediate = false) => {
      clearTimeout(timer);
      const id = ++sequence;
      timer = setTimeout(
        () => {
          if (!theme || stopped || !view.current) return;
          worker.postMessage({
            id,
            text: view.current.state.doc.toString(),
            language: getFiletypeFromFileName(draft.file.path),
            theme,
          });
        },
        immediate ? 0 : 100,
      );
    };
    let firstInsert = false,
      joinChange = false;
    const extensions = [
      EditorState.transactionFilter.of((transaction) => {
        if (
          !transaction.docChanged ||
          !transaction.isUserEvent("input") ||
          !view.current ||
          !getCM(view.current)?.state.vim?.insertMode
        )
          return transaction;
        const separate = firstInsert && !joinChange;
        firstInsert = false;
        return {
          changes: transaction.changes,
          selection: transaction.selection,
          effects: transaction.effects,
          scrollIntoView: transaction.scrollIntoView,
          annotations: [
            Transaction.userEvent.of("input.type.compose"),
            Transaction.time.of(transaction.annotation(Transaction.time) ?? Date.now()),
            ...(separate ? [isolateHistory.of("before")] : []),
          ],
        };
      }),
      vim(),
      history(),
      colors,
      lineNumbers(),
      drawSelection(),
      highlightActiveLine(),
      EditorState.lineSeparator.of(draft.savedText.includes("\r\n") ? "\r\n" : "\n"),
      EditorView.contentAttributes.of({
        "aria-label": `Edit ${draft.file.path}`,
        spellcheck: "false",
      }),
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            void callbacks.current.save();
            return true;
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      EditorView.updateListener.of((update) => {
        drafts.update(draft, { state: update.state });
        if (update.docChanged) {
          const dirty = update.state.sliceDoc() !== draft.savedText;
          if (dirty !== draft.dirty) {
            drafts.update(draft, { dirty });
            drafts.notify();
          }
          schedule();
        }
      }),
      EditorView.theme(
        {
          "&": {
            backgroundColor: active.palette.canvas,
            color: active.palette.text,
            fontSize: "12px",
          },
          ".cm-scroller": {
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            lineHeight: "20px",
            overflow: "auto",
          },
          ".cm-gutters": {
            backgroundColor: active.palette.canvas,
            color: active.palette.muted,
            border: "none",
          },
          ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: active.palette.hover },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: active.palette.text },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: active.palette.selected,
          },
          ".cm-panels": { backgroundColor: active.palette.panel, color: active.palette.text },
          "&.cm-focused": { outline: "none" },
        },
        { dark: active.appearance === "dark" },
      ),
    ];
    const state = draft.state
      ? draft.state.update({ effects: StateEffect.reconfigure.of(extensions) }).state
      : EditorState.create({ doc: draft.savedText, extensions });
    const editor = new EditorView({ state, parent: body.current });
    view.current = editor;
    drafts.update(draft, { state: editor.state });
    const cm = getCM(editor)!;
    actions.set(cm, {
      save: () => {
        void callbacks.current.save();
      },
      close: () => callbacks.current.close(),
      saveAndClose: () => {
        void callbacks.current.save().then(() => {
          if (!draft.dirty && !draft.error) callbacks.current.close();
        });
      },
    });
    // Reattaching a document starts a new Vim Normal-mode session.
    // oxlint-disable-next-line react/set-state-in-effect
    setMode("NORMAL");
    cm.on("vim-mode-change", (event: { mode: string }) => {
      if (event.mode === "insert") {
        firstInsert = true;
        joinChange = !!cm.curOp?.lastChange;
      }
      setMode(event.mode.toUpperCase());
    });
    if (draft.line) {
      const line = editor.state.doc.line(Math.max(1, Math.min(draft.line, editor.state.doc.lines)));
      const position = Math.min(line.to, line.from + Math.max(0, (draft.column ?? 1) - 1));
      editor.dispatch({
        selection: { anchor: position },
        effects: EditorView.scrollIntoView(position, { y: "center" }),
      });
      drafts.update(draft, { line: undefined });
    } else editor.scrollDOM.scrollTop = draft.scrollTop;
    editor.focus();
    if (draft.insertOnOpen) {
      Vim.handleKey(cm, "i", "user");
      drafts.update(draft, { insertOnOpen: false });
    }
    worker.onmessage = ({
      data,
    }: MessageEvent<{ id: number; styles: string[]; ranges: Uint32Array; error?: string }>) => {
      if (stopped || data.id !== sequence) return;
      if (data.error) {
        setSyntaxError("Syntax colors unavailable; editing and saving still work.");
        return;
      }
      const marks = data.styles.map((style) => Decoration.mark({ attributes: { style } }));
      const ranges = [];
      for (let i = 0; i < data.ranges.length; i += 3) {
        const [from, to, style] = data.ranges.subarray(i, i + 3);
        if (to <= editor.state.doc.length && from < to) ranges.push(marks[style].range(from, to));
      }
      editor.dispatch({ effects: setColors.of(Decoration.set(ranges, true)) });
      setSyntaxError("");
    };
    worker.onerror = () =>
      setSyntaxError("Syntax colors unavailable; editing and saving still work.");
    void resolveTheme(active.pierreTheme)
      .then((result) => {
        if (!stopped) {
          theme = result;
          schedule(true);
        }
      })
      .catch(() => setSyntaxError("Syntax colors unavailable; editing and saving still work."));
    return () => {
      stopped = true;
      clearTimeout(timer);
      worker.terminate();
      actions.delete(cm);
      drafts.update(draft, {
        state: discardOnUnmount.current ? undefined : editor.state,
        scrollTop: editor.scrollDOM.scrollTop,
      });
      view.current = null;
      editor.destroy();
    };
  }, [draft, drafts, active]);

  return (
    <section
      className="med-editor"
      aria-label="File editor"
      style={
        {
          "--edit-bg": active.palette.canvas,
          "--edit-fg": active.palette.text,
          "--edit-muted": active.palette.muted,
          "--edit-border": active.palette.border,
        } as CSSProperties
      }
    >
      <header className="med-editor-header">
        <span
          className="med-save-dot"
          data-dirty={draft.dirty}
          role="img"
          aria-label={draft.dirty ? "Unsaved changes" : "Saved"}
          title={draft.dirty ? "Unsaved changes" : "Saved"}
          style={{ color: draft.dirty ? active.palette.warning : active.palette.muted }}
        />
        <span className="med-editor-path" title={draft.file.path}>
          {draft.file.path}
        </span>
        <span className="med-editor-mode" aria-live="polite">
          {mode}
        </span>
        <button onClick={() => void save()} disabled={!draft.dirty || draft.saving}>
          Save
        </button>
        <button onClick={close} disabled={draft.saving}>
          Done
        </button>
      </header>
      {draft.error && (
        <div role="alert" className="med-editor-message">
          {draft.error}
        </div>
      )}
      {syntaxError && (
        <div role="status" className="med-editor-message">
          {syntaxError}
        </div>
      )}
      {confirm && (
        <div className="med-editor-message">
          Your draft has unsaved changes.{" "}
          <button onClick={() => setConfirm(false)}>Keep editing</button>{" "}
          <button
            onClick={() => {
              discardOnUnmount.current = true;
              drafts.update(draft, { state: undefined, dirty: false, editing: false, error: null });
              drafts.notify();
              latest.current.onClose();
            }}
          >
            Discard draft
          </button>
        </div>
      )}
      <div ref={body} className="med-editor-body" />
    </section>
  );
}
