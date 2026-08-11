import React from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  invalid?: boolean;
  errorText?: string;
  hint?: string;
  style?: React.CSSProperties;
  className?: string;
}

export function Select({
  id,
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  required = false,
  invalid = false,
  errorText,
  hint,
  style,
  className = "",
}: SelectProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = errorText && invalid ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div
      className={`gs-select-group${invalid ? " gs-select-group--invalid" : ""}${disabled ? " gs-select-group--disabled" : ""}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {label && (
        <label className="gs-select__label" htmlFor={id}>
          {label}
          {required && <span className="gs-select__required-indicator" aria-hidden="true"> *</span>}
        </label>
      )}
      <div className="gs-select">
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          required={required}
          aria-invalid={invalid ? "true" : undefined}
          aria-describedby={describedBy}
          className="gs-select__control"
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="gs-select__chevron" aria-hidden="true">
          ▾
        </span>
      </div>
      {errorText && invalid && (
        <p className="gs-select__error" id={errorId}>
          {errorText}
        </p>
      )}
      {hint && (!errorText || !invalid) && (
        <p className="gs-select__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
