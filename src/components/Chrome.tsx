import type { ReactNode } from "react";
import { ArrowLeft, Bell, X, WifiOff } from "lucide-react";
import { HAZARD_KINDS } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import type { NavTab } from "../lib/navigation";

export type { NavTab };

export function BackBarFor({ title, onBack, backLabel = "Back", actions }: {
  title: string;
  onBack: () => void;
  backLabel?: string;
  /** Right-aligned on the title row — page-level filter / action buttons. */
  actions?: ReactNode;
}) {
  return (
    <div data-testid="back-bar" className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
      <button type="button" onClick={onBack} className="min-h-12 flex items-center gap-1.5 rounded-xl bg-brand-100 px-3 text-sm font-bold text-brand-800">
        <ArrowLeft size={16} /> {backLabel}
      </button>
      <h2 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{title}</h2>
      {actions && <div data-back-bar-actions className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
}

export function Header({ title, subtitle, action }: { title: string; subtitle?: string; /** Page-level pill (e.g. Headcount needed). */ action?: ReactNode }) {
  const { user, notifPermission, enableNotifications } = useApp();
  return (
    <header className="sticky top-0 z-30 text-white pt-[env(safe-area-inset-top)]"
      style={{ background: "linear-gradient(135deg,#425B9A 0%,#283762 100%)", boxShadow: "0 2px 12px rgba(40,55,98,.40)" }}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-3 py-2">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/30 bg-cream">
          <img src="/icons/logo-256.png" alt="" className="h-full w-full object-contain p-0.5" width={40} height={40} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-black leading-tight tracking-tight">{title}</p>
          {subtitle && <p className="truncate text-xs leading-tight text-white/80">{subtitle}</p>}
        </div>
        {action}
        {user && notifPermission === "default" && (
          <button onClick={() => void enableNotifications()} aria-label="Turn on alert notifications"
            title="Turn on alert notifications" className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15 hover:bg-white/25">
            <Bell size={18} />
          </button>
        )}
      </div>
    </header>
  );
}

/**
 * One slim banner at a time, by priority: offline > hazard > drill.
 * Nothing is shown while online and idle.
 */
export function StatusBanner() {
  const { user, online, queue, modes } = useApp();
  if (!user) return null;
  const queued = queue.length;

  if (!online) {
    return (
      <div role="status" className="flex items-center justify-center gap-1.5 overflow-hidden whitespace-nowrap bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white">
        <WifiOff size={13} className="shrink-0" />
        <span className="truncate">
          {queued > 0 ? `Offline · ${queued} report${queued === 1 ? "" : "s"} queued` : "Offline · showing last known information"}
        </span>
      </div>
    );
  }
  if (queued > 0) {
    return (
      <div role="status" className="truncate bg-slate-700 px-3 py-1.5 text-center text-xs font-semibold text-white">
        {queued} report{queued === 1 ? "" : "s"} queued to send
      </div>
    );
  }
  if (modes.hazard.active) {
    const kind = HAZARD_KINDS.find((k: { id: string; label: string }) => k.id === modes.hazard.kind)?.label ?? "Hazard";
    return (
      <div role="status" className="truncate bg-accent-100 px-3 py-1.5 text-center text-xs font-bold text-accent-700">
        Hazard Mode ON · {kind}
      </div>
    );
  }
  if (modes.drill.active) {
    return (
      <div role="status" className="truncate bg-brand-700 px-3 py-1.5 text-center text-xs font-bold text-white">
        Drill in progress{modes.drill.label ? ` · ${modes.drill.label}` : ""}
      </div>
    );
  }
  return null;
}

export function AlertToasts() {
  const { alerts, dismissAlert } = useApp();
  if (!alerts.length) return null;
  return (
    <div className="fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[60] flex flex-col items-center gap-2 px-2 pointer-events-none" aria-live="assertive">
      {alerts.map((a) => (
        <div key={a.id} className="pointer-events-auto w-full max-w-md animate-slide-down overflow-hidden rounded-2xl text-white shadow-2xl"
          style={{ background: a.kind === "clear" ? "linear-gradient(135deg,#16A34A,#166534)" : a.kind === "error" ? "linear-gradient(135deg,#C2415C,#7A1F35)" : a.kind === "info" ? "linear-gradient(135deg,#475569,#1E293B)" : "linear-gradient(135deg,#425B9A,#283762)" }}
          role="alert">
          <div className="flex items-start gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold leading-tight">{a.title}</p>
              <p className="mt-0.5 break-words text-xs text-white/85">{a.body}</p>
            </div>
            <button onClick={() => dismissAlert(a.id)} aria-label="Dismiss" className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20"><X size={14} /></button>
          </div>
          <div className="h-1 bg-white/25"><div className="h-full bg-white/80" style={{ animation: "shrink-bar 8s linear forwards" }} /></div>
        </div>
      ))}
    </div>
  );
}

function NavBadge({ count }: { count: number }) {
  return (
    <span data-testid="nav-badge" className="min-w-4 rounded-full bg-blush-600 px-1 text-center text-[10px] leading-4 font-bold text-white">
      {count}
    </span>
  );
}

function navButton<T extends string>(t: NavTab<T>, tab: T, setTab: (t: T) => void, layout: "bottom" | "side"): ReactNode {
  const Icon = t.icon;
  const active = tab === t.id;
  const badge = typeof t.badge === "number" && t.badge > 0 ? t.badge : 0;
  const label = badge ? `${t.label}, ${badge} pending` : t.label;
  if (layout === "bottom") {
    return (
      <button key={t.id} onClick={() => setTab(t.id)} aria-current={active ? "page" : undefined} aria-label={label}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 py-2">
        <span className="relative">
          <Icon size={20} className={active ? "text-brand-600" : "text-slate-400"} />
          {badge > 0 && <span className="absolute -right-3 -top-2"><NavBadge count={badge} /></span>}
        </span>
        <span className={`text-[11px] font-bold ${active ? "text-brand-600" : "text-slate-500"}`}>{t.label}</span>
      </button>
    );
  }
  return (
    <button key={t.id} onClick={() => setTab(t.id)} aria-current={active ? "page" : undefined}
      aria-label={label} title={label}
      className={`flex min-h-12 w-full items-center justify-center gap-3 rounded-xl px-3 text-sm font-bold lg:justify-start ${active ? "bg-white/15 text-white" : "text-white/70 hover:bg-white/10"}`}>
      <span className="relative shrink-0">
        <Icon size={18} className="shrink-0" />
        {badge > 0 && <span className="absolute -right-3 -top-2 lg:hidden"><NavBadge count={badge} /></span>}
      </span>
      <span className="hidden lg:inline">{t.label}</span>
      {badge > 0 && <span className="ml-auto hidden lg:inline"><NavBadge count={badge} /></span>}
    </button>
  );
}

export function BottomNav<T extends string>({ tab, setTab, tabs, contained }: {
  tab: T; setTab: (t: T) => void; tabs: NavTab<T>[]; contained?: boolean;
}) {
  return (
    <nav aria-label="Sections"
      className={`fixed bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] ${contained ? "inset-x-0 md:hidden" : "inset-x-0 md:hidden"}`}>
      {tabs.map((t) => navButton(t, tab, setTab, "bottom"))}
    </nav>
  );
}

export function SideNav<T extends string>({ tab, setTab, tabs, subtitle }: {
  tab: T; setTab: (t: T) => void; tabs: NavTab<T>[]; subtitle?: string;
}) {
  return (
    // Hidden below 768px (the bottom nav takes over); 72px icon-only rail on
    // tablets and the full 240px rail from 1024px up.
    <aside className="scroll-area sticky top-0 hidden h-dvh w-[72px] shrink-0 flex-col bg-brand-900 text-white md:flex lg:w-60">
      <div className="flex h-16 items-center justify-center gap-2.5 border-b border-white/10 px-2 lg:justify-start lg:px-4">
        <img src="/icons/logo-256.png" alt="" className="h-9 w-9 shrink-0 rounded-lg bg-cream object-contain p-0.5" width={36} height={36} />
        <div className="hidden min-w-0 lg:block">
          <p className="truncate text-sm font-black tracking-tight">ASPIRE</p>
          {subtitle && <p className="truncate text-[11px] text-white/70">{subtitle}</p>}
        </div>
      </div>
      <nav aria-label="Sections" className="flex-1 space-y-1 p-2">
        {tabs.map((t) => navButton(t, tab, setTab, "side"))}
      </nav>
    </aside>
  );
}
