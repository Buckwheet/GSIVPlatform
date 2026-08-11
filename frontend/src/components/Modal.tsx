import React, { useEffect, useRef } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  closeOnBackdrop = true,
  closeOnEsc = true,
  initialFocusRef,
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Handle open/close side effects (body scroll lock, focus restore)
  useEffect(() => {
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      document.body.style.overflow = "hidden";

      // Focus management
      if (initialFocusRef && initialFocusRef.current) {
        initialFocusRef.current.focus();
      } else if (modalRef.current) {
        // Try focusing the first focusable element inside the modal, or the modal container
        const focusable = modalRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          (focusable[0] as HTMLElement).focus();
        } else {
          modalRef.current.focus();
        }
      }
    } else {
      document.body.style.overflow = "";
      if (previousFocus.current) {
        previousFocus.current.focus();
      }
    }

    return () => {
      document.body.style.overflow = "";
    };
  }, [open, initialFocusRef]);

  // Handle ESC key
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (closeOnEsc && e.key === "Escape") {
        onClose();
      }

      // Focus trapping
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusableElements.length === 0) {
          e.preventDefault();
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, closeOnEsc, onClose]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (closeOnBackdrop && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="gs-modal-wrapper"
      role="none"
      onClick={handleBackdropClick}
    >
      <div className="gs-modal__scrim" />
      <div
        ref={modalRef}
        className={`gs-modal__dialog gs-modal__dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="gs-modal-title"
        tabIndex={-1}
      >
        <header className="gs-modal__header">
          <h2 id="gs-modal-title" className="gs-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="gs-modal__close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="gs-modal__body">{children}</div>
        {footer && <footer className="gs-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}
