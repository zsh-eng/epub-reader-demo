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
import {
  useCallback,
  useEffect,
  useRef,
  type ReactElement,
  type TouchEvent as ReactTouchEvent,
} from "react";

const LONG_PRESS_HOLD_MS = 500;
const LONG_PRESS_POP_MS = 150;
const SHEET_OPEN_AFTER_RELEASE_MS = 50;
const LONG_PRESS_SLOP_PX = 10;

type LongPressPhase = "pressing" | "popping" | "settling";

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
  const triggerRef = useRef<HTMLDivElement>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const touchIsActiveRef = useRef(false);
  const gestureCommittedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const commitStartedAtRef = useRef(0);

  const setVisualPhase = useCallback((phase: LongPressPhase | null) => {
    if (!triggerRef.current) return;

    if (phase) {
      triggerRef.current.dataset.longPressState = phase;
      return;
    }

    delete triggerRef.current.dataset.longPressState;
  }, []);

  const releaseSelectionLock = useCallback(() => {
    document.body.classList.remove("library-long-press-active");
    document.getSelection()?.removeAllRanges();
  }, []);

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
    touchIsActiveRef.current = false;
    gestureCommittedRef.current = false;
    suppressClickRef.current = false;
    commitStartedAtRef.current = 0;
    setVisualPhase(null);
    releaseSelectionLock();
  }, [clearLongPressTimers, releaseSelectionLock, setVisualPhase]);

  useEffect(() => {
    return () => {
      clearLongPressTimers();
      releaseSelectionLock();
    };
  }, [clearLongPressTimers, releaseSelectionLock]);

  const openSheetAfterRelease = useCallback(() => {
    if (!gestureCommittedRef.current) return;
    if (touchIsActiveRef.current) return;
    if (sheetTimerRef.current) return;

    const popElapsedMs = Date.now() - commitStartedAtRef.current;
    const popRemainingMs = Math.max(0, LONG_PRESS_POP_MS - popElapsedMs);
    sheetTimerRef.current = setTimeout(() => {
      sheetTimerRef.current = null;
      gestureCommittedRef.current = false;
      commitStartedAtRef.current = 0;
      document.getSelection()?.removeAllRanges();
      setVisualPhase(null);
      onOpenMobileActions();
      releaseSelectionLock();
    }, popRemainingMs + SHEET_OPEN_AFTER_RELEASE_MS);
  }, [onOpenMobileActions, releaseSelectionLock, setVisualPhase]);

  const handleTouchStart = (event: ReactTouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1) return;

    clearLongPressTimers();
    touchIsActiveRef.current = true;
    gestureCommittedRef.current = false;
    suppressClickRef.current = false;
    commitStartedAtRef.current = 0;
    const touch = event.touches[0];
    startPointRef.current = { x: touch.clientX, y: touch.clientY };
    setVisualPhase("pressing");
    document.body.classList.add("library-long-press-active");
    document.getSelection()?.removeAllRanges();

    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (!touchIsActiveRef.current || !startPointRef.current) return;

      gestureCommittedRef.current = true;
      suppressClickRef.current = true;
      commitStartedAtRef.current = Date.now();
      startPointRef.current = null;
      setVisualPhase("popping");
      document.getSelection()?.removeAllRanges();
      navigator.vibrate?.(10);

      popTimerRef.current = setTimeout(() => {
        popTimerRef.current = null;
        setVisualPhase("settling");
      }, LONG_PRESS_POP_MS);
    }, LONG_PRESS_HOLD_MS);
  };

  const handleTouchMove = (event: ReactTouchEvent<HTMLDivElement>) => {
    const startPoint = startPointRef.current;
    const touch = event.touches[0];
    if (!startPoint || !touch) return;

    const movedX = Math.abs(touch.clientX - startPoint.x);
    const movedY = Math.abs(touch.clientY - startPoint.y);
    if (movedX > LONG_PRESS_SLOP_PX || movedY > LONG_PRESS_SLOP_PX) {
      cancelLongPress();
    }
  };

  if (isMobile) {
    return (
      <div
        ref={triggerRef}
        className="min-w-0 touch-pan-y select-none transform-gpu will-change-transform [transition-duration:150ms] [transition-property:transform,opacity] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none] data-[long-press-state=popping]:scale-[1.05] data-[long-press-state=pressing]:scale-[0.96] data-[long-press-state=pressing]:[transition-duration:450ms] data-[long-press-state=pressing]:[transition-timing-function:linear] motion-reduce:transform-none motion-reduce:data-[long-press-state=pressing]:opacity-80"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={(event) => {
          touchIsActiveRef.current = false;
          if (!gestureCommittedRef.current) {
            cancelLongPress();
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          startPointRef.current = null;
          document.getSelection()?.removeAllRanges();
          openSheetAfterRelease();
        }}
        onTouchCancel={cancelLongPress}
        onDragStart={(event) => event.preventDefault()}
        onContextMenuCapture={(event) => event.preventDefault()}
        onClickCapture={(event) => {
          if (!suppressClickRef.current) return;
          event.preventDefault();
          event.stopPropagation();
          suppressClickRef.current = false;
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
