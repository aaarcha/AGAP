import type { ReactNode } from "react";
import { Bell, LogOut, Wifi, WifiOff, X, Download } from "lucide-react";
import { DISCLAIMERS } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { usePwaInstall } from "../lib/pwa";
import { catTheme } from "../lib/theme";

export function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  const { user, logout, connected, live, notifPermission, enableNotifications } = useApp();
  return (
    <header className="sticky top-0 z-30 text-white pt-[env(safe-area-inset-top)]"
      style={{ background: "linear-gradient(135deg,#DC2626 0%,#991B1B 100%)", boxShadow: "0 2px 12px rgba(185,28,28,.45)" }}>
      <div className="mx-auto max-w-6xl flex items-center gap-3 px-3 py-2">
        <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-white border border-white/30">
          <img src="/icons/logo-256.png" alt="AGAP" className="w-full h-full object-contain p-0.5" width={40} height={40} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-black leading-tight truncate tracking-tight">{title}</p>
          {subtitle && <p className="text-xs text-white/80 leading-tight truncate">{subtitle}</p>}
        </div>
        <span className={`hidden sm:inline-flex items-center gap-1 text-xs font-bold rounded-full px-2 py-1 ${connected && live ? "bg-emerald-500/25 text-emerald-100" : connected ? "bg-amber-400/25 text-amber-100" : "bg-black/25 text-slate-200"}`}>
          {connected ? <Wifi size={12} /> : <WifiOff size={12} />}{connected ? (live ? "LIVE" : "SYNCING") : "OFFLINE"}
        </span>
        {notifPermission === "default" && (
          <button onClick={enableNotifications} aria-label="Turn on alert notifications" title="Turn on alert notifications"
            className="p-2 rounded-lg bg-white/15 hover:bg-white/25"><Bell size={18} /></button>
        )}
        {user && (
          <button onClick={() => logout()} aria-label="Sign out" title="Sign out" className="p-2 rounded-lg bg-white/15 hover:bg-white/25"><LogOut size={18} /></button>
        )}
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3">
      <p className="mx-auto max-w-6xl text-xs leading-snug text-slate-500 text-center">{DISCLAIMERS.footer}</p>
    </footer>
  );
}

export function IllustrativeTag({ text = "Illustrative example — pending final Expert Panel session" }: { text?: string }) {
  return <p className="text-xs leading-snug text-slate-500 italic mt-1.5">{text}</p>;
}

export function ConnectionBanner() {
  const { connected, online, simulateOffline, user, live, queue } = useApp();
  if (!user) return null;
  if (!connected) {
    return (
      <div role="status" className="bg-slate-800 text-white text-sm px-4 py-2 text-center">
        <WifiOff size={14} className="inline mr-1.5 -mt-0.5" />
        {simulateOffline ? "Demo: no connection simulated." : !online ? "You're offline." : "Can't reach the server."}{" "}
        Showing the last information received.{queue.length > 0 ? ` ${queue.length} report(s) waiting to send.` : ""}
      </div>
    );
  }
  if (!live) return <div role="status" className="bg-amber-100 text-amber-900 text-xs px-4 py-1.5 text-center">Reconnecting to live updates…</div>;
  return null;
}

export function AlertToasts() {
  const { alerts, dismissAlert } = useApp();
  if (!alerts.length) return null;
  return (
    <div className="fixed top-[max(0.5rem,env(safe-area-inset-top))] inset-x-0 z-[60] px-2 flex flex-col gap-2 items-center pointer-events-none" aria-live="assertive">
      {alerts.map((a) => {
        const ct = catTheme(a.category ?? "other");
        const bg = a.kind === "clear" ? "linear-gradient(135deg,#16A34A,#166534)" : a.kind === "error" ? "linear-gradient(135deg,#DC2626,#7F1D1D)" : a.kind === "info" ? "linear-gradient(135deg,#475569,#1E293B)" : ct.gradient;
        return (
          <div key={a.id} className="pointer-events-auto w-full max-w-md rounded-2xl overflow-hidden shadow-2xl text-white animate-slide-down" style={{ background: bg }} role="alert">
            <div className="flex items-start gap-2 px-3 py-2.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold leading-tight">{a.title}</p>
                <p className="text-xs text-white/85 mt-0.5 break-words">{a.body}</p>
              </div>
              <button onClick={() => dismissAlert(a.id)} aria-label="Dismiss" className="p-1.5 rounded-full bg-white/20"><X size={14} /></button>
            </div>
            <div className="h-1 bg-white/25"><div className="h-full bg-white/80" style={{ animation: "shrink-bar 8s linear forwards" }} /></div>
          </div>
        );
      })}
    </div>
  );
}

export function InstallBanner() {
  const { canInstall, iosHint, install, dismiss } = usePwaInstall();
  if (!canInstall && !iosHint) return null;
  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-4 inset-x-0 z-40 px-3 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md bg-slate-900 text-white rounded-2xl shadow-2xl p-3 flex items-center gap-3">
        <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-lg shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold">Install AGAP</p>
          <p className="text-xs text-slate-300 leading-snug">
            {canInstall ? "Add it to your home screen to open it like an app, even with a weak signal." : "Tap Share, then “Add to Home Screen”."}
          </p>
        </div>
        {canInstall && (
          <button onClick={install} className="min-h-10 px-3 rounded-xl bg-red-600 text-sm font-bold flex items-center gap-1"><Download size={14} />Install</button>
        )}
        <button onClick={dismiss} aria-label="Not now" className="p-2 text-slate-400"><X size={16} /></button>
      </div>
    </div>
  );
}

export function TabBar<T extends string>({ tab, setTab, tabs }: {
  tab: T; setTab: (t: T) => void; tabs: { id: T; label: string; icon: React.ElementType }[];
}) {
  const button = (t: { id: T; label: string; icon: React.ElementType }, layout: "bottom" | "top"): ReactNode => {
    const Icon = t.icon;
    const active = tab === t.id;
    return (
      <button key={t.id} onClick={() => setTab(t.id)} aria-current={active ? "page" : undefined}
        className={layout === "bottom"
          ? "flex-1 flex flex-col items-center justify-center gap-0.5 py-2 min-h-14"
          : `flex items-center gap-2 px-4 py-3 text-sm font-bold border-b-2 ${active ? "border-red-600 text-red-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
        <Icon size={layout === "bottom" ? 20 : 16} className={active ? "text-red-600" : "text-slate-400"} />
        <span className={layout === "bottom" ? `text-xs font-bold ${active ? "text-red-600" : "text-slate-500"}` : ""}>{t.label}</span>
      </button>
    );
  };
  return (
    <>
      <nav aria-label="Sections" className="md:hidden fixed bottom-0 inset-x-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)]">
        {tabs.map((t) => button(t, "bottom"))}
      </nav>
      <nav aria-label="Sections" className="hidden md:block border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl flex px-2">{tabs.map((t) => button(t, "top"))}</div>
      </nav>
    </>
  );
}
