import { useMemo, useState } from "react";
import { History as HistoryIcon, Trash2 } from "lucide-react";
import { ESCALATION_TIERS, OUTCOME_LABEL, OVERRIDE_LABEL, TRANSPORT_MODES, WEIGHTS, agencyFor, bandFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { dateTime, duration, elapsed, fmtMs } from "../lib/format";
import type { Incident } from "../lib/types";
import { ConfirmModal, Modal } from "./Modal";
import { ResponseTracker } from "./Incident";

const ACTION_LABEL: Record<string, string> = {
  reported: "Reported", headcount: "Headcount", override: "Override", hazard: "Hazard mode", route: "Route", drill_end: "Drill ended", merged: "Corroborated", escalated: "Escalated", seen: "Seen", en_route: "En route",
  on_site: "On site", resolved: "Resolved", false_alarm: "False alarm", cancelled: "Cancelled",
};

const OUTCOME_STYLE: Record<string, string> = {
  resolved: "bg-emerald-100 text-emerald-700",
  false_alarm: "bg-slate-200 text-slate-700",
  cancelled: "bg-amber-100 text-amber-800",
  drill: "bg-accent-100 text-accent-700",
};
const outcomeOf = (i: Incident) => (i.outcome ?? "resolved") as keyof typeof OUTCOME_LABEL;

function useDeleteCopy() {
  const { user } = useApp();
  const permanent = user?.role === "principal";
  return {
    permanent,
    one: permanent
      ? "This permanently deletes the record for everyone (Principal, responders, teacher and parents). It cannot be undone."
      : "This removes it from your history only. The Principal's official record is not affected.",
    all: permanent
      ? "This permanently deletes every closed incident for everyone. Active incidents are not touched. It cannot be undone."
      : "This clears every closed incident from your history only. The Principal's official record is not affected.",
  };
}

export function IncidentDetails({ inc, onClose }: { inc: Incident; onClose: () => void }) {
  const { deleteIncident } = useApp();
  const copy = useDeleteCopy();
  const [confirm, setConfirm] = useState(false);
  const ct = catTheme(inc.category);
  const band = bandFor(inc.score, "SENT", inc.overrideReasons);
  const bs = BAND_STYLE[band];
  const outcome = outcomeOf(inc);
  const closedAt = inc.resolvedAt ?? inc.createdAt;

  const rows: [string, string | undefined][] = [
    ["Outcome", OUTCOME_LABEL[outcome]],
    ["Reported", dateTime(inc.createdAt)],
    ["Closed", dateTime(closedAt)],
    ["Time to close", duration(inc.createdAt, closedAt)],
    ["Location", inc.room],
    ["Affected", `${inc.populationLabel ?? "—"}${inc.linkedSection === "ALL" ? " · whole school" : ` · ${inc.linkedSection}`}`],
    ["Reports received", String(inc.confirmedBy)],
    ["Reported by", inc.reporterName],
    ["Acknowledged by", inc.acknowledgedBy ?? undefined],
    ["Closed by", inc.resolvedBy ?? undefined],
    ["Recommended agency", agencyFor(inc.category)],
    ["Critical override", inc.overrideReasons.length ? inc.overrideReasons.map((r) => OVERRIDE_LABEL[r as keyof typeof OVERRIDE_LABEL] ?? r).join(" + ") : undefined],
    ["Escalation", inc.escalationLevel > 0 ? `Escalated to ${ESCALATION_TIERS[inc.escalationLevel]}` : undefined],
    ["Headcount", inc.headcounts.length ? inc.headcounts.map((h) => `${h.section} ${h.present}/${h.expected}`).join(" · ") : undefined],
    ["Responder ETA", inc.eta ? (inc.eta.blocked ? "Route blocked" : `${inc.eta.minutes} min by ${TRANSPORT_MODES.find((m: { id: string }) => m.id === inc.eta!.mode)?.label ?? inc.eta.mode} (${inc.eta.distanceKm} km)`) : undefined],
    ["Report → on site", inc.metrics?.toOnSiteMs ? fmtMs(inc.metrics.toOnSiteMs) : undefined],
    ["Time to acknowledge", inc.metrics?.toAckMs ? fmtMs(inc.metrics.toAckMs) : undefined],
    ["Time to headcount", inc.metrics?.toHeadcountMs ? fmtMs(inc.metrics.toHeadcountMs) : undefined],
    ["Taps to report", inc.drill && inc.metrics ? String(inc.metrics.interactions) : undefined],
  ];

  return (
    <Modal title="Incident details" onClose={onClose} wide>
      <div className="rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3" style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
        <span className="text-2xl" aria-hidden>{ct.emoji}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: ct.color }}>{inc.categoryLabel}</p>
          <p className="text-base font-bold text-slate-800">{inc.subLabel}{inc.drill ? " · 🧪 DRILL" : ""}</p>
        </div>
        <div className="rounded-lg px-2.5 py-1 text-center shrink-0" style={{ background: bs.bg, border: `1px solid ${bs.color}55` }}>
          <p className="font-mono text-lg font-extrabold leading-none" style={{ color: bs.color }}>{inc.score.toFixed(2)}</p>
          <p className="text-[11px] font-bold tracking-wide mt-0.5" style={{ color: bs.color }}>{band}</p>
        </div>
      </div>

      <dl className="divide-y divide-slate-100 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
            <dd className="flex-1 font-medium text-slate-800 break-words">
              {k === "Outcome" ? <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${OUTCOME_STYLE[outcome]}`}>{v}</span> : v}
            </dd>
          </div>
        ))}
      </dl>

      {inc.severity !== undefined && (
        <div className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-3">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">Score breakdown</p>
          <p className="font-mono text-xs text-slate-700 leading-relaxed">
            {WEIGHTS.severity.toFixed(2)}×Severity {inc.severity} + {WEIGHTS.vulnerability.toFixed(2)}×Vulnerability {inc.vulnerability} + {WEIGHTS.locationRisk.toFixed(2)}×Location {inc.locationRisk} + {WEIGHTS.timeSensitivity.toFixed(2)}×Time {inc.timeSensitivity} = <b>{inc.score.toFixed(2)}</b>
          </p>
        </div>
      )}

      <div className="mt-3"><ResponseTracker status={inc.status} category={inc.category} compact /></div>

      {inc.log && inc.log.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Timeline</p>
          <ol className="text-sm text-slate-700 space-y-1.5 border-l-2 border-slate-200 pl-3">
            {inc.log.map((l, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-slate-400">{dateTime(l.at)}</span><br />
                <b>{ACTION_LABEL[l.action] ?? l.action}</b> — {l.by}{l.note ? <span className="text-slate-500"> ({l.note})</span> : null}
              </li>
            ))}
          </ol>
        </div>
      )}

      <button onClick={() => setConfirm(true)} className="mt-5 w-full min-h-12 rounded-xl bg-blush-100 text-blush-700 font-bold text-sm flex items-center justify-center gap-2">
        <Trash2 size={16} /> {copy.permanent ? "Delete this record permanently" : "Remove from my history"}
      </button>

      {confirm && (
        <ConfirmModal title={copy.permanent ? "Delete permanently?" : "Remove from your history?"} message={copy.one}
          confirmLabel={copy.permanent ? "Delete" : "Remove"} danger onClose={() => setConfirm(false)}
          onConfirm={() => { void deleteIncident(inc.id); onClose(); }} />
      )}
    </Modal>
  );
}

export default function HistorySection({ title = "Incident history" }: { title?: string }) {
  const { incidents, now, deleteIncident, clearHistory } = useApp();
  const copy = useDeleteCopy();
  const [open, setOpen] = useState<string | null>(null);
  const [del, setDel] = useState<Incident | null>(null);
  const [clearAll, setClearAll] = useState(false);

  const closed = useMemo(
    () => incidents.filter((i) => i.status === "RESOLVED").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    [incidents],
  );
  const selected = closed.find((i) => i.id === open) ?? null;

  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
          <HistoryIcon size={14} /> {title} <span className="font-mono normal-case text-slate-400">({closed.length})</span>
        </h2>
        {closed.length > 0 && (
          <button onClick={() => setClearAll(true)} className="min-h-9 px-3 rounded-lg text-xs font-bold text-blush-700 bg-blush-100">Clear history</button>
        )}
      </div>

      {closed.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl text-center py-8 px-4">
          <p className="text-sm text-slate-500">No closed incidents yet. Resolved and cancelled incidents will be kept here.</p>
        </div>
      ) : (
        <ul className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
          {closed.map((i) => {
            const outcome = outcomeOf(i);
            return (
              <li key={i.id} className="flex items-stretch">
                <button onClick={() => setOpen(i.id)} className="flex-1 min-w-0 flex items-center gap-3 px-3 py-3 text-left min-h-16 hover:bg-slate-50" aria-label={`View details: ${i.subLabel}, ${i.room}`}>
                  <span className="text-xl" aria-hidden>{catTheme(i.category).emoji}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold text-slate-800 truncate">{i.subLabel}{i.drill ? " · 🧪 DRILL" : ""}</span>
                    <span className="block text-xs text-slate-500 truncate">{i.room}</span>
                    <span className="block text-xs text-slate-400">{i.resolvedAt ? `${elapsed(i.resolvedAt, now)} · ${dateTime(i.resolvedAt)}` : ""}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${OUTCOME_STYLE[outcome]}`}>{OUTCOME_LABEL[outcome]}</span>
                    <span className="font-mono text-xs text-slate-400">{i.score.toFixed(2)}</span>
                  </span>
                </button>
                <button onClick={() => setDel(i)} aria-label={`Delete ${i.subLabel} from history`} className="w-12 flex items-center justify-center text-slate-400 hover:text-blush-700 hover:bg-blush-100">
                  <Trash2 size={18} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && <IncidentDetails inc={selected} onClose={() => setOpen(null)} />}
      {del && (
        <ConfirmModal title={copy.permanent ? "Delete permanently?" : "Remove from your history?"} message={`${del.subLabel} · ${del.room}. ${copy.one}`}
          confirmLabel={copy.permanent ? "Delete" : "Remove"} danger onClose={() => setDel(null)} onConfirm={() => void deleteIncident(del.id)} />
      )}
      {clearAll && (
        <ConfirmModal title="Clear all history?" message={copy.all} confirmLabel="Clear history" danger onClose={() => setClearAll(false)} onConfirm={() => void clearHistory()} />
      )}
    </section>
  );
}
