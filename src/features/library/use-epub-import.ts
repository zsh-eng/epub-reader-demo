import { DuplicateBookDialog } from "./DuplicateBookDialog";
import { useToast } from "@/hooks/use-toast";
import { markEpubPreparationReady } from "@/hooks/use-epub-processor";
import { addBookFromFile, DuplicateBookError } from "@/lib/book-service";
import type { Book } from "@/lib/db";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

/** Compact batch feedback keeps added, skipped, and failed counts distinct. */
function importFeedback(
  added: number,
  duplicates: number,
  failed: number,
  ignored: number,
): string {
  const skipped = duplicates + ignored;
  if (!added && !failed)
    return ignored
      ? `Skipped ${skipped} files.`
      : `Skipped ${duplicates} existing book${duplicates === 1 ? "" : "s"}.`;
  if (!skipped && !failed)
    return `Added ${added} book${added === 1 ? "" : "s"}.`;
  if (!added && !skipped)
    return `Could not add ${failed} book${failed === 1 ? "" : "s"}.`;
  const parts = [
    added && `added ${added}`,
    skipped && `skipped ${skipped}`,
    failed && `failed ${failed}`,
  ]
    .filter(Boolean)
    .join("; ");
  return `${parts[0].toUpperCase()}${parts.slice(1)}.`;
}

interface EpubImportContextValue {
  isProcessing: boolean;
  importFiles: (files: FileList | readonly File[]) => Promise<void>;
  openFilePicker: () => void;
}

const EpubImportContext = createContext<EpubImportContextValue | null>(null);

/**
 * Coordinates EPUB imports for both the persistent sidebar and Library drop
 * target. Successful imports return to the Library and refresh its local query.
 */
export function EpubImportProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [duplicateBook, setDuplicateBook] = useState<Book | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  const importFiles = useCallback(
    async (files: FileList | readonly File[]) => {
      if (isProcessing || files.length === 0) return;

      const allFiles = Array.from(files);
      const epubFiles = allFiles.filter((file) =>
        file.name.toLowerCase().endsWith(".epub"),
      );
      const nonEpubCount = allFiles.length - epubFiles.length;

      if (epubFiles.length === 0) {
        toast({
          message: "Only EPUB files can be added.",
          variant: "destructive",
        });
        return;
      }

      setIsProcessing(true);

      let successCount = 0;
      let lastImportedBook: Book | null = null;
      let duplicateCount = 0;
      let errorCount = 0;
      let lastDuplicateBook: Book | null = null;

      try {
        for (const file of epubFiles) {
          try {
            const importedBook = await addBookFromFile(file);
            markEpubPreparationReady(queryClient, importedBook);
            successCount += 1;
            lastImportedBook = importedBook;
          } catch (error) {
            console.error("Error adding book:", error);
            if (error instanceof DuplicateBookError) {
              duplicateCount += 1;
              lastDuplicateBook = error.existingBook;
            } else {
              errorCount += 1;
            }
          }
        }

        const message = importFeedback(
          successCount,
          duplicateCount,
          errorCount,
          nonEpubCount,
        );

        if (successCount > 0) {
          await queryClient.invalidateQueries({ queryKey: ["books"] });
          navigate("/");
          const bookToOpen = successCount === 1 ? lastImportedBook : null;
          toast({
            message,
            ...(bookToOpen
              ? {
                  duration: 10000,
                  action: {
                    label: "Open book",
                    onClick: () => navigate(`/reader/${bookToOpen.id}`),
                  },
                }
              : {}),
          });
          return;
        }

        if (
          duplicateCount === 1 &&
          epubFiles.length === 1 &&
          lastDuplicateBook
        ) {
          setDuplicateBook(lastDuplicateBook);
          setShowDuplicateDialog(true);
          return;
        }

        if (duplicateCount > 0 && errorCount === 0) {
          toast({
            message,
          });
          return;
        }

        toast({
          message,
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, navigate, queryClient, toast],
  );

  const openFilePicker = useCallback(() => {
    if (isProcessing) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".epub";
    input.multiple = true;
    input.style.position = "absolute";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    const removeInput = () => {
      if (input.isConnected) input.remove();
    };

    input.onchange = () => {
      if (input.files) void importFiles(input.files);
      removeInput();
    };
    input.addEventListener("cancel", removeInput, { once: true });
    input.click();
  }, [importFiles, isProcessing]);

  const value = useMemo<EpubImportContextValue>(
    () => ({ isProcessing, importFiles, openFilePicker }),
    [importFiles, isProcessing, openFilePicker],
  );

  return createElement(
    EpubImportContext.Provider,
    { value },
    children,
    duplicateBook
      ? createElement(DuplicateBookDialog, {
          open: showDuplicateDialog,
          onOpenChange: setShowDuplicateDialog,
          existingBook: duplicateBook,
        })
      : null,
  );
}

export function useEpubImport(): EpubImportContextValue {
  const context = useContext(EpubImportContext);
  if (!context) {
    throw new Error("useEpubImport must be used within EpubImportProvider");
  }
  return context;
}
