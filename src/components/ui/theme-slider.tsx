"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import "./theme-slider.css";

export interface ThemeSliderProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Current value (controlled) */
  value?: number;
  /** Default value (uncontrolled) */
  defaultValue?: number;
  /** Minimum value */
  min?: number;
  /** Maximum value */
  max?: number;
  /** Step increment */
  step?: number;
  /** Show percentage label */
  showPercentage?: boolean;
  /** Number of dot indicators to show (0 to hide) */
  dotCount?: number;
  /** Callback when value changes */
  onValueChange?: (value: number) => void;
}

function ThemeSlider({
  className,
  value,
  defaultValue = 0,
  min = 0,
  max = 100,
  step = 1,
  showPercentage = true,
  dotCount = 2,
  onValueChange,
  onChange,
  ...props
}: ThemeSliderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [internalValue, setInternalValue] = React.useState(defaultValue);

  const currentValue = value !== undefined ? value : internalValue;
  // Use decimal (0-1) for CSS calc, and percentage (0-100) for display
  const decimalProgress = (currentValue - min) / (max - min);
  const percentage = decimalProgress * 100;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseFloat(e.target.value);
    if (value === undefined) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
    onChange?.(e);
  };

  // Calculate dot positions (evenly distributed between filled area and end)
  const dotPositions = React.useMemo(() => {
    if (dotCount <= 0) return [];
    const positions: number[] = [];
    for (let i = 1; i <= dotCount; i++) {
      positions.push((i / (dotCount + 1)) * 100);
    }
    return positions;
  }, [dotCount]);

  return (
    <div className={cn("flex w-full items-center gap-4", className)}>
      <div className="relative flex h-12 flex-1 items-center">
        {/* Native range input for interaction - placed first for peer styling */}
        <input
          ref={inputRef}
          type="range"
          className="theme-slider-input peer absolute inset-0 z-10 m-0 h-full w-full cursor-grab p-0 opacity-0 active:cursor-grabbing"
          value={currentValue}
          min={min}
          max={max}
          step={step}
          onChange={handleChange}
          {...props}
        />

        {/* The outer track (muted background) */}
        <div className="absolute inset-0 overflow-visible rounded-lg bg-muted peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
          {/* Filled portion with internal padding */}
          <div
            className="theme-slider-fill absolute bottom-1 left-1 top-1 flex min-w-10 items-center justify-end rounded-md bg-primary-foreground shadow-sm transition-[width] duration-[50ms] ease-out"
            style={
              { "--fill-progress": decimalProgress } as React.CSSProperties
            }
          >
            {/* Thumb/handle - vertical line */}
            <div className="pointer-events-none absolute right-0 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center">
              <div className="h-4 w-0.5 rounded-full bg-foreground opacity-40" />
            </div>
          </div>

          {/* Dot indicators */}
          {dotPositions.map((pos, index) => (
            <div
              key={index}
              className={cn(
                "pointer-events-none absolute top-1/2 z-[1] h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground transition-opacity duration-150 ease-linear",
                pos <= percentage ? "opacity-0" : "opacity-40",
              )}
              style={{ left: `${pos}%` }}
            />
          ))}
        </div>
      </div>

      {showPercentage && (
        <span className="min-w-12 text-right text-sm font-medium text-muted-foreground">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

export { ThemeSlider };
