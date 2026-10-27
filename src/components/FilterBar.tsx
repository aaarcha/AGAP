/**
 * The one filter bar for every list screen: search, a primary category chip row
 * (All first, counts visible, never hidden), a toolbar with the Filters button
 * (badge = active filter count), the Sort button and quick chips, removable
 * active-filter chips + Clear all, and a results header with an optional
 * list/grid toggle.
 *
 * Layout: chip rows scroll horizontally with an edge fade on phones and wrap at
 * >= 1024px so every chip stays visible. The Filters button opens a bottom sheet
 * on phones and a popover at >= 768px, with grouped options as tappable chips,
 * a live "Show N results" and Reset; options with zero matches stay visible but
 * disabled with a 0 count. Chips are toggle buttons (aria-pressed) and the
 * results header is an aria-live region so count changes are announced.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, Check, LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";
import { useMediaQuery } from "../lib/hooks";

export type ChipOption = {
  value: string;
  label: string;
  /** Shown on the chip; undefined hides the count. */
  count?: number;
  disabled?: boolean;
};

export type ChipRowProps = {
  ariaLabel: string;
  options: ChipOption[];
  /** Single-select row (category): the active value. */
  value?: string;
  /** Multi-select rows: the selected values. */
  selected?: string[];
  onToggle: (value: string) => void;
  /** Class appended to every chip (quick chips live in the toolbar). */
  className?: string;
};

export type FilterGroupProps = {
  id: string;
  label: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (group: string, value: string) => void;
};

export type ActiveChipProps = { id: string; label: string; onRemove: () => void };

export type FilterBarProps = {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string };
  /** Primary row: single-select, "all" first, counts visible, never behind the Filters button. */
  category?: { value: string; options: ChipOption[]; onChange: (v: string) => void; ariaLabel: string };
  /** Toolbar: quick chips for the most useful specific options (toggles). */
  quickChips?: { label: string; count?: number; active: boolean; onToggle: () => void; ariaLabel?: string }[];
  filters?: {
    groups: FilterGroupProps[];
    activeCount: number;
    onReset: () => void;
    shown: number;
    total: number;
    title?: string;
  };
  sort?: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; ariaLabel?: string };
  /** Extra toggle rows below the toolbar (grade row, status chips…). */
  chipRows?: ChipRowProps[];
  activeChips?: ActiveChipProps[];
  onClearAll?: () => void;
  results: { label: string; shown: number; total: number };
  view?: { mode: "list" | "grid"; onToggle: (mode: "list" | "grid") => void };
};

const CHIP_BASE =
  "flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-200 motion-reduce:transition-none";
const CHIP_ON = "border-brand-600 bg-brand-600 text-white";
const CHIP_OFF = "border-slate-300 bg-white text-slate-700 hover:border-brand-300";
const CHIP_DISABLED = "cursor-not-allowed opacity-50";
const TOOLBAR_BTN =
  "flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 outline-none transition-colors hover:border-brand-300 focus-visible:ring-2 focus-visible:ring-brand-200 motion-reduce:transition-none";

/** One row of toggle chips: horizontal scroll + edge fade on phones,
 *  wrapping at >= 1024px so every chip is visible. */
