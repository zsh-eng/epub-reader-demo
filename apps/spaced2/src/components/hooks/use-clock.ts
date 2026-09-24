import { nextStudyDayStart } from "@/lib/study-day";
import { useEffect, useState } from "react";

/** Refresh at a time boundary, and after the page resumes from sleep. */
export function useClock(boundaries: number[]) {
  const [now, setNow] = useState(Date.now);
  const next = Math.min(...boundaries.filter((boundary) => boundary > now));
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = Number.isFinite(next)
      ? window.setTimeout(
          refresh,
          Math.min(2_147_483_647, Math.max(0, next - Date.now()) + 1),
        )
      : undefined;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [next, now]);
  return now;
}

/** Refresh statistics at the next local 04:00 boundary and on resume. */
export function useStatisticsClock() {
  return useClock([nextStudyDayStart(Date.now())]);
}
