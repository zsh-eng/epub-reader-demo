import {
  deleteNote as deleteNoteFromDb,
  getChapterNotes,
  getNotesByAnnotation,
  updateNote as updateNoteInDb,
  type Note,
} from "@/lib/db";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * Query keys for notes
 */
export const noteKeys = {
  all: ["notes"] as const,
  annotation: (annotationId: string) =>
    [...noteKeys.all, "annotation", annotationId] as const,
  chapter: (bookId: string, spineItemId: string) =>
    [...noteKeys.all, "chapter", bookId, spineItemId] as const,
};

/**
 * Hook for fetching notes for a specific annotation (highlight)
 */
export function useNotesQuery(annotationId: string | undefined) {
  return useQuery({
    queryKey: noteKeys.annotation(annotationId ?? ""),
    queryFn: () => getNotesByAnnotation(annotationId!),
    enabled: !!annotationId,
  });
}

/**
 * Hook for fetching chapter-level notes
 */
export function useChapterNotesQuery(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  return useQuery({
    queryKey: noteKeys.chapter(bookId ?? "", spineItemId ?? ""),
    queryFn: () => getChapterNotes(bookId!, spineItemId!),
    enabled: !!bookId && !!spineItemId,
  });
}

/**
 * Hook for updating a note
 */
export function useUpdateNoteMutation(annotationId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = noteKeys.annotation(annotationId ?? "");

  return useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      await updateNoteInDb(id, content);
      return { id, content };
    },
    onMutate: async ({ id, content }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousNotes = queryClient.getQueryData<Note[]>(queryKey);
      queryClient.setQueryData<Note[]>(queryKey, (old = []) =>
        old.map((n) => (n.id === id ? { ...n, content } : n)),
      );
      return { previousNotes };
    },
    onError: (err, _variables, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(queryKey, context.previousNotes);
      }
      console.error("Failed to update note:", err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

/**
 * Hook for deleting a note
 */
export function useDeleteNoteMutation(annotationId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = noteKeys.annotation(annotationId ?? "");

  return useMutation({
    mutationFn: async (noteId: string) => {
      await deleteNoteFromDb(noteId);
      return noteId;
    },
    onMutate: async (noteId) => {
      await queryClient.cancelQueries({ queryKey });
      const previousNotes = queryClient.getQueryData<Note[]>(queryKey);
      queryClient.setQueryData<Note[]>(queryKey, (old = []) =>
        old.filter((n) => n.id !== noteId),
      );
      return { previousNotes };
    },
    onError: (err, _noteId, context) => {
      if (context?.previousNotes) {
        queryClient.setQueryData(queryKey, context.previousNotes);
      }
      console.error("Failed to delete note:", err);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}
