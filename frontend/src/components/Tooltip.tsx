import React, { useState, useRef, useEffect } from "react";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  delayMs?: number;
  disabled?: boolean;
}

export function Tooltip({
  content,
  children,
  placement = "top",
  delayMs = 400,
  disabled = false,
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const idRef = useRef(`tooltip-${Math.random().toString(36).substring(2, 9)}`);

  const show = () => {
    if (disabled || !content) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setVisible(true);
    }, delayMs);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Handle ESC key to dismiss tooltip
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        hide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible]);

  if (disabled || !content) {
    return <>{children}</>;
  }

  // Children must be cloneable/focusable. If child is a text node, wrap in a span
  const trigger = React.isValidElement(children) ? (
    children
  ) : (
    <span tabIndex={0}>{children}</span>
  );

  // Extend child events
  const triggerProps = {
    onMouseEnter: (e: React.MouseEvent) => {
      trigger.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      trigger.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      trigger.props.onFocus?.(e);
      show();
    },
    onBlur: (e: React.FocusEvent) => {
      trigger.props.onBlur?.(e);
      hide();
    },
    "aria-describedby": idRef.current,
  };

  const clonedTrigger = React.cloneElement(trigger, triggerProps);

  return (
    <span className="gs-tooltip-wrapper">
      {clonedTrigger}
      {visible && (
        <span
          id={idRef.current}
          className={`gs-tooltip gs-tooltip--${placement}`}
          role="tooltip"
        >
          {content}
        </span>
      )}
    </span>
  );
}
