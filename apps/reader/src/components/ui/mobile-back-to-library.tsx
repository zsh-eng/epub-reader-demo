import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { Link } from "react-router-dom";

interface MobileBackToLibraryProps {
  className?: string;
}

/** Mobile page-chrome control for returning to the Library. */
export function MobileBackToLibrary({ className }: MobileBackToLibraryProps) {
  return (
    <Button
      render={<Link to="/" />}
      variant="ghost"
      size="icon-sm"
      aria-label="Back to library"
      className={cn(
        "size-8 rounded-full border border-border/70 bg-background/70 text-muted-foreground hover:bg-background hover:text-foreground md:hidden",
        className,
      )}
    >
      <ChevronLeft className="size-4" />
    </Button>
  );
}
