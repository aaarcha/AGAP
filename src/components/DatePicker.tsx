/**
 * A date field that follows the design instead of the OS picker: a text input
 * you can type into, a calendar toggle, a popover on screens >= 640px and a
 * bottom sheet below that — the same split src/components/Select.tsx uses for
 * its menu, so date entry looks and behaves like every other control here.
 *
 * Typing: "2026-10-27" or "10/27/2026" (also single-digit, dot/dash) are
 * accepted and normalized to YYYY-MM-DD on Enter or blur; anything else falls
 * back to the last valid day, and emptying the field clears it.
 *
 * Calendar keyboard: arrows move a day, Home/End the week, PageUp/PageDown the
 * month, Enter/Space picks, Esc closes. The month/year header opens a 12-month
 * grid (with year arrows) so nobody has to click through months one at a time.
 * Values are local calendar days as "YYYY-MM-DD" via lib/filters helpers.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useMediaQuery } from "../lib/hooks";
import { parseDay, parseDayInput, toIsoDay } from "../lib/filters";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

/** Full, deterministic day label (aria-labels and tests agree on it). */
export function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** The compact label: "Oct 27, 2026". */
export function shortDayLabel(iso: string): string {
  const d = parseDay(iso);
  return d ? `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}` : "";
}

const today = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (d: Date, delta: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + delta);
  return next;
};

const addMonths = (d: Date, delta: number) => new Date(d.getFullYear(), d.getMonth() + delta, 1);

