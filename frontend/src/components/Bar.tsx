import React from "react";

export type BarColor = "hp" | "mana" | "spirit" | "mind" | "resource";

export interface BarProps {
  value: number;
  max?: number;
  color: BarColor;
  label?: string;
  size?: "sm" | "md";
  animated?: boolean;
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function Bar({
  value,
  max = 100,
  color,
  label,
  size = "md",
  animated = true,
  ariaLabel,
  style,
  className = "",
}: BarProps) {
  const percentage = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const displayLabel = label || `${value} / ${max}`;

  return (
    <div
      className={`gs-bar gs-bar--${color} gs-bar--${size}${animated ? " gs-bar--animated" : ""}${className ? ` ${className}` : ""}`}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={ariaLabel}
      style={style}
    >
      <div
        className="gs-bar__fill"
        style={{ width: `${percentage}%` }}
      />
      {displayLabel && <span className="gs-bar__label">{displayLabel}</span>}
    </div>
  );
}
