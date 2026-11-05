/**
 * The one filter bar for every list screen.
 *
 * Layout, top to bottom:
 *   1. the search box (optional);
 *   2. ONE horizontal row that never wraps: [Filters icon button] [Sort icon
 *      button] [All] [category chips…] [Clear]. The row scrolls sideways with
 *      a hidden scrollbar and a right-edge fade, and at >= 1024 it grows small
 *      left/right arrows when it actually overflows;
 *   3. the results header — "<label> N of M" plus a short summary of the active
 *      filters ("Grade 4 · Locked") and, where it applies, the list/grid
 *      toggle. Count changes are announced through aria-live.
 *
 * Everything that is not the primary category lives in the Filters panel
 * (bottom sheet on phones, popover at >= 768). The panel is made of SECTIONS
 * OF TAPPABLE CHIPS — never dropdowns:
 *   - a section heading row: the label, an "N selected" note when it is
 *     active, and a small Clear link that only clears that section;
 *   - single-choice sections start with an "Any …" chip and use
 *     role="radiogroup" / aria-checked;
 *   - multi-choice sections use toggle chips with aria-pressed;
 *   - counts sit inside the chip ("Grade 4 · 6"); a zero-count chip stays
 *     visible but is muted and disabled;
 *   - more than 12 options scroll inside max-h-56;
 *   - Quick filters (Locked, Escalated, Drill…) are a section of chips too;
 *   - Period is a section: Any time … Custom range, with the DatePicker range
 *     revealed INLINE under the chips.
 *
 * The panel has a scrolling body and a sticky footer ("Show N results" and
 * Reset). The shared Select is only for form fields, never inside this panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDownUp, Check, ChevronLeft, ChevronRight, LayoutGrid, List, SlidersHorizontal, X } from "lucide-react";
import { useMediaQuery } from "../lib/hooks";
import {
  PERIOD_OPTIONS, periodLabel, setDateBound, setPeriod,
  type DateRangeState, type PeriodId,
} from "../lib/filters";
import { DatePicker } from "./DatePicker";

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
  className?: string;
};

export type FilterGroupProps = {
  id: string;
  label: string;
  options: ChipOption[];
  selected: string[];
  onToggle: (group: string, value: string) => void;
  /** Single-choice section: an "Any …" chip, role="radiogroup". Defaults to multi. */
  single?: boolean;
};

export type ActiveChipProps = { id: string; label: string; onRemove: () => void };

export type FilterBarProps = {
  search?: { value: string; onChange: (v: string) => void; placeholder?: string; ariaLabel?: string };
  /** The row: single-select, "all" first, counts visible, never behind the panel. */
  category?: { value: string; options: ChipOption[]; onChange: (v: string) => void; ariaLabel: string };
  /** Sheet: the "Quick filters" section of toggle chips (Locked, Escalated, Drill…). */
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
  /** The Period section, inside the Filters panel. */
  period?: { value: DateRangeState; onChange: (next: DateRangeState) => void };
  /** Text used for the period in the active summary (defaults to its label). */
  periodSummary?: string;
  /** Legacy extra chip rows — folded into the panel as multi-choice sections. */
  chipRows?: ChipRowProps[];
  /** Legacy removable chips — now summarised in the results header. */
  activeChips?: ActiveChipProps[];
  onClearAll?: () => void;
  results: { label: string; shown: number; total: number };
  view?: { mode: "list" | "grid"; onToggle: (mode: "list" | "grid") => void };
  /** Header mode: only the Filters icon button (and its badge) is rendered, for
   *  a page-header `actions` slot. The panel, sections and footer are unchanged. */
  compact?: boolean;
};

const CHIP_BASE =
  "flex min-h-10 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-sm font-bold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-200 motion-reduce:transition-none";
const CHIP_ON = "border-brand-600 bg-brand-600 text-white";
const CHIP_OFF = "border-slate-300 bg-white text-slate-700 hover:border-brand-300";
const CHIP_DISABLED = "cursor-not-allowed opacity-50";
/** Panel chips are a full 44px tall for thumbs. */
const SECTION_CHIP = `${CHIP_BASE} min-h-11`;
const ICON_BTN =
  "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-200 motion-reduce:transition-none";
