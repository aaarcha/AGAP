import { useState } from "react";
import { Clock, Users } from "lucide-react";
import {
  ESCALATION_TIERS, ORG_SUGGESTED_MODES, ROUTE_STATUSES, TRANSPORT_MODES, computeEta, orgLabel,
} from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { ApiError } from "../lib/api";
import { clockTime, fmtMs, plainOverride, startOfToday } from "../lib/format";
import type { Incident, OrgResponse } from "../lib/types";
import { Modal } from "./Modal";
import { Select } from "./Select";

const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold";

// Safety signals only, in plain words — no weights, scores or risk numbers.
export function RuleBadges({ inc }: { inc: Incident }) {
  const items: React.ReactNode[] = [];
  if (inc.drill) items.push(<span key="drill" className={`${chip} bg-accent-100 text-accent-700`}>Drill</span>);
  if (inc.overrideReasons.length && inc.status !== "RESOLVED") {
    items.push(
      <span key="ovr" className={`${chip} border border-blush-200 bg-blush-100 text-blush-700`}>
        Critical · {inc.overrideReasons.map((r) => plainOverride(r)).join(" · ")}
      </span>,
    );
  }
  if (inc.escalationLevel > 0) {
    items.push(<span key="esc" className={`${chip} bg-brand-100 text-brand-700`}>Escalated to {ESCALATION_TIERS[inc.escalationLevel]}</span>);
  }
  if (inc.hazardApplied && inc.status !== "RESOLVED") {
    items.push(<span key="haz" className={`${chip} bg-accent-100 text-accent-700`}>Hazard mode on</span>);
  }
  if (!items.length) return null;
  return <div className="flex flex-wrap gap-1.5">{items}</div>;
}

export function EtaLine({ inc }: { inc: Incident }) {
  const { now } = useApp();
  const e = inc.eta;
  const mode = e ? TRANSPORT_MODES.find((m: { id: string }) => m.id === e.mode) : null;
  if (inc.status === "EN_ROUTE" && e) {
    if (e.blocked) return <p className="text-sm font-semibold text-blush-700">Approach route blocked — responder rerouting</p>;
    const left = Math.max(0, Math.ceil(((e.arriveBy ?? now) - now) / 60000));
    return (
      <p className="text-sm font-semibold text-accent-700">
        <Clock size={14} className="-mt-0.5 mr-1 inline" />
        {left <= 0 ? "Arriving now" : `ETA ~${left} min`} · {mode?.label ?? e.mode} · {e.distanceKm} km · route {e.routeStatus}
      </p>
    );
  }
  const ms = inc.metrics?.toOnSiteMs;
  if ((inc.status === "ON_SITE" || inc.status === "RESOLVED") && ms) {
    return <p className="text-xs font-semibold text-accent-700">Responder on site {fmtMs(ms)} after the report</p>;
  }
  return null;
}

/** Per-org response lines for Details: who is coming, how, and their own ETA. */
export function ResponseLines({ inc }: { inc: Incident }) {
  const { now } = useApp();
  const rows = Object.values(inc.responses ?? {}).filter((r): r is OrgResponse => Boolean(r));
  if (!rows.length) return null;
  return (
    <div data-response-lines className="space-y-1 rounded-xl bg-slate-50 p-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Responding organizations</p>
      {rows.map((r) => {
        const label = r.orgLabel || orgLabel(r.org) || r.org;
        const mode = TRANSPORT_MODES.find((m: { id: string; label: string }) => m.id === r.mode)?.label ?? "";
        let detail: string;
        if (r.status === "on_site") detail = `On site${r.onSiteAt ? ` · ${clockTime(r.onSiteAt)}` : ""}`;
        else if (r.status === "resolved") detail = `Resolved${r.resolvedAt ? ` · ${clockTime(r.resolvedAt)}` : ""}`;
        else if (r.blocked) detail = "En route — route blocked, no ETA";
        else {
          const left = r.minutes == null ? null : Math.max(0, Math.ceil(((r.arriveBy ?? now) - now) / 60000));
          detail = [
            "En route",
            left == null ? null : left <= 0 ? "arriving now" : `ETA ~${left} min`,
            mode || null,
            r.distanceKm != null ? `${r.distanceKm} km` : null,
          ].filter(Boolean).join(" · ");
        }
        return (
          <p key={r.org} data-response-org={r.org} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-600">
            <span className="font-bold text-slate-800">{label}</span>
            <span>{detail}</span>
          </p>
        );
      })}
    </div>
  );
}

