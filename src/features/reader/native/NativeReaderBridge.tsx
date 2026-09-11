import { useEffect, useMemo, useRef, useState } from "react";
import { postNative } from "@/features/native/runtime";
import { readNativeAppearance } from "@/features/native/appearance";
import type { NoteTarget } from "@/types/note";
import { useReaderNotes } from "../hooks/use-reader-notes";
import type {
  ReaderSessionActions,
  ReaderSessionResources,
  ReaderSessionState,
} from "../hooks/use-reader-session";
import type { ReaderStatusAction } from "../hooks/use-reader-status-prompt";
import { createNoteLocationResolver } from "../note-locations";
import { buildContentsModel } from "../ReaderContentsSheet";
import { readerCommandSchema, type ReaderCommand } from "./commands";
import { useReadingStatus } from "@/hooks/use-reading-status";
import { useSync } from "@/hooks/use-sync";

interface Props {
  bookId: string;
  state: ReaderSessionState;
  resources: ReaderSessionResources;
  actions: ReaderSessionActions;
  chromeVisible: boolean;
  quote: NoteTarget | null;
  onClearQuote(): void;
  onBack(): void;
  statusPrompt?: ReaderStatusAction;
}

/** Native presentation shares the web domain owner. Native keystrokes update
 * only this component; they do not render Reader or change its page geometry.
 * Commands are ordered and acknowledged so late snapshots cannot replace a
 * newer native draft. A new WebView lifetime gets a new session identity.
 */
