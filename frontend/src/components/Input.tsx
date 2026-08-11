import React from "react";

export interface InputProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "number" | "search" | "password" | "email";
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  invalid?: boolean;
  errorText?: string;
  hint?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  style?: React.CSSProperties;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function Input({
  id,
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  prefix,
  suffix,
  disabled = false,
  readOnly = false,
  required = false,
  invalid = false,
  errorText,
  hint,
  autoFocus = false,
  autoComplete,
  style,
  className = "",
  onKeyDown,
}: InputProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errorText && invalid ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={`gs-input-group${invalid ? " gs-input-group--invalid" : ""}${disabled ? " gs-input-group--disabled" : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {label && (
        <label className="gs-input__label" htmlFor={id}>
          {label}
          {required && <span className="gs-input__required-indicator" aria-hidden="true"> *</span>}
        </label>
      )}
      <div className="gs-input">
        {prefix && <span className="gs-input__prefix">{prefix}</span>}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          className="gs-input__control"
          onKeyDown={onKeyDown}
        />
        {suffix && <span className="gs-input__suffix">{suffix}</span>}
      </div>
      {errorText && invalid && (
        <p className="gs-input__error" id={errorId}>
          {errorText}
        </p>
      )}
      {hint && (!errorText || !invalid) && (
        <p className="gs-input__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
