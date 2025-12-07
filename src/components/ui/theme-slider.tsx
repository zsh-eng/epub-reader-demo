"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { HandGrab } from "lucide-react";
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
    <div className={cn("theme-slider-container", className)}>
      <div className="theme-slider-wrapper">
        <div className="theme-slider-track">
          {/* Filled portion with padding */}
          <div
            className="theme-slider-fill"
            style={
              { "--fill-progress": decimalProgress } as React.CSSProperties
            }
          >
            {/* Thumb/handle with grab icon */}
            {/*<div className="theme-slider-thumb">
              <HandGrab className="theme-slider-thumb-icon" />
            </div>*/}
          </div>

          {/* Dot indicators */}
          {dotPositions.map((pos, index) => (
            <div
              key={index}
              className="theme-slider-dot"
              style={{ left: `${pos}%` }}
              data-filled={pos <= percentage}
            />
          ))}
        </div>

        {/* Native range input for interaction */}
        <input
          ref={inputRef}
          type="range"
          className="theme-slider-input"
          value={currentValue}
          min={min}
          max={max}
          step={step}
          onChange={handleChange}
          {...props}
        />
      </div>

      {showPercentage && (
        <span className="theme-slider-percentage">
          {Math.round(percentage)}%
        </span>
      )}
    </div>
  );
}

export { ThemeSlider };
