import { useMemo, useRef } from "react";

interface DateInputFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  "aria-describedby"?: string;
  pickerLabel: string;
  clearLabel: string;
}

export function DateInputField({
  value,
  onChange,
  placeholder,
  disabled = false,
  id,
  required,
  "aria-describedby": ariaDescribedBy,
  pickerLabel,
  clearLabel,
}: DateInputFieldProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const localizedValue = useMemo(() => formatDisplayDate(value), [value]);

  function openPicker() {
    const input = inputRef.current;

    if (!input || disabled) {
      return;
    }

    if (typeof input.showPicker === "function") {
      input.showPicker();
      return;
    }

    input.focus();
  }

  return (
    <div className="date-input">
      <div className="date-input__row">
        <input
          ref={inputRef}
          type="date"
          id={id}
          required={required}
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
        <div className="date-input__actions">
          <button
            type="button"
            className="date-input__button"
            onClick={openPicker}
            aria-label={pickerLabel}
            disabled={disabled}
          >
            Pick
          </button>
          <button
            type="button"
            className="date-input__button date-input__button--secondary"
            onClick={() => onChange("")}
            aria-label={clearLabel}
            disabled={disabled || !value}
          >
            Clear
          </button>
        </div>
      </div>
      {localizedValue ? <span className="date-input__meta">{localizedValue}</span> : null}
    </div>
  );
}

function formatDisplayDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);

  if (!match) {
    return "";
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}
