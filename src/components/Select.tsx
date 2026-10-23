import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useMediaQuery } from "../lib/hooks";

/**
 * The one dropdown for the whole app. Native <select> popups are drawn by the
 * OS, so they cannot follow the ASPIRE design – use this instead of <select>
 * anywhere a dropdown is needed (see README → “Dropdowns”).
 *
 * ≥ 640px: a popover anchored to the trigger, portalled so modals and
 *          overflow-hidden panes never clip it.
 * < 640px: a bottom sheet with a title and a close button.
 *
 * Works as a controlled input: `value` + `onChange(value)`, so it can be used
 * inside forms exactly where a <select> used to be.
 */
export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  error?: string;
  /** Accessible name when there is no visible `label` (e.g. a toolbar filter). */
  ariaLabel?: string;
  className?: string;
  /** Lets a call site match the label style of the fields beside it. */
  labelClassName?: string;
};

const MENU_MAX = 256; // 16rem
const TYPEAHEAD_MS = 600;
const SEARCH_THRESHOLD = 8;

type Pos = { left: number; top: number; width: number; maxHeight: number };

export function Select({
  value,
  onChange,
  options,
  placeholder = "Select…",
  label,
  disabled = false,
  error,
  ariaLabel,
  className = "",
  labelClassName = "text-xs font-semibold text-slate-600",
}: SelectProps) {
  const baseId = useId();
  const triggerId = `${baseId}-trigger`;
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-list`;
  const valueId = `${baseId}-value`;
  const errorId = `${baseId}-error`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<Pos | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const typeahead = useRef({ text: "", at: 0 });

  // Same query the rest of the app uses for the sheet-vs-popover split.
  const desktop = useMediaQuery("screen and (min-width: 640px)");
  const searchable = options.length > SEARCH_THRESHOLD;

  const selected = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.description ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  // `active` is always an index into the *visible* list, so filtering by the
  // search field and keyboard navigation stay in step.
  const firstEnabled = () => shown.findIndex((o) => !o.disabled);
  const lastEnabled = () => {
    for (let i = shown.length - 1; i >= 0; i--) if (!shown[i].disabled) return i;
    return -1;
  };
  const step = (from: number, delta: number) => {
    const n = shown.length;
    if (!n) return -1;
    for (let k = 1; k <= n; k++) {
      const i = (from + delta * k + n * 2) % n;
      if (!shown[i].disabled) return i;
    }
    return from;
  };

  const openMenu = useCallback(
    (at?: "first" | "last") => {
      if (disabled) return;
      const selIdx = options.findIndex((o) => o.value === value);
      setQuery("");
      setActive(at === "first" ? firstEnabled() : at === "last" ? lastEnabled() : selIdx >= 0 && !options[selIdx].disabled ? selIdx : firstEnabled());
      setOpen(true);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [disabled, options, shown, value],
  );

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    setQuery("");
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const choose = useCallback(
    (opt?: SelectOption) => {
      if (!opt || opt.disabled) return;
      onChange(opt.value);
      close();
    },
    [close, onChange],
  );

  // Focus: on the popover the trigger keeps focus (aria-activedescendant drives
  // the list) unless there is a search field; the phone sheet is a modal dialog,
  // so focus moves into its listbox.
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => {
      if (!desktop) listRef.current?.focus();
      else if (searchable) searchRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, desktop, searchable]);

  // Esc closes only this menu (capture phase, so a surrounding Modal stays
  // open). Tab closes and lets focus move on. Outside press closes.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setQuery("");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setQuery("");
        triggerRef.current?.focus();
      } else if (e.key === "Tab") {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // Anchor the popover under the trigger, flip it up when there is no room,
  // and follow the trigger if the page scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!open || !desktop) {
      setPos(null);
      return;
    }
    const place = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger || !menu) return;
      const r = trigger.getBoundingClientRect();
      const gap = 6;
      const roomBelow = window.innerHeight - r.bottom - gap - 8;
      const roomAbove = r.top - gap - 8;
      const natural = Math.min(menu.scrollHeight, MENU_MAX);
      const flip = natural > roomBelow && roomAbove > roomBelow;
      const maxHeight = Math.max(120, Math.min(MENU_MAX, flip ? roomAbove : roomBelow));
      const width = Math.max(160, r.width);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const top = flip ? Math.max(8, r.top - gap - Math.min(natural, maxHeight)) : r.bottom + gap;
      setPos({ left, top, width, maxHeight });
    };
    place();
    const onScroll = (e: Event) => {
      const t = e.target;
      if (menuRef.current && t instanceof Node && menuRef.current.contains(t)) return;
      place();
    };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, desktop, shown.length, query]);

  const jump = (text: string) => {
    const now = Date.now();
    const buf = now - typeahead.current.at > TYPEAHEAD_MS ? text : typeahead.current.text + text;
    typeahead.current = { text: buf, at: now };
    const q = buf.toLowerCase();
    const n = shown.length;
    if (!n) return;
    const start = (active + 1 + n) % n;
    for (let k = 0; k < n; k++) {
      const o = shown[(start + k) % n];
      if (!o.disabled && o.label.toLowerCase().startsWith(q)) {
        setActive((start + k) % n);
        return;
      }
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    const inSearch = e.target === searchRef.current;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => step(i < 0 ? -1 : i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => step(i < 0 ? options.length : i, -1));
        break;
      case "Home":
        e.preventDefault();
        setActive(firstEnabled());
        break;
      case "End":
        e.preventDefault();
        setActive(lastEnabled());
        break;
      case "Enter":
        e.preventDefault();
        choose(shown[active]);
        break;
      case " ":
        if (inSearch) break;
        e.preventDefault();
        choose(shown[active]);
        break;
      default:
        if (inSearch) break;
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          // A searchable menu types into its field, wherever focus happens to be.
          if (searchable) {
            setQuery((q) => q + e.key);
            setActive(0);
            searchRef.current?.focus();
          } else {
            jump(e.key);
          }
        }
    }
  };

  const onTriggerKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu(e.key === "ArrowUp" ? "last" : undefined);
      }
      return;
    }
    onListKey(e);
  };

  const optClass = (i: number) => {
    const on = i === active;
    const isSel = shown[i]?.value === value;
    return [
      "flex min-h-12 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
      on ? "bg-brand-50" : "",
      isSel ? "font-semibold text-slate-900" : "text-slate-700",
      shown[i]?.disabled ? "cursor-not-allowed opacity-50" : "",
    ]
      .filter(Boolean)
      .join(" ");
  };

  const optionList = (extra: string) => (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      tabIndex={-1}
      aria-labelledby={label ? labelId : undefined}
      aria-label={label ? undefined : ariaLabel}
      aria-activedescendant={active >= 0 && shown[active] ? optionId(active) : undefined}
      onKeyDown={onListKey}
      className={`scroll-area list-none outline-none ${extra}`}
    >
      {shown.length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No matches.</li>}
      {shown.map((o, i) => (
        <li
          key={o.value}
          id={optionId(i)}
          role="option"
          aria-selected={o.value === value}
          aria-disabled={o.disabled || undefined}
          className={optClass(i)}
          onMouseMove={() => !o.disabled && setActive(i)}
          onClick={() => choose(o)}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={o.label}>{o.label}</span>
            {o.description && <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">{o.description}</span>}
          </span>
          {o.value === value && <Check size={16} className="shrink-0 text-brand-600" aria-hidden />}
        </li>
      ))}
    </ul>
  );

  const searchField = (
    <div className="relative shrink-0 border-b border-slate-100 p-2" onKeyDown={onListKey}>
      <Search size={16} className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={searchRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        placeholder="Search…"
        aria-label="Search options"
        aria-controls={listId}
        className="min-h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-brand-500"
      />
    </div>
  );

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <label id={labelId} htmlFor={triggerId} className={`mb-1 block ${labelClassName}`}>
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 && shown[active] ? optionId(active) : undefined}
        aria-labelledby={label ? `${labelId} ${valueId}` : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
        className={`flex min-h-12 w-full items-center gap-2 rounded-xl border bg-white px-3 text-left text-sm outline-none transition-colors focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 motion-reduce:transition-none ${
          error ? "border-blush-700" : "border-slate-300"
        }`}
      >
        <span id={valueId} title={selected?.label} className={`min-w-0 flex-1 truncate ${selected ? "text-slate-900" : "text-slate-400"}`}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          size={18}
          aria-hidden
          className={`shrink-0 text-slate-400 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-xs font-semibold text-blush-700">
          {error}
        </p>
      )}

      {/* Desktop popover – portalled so modals / overflow-hidden panes can't clip it. */}
      {open && desktop && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            className="select-pop fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            style={
              pos
                ? { left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxHeight }
                : { left: -9999, top: -9999, width: 240, maxHeight: MENU_MAX }
            }
          >
            {searchable && searchField}
            {optionList("min-h-0 flex-1 p-1")}
          </div>,
          document.body,
        )}

      {/* Phone sheet – same shell as Modal's bottom sheet, but separate so Esc
          closes only the menu and not the modal it may sit inside. */}
      {open && !desktop && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-end bg-black/55"
            onMouseDown={(e) => e.target === e.currentTarget && close()}
          >
            <div
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              aria-label={label ?? ariaLabel ?? "Choose an option"}
              className="select-pop flex max-h-[80dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
            >
              <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="min-w-0 truncate text-base font-bold text-slate-800">{label ?? ariaLabel ?? "Choose an option"}</h2>
                <button type="button" onClick={() => close()} aria-label="Close" className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-slate-100">
                  <X size={20} className="text-slate-500" />
                </button>
              </div>
              {searchable && searchField}
              {optionList("min-h-0 flex-1 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]")}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

export default Select;
