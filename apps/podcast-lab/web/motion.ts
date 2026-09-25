import { animate } from "motion/mini";

const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let pointerInput = false;
const arrivals = new Map<HTMLElement, ReturnType<typeof animate>>();
let cancelCover = () => {};
// Keyboard navigation stays immediate. Keep motion out of typing and scrolling.
document.addEventListener(
  "pointerdown",
  () => {
    pointerInput = true;
  },
  { capture: true, passive: true },
);
document.addEventListener(
  "keydown",
  () => {
    pointerInput = false;
    cancelCover();
  },
  true,
);
const curve = (name: string) =>
  getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()
    .slice(13, -1)
    .split(",")
    .map(Number) as [number, number, number, number];

export type ArtworkOrigin = { src: string; rect: DOMRect; captured: number };
export function captureArtwork(
  container: Element | null,
): ArtworkOrigin | undefined {
  const image = container?.querySelector<HTMLImageElement>("img");
  if (
    !pointerInput ||
    reduced.matches ||
    !image?.complete ||
    !image.naturalWidth
  )
    return;
  const rect = image.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  return { src: image.currentSrc, rect, captured: performance.now() };
}

/** One decorative cover connects its source to the destination. Never animate
 * layout, clone the audio element, block input, or retain a ghost after a route
 * interruption. Images already exist in the local browser cache. */
export function carryArtwork(
  origin: ArtworkOrigin | undefined,
  destination: HTMLImageElement | null,
) {
  cancelCover();
  if (
    !origin ||
    !destination ||
    reduced.matches ||
    !pointerInput ||
    performance.now() - origin.captured > 1200
  )
    return;
  const end = destination.getBoundingClientRect();
  if (!end.width || !end.height) return;
  const ghost = document.createElement("img");
  ghost.src = origin.src;
  ghost.alt = "";
  ghost.className = "travelling-cover";
  ghost.setAttribute("aria-hidden", "true");
  ghost.style.width = `${origin.rect.width}px`;
  ghost.style.height = `${origin.rect.height}px`;
  const from = `translate(${origin.rect.x}px, ${origin.rect.y}px) scale(1, 1)`;
  const to = `translate(${end.x}px, ${end.y}px) scale(${end.width / origin.rect.width}, ${end.height / origin.rect.height})`;
  ghost.style.transform = from;
  destination.style.opacity = "0";
  document.body.append(ghost);
  const animation = animate(
    ghost,
    { transform: [from, to] },
    { duration: 0.24, ease: curve("--ease-in-out") },
  );
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    animation.cancel();
    ghost.remove();
    destination.style.removeProperty("opacity");
  };
  cancelCover = cleanup;
  void animation.then(() => {
    cleanup();
    if (cancelCover === cleanup) cancelCover = () => {};
  });
}
export function cancelNavigationMotion() {
  cancelCover();
  cancelCover = () => {};
  for (const [element, animation] of arrivals) {
    animation.cancel();
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform");
  }
  arrivals.clear();
}
reduced.addEventListener("change", cancelNavigationMotion);

/** A small reveal on deliberate navigation; never used for search results,
 * virtual rows, playback ticks, or the directly manipulated scrubber. */
export function arrive(element: HTMLElement, initial = false) {
  if (!initial && !pointerInput) return;
  const previous = arrivals.get(element);
  const style = previous ? getComputedStyle(element) : null;
  const opacity = style?.opacity ?? "0.94";
  const transform =
    style?.transform ?? (reduced.matches ? "none" : "translateY(6px)");
  previous?.cancel();
  const animation = animate(
    element,
    { opacity: [opacity, "1"], transform: [transform, "none"] },
    { duration: reduced.matches ? 0.12 : 0.18, ease: curve("--ease-out") },
  );
  arrivals.set(element, animation);
  void animation.then(() => {
    if (arrivals.get(element) !== animation) return;
    animation.cancel();
    arrivals.delete(element);
    element.style.removeProperty("opacity");
    element.style.removeProperty("transform");
  });
}

export function setToastVisible(visible: boolean) {
  const toast = document.getElementById("toast")!;
  if (!visible && toast.contains(document.activeElement))
    document.getElementById("play")?.focus({ preventScroll: true });
  toast.dataset.open = String(visible);
  toast.inert = !visible;
  toast.setAttribute("aria-hidden", String(!visible));
}
