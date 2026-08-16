import { cn } from "@/lib/utils";
import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";

interface SmoothCaretInputProps extends Omit<ComponentProps<"input">, "value"> {
  value: string;
  containerClassName?: string;
}

interface CaretState {
  animate: boolean;
  blinkRevision: number;
  height: number;
  ready: boolean;
  visible: boolean;
  x: number;
}

const initialCaretState: CaretState = {
  animate: false,
  blinkRevision: 0,
  height: 16,
  ready: false,
  visible: false,
  x: 0,
};

function parsePixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

/**
 * Keeps native input behavior while drawing an accurately measured caret that
 * can ease between positions. Pointer placement and layout changes snap so the
 * visual caret never trails a direct spatial action.
 */
export const SmoothCaretInput = forwardRef<
  HTMLInputElement,
  SmoothCaretInputProps
>(function SmoothCaretInput(
  {
    className,
    containerClassName,
    onBlur,
    onChange,
    onCompositionEnd,
    onCompositionStart,
    onFocus,
    onKeyUp,
    onPointerCancel,
    onPointerDown,
    onPointerUp,
    onScroll,
    onSelect,
    value,
    ...props
  },
  forwardedRef,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const mirrorTextRef = useRef<HTMLSpanElement | null>(null);
  const mirrorMarkerRef = useRef<HTMLSpanElement | null>(null);
  const selectionFrameRef = useRef<number | null>(null);
  const transitionFrameRef = useRef<number | null>(null);
  const pointerInteractionRef = useRef(false);
  const composingRef = useRef(false);
  const lastCaretSignatureRef = useRef("");
  const [isComposing, setIsComposing] = useState(false);
  const [caret, setCaret] = useState(initialCaretState);

  const setInputRef = useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof forwardedRef === "function") {
        forwardedRef(node);
        return;
      }
      if (forwardedRef) forwardedRef.current = node;
    },
    [forwardedRef],
  );

  const updateCaret = useCallback((snap = false) => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    const mirrorText = mirrorTextRef.current;
    const mirrorMarker = mirrorMarkerRef.current;
    if (!input || !mirror || !mirrorText || !mirrorMarker) return;

    const selectionStart = input.selectionStart ?? input.value.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const isFocused = document.activeElement === input;
    const isCollapsed = selectionStart === selectionEnd;
    const visible = isFocused && isCollapsed && !composingRef.current;

    if (!visible) {
      setCaret((current) =>
        current.visible ? { ...current, visible: false } : current,
      );
      return;
    }

    const inputStyle = window.getComputedStyle(input);
    mirror.style.direction = inputStyle.direction;
    mirror.style.fontFamily = inputStyle.fontFamily;
    mirror.style.fontFeatureSettings = inputStyle.fontFeatureSettings;
    mirror.style.fontKerning = inputStyle.fontKerning;
    mirror.style.fontSize = inputStyle.fontSize;
    mirror.style.fontStretch = inputStyle.fontStretch;
    mirror.style.fontStyle = inputStyle.fontStyle;
    mirror.style.fontVariant = inputStyle.fontVariant;
    mirror.style.fontVariationSettings = inputStyle.fontVariationSettings;
    mirror.style.fontWeight = inputStyle.fontWeight;
    mirror.style.letterSpacing = inputStyle.letterSpacing;
    mirror.style.lineHeight = inputStyle.lineHeight;
    mirror.style.textIndent = inputStyle.textIndent;
    mirror.style.textTransform = inputStyle.textTransform;
    mirror.style.wordSpacing = inputStyle.wordSpacing;

    const mirrorRect = mirror.getBoundingClientRect();
    mirrorText.textContent = input.value;
    const mirrorTextNode = mirrorText.firstChild;
    let selectionX: number | null = null;

    if (mirrorTextNode) {
      const range = document.createRange();
      if (typeof range.getBoundingClientRect === "function") {
        range.setStart(mirrorTextNode, selectionStart);
        range.collapse(true);
        const rangeRect = range.getBoundingClientRect();
        if (rangeRect.height > 0) selectionX = rangeRect.left - mirrorRect.left;
      }
    }

    if (selectionX === null) {
      mirrorText.textContent = input.value.slice(0, selectionStart);
      selectionX = mirrorMarker.getBoundingClientRect().left - mirrorRect.left;
    }

    const inlineStart =
      parsePixelValue(inputStyle.borderLeftWidth) +
      parsePixelValue(inputStyle.paddingLeft);
    const inlineEnd =
      parsePixelValue(inputStyle.borderRightWidth) +
      parsePixelValue(inputStyle.paddingRight);
    const measuredX = inlineStart + selectionX - input.scrollLeft;
    const maxX =
      input.clientWidth > 0
        ? Math.max(inlineStart, input.clientWidth - inlineEnd - 2)
        : measuredX;
    const x = Math.min(Math.max(inlineStart, measuredX), maxX);
    const height = parsePixelValue(inputStyle.fontSize) || 16;
    const signature = `${input.value}\u0000${selectionStart}\u0000${selectionEnd}`;
    const resetBlink = signature !== lastCaretSignatureRef.current;
    lastCaretSignatureRef.current = signature;

    if (snap && transitionFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionFrameRef.current);
    }

    setCaret((current) => ({
      animate: !snap,
      blinkRevision: resetBlink
        ? current.blinkRevision + 1
        : current.blinkRevision,
      height,
      ready: true,
      visible: true,
      x,
    }));

    if (!snap) return;
    transitionFrameRef.current = window.requestAnimationFrame(() => {
      setCaret((current) => ({ ...current, animate: true }));
      transitionFrameRef.current = null;
    });
  }, []);

  const scheduleCaretUpdate = useCallback(
    (snap = false) => {
      if (selectionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionFrameRef.current);
      }
      selectionFrameRef.current = window.requestAnimationFrame(() => {
        updateCaret(snap);
        selectionFrameRef.current = null;
      });
    },
    [updateCaret],
  );

  useLayoutEffect(() => {
    updateCaret(false);
  }, [updateCaret, value]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;

    const handleSelectionChange = () => {
      if (document.activeElement !== input) return;
      scheduleCaretUpdate(pointerInteractionRef.current);
    };
    const handleLayoutChange = () => scheduleCaretUpdate(true);
    const resizeObserver = new ResizeObserver(handleLayoutChange);
    resizeObserver.observe(input);
    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("resize", handleLayoutChange);

    let cancelled = false;
    if ("fonts" in document) {
      void document.fonts.ready.then(() => {
        if (!cancelled) handleLayoutChange();
      });
    }

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("resize", handleLayoutChange);
      if (selectionFrameRef.current !== null) {
        window.cancelAnimationFrame(selectionFrameRef.current);
      }
      if (transitionFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionFrameRef.current);
      }
    };
  }, [scheduleCaretUpdate]);

  return (
    <div
      data-slot="smooth-caret-input"
      className={cn("relative w-full", containerClassName)}
    >
      <input
        {...props}
        ref={setInputRef}
        value={value}
        className={cn(
          "relative z-10",
          caret.ready && !isComposing && "caret-transparent",
          className,
        )}
        onBlur={(event) => {
          setCaret((current) => ({ ...current, visible: false }));
          onBlur?.(event);
        }}
        onChange={(event) => {
          onChange?.(event);
          updateCaret(false);
        }}
        onCompositionStart={(event) => {
          composingRef.current = true;
          setIsComposing(true);
          setCaret((current) => ({ ...current, visible: false }));
          onCompositionStart?.(event);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          setIsComposing(false);
          updateCaret(true);
          onCompositionEnd?.(event);
        }}
        onFocus={(event) => {
          updateCaret(true);
          onFocus?.(event);
        }}
        onKeyUp={(event) => {
          updateCaret(false);
          onKeyUp?.(event);
        }}
        onPointerCancel={(event) => {
          pointerInteractionRef.current = false;
          onPointerCancel?.(event);
        }}
        onPointerDown={(event) => {
          pointerInteractionRef.current = true;
          onPointerDown?.(event);
        }}
        onPointerUp={(event) => {
          updateCaret(true);
          pointerInteractionRef.current = false;
          onPointerUp?.(event);
        }}
        onScroll={(event) => {
          updateCaret(true);
          onScroll?.(event);
        }}
        onSelect={(event) => {
          updateCaret(pointerInteractionRef.current);
          onSelect?.(event);
        }}
      />

      <div
        ref={mirrorRef}
        data-slot="smooth-caret-mirror"
        aria-hidden="true"
        className="pointer-events-none invisible absolute top-0 left-0 w-max max-w-none whitespace-pre"
      >
        <span ref={mirrorTextRef} />
        <span ref={mirrorMarkerRef} className="inline-block w-0" />
      </div>

      {caret.ready ? (
        <span
          data-slot="smooth-caret"
          data-motion={caret.animate ? "smooth" : "instant"}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 left-0 z-20 w-0.5 will-change-transform",
            caret.visible ? "opacity-100" : "opacity-0",
            caret.animate
              ? "transition-transform duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none"
              : "transition-none",
          )}
          style={{
            height: `${caret.height}px`,
            transform: `translate3d(${caret.x}px, -50%, 0)`,
          }}
        >
          <span
            key={caret.blinkRevision}
            className="smooth-caret-blink block size-full bg-foreground"
          />
        </span>
      ) : null}
    </div>
  );
});