const ACC_STYLE: Record<string, string> = {
  pending: "bg-slate-100 text-slate-600",
  partial: "bg-accent-100 text-accent-700",
  verified: "bg-emerald-100 text-emerald-700",
  mismatch: "bg-blush-100 text-blush-700",
  not_required: "bg-slate-100 text-slate-500",
};

// Headcount verification applies only to group-scope reports (classroom / whole school).
export function HeadcountPanel({ inc, onOpenProfile }: { inc: Incident; onOpenProfile?: () => void }) {
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
  // "Registry: N" + a link when today's registry was never set or was set on an earlier day.
  const registryStale =
    user!.registryUpdatedAt == null || user!.registryUpdatedAt < startOfToday(Date.now());

  if (acc.status === "not_required") return null;
  if (!canRecord && inc.headcounts.length === 0 && !open && user!.role !== "parent") return null;

  async function save() {
    setBusy(true); setErr("");
    try {
      await recordHeadcount(inc.id, { present: Number(present), ...(isPrincipal ? { section } : {}) });
      setPresent("");
    } catch (e) { setErr(e instanceof ApiError ? e.message : "Could not save the headcount."); }
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-xl border border-brand-100 bg-white p-3" aria-label="Pupil headcount">
      <div className="flex flex-wrap items-center gap-2">
        <Users size={15} className="text-brand-600" />
        <p className="text-xs font-extrabold uppercase tracking-wide text-brand-700">Pupil headcount</p>
        <span className={`${chip} ${ACC_STYLE[acc.status] ?? ACC_STYLE.pending}`}>
          {acc.status === "pending" ? "Not started" : acc.status === "partial" ? `${acc.reported}/${acc.total} sections reported` : acc.status === "verified" ? "All accounted for" : "MISMATCH"}
        </span>
      </div>
      {isTeacher && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-bold text-slate-700">Registry: {registry ?? "—"}</span>
          {registryStale && onOpenProfile && (
            <button
              type="button"
              onClick={onOpenProfile}
              className="font-bold text-brand-700 underline underline-offset-2"
            >
              Update today's registry
            </button>
          )}
        </div>
      )}
      {inc.headcounts.length > 0 && (
        <ul className="space-y-0.5 text-sm text-slate-700">
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
            <Select value={section} onChange={setSection} ariaLabel="Section"
              options={eligible.map((s) => ({ value: s, label: s }))} />
          )}
          <div className="flex items-end gap-2">
            <label className="flex-1 text-xs font-semibold text-slate-600">
              Pupils present at the assembly area{!isTeacher && registry !== undefined ? ` (registry ${registry})` : ""}
              <input value={present} onChange={(e) => setPresent(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric"
                placeholder={mine ? String(mine.present) : "e.g. 28"}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-base font-normal outline-none focus:border-brand-500" />
            </label>
            <button onClick={() => void save()} disabled={busy || present === ""}
              className="min-h-12 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white disabled:opacity-50">
              {busy ? "Saving…" : mine ? "Update" : "Confirm"}
            </button>
          </div>
          {err && <p role="alert" className="text-sm text-blush-700">{err}</p>}
          <p className="text-xs text-slate-500">Counts only — no pupil names.</p>
        </div>
      )}
    </div>
  );
}