const ICON_BTN_OFF = `${ICON_BTN} border-slate-300 bg-white text-slate-700 hover:border-brand-300`;
const ICON_BTN_ON = `${ICON_BTN} border-brand-600 bg-brand-50 text-brand-700`;

/** Horizontal scroll edges for the one-row filter bar (arrows on >= 1024). */
export function scrollEdges(scrollLeft: number, scrollWidth: number, clientWidth: number) {
  const max = Math.max(0, scrollWidth - clientWidth);
  return { left: scrollLeft > 2, right: scrollLeft < max - 2, max };
}

/** One row of toggle chips (also used by the date-range bar). Never wraps. */
export function ChipRow({ ariaLabel, options, value, selected, onToggle, className = "" }: ChipRowProps) {
  return (
    <div className="relative" role="group" aria-label={ariaLabel}>
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
              <span>{o.label}</span>
              {o.count !== undefined && (
                <span className={`font-mono text-xs ${active ? "text-white/80" : "text-slate-400"}`}>{o.count}</span>
              )}
            </button>
          );
        })}
      </div>
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

  useEffect(() => {
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
      className="fixed z-[60] flex max-h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl outline-none"
      style={pos ? { left: pos.left, top: pos.top, width } : { left: -9999, top: -9999, width }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** The Filters panel's groups: `chipRows` are folded in, duplicates dropped. */
function panelGroups(groups: FilterGroupProps[] | undefined, rows: ChipRowProps[] | undefined): FilterGroupProps[] {
  const out = [...(groups ?? [])];
  for (const row of rows ?? []) {
    if (out.some((g) => g.label === row.ariaLabel || g.id === row.ariaLabel)) continue;
    out.push({
      id: `row:${row.ariaLabel}`,
      label: row.ariaLabel,
      options: row.options,
      selected: row.selected ?? (row.value !== undefined && row.value !== "all" ? [row.value] : []),
      onToggle: (_group, value) => row.onToggle(value),
    });
  }
  return out;
}

const optionLabel = (g: FilterGroupProps, value: string) => g.options.find((o) => o.value === value)?.label ?? value;

export function FilterBar({
  search,
  category,
  quickChips,
  filters,
  sort,
  period,
  periodSummary,
  chipRows,
  onClearAll,
  results,
  view,
  compact = false,
}: FilterBarProps) {
  const desktopFilters = useMediaQuery("screen and (min-width: 768px)");
  const wide = useMediaQuery("screen and (min-width: 1024px)");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [edges, setEdges] = useState({ left: false, right: false });
  const filtersBtn = useRef<HTMLButtonElement>(null);
  const sortBtn = useRef<HTMLButtonElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => panelGroups(filters?.groups, chipRows), [filters?.groups, chipRows]);
  const quick = useMemo(() => quickChips ?? [], [quickChips]);

  // The summary + badge: category label, every group selection, and any
  // toggle that is not already shown by a group.
  const categoryLabel =
    category && category.value !== "all"
      ? category.options.find((o) => o.value === category.value)?.label ?? category.value
      : "";
  const groupLabels = groups.flatMap((g) => g.selected.map((v) => optionLabel(g, v)));
  // Quick toggles normally mirror a group value, so they only add a summary
  // entry on screens that have no groups.
  const extraToggles = groupLabels.length > 0 ? [] : quick.filter((q) => q.active).map((q) => q.label);
  const periodName = period
    ? periodSummary ?? (period.value.period === "all" ? "" : periodLabel(period.value))
    : "";
  const summary = [categoryLabel, ...groupLabels, ...extraToggles, periodName].filter(Boolean);
  const activeCount = groupLabels.length + extraToggles.length + (periodName ? 1 : 0);
  const filtersActive = activeCount > 0;

  const shown = filters?.shown ?? results.shown;
  const total = filters?.total ?? results.total;
  const panelTitle = filters?.title ?? "Filters";
  const canOpenPanel = Boolean(filters) || quick.length > 0 || Boolean(period);
  const sortLabel = sort ? sort.options.find((o) => o.value === sort.value)?.label ?? sort.value : "";

  // Arrows only when the single row really overflows (never mid-scroll guess).
  const measure = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setEdges(scrollEdges(el.scrollLeft, el.scrollWidth, el.clientWidth));
  }, []);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    measure();
    // The row can narrow without the window resizing (a master-detail column
    // reaching its wide width), so watch the element itself.
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => measure()) : null;
    observer?.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      el.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const nudge = (delta: number) => {
    rowRef.current?.scrollBy({ left: delta, behavior: "smooth" });
  };

  const resetAll = () => {
    if (period && period.value.period !== "all") {
      period.onChange({ ...period.value, period: "all", from: "", to: "" });
    }
    if (filters) {
      filters.onReset();
      return;
    }
    for (const q of quick) if (q.active) q.onToggle();
  };

  const closePanel = () => {
    setFiltersOpen(false);
    filtersBtn.current?.focus();
  };

  // Header mode: the Filter icon (with its count badge) and its panel only.
  if (compact) {
    return (
      <div className="relative flex items-center">
        {canOpenPanel && (
          <button
            ref={filtersBtn}
            type="button"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
            title={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
            onClick={() => setFiltersOpen((v) => !v)}
            className={filtersActive || filtersOpen ? ICON_BTN_ON : ICON_BTN_OFF}
          >
            <SlidersHorizontal size={18} aria-hidden />
            {activeCount > 0 && (
              <span
                data-filter-badge
                aria-hidden
                className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 font-mono text-[11px] font-bold leading-none text-white"
              >
                {activeCount}
              </span>
            )}
          </button>
        )}
        {canOpenPanel && !desktopFilters && filtersOpen && (
          <FiltersSheet
            title={panelTitle}
            groups={groups}
            quick={quick}
            period={period}
            shown={shown}
            total={total}
            onReset={resetAll}
            onClose={closePanel}
          />
        )}
        {canOpenPanel && desktopFilters && (
          <AnchoredPanel
            open={filtersOpen}
            triggerRef={filtersBtn}
            onClose={() => setFiltersOpen(false)}
            width={360}
            ariaLabel={panelTitle}
          >
            <FilterSections groups={groups} quick={quick} period={period} />
            <FilterFooter shown={shown} total={total} onReset={resetAll} onDone={closePanel} />
          </AnchoredPanel>
        )}
      </div>
    );
  }

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

      {/* ONE row: never wraps, scrolls sideways. */}
      <div className="relative min-w-0">
        <div
          ref={rowRef}
          data-filter-row
          role="group"
          aria-label={category?.ariaLabel ?? "Filters"}
          className="flex flex-nowrap items-center gap-2 overflow-x-auto pb-1 pr-8 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {canOpenPanel && (
            <button
              ref={filtersBtn}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              aria-label={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
              title={activeCount > 0 ? `Filters, ${activeCount} active` : "Filters"}
              onClick={() => { setSortOpen(false); setFiltersOpen((v) => !v); }}
              className={filtersActive || filtersOpen ? ICON_BTN_ON : ICON_BTN_OFF}
            >
              <SlidersHorizontal size={18} aria-hidden />
              {activeCount > 0 && (
                <span
                  data-filter-badge
                  aria-hidden
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 font-mono text-[11px] font-bold leading-none text-white"
                >
                  {activeCount}
                </span>
              )}
            </button>
          )}

          {sort && (
            <button
              ref={sortBtn}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={sortOpen}
              aria-label={`Sort: ${sortLabel}`}
              title={`Sort: ${sortLabel}`}
              onClick={() => { setFiltersOpen(false); setSortOpen((v) => !v); }}
              className={sortOpen ? ICON_BTN_ON : ICON_BTN_OFF}
            >
              <ArrowDownUp size={18} aria-hidden />
            </button>
          )}

          {category?.options.map((o) => {
            const active = o.value === category.value;
            return (
              <button
                key={o.value}
                type="button"
                aria-pressed={active}
                disabled={o.disabled}
                onClick={() => !o.disabled && category.onChange(o.value)}
                className={`${CHIP_BASE} ${active ? CHIP_ON : CHIP_OFF} ${o.disabled ? CHIP_DISABLED : ""}`}
              >
                <span>{o.label}</span>
                {o.count !== undefined && (
                  <span className={`font-mono text-xs ${active ? "text-white/80" : "text-slate-400"}`}>{o.count}</span>
                )}
              </button>
            );
          })}

          {filtersActive && (
            <button
              type="button"
              onClick={onClearAll ?? resetAll}
              className="min-h-10 shrink-0 whitespace-nowrap rounded-full px-2 text-sm font-bold text-brand-700 underline outline-none hover:text-brand-900 focus-visible:ring-2 focus-visible:ring-brand-200"
            >
              Clear
            </button>
          )}
        </div>

        {/* Right-edge fade: shows while there is more to scroll. */}
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white via-white/80 to-transparent transition-opacity lg:w-14 ${edges.right ? "opacity-100" : "opacity-0"}`}
        />

        {wide && edges.left && (
          <button
            type="button"
            aria-label="Scroll filters left"
            onClick={() => nudge(-160)}
            className="absolute left-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-sm lg:flex"
          >
            <ChevronLeft size={18} />
          </button>
        )}
        {wide && edges.right && (
          <button
            type="button"
            aria-label="Scroll filters right"
            onClick={() => nudge(160)}
            className="absolute right-0 top-1/2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-sm lg:flex"
          >
            <ChevronRight size={18} />
          </button>
        )}
      </div>

      {canOpenPanel && !desktopFilters && filtersOpen && (
        <FiltersSheet
          title={panelTitle}
          groups={groups}
          quick={quick}
          period={period}
          shown={shown}
          total={total}
          onReset={resetAll}
          onClose={closePanel}
        />
      )}
      {canOpenPanel && desktopFilters && (
        <AnchoredPanel
          open={filtersOpen}
          triggerRef={filtersBtn}
          onClose={() => setFiltersOpen(false)}
          width={360}
          ariaLabel={panelTitle}
        >
          <FilterSections groups={groups} quick={quick} period={period} />
          <FilterFooter shown={shown} total={total} onReset={resetAll} onDone={closePanel} />
        </AnchoredPanel>
      )}

      {sort && !desktopFilters && sortOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end bg-black/55"
          onMouseDown={(e) => e.target === e.currentTarget && setSortOpen(false)}
        >
          <div role="dialog" aria-label={sort.ariaLabel ?? "Sort"} className="w-full rounded-t-2xl bg-white p-4 shadow-2xl">
            <SortBody sort={sort} onDone={() => { setSortOpen(false); sortBtn.current?.focus(); }} />
          </div>
        </div>
      )}
      {sort && desktopFilters && (
        <AnchoredPanel
          open={sortOpen}
          triggerRef={sortBtn}
          onClose={() => setSortOpen(false)}
          width={260}
          ariaLabel={sort.ariaLabel ?? "Sort"}
        >
          <div className="p-2">
            <SortBody sort={sort} onDone={() => { setSortOpen(false); sortBtn.current?.focus(); }} />
          </div>
        </AnchoredPanel>
      )}

      {/* Results header: count, the active-filter summary, the view toggle. */}
      <div className="flex items-center justify-between gap-2">
        <div aria-live="polite" aria-atomic="true" className="min-w-0">
          <p className="break-words text-xs font-bold text-slate-600">
            <span data-results>{results.label} {results.shown} of {results.total}</span>
            {summary.length > 0 && (
              <span data-filter-summary className="font-semibold text-slate-500"> · {summary.join(" · ")}</span>
            )}
          </p>
        </div>
        {view && (
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="List or grid view">
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

/** One chip in a panel section. Single-choice sections use radio semantics. */
function SectionChip({
  option,
  active,
  single,
  onSelect,
}: {
  option: ChipOption;
  active: boolean;
  single: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={single ? "radio" : undefined}
      aria-checked={single ? active : undefined}
      aria-pressed={single ? undefined : active}
      disabled={option.disabled}
      onClick={() => !option.disabled && onSelect()}
      className={`${SECTION_CHIP} ${active ? CHIP_ON : CHIP_OFF} ${option.disabled ? CHIP_DISABLED : ""}`}
    >
      <span>{option.label}</span>
      {option.count !== undefined && (
        <span className={`font-mono text-xs ${active ? "text-white/80" : "text-slate-400"}`}>{" · "}{option.count}</span>
      )}
    </button>
  );
}

/** A labelled section: heading row with "N selected" + a per-section Clear. */
function FilterSection({
  id,
  label,
  selectedCount,
  onClear,
  children,
  scroll = false,
  radiogroup = false,
}: {
  id: string;
  label: string;
  selectedCount: number;
  onClear?: () => void;
  children: ReactNode;
  /** More than 12 options: the chips scroll inside max-h-56 instead of growing. */
  scroll?: boolean;
  radiogroup?: boolean;
}) {
  return (
    <section data-filter-section={id} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
      <div className="mb-2 flex min-h-6 items-center gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</h3>
        {selectedCount > 0 && (
          <span data-selected-note className="font-mono text-[11px] font-bold text-brand-700">{selectedCount} selected</span>
        )}
        {selectedCount > 0 && onClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label={`Clear ${label}`}
            className="ml-auto rounded px-1 text-xs font-bold text-brand-700 underline outline-none hover:text-brand-900 focus-visible:ring-2 focus-visible:ring-brand-200"
          >
            Clear
          </button>
        )}
      </div>
      {scroll ? (
        <div className="scroll-area max-h-56 overflow-y-auto pr-1">
          <div role={radiogroup ? "radiogroup" : undefined} aria-label={radiogroup ? label : undefined} className="flex flex-wrap gap-2">
            {children}
          </div>
        </div>
      ) : (
        <div role={radiogroup ? "radiogroup" : undefined} aria-label={radiogroup ? label : undefined} className="flex flex-wrap gap-2">
          {children}
        </div>
      )}
    </section>
  );
}

/** All the panel's sections, in the order the screen asked for. */
function FilterSections({
  groups,
  quick,
  period,
}: {
  groups: FilterGroupProps[];
  quick: NonNullable<FilterBarProps["quickChips"]>;
  period?: FilterBarProps["period"];
}) {
  return (
    <div data-filter-sections className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {period && <PeriodSection value={period.value} onChange={period.onChange} />}

      {quick.length > 0 && (
        <FilterSection
          id="quick"
          label="Quick filters"
          selectedCount={quick.filter((q) => q.active).length}
          onClear={() => quick.filter((q) => q.active).forEach((q) => q.onToggle())}
        >
          {quick.map((q) => (
            <button
              key={q.label}
              type="button"
              aria-pressed={q.active}
              aria-label={q.ariaLabel ?? q.label}
              onClick={q.onToggle}
              className={`${SECTION_CHIP} ${q.active ? CHIP_ON : CHIP_OFF}`}
            >
              <span>{q.label}</span>
              {q.count !== undefined && (
                <span className={`font-mono text-xs ${q.active ? "text-white/80" : "text-slate-400"}`}>{" · "}{q.count}</span>
              )}
            </button>
          ))}
        </FilterSection>
      )}

      {groups.map((g) => {
        const single = Boolean(g.single);
        const active = (value: string) => g.selected.includes(value);
        const clear = () => {
          for (const v of [...g.selected]) g.onToggle(g.id, v);
        };
        // Single-choice sections start with an "Any" chip; picking it clears.
        const anyChip = single ? (
          <SectionChip
            key="__any"
            option={{ value: "", label: `Any ${g.label.toLowerCase()}` }}
            active={g.selected.length === 0}
            single
            onSelect={clear}
          />
        ) : null;
        return (
          <FilterSection
            key={g.id}
            id={g.id}
            label={g.label}
            selectedCount={g.selected.length}
            onClear={clear}
            scroll={g.options.length > 12}
            radiogroup={single}
          >
            {anyChip}
            {g.options.map((o) => (
              <SectionChip
                key={o.value}
                option={o}
                active={active(o.value)}
                single={single}
                onSelect={() => g.onToggle(g.id, o.value)}
              />
            ))}
          </FilterSection>
        );
      })}
    </div>
  );
}

/** The sticky footer: Reset on the left, "Show N results" on the right. */
function FilterFooter({
  shown,
  total,
  onReset,
  onDone,
}: {
  shown: number;
  total: number;
  onReset: () => void;
  onDone: () => void;
}) {
  return (
    <div data-filter-footer className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-3">
      <button
        type="button"
        onClick={onReset}
        className="flex min-h-12 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 hover:border-brand-300"
      >
        Reset
      </button>
      <div className="flex min-w-0 items-center gap-2">
        <span className="hidden font-mono text-[11px] text-slate-400 sm:inline">Showing {shown} of {total}</span>
        <button
          type="button"
          onClick={onDone}
          className="flex min-h-12 items-center rounded-xl bg-brand-600 px-4 text-sm font-bold text-white"
        >
          Show {shown} results
        </button>
      </div>
    </div>
  );
}

/**
 * The Period section: single-choice chips for the presets, with the DatePicker
 * range revealed INLINE (no dropdown, no extra tap) for Custom range.
 */
function PeriodSection({ value, onChange }: { value: DateRangeState; onChange: (next: DateRangeState) => void }) {
  return (
    <div data-period-section>
      <FilterSection
        id="period"
        label="Period"
        selectedCount={value.period === "all" ? 0 : 1}
        onClear={() => onChange({ ...value, period: "all", from: "", to: "" })}
        radiogroup
      >
        {PERIOD_OPTIONS.map((o) => (
          <SectionChip
            key={o.value}
            option={{ value: o.value, label: o.label }}
            active={value.period === o.value}
            single
            onSelect={() => onChange(setPeriod(value, o.value as PeriodId))}
          />
        ))}
      </FilterSection>
      {value.period === "custom" && (
        <div data-period-range className="mt-3 flex flex-wrap items-end gap-2">
          <DatePicker className="w-40" label="From" value={value.from} onChange={(v) => onChange(setDateBound(value, "from", v))} clearable />
          <DatePicker className="w-40" label="To" value={value.to} onChange={(v) => onChange(setDateBound(value, "to", v))} clearable />
        </div>
      )}
    </div>
  );
}

/** Phone bottom sheet: header, scrolling body, sticky footer. */
function FiltersSheet({
  title,
  groups,
  quick,
  period,
  shown,
  total,
  onReset,
  onClose,
}: {
  title: string;
  groups: FilterGroupProps[];
  quick: NonNullable<FilterBarProps["quickChips"]>;
  period?: FilterBarProps["period"];
  shown: number;
  total: number;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-end bg-black/55"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-bold text-slate-800">{title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2 flex h-12 w-12 items-center justify-center rounded-lg hover:bg-slate-100">
            <X size={20} className="text-slate-500" />
          </button>
        </div>
        <FilterSections groups={groups} quick={quick} period={period} />
        <FilterFooter shown={shown} total={total} onReset={onReset} onDone={onClose} />
      </div>
    </div>,
    document.body,
  );
}

/** The Sort panel: a list of radio rows, one choice at a time. */
function SortBody({ sort, onDone }: { sort: NonNullable<FilterBarProps["sort"]>; onDone: () => void }) {
  return (
    <div role="radiogroup" aria-label={sort.ariaLabel ?? "Sort by"} className="space-y-1">
      {sort.options.map((o) => {
        const on = o.value === sort.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
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
