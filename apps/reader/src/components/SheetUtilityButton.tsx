import type { ReactNode } from "react";
import { motion } from "motion/react";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import { cn } from "@/lib/utils";

interface SheetUtilityButtonProps {
  label: string;
  accessibleLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

export function SheetUtilityButton({
  label,
  accessibleLabel,
  onClick,
  disabled = false,
  className,
  children,
}: SheetUtilityButtonProps) {
  const springPress = useSpringPressAnimation();

  return (
    <motion.button
      type="button"
      aria-label={accessibleLabel ?? label}
      title={accessibleLabel ?? label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-muted-foreground outline-none transition-[background-color,color] hover:bg-secondary/55 hover:text-foreground focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60",
        disabled && "cursor-not-allowed opacity-55",
        className,
      )}
      {...springPress}
    >
      {children}
      <span className="max-w-full truncate text-[10px] font-medium uppercase tracking-[0.12em]">
        {label}
      </span>
    </motion.button>
  );
}
