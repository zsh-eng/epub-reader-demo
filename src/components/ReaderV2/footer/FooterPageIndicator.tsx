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
    <div className="flex items-center justify-center pb-1 pt-0.5">
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
    </div>
  );
}
