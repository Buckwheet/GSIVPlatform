import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

export interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  loading?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
  ariaPressed?: boolean;
  title?: string;
  dataTestid?: string;
  style?: React.CSSProperties;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  type = "button",
  disabled = false,
  loading = false,
  onClick,
  ariaLabel,
  ariaPressed,
  title,
  dataTestid,
  style,
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`gs-btn gs-btn--${variant} gs-btn--${size}${loading ? " gs-btn--loading" : ""}`}
      disabled={disabled || loading}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      aria-busy={loading ? "true" : undefined}
      title={title}
      data-testid={dataTestid}
      style={style}
    >
      {loading && (
        <span className="gs-btn__spinner" aria-hidden="true">
          ⌛
        </span>
      )}
      <span className="gs-btn__label">{children}</span>
    </button>
  );
}
