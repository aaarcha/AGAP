import { useState } from "react";
import { ClipboardList, History, SlidersHorizontal, Siren, Users } from "lucide-react";
import { CONSISTENCY, DISCLAIMERS, SCHOOL, WEIGHTS } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { startOfToday } from "../lib/format";
import { BAND_STYLE } from "../lib/theme";
import { ConfirmModal } from "../components/Modal";
import { EscalationTable } from "../components/Incident";
import { IllustrativeTag } from "../components/Chrome";
import HistorySection from "../components/History";
import ReportView from "./ReportView";
import RosterPanel from "./RosterPanel";
import { IncidentQueue } from "./ResponderView";

export const PRINCIPAL_TABS = [
  { id: "command" as const, label: "Command", icon: ClipboardList },
  { id: "report" as const, label: "Report", icon: Siren },
  { id: "history" as const, label: "History", icon: History },
  { id: "roster" as const, label: "Roster", icon: Users },
  { id: "weights" as const, label: "Weights", icon: SlidersHorizontal },
];
export type PrincipalTab = (typeof PRINCIPAL_TABS)[number]["id"];

function Stat({ value, label, tone }: { value: string | number; label: string; tone: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 text-center">
      <p className={`font-mono text-2xl font-extrabold leading-none ${tone}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-1.5">{label}</p>
    </div>
  );
}

function Command() {
  const { incidents, roster, now } = useApp();
  const active = incidents.filter((i) => i.status !== "RESOLVED").length;
  const today = incidents.filter((i) => i.createdAt >= startOfToday(now)).reduce((n, i) => n + i.confirmedBy, 0);
  const staff = roster.filter((r) => r.status === "active").length;
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3 space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat value={active} label="Active incidents" tone="text-red-600" />
        <Stat value={today} label="Total reports today" tone="text-slate-700" />
        <Stat value={staff} label="Active staff" tone="text-emerald-600" />
        <Stat value={SCHOOL.depedId} label="Sinalhan ES · DepEd ID" tone="text-slate-700 !text-xl" />
      </div>
      <IncidentQueue incidents={incidents} title="Active Incident Command Queue" empty="No active incidents." />
    </div>
  );
}

function Weights() {
  const { config, resetDemo } = useApp();
  const [confirmReset, setConfirmReset] = useState(false);
  const rows: [string, number][] = [
    ["Severity", WEIGHTS.severity], ["Vulnerability", WEIGHTS.vulnerability], ["Location Risk", WEIGHTS.locationRisk], ["Time Sensitivity", WEIGHTS.timeSensitivity],
  ];
  const bands: [string, string][] = [["CRITICAL", "≥ 4.0"], ["HIGH", "3.0 – 3.99"], ["MODERATE", "< 3.0"], ["RESOLVED", "closed by Principal or Responder"]];
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3 grid gap-3 lg:grid-cols-2 items-start">
      <div className="space-y-3">
        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">AHP → SAW Urgency Engine (view only)</h2>
          {rows.map(([l, w]) => (
            <div key={l} className="flex items-center justify-between py-1">
              <span className="text-sm text-slate-700">{l}</span>
              <span className="font-mono text-base font-bold text-red-600">{w.toFixed(2)}</span>
            </div>
          ))}
          <p className="font-mono text-xs text-slate-500 mt-2 break-words">Urgency = 0.50×Severity + 0.29×Vulnerability + 0.11×LocationRisk + 0.10×TimeSensitivity</p>
          <IllustrativeTag text={DISCLAIMERS.illustrative} />
        </section>
        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-sm font-semibold text-slate-700">Consistency Ratio: <span className="font-mono text-red-600">CR ≈ {CONSISTENCY.cr}</span></p>
          <p className="text-xs text-slate-500 mt-0.5">λmax ≈ {CONSISTENCY.lambdaMax}, CI ≈ {CONSISTENCY.ci}, RI = {CONSISTENCY.ri} (n = {CONSISTENCY.n})</p>
          <IllustrativeTag text={DISCLAIMERS.crExample} />
        </section>
        <section className="bg-white border border-slate-200 rounded-2xl p-4">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Score bands</h2>
          {bands.map(([l, r]) => (
            <div key={l} className="flex items-center justify-between text-sm py-1">
              <span className="font-bold" style={{ color: BAND_STYLE[l].color }}>{l}</span><span className="font-mono text-slate-500 text-right">{r}</span>
            </div>
          ))}
          <IllustrativeTag text="Score bands are illustrative examples pending the real expert panel session — not final results." />
        </section>
        <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1.5">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Scope &amp; honesty labels</h2>
          <p className="text-sm text-slate-600">{DISCLAIMERS.scope}</p>
          <p className="text-sm text-slate-600">{DISCLAIMERS.noAutoDetect}</p>
          {config?.demoReset && (
            <div className="pt-3 mt-2 border-t border-slate-100">
              <p className="text-xs text-slate-500 mb-2">Demo tools — clears every incident and restores the sample roster for all devices.</p>
              <button onClick={() => setConfirmReset(true)} className="min-h-10 px-4 rounded-xl bg-slate-100 text-slate-700 text-sm font-bold">Reset demo data</button>
            </div>
          )}
        </section>
      </div>
      <EscalationTable />
      {confirmReset && <ConfirmModal title="Reset demo data?" danger confirmLabel="Reset" onClose={() => setConfirmReset(false)} onConfirm={() => void resetDemo()}
        message="All incidents will be deleted and the roster returns to the sample teachers. Everyone signed in as a removed teacher will be signed out." />}
    </div>
  );
}

export default function PrincipalView({ tab }: { tab: PrincipalTab }) {
  return (
    <>
      {tab === "command" && <Command />}
      {tab === "report" && <ReportView />}
      {tab === "history" && <div className="mx-auto w-full max-w-3xl px-3 py-3"><HistorySection title="Incident history (official record)" /></div>}
      {tab === "roster" && <RosterPanel />}
      {tab === "weights" && <Weights />}
    </>
  );
}
