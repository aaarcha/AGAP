import { useState, useEffect } from "react";
import { ChevronDown, X } from "lucide-react";

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
      <p className="mt-1 text-sm text-slate-700">{children}</p>
    </div>
  );
}

export function Accordion({ title, children, expanded, onToggle }: {
  title: string;
  children: React.ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (expanded !== undefined) setIsExpanded(expanded);
  }, [expanded]);

  const handleToggle = () => {
    setIsExpanded((prev: boolean) => !prev);
    onToggle?.();
  };

  return (
    <details className="mt-3" open={isExpanded}>
      <summary
        className="
          cursor-pointer
          flex items-center gap-2
          text-sm font-medium text-slate-700
          hover:text-brand-600
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 focus-visible:ring-2
        "
        onClick={handleToggle}
      >
        {title}
        <ChevronDown size={14} className="shrink-0 text-slate-400 transition-transform duration-200 [&.rotated]:transform-rotate-180" />
      </summary>
      <div className="mt-2 text-sm text-slate-600 line-clamp-3">
        {children}
      </div>
    </details>
  );
}