import { AnimatedNumber } from "@/components/ui/animated-number";
import { motion } from "motion/react";
import { FOOTER_READY_DETAIL_DELAY } from "./FooterLoadingState";

interface FooterPageIndicatorProps {
  currentPage: number;
  totalPages: number;
  isLoading?: boolean;
  preserveDetailsWhileLoading?: boolean;
  animateReadyDetails?: boolean;
}

export function FooterPageIndicator({
  currentPage,
  totalPages,
  isLoading = false,
  preserveDetailsWhileLoading = false,
  animateReadyDetails = false,
}: FooterPageIndicatorProps) {
  const showBlurredLoadingDetails = isLoading && preserveDetailsWhileLoading;

  if (isLoading && !showBlurredLoadingDetails) {
    return <div aria-hidden="true" className="h-[18px] pb-1 pt-0.5" />;
  }

  return (
    <motion.div
      className="flex items-center justify-center pb-1 pt-0.5"
      initial={
        animateReadyDetails
          ? { opacity: 0, filter: "blur(8px)" }
          : false
      }
      animate={{
        opacity: showBlurredLoadingDetails ? 0.78 : 1,
        filter: showBlurredLoadingDetails ? "blur(6px)" : "blur(0px)",
      }}
      transition={
        animateReadyDetails || showBlurredLoadingDetails
          ? {
              duration: 0.24,
              delay: FOOTER_READY_DETAIL_DELAY,
              ease: [0.22, 1, 0.36, 1],
            }
          : undefined
      }
    >
      {/* Sadly we can't use DM Sans here as it doesn't support tabular-nums
        See: https://github.com/googlefonts/dm-fonts/issues/25 */}
      <span className="text-[10px] font-numeric font-medium uppercase tracking-[0.14em] text-muted-foreground tabular-nums">
        <span className="text-foreground">
          p.{" "}
          <AnimatedNumber
            value={currentPage}
            springConfig={{ stiffness: 300, damping: 30, mass: 1 }}
          />
        </span>
        {" of "}
        {totalPages > 0 ? totalPages : "—"}
      </span>
    </motion.div>
  );
}
