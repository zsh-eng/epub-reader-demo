import { motion, useSpring, useTransform } from "motion/react";
import { useEffect } from "react";

interface AnimatedNumberProps {
  value: number;
  /** Format function for the displayed number (e.g., adding suffix like "%") */
  format?: (value: number) => string;
  /** Spring animation configuration */
  springConfig?: {
    stiffness?: number;
    damping?: number;
    mass?: number;
  };
  className?: string;
}

export function AnimatedNumber({
  value,
  format = (v) => Math.round(v).toString(),
  springConfig = { stiffness: 300, damping: 30, mass: 1 },
  className,
}: AnimatedNumberProps) {
  const spring = useSpring(value, springConfig);
  const display = useTransform(spring, (current) => format(current));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={className}>{display}</motion.span>;
}
