import { useEffect, useRef, useState } from "react";

/**
 * Reports when a search surface has left its initial position and is now
 * attached to the top edge. Pages use this state for the same compact sticky
 * treatment without coupling their search controls.
 */
export function useSearchStickyState() {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsCompact(!entry.isIntersecting),
      { rootMargin: "-12px 0px 0px 0px", threshold: 0 },
    );
    observer.observe(anchor);

    return () => observer.disconnect();
  }, []);

  return { anchorRef, isCompact };
}
