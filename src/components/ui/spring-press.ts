import { useReducedMotion } from "motion/react";

/**
 * Shared tactile feedback for large sheet controls.
 *
 * The control compresses quickly on contact, then returns with a short spring.
 * Reduced-motion users get an opacity response without spatial movement.
 */
export function useSpringPressAnimation() {
  const prefersReducedMotion = useReducedMotion();

  if (prefersReducedMotion) {
    return {
      animate: { opacity: 1 },
      whileTap: {
        opacity: 0.82,
        transition: { duration: 0.1, ease: "easeOut" as const },
      },
      transition: { duration: 0.1, ease: "easeOut" as const },
    };
  }

  return {
    animate: { transform: "scale(1)" },
    whileTap: {
      transform: "scale(0.97)",
    },
    transition: {
      type: "spring" as const,
      duration: 0.16,
      bounce: 0.25,
    },
  };
}
