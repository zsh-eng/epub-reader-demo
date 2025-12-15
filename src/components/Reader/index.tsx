import { HighlightToolbar } from "@/components/HighlightToolbar";
import { LoadingSpinner } from "@/components/Reader/LoadingSpinner";
import { MobileHighlightBar } from "@/components/Reader/MobileHighlightBar";
import { MobileReaderNav } from "@/components/Reader/MobileReaderNav";
import { NavigationButtons } from "@/components/Reader/NavigationButtons";
import { ReaderSettingsBar } from "@/components/Reader/ReaderSettingsBar";
import { SideNavigation } from "@/components/Reader/SideNavigation";
import { TableOfContents } from "@/components/Reader/TableOfContents";
import ReaderContent from "@/components/ReaderContent";
import { ScrollRestoration } from "@/components/ScrollRestoration";
import { useBookLoader } from "@/hooks/use-book-loader";
import {
  getManifestItemHref,
  useChapterContent,
} from "@/hooks/use-chapter-content";
import { useChapterNavigation } from "@/hooks/use-chapter-navigation";
import { useHighlightDOMSync } from "@/hooks/use-highlight-dom-sync";
import {
  useAddHighlightMutation,
  useDeleteHighlightMutation,
  useHighlightsQuery,
  useUpdateHighlightMutation,
} from "@/hooks/use-highlights-query";
import { useKeyboardNavigation } from "@/hooks/use-keyboard-navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useScrollVisibility } from "@/hooks/use-scroll-visibility";
import { useTextSelection } from "@/hooks/use-text-selection";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import type { Highlight } from "@/types/highlight";
import { AnimatePresence } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Active highlight state - combines id and position into a single piece of state
 * to prevent impossible states (id without position or vice versa)
 */
interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

/**
 * Reader Component
 *
 * Main component for displaying and interacting with EPUB books.
 * This component orchestrates all the reader functionality including:
 * - Book loading and progress restoration
 * - Chapter navigation
 * - Table of contents
 * - Text selection and highlighting
 * - Reading progress auto-save (via ScrollRestoration)
 * - Keyboard navigation
 */
