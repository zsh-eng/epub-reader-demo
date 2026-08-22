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
import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

const LONG_PRESS_HOLD_MS = 200;
const LONG_PRESS_COMPRESSION_MS = 100;
const LONG_PRESS_SLOP_PX = 10;

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
  const pressControls = useAnimationControls();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const didLongPressRef = useRef(false);

  const clearLongPressTracking = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startPointRef.current = null;
  }, []);

  const animateToRest = useCallback(
    (withPop: boolean) => {
      if (prefersReducedMotion) {
        void pressControls.start({
          opacity: 1,
          transition: { duration: 0.1, ease: "easeOut" },
        });
        return;
      }

      void pressControls.start({
        transform: "scale(1)",
        transition: {
          type: "spring",
          duration: withPop ? 0.3 : 0.16,
          bounce: withPop ? 0.25 : 0,
        },
      });
    },
    [prefersReducedMotion, pressControls],
  );

  const cancelLongPress = useCallback(() => {
    clearLongPressTracking();
    animateToRest(false);
  }, [animateToRest, clearLongPressTracking]);

  useEffect(() => () => clearLongPressTracking(), [clearLongPressTracking]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse") return;

    clearLongPressTracking();
    didLongPressRef.current = false;
    startPointRef.current = { x: event.clientX, y: event.clientY };
    document.getSelection()?.removeAllRanges();

    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!startPointRef.current) return;

      didLongPressRef.current = true;
      clearLongPressTracking();
      document.getSelection()?.removeAllRanges();

      // The 200 ms hold commits the gesture. Complete the visible press-down
      // before the sheet enters, then rebound from that compressed state.
      void pressControls.start(
        prefersReducedMotion
          ? {
              opacity: 0.82,
              transition: { duration: 0.1, ease: [0.23, 1, 0.32, 1] },
            }
          : {
              transform: "scale(0.97)",
              transition: { duration: 0.1, ease: [0.23, 1, 0.32, 1] },
            },
      );

      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        animateToRest(true);
        navigator.vibrate?.(10);
        onOpenMobileActions();
      }, LONG_PRESS_COMPRESSION_MS);
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
      <motion.div
        className="min-w-0 touch-pan-y select-none [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none]"
        initial={{ transform: "scale(1)", opacity: 1 }}
        animate={pressControls}
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
