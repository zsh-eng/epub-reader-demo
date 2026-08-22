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
import { motion, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

const LONG_PRESS_HOLD_MS = 200;
const LONG_PRESS_POP_MS = 150;
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
  const prefersReducedMotion = useReducedMotion();
  const [pressPhase, setPressPhase] = useState<LongPressPhase>("idle");
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sheetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const clearLongPressTimers = useCallback(() => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (sheetTimerRef.current) clearTimeout(sheetTimerRef.current);
    holdTimerRef.current = null;
    sheetTimerRef.current = null;
  }, []);

  const cancelLongPress = useCallback(() => {
    clearLongPressTimers();
    startPointRef.current = null;
    didLongPressRef.current = false;
    setPressPhase("idle");
  }, [clearLongPressTimers]);

  useEffect(() => () => clearLongPressTimers(), [clearLongPressTimers]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;

    clearLongPressTimers();
    didLongPressRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    setPressPhase("pressing");
    document.getSelection()?.removeAllRanges();

    holdTimerRef.current = setTimeout(() => {
      holdTimerRef.current = null;
      if (!startPointRef.current) return;

      didLongPressRef.current = true;
      startPointRef.current = null;
      setPressPhase("popping");
      document.getSelection()?.removeAllRanges();
      navigator.vibrate?.(10);

      // Preserve the old library interaction: the cover grows past rest first,
      // then the sheet enters after that pop has become visible.
      const sheetDelay = prefersReducedMotion ? 0 : LONG_PRESS_POP_MS;
      sheetTimerRef.current = setTimeout(() => {
        sheetTimerRef.current = null;
        setPressPhase("settling");
        onOpenMobileActions();
      }, sheetDelay);
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
    const transform =
      pressPhase === "pressing"
        ? "scale(0.96)"
        : pressPhase === "popping"
          ? "scale(1.05)"
          : "scale(1)";
    const transition =
      pressPhase === "pressing"
        ? { duration: 0.2, ease: "linear" as const }
        : pressPhase === "popping"
          ? { duration: 0.15, ease: [0.23, 1, 0.32, 1] as const }
          : pressPhase === "settling"
            ? { type: "spring" as const, duration: 0.3, bounce: 0.25 }
            : { duration: 0.15, ease: [0.23, 1, 0.32, 1] as const };

    return (
      <motion.div
        className="min-w-0 touch-pan-y select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]"
        data-long-press-phase={pressPhase}
        initial={false}
        animate={
          prefersReducedMotion
            ? {
                opacity: pressPhase === "pressing" ? 0.82 : 1,
                transform: "scale(1)",
              }
            : { opacity: 1, transform }
        }
        transition={
          prefersReducedMotion
            ? { duration: 0.1, ease: [0.23, 1, 0.32, 1] }
            : transition
        }
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={() => {
          if (didLongPressRef.current) return;
          cancelLongPress();
        }}
        onPointerCancel={() => {
          if (didLongPressRef.current) return;
          cancelLongPress();
        }}
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
      </motion.div>
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
