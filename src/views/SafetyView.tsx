import { useState } from "react";
import { FlaskConical, ShieldAlert } from "lucide-react";
import { HAZARD_KINDS } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { dateTime } from "../lib/format";
import { InfoButton } from "../components/Modal";
import { Select } from "../components/Select";
import { PageFlow } from "../components/PageShell";

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

function DrillCard() {
  const { modes, setDrill, incidents } = useApp();
  const [label, setLabel] = useState("Quarterly earthquake drill");
  const [busy, setBusy] = useState(false);
  const dr = modes.drill;
  const live = incidents.filter((i) => (i.drill && i.status !== "RESOLVED") || (i.drill && i.outcome === "drill" && dr.active));
  async function toggle() {
    setBusy(true);
    try { await setDrill(!dr.active, label); } finally { setBusy(false); }
  }
  return (
    <section className={card}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <h2 className={h2}><FlaskConical size={14} /> Drill mode</h2>
        <InfoButton title="Drill mode">
          <p>Runs a school drill on the live workflow. Reports are marked as drill, parents are not alarmed, and response times and taps per report are recorded for the drill report.</p>
          <p>Every finished drill is kept, read-only, under More → Incidents &amp; Records → Drill Records.</p>
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
      <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
        Past drill records are kept read-only under More → Incidents &amp; Records → Drill Records.
      </p>
    </section>
  );
}

export default function SafetyView() {
  return (
    <PageFlow className="grid items-start gap-3 lg:grid-cols-2">
      <HazardCard />
      <DrillCard />
    </PageFlow>
  );
}
