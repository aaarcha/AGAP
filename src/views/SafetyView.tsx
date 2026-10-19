import { useState } from "react";
import { FlaskConical, ShieldAlert } from "lucide-react";
import {
  ESCALATION_TIERS, HAZARD_KINDS, HAZARD_LOCATION_BOOST, ROUTE_SPEED_FACTOR, TRANSPORT_MODES,
} from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { dateTime, fmtMs } from "../lib/format";
import { RouteControl } from "../components/Rules";
import { IllustrativeTag } from "../components/Chrome";
import type { DrillSummary } from "../lib/types";

const card = "bg-white border border-slate-200 rounded-2xl p-4";
const h2 = "text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5";

function HazardCard() {
  const { modes, setHazard } = useApp();
  const hz = modes.hazard;
  const [kind, setKind] = useState(hz.kind);
  const [note, setNote] = useState(hz.note);
  const [busy, setBusy] = useState(false);
  async function toggle() { setBusy(true); try { await setHazard(!hz.active, kind, note); } finally { setBusy(false); } }
  return (
    <section className={card}>
      <h2 className={h2}><ShieldAlert size={14} /> Hazard mode</h2>
      <p className="text-sm text-slate-600 mb-3">
        During a flood warning or typhoon signal, raise <b>Location Risk +{HAZARD_LOCATION_BOOST}</b> (max 5) for ground-floor rooms and low-lying areas (canteen, quadrangle, covered court). Open incidents are re-scored immediately. No internet service is needed — you switch it on yourself.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-2">
        <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={hz.active} aria-label="Hazard type" className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm">
          {HAZARD_KINDS.map((k: { id: string; label: string }) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} disabled={hz.active} placeholder="Note (optional)" aria-label="Hazard note" className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm" />
      </div>
      <button onClick={toggle} disabled={busy} aria-pressed={hz.active}
        className={`w-full min-h-12 rounded-xl font-bold text-sm ${hz.active ? "bg-blush text-brand-900" : "bg-brand-600 text-white"}`}>
        {hz.active ? "Turn Hazard Mode OFF" : "Turn Hazard Mode ON"}
      </button>
      {hz.active && <p className="text-xs text-accent-700 mt-2 font-semibold">ON since {hz.since ? dateTime(hz.since) : "now"}{hz.by ? ` by ${hz.by}` : ""}.</p>}
      <IllustrativeTag text={`Illustrative +${HAZARD_LOCATION_BOOST} adjustment — to be validated against Barangay Sinalhan's flood-vulnerability profile.`} />
    </section>
  );
}

function DrillRow({ d }: { d: DrillSummary }) {
  return (
    <li className="py-2.5 border-b border-slate-100 last:border-0">
      <p className="text-sm font-bold text-slate-800">{d.label} <span className="font-normal text-slate-400">· {dateTime(d.startedAt)}</span></p>
      <p className="text-xs text-slate-500">{d.incidents} drill report(s) · started by {d.startedBy}</p>
      <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-3 gap-y-1 mt-1.5 text-xs">
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
  const live = incidents.filter((i) => i.drill && i.status !== "RESOLVED" || (i.drill && i.outcome === "drill" && dr.active));
  async function toggle() {
    setBusy(true);
    try { const s = await setDrill(!dr.active, label); if (s) setLast(s); } finally { setBusy(false); }
  }
  return (
    <section className={card}>
      <h2 className={h2}><FlaskConical size={14} /> Drill mode</h2>
      <p className="text-sm text-slate-600 mb-3">
        Run a mandated campus drill on the live workflow. Reports are tagged <b>DRILL</b>, parents are not alarmed, and the app passively records time-to-report, time-to-acknowledge, time-to-on-site, time-to-headcount and taps per report.
      </p>
      <input value={label} onChange={(e) => setLabel(e.target.value.slice(0, 80))} disabled={dr.active} aria-label="Drill name" placeholder="Drill name"
        className="w-full min-h-11 rounded-xl border border-slate-300 px-3 text-sm mb-2" />
      <button onClick={toggle} disabled={busy || (!dr.active && !label.trim())} aria-pressed={dr.active}
        className={`w-full min-h-12 rounded-xl font-bold text-sm ${dr.active ? "bg-blush text-brand-900" : "bg-brand-600 text-white"}`}>
        {dr.active ? "End drill & save metrics" : "Start drill"}
      </button>
      {dr.active && (
        <div className="mt-3 rounded-xl bg-accent-100 p-3" aria-live="polite">
          <p className="text-sm font-bold text-accent-700">🧪 {dr.label} — running since {dr.startedAt ? dateTime(dr.startedAt) : ""}</p>
          <p className="text-xs text-accent-700 mt-0.5">{live.length} drill report(s) so far.</p>
        </div>
      )}
      {last && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3" role="status">
          <p className="text-sm font-bold text-emerald-800">Drill saved</p>
          <ul><DrillRow d={last} /></ul>
        </div>
      )}
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-4 mb-1">Past drills</h3>
      {drills.length === 0 ? <p className="text-sm text-slate-500">No drills recorded yet.</p> : <ul>{drills.map((d) => <DrillRow key={d.id} d={d} />)}</ul>}
    </section>
  );
}

function RulesCard() {
  const { escalationMinutes } = useApp();
  return (
    <section className={card}>
      <h2 className={h2}>Priority rules (deterministic — no machine learning)</h2>
      <ol className="text-sm text-slate-700 space-y-2 list-decimal pl-5">
        <li><b>Critical override.</b> Severity 5, or a pupil headcount that differs from today's registry, forces the incident to <b>CRITICAL</b> no matter how the weighted score adds up.</li>
        <li><b>Time escalation.</b> Not acknowledged after {escalationMinutes[0]} min → escalated to <b>{ESCALATION_TIERS[1]}</b> (Time Sensitivity +1). After {escalationMinutes[1]} min → <b>{ESCALATION_TIERS[2]}</b> (+2).</li>
        <li><b>Hazard mode.</b> Location Risk +{HAZARD_LOCATION_BOOST} for ground-floor / low-lying zones while a flood or typhoon advisory is active.</li>
        <li><b>Headcount.</b> Aggregate numbers only (e.g. 27/28). A mismatch also sets Time Sensitivity to 5.</li>
      </ol>
      <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide mt-4 mb-1">Responder speeds used for ETA</h3>
      <ul className="text-sm text-slate-700 grid sm:grid-cols-3 gap-1">
        {TRANSPORT_MODES.map((m: { id: keyof typeof ROUTE_SPEED_FACTOR.flooded; label: string; kmh: number }) => (
          <li key={m.id}>{m.label}: <span className="font-mono">{m.kmh} km/h</span>, flooded ×{ROUTE_SPEED_FACTOR.flooded[m.id]}</li>
        ))}
      </ul>
      <IllustrativeTag text="All thresholds, boosts and speeds are illustrative defaults pending the expert-panel session." />
    </section>
  );
}

export default function SafetyView() {
  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3 grid gap-3 lg:grid-cols-2 items-start">
      <div className="space-y-3"><HazardCard /><RouteControl /></div>
      <div className="space-y-3"><DrillCard /><RulesCard /></div>
    </div>
  );
}
