import { useEffect, useMemo, useRef, useState } from "react";

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

const MONTH_LABELS = Array.from({ length: 12 }, (_, index) =>
  new Intl.DateTimeFormat(undefined, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, index, 1))),
);

const WEEKDAY_LABELS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

export function DateInputField({
  value,
  onChange,
  placeholder = "YYYY-MM-DD",
  disabled = false,
  id,
  required,
  "aria-describedby": ariaDescribedBy,
  pickerLabel,
  clearLabel,
}: DateInputFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const parsedValue = useMemo(() => parseIsoDate(value), [value]);
  const localizedValue = useMemo(() => formatDisplayDate(value), [value]);
  const [isOpen, setIsOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsedValue?.year ?? getTodayParts().year);
  const [viewMonth, setViewMonth] = useState(parsedValue?.month ?? getTodayParts().month);

  useEffect(() => {
    if (isOpen) {
      return;
    }

    const fallback = getTodayParts();
    setViewYear(parsedValue?.year ?? fallback.year);
    setViewMonth(parsedValue?.month ?? fallback.month);
  }, [isOpen, parsedValue]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const days = useMemo(() => buildCalendarDays(viewYear, viewMonth), [viewYear, viewMonth]);

  function openPicker() {
    if (disabled) {
      return;
    }

    const fallback = getTodayParts();
    const nextDate = parseIsoDate(value);
    setViewYear(nextDate?.year ?? fallback.year);
    setViewMonth(nextDate?.month ?? fallback.month);
    setIsOpen(true);
  }

  function moveMonth(direction: -1 | 1) {
    const moved = addMonth(viewYear, viewMonth, direction);
    setViewYear(moved.year);
    setViewMonth(moved.month);
  }

  function applyDay(day: number) {
    onChange(formatIsoDate(viewYear, viewMonth, day));
    setIsOpen(false);
  }

  function handleManualChange(nextValue: string) {
    onChange(nextValue);
  }

  return (
    <div className="date-input" ref={rootRef}>
      <div className="date-input__row">
        <input
          type="text"
          id={id}
          required={required}
          disabled={disabled}
          aria-describedby={ariaDescribedBy}
          value={value}
          placeholder={placeholder}
          inputMode="numeric"
          autoComplete="bday"
          onChange={(event) => handleManualChange(event.currentTarget.value)}
        />
        <div className="date-input__actions">
          <button
            type="button"
            className="date-input__button"
            onClick={() => (isOpen ? setIsOpen(false) : openPicker())}
            aria-label={pickerLabel}
            aria-expanded={isOpen}
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
      {isOpen ? (
        <div
          ref={popoverRef}
          className="date-picker"
          role="dialog"
          aria-label={`${pickerLabel} dialog`}
        >
          <div className="date-picker__toolbar">
            <button
              type="button"
              className="date-picker__nav"
              onClick={() => moveMonth(-1)}
              aria-label="Previous month"
            >
              Prev
            </button>
            <div className="date-picker__controls">
              <label className="visually-hidden" htmlFor={`${id ?? "date"}-month`}>
                Month
              </label>
              <select
                id={`${id ?? "date"}-month`}
                className="date-picker__select"
                value={viewMonth}
                onChange={(event) => setViewMonth(Number(event.currentTarget.value))}
              >
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={index + 1}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="visually-hidden" htmlFor={`${id ?? "date"}-year`}>
                Year
              </label>
              <input
                id={`${id ?? "date"}-year`}
                className="date-picker__year"
                type="number"
                inputMode="numeric"
                min="1"
                max="9999"
                value={viewYear}
                onChange={(event) => {
                  const nextYear = event.currentTarget.valueAsNumber;

                  if (Number.isInteger(nextYear) && nextYear >= 1 && nextYear <= 9999) {
                    setViewYear(nextYear);
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="date-picker__nav"
              onClick={() => moveMonth(1)}
              aria-label="Next month"
            >
              Next
            </button>
          </div>

          <div className="date-picker__weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="date-picker__grid">
            {days.map((day, index) =>
              day ? (
                <button
                  key={`${viewYear}-${viewMonth}-${day}`}
                  type="button"
                  className={`date-picker__day${
                    parsedValue &&
                    parsedValue.year === viewYear &&
                    parsedValue.month === viewMonth &&
                    parsedValue.day === day
                      ? " date-picker__day--selected"
                      : ""
                  }`}
                  onClick={() => applyDay(day)}
                >
                  {day}
                </button>
              ) : (
                <span key={`empty-${index}`} className="date-picker__day date-picker__day--empty" />
              ),
            )}
          </div>

          <div className="date-picker__footer">
            <button
              type="button"
              className="date-picker__footer-button"
              onClick={() => {
                const today = getTodayParts();
                onChange(formatIsoDate(today.year, today.month, today.day));
                setViewYear(today.year);
                setViewMonth(today.month);
                setIsOpen(false);
              }}
            >
              Today
            </button>
            <button
              type="button"
              className="date-picker__footer-button date-picker__footer-button--secondary"
              onClick={() => setIsOpen(false)}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  if (month < 1 || month > 12) {
    return null;
  }

  const maxDay = getDaysInMonth(year, month);

  if (day < 1 || day > maxDay) {
    return null;
  }

  return { year, month, day };
}

function formatDisplayDate(value: string): string {
  const parsed = parseIsoDate(value);

  if (!parsed) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)));
}

function buildCalendarDays(year: number, month: number): Array<number | null> {
  const firstDay = new Date(Date.UTC(year, month - 1, 1));
  const firstWeekday = (firstDay.getUTCDay() + 6) % 7;
  const daysInMonth = getDaysInMonth(year, month);
  const days: Array<number | null> = Array.from({ length: firstWeekday }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(day);
  }

  while (days.length % 7 !== 0) {
    days.push(null);
  }

  return days;
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addMonth(year: number, month: number, direction: -1 | 1): { year: number; month: number } {
  const date = new Date(Date.UTC(year, month - 1 + direction, 1));

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
  };
}

function getTodayParts() {
  const today = new Date();

  return {
    year: today.getUTCFullYear(),
    month: today.getUTCMonth() + 1,
    day: today.getUTCDate(),
  };
}
