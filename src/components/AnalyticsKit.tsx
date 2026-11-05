import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Inbox, Info, Triangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMediaQuery } from "../lib/hooks";

/**
 * The ONE chart-token map for the analytics screen, plus the small set of
 * shared parts every card reuses (StatCard, ChartCard, LegendChip, EmptyState).
 *
 * Urgency is never colour alone: each tier carries an icon AND its text label.
 * Colours follow the brand palette's semantics — CRITICAL rose, HIGH amber,
 * MODERATE sky. Hazard categories reuse the report-tile colours (lib/theme).
 */
export type TierId = "CRITICAL" | "HIGH" | "MODERATE";

export interface TierToken {
  label: string;
  icon: LucideIcon;
  /** Bar / donut stroke. */
  bar: string;
  stroke: string;
  tint: string;
  text: string;
  border: string;
}

export const TIER_TOKEN: Record<TierId, TierToken> = {
  CRITICAL: {
    label: "CRITICAL",
    icon: AlertTriangle,
    bar: "bg-rose-500",
    stroke: "#f43f5e",
    tint: "bg-rose-50",
    text: "text-rose-800",
    border: "border-rose-200",
  },
  HIGH: {
    label: "HIGH",
    icon: Triangle,
    bar: "bg-amber-500",
    stroke: "#f59e0b",
    tint: "bg-amber-50",
    text: "text-amber-800",
    border: "border-amber-200",
  },
  MODERATE: {
    label: "MODERATE",
    icon: Info,
    bar: "bg-sky-500",
    stroke: "#0ea5e9",
    tint: "bg-sky-50",
    text: "text-sky-800",
    border: "border-sky-200",
  },
};

/** The four school-day windows, with the hours they cover, in one place. */
export const TIME_TOKEN: Record<string, { label: string; window: string }> = {
  before: { label: "Before classes", window: "Before 7:30" },
  class: { label: "Class hours", window: "7:30–11:30 · 12:30–14:30" },
  recess: { label: "Recess / transition", window: "9:30–9:45 · 11:30–12:30" },
  after: { label: "After dismissal", window: "After 14:30" },
};

export const TIME_ORDER = ["before", "class", "recess", "after"] as const;

/** A horizontal bar that grows to its value in 300 ms (reduced motion: instant). */
export function AnimatedBar({ pct, className = "", color }: { pct: number; className?: string; color?: string }) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = window.setTimeout(() => setWidth(pct), 20);
    return () => window.clearTimeout(id);
  }, [pct]);
  return (
    <div
      data-bar
      className={`h-full rounded-full      transition-[width] duration-200 ease-out motion-reduce:transition-none ${className}`}
      style={{ width: `${width}%`, background: color }}
    />
  );
}

/**
 * One stat: label on top (short, wrapping over at most two lines), the big
 * value, then the sample size the value was measured on. The info button sits
 * in the card's corner, out of the text flow.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  definition,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  definition: string;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // >= 640: a positioned popover. Phones: the same portal, docked as a sheet.
  const wide = useMediaQuery("(min-width: 640px)");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && (popRef.current?.contains(target) || btnRef.current?.contains(target))) return;
      setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const rect = open && wide ? btnRef.current?.getBoundingClientRect() : null;

  return (
    <div data-stat-card className="relative min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-label={`What is ${label}?`}
        onClick={() => setOpen((v) => !v)}
        className="absolute right-1.5 top-1.5 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
      >
        <Info size={15} aria-hidden />
      </button>
      <div className="flex items-start gap-2 pr-8">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={14} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 text-balance break-normal hyphens-none text-[11px] font-bold uppercase leading-tight tracking-wide text-slate-500">
          {label}
        </p>
      </div>
      <p className="mt-2 whitespace-nowrap font-mono text-xl font-black leading-none tabular-nums text-slate-900 sm:text-2xl">{value}</p>
      {hint && <p className="mt-1.5 break-words text-[11px] font-semibold tabular-nums text-slate-500">{hint}</p>}
      {open && createPortal(
        <div className="fixed inset-0 z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          {!wide && <div className="absolute inset-0 bg-black/30" aria-hidden />}
          <div
            ref={popRef}
            data-stat-popover
            role="dialog"
            aria-label={`${label} definition`}
            style={wide && rect
              ? { top: Math.min(rect.bottom + 6, window.innerHeight - 160), left: Math.max(8, Math.min(rect.right - 288, window.innerWidth - 296)) }
              : undefined}
            className={wide
              ? "fixed w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-3 shadow-xl"
              : "absolute inset-x-0 bottom-0 max-h-[70dvh] overflow-y-auto rounded-t-2xl border-t border-slate-200 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl"}
          >
            <p className="break-words text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
            <p data-stat-definition className="mt-1 break-words hyphens-none text-xs leading-relaxed text-slate-600">{definition}</p>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="flex flex-col items-center gap-1 py-6 text-center text-xs text-slate-400">
      <Inbox size={18} aria-hidden />
      {children}
    </p>
  );
}

export function LegendChip({
  icon: Icon,
  label,
  count,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  tone: string;
  /** When given, the chip is a launchpad into the matching records. */
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon size={12} aria-hidden />
      <span className="break-normal hyphens-none">{label}</span>
      <span className="font-mono tabular-nums">{count}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        data-tier-chip
        onClick={onClick}
        className={`inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold transition-colors duration-200 hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none ${tone}`}
      >
        {content}
      </button>
    );
  }
  return (
    <span data-tier-chip className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {content}
    </span>
  );
}

export function ChartCard({
  title,
  icon: Icon,
  children,
  alt,
  empty,
  insight,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  /** The chart's text equivalent — a visually hidden table or list. */
  alt?: ReactNode;
  empty?: boolean;
  /** One plain sentence under the chart: the reading of the data. */
  insight?: string;
}) {
  return (
    <section data-chart-card className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={14} aria-hidden />
        </span>
        <span className="min-w-0 break-words">{title}</span>
      </h3>
      <div className="mt-3 min-w-0">{empty ? <EmptyState>No data measured</EmptyState> : children}</div>
      {insight && (
        <p data-insight className="mt-3 break-words rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] font-semibold leading-snug text-slate-600">
          {insight}
        </p>
      )}
      {alt && (
        <div data-chart-alt className="sr-only">
          {alt}
        </div>
      )}
    </section>
  );
}
