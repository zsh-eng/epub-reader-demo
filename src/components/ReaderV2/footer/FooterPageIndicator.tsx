import { AnimatedNumber } from "@/components/ui/animated-number";

interface FooterPageIndicatorProps {
  currentPage: number;
  totalPages: number;
}

export function FooterPageIndicator({
  currentPage,
  totalPages,
}: FooterPageIndicatorProps) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="text-xs text-muted-foreground tabular-nums">
        <span className="text-foreground font-medium">
          pg.{" "}
          <AnimatedNumber
            value={currentPage}
            springConfig={{ stiffness: 300, damping: 30, mass: 1 }}
          />
        </span>
        {" of "}
        {totalPages > 0 ? totalPages : "—"}
      </span>
    </div>
  );
}
