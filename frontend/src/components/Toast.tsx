import React, { createContext, useContext, useState, useEffect, useRef } from "react";

export type ToastTone = "good" | "bad" | "warn" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  title?: React.ReactNode;
  message: React.ReactNode;
  action?: { label: string; onClick: () => void };
  duration?: number; // ms; default 5000; 0 = sticky
}

interface ToastContextType {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = (toast: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { ...toast, id }]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toasts, addToast, dismissToast }}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

interface ToastItemProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: ToastItemProps) {
  const { id, tone, title, message, action, duration = 5000 } = toast;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);
  const remainingRef = useRef<number>(duration);

  const startTimer = () => {
    if (duration === 0) return; // sticky
    startTimeRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      onDismiss(id);
    }, remainingRef.current);
  };

  const pauseTimer = () => {
    if (duration === 0) return;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      remainingRef.current -= Date.now() - startTimeRef.current;
    }
  };

  useEffect(() => {
    startTimer();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, duration]);

  const handleAction = () => {
    if (action) {
      action.onClick();
      onDismiss(id);
    }
  };

  const toneIcon = {
    good: "✓",
    bad: "✕",
    warn: "⚠",
    info: "ℹ",
  }[tone];

  const role = tone === "bad" ? "alert" : "status";

  return (
    <div
      className={`gs-toast gs-toast--${tone}`}
      role={role}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <div className="gs-toast__header">
        <span className={`gs-toast__icon gs-toast__icon--${tone}`}>{toneIcon}</span>
        {title && <span className="gs-toast__title">{title}</span>}
      </div>
      <div className="gs-toast__body">{message}</div>
      <div className="gs-toast__actions">
        {action && (
          <button
            type="button"
            className="gs-btn gs-btn--primary gs-btn--sm gs-toast__action"
            onClick={handleAction}
          >
            {action.label}
          </button>
        )}
        <button
          type="button"
          className="gs-toast__close-btn"
          onClick={() => onDismiss(id)}
          aria-label="Dismiss notification"
        >
          ×
        </button>
      </div>
    </div>
  );
}

export interface ToastHostProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  position?: "top-right" | "bottom-right" | "top-center";
}

export function ToastHost({
  toasts,
  onDismiss,
  position = "top-right",
}: ToastHostProps) {
  return (
    <div className={`gs-toast-host gs-toast-host--${position}`} aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
