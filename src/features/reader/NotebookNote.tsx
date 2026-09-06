import { useRef, useState, type ReactNode, type PointerEvent } from "react";
import {
  animate,
  cubicBezier,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { Ellipsis, Pencil } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

const THRESHOLD = 72;

/** Owns drag feedback locally: pointer movement never renders the notebook or Reader.
 * Native vertical scrolling wins until a deliberate horizontal drag captures the pointer.
 */
export function NotebookNote({
  children,
  onEdit,
  disabled,
  editing,
}: {
  children: ReactNode;
  onEdit: () => void;
  disabled: boolean;
  editing: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const distance = useMotionValue(0);
  const transform = useTransform(
    distance,
    (value) => `translateX(${-value}px)`,
  );
  const progress = useTransform(distance, [0, THRESHOLD], [0, 1]);
  const opacity = useTransform(distance, [4, 48], [0, 1]);
  // Approach from the right, then keep a 12 px gap from the moving card.
  const cueTransform = useTransform(distance, (value) => {
    const x = value < 60 ? 24 - value * 0.6 : 48 - value;
    const scale = reduceMotion ? 1 : 0.9 + Math.min(value / 60, 1) * 0.1;
    return `translateX(${x}px) scale(${scale})`;
  });
  const burst = useMotionValue(1);
  const burstScale = useTransform(burst, [0, 1], [1, 2.3], {
    ease: cubicBezier(0.23, 1, 0.32, 1),
  });
  const burstTransform = useTransform(burstScale, (value) => `scale(${value})`);
  const ringOpacity = useTransform(burst, [0, 0.3, 1], [0.85, 0.4, 0]);
  const mistOpacity = useTransform(burst, [0, 0.15, 1], [0.3, 0.45, 0]);
  const [armed, setArmed] = useState(false);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    dragging: boolean;
    armed: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  function finish(event: PointerEvent<HTMLElement>, cancelled = false) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    setArmed(false);
    if (reduceMotion) distance.set(0);
    else
      void animate(distance, 0, { type: "spring", duration: 0.5, bounce: 0.2 });
    if (!cancelled && active.dragging && active.armed) onEdit();
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="group relative mb-2 block"
        data-edit-ready={armed || undefined}
      >
        {/* Transparent transforms still enlarge scroll bounds. Clip the effect,
            including its resting halo, without clipping the card or its focus ring. */}
        <div className="pointer-events-none absolute inset-0 overflow-x-clip">
          <motion.div
            aria-hidden="true"
            style={{ opacity, transform: cueTransform }}
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center text-muted-foreground"
          >
            <div className="relative flex size-9 items-center justify-center">
              <Pencil size={16} className={armed ? "text-foreground" : ""} />
              <svg
                viewBox="0 0 36 36"
                className="absolute inset-0 size-9 -rotate-90 fill-none stroke-current"
              >
                <motion.circle
                  cx="18"
                  cy="18"
                  r="16"
                  strokeWidth="1.5"
                  style={{
                    pathLength: progress,
                    opacity: armed && !reduceMotion ? 0 : 1,
                  }}
                />
              </svg>
              {!reduceMotion && (
                <>
                  <motion.span
                    className="absolute inset-0 rounded-full border border-current"
                    style={{ transform: burstTransform, opacity: ringOpacity }}
                  />
                  <motion.span
                    className="absolute inset-0 rounded-full border-[3px] border-current blur-[2px]"
                    style={{ transform: burstTransform, opacity: mistOpacity }}
                  />
                </>
              )}
            </div>
          </motion.div>
        </div>
        <motion.article
          style={{ transform, touchAction: "pan-y" }}
          className={`relative rounded-2xl bg-secondary px-4 py-3 group-data-[popup-open]:ring-1 group-data-[popup-open]:ring-ring ${editing ? "ring-1 ring-ring" : ""}`}
          onPointerDown={(event) => {
            suppressClick.current = false;
            if (
              disabled ||
              !event.isPrimary ||
              event.button !== 0 ||
              gesture.current
            )
              return;
            if (
              (event.target as HTMLElement).closest(
                "button,a,textarea,input,[role=menuitem]",
              )
            )
              return;
            if (window.getSelection()?.toString()) return;
            distance.stop();
            distance.set(0);
            gesture.current = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              dragging: false,
              armed: false,
            };
          }}
          onPointerMove={(event) => {
            const active = gesture.current;
            if (!active || active.id !== event.pointerId) return;
            const dx = active.x - event.clientX;
            const dy = Math.abs(event.clientY - active.y);
            if (!active.dragging) {
              if (dy > 10 && dy >= Math.abs(dx)) {
                gesture.current = null;
                return;
              }
              if (dx < 10 || dx < dy * 1.5) return;
              if (window.getSelection()?.toString()) {
                gesture.current = null;
                return;
              }
              active.dragging = true;
              suppressClick.current = true;
              event.currentTarget.setPointerCapture(event.pointerId);
            }
            event.preventDefault();
            event.stopPropagation();
            distance.set(
              Math.max(
                0,
                dx > THRESHOLD ? THRESHOLD + (dx - THRESHOLD) * 0.2 : dx,
              ),
            );
            const nextArmed = dx >= THRESHOLD;
            if (nextArmed !== active.armed) {
              active.armed = nextArmed;
              setArmed(nextArmed);
              burst.stop();
              if (nextArmed && !reduceMotion) {
                burst.set(0);
                // A quick expansion with a longer diffuse tail, as requested.
                void animate(burst, 1, {
                  duration: 0.45,
                  ease: "linear",
                });
              } else burst.set(1);
            }
          }}
          onPointerUp={(event) => finish(event)}
          onPointerCancel={(event) => finish(event, true)}
          onLostPointerCapture={(event) => {
            // Moving implicit touch capture from a child to this card also bubbles here.
            if (event.target === event.currentTarget) finish(event, true);
          }}
          onClickCapture={(event) => {
            if (suppressClick.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressClick.current = false;
            }
          }}
        >
          {children}
          <div className="absolute bottom-1 right-2">
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Note actions"
                disabled={disabled}
                className="flex h-8 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:bg-muted data-[popup-open]:bg-muted"
              >
                <Ellipsis size={16} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil size={14} />
                  Edit note
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </motion.article>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={disabled} onClick={onEdit}>
          <Pencil size={14} />
          Edit note
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
