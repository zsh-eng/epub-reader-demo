import { useEffect, useRef } from "react";

interface FooterScrubberCanvasProps {
  currentPage: number;
  totalPages: number;
  chapterStartPages: (number | null)[];
  onScrubCommit: (page: number) => void;
  onScrubPreview?: (page: number) => void;
}

const TICK_SPACING = 10;
const PLAYHEAD_H = 6;
const TOP_PAD = 4;
// Friction constant for momentum deceleration (higher = stops faster)
const MOMENTUM_FRICTION = 6;
// Minimum velocity (pages/sec) to trigger momentum scroll on release
const MOMENTUM_THRESHOLD = 3;
// Maximum initial momentum velocity cap (pages/sec)
const MOMENTUM_MAX_VELOCITY = 60;

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

    // Tick type — chapters are thicker/shorter, not taller
    const isChapter = chapterStartSet.has(p);
    const isMod20 = p % 20 === 0;
    const isMod10 = p % 10 === 0;

    let tickH: number;
    let tickTopOffset: number; // extra top offset so chapter ticks cover "middle" of range
    let lineWidth: number;
    let color: string;
    let baseAlpha: number;

    if (isChapter) {
      // Slightly thicker, shorter — covers roughly the middle 2/3 of the tick range
      tickH = 18;
      tickTopOffset = 3;
      lineWidth = 2;
      color = colors.fg;
      baseAlpha = 0.85;
    } else if (isMod20) {
      tickH = 28;
      tickTopOffset = 0;
      lineWidth = 0.9;
      color = colors.mutedFg;
      baseAlpha = 0.7;
    } else if (isMod10) {
      tickH = 25;
      tickTopOffset = 0;
      lineWidth = 0.9;
      color = colors.mutedFg;
      baseAlpha = 0.5;
    } else {
      tickH = 22;
      tickTopOffset = 0;
      lineWidth = 0.75;
      color = colors.mutedFg;
      baseAlpha = 0.3;
    }

    // Dip: ticks near the playhead start below the nub and appear shorter
    const dist = Math.abs(p - displayPage);
    const dipOffset = PLAYHEAD_H * Math.max(0, 1 - dist / 1.5);
    const tickTop = TOP_PAD + tickTopOffset + dipOffset;

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
      ctx.fillText(String(p), x, TOP_PAD + 28 + 5);
    }
  }

  // Playhead nub — very short, anchored to top, drawn last (on top)
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

  chapterStartSet.current = new Set(
    chapterStartPages.filter((p): p is number => p !== null),
  );

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPageRef = useRef<number>(currentPage);
  const lastPreviewPageRef = useRef<number>(currentPage);
  // Velocity tracking: recent pointer positions for momentum computation
  const dragHistoryRef = useRef<{ x: number; t: number }[]>([]);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!colorsRef.current) colorsRef.current = resolveColors(canvas);
    drawCanvas(canvas, displayPageRef.current, totalPages, chapterStartSet.current, colorsRef.current);
  }

  function emitPreviewIfChanged(page: number) {
    const intPage = Math.round(page);
    if (intPage !== lastPreviewPageRef.current) {
      lastPreviewPageRef.current = intPage;
      onScrubPreview?.(intPage);
    }
  }

  // Spring animation toward currentPage (idle / post-commit state)
  useEffect(() => {
    if (isDraggingRef.current) return;
    const target = currentPage;
    let velocity = 0;
    let lastTime: number | null = null;

    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const dt = Math.min((now - (lastTime ?? now)) / 1000, 0.05);
      lastTime = now;
      const force = 280 * (target - displayPageRef.current);
      velocity = (velocity + force * dt) * (1 - 32 * dt);
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

  // Resize observer
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

  // Theme observer
  useEffect(() => {
    const mo = new MutationObserver(() => {
      colorsRef.current = null;
      redraw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startMomentum(initialVelocity: number) {
    const capped = Math.sign(initialVelocity) * Math.min(Math.abs(initialVelocity), MOMENTUM_MAX_VELOCITY);
    let vel = capped;
    let lastTime: number | null = null;

    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const dt = Math.min((now - (lastTime ?? now)) / 1000, 0.05);
      lastTime = now;

      // Exponential friction: v *= e^(-friction * dt)
      vel *= Math.exp(-MOMENTUM_FRICTION * dt);
      displayPageRef.current = Math.max(1, Math.min(totalPages, displayPageRef.current + vel * dt));
      redraw();
      emitPreviewIfChanged(displayPageRef.current);

      if (Math.abs(vel) > 0.4) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Momentum settled — commit and let spring snap to final page
        onScrubCommit(Math.round(displayPageRef.current));
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    cancelAnimationFrame(rafRef.current);
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartPageRef.current = displayPageRef.current;
    lastPreviewPageRef.current = Math.round(displayPageRef.current);
    dragHistoryRef.current = [{ x: e.clientX, t: performance.now() }];
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDraggingRef.current) return;
    const now = performance.now();

    // Track history for velocity; keep only the last 80ms
    dragHistoryRef.current.push({ x: e.clientX, t: now });
    const cutoff = now - 80;
    dragHistoryRef.current = dragHistoryRef.current.filter((h) => h.t >= cutoff);

    const dx = e.clientX - dragStartXRef.current;
    const page = Math.max(1, Math.min(totalPages, dragStartPageRef.current - dx / TICK_SPACING));
    displayPageRef.current = page;
    redraw();
    emitPreviewIfChanged(page);
  }

  function handlePointerUp() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Compute fling velocity from recent history
    const history = dragHistoryRef.current;
    let velocityPagesPerSec = 0;
    if (history.length >= 2) {
      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const dtSec = (newest.t - oldest.t) / 1000;
      if (dtSec > 0.001) {
        const dxPx = newest.x - oldest.x;
        velocityPagesPerSec = -(dxPx / dtSec) / TICK_SPACING;
      }
    }

    if (Math.abs(velocityPagesPerSec) > MOMENTUM_THRESHOLD) {
      startMomentum(velocityPagesPerSec);
    } else {
      onScrubCommit(Math.round(displayPageRef.current));
    }
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
