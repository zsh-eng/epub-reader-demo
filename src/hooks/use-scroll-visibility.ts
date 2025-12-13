import { useEffect, useState } from "react";

export function useScrollVisibility(threshold = 100) {
  const [isVisible, setIsVisible] = useState(false);
  const [lastScrollY, setLastScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;

    const updateVisibility = () => {
      const currentScrollY = window.scrollY;

      // Always show at the very top
      if (currentScrollY < threshold) {
        setIsVisible(true);
        setLastScrollY(currentScrollY);
        ticking = false;
        return;
      }

      // Determine direction
      const isScrollingDown = currentScrollY > lastScrollY;
      const scrollDifference = Math.abs(currentScrollY - lastScrollY);

      // Only toggle if we've scrolled a significant amount to avoid jitter
      if (scrollDifference > 50) {
        setIsVisible(!isScrollingDown);
        setLastScrollY(currentScrollY);
      }

      ticking = false;
    };

    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(updateVisibility);
        ticking = true;
      }
    };

    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [lastScrollY, threshold]);

  return isVisible;
}
