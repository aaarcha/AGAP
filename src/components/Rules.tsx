import { useState } from "react";
import { AlertTriangle, Clock, Users } from "lucide-react";
import {
  ESCALATION_TIERS, OVERRIDE_LABEL, ROUTE_STATUSES, TRANSPORT_MODES, computeEta,
} from "../../shared/domain.js";
import { bannerText } from "../../shared/advisories.js";
import { useApp } from "../lib/store";
import { useLang } from "../lib/lang";
import { ApiError } from "../lib/api";
import { fmtMs } from "../lib/format";
import type { Incident } from "../lib/types";
import { Modal } from "./Modal";

const chip = "inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full";

export function RuleBadges({ inc }: { inc: Incident }) {
  const { escalationMinutes } = useApp();
  const items: React.ReactNode[] = [];
  if (inc.drill) items.push(<span key="drill" className={`${chip} bg-accent-100 text-accent-700`}>🧪 DRILL</span>);
  if (inc.overrideReasons.length && inc.status !== "RESOLVED") {
    items.push(
      <span key="ovr" className={`${chip} bg-blush-100 text-blush-700 border border-blush-200`}>
        ⚑ CRITICAL OVERRIDE · {inc.overrideReasons.map((r) => OVERRIDE_LABEL[r as keyof typeof OVERRIDE_LABEL] ?? r).join(" + ")}
      </span>,
    );
  }
  if (inc.escalationLevel > 0) {
    items.push(
      <span key="esc" className={`${chip} bg-brand-100 text-brand-700`} title={`No acknowledgement after ${escalationMinutes[inc.escalationLevel - 1]} min`}>
        ⏫ Escalated → {ESCALATION_TIERS[inc.escalationLevel]}
      </span>,
    );
  }
  if (inc.hazardApplied && inc.status !== "RESOLVED") {
    items.push(<span key="haz" className={`${chip} bg-accent-100 text-accent-700`}>🌧 Hazard mode · Location Risk {inc.baseLocationRisk} → {inc.locationRisk}</span>);
  }
  if (!items.length) return null;
  return <div className="flex flex-wrap gap-1.5">{items}</div>;
}

export function EtaLine({ inc }: { inc: Incident }) {
  const { now } = useApp();
  const e = inc.eta;
  const mode = e ? TRANSPORT_MODES.find((m: { id: string }) => m.id === e.mode) : null;
  if (inc.status === "EN_ROUTE" && e) {
    if (e.blocked) return <p className="text-sm font-semibold text-blush-700">🚧 Approach route blocked — responder rerouting (no ETA)</p>;
    const left = Math.max(0, Math.ceil(((e.arriveBy ?? now) - now) / 60000));
    return (
      <p className="text-sm font-semibold text-accent-700">
        <Clock size={14} className="inline -mt-0.5 mr-1" />
        {left <= 0 ? "Arriving now" : `ETA ~${left} min`} · {mode?.label ?? e.mode} · {e.distanceKm} km · route {e.routeStatus}
      </p>
    );
  }
  const ms = inc.metrics?.toOnSiteMs;
  if ((inc.status === "ON_SITE" || inc.status === "RESOLVED") && ms) {
    return <p className="text-xs font-semibold text-accent-700">⏱ Report → responder on site: {fmtMs(ms)}</p>;
  }
  return null;
}

const ACC_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  partial: "bg-accent-100 text-accent-700",
  verified: "bg-emerald-100 text-emerald-700",
  mismatch: "bg-blush-100 text-blush-700",
};

