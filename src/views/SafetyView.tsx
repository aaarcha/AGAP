import { useState } from "react";
import { FlaskConical, ShieldAlert, Users } from "lucide-react";
import { HAZARD_KINDS } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { dateTime, fmtMs } from "../lib/format";
import { InfoButton } from "../components/Modal";
import { Select } from "../components/Select";
import { PageFlow } from "../components/PageShell";
import type { DrillSummary } from "../lib/types";

const card = "rounded-2xl border border-slate-200 bg-white p-4";
const h2 = "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500";

function HazardCard() {
  const { modes, setHazard } = useApp();
  const hz = modes.hazard;
  const [kind, setKind] = useState(hz.kind);
  const [note, setNote] = useState(hz.note);
  const [busy, setBusy] = useState(false);
  async function toggle() { setBusy(true); try { await setHazard(!hz.active, kind, note); } finally { setBusy(false); } }
  return (
    <section className={card}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className={h2}><ShieldAlert size={14} /> Hazard mode</h2>
        <InfoButton title="Hazard mode">
          <p>Turn this on during a flood warning or typhoon signal.</p>
          <p>Group-scope incidents in ground-floor and low-lying areas are raised in priority while it is on. Switches take effect immediately and need no internet beyond the usual connection.</p>
        </InfoButton>
      </div>
      <div className="mb-2 grid grid-cols-2 gap-2">
        <Select value={kind} onChange={setKind} disabled={hz.active} ariaLabel="Hazard type"
          options={HAZARD_KINDS.map((k: { id: string; label: string }) => ({ value: k.id, label: k.label }))} />
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} disabled={hz.active} placeholder="Note (optional)" aria-label="Hazard note"
          className="min-h-12 rounded-xl border border-slate-300 px-3 text-sm" />
      </div>
      <button onClick={() => void toggle()} disabled={busy} aria-pressed={hz.active}
        className={`min-h-14 w-full rounded-xl text-sm font-bold ${hz.active ? "bg-blush text-brand-900" : "bg-brand-600 text-white"}`}>
        {hz.active ? "Turn Hazard Mode OFF" : "Turn Hazard Mode ON"}
      </button>
      {hz.active && <p className="mt-2 text-xs font-semibold text-accent-700">On since {hz.since ? dateTime(hz.since) : "now"}{hz.by ? ` · ${hz.by}` : ""}.</p>}
    </section>
  );
}

function DrillRow({ d }: { d: DrillSummary }) {
  return (
    <li className="border-b border-slate-100 py-2.5 last:border-0">
      <p className="text-sm font-bold text-slate-800">{d.label} <span className="font-normal text-slate-400">· {dateTime(d.startedAt)}</span></p>
      <p className="text-xs text-slate-500">{d.incidents} drill report(s) · started by {d.startedBy}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-5">
        {([["Time to report", fmtMs(d.avgToReportMs)], ["Time to acknowledge", fmtMs(d.avgToAckMs)], ["Time to on-site", fmtMs(d.avgToOnSiteMs)], ["Time to headcount", fmtMs(d.avgToHeadcountMs)], ["Taps per report", d.avgInteractions === null ? "—" : String(d.avgInteractions)]] as const).map(([k, v]) => (
          <div key={k}><dt className="text-slate-400">{k}</dt><dd className="font-mono font-bold text-slate-700">{v}</dd></div>
        ))}
      </dl>
    </li>
  );
}

function DrillCard() {
  const { modes, setDrill, incidents, drills } = useApp();
  const [label, setLabel] = useState("Quarterly earthquake drill");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<DrillSummary | null>(null);
  const dr = modes.drill;
  const live = incidents.filter((i) => (i.drill && i.status !== "RESOLVED") || (i.drill && i.outcome === "drill" && dr.active));
  async function toggle() {
    setBusy(true);
    try { const s = await setDrill(!dr.active, label); if (s) setLast(s); } finally { setBusy(false); }
  }
  return (
    <section className={card}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className={h2}><FlaskConical size={14} /> Drill mode</h2>
        <InfoButton title="Drill mode">
          <p>Runs a school drill on the live workflow. Reports are marked as drill, parents are not alarmed, and response times and taps per report are recorded for the drill report.</p>
        </InfoButton>
      </div>
      <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 80))} disabled={dr.active} aria-label="Drill name" placeholder="Drill name"
        className="mb-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm" />
      <button onClick={() => void toggle()} disabled={busy || (!dr.active && !label.trim())} aria-pressed={dr.active}
        className={`min-h-14 w-full rounded-xl text-sm font-bold ${dr.active ? "bg-blush text-brand-900" : "bg-brand-600 text-white"}`}>
        {dr.active ? "End drill & save metrics" : "Start drill"}
      </button>
      {dr.active && (
        <div className="mt-3 rounded-xl bg-accent-100 p-3" aria-live="polite">
          <p className="text-sm font-bold text-accent-700">{dr.label} — running since {dr.startedAt ? dateTime(dr.startedAt) : ""}</p>
          <p className="mt-0.5 text-xs text-accent-700">{live.length} drill report(s) so far.</p>
        </div>
      )}
      {last && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3" role="status">
          <p className="text-sm font-bold text-emerald-800">Drill saved</p>
          <ul><DrillRow d={last} /></ul>
        </div>
      )}
      <h3 className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">Past drills</h3>
      {drills.length === 0 ? <p className="text-sm text-slate-500">No drills recorded yet.</p> : <ul>{drills.map((d) => <DrillRow key={d.id} d={d} />)}</ul>}
    </section>
  );
}

function HeadcountStatus() {
  const { incidents } = useApp();
  const rows = incidents.filter((i) => i.status !== "RESOLVED" && i.accountability.status !== "not_required");
  const tone: Record<string, string> = {
    pending: "bg-slate-100 text-slate-600",
    partial: "bg-accent-100 text-accent-700",
    verified: "bg-emerald-100 text-emerald-700",
    mismatch: "bg-blush-100 text-blush-700",
  };
  const label = (s: string) => (s === "pending" ? "Not started" : s === "partial" ? "Partly reported" : s === "verified" ? "All accounted for" : "Mismatch");
  return (
    <section className={card}>
      <h2 className={`${h2} mb-2`}><Users size={14} /> Headcount status</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-500">No group-scope incident needs a headcount right now.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((i) => (
            <li key={i.id} className="rounded-xl border border-slate-100 p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{i.categoryLabel} — {i.subLabel}</p>
                  <p className="truncate text-xs text-slate-500">📍 {i.room} · {i.linkedSection === "ALL" ? "whole school" : i.linkedSection}</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${tone[i.accountability.status] ?? tone.pending}`}>
                  {label(i.accountability.status)}
                </span>
              </div>
              {i.headcounts.length > 0 && (
                <p className="mt-1.5 text-xs text-slate-600">
                  {i.headcounts.map((h) => `${h.section} ${h.present}/${h.expected}`).join(" · ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function SafetyView() {
  return (
    <PageFlow className="grid items-start gap-3 lg:grid-cols-2">
      <div className="space-y-3"><HazardCard /><HeadcountStatus /></div>
      <DrillCard />
    </PageFlow>
  );
}
