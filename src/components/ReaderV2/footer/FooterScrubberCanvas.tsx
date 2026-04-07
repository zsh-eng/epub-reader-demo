import { useEffect, useRef } from "react";

interface FooterScrubberCanvasProps {
  currentPage: number;
  totalPages: number;
  chapterStartPages: (number | null)[];
  onScrubCommit: (page: number) => void;
  onScrubPreview?: (page: number) => void;
}

// ~10px between pages → ~30 visible at once in a ~300px canvas
const TICK_SPACING = 10;
// Playhead nub height — very short, sits at top of canvas
const PLAYHEAD_H = 6;
// Where ticks and playhead begin (top of canvas)
const TOP_PAD = 4;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface CanvasColors {
  fg: string;
  mutedFg: string;
}

function resolveColors(el: HTMLElement): CanvasColors {
  const style = getComputedStyle(el);
  const fg = style.getPropertyValue("--foreground").trim();
  const mutedFg = style.getPropertyValue("--muted-foreground").trim();
  return {
    fg: fg ? `hsl(${fg})` : "hsl(0 0% 5%)",
    mutedFg: mutedFg ? `hsl(${mutedFg})` : "hsl(0 0% 45%)",
  };
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  displayPage: number,
  totalPages: number,
  chapterStartSet: Set<number>,
  colors: CanvasColors,
) {
  if (totalPages <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (W === 0 || H === 0) return;

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  const cx = W / 2;
  const FADE_ZONE = 64;

  const halfVisible = Math.ceil(cx / TICK_SPACING) + 2;
  const startPg = Math.max(1, Math.floor(displayPage - halfVisible));
  const endPg = Math.min(totalPages, Math.ceil(displayPage + halfVisible));

  for (let p = startPg; p <= endPg; p++) {
    const x = cx + (p - displayPage) * TICK_SPACING;
    if (x < -TICK_SPACING || x > W + TICK_SPACING) continue;

    // Edge fade
    const distFromEdge = Math.min(x, W - x);
    const edgeAlpha = smoothstep(0, FADE_ZONE, distFromEdge);
    if (edgeAlpha <= 0) continue;

    // Tick type
    const isChapter = chapterStartSet.has(p);
    const isMod20 = p % 20 === 0;
    const isMod10 = p % 10 === 0;

    let tickH: number;
    let lineWidth: number;
    let color: string;
    let baseAlpha: number;

    if (isChapter) {
      tickH = 36;
      lineWidth = 2;
      color = colors.fg;
      baseAlpha = 0.85;
    } else if (isMod20) {
      tickH = 26;
      lineWidth = 0.9;
      color = colors.mutedFg;
      baseAlpha = 0.7;
    } else if (isMod10) {
      tickH = 22;
      lineWidth = 0.9;
      color = colors.mutedFg;
      baseAlpha = 0.5;
    } else {
      tickH = 18;
      lineWidth = 0.75;
      color = colors.mutedFg;
      baseAlpha = 0.3;
    }

    // Dip effect: ticks near the playhead start below the playhead nub.
    // At dist=0 the tick is pushed down by PLAYHEAD_H; smoothly recovers by dist=1.5.
    const dist = Math.abs(p - displayPage);
    const dipOffset = PLAYHEAD_H * Math.max(0, 1 - dist / 1.5);
    const tickTop = TOP_PAD + dipOffset;

    ctx.globalAlpha = edgeAlpha * baseAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, tickTop);
    ctx.lineTo(x, tickTop + tickH);
    ctx.stroke();

    // Number label every 20 pages
    if (isMod20 && distFromEdge > FADE_ZONE * 0.35) {
      ctx.globalAlpha = edgeAlpha * 0.55;
      ctx.fillStyle = colors.mutedFg;
      ctx.font = `9px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(p), x, TOP_PAD + tickH + 5);
    }
  }

  // Playhead nub — drawn on top, very short, at top of canvas
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, TOP_PAD);
  ctx.lineTo(cx, TOP_PAD + PLAYHEAD_H);
  ctx.stroke();

  ctx.restore();
}

export function FooterScrubberCanvas({
  currentPage,
  totalPages,
  chapterStartPages,
  onScrubCommit,
  onScrubPreview,
}: FooterScrubberCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayPageRef = useRef<number>(currentPage);
  const rafRef = useRef<number>(0);
  const colorsRef = useRef<CanvasColors | null>(null);
  const chapterStartSet = useRef<Set<number>>(new Set());

  // Keep chapter set in sync (render-phase update is fine for a ref)
  chapterStartSet.current = new Set(
    chapterStartPages.filter((p): p is number => p !== null),
  );

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPageRef = useRef<number>(currentPage);
  const lastPreviewPageRef = useRef<number>(currentPage);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!colorsRef.current) colorsRef.current = resolveColors(canvas);
    drawCanvas(canvas, displayPageRef.current, totalPages, chapterStartSet.current, colorsRef.current);
  }

  // Spring animation toward currentPage (only when not dragging)
  useEffect(() => {
    if (isDraggingRef.current) return;
    const target = currentPage;
    let velocity = 0;
    let lastTime: number | null = null;
    const STIFFNESS = 280;
    const DAMPING = 32;

    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const dt = Math.min((now - (lastTime ?? now)) / 1000, 0.05);
      lastTime = now;
      const force = STIFFNESS * (target - displayPageRef.current);
      velocity = (velocity + force * dt) * (1 - DAMPING * dt);
      displayPageRef.current = Math.max(1, Math.min(totalPages, displayPageRef.current + velocity * dt));
      redraw();
      if (Math.abs(target - displayPageRef.current) > 0.005 || Math.abs(velocity) > 0.05) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayPageRef.current = target;
        redraw();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [currentPage, totalPages]); // eslint-disable-line react-hooks/exhaustive-deps

  // Resize observer — re-resolve colors and redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      colorsRef.current = null;
      redraw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme observer — re-resolve colors on class/attribute change
  useEffect(() => {
    const mo = new MutationObserver(() => {
      colorsRef.current = null;
      redraw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    // Start from current float position for seamless pickup
    dragStartPageRef.current = displayPageRef.current;
    lastPreviewPageRef.current = Math.round(displayPageRef.current);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    cancelAnimationFrame(rafRef.current);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    // Continuous float — no rounding, smooth scrolling feel
    const page = Math.max(1, Math.min(totalPages, dragStartPageRef.current - dx / TICK_SPACING));
    displayPageRef.current = page;
    redraw();
    // Only fire preview callback when the integer page actually changes
    const intPage = Math.round(page);
    if (intPage !== lastPreviewPageRef.current) {
      lastPreviewPageRef.current = intPage;
      onScrubPreview?.(intPage);
    }
  }

  function handlePointerUp() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    onScrubCommit(Math.round(displayPageRef.current));
  }

  return (
    <canvas
      ref={canvasRef}
      className="w-full cursor-ew-resize touch-none"
      style={{ height: 48, display: "block" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
