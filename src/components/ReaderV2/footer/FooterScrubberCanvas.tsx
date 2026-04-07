import { useEffect, useRef } from "react";

interface FooterScrubberCanvasProps {
  currentPage: number;
  totalPages: number;
  chapterStartPages: (number | null)[];
  onScrubCommit: (page: number) => void;
  onScrubPreview?: (page: number) => void;
}

const TICK_SPACING = 11;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
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
  const midY = H * 0.44;
  const FADE_ZONE = 72;

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

    let halfH: number;
    let lineWidth: number;
    let color: string;
    let baseAlpha: number;

    if (isChapter) {
      halfH = 13;
      lineWidth = 2;
      color = colors.fg;
      baseAlpha = 0.82;
    } else if (isMod20) {
      halfH = 8;
      lineWidth = 0.8;
      color = colors.mutedFg;
      baseAlpha = 0.65;
    } else if (isMod10) {
      halfH = 6;
      lineWidth = 0.8;
      color = colors.mutedFg;
      baseAlpha = 0.45;
    } else {
      halfH = 3;
      lineWidth = 0.7;
      color = colors.mutedFg;
      baseAlpha = 0.28;
    }

    // Dip effect near playhead
    const dist = Math.abs(p - displayPage);
    if (dist < 2) {
      const dipFactor = lerp(0.42, 1.0, smoothstep(0, 2, dist));
      halfH = halfH * dipFactor;
    }

    ctx.globalAlpha = edgeAlpha * baseAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, midY - halfH);
    ctx.lineTo(x, midY + halfH);
    ctx.stroke();

    // Number label every 20 pages
    if (isMod20 && distFromEdge > FADE_ZONE * 0.4) {
      ctx.globalAlpha = edgeAlpha * 0.5;
      ctx.fillStyle = colors.mutedFg;
      ctx.font = `9px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(p), x, midY + halfH + 4);
    }
  }

  // Playhead — fixed center line
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, midY - 16);
  ctx.lineTo(cx, midY + 16);
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
  const displayPageRef = useRef(currentPage);
  const rafRef = useRef<number>(0);
  const colorsRef = useRef<CanvasColors | null>(null);
  const chapterStartSet = useRef<Set<number>>(new Set());

  // Keep chapter set in sync
  chapterStartSet.current = new Set(
    chapterStartPages.filter((p): p is number => p !== null),
  );

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPageRef = useRef(currentPage);
  const previewPageRef = useRef(currentPage);

  function redraw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!colorsRef.current) {
      colorsRef.current = resolveColors(canvas);
    }
    drawCanvas(
      canvas,
      displayPageRef.current,
      totalPages,
      chapterStartSet.current,
      colorsRef.current,
    );
  }

  // Spring animation toward currentPage
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
      displayPageRef.current = Math.max(
        1,
        Math.min(totalPages, displayPageRef.current + velocity * dt),
      );

      redraw();

      if (
        Math.abs(target - displayPageRef.current) > 0.01 ||
        Math.abs(velocity) > 0.05
      ) {
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
      colorsRef.current = null; // re-resolve on resize (DPR may change)
      redraw();
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Theme change observer
  useEffect(() => {
    const mo = new MutationObserver(() => {
      colorsRef.current = null;
      redraw();
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    return () => mo.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer events for scrubbing
  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartPageRef.current = Math.round(displayPageRef.current);
    previewPageRef.current = dragStartPageRef.current;
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    cancelAnimationFrame(rafRef.current);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartXRef.current;
    const deltaPages = -Math.round(dx / TICK_SPACING);
    const page = Math.max(1, Math.min(totalPages, dragStartPageRef.current + deltaPages));
    displayPageRef.current = page;
    previewPageRef.current = page;
    redraw();
    onScrubPreview?.(page);
  }

  function handlePointerUp() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    onScrubCommit(previewPageRef.current);
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