export function ChipRow({ ariaLabel, options, value, selected, onToggle, className = "" }: ChipRowProps) {
  return (
    <div className="relative" role="group" aria-label={ariaLabel}>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] lg:flex-wrap lg:overflow-x-visible [&::-webkit-scrollbar]:hidden">
        {options.map((o) => {
          const active = value !== undefined ? o.value === value : Boolean(selected?.includes(o.value));
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={active}
              disabled={o.disabled}
              onClick={() => !o.disabled && onToggle(o.value)}
              className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF} ${o.disabled ? CHIP_DISABLED : ""} ${className}`}
            >
              <span className="whitespace-nowrap">{o.label}</span>
              {o.count !== undefined && (
                <span className={`font-mono text-xs ${active ? "text-white/80" : "text-slate-400"}`}>{o.count}</span>
              )}
            </button>
          );
        })}
      </div>
      {/* Edge fade on phones; >= 1024 wraps, so the fade disappears there. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-white via-white/70 to-transparent lg:hidden"
      />
    </div>
  );
}

/** Anchored popover (portalled): outside press and Esc close it. */
function AnchoredPanel({
  open,
  triggerRef,
  onClose,
  width,
  ariaLabel,
  children,
}: {
  open: boolean;
  triggerRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  width: number;
  ariaLabel: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const below = r.bottom + 6;
      const panel = panelRef.current;
      const height = panel?.scrollHeight ?? 320;
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
  }, [open, triggerRef, width]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => panelRef.current?.focus(), 0);
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, triggerRef]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      className="fixed z-[60] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl outline-none"
      style={pos ? { left: pos.left, top: pos.top, width } : { left: -9999, top: -9999, width }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function FilterBar({
  search,
  category,
  quickChips,
  filters,
  sort,
  chipRows,
  activeChips,
  onClearAll,
  results,
  view,
}: FilterBarProps) {
  const baseId = useId();
  const desktopFilters = useMediaQuery("screen and (min-width: 768px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);

  const activeList = activeChips ?? [];

  return (
    <div className="min-w-0 space-y-2">
      {search && (
        <div className="relative">
          <input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "Search…"}
            aria-label={search.ariaLabel ?? "Search"}
            inputMode="search"
            className="min-h-12 w-full rounded-xl border border-slate-300 bg-white pl-10 pr-12 text-base outline-none focus:border-brand-500"
          />
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          {search.value && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => search.onChange("")}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-400 hover:text-slate-600"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {category && (
        <ChipRow
          ariaLabel={category.ariaLabel}
          options={category.options}
          value={category.value}
          onToggle={category.onChange}
        />
      )}

      {(filters || sort || (quickChips && quickChips.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2">
          {filters && (
            <>
              <button
                ref={filtersBtn}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={filtersOpen}
                onClick={() => { setSortOpen(false); setFiltersOpen((v) => !v); }}
                className={TOOLBAR_BTN}
              >
                <SlidersHorizontal size={15} aria-hidden />
                Filters
                {filters.activeCount > 0 && (
                  <span className="rounded-full bg-brand-600 px-1.5 py-0.5 font-mono text-xs leading-none text-white">
                    {filters.activeCount}
                  </span>
                )}
              </button>
              {!desktopFilters && filtersOpen && (
                <FiltersSheet
                  filters={filters}
                  onClose={() => { setFiltersOpen(false); filtersBtn.current?.focus(); }}
                />
              )}
              {desktopFilters && (
                <AnchoredPanel
                  open={filtersOpen}
                  triggerRef={filtersBtn}
                  onClose={() => setFiltersOpen(false)}
                  width={340}
                  ariaLabel={filters.title ?? "Filters"}
                >
                  <FiltersBody filters={filters} onDone={() => { setFiltersOpen(false); filtersBtn.current?.focus(); }} />
                </AnchoredPanel>
              )}
            </>
          )}
          {sort && (
            <>
              <button
                ref={sortBtn}
                type="button"
                aria-haspopup="dialog"
                aria-expanded={sortOpen}
                onClick={() => { setFiltersOpen(false); setSortOpen((v) => !v); }}
                className={TOOLBAR_BTN}
              >
                <ArrowDownUp size={15} aria-hidden />
                Sort
              </button>
              {!desktopFilters && sortOpen && (
                <div
                  className="fixed inset-0 z-[60] flex items-end bg-black/55"
                  onMouseDown={(e) => e.target === e.currentTarget && setSortOpen(false)}
                >
                  <div role="dialog" aria-label={sort.ariaLabel ?? "Sort"} className="w-full rounded-t-2xl bg-white p-4 shadow-2xl">
                    <SortBody sort={sort} onDone={() => { setSortOpen(false); sortBtn.current?.focus(); }} />
                  </div>
                </div>
              )}
              {desktopFilters && (
                <AnchoredPanel
                  open={sortOpen}
                  triggerRef={sortBtn}
                  onClose={() => setSortOpen(false)}
                  width={260}
                  ariaLabel={sort.ariaLabel ?? "Sort"}
                >
                  <SortBody sort={sort} onDone={() => { setSortOpen(false); sortBtn.current?.focus(); }} />
                </AnchoredPanel>
              )}
            </>
          )}
          {quickChips?.map((qc) => (
            <button
              key={qc.label}
              type="button"
              aria-pressed={qc.active}
              aria-label={qc.ariaLabel ?? qc.label}
              onClick={qc.onToggle}
              className={`${CHIP_BASE} ${qc.active ? CHIP_ON : CHIP_OFF}`}
            >
              <span className="whitespace-nowrap">{qc.label}</span>
              {qc.count !== undefined && (
                <span className={`font-mono text-xs ${qc.active ? "text-white/80" : "text-slate-400"}`}>{qc.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {chipRows?.map((row) => (
        <ChipRow key={row.ariaLabel} ariaLabel={row.ariaLabel} options={row.options} selected={row.selected} onToggle={row.onToggle} />
      ))}

      {(activeList.length > 0 || (onClearAll && activeList.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2">
          {activeList.map((chip) => (
            <button
              key={chip.id}
              type="button"
              aria-label={`Remove filter ${chip.label}`}
              onClick={chip.onRemove}
              className={`${CHIP_BASE} border-brand-200 bg-brand-50 text-brand-800 hover:border-brand-300`}
            >
              <span className="whitespace-nowrap">{chip.label}</span>
              <X size={14} aria-hidden />
            </button>
          ))}
          {onClearAll && activeList.length > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="min-h-10 shrink-0 rounded-full px-2 text-sm font-bold text-brand-700 underline hover:text-brand-900"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2" aria-live="polite" aria-atomic="true">
        <p className="text-xs font-bold text-slate-600">
          {results.label} {results.shown} of {results.total}
        </p>
        {view && (
          <div className="flex items-center gap-1" role="group" aria-label="List or grid view">
            <button
              type="button"
              aria-label="List view"
              aria-pressed={view.mode === "list"}
              onClick={() => view.onToggle("list")}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border ${view.mode === "list" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-500"}`}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              aria-label="Grid view"
              aria-pressed={view.mode === "grid"}
              onClick={() => view.onToggle("grid")}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border ${view.mode === "grid" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-500"}`}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Grouped option chips + live "Show N results" + Reset (sheet or popover body). */
function FiltersBody({ filters, onDone }: { filters: NonNullable<FilterBarProps["filters"]>; onDone: () => void }) {
  return (
    <div className="space-y-3">
      {filters.groups.map((g) => (
        <div key={g.id}>
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">{g.label}</p>
          <ChipRow ariaLabel={g.label} options={g.options} selected={g.selected} onToggle={(v) => g.onToggle(g.id, v)} />
        </div>
      ))}
      <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          onClick={filters.onReset}
          className="flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 hover:border-brand-300"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onDone}
          className="flex min-h-10 items-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white"
        >
          Show {filters.shown} results
        </button>
      </div>
    </div>
  );
}

/** Phone bottom sheet wrapper around FiltersBody / SortBody. */
function FiltersSheet({ filters, onClose }: { filters: NonNullable<FilterBarProps["filters"]>; onClose: () => void }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={filters.title ?? "Filters"}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-800">{filters.title ?? "Filters"}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-slate-100">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
        <FiltersBody filters={filters} onDone={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function SortBody({ sort, onDone }: { sort: NonNullable<FilterBarProps["sort"]>; onDone: () => void }) {
  return (
    <div role="listbox" aria-label={sort.ariaLabel ?? "Sort by"} className="space-y-1">
      {sort.options.map((o) => {
        const on = o.value === sort.value;
        return (
          <button
            key={o.value}
            type="button"
            role="option"
            aria-selected={on}
            onClick={() => { sort.onChange(o.value); onDone(); }}
            className="flex min-h-12 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-700 hover:bg-brand-50"
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {on && <Check size={16} className="shrink-0 text-brand-600" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

export default FilterBar;
