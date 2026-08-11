import React from "react";

export interface CardProps {
  title?: React.ReactNode;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  interactive?: boolean;
  onClick?: () => void;
  padding?: "default" | "compact" | "none";
  ariaLabel?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function Card({
  title,
  headerActions,
  children,
  footer,
  interactive = false,
  onClick,
  padding = "default",
  ariaLabel,
  style,
  className = "",
}: CardProps) {
  const hasHeader = !!title || !!headerActions;
  const Tag = interactive ? "div" : "section";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (interactive && onClick && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <Tag
      className={`gs-card gs-card--pad-${padding}${interactive ? " gs-card--interactive" : ""}${className ? ` ${className}` : ""}`}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-label={ariaLabel}
      style={style}
    >
      {hasHeader && (
        <header className="gs-card__header">
          {title && <span className="gs-card__title">{title}</span>}
          {headerActions && <div className="gs-card__actions">{headerActions}</div>}
        </header>
      )}
      <div className="gs-card__body">{children}</div>
      {footer && <footer className="gs-card__footer">{footer}</footer>}
    </Tag>
  );
}
