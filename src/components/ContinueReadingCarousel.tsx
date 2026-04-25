import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";
import { useFileUrl } from "@/hooks/use-file-url";
import type { SyncedBook } from "@/lib/db";
import { cn } from "@/lib/utils";
import { Book as BookIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface ContinueReadingCarouselProps {
  books: SyncedBook[];
}

function formatLastReadDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Hero card for the most recently read book
function HeroBookCard({ book }: { book: SyncedBook }) {
  const navigate = useNavigate();
  const imgRef = useRef<HTMLImageElement>(null);
  const [gradientColor, setGradientColor] = useState<string>("rgba(0,0,0,0.8)");
  const [isDarkMode, setIsDarkMode] = useState<boolean>(true);

  // Get cover URL from content hash
  const { url: coverUrl, isLoading: isLoadingCover } = useFileUrl(
    book.coverContentHash,
    "cover",
    { skip: !book.coverContentHash },
  );

  // Detect and track dark mode changes
  useEffect(() => {
    const checkDarkMode = () => {
      const isDark = document.documentElement.classList.contains("dark");
      setIsDarkMode(isDark);
    };

    // Initial check
    checkDarkMode();

    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  // Extract dominant color from cover image for gradient background
  useEffect(() => {
    if (!coverUrl || !imgRef.current) return;

    const img = imgRef.current;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const extractColor = () => {
      if (!ctx) return;

      canvas.width = 10;
      canvas.height = 10;

      try {
        ctx.drawImage(img, 0, 0, 10, 10);
        const imageData = ctx.getImageData(0, 0, 10, 10).data;

        // Sample from corners and center for better color representation
        let r = 0,
          g = 0,
          b = 0;
        const samples = [0, 36, 44, 80, 99]; // corners and center of 10x10 grid

        for (const i of samples) {
          const offset = i * 4;
          r += imageData[offset];
          g += imageData[offset + 1];
          b += imageData[offset + 2];
        }

        r = Math.round(r / samples.length);
        g = Math.round(g / samples.length);
        b = Math.round(b / samples.length);

        // Adjust color based on theme for better text contrast
        if (isDarkMode) {
          // Make the color darker for dark mode (white text)
          const darkenFactor = 0.4;
          r = Math.round(r * darkenFactor);
          g = Math.round(g * darkenFactor);
          b = Math.round(b * darkenFactor);
        } else {
          // Make the color lighter for light mode (dark text)
          const lightenFactor = 0.3;
          r = Math.round(r + (255 - r) * (1 - lightenFactor));
          g = Math.round(g + (255 - g) * (1 - lightenFactor));
          b = Math.round(b + (255 - b) * (1 - lightenFactor));
        }

        setGradientColor(`rgb(${r}, ${g}, ${b})`);
      } catch {
        // CORS or other error - use fallback
        setGradientColor(
          isDarkMode ? "rgba(0,0,0,0.8)" : "rgba(200,200,200,0.9)",
        );
      }
    };

    if (img.complete) {
      extractColor();
    } else {
      img.onload = extractColor;
    }
  }, [coverUrl, isDarkMode]);

  const handleClick = () => {
    navigate(`/reader/${book.id}`);
  };

  return (
    <div
      className="relative w-full overflow-hidden rounded-xl cursor-pointer group"
      onClick={handleClick}
      style={{
        background: `linear-gradient(135deg, ${gradientColor} 0%, ${gradientColor}ee 50%, ${gradientColor}cc 100%)`,
      }}
    >
      {/* Background blur of cover */}
      {coverUrl && (
        <div
          className="absolute inset-0 opacity-30 blur-2xl scale-110"
          style={{
            backgroundImage: `url(${coverUrl})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      )}

      {/* Content */}
      <div className="relative flex gap-4 p-4 md:gap-5 md:p-5">
        {/* Book Cover */}
        <div className="relative shrink-0 w-20 md:w-28 aspect-[2/3]">
          {/* Hidden image for color extraction */}
          <img
            ref={imgRef}
            src={coverUrl || ""}
            alt=""
            className="hidden"
            crossOrigin="anonymous"
          />

          {/* Book Shadow */}
          <div className="absolute inset-0 rounded-md bg-black/30 blur-lg translate-y-3 scale-[0.95]" />

          {/* Main Cover */}
          <div className="relative h-full w-full overflow-hidden rounded-r-md rounded-l-sm bg-white shadow-xl ring-1 ring-white/10 transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-[1.02]">
            {/* Spine Effect */}
            <div className="absolute left-0 top-0 bottom-0 w-[4px] bg-gradient-to-r from-black/25 to-transparent z-10" />
            <div className="absolute left-[4px] top-0 bottom-0 w-[1px] bg-white/30 z-10" />

            {coverUrl ? (
              <img
                src={coverUrl}
                alt={`Cover of ${book.title}`}
                className="h-full w-full object-cover"
                loading="eager"
              />
            ) : isLoadingCover ? (
              <div className="flex h-full w-full flex-col items-center justify-center bg-secondary p-4 text-center">
                <Loader2 className="mb-2 h-8 w-8 text-muted-foreground/50 animate-spin" />
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-secondary p-4 text-center">
                <BookIcon className="mb-2 h-8 w-8 text-muted-foreground/50" />
              </div>
            )}

            {/* Glossy Overlay */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/15 pointer-events-none" />
          </div>
        </div>

        <div className="flex flex-col justify-center min-w-0">
          <p className="text-[10px] md:text-xs font-medium text-gray-600 dark:text-white/60 uppercase tracking-wider mb-1 md:mb-2">
            Continue Reading
          </p>
          <h3 className="text-base md:text-xl font-bold leading-tight line-clamp-2 mb-1 md:mb-2 text-gray-900 dark:text-white drop-shadow-sm">
            {book.title}
          </h3>
          <p className="text-xs md:text-sm text-gray-600 dark:text-white/70 line-clamp-1 mb-2 md:mb-3">
            {book.author}
          </p>
          {book.lastOpened && (
            <p className="text-xs text-gray-500 dark:text-white/50">
              Last read {formatLastReadDate(book.lastOpened)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Dot indicator component
function CarouselDots({
  count,
  activeIndex,
  onDotClick,
}: {
  count: number;
  activeIndex: number;
  onDotClick: (index: number) => void;
}) {
  if (count <= 1) return null;

  return (
    <div className="flex justify-center gap-1.5 mt-4">
      {Array.from({ length: count }).map((_, index) => (
        <button
          key={index}
          onClick={() => onDotClick(index)}
          className={cn(
            "w-2 h-2 rounded-full transition-all duration-200",
            index === activeIndex
              ? "bg-primary w-4"
              : "bg-muted-foreground/30 hover:bg-muted-foreground/50",
          )}
          aria-label={`Go to slide ${index + 1}`}
        />
      ))}
    </div>
  );
}

export function ContinueReadingCarousel({
  books,
}: ContinueReadingCarouselProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [api, setApi] =
    useState<ReturnType<typeof import("embla-carousel-react").default>[1]>();

  // Sort books by lastOpened (most recent first)
  const sortedBooks = [...books].sort((a, b) => {
    const aTime = a.lastOpened ?? 0;
    const bTime = b.lastOpened ?? 0;
    return bTime - aTime;
  });

  // Track active slide
  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setActiveIndex(api.selectedScrollSnap());
    };

    api.on("select", onSelect);
    onSelect();

    return () => {
      api.off("select", onSelect);
    };
  }, [api]);

  const handleDotClick = (index: number) => {
    api?.scrollTo(index);
  };

  if (sortedBooks.length === 0) return null;

  // If only one book, just show hero card without carousel
  if (sortedBooks.length === 1) {
    return (
      <section>
        <HeroBookCard book={sortedBooks[0]} />
      </section>
    );
  }

  return (
    <section>
      <Carousel
        opts={{
          align: "start",
          loop: false,
        }}
        setApi={setApi}
        className="w-full overflow-visible"
      >
        <CarouselContent className="py-2">
          {/* All books as hero cards */}
          {sortedBooks.map((book) => (
            <CarouselItem
              key={book.id}
              className="basis-[85%] sm:basis-[70%] md:basis-[60%] lg:basis-[50%] first:ml-4 last:mr-4 md:first:ml-10 md:last:mr-10"
            >
              <HeroBookCard book={book} />
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      <CarouselDots
        count={sortedBooks.length}
        activeIndex={activeIndex}
        onDotClick={handleDotClick}
      />
    </section>
  );
}
