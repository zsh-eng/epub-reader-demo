import FlashcardContent from "@/components/flashcard-content";
import {
  Carousel,
  CarouselApi,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { CardWithMetadata } from "@/lib/types";
import { cn, isEventTargetInput } from "@/lib/utils";
import { useEffect, useState } from "react";

const FLIP_CARD_KEY = " ";

function Dots({ current, count }: { current: number; count: number }) {
  return (
    <div className="flex items-center justify-center gap-1">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={cn(
            "w-2 h-2 rounded-full transition-colors",
            current === index + 1 ? "bg-primary" : "bg-muted",
          )}
        />
      ))}
    </div>
  );
}

// Review carousel for mobile view of reviewing flashcards
export default function MobileReviewCarousel({
  card,
}: {
  card: CardWithMetadata;
}) {
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [count, setCount] = useState(0);

  useEffect(
    function resetCarousel() {
      if (!api) return;
      api.scrollTo(0, true);
    },
    [card, api],
  );

  useEffect(
    function updateCurrent() {
      if (!api) {
        return;
      }

      setCount(api.scrollSnapList().length);
      setCurrent(api.selectedScrollSnap() + 1);

      api.on("select", () => {
        setCurrent(api.selectedScrollSnap() + 1);
      });

      const handleSpacePress = (event: KeyboardEvent) => {
        if (isEventTargetInput(event)) {
          return;
        }

        if (event.key === FLIP_CARD_KEY) {
          event.preventDefault();

          const current = api.selectedScrollSnap();
          // Assume that there is only 2 slides in the carousel
          const nextIndex = current === 0 ? 1 : 0;
          api.scrollTo(nextIndex, true);
        }
      };
      window.addEventListener("keydown", handleSpacePress);
      return () => window.removeEventListener("keydown", handleSpacePress);
    },
    [api],
  );

  return (
    <div className="flex flex-col items-center gap-2 w-full pt-4">
      <Dots current={current} count={count} />
      <Carousel className="w-full max-w-md pt-3" setApi={setApi}>
        <CarouselContent>
          <CarouselItem>
            <div className="p-1">
              <FlashcardContent content={card.front} />
            </div>
          </CarouselItem>
          <CarouselItem>
            <div className="p-1">
              <FlashcardContent content={card.back} />
            </div>
          </CarouselItem>
        </CarouselContent>
      </Carousel>
    </div>
  );
}
