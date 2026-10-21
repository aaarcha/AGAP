import { useMemo } from "react";
import { BookOpen, History, Radio } from "lucide-react";
import { useApp } from "../lib/store";
import type { Incident } from "../lib/types";
import { EscalationTable, IncidentCard } from "../components/Incident";
import HistorySection from "../components/History";
import { RouteControl } from "../components/Rules";

export function IncidentQueue({ incidents, title, empty }: { incidents: Incident[]; title: string; empty: string }) {
  // Real emergencies first, then critical overrides, then by urgency score, then oldest first.
  const active = useMemo(
    () => incidents.filter((i) => i.status !== "RESOLVED").sort((a, b) =>
      Number(Boolean(a.drill)) - Number(Boolean(b.drill)) ||
      Number(b.overrideReasons.length > 0) - Number(a.overrideReasons.length > 0) ||
      b.score - a.score || a.createdAt - b.createdAt),
    [incidents],
  );
  return (
    <section>
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">{title}</h2>
      {active.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl text-center py-10 px-4">
          <p className="text-3xl" aria-hidden>🟢</p>
          <p className="text-sm text-slate-500 mt-1">{empty}</p>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2 items-start">
        {active.map((inc) => <IncidentCard key={inc.id} inc={inc} showActions showLog />)}
      </div>
    </section>
  );
}

export const RESPONDER_TABS = [
  { id: "queue" as const, label: "Dispatch Queue", icon: Radio },
  { id: "history" as const, label: "History", icon: History },
  { id: "ref" as const, label: "Escalation Matrix", icon: BookOpen },
];

export type ResponderTab = (typeof RESPONDER_TABS)[number]["id"];

export default function ResponderView({ tab }: { tab: ResponderTab }) {
  const { incidents } = useApp();
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3">
      {tab === "queue" && <div className="mb-3 max-w-xl"><RouteControl /></div>}
      {tab === "queue" && <IncidentQueue incidents={incidents} title="Priority Dispatch Queue" empty="No active dispatches." />}
      {tab === "history" && <div className="max-w-2xl mx-auto"><HistorySection title="Incident history" /></div>}
      {tab === "ref" && <div className="max-w-2xl mx-auto"><EscalationTable /></div>}
    </div>
  );
}
