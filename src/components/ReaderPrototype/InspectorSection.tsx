import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

interface InspectorSectionProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function InspectorSection({
  title,
  defaultOpen = true,
  children,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 py-2 cursor-pointer">
        <ChevronRight
          className="size-3 text-muted-foreground transition-transform duration-200"
          style={{ transform: open ? "rotate(90deg)" : undefined }}
        />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
