import { ChevronDown } from "lucide-react";

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
      <div>
        <h1 className="text-xl font-black tracking-tight text-brand-900">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
        )}
      </div>
    </header>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${className || ""}`}>
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">{children}</h2>;
}

export function Callout({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="rounded-xl border-l-4 border-brand-600 bg-brand-50 p-3 mb-4">
      <p className="font-semibold text-slate-800">{title}</p>
      {/* A div, not a <p>: callers pass <p> children (AboutContent) and a <p> may
          never nest inside another <p> — the browser would close the tag early. */}
      <div className="mt-1 text-sm text-slate-700">{children}</div>
    </div>
  );
}

/** Uncontrolled accordion: a native <details>, so the browser owns open/closed
 *  state, keyboard behaviour and the full content (no clamping, no max-height).
 *  Closed by default; opening shows the content in full.
 *  `nested` renders the lighter style used for one-question-per-row lists. */
export function Accordion({ title, children, nested }: {
  title: string;
  children: React.ReactNode;
  nested?: boolean;
}) {
  if (nested) {
    return (
      <details className="group rounded-lg border border-slate-100 bg-slate-50">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-semibold text-slate-700 [&::-webkit-details-marker]:hidden">
          <span>{title}</span>
          <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
        </summary>
        <div className="px-3 pb-3 text-sm text-slate-600">{children}</div>
      </details>
    );
  }
  return (
    <details className="group rounded-xl border border-slate-200 bg-white">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 text-sm text-slate-600">{children}</div>
    </details>
  );
}