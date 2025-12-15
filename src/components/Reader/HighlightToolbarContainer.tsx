import { HighlightToolbar } from "@/components/HighlightToolbar";
import { MobileHighlightBar } from "@/components/Reader/MobileHighlightBar";
import {
  useDeleteHighlightMutation,
  useUpdateHighlightMutation,
} from "@/hooks/use-highlights-query";
import { useIsMobile } from "@/hooks/use-mobile";
import type { HighlightColor } from "@/lib/highlight-constants";
import type { Highlight } from "@/types/highlight";
import { AnimatePresence } from "motion/react";
import type { ActiveHighlightState } from ".";

interface HighlightToolbarContainerProps {
  bookId: string | undefined;
  spineItemId: string | undefined;
  highlights: Highlight[];

  // For creating new highlights (text selection mode)
  isCreatingHighlight: boolean;
  creationPosition: { x: number; y: number };
  onCreateColorSelect: (color: HighlightColor) => void;
  onCreateClose: () => void;

  // For editing existing highlights
  activeHighlight: ActiveHighlightState | null;
  onEditClose: () => void;

  // Mobile-specific
  isNavVisible?: boolean;
}

export function HighlightToolbarContainer({
  bookId,
  spineItemId,
  highlights,
  isCreatingHighlight,
  creationPosition,
  onCreateColorSelect,
  onCreateClose,
  activeHighlight,
  onEditClose,
  isNavVisible = false,
}: HighlightToolbarContainerProps) {
  const isMobile = useIsMobile();

  // Get mutations for editing highlights
  const updateHighlightMutation = useUpdateHighlightMutation(
    bookId,
    spineItemId,
  );
  const deleteHighlightMutation = useDeleteHighlightMutation(
    bookId,
    spineItemId,
  );

  // Find the active highlight data
  const activeHighlightData = activeHighlight
    ? highlights.find((h) => h.id === activeHighlight.id)
    : null;
  const isEditingHighlight = !!activeHighlightData;

  // Handlers for editing mode
  const handleEditColorSelect = (color: HighlightColor) => {
    if (!activeHighlightData) return;

    updateHighlightMutation.mutate({
      id: activeHighlightData.id,
      changes: { color },
    });
  };

  const handleEditDelete = () => {
    if (!activeHighlightData) return;

    deleteHighlightMutation.mutate(activeHighlightData.id);
    onEditClose();
  };

  // Mobile rendering
  if (isMobile) {
    return (
      <AnimatePresence>
        {isEditingHighlight && (
          <MobileHighlightBar
            isNavVisible={isNavVisible}
            currentColor={activeHighlightData.color}
            onColorSelect={handleEditColorSelect}
            onDelete={handleEditDelete}
            onClose={onEditClose}
          />
        )}
        {isCreatingHighlight && (
          <MobileHighlightBar
            isNavVisible={isNavVisible}
            onColorSelect={onCreateColorSelect}
            onClose={onCreateClose}
          />
        )}
      </AnimatePresence>
    );
  }

  // Desktop rendering
  return (
    <>
      <AnimatePresence>
        {isCreatingHighlight && (
          <HighlightToolbar
            position={creationPosition}
            onColorSelect={onCreateColorSelect}
            onClose={onCreateClose}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isEditingHighlight && (
          <HighlightToolbar
            position={activeHighlight!.position}
            currentColor={activeHighlightData.color}
            onColorSelect={handleEditColorSelect}
            onDelete={handleEditDelete}
            onClose={onEditClose}
          />
        )}
      </AnimatePresence>
    </>
  );
}
