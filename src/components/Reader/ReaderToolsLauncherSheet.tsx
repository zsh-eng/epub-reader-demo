import { ReaderControlMenu } from "./ReaderControlMenu";
import { ReaderSheet } from "./shared/ReaderSheet";

interface ReaderToolsLauncherSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenContents: () => void;
  onOpenSettings: () => void;
}

/**
 * Lightweight command launcher for reader-level overlays.
 *
 * The destination sheets are siblings owned by ReaderSheetHost, so this sheet
 * stays focused on choosing the next reader tool instead of managing a stack.
 */
export function ReaderToolsLauncherSheet({
  isOpen,
  onClose,
  onOpenContents,
  onOpenSettings,
}: ReaderToolsLauncherSheetProps) {
  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          return;
        }

        onClose();
      }}
      title="Reader Tools"
      panelClassName="max-w-md"
    >
      <ReaderControlMenu
        onOpenContents={onOpenContents}
        onOpenSettings={onOpenSettings}
      />
    </ReaderSheet>
  );
}
