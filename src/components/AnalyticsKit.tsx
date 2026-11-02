import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Inbox, Info, Triangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
      className={`h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none ${className}`}
      style={{ width: `${width}%`, background: color }}
    />
  );
}

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
  return (
    <div data-stat-card className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
          <Icon size={16} aria-hidden />
        </span>
        <p className="min-w-0 flex-1 break-words text-[11px] font-bold uppercase leading-tight tracking-wide text-slate-500">{label}</p>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`What is ${label}?`}
          onClick={() => setOpen((v) => !v)}
          className="-mr-1 -mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100"
        >
          <Info size={15} aria-hidden />
        </button>
      </div>
      <p className="mt-1 break-words font-mono text-xl font-black leading-tight tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 break-words text-[11px] text-slate-500">{hint}</p>}
      {open && (
        <p role="note" className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] leading-relaxed text-slate-600">
          {definition}
        </p>
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
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  tone: string;
}) {
  return (
    <span
      data-tier-chip
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${tone}`}
    >
      <Icon size={12} aria-hidden />
      <span>{label}</span>
      <span className="font-mono tabular-nums">{count}</span>
    </span>
  );
}

export function ChartCard({
  title,
  icon: Icon,
  children,
  alt,
  empty,
}: {
  title: string;
  icon: LucideIcon;
  children: ReactNode;
  /** The chart's text equivalent — a visually hidden table or list. */
  alt?: ReactNode;
  empty?: boolean;
}) {
  return (
    <section data-chart-card className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-500">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
          <Icon size={14} aria-hidden />
        </span>
        <span className="min-w-0 break-words">{title}</span>
      </h3>
      <div className="mt-3">{empty ? <EmptyState>No data in this period.</EmptyState> : children}</div>
      {alt && (
        <div data-chart-alt className="sr-only">
          {alt}
        </div>
      )}
    </section>
  );
}
