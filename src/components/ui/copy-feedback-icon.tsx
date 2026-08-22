import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Check, Copy } from "lucide-react";

interface CopyFeedbackIconProps {
  copied: boolean;
  className?: string;
}

/** Keeps copy confirmation compact without moving the surrounding control. */
export function CopyFeedbackIcon({ copied, className }: CopyFeedbackIconProps) {
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <span
      className={cn("relative grid place-items-center", className)}
      aria-hidden="true"
    >
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={copied ? "copied" : "copy"}
          className="absolute inset-0 grid place-items-center"
          initial={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, transform: "scale(0.88)" }
          }
          animate={{ opacity: 1, transform: "scale(1)" }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : { opacity: 0, transform: "scale(0.88)" }
          }
          transition={{
            duration: reducedMotion ? 0.1 : 0.15,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          {copied ? (
            <Check className="size-full" />
          ) : (
            <Copy className="size-full" />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
