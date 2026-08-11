import React from "react";

export type StatusColor = "hp" | "mana" | "spirit" | "mind" | "resource" | "good" | "bad" | "warn" | "neutral";

export interface StatusDotProps {
  color: StatusColor;
  label: string;
  pulse?: boolean;
  size?: "sm" | "md";
  title?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function StatusDot({
  color,
  label,
  pulse = false,
  size = "md",
  title,
  style,
  className = "",
}: StatusDotProps) {
  return (
    <span
      className={`gs-status-dot-container${className ? ` ${className}` : ""}`}
      title={title || label}
      style={style}
    >
      <span
        className={`gs-dot gs-dot--${size} gs-dot--${color}${pulse ? " gs-dot--pulse" : ""}`}
        role="status"
        aria-label={label}
      />
      <span className="gs-status-dot-label">{label}</span>
    </span>
  );
}
