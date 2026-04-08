import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

interface ReaderStateAction {
  label: string;
  onClick: () => void;
  variant?: ComponentProps<typeof Button>["variant"];
}

interface ReaderStateScreenProps {
  title?: string;
  message?: string;
  showSpinner?: boolean;
  titleTone?: "default" | "destructive";
  contentClassName?: string;
  action?: ReaderStateAction;
}

export function ReaderStateScreen(props: ReaderStateScreenProps) {
  const {
    title,
    message,
    showSpinner = false,
    titleTone = "default",
    contentClassName,
    action,
  } = props;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/20 font-sans text-foreground">
      <div className="flex min-h-screen items-center justify-center px-6 py-10">
        <div
          className={cn(
            "w-full max-w-sm space-y-4 rounded-[1.75rem] border border-border/60 bg-background/85 px-6 py-8 text-center backdrop-blur-sm",
            contentClassName,
          )}
        >
          {showSpinner && (
            <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-border border-t-foreground" />
          )}

          {title && (
            <p
              className={cn(
                "text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
                titleTone === "destructive" && "text-destructive",
              )}
            >
              {title}
            </p>
          )}

          {message && (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {message}
            </p>
          )}

          {action && (
            <Button
              variant={action.variant ?? "outline"}
              onClick={action.onClick}
              className="rounded-full border-border/60 bg-background/80 px-5 uppercase tracking-[0.12em] hover:bg-secondary/60"
            >
              {action.label}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
