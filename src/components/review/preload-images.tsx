import { useEffect, useRef } from "react";
import { prepareCardContent } from "@/lib/images/card-images";
import { ReviewImagePreloader } from "@/lib/images/preload";
import type { CardWithMetadata } from "@/lib/types";

export default function PreloadReviewImages({
  current,
  queue,
}: {
  current?: CardWithMetadata;
  queue: CardWithMetadata[];
}) {
  const preloader = useRef<ReviewImagePreloader>();
  const cards = [
    ...(current ? [current] : []),
    ...queue.filter((card) => card.id !== current?.id).slice(0, 20),
  ];
  const contents = JSON.stringify(
    cards.flatMap((card) => [card.front, card.back]),
  );
  useEffect(() => {
    const instance = new ReviewImagePreloader();
    preloader.current = instance;
    return () => {
      instance.dispose();
      preloader.current = undefined;
    };
  }, []);
  useEffect(() => {
    // Parse future cards after the visible card can paint.
    const preload = () => {
      const contentsList: string[] = JSON.parse(contents);
      preloader.current?.update([
        ...new Set(
          contentsList.flatMap((content) => prepareCardContent(content).images),
        ),
      ]);
    };
    if (window.requestIdleCallback) {
      const id = window.requestIdleCallback(preload, { timeout: 1000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(preload, 32);
    return () => window.clearTimeout(id);
  }, [contents]);
  return null;
}