export function HeadcountPanel({ inc }: { inc: Incident }) {
  const { user, roster, sections, recordHeadcount } = useApp();
  const open = inc.status !== "RESOLVED";
  const acc = inc.accountability;
  const isTeacher = user!.role === "teacher";
  const isPrincipal = user!.role === "principal";
  const eligible = isTeacher
    ? [inc.linkedSection === "ALL" || inc.linkedSection === user!.section ? user!.section! : ""].filter(Boolean)
    : isPrincipal ? (inc.linkedSection === "ALL" ? sections : [inc.linkedSection]) : [];
  const canRecord = open && eligible.length > 0 && !user!.role.startsWith("parent");
  const [section, setSection] = useState(eligible[0] ?? "");
  const [present, setPresent] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const registry = isTeacher ? user!.registry : roster.find((r) => r.section === section)?.registry;
  const mine = inc.headcounts.find((h) => h.section === (section || user!.section));

  if (!canRecord && inc.headcounts.length === 0 && user!.role === "parent") return null;
  if (!canRecord && inc.headcounts.length === 0 && !open) return null;

  async function save() {
    setBusy(true); setErr("");
    try {
      await recordHeadcount(inc.id, { present: Number(present), ...(isPrincipal ? { section } : {}) });
      setPresent("");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save the headcount."); }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border border-brand-100 bg-white p-3 space-y-2" aria-label="Pupil headcount">
      <div className="flex items-center gap-2 flex-wrap">
        <Users size={15} className="text-brand-600" />
        <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">Pupil headcount</p>
        <span className={`${chip} ${ACC_STYLE[acc.status]}`}>
          {acc.status === "pending" ? "Not started" : acc.status === "partial" ? `${acc.reported}/${acc.total} sections reported` : acc.status === "verified" ? "All accounted for" : "MISMATCH"}
        </span>
      </div>
      {inc.headcounts.length > 0 && (
        <ul className="text-sm text-slate-700 space-y-0.5">
          {inc.headcounts.map((h) => (
            <li key={h.section} className={h.present !== h.expected ? "font-bold text-blush-700" : ""}>
              {h.section}: <span className="font-mono">{h.present}/{h.expected}</span> present
              {h.present < h.expected ? ` — ${h.expected - h.present} unaccounted for` : h.present > h.expected ? ` — ${h.present - h.expected} above registry` : " ✓"}
            </li>
          ))}
        </ul>
      )}
      {canRecord && (
        <div className="space-y-2">
          {isPrincipal && eligible.length > 1 && (
            <select value={section} onChange={(e) => setSection(e.target.value)} aria-label="Section" className="w-full min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm">
              {eligible.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          )}
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs font-semibold text-slate-600">
              Pupils present at the assembly area{registry !== undefined ? ` (registry today: ${registry})` : ""}
              <input value={present} onChange={(e) => setPresent(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" placeholder={mine ? String(mine.present) : "e.g. 28"}
                className="w-full mt-1 min-h-11 rounded-xl border border-slate-300 px-3 text-base font-mono font-normal outline-none focus:border-brand-500" />
            </label>
            <button onClick={save} disabled={busy || present === ""} className="min-h-11 px-4 rounded-xl bg-brand-600 text-white text-sm font-bold disabled:opacity-50">
              {busy ? "Saving…" : mine ? "Update" : "Confirm"}
            </button>
          </div>
          {err && <p role="alert" className="text-sm text-blush-700">{err}</p>}
          <p className="text-xs text-slate-500">Counts only — no pupil names or personal data are stored (RA 10173). A count that differs from the registry forces this incident to Critical.</p>
        </div>
      )}
    </div>
  );
}

export function AckModal({ inc, onClose, onConfirm }: { inc: Incident; onClose: () => void; onConfirm: (v: { mode?: string; distanceKm?: number }) => void }) {
  const { modes } = useApp();
  const [mode, setMode] = useState("walking");
  const [km, setKm] = useState("");
  const dist = Number(km);
  const eta = km && dist > 0 ? computeEta({ mode, distanceKm: dist, route: modes.route.status }) : null;
  const valid = dist > 0 && dist <= 50;
  return (
    <Modal title="Acknowledge & dispatch" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">{inc.subLabel} · {inc.room}</p>
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">How is the responder travelling?</legend>
        {TRANSPORT_MODES.map((m: { id: string; label: string; kmh: number }) => (
          <label key={m.id} className={`flex items-center gap-3 rounded-xl border px-3 min-h-12 cursor-pointer ${mode === m.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white"}`}>
            <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
            <span className="flex-1 text-sm font-semibold text-slate-800">{m.label}</span>
            <span className="text-xs text-slate-400 font-mono">~{m.kmh} km/h</span>
          </label>
        ))}
      </fieldset>
      <label className="block text-xs font-semibold text-slate-600 mt-3">Approximate distance to the school (km)
        <input value={km} onChange={(e) => setKm(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))} inputMode="decimal" placeholder="e.g. 1.5"
          className="w-full mt-1 min-h-11 rounded-xl border border-slate-300 px-3 text-base font-mono font-normal outline-none focus:border-brand-500" />
      </label>
      <div className="mt-3 rounded-xl bg-accent-100 text-accent-700 px-3 py-2 text-sm font-semibold min-h-10" aria-live="polite">
        {modes.route.status === "blocked" ? "🚧 Approach route is blocked — no ETA until it is cleared." : eta && !eta.blocked ? `Estimated arrival: ~${eta.minutes} min (route ${modes.route.status})` : "Enter the distance to see the estimated arrival time."}
      </div>
      <p className="text-xs text-slate-500 mt-1.5">Speeds are illustrative averages pending validation. Route status: <b>{modes.route.status}</b>.</p>
      <div className="flex gap-2 mt-4">
        <button onClick={() => { onConfirm({}); onClose(); }} className="flex-1 min-h-12 rounded-xl bg-slate-100 text-slate-700 font-bold text-sm">Skip ETA</button>
        <button disabled={!valid} onClick={() => { onConfirm({ mode, distanceKm: dist }); onClose(); }} className="flex-[2] min-h-12 rounded-xl bg-brand-600 text-white font-bold text-sm disabled:opacity-50">Acknowledge &amp; En Route</button>
      </div>
    </Modal>
  );
}

export function ModeBanners() {
  const { user, modes } = useApp();
  const [lang] = useLang();
  if (!user) return null;
  const parent = user.role === "parent";
  const hz = modes.hazard;
  const rows: React.ReactNode[] = [];
  if (hz.active) {
    rows.push(
      <div key="hz" className="bg-accent-100 text-accent-700 text-sm px-4 py-2 text-center font-semibold" role="status">
        🌧 {parent ? bannerText("hazard", lang, hz.kind) : `Hazard Mode ON (${hz.kind}) — Location Risk raised for ground-floor and low-lying zones.`}{hz.note ? ` ${hz.note}` : ""}
      </div>,
    );
  }
  if (modes.drill.active) {
    rows.push(
      <div key="dr" className="bg-brand-700 text-white text-sm px-4 py-2 text-center font-semibold" role="status">
        🧪 {parent ? bannerText("drill", lang) : `DRILL MODE: ${modes.drill.label} — reports are practice and are recorded as drill metrics.`}
      </div>,
    );
  }
  if (!parent && modes.route.status !== "passable") {
    rows.push(
      <div key="rt" className="bg-blush-100 text-blush-800 text-sm px-4 py-2 text-center font-semibold" role="status">
        🚧 Approach route {modes.route.status.toUpperCase()}{modes.route.note ? ` — ${modes.route.note}` : ""}
      </div>,
    );
  }
  return <>{rows}</>;
}

export function RouteControl() {
  const { modes, setRoute } = useApp();
  const [note, setNote] = useState(modes.route.note ?? "");
  const [busy, setBusy] = useState(false);
  async function pick(status: string) { setBusy(true); try { await setRoute(status, note); } finally { setBusy(false); } }
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-3">
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><AlertTriangle size={14} /> Approach route status</h2>
      <div className="grid grid-cols-3 gap-2">
        {ROUTE_STATUSES.map((r: { id: string; label: string }) => (
          <button key={r.id} disabled={busy} onClick={() => pick(r.id)} aria-pressed={modes.route.status === r.id}
            className={`min-h-11 rounded-xl text-sm font-bold border ${modes.route.status === r.id ? (r.id === "passable" ? "bg-emerald-600 text-white border-emerald-600" : "bg-blush text-brand-900 border-blush") : "bg-white text-slate-600 border-slate-300"}`}>
            {r.label}
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder="Note (e.g. knee-deep water at the bridge)" aria-label="Route note"
        className="w-full mt-2 min-h-10 rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500" />
      <p className="text-xs text-slate-500 mt-1.5">Changing this re-estimates every responder ETA that is still en route.</p>
    </section>
  );
}
