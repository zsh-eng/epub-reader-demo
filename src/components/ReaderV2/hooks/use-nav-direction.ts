import type { UsePaginationResult } from "@/lib/pagination-v2/use-pagination";
import { useCallback, useRef } from "react";

export type NavDirection = "forward" | "backward" | "instant";

export function useNavDirection(pagination: UsePaginationResult) {
  const directionRef = useRef<NavDirection>("instant");

  const handleNextSpread = useCallback(() => {
    directionRef.current = "forward";
    pagination.nextSpread();
  }, [pagination.nextSpread]);

  const handlePrevSpread = useCallback(() => {
    directionRef.current = "backward";
    pagination.prevSpread();
  }, [pagination.prevSpread]);

  const handleGoToPage = useCallback(
    (page: number) => {
      directionRef.current = "instant";
      pagination.goToPage(page);
    },
    [pagination.goToPage],
  );

  const handleGoToChapter = useCallback(
    (chapterIndex: number) => {
      directionRef.current = "instant";
      pagination.goToChapter(chapterIndex);
    },
    [pagination.goToChapter],
  );

  return {
    directionRef,
    handleNextSpread,
    handlePrevSpread,
    handleGoToPage,
    handleGoToChapter,
  };
}
