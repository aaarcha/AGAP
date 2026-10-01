import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Eye, Navigation, PhoneCall, Siren, ChevronDown } from "lucide-react";
import { DISCLAIMERS, ESCALATION_MATRIX, STATUS_LABEL, STATUS_ORDER, agencyFor, bandFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { clockTime, elapsed } from "../lib/format";
import type { Incident, Status } from "../lib/types";
import { ConfirmModal, Modal } from "./Modal";

export function ScoreReadout({ inc }: { inc: Incident }) {
  const band = bandFor(inc.score, inc.status);
  const st = BAND_STYLE[inc.status === "RESOLVED" ? "RESOLVED" : band];
  return (
    <div className="flex items-center gap-2">
      <div className="rounded-lg px-2.5 py-1 text-center shrink-0" style={{ background: st.bg, border: `1px solid ${st.color}55` }}>
        <p className="font-mono text-lg font-extrabold leading-none" style={{ color: st.color }}>{inc.score.toFixed(2)}</p>
        <p className="text-[11px] font-bold tracking-wide mt-0.5" style={{ color: st.color }}>{band}</p>
      </div>
      {inc.severity !== undefined && (
        <div className="font-mono text-xs text-slate-500 leading-tight">
          <p>S{inc.severity} · V{inc.vulnerability} · L{inc.locationRisk} · T{inc.timeSensitivity}</p>
          <p className="text-slate-400">0.50/0.29/0.11/0.10</p>
        </div>
      )}
    </div>
  );
}

export function ResponseTracker({ status, category, compact }: { status: Status; category?: string; compact?: boolean }) {
  const idx = STATUS_ORDER.indexOf(status);
  const color = status === "RESOLVED" ? "#16A34A" : category ? catTheme(category).pill : "#DC2626";
  const size = compact ? 20 : 24;
  return (
    <ol className="flex items-start w-full" aria-label="Response progress">
      {STATUS_ORDER.map((s, i) => {
        const done = i < idx || (i === idx && status === "RESOLVED");
        const active = i === idx && status !== "RESOLVED";
        return (
          <li key={s} className="flex-1 flex flex-col items-center relative" aria-current={active ? "step" : undefined}>
            {i > 0 && <span className="absolute top-[10px] right-1/2 w-full h-[2px]" style={{ background: i <= idx ? color : "#E2E8F0", top: size / 2 - 1 }} />}
            <span className="relative rounded-full flex items-center justify-center font-bold text-xs"
              style={{ width: size, height: size, background: done || active ? color : "#E2E8F0", color: done || active ? "white" : "#94A3B8" }}>
              {done ? <CheckCircle2 size={compact ? 13 : 15} /> : i + 1}
            </span>
            <span className="text-[11px] mt-1 font-semibold text-center leading-tight" style={{ color: done || active ? "#0F172A" : "#94A3B8" }}>
              {STATUS_LABEL[s as Status]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function WaitingLine({ inc }: { inc: Pick<Incident, "status" | "outcome"> }) {
  const map: Record<Status, { text: string; color: string; Icon: React.ElementType }> = {
    SENT: { text: "Waiting for response from Barangay Sinalhan / CDRRMO…", color: "#B91C1C", Icon: Clock },
    SEEN: { text: "Seen by school / responders — awaiting dispatch", color: "#C2410C", Icon: Eye },
    EN_ROUTE: { text: "Responder acknowledged — en route", color: "#B45309", Icon: Navigation },
    ON_SITE: { text: "Responder is on site", color: "#0F766E", Icon: Siren },
    RESOLVED: { text: inc.outcome === "false_alarm" ? "Cancelled — false alarm" : inc.outcome === "cancelled" ? "Cancelled by the reporter" : "Marked resolved", color: "#15803D", Icon: CheckCircle2 },
  };
  const m = map[inc.status];
  return (
    <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: m.color }}>
      <m.Icon size={15} className="shrink-0" /> {m.text}
    </p>
  );
}

const ACTION_LABEL: Record<string, string> = {
  reported: "Reported", cancelled: "Cancelled", merged: "Corroborated", escalated: "Escalated", seen: "Seen", en_route: "En route",
  on_site: "On site", resolved: "Resolved", false_alarm: "False alarm",
};

export function IncidentCard({ inc, showActions, showLog }: { inc: Incident; showActions?: boolean; showLog?: boolean }) {
  const { now, act, markSeen } = useApp();
  const ct = catTheme(inc.category);
  const closed = inc.status === "RESOLVED";
  const [confirm, setConfirm] = useState<"resolved" | "false_alarm" | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // First time a principal/responder sees a "Sent" ticket, tell the server it was seen.
  useEffect(() => { if (showActions && inc.status === "SENT") markSeen(inc.id); }, [showActions, inc.id, inc.status, markSeen]);

  async function run(action: "ack" | "onsite" | "resolve", outcome?: "resolved" | "false_alarm") {
    setBusy(true);
    try { await act(inc.id, action, outcome ? { outcome } : undefined); } finally { setBusy(false); }
  }

  const btn = "flex-1 min-w-[9rem] min-h-11 rounded-xl px-3 text-sm font-bold disabled:opacity-60";
  return (
    <article className="bg-white rounded-2xl overflow-hidden" style={{ border: `1.5px solid ${ct.border}`, boxShadow: `0 1px 6px ${ct.color}18` }}>
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: ct.bg, borderBottom: `1px solid ${ct.border}` }}>
        <span aria-hidden>{ct.emoji}</span>
        <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: ct.color }}>{inc.categoryLabel}</span>
        {inc.confirmedBy > 1 && (
          <span className="ml-auto text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ background: ct.pill }}>✔ Confirmed by {inc.confirmedBy} reports</span>
        )}
        {closed && <span className={`${inc.confirmedBy > 1 ? "" : "ml-auto"} text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700`}>{inc.outcome === "false_alarm" ? "FALSE ALARM" : inc.outcome === "cancelled" ? "CANCELLED" : "RESOLVED"}</span>}
      </div>

      <div className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-800">{inc.subLabel}</h3>
            <p className="text-xs text-slate-500">{inc.reporterName ? `${inc.reporterName} · ` : ""}{elapsed(inc.createdAt, now)} · {clockTime(inc.createdAt)}</p>
          </div>
          <ScoreReadout inc={inc} />
        </div>
        <p className="text-sm text-slate-600">📍 {inc.room}</p>
        {inc.populationLabel && <p className="text-xs text-slate-500">Affected: {inc.populationLabel}{inc.linkedSection !== "ALL" ? ` · ${inc.linkedSection}` : " · whole school"}</p>}
        <ResponseTracker status={inc.status} category={inc.category} compact />
        <WaitingLine inc={inc} />
        <p className="text-xs font-semibold" style={{ color: ct.color }}>↗ Recommended agency: {agencyFor(inc.category)}</p>

        {showActions && !closed && (
          <div className="flex flex-wrap gap-2 pt-1">
            {(inc.status === "SENT" || inc.status === "SEEN") && (
              <button disabled={busy} onClick={() => run("ack")} className={`${btn} text-white`} style={{ background: ct.gradient }}>🔴 Acknowledge &amp; En Route</button>
            )}
            {inc.status !== "ON_SITE" && (
              <button disabled={busy} onClick={() => run("onsite")} className={`${btn} bg-teal-700 text-white`}>Mark On-Site</button>
            )}
            <button disabled={busy} onClick={() => setConfirm("resolved")} className={btn} style={{ background: ct.bg, color: ct.color, border: `1px solid ${ct.border}` }}>✓ Mark Resolved</button>
            <button disabled={busy} onClick={() => setConfirm("false_alarm")} className={`${btn} bg-slate-100 text-slate-700`}>Cancel — False Alarm</button>
          </div>
        )}

        {showLog && inc.log && inc.log.length > 0 && (
          <div>
            <button onClick={() => setLogOpen((v) => !v)} aria-expanded={logOpen} className="flex items-center gap-1 text-xs font-bold text-slate-500 py-1">
              <ChevronDown size={14} className={logOpen ? "rotate-180" : ""} /> Activity log ({inc.log.length})
            </button>
            {logOpen && (
              <ul className="text-xs text-slate-600 space-y-1 border-l-2 border-slate-200 pl-3">
                {inc.log.map((l, i) => (
                  <li key={i}><span className="font-mono text-slate-400">{clockTime(l.at)}</span> <b>{ACTION_LABEL[l.action] ?? l.action}</b> — {l.by}{l.note ? ` (${l.note})` : ""}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm === "resolved" ? "Mark as resolved?" : "Cancel as false alarm?"}
          message={confirm === "resolved"
            ? "This closes the ticket for everyone and shows “All clear” to the affected parents."
            : "Use this only if there was no real emergency. The ticket closes and parents see it was cancelled."}
          confirmLabel={confirm === "resolved" ? "Mark Resolved" : "Cancel Alert"}
          danger={confirm === "false_alarm"}
          onClose={() => setConfirm(null)}
          onConfirm={() => run("resolve", confirm)}
        />
      )}
    </article>
  );
}

export function EscalationTable() {
  return (
    <section className="rounded-2xl overflow-hidden border border-slate-200 bg-white">
      <div className="bg-slate-800 px-3 py-2.5">
        <h2 className="text-xs font-extrabold text-white uppercase tracking-wider">🚨 Incident-to-Agency Escalation Matrix</h2>
        <p className="text-xs text-slate-300 mt-0.5">Hotlines are for manual use by school DRRM officers / Barangay Sinalhan staff.</p>
      </div>
      {ESCALATION_MATRIX.map((row) => {
        const ct = catTheme(row.category);
        return (
          <div key={row.category} className="border-b border-slate-100 last:border-0">
            <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: ct.bg, borderLeft: `4px solid ${ct.pill}` }}>
              <span aria-hidden>{ct.emoji}</span>
              <span className="text-xs font-extrabold uppercase tracking-wide" style={{ color: ct.color }}>{row.label}</span>
            </div>
            <div className="px-3 py-2" style={{ borderLeft: `4px solid ${ct.border}` }}>
              <p className="text-sm font-bold text-slate-700">{row.agency}</p>
              <div className="flex flex-wrap gap-1.5 my-1.5">
                {row.hotlines.map((h) => (
                  <a key={h.number} href={`tel:${h.number.replace(/[^0-9+]/g, "")}`}
                    className="flex items-center gap-1 text-sm font-bold px-3 min-h-9 rounded-full text-white" style={{ background: ct.pill }}>
                    <PhoneCall size={13} /> {h.number}{h.note ? ` (${h.note})` : ""}{!h.verified && <span title="Not yet verified" className="text-yellow-200">⚠</span>}
                  </a>
                ))}
              </div>
              <p className="text-xs italic text-slate-500">{row.action}</p>
            </div>
          </div>
        );
      })}
      <div className="bg-slate-50 border-t border-slate-200 px-3 py-2 space-y-1">
        <p className="text-xs text-slate-500">{DISCLAIMERS.noAgencyLink}</p>
        <p className="text-xs text-amber-700">⚠ Numbers marked with a warning sign are carried over from the original prototype and have not been verified against an official directory. Confirm with Barangay Sinalhan / CDRRMO before relying on them.</p>
      </div>
    </section>
  );
}

export function ContactDrrmModal({ onClose }: { onClose: () => void }) {
  const contacts = [
    { label: "National Emergency Hotline", detail: "Police · Fire · Medical", number: "911", color: "#DC2626", verified: true },
    { label: "CDRRMO Santa Rosa", detail: "City disaster response dispatch", number: "(049) 534-2291", color: "#0284C7", verified: false },
    { label: "Philippine Red Cross", detail: "Medical and rescue assistance", number: "143", color: "#E11D48", verified: true },
    { label: "Bureau of Fire Protection", detail: "Fire and rescue response", number: "160", color: "#EA580C", verified: false },
  ];
  return (
    <Modal title="Contact School DRRM Desk" onClose={onClose}>
      <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 mb-3">
        <p className="text-sm font-extrabold text-slate-800">Emergency coordination</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
          Use a hotline below for immediate assistance. The school DRRM desk will coordinate with Barangay Sinalhan and the appropriate response agency.
        </p>
      </div>
      <div className="space-y-2">
        {contacts.map((c) => (
          <a key={c.number} href={`tel:${c.number.replace(/[^0-9+]/g, "")}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 border min-h-14"
            style={{ borderColor: `${c.color}55`, background: `${c.color}0D` }}>
            <span className="w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0" style={{ background: c.color }}><PhoneCall size={16} /></span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-bold text-slate-800">{c.label}</span>
              <span className="block text-xs text-slate-500">{c.detail}{!c.verified ? " · ⚠ unverified" : ""}</span>
            </span>
            <span className="font-mono text-sm font-extrabold" style={{ color: c.color }}>{c.number}</span>
          </a>
        ))}
      </div>
      <p className="text-xs text-slate-400 mt-3 leading-relaxed">Tapping a number opens your phone's dialer. AGAP does not place calls automatically.</p>
    </Modal>
  );
}
