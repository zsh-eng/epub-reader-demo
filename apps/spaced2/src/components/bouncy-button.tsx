import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";

export default function BouncyButton({
  children,
  variant = "default",
  className,
  pressed,
  asButton = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode;
  variant?: "default" | "medium" | "large";
  className?: string;
  pressed?: boolean;
  asButton?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const [isPressed, setIsPressed] = useState(false);
  const [isReleased, setIsReleased] = useState(false);

  const handlePress = useCallback(() => {
    setIsPressed(true);
    setIsReleased(false);
  }, []);

  const handleRelease = useCallback(() => {
    if (!isPressed) return;
    setIsPressed(false);
    setIsReleased(true);
    // Reset the release state after the animation
    setTimeout(() => setIsReleased(false), 150);
  }, [isPressed]);

  useEffect(() => {
    if (!isPressed) return;

    const handleMouseUp = () => {
      handleRelease();
    };

    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [isPressed, handleRelease]);

  useEffect(() => {
    if (pressed === undefined) return;

    if (pressed && !isPressed) {
      handlePress();
    } else if (!pressed && isPressed) {
      handleRelease();
    }
  }, [pressed, isPressed, handlePress, handleRelease]);

  const Comp = asButton ? "button" : "div";

  return (
    <Comp
      className={cn(
        "h-max w-max cursor-pointer transition-transform duration-150 active:duration-100",
        !disabled && isPressed && "scale-90",
        !disabled && isReleased && "scale-105",
        variant == "medium" && !disabled && isPressed && "scale-95",
        variant == "medium" && !disabled && "duration-200 active:duration-150",
        variant == "medium" && !disabled && isReleased && "scale-102",
        variant == "large" && !disabled && isPressed && "scale-98",
        variant == "large" && !disabled && "duration-300 active:duration-200",
        variant == "large" && !disabled && isReleased && "scale-101",
        disabled && "cursor-not-allowed",
        className,
      )}
      onMouseDown={handlePress}
      onMouseUp={handleRelease}
      onMouseLeave={handleRelease}
      onDragEnd={handleRelease}
      onTouchStart={handlePress}
      onTouchEnd={handleRelease}
      onClick={onClick}
    >
      {children}
    </Comp>
  );
}
