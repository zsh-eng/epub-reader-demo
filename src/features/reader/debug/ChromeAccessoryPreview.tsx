import { ArrowRight, BookOpen, Laptop, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ChromePromptKind = "reading" | "handoff";
export type ChromePromptAppearance = "soft" | "minimal" | "outline";

const surfaces: Record<ChromePromptAppearance, string> = {
  soft: "border-transparent bg-secondary/70",
  minimal: "border-transparent bg-transparent",
  outline: "border-border bg-background/60",
};

/** Visual experiment only. Actions are supplied by the local playground. */
export function ChromeAccessoryPreview({
  kind,
  appearance,
  deviceName,
  targetPage,
  restart,
  onConfirm,
  onDismiss,
}: {
  kind: ChromePromptKind;
  appearance: ChromePromptAppearance;
  deviceName: string;
  targetPage: number;
  restart: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const handoff = kind === "handoff";
  const label = handoff
    ? `Continue at p. ${targetPage}`
    : restart
      ? "Start again"
      : "Start reading";
  const detail = handoff
    ? `Newer position on ${deviceName}: page ${targetPage}`
    : restart
      ? "Give this book another try"
      : "Mark this book as currently reading";
  const Icon = handoff ? Laptop : BookOpen;
  return (
    <div
      data-testid="chrome-accessory"
      className={cn(
        "mr-2 flex h-9 min-w-0 items-center gap-0.5 rounded-xl border p-0.5",
        surfaces[appearance],
      )}
    >
      <Button
        variant="ghost"
        size="sm"
        title={detail}
        aria-label={handoff ? `${label} from ${deviceName}` : label}
        onClick={onConfirm}
        className="h-7 min-w-0 shrink-0 gap-2 rounded-[calc(var(--radius-xl)-3px)] px-2 text-xs hover:bg-muted"
      >
        <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="whitespace-nowrap">{label}</span>
        {handoff && (
          <ArrowRight
            className="size-3.5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </Button>
      <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
      <Button
        variant="ghost"
        size="icon-sm"
        title="Dismiss"
        aria-label={
          handoff ? "Dismiss sync prompt" : "Dismiss reading status prompt"
        }
        onClick={onDismiss}
        className="size-7 rounded-[calc(var(--radius-xl)-3px)] text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
