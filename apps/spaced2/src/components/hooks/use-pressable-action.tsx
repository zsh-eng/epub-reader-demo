import { HOLD_TO_CANCEL_THRESHOLD_MS } from "@/lib/card-mapping";
import { isEventTargetInput } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";

type UsePressableActionOptions = {
  /** The keyboard key that triggers this action */
  key: string;
  /** Callback fired when the action is confirmed (released before threshold) */
  onAction: () => void;
  /** Time in ms before a press is considered "cancelled" */
  holdToCancelThreshold?: number;
  /** Whether the pressable action is enabled */
  enabled?: boolean;
};

type UsePressableActionReturn = {
  /** Current pressed state: true (pressed), false (released), undefined (initial/mouse interaction) */
  pressed: boolean | undefined;
  /** Ref to attach to the interactive element */
  elementRef: React.RefObject<HTMLElement>;
  /** Props to spread onto your button/interactive element */
  pressableProps: {
    onMouseDown: () => void;
    onClick: () => void;
  };
};

export function usePressableAction({
  key,
  onAction,
  holdToCancelThreshold = HOLD_TO_CANCEL_THRESHOLD_MS,
  enabled = true,
}: UsePressableActionOptions): UsePressableActionReturn {
  const elementRef = useRef<HTMLElement>(null);
  const [pressed, setPressed] = useState<boolean | undefined>(undefined);
  const timePressedRef = useRef<number | null>(null);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  useEffect(() => {
    const cancel = () => {
      timePressedRef.current = null;
      setPressed(false);
    };
    if (!enabled) {
      cancel();
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isEventTargetInput(event) ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key !== key) return;
      timePressedRef.current = Date.now();
      setPressed(true);
      event.preventDefault();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key !== key) return;
      const started = timePressedRef.current;
      cancel();
      if (started === null || isEventTargetInput(event)) return;
      if (Date.now() - started < holdToCancelThreshold) actionRef.current();
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", cancel);
    document.addEventListener("focusin", cancel);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      timePressedRef.current = null;
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", cancel);
      document.removeEventListener("focusin", cancel);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [key, enabled, holdToCancelThreshold]);

  return {
    pressed,
    elementRef,
    pressableProps: {
      onMouseDown: () => {
        timePressedRef.current = null;
        setPressed(undefined);
      },
      onClick: () => {
        if (enabled) onAction();
      },
    },
  };
}
