import { useMemo, useState } from "react";
import { useMediaQuery } from "../lib/hooks";
import { BookOpen, History, Radio, User } from "lucide-react";
import { STATUS_LABEL, bandFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import type { Incident } from "../lib/types";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { EscalationTable, IncidentCard } from "../components/Incident";
import HistorySection from "../components/History";
import { RouteControl } from "../components/Rules";
import AccountView from "./AccountView";

function QueueRow({ inc, active, onSelect }: { inc: Incident; active: boolean; onSelect: () => void }) {
  const ct = catTheme(inc.category);
  const band = bandFor(inc.score, inc.status, inc.overrideReasons);
  const bs = BAND_STYLE[band];
  return (
    <button onClick={onSelect} aria-current={active ? "true" : undefined}
      className={`w-full rounded-xl border p-3 text-left ${active ? "border-brand-500 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-brand-300"}`}>
      <div className="flex items-center gap-2">
        <span aria-hidden>{ct.emoji}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{inc.subLabel}</span>
        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide"
          style={{ background: bs.bg, color: bs.color, border: `1px solid ${bs.color}55` }}>{band}</span>
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">📍 {inc.room}</p>
      <p className="mt-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">{STATUS_LABEL[inc.status]}{inc.drill ? " · Drill" : ""}</p>
    </button>
  );
}

export function IncidentQueue({ incidents, title, empty }: { incidents: Incident[]; title: string; empty: string }) {
  // Real emergencies first, then critical overrides, then by urgency, then oldest first.
  const active = useMemo(
    () => incidents.filter((i) => i.status !== "RESOLVED").sort((a, b) =>
      Number(Boolean(a.drill)) - Number(Boolean(b.drill)) ||
      Number(b.overrideReasons.length > 0) - Number(a.overrideReasons.length > 0) ||
      b.score - a.score || a.createdAt - b.createdAt),
    [incidents],
  );
  const [sel, setSel] = useState<string | null>(null);
  const selected = active.find((i) => i.id === sel) ?? active[0];

  return (
    <section>
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h2>
      {active.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
          <p className="text-3xl" aria-hidden>🟢</p>
          <p className="mt-1 text-sm text-slate-500">{empty}</p>
        </div>
      ) : (
        <>
          {/* Wide screens: queue list + selected ticket */}
          <div className="hidden items-start gap-4 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)]">
            <ul className="max-h-[calc(100dvh-14rem)] space-y-2 overflow-y-auto pr-1">
              {active.map((inc) => (
                <li key={inc.id}>
                  <QueueRow inc={inc} active={selected?.id === inc.id} onSelect={() => setSel(inc.id)} />
                </li>
              ))}
            </ul>
            <div>{selected && <IncidentCard inc={selected} showActions showLog />}</div>
          </div>
          {/* Phones / tablets: stacked cards */}
          <div className="grid gap-3 lg:hidden">
            {active.map((inc) => <IncidentCard key={inc.id} inc={inc} showActions showLog />)}
          </div>
        </>
      )}
    </section>
  );
}

export const RESPONDER_TABS = [
  { id: "queue" as const, label: "Queue", icon: Radio },
  { id: "history" as const, label: "History", icon: History },
  { id: "ref" as const, label: "Escalation", icon: BookOpen },
  { id: "account" as const, label: "Account", icon: User },
];

export type ResponderTab = (typeof RESPONDER_TABS)[number]["id"];

export default function ResponderView({ tab }: { tab: ResponderTab }) {
  const wide = useMediaQuery("screen and (min-width: 1024px)");
  const { incidents } = useApp();
  return (
    <>
      {tab === "queue" && (
        <div className={`mx-auto w-full ${wide ? "max-w-7xl" : "max-w-3xl"} space-y-3 px-3 py-3`}>
          <div className={wide ? "" : "max-w-xl"}><RouteControl /></div>
          <IncidentQueue incidents={incidents} title="Priority dispatch queue" empty="No active dispatches." />
        </div>
      )}
      {tab === "history" && <div className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-3xl"} px-3 py-3`}><HistorySection title="Incident history" /></div>}
      {tab === "ref" && <div className={`mx-auto w-full ${wide ? "max-w-5xl" : "max-w-2xl"} px-3 py-3`}><EscalationTable /></div>}
      {tab === "account" && <AccountView />}
    </>
  );
}
