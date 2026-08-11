import React from "react";

export type BadgeColor = "neutral" | "hp" | "mana" | "spirit" | "mind" | "resource" | "good" | "bad" | "warn";
export type BadgeVariant = "tinted" | "solid" | "outline";

export interface BadgeProps {
  label: React.ReactNode;
  color?: BadgeColor;
  variant?: BadgeVariant;
  dot?: boolean;
  dismissible?: boolean;
  onDismiss?: () => void;
  title?: string;
}

export function Badge({
  label,
  color = "neutral",
  variant = "tinted",
  dot = false,
  dismissible = false,
  onDismiss,
  title,
}: BadgeProps) {
  // If dot is true and color is neutral, maybe don't render a dot, but follow spec:
  // variant tinted: bg tinted, text-strong, border, dot is status color
  // solid: bg status color, text-bg, no dot
  // outline: transparent, text is status color (or text-strong if low contrast), border status color, optional dot
  // neutral: bg panel, text-strong, border-control, no dot

  const showDot = dot && color !== "neutral" && variant !== "solid";

  return (
    <span
      className={`gs-badge gs-badge--${variant} gs-badge--${color}`}
      title={title}
    >
      {showDot && <span className={`gs-badge__dot gs-badge__dot--${color}`} aria-hidden="true" />}
      <span className="gs-badge__label">{label}</span>
      {dismissible && onDismiss && (
        <button
          type="button"
          className="gs-badge__dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </span>
  );
}