/** 42 days covering the month `view` is in, starting on its Sunday. */
function monthGrid(view: Date): Date[] {
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** Keep the cursor's day-of-month valid when jumping to a shorter month. */
function clampDay(view: Date, day: number): number {
  return Math.min(day, new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate());
}

const inBounds = (d: Date, min?: string, max?: string) => {
  const iso = toIsoDay(d);
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
};

export type DatePickerProps = {
  /** "YYYY-MM-DD" or "" when nothing is picked. */
  value: string;
  onChange: (value: string) => void;
  /** Visible label above the field. */
  label?: string;
  /** Accessible name for the field when there is no visible label. */
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  /** Adds a 48px clear button inside the field (only shown with a value). */
  clearable?: boolean;
  /** Earliest / latest selectable day, "YYYY-MM-DD". */
  min?: string;
  max?: string;
  className?: string;
};

export function DatePicker({
  value,
  onChange,
  label,
  ariaLabel,
  placeholder = "YYYY-MM-DD",
  disabled,
  clearable,
  min,
  max,
  className = "",
}: DatePickerProps) {
  const baseId = useId();
  const wide = useMediaQuery("screen and (min-width: 640px)");
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** The month on screen, and the day the keyboard is on inside it. */
  const [view, setView] = useState(() => parseDay(value) ?? today());
  const [cursor, setCursor] = useState(() => parseDay(value) ?? today());
  /** The input's raw text: the value while it is valid, whatever was typed
   *  otherwise — committed on Enter/blur, reverted when it doesn't parse. */
  const [text, setText] = useState(value);

  const selected = parseDay(value);
  const title = label ?? ariaLabel ?? "Choose a date";
  const showClear = Boolean(clearable && value && !disabled);

  // Keep the text in step with the committed value (calendar pick, clear…).
  useEffect(() => {
    setText(value);
  }, [value]);

  // Opening lands on the selected day (or today); reopening repeats that.
  useEffect(() => {
    if (!open) return;
    const start = selected ?? today();
    setView(new Date(start.getFullYear(), start.getMonth(), 1));
    setCursor(start);
  }, [open, selected?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // Focus the cursor's cell so the arrow keys have somewhere to start —
  // popover and phone sheet alike, otherwise arrow keys start nowhere.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => focusDay(toIsoDay(cursor)), 0);
    return () => window.clearTimeout(id);
  }, [open, cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  function focusDay(iso: string) {
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${iso}"]`)?.focus();
  }

  function pick(iso: string) {
    onChange(iso);
    setText(iso);
    setOpen(false);
    inputRef.current?.focus();
  }

  /** Enter/blur: accept a typed day, fall back to the last valid one. */
  function commitText(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      if (value) onChange("");
      setText("");
      return;
    }
    const parsed = parseDayInput(trimmed);
    if (parsed) {
      const iso = toIsoDay(parsed);
      onChange(iso);
      setText(iso);
    } else {
      setText(value); // not a day — back to the last valid value
    }
  }

  function moveCursor(next: Date) {
    setCursor(next);
    if (next.getMonth() !== view.getMonth() || next.getFullYear() !== view.getFullYear()) {
      setView(new Date(next.getFullYear(), next.getMonth(), 1));
    }
    // The cell may only render after the month swapped — focus in the next frame.
    window.requestAnimationFrame(() => focusDay(toIsoDay(next)));
  }

  /** Typing lives in the input: Enter commits, Esc reverts an uncommitted edit. */
  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitText((e.target as HTMLInputElement).value);
      return;
    }
    if (e.key === "Escape" && !open) {
      setText(value);
      (e.target as HTMLInputElement).blur();
    }
  }

  /** Calendar keys — only while focus is inside the day grid, so the caret
   *  keys keep working in the input. */
  function onGridKeyDown(e: React.KeyboardEvent) {
    const k = e.key;
    let next: Date | null = null;
    if (k === "ArrowLeft") next = addDays(cursor, -1);
    else if (k === "ArrowRight") next = addDays(cursor, 1);
    else if (k === "ArrowUp") next = addDays(cursor, -7);
    else if (k === "ArrowDown") next = addDays(cursor, 7);
    else if (k === "Home") next = addDays(cursor, -cursor.getDay());
    else if (k === "End") next = addDays(cursor, 6 - cursor.getDay());
    else if (k === "PageUp") next = addMonths(cursor, -1);
    else if (k === "PageDown") next = addMonths(cursor, 1);
    else if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (inBounds(cursor, min, max)) pick(toIsoDay(cursor));
      return;
    } else return;
    e.preventDefault();
    moveCursor(next);
  }

  // Outside press closes (the field's own controls toggle it instead).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (fieldRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      commitText(text);
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      inputRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, text, value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Popover only: sit just below the field, flipped above when it would overflow.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !wide) return;
    const place = () => {
      const field = fieldRef.current;
      const panel = panelRef.current;
      if (!field || !panel) return;
      const r = field.getBoundingClientRect();
      const width = 300;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const height = panel.scrollHeight ?? 340;
      const below = r.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - 6 - height) : below;
      setPos({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, wide]);

  /** Jump the calendar to a whole month (the year/month grid). */
  function pickMonth(target: Date) {
    const day = clampDay(target, cursor.getDate());
    const next = new Date(target.getFullYear(), target.getMonth(), day);
    setView(new Date(target.getFullYear(), target.getMonth(), 1));
    setCursor(next);
    window.requestAnimationFrame(() => focusDay(toIsoDay(next)));
  }

  const calendar = (
    <CalendarPanel
      view={view}
      cursor={cursor}
      selected={selected}
      min={min}
      max={max}
      gridRef={gridRef}
      onShowMonth={(d) => setView(d)}
      onPickMonth={pickMonth}
      onKeyDown={onGridKeyDown}
      onPick={pick}
      onToday={() => pick(toIsoDay(today()))}
      onClear={() => { onChange(""); setText(""); setOpen(false); inputRef.current?.focus(); }}
      showClear={showClear}
    />
  );

  return (
    <div className={className}>
      {label && (
        <span id={`${baseId}-label`} className="mb-1 block text-xs font-semibold text-slate-600">
          {label}
        </span>
      )}
      <div ref={fieldRef} className="relative">
        <input
          ref={inputRef}
          id={baseId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label ? `${label} date` : ariaLabel ?? "Date"}
          aria-describedby={`${baseId}-hint`}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => commitText(text)}
          onKeyDown={onInputKeyDown}
          className={`min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${showClear ? "pr-24" : "pr-12"}`}
        />
        <span id={`${baseId}-hint`} className="sr-only">
          Type a date as YYYY-MM-DD or MM/DD/YYYY and press Enter.
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label ? `${label} calendar` : ariaLabel ?? "Choose date from calendar"}
          onClick={() => setOpen((v) => !v)}
          className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-r-xl text-slate-400 hover:text-brand-600 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          <Calendar size={18} aria-hidden />
        </button>
        {showClear && (
          <button
            type="button"
            aria-label={label ? `Clear ${label}` : "Clear date"}
            onClick={() => onChange("")}
            className="absolute right-12 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-slate-400 hover:text-slate-600"
          >
            <X size={16} aria-hidden />
          </button>
        )}
      </div>

      {open && !wide && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-end bg-black/55"
            onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}
          >
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label={title}
              className="w-full rounded-t-2xl bg-white p-4 shadow-2xl"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-800">{title}</h2>
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => { setOpen(false); inputRef.current?.focus(); }}
                  className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-slate-100"
                >
                  <X size={20} className="text-slate-500" aria-hidden />
                </button>
              </div>
              {calendar}
            </div>
          </div>,
          document.body,
        )}

      {open && wide && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={title}
            className="fixed z-[60] rounded-xl border border-slate-200 bg-white p-3 shadow-xl outline-none"
            style={pos ? { left: pos.left, top: pos.top, width: 300 } : { left: -9999, top: -9999, width: 300 }}
          >
            {calendar}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Header (month/year jump), weekday row + 6x7 day grid, or the 12-month
 *  grid. Keyboard for the day grid lives here. */
function CalendarPanel({
  view,
  cursor,
  selected,
  min,
  max,
  gridRef,
  onShowMonth,
  onPickMonth,
  onKeyDown,
  onPick,
  onToday,
  onClear,
  showClear,
}: {
  view: Date;
  cursor: Date;
  selected: Date | null;
  min?: string;
  max?: string;
  gridRef: React.RefObject<HTMLDivElement | null>;
  onShowMonth: (d: Date) => void;
  onPickMonth: (d: Date) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onPick: (iso: string) => void;
  onToday: () => void;
  onClear: () => void;
  showClear: boolean;
}) {
  /** days → months → years; the header walks one level deeper each click,
   *  and a year/month pick walks back out. */
  const [mode, setMode] = useState<"days" | "months" | "years">("days");
  const todayIso = toIsoDay(today());
  const days = monthGrid(view);
  const decadeStart = Math.floor(view.getFullYear() / 10) * 10;
  // Arrows step a month in the day view, a year in the month grid and a
  // decade in the year grid.
  const step = (delta: number) => onShowMonth(addMonths(view, mode === "days" ? delta : mode === "months" ? delta * 12 : delta * 120));
  const headerText =
    mode === "days"
      ? `${MONTHS[view.getMonth()]} ${view.getFullYear()}`
      : mode === "months"
        ? String(view.getFullYear())
        : `${decadeStart}–${decadeStart + 9}`;
  const deeper = () => setMode((m) => (m === "days" ? "months" : m === "months" ? "years" : "months"));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <button
          type="button"
          aria-label={mode === "days" ? "Previous month" : mode === "months" ? "Previous year" : "Previous decade"}
          onClick={() => step(-1)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <ChevronLeft size={18} aria-hidden />
        </button>
        {/* The header walks day → month → year grids; picks walk back out. */}
        <button
          type="button"
          aria-haspopup="grid"
          aria-expanded={mode !== "days"}
          aria-label={`${headerText} — change month and year`}
          onClick={deeper}
          className="flex min-h-10 flex-1 items-center justify-center rounded-lg px-2 text-sm font-bold text-slate-800 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-200"
        >
          {headerText}
        </button>
        <button
          type="button"
          aria-label={mode === "days" ? "Next month" : mode === "months" ? "Next year" : "Next decade"}
          onClick={() => step(1)}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
        >
          <ChevronRight size={18} aria-hidden />
        </button>
      </div>

      {mode === "years" && (
        <div role="group" aria-label={`Choose a year in the ${decadeStart}s`} className="grid grid-cols-5 gap-1">
          {Array.from({ length: 10 }, (_, k) => decadeStart + k).map((year) => {
            const active = selected != null && selected.getFullYear() === year;
            const current = today().getFullYear() === year;
            return (
              <button
                key={year}
                type="button"
                aria-pressed={active}
                aria-current={current ? "date" : undefined}
                onClick={() => {
                  setMode("months");
                  onShowMonth(new Date(year, view.getMonth(), 1));
                }}
                className={`flex h-11 items-center justify-center rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
                  active
                    ? "bg-brand-600 font-bold text-white"
                    : current
                      ? "border border-brand-500 font-bold text-brand-700"
                      : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {year}
              </button>
            );
          })}
        </div>
      )}

      {mode !== "years" && (mode === "months" ? (
        <div role="group" aria-label={`Choose a month in ${view.getFullYear()}`} className="grid grid-cols-3 gap-1">
          {MONTHS.map((month, i) => {
            const active = selected != null && selected.getMonth() === i && selected.getFullYear() === view.getFullYear();
            const current = today().getMonth() === i && today().getFullYear() === view.getFullYear();
            return (
              <button
                key={month}
                type="button"
                aria-pressed={active}
                aria-current={current ? "date" : undefined}
                onClick={() => { setMode("days"); onPickMonth(new Date(view.getFullYear(), i, 1)); }}
                className={`flex h-11 items-center justify-center rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-200 ${
                  active
                    ? "bg-brand-600 font-bold text-white"
                    : current
                      ? "border border-brand-500 font-bold text-brand-700"
                      : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {month.slice(0, 3)}
              </button>
            );
          })}
        </div>
      ) : (
        <div ref={gridRef} role="group" aria-label="Calendar" onKeyDown={onKeyDown}>
          <div className="grid grid-cols-7 gap-0.5" aria-hidden>
            {WEEKDAY_LETTER.map((letter, i) => (
              <div key={i} className="py-1 text-center text-[11px] font-bold text-slate-400">{letter}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {days.map((d) => {
              const iso = toIsoDay(d);
              const outside = d.getMonth() !== view.getMonth();
              const isToday = iso === todayIso;
              const isSelected = Boolean(selected) && iso === toIsoDay(selected as Date);
              const enabled = inBounds(d, min, max);
              return (
                <button
                  key={iso}
                  type="button"
                  data-day={iso}
                  disabled={!enabled}
                  tabIndex={-1}
                  aria-label={dayLabel(d)}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                  onClick={() => enabled && onPick(iso)}
                  className={`flex h-10 w-full items-center justify-center rounded-lg text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:text-slate-300 ${
                    isSelected
                      ? "bg-brand-600 font-bold text-white"
                      : isToday
                        ? "border border-brand-500 font-bold text-brand-700"
                        : outside
                          ? "text-slate-300 hover:bg-slate-50"
                          : "text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2">
        <button
          type="button"
          onClick={onToday}
          className="flex min-h-10 items-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:border-brand-300"
        >
          Today
        </button>
        {showClear && (
          <button
            type="button"
            onClick={onClear}
            className="flex min-h-10 items-center rounded-xl px-3 text-sm font-bold text-brand-700 underline hover:text-brand-900"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

export default DatePicker;