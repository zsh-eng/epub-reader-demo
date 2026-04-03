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
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
      <div className={cn("space-y-3 text-center", contentClassName)}>
        {showSpinner && (
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        )}

        {title && (
          <p
            className={cn(
              "font-medium",
              titleTone === "destructive" && "text-destructive",
            )}
          >
            {title}
          </p>
        )}

        {message && <p className="text-sm text-muted-foreground">{message}</p>}

        {action && (
          <Button variant={action.variant ?? "outline"} onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