export function NativeReaderBridge({
  bookId,
  state,
  resources,
  actions,
  chromeVisible,
  quote,
  onClearQuote,
  onBack,
  statusPrompt,
}: Props) {
  const notes = useReaderNotes(bookId);
  const readingStatus = useReadingStatus(bookId);
  const { deleteBook } = useSync();
  const deletedNotes = useRef(new Set<string>());
  const [session] = useState(() => crypto.randomUUID());
  const [acknowledged, acknowledge] = useState(0);
  const [openRequest, requestOpen] = useState(0);
  const [bridgeError, setBridgeError] = useState("");
  const { pagination, chapters, navigation } = state;
  const colors = useMemo(
    () => readNativeAppearance(state.settings.theme),
    [state.settings.theme],
  );
  const resolver = useMemo(
    () =>
      createNoteLocationResolver(
        chapters.entries,
        resources.chapterAccess,
        pagination.paginationConfig,
      ),
    [chapters.entries, resources.chapterAccess, pagination.paginationConfig],
  );
  const resolved = useMemo(
    () =>
      (pagination.spread ? notes.notes : []).map((note) => ({
        note,
        anchor: resolver.resolve(note.anchor),
      })),
    [notes.notes, resolver, pagination.spread],
  );
  const locateAnchors = resources.locateAnchors;
  useEffect(() => {
    locateAnchors(
      resolved.flatMap(({ note, anchor }) =>
        anchor ? [{ id: note.id, anchor }] : [],
      ),
    );
  }, [resolved, locateAnchors]);

  const handledQuote = useRef<NoteTarget | null>(null);
  useEffect(() => {
    if (
      !quote ||
      !notes.ready ||
      notes.saving ||
      handledQuote.current === quote
    )
      return;
    handledQuote.current = quote;
    notes.change(notes.draft?.content ?? "", quote);
    requestOpen((value) => value + 1);
    onClearQuote();
  }, [quote, notes, onClearQuote]);

  async function execute(command: ReaderCommand) {
    const target = notes.draft?.target ?? resolver.capture(pagination.spread);
    switch (command.action) {
      case "draft":
        if (!target)
          throw new Error("Wait for the page before writing a note.");
        notes.change(command.content, target);
        break;
      case "save":
        await notes.send();
        break;
      case "edit":
        if (
          notes.notes.some(
            (note) => note.id === command.id && note.kind === "note",
          )
        )
          await notes.edit(command.id);
        break;
      case "cancel-edit":
        await notes.cancelEdit();
        break;
      case "remove-quote":
        if (target && !notes.editingId)
          notes.change(notes.draft?.content ?? "", {
            kind: "page",
            anchor: target.anchor,
          });
        break;
      case "delete":
        if (
          notes.notes.some((note) => note.id === command.id) &&
          (await notes.remove(command.id))
        )
          deletedNotes.current.add(command.id);
        break;
      case "undo":
        if (deletedNotes.current.has(command.id)) {
          await notes.restore(command.id);
          deletedNotes.current.delete(command.id);
        }
        break;
      case "visit": {
        const page = pagination.anchorPages[command.id];
        if (pagination.status === "ready" && page) actions.commitPage(page);
        break;
      }
      case "close":
        await notes.flush();
        break;
      case "back":
        await notes.flush();
        onBack();
        break;
      case "next":
        actions.nextSpread();
        break;
      case "previous":
        actions.prevSpread();
        break;
      case "start-reading":
        statusPrompt?.onConfirm();
        break;
      case "page":
        if (
          pagination.status === "ready" &&
          command.page <= navigation.totalPages
        )
          actions.commitPage(command.page);
        break;
      case "chapter":
        if (contents.some((item) => item.href === command.href))
          actions.openInternalHref(command.href);
        break;
      case "settings":
        actions.updateSettings(command.patch);
        break;
      case "reading-status":
        await readingStatus.setStatusAsync(command.status);
        break;
      case "remove-book":
        await notes.flush();
        await deleteBook(bookId);
        onBack();
        break;
    }
  }
  const executeRef = useRef(execute);
  executeRef.current = execute;
  useEffect(() => {
    let lastSequence = 0;
    let active = true;
    let queue = Promise.resolve();
    const receive = (event: Event) => {
      const parsed = readerCommandSchema.safeParse(
        (event as MessageEvent).data,
      );
      if (!parsed.success) return;
      const message = parsed.data;
      if (
        message.bookId !== bookId ||
        message.session !== session ||
        message.sequence <= lastSequence
      )
        return;
      lastSequence = message.sequence;
      queue = queue.then(async () => {
        if (!active) return;
        try {
          setBridgeError("");
          await executeRef.current(message.command);
        } catch (error) {
          setBridgeError(
            error instanceof Error
              ? error.message
              : "Could not complete this action.",
          );
        }
        if (active) acknowledge(message.sequence);
      });
    };
    window.addEventListener("reader-native", receive);
    return () => {
      active = false;
      window.removeEventListener("reader-native", receive);
    };
  }, [bookId, session]);

  const contents = useMemo(
    () =>
      buildContentsModel(
        state.book?.toc ?? [],
        chapters.entries,
        navigation.chapterStartPages,
      ).items.map((item) => ({
        id: item.id,
        title: item.label,
        href: item.href,
        depth: item.depth,
        page: item.page ?? 0,
      })),
    [state.book?.toc, chapters.entries, navigation.chapterStartPages],
  );
  const edited = notes.notes.find((note) => note.id === notes.editingId);
  const target = notes.draft?.target;
  const quoteText =
    edited?.kind === "note" && edited.quote
      ? edited.quote.text
      : target?.kind === "highlight"
        ? target.quote.text
        : target?.kind === "selection"
          ? target.text
          : "";
  const snapshot = JSON.stringify({
    session,
    bookId,
    acknowledged,
    openRequest,
    chromeVisible,
    title: state.book?.title ?? "Reader",
    author: state.book?.author ?? "",
    page: navigation.currentPage,
    totalPages: navigation.totalPages,
    canGoNext: navigation.canGoNext,
    canGoPrevious: navigation.canGoPrev,
    paginationReady: pagination.status === "ready",
    chapter: chapters.entries[navigation.currentChapterIndex]?.title ?? "",
    settings: state.settings,
    colors,
    contents,
    startLabel: statusPrompt?.actionLabel ?? "",
    startPending: statusPrompt?.isPending ?? false,
    readingStatus: readingStatus.status ?? "",
    statusPending: readingStatus.isLoading || readingStatus.isUpdating,
    error: bridgeError || notes.error || statusPrompt?.error || "",
    draft: {
      content: notes.draft?.content ?? "",
      quote: quoteText,
      editingId: notes.editingId ?? "",
      ready: notes.ready,
      saving: notes.saving,
    },
    notes: resolved.map(({ note, anchor }) => ({
      id: note.id,
      text: note.kind === "note" ? note.content : "Bookmark",
      kind: note.kind,
      quote: note.kind === "note" ? (note.quote?.text ?? "") : "",
      chapter:
        chapters.entries.find(
          (chapter) => chapter.spineItemId === note.anchor.spineItemId,
        )?.title ?? "Unknown chapter",
      page:
        anchor && pagination.status === "ready"
          ? (pagination.anchorPages[note.id] ?? 0)
          : 0,
      createdAt: note.createdAt,
    })),
  });
  useEffect(() => {
    postNative({ type: "reader-state", state: JSON.parse(snapshot) });
  }, [snapshot]);
  return null;
}
