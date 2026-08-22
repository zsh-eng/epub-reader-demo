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
import { cn } from "@/lib/utils";
import { Check, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

const LONG_PRESS_HOLD_MS = 500;
const LONG_PRESS_POP_MS = 150;
const SHEET_OPEN_AFTER_RELEASE_MS = 50;
const LONG_PRESS_SLOP_PX = 10;

type LongPressPhase = "idle" | "pressing" | "popping" | "settling";

interface BookCardActionsProps {
  children: ReactElement;
  status: ReadingStatus | null;
  isUpdating: boolean;
  onSelectStatus: (status: ReadingStatus) => void;
  onRemove: () => boolean;
  onOpenMobileActions: () => void;
}

/**
 * Keeps the precise desktop context menu and uses a native-feeling sheet on
 * mobile. The long press allows scrolling until the gesture has settled.
 */
export function BookCardActions({
  children,
  status,
  isUpdating,
  onSelectStatus,
  onRemove,
  onOpenMobileActions,
}: BookCardActionsProps) {
  const isMobile = useIsMobile();
  const [pressPhase, setPressPhase] = useState<LongPressPhase>("idle");
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIsDownRef = useRef(false);
  const gestureCommittedRef = useRef(false);
  const popCompletedRef = useRef(false);
  const sheetOpenScheduledRef = useRef(false);
  const didLongPressRef = useRef(false);

  const clearLongPressTimers = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (popTimerRef.current) clearTimeout(popTimerRef.current);
    if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
    holdTimerRef.current = null;
    popTimerRef.current = null;
    sheetTimerRef.current = null;
  }, []);

  const cancelLongPress = useCallback(() => {
    clearLongPressTimers();
    startPointRef.current = null;
    pointerIsDownRef.current = false;
    gestureCommittedRef.current = false;
    popCompletedRef.current = false;
    sheetOpenScheduledRef.current = false;
    didLongPressRef.current = false;
    setPressPhase("idle");
  }, [clearLongPressTimers]);

  useEffect(() => () => clearLongPressTimers(), [clearLongPressTimers]);

  const openSheetIfReady = useCallback(() => {
    if (!gestureCommittedRef.current) return;
    if (!popCompletedRef.current) return;
    if (pointerIsDownRef.current) return;
    if (sheetOpenScheduledRef.current) return;

    sheetOpenScheduledRef.current = true;
    // Wait until the synthetic touch click has finished before mounting a
    // sheet beneath the release point.
    sheetTimerRef.current = setTimeout(() => {
      sheetTimerRef.current = null;
      document.getSelection()?.removeAllRanges();
      setPressPhase("settling");
      onOpenMobileActions();
    }, SHEET_OPEN_AFTER_RELEASE_MS);
  }, [onOpenMobileActions]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;

    clearLongPressTimers();
    pointerIsDownRef.current = true;
    gestureCommittedRef.current = false;
    popCompletedRef.current = false;
    sheetOpenScheduledRef.current = false;
    didLongPressRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    setPressPhase("pressing");
    document.getSelection()?.removeAllRanges();

    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (!startPointRef.current) return;

      gestureCommittedRef.current = true;
      didLongPressRef.current = true;
      startPointRef.current = null;
      setPressPhase("popping");
      document.getSelection()?.removeAllRanges();
      navigator.vibrate?.(10);

      popTimerRef.current = setTimeout(() => {
        popTimerRef.current = null;
        popCompletedRef.current = true;
        openSheetIfReady();
      }, LONG_PRESS_POP_MS);
    }, LONG_PRESS_HOLD_MS);
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
      <div
        className={cn(
          "min-w-0 touch-pan-y select-none transform-gpu transition-transform will-change-transform",
          "[-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]",
          "motion-reduce:transform-none motion-reduce:transition-opacity",
          pressPhase === "pressing" && "scale-[0.96] motion-reduce:opacity-80",
          pressPhase === "popping" && "scale-[1.05]",
        )}
        data-long-press-phase={pressPhase}
        style={{
          transitionDuration: pressPhase === "pressing" ? "450ms" : "150ms",
          transitionTimingFunction:
            pressPhase === "pressing"
              ? "linear"
              : "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          pointerIsDownRef.current = false;
          if (!gestureCommittedRef.current) {
            cancelLongPress();
            return;
          }

          document.getSelection()?.removeAllRanges();
          openSheetIfReady();
        }}
        onPointerCancel={cancelLongPress}
        onDragStart={(event) => event.preventDefault()}
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