export function AckModal({ inc, onClose, onConfirm }: { inc: Incident; onClose: () => void; onConfirm: (v: { mode?: string; distanceKm?: number }) => void }) {
  const { modes, user } = useApp();
  // Each org has its usual transport; all three stay selectable.
  const suggested: string[] = user?.role === "responder" ? (ORG_SUGGESTED_MODES[user.org ?? "barangay"] ?? []) : [];
  const modesOrdered = [
    ...suggested.map((id) => TRANSPORT_MODES.find((m: { id: string }) => m.id === id)).filter(Boolean),
    ...TRANSPORT_MODES.filter((m: { id: string }) => !suggested.includes(m.id)),
  ] as { id: string; label: string; kmh: number }[];
  const [mode, setMode] = useState(suggested[0] ?? "walking");
  const [km, setKm] = useState("");
  const dist = Number(km);
  const eta = km && dist > 0 ? computeEta({ mode, distanceKm: dist, route: modes.route.status }) : null;
  const valid = dist > 0 && dist <= 50;
  return (
    <Modal title="Acknowledge & dispatch" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">{inc.subLabel} · {inc.room}</p>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-slate-500">How is the responder travelling?</legend>
        {modesOrdered.map((m) => {
          const isSuggested = suggested.includes(m.id);
          return (
            <label key={m.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 ${mode === m.id ? "border-brand-600 bg-brand-50" : "border-slate-200 bg-white"}`}>
              <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} value={m.id} />
              <span className="min-w-0 flex-1 text-sm font-semibold text-slate-800">
                {m.label}
                {isSuggested && <span className="font-normal text-brand-700"> (suggested)</span>}
              </span>
              <span className="font-mono text-xs text-slate-400">~{m.kmh} km/h</span>
            </label>
          );
        })}
      </fieldset>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Approximate distance to the school (km)
        <input value={km} onChange={(e) => setKm(e.target.value.replace(/[^0-9.]/g, "").slice(0, 5))} inputMode="decimal" placeholder="e.g. 1.5"
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 font-mono text-base font-normal outline-none focus:border-brand-500" />
      </label>
      <div className="mt-3 min-h-10 rounded-xl bg-accent-100 px-3 py-2 text-sm font-semibold text-accent-700" aria-live="polite">
        {modes.route.status === "blocked" ? "Approach route is blocked — no ETA until it is cleared." : eta && !eta.blocked ? `Estimated arrival: ~${eta.minutes} min (route ${modes.route.status})` : "Enter the distance to see the estimated arrival time."}
      </div>
      <div className="mt-4 flex gap-2">
        <button onClick={() => { onConfirm({}); onClose(); }} className="min-h-12 flex-1 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">Skip ETA</button>
        <button disabled={!valid} onClick={() => { onConfirm({ mode, distanceKm: dist }); onClose(); }}
          className="min-h-12 flex-[2] rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-50">Acknowledge &amp; En Route</button>
      </div>
    </Modal>
  );
}

// Responder-only: approach route status feeds the ETA estimate.
export function RouteControl() {
  const { modes, setRoute } = useApp();
  const [note, setNote] = useState(modes.route.note ?? "");
  const [busy, setBusy] = useState(false);
  async function pick(status: string) { setBusy(true); try { await setRoute(status, note); } finally { setBusy(false); } }
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Approach route status</h2>
      <div className="grid grid-cols-3 gap-2">
        {ROUTE_STATUSES.map((r: { id: string; label: string }) => (
          <button key={r.id} disabled={busy} onClick={() => void pick(r.id)} aria-pressed={modes.route.status === r.id}
            className={`min-h-12 rounded-xl border text-sm font-bold ${modes.route.status === r.id ? (r.id === "passable" ? "border-emerald-600 bg-emerald-600 text-white" : "border-blush bg-blush text-brand-900") : "border-slate-300 bg-white text-slate-600"}`}>
            {r.label}
          </button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 140))} placeholder="Note (e.g. knee-deep water at the bridge)" aria-label="Route note"
        className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-brand-500" />
    </section>
  );
}
