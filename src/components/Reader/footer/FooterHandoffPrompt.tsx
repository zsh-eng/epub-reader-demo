import { Button } from "@/components/ui/button";
import { ArrowRight, Laptop, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReaderHandoffPrompt } from "../types";

interface FooterHandoffPromptProps {
  prompt: ReaderHandoffPrompt;
}

export function FooterHandoffPrompt({ prompt }: FooterHandoffPromptProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 72, scale: 0.98, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -2, scale: 0.985, filter: "blur(6px)" }}
      transition={{
        opacity: { duration: 0.18, ease: "easeOut" },
        y: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
        scale: { duration: 0.18, ease: "easeOut" },
        filter: { duration: 0.18, ease: "easeOut" },
      }}
      className="pointer-events-auto px-3 sm:px-4"
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-[min(100%,34rem)] items-center gap-1.5 rounded-full border border-border/80 bg-background p-1 shadow-lg shadow-background/20 backdrop-blur-xl">
        <button
          type="button"
          onClick={prompt.onJump}
          className="group flex min-w-0 flex-1 items-center gap-2 rounded-full px-2 py-1.5 text-left transition-colors hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-border/70 bg-secondary/70 text-foreground">
            <Laptop className="size-3.5" aria-hidden="true" />
          </span>

          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-medium uppercase leading-none text-muted-foreground">
              Newer position
            </span>
            <span className="mt-1 block truncate text-[12px] font-medium leading-none text-foreground">
              Continue from {prompt.sourceLabel}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-[11px] font-medium tabular-nums text-foreground transition-colors group-hover:bg-background">
            <span>p.</span>
            <span className="relative inline-grid min-w-[2.4em] overflow-hidden text-right">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span
                  key={prompt.targetPage}
                  initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                  transition={{
                    opacity: { duration: 0.14, ease: "easeOut" },
                    y: { duration: 0.18, ease: [0.16, 1, 0.3, 1] },
                    filter: { duration: 0.14, ease: "easeOut" },
                  }}
                  className="col-start-1 row-start-1 tabular-nums"
                >
                  {prompt.targetPage}
                </motion.span>
              </AnimatePresence>
            </span>
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </span>
        </button>

        <Button
          variant="ghost"
          size="icon-sm"
          onClick={prompt.onDismiss}
          aria-label="Dismiss handoff prompt"
          className="size-8 rounded-full border border-border/70 bg-background/50 text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </motion.div>
  );
}
