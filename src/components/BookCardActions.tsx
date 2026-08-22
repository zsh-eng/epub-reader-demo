import {
  BookStatusSheet,
  READING_STATUS_OPTIONS,
} from "@/components/BookStatusSheet";
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
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

const LONG_PRESS_DELAY_MS = 500;
const LONG_PRESS_SLOP_PX = 10;

interface BookCardActionsProps {
  children: ReactElement;
  bookTitle: string;
  bookAuthor: string;
  coverUrl: string | undefined;
  status: ReadingStatus | null;
  isUpdating: boolean;
  onSelectStatus: (status: ReadingStatus) => void;
  onRemove: () => boolean;
}

/**
 * Keeps the precise desktop context menu and uses a native-feeling sheet on
 * mobile. The long press allows scrolling until the gesture has settled.
 */
export function BookCardActions({
  children,
  bookTitle,
  bookAuthor,
  coverUrl,
  status,
  isUpdating,
  onSelectStatus,
  onRemove,
}: BookCardActionsProps) {
  const isMobile = useIsMobile();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const cancelLongPress = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startPointRef.current = null;
  }, []);

  useEffect(() => cancelLongPress, [cancelLongPress]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;

    cancelLongPress();
    didLongPressRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    timerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      setIsSheetOpen(true);
      navigator.vibrate?.(10);
      cancelLongPress();
    }, LONG_PRESS_DELAY_MS);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startPoint = startPointRef.current;
    if (!startPoint) return;

    const movedX = Math.abs(event.clientX - startPoint.x);
    const movedY = Math.abs(event.clientY - startPoint.y);
    if (movedX > LONG_PRESS_SLOP_PX || movedY > LONG_PRESS_SLOP_PX) {
      cancelLongPress();
    }
  };

  if (isMobile) {
    return (
      <>
        <div
          className="min-w-0 touch-pan-y select-none [-webkit-touch-callout:none]"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={cancelLongPress}
          onPointerCancel={cancelLongPress}
          onContextMenu={(event) => event.preventDefault()}
          onClickCapture={(event) => {
            if (!didLongPressRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            didLongPressRef.current = false;
          }}
        >
          {children}
        </div>

        <BookStatusSheet
          open={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          bookTitle={bookTitle}
          bookAuthor={bookAuthor}
          coverUrl={coverUrl}
          status={status}
          isUpdating={isUpdating}
          onSelectStatus={onSelectStatus}
          onRemove={onRemove}
        />
      </>
    );
  }

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