export function Reader() {
  // Route params
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  // Refs
  const contentRef = useRef<HTMLDivElement>(null);

  // Mobile detection
  const isMobile = useIsMobile();

  // Local state
  const [isTOCOpen, setIsTOCOpen] = useState(false);
  const [activeHighlight, setActiveHighlight] =
    useState<ActiveHighlightState | null>(null);

  // Load book and initial progress
  const { book, initialProgress, isLoading } = useBookLoader(bookId);

  // Chapter index state - initialized from saved progress or defaults to 0
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);

  // Initialize chapter index from saved progress when it loads
  useEffect(() => {
    if (initialProgress) {
      setCurrentChapterIndex(initialProgress.currentSpineIndex);
    }
  }, [initialProgress]);

  // Get current spine item ID
  const currentSpineItemId = book?.spine[currentChapterIndex]?.idref;

  // Highlights - TanStack Query for data, mutations for CRUD
  const { data: highlights = [] } = useHighlightsQuery(
    bookId,
    currentSpineItemId,
  );
  const addHighlightMutation = useAddHighlightMutation(
    bookId,
    currentSpineItemId,
  );
  const deleteHighlightMutation = useDeleteHighlightMutation(
    bookId,
    currentSpineItemId,
  );
  const updateHighlightMutation = useUpdateHighlightMutation(
    bookId,
    currentSpineItemId,
  );
  // Sync highlights to DOM - reactive side effect of data changes
  useHighlightDOMSync(contentRef, highlights);

  // Reader settings
  const { settings, updateSettings } = useReaderSettings();

  // Chapter content
  const manifestItemHref = getManifestItemHref(book, currentChapterIndex);
  const { chapterContent, isLoading: isChapterLoading } = useChapterContent(
    bookId,
    manifestItemHref,
  );

  // Text selection hook for creating new highlights
  const {
    showHighlightToolbar,
    toolbarPosition,
    handleHighlightColorSelect,
    handleCloseHighlightToolbar,
  } = useTextSelection(
    contentRef,
    bookId,
    currentSpineItemId,
    (highlight: Highlight) => {
      addHighlightMutation.mutate(highlight);
    },
  );

  // Chapter navigation
  const { goToPreviousChapter, goToNextChapter, goToChapterByHref } =
    useChapterNavigation(
      book,
      bookId,
      currentChapterIndex,
      setCurrentChapterIndex,
    );

  // Keyboard navigation
  useKeyboardNavigation(goToPreviousChapter, goToNextChapter, () =>
    navigate("/"),
  );

  // Scroll visibility for mobile nav
  const isVisible = useScrollVisibility();

  // Early returns
  if (isLoading || isChapterLoading) return <LoadingSpinner />;
  if (!book || !bookId) return null;

  // Derived state
  const activeHighlightData = highlights.find(
    (h) => h.id === activeHighlight?.id,
  );
  const currentChapterTitle = getChapterTitleFromSpine(
    book,
    currentChapterIndex,
  );
  const hasPreviousChapter = currentChapterIndex > 0;
  const hasNextChapter = currentChapterIndex < book.spine.length - 1;

  // Derived state for highlight toolbars
  const isEditingHighlight = !!(activeHighlight && activeHighlightData);
  const isCreatingHighlight = showHighlightToolbar && !isEditingHighlight;

  // Render
  return (
    <div className="flex flex-col min-h-screen">
      {/* Desktop Navigation */}
      {!isMobile && (
        <SideNavigation
          onBack={() => navigate("/")}
          onPrevious={goToPreviousChapter}
          onNext={goToNextChapter}
          hasPreviousChapter={hasPreviousChapter}
          hasNextChapter={hasNextChapter}
        />
      )}

      <TableOfContents
        toc={book.toc}
        isOpen={isTOCOpen}
        onOpenChange={setIsTOCOpen}
        onNavigate={goToChapterByHref}
      />

      <ScrollRestoration
        bookId={bookId}
        chapterIndex={currentChapterIndex}
        contentRef={contentRef}
        initialProgress={initialProgress}
        contentReady={!!chapterContent}
      >
        <ReaderContent
          content={chapterContent}
          chapterIndex={currentChapterIndex}
          title={currentChapterTitle}
          ref={contentRef}
          onHighlightClick={(highlightId, position) => {
            // If clicking the same highlight, close the popover (toggle behavior)
            if (activeHighlight?.id === highlightId) {
              setActiveHighlight(null);
            } else {
              // Open popover for the clicked highlight
              setActiveHighlight({ id: highlightId, position });
            }
          }}
          activeHighlightId={activeHighlight?.id ?? null}
          settings={settings}
        />
      </ScrollRestoration>

      {/* Desktop Settings Bar */}
      {!isMobile && (
        <ReaderSettingsBar
          settings={settings}
          onUpdateSettings={updateSettings}
        />
      )}

      {/* Mobile Navigation (includes settings drawer) */}
      {isMobile && (
        <MobileReaderNav
          isVisible={isVisible}
          settings={settings}
          onUpdateSettings={updateSettings}
          onBack={() => navigate("/")}
          onPrevious={goToPreviousChapter}
          onNext={goToNextChapter}
          hasPreviousChapter={hasPreviousChapter}
          hasNextChapter={hasNextChapter}
        />
      )}

      {/* Highlight Toolbars - Mobile uses bottom bar, Desktop uses floating toolbar */}
      {isMobile ? (
        <AnimatePresence>
          {isEditingHighlight && (
            <MobileHighlightBar
              isNavVisible={isVisible}
              currentColor={activeHighlightData.color}
              onColorSelect={(color) =>
                updateHighlightMutation.mutate({
                  id: activeHighlightData.id,
                  changes: { color },
                })
              }
              onDelete={() => {
                deleteHighlightMutation.mutate(activeHighlightData.id);
                setActiveHighlight(null);
              }}
              onClose={() => setActiveHighlight(null)}
            />
          )}
          {isCreatingHighlight && (
            <MobileHighlightBar
              isNavVisible={isVisible}
              onColorSelect={handleHighlightColorSelect}
              onClose={handleCloseHighlightToolbar}
            />
          )}
        </AnimatePresence>
      ) : (
        <>
          <AnimatePresence>
            {isCreatingHighlight && (
              <HighlightToolbar
                position={toolbarPosition}
                onColorSelect={handleHighlightColorSelect}
                onClose={handleCloseHighlightToolbar}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {isEditingHighlight && (
              <HighlightToolbar
                position={activeHighlight.position}
                currentColor={activeHighlightData.color}
                onColorSelect={(color) =>
                  updateHighlightMutation.mutate({
                    id: activeHighlightData.id,
                    changes: { color },
                  })
                }
                onDelete={() => {
                  deleteHighlightMutation.mutate(activeHighlightData.id);
                  setActiveHighlight(null);
                }}
                onClose={() => setActiveHighlight(null)}
              />
            )}
          </AnimatePresence>
        </>
      )}

      {/* Desktop Navigation Buttons */}
      {!isMobile && (
        <NavigationButtons
          currentChapterIndex={currentChapterIndex}
          totalChapters={book.spine.length}
          hasPreviousChapter={hasPreviousChapter}
          hasNextChapter={hasNextChapter}
          onPrevious={goToPreviousChapter}
          onNext={goToNextChapter}
        />
      )}
    </div>
  );
}
