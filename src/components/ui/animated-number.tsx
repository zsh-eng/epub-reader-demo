import {
  AnimatePresence,
  motion,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { useEffect } from "react";

interface AnimatedNumberProps {
  value: number;
  /** Format function for the displayed number (e.g., adding suffix like "%") */
  format?: (value: number) => string;
  /** Animation style for the displayed value */
  variant?: "spring" | "pop";
  /** Spring animation configuration */
  springConfig?: {
    stiffness?: number;
    damping?: number;
    mass?: number;
  };
  className?: string;
}

const defaultNumberFormat = (value: number) => Math.round(value).toString();
const defaultSpringConfig = { stiffness: 300, damping: 30, mass: 1 };

function SpringAnimatedNumber({
  value,
  format = defaultNumberFormat,
  springConfig = defaultSpringConfig,
  className,
}: AnimatedNumberProps) {
  const spring = useSpring(value, springConfig);
  const display = useTransform(spring, (current) => format(current));

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span className={className}>{display}</motion.span>;
}

function PopAnimatedNumber({
  value,
  format = defaultNumberFormat,
  className,
}: AnimatedNumberProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const display = format(value);

  return (
    <span className={className}>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={display}
          className="inline-block"
          initial={
            reducedMotion
              ? false
              : {
                  y: 6,
                  opacity: 0,
                  scale: 0.96,
                  filter: "blur(2px)",
                }
          }
          animate={{
            y: 0,
            opacity: 1,
            scale: 1,
            filter: "blur(0px)",
          }}
          exit={
            reducedMotion
              ? { opacity: 0 }
              : {
                  y: -6,
                  opacity: 0,
                  scale: 1.02,
                  filter: "blur(1px)",
                }
          }
          transition={
            reducedMotion
              ? { duration: 0 }
              : {
                  type: "spring",
                  stiffness: 520,
                  damping: 34,
                  mass: 0.7,
                }
          }
        >
          {display}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

export function AnimatedNumber({
  value,
  format: formatProp = defaultNumberFormat,
  variant = "spring",
  springConfig = defaultSpringConfig,
  className,
}: AnimatedNumberProps) {
  if (variant === "pop") {
    return (
      <PopAnimatedNumber
        value={value}
        format={formatProp}
        className={className}
      />
    );
  }

  return (
    <SpringAnimatedNumber
      value={value}
      format={formatProp}
      springConfig={springConfig}
      className={className}
    />
  );
}
