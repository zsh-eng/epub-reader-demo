import { READING_STATUS_OPTIONS } from "@/components/BookStatusSheet";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import type { ReadingStatus } from "@/lib/db";
import { Check, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

interface BookCardActionsProps {
  children: ReactElement;
  status: ReadingStatus | null;
  isUpdating: boolean;
  onSelectStatus: (status: ReadingStatus) => void;
  onRemove: () => boolean;
}

/** Keeps precise pointer-only actions on desktop without hiding mobile actions
 * behind a long-press gesture. Mobile reading status lives in reader tools. */
export function BookCardActions({
  children,
  status,
  isUpdating,
  onSelectStatus,
  onRemove,
}: BookCardActionsProps) {
  const isMobile = useIsMobile();

  if (isMobile) return children;

  return (
    <ContextMenu>
      <ContextMenuTrigger render={children} />
      <ContextMenuContent className="w-[220px]">
        {READING_STATUS_OPTIONS.map((option) => (
          <ContextMenuItem
            key={option.value}
            disabled={isUpdating}
            onClick={() => onSelectStatus(option.value)}
          >
            <option.icon className="size-4" />
            {option.label}
            {status === option.value && <Check className="ml-auto size-4" />}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={onRemove}
          disabled={isUpdating}
        >
          <Trash2 className="size-4" />
          Remove Book
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
