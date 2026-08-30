import { DuplicateBookDialog } from "@/components/DuplicateBookDialog";
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
          title: "Invalid files",
          description: "Please select EPUB files only",
          variant: "destructive",
        });
        return;
      }

      setIsProcessing(true);

      let successCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      let lastDuplicateBook: Book | null = null;

      try {
        for (const file of epubFiles) {
          try {
            const importedBook = await addBookFromFile(file);
            markEpubPreparationReady(
              queryClient,
              importedBook.id,
              importedBook.sourceFileId,
            );
            successCount += 1;
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

        const summary: string[] = [];
        if (successCount > 0) {
          summary.push(
            `${successCount} book${successCount > 1 ? "s" : ""} added`,
          );
        }
        if (duplicateCount > 0) {
          summary.push(`${duplicateCount} skipped (already in library)`);
        }
        if (errorCount > 0) {
          summary.push(`${errorCount} failed`);
        }
        if (nonEpubCount > 0) {
          summary.push(
            `${nonEpubCount} non-EPUB file${nonEpubCount > 1 ? "s" : ""} ignored`,
          );
        }

        if (successCount > 0) {
          await queryClient.invalidateQueries({ queryKey: ["books"] });
          navigate("/");
          toast({ title: "Import complete", description: summary.join(" · ") });
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

        toast({
          title: "Import failed",
          description: summary.join(" · "),
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
