import { useEffect, useState, useMemo } from "react";
import { useMediaQuery } from "../lib/hooks";

import { CheckCircle2, ChevronDown, Clock, Eye, Navigation, PhoneCall, Siren } from "lucide-react";
import { ESCALATION_MATRIX, STATUS_LABEL, agencyFor, bandFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { clockTime, elapsed, locationSetByLabel, plainOverride } from "../lib/format";
import type { Incident, Status } from "../lib/types";
import { ConfirmModal } from "./Modal";
import { AckModal, EtaLine, HeadcountPanel, RuleBadges } from "./Rules";

export function WaitingLine({ inc }: { inc: Pick<Incident, "status" | "outcome"> }) {
  const map: Record<Status, { text: string; color: string; Icon: React.ElementType }> = {
    SENT: { text: "Waiting for responders…", color: "#A8304A", Icon: Clock },
    SEEN: { text: "Seen — awaiting dispatch", color: "#425B9A", Icon: Eye },
    EN_ROUTE: { text: "Responder acknowledged — en route", color: "#B45309", Icon: Navigation },
    ON_SITE: { text: "Responder is on site", color: "#0F766E", Icon: Siren },
    RESOLVED: { text: inc.outcome === "false_alarm" ? "Cancelled — false alarm" : inc.outcome === "cancelled" ? "Cancelled by the reporter" : "Resolved", color: "#15803D", Icon: CheckCircle2 },
  };
  const m = map[inc.status];
  return (
    <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: m.color }}>
      <m.Icon size={15} className="shrink-0" /> {m.text}
    </p>
  );
}

const ACTION_LABEL: Record<string, string> = {
  reported: "Reported", cancelled: "Cancelled", headcount: "Headcount", override: "Override", hazard: "Hazard mode", route: "Route",
  drill_end: "Drill ended", merged: "Corroborated", escalated: "Escalated", seen: "Seen", en_route: "En route",
  on_site: "On site", resolved: "Resolved", false_alarm: "False alarm",
};

export function IncidentCard({ inc, showActions, showLog }: { inc: Incident; showActions?: boolean; showLog?: boolean }) {
  const { now, modes, act, markSeen } = useApp();
  const ct = catTheme(inc.category);
  const closed = inc.status === "RESOLVED";
  const band = bandFor(inc.score, inc.status, inc.overrideReasons);
  const bs = BAND_STYLE[closed ? "RESOLVED" : band];
  const [confirm, setConfirm] = useState<"resolved" | "false_alarm" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);

  const isMobileAck = useMediaQuery("screen and (max-width: 479px)");

  // First time a principal/responder sees a "Sent" ticket, tell the server it was seen.
  useEffect(() => { if (showActions && inc.status === "SENT") markSeen(inc.id); }, [showActions, inc.id, inc.status, markSeen]);

  async function run(action: "ack" | "onsite" | "resolve", outcome?: "resolved" | "false_alarm") {
    setBusy(true);
    try { await act(inc.id, action, outcome ? { outcome } : undefined); } finally { setBusy(false); }
  }
  async function ack(v: { mode?: string; distanceKm?: number }) {
    setBusy(true);
    try { await act(inc.id, "ack", v); } finally { setBusy(false); }
  }

  const reasons: [string, string][] = [
    ["Incident type", `${inc.categoryLabel} — ${inc.subLabel}`],
    ["Who is affected", `${inc.populationLabel ?? "—"}${inc.linkedSection === "ALL" ? " · whole school" : inc.linkedSection ? ` · ${inc.linkedSection}` : ""}`],
    ["Location", inc.room],
    ["Location set by", locationSetByLabel(inc)],
    ["Hazard mode", inc.hazardApplied ? "On — flooding/typhoon conditions" : "Off"],
    ["Escalation", inc.escalationLevel > 0 ? "Escalated — no acknowledgement in time" : "Not escalated"],
    ["Critical override", inc.overrideReasons.length ? inc.overrideReasons.map(plainOverride).join(" · ") : "None"],
  ];

  return (      <article className="overflow-hidden rounded-2xl bg-white" style={{ border: `1.5px solid ${ct.border}`, boxShadow: `0 1px 6px ${ct.color}18`, transition: "box-shadow 0.2s ease" }}>
      <header className="flex items-center gap-2 px-3 py-2" style={{ background: ct.bg, borderBottom: `1px solid ${ct.border}` }}>
        <span aria-hidden>{ct.emoji}</span>
        <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: ct.color }}>{inc.categoryLabel}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {inc.confirmedBy > 1 && <span className="text-[11px] font-bold text-slate-500">{inc.confirmedBy} reports</span>}
          <span className="rounded-full px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide"
            style={{ background: bs.bg, color: bs.color, border: `1px solid ${bs.color}55` }}>
            {closed ? "Resolved" : band}
          </span>
        </span>
      </header>

      <div className="space-y-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-base font-bold leading-tight text-slate-800">{inc.subLabel}</h3>
          <span className="shrink-0 text-[11px] font-bold uppercase tracking-wide text-slate-500">{STATUS_LABEL[inc.status]}</span>
        </div>
        <p className="text-xs text-slate-500">{inc.reporterName ? `${inc.reporterName} · ` : ""}{elapsed(inc.createdAt, now)} · {clockTime(inc.createdAt)}</p>
        <p className="text-sm text-slate-600">📍 {inc.room}</p>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Location set by {locationSetByLabel(inc)}</p>
        <p className="text-xs font-semibold" style={{ color: ct.color }}>Recommended: {agencyFor(inc.category)}</p>
        <RuleBadges inc={inc} />
        <WaitingLine inc={inc} />
        {showActions && <HeadcountPanel inc={inc} />}

        {showActions && !closed && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            {(inc.status === "SENT" || inc.status === "SEEN") && (
              <MobileAckButton disabled={busy} onClick={() => setAckOpen(true)} gradient={ct.gradient} />
            )}
            {inc.status !== "ON_SITE" && (
              <button disabled={busy} onClick={() => void run("onsite")}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-bold text-white disabled:opacity-60">
                <Siren size={15} /> On-Site
              </button>
            )}
            <button disabled={busy} onClick={() => setConfirm("resolved")}
              className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold disabled:opacity-60"
              style={{ border: `2px solid ${ct.border}`, color: ct.color }}>
              <CheckCircle2 size={15} /> Resolve
            </button>
            <button disabled={busy} onClick={() => setConfirm("false_alarm")} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-600 disabled:opacity-60">
              Cancel — false alarm
            </button>
          </div>
        )}

        <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
          className="flex min-h-12 w-full items-center justify-between border-t border-slate-100 pt-2 text-sm font-bold text-brand-700">
          Details
          <ChevronDown size={16} className={expanded ? "rotate-180" : ""} />
        </button>

        {expanded && (
          <div className="space-y-3">
            <dl className="divide-y divide-slate-100 text-sm">
              {reasons.map(([k, v]) => (
                <div key={k} className="flex gap-3 py-1.5">
                  <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
                  <dd className="flex-1 font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>
            <EtaLine inc={inc} />
            <p className="text-xs text-slate-500">Approach route: <b className="capitalize">{modes.route.status}</b></p>
            {showLog && inc.log && inc.log.length > 0 && (
              <ol className="space-y-1.5 border-l-2 border-slate-200 pl-3 text-xs text-slate-600">
                {inc.log.map((l, i) => (
                  <li key={i}>
                    <span className="font-mono text-slate-400">{clockTime(l.at)}</span>{" "}
                    <b>{ACTION_LABEL[l.action] ?? l.action}</b> — {l.by}{l.note ? ` (${l.note})` : ""}
                  </li>
                ))}
              </ol>
            )}
            {inc.confirmedBy > 1 && !closed && (
              <p className="text-xs text-slate-500">Confirmed by {inc.confirmedBy} reports.</p>
            )}
          </div>
        )}
      </div>

      {ackOpen && <AckModal inc={inc} onClose={() => setAckOpen(false)} onConfirm={ack} />}
      {confirm && (
        <ConfirmModal
          title={confirm === "resolved" ? "Mark as resolved?" : "Cancel as false alarm?"}
          message={confirm === "resolved"
            ? "This closes the ticket for everyone and shows “All clear” to the affected parents."
            : "Use this only if there was no real emergency. The ticket closes and parents see it was cancelled."}
          confirmLabel={confirm === "resolved" ? "Mark Resolved" : "Cancel Alert"}
          danger={confirm === "false_alarm"}
          onClose={() => setConfirm(null)}
          onConfirm={() => void run("resolve", confirm)}
        />
      )}      {ackOpen && <AckModal inc={inc} onClose={() => setAckOpen(false)} onConfirm={ack} />}
      {confirm && (
        <ConfirmModal
          title={confirm === "resolved" ? "Mark as resolved?" : "Cancel as false alarm?"}
          message={confirm === "resolved"
            ? "This closes the ticket for everyone and shows “All clear” to the affected parents."
            : "Use this only if there was no real emergency. The ticket closes and parents see it was cancelled."}
          confirmLabel={confirm === "resolved" ? "Mark Resolved" : "Cancel Alert"}
          danger={confirm === "false_alarm"}
          onClose={() => setConfirm(null)}
          onConfirm={() => void run("resolve", confirm)}
        />
      )}
    </article>
  );
}

function MobileAckButton({ disabled, onClick, gradient }: {
  disabled: boolean;
  onClick: () => void;
  gradient: string;
}) {
  const isMobileAck = useMediaQuery("screen and (max-width: 479px)");
  return (
    <button disabled={disabled} onClick={onClick}
      className={`min-h-10 w-full rounded-xl text-sm font-bold text-white disabled:opacity-60 ${isMobileAck ? "relative" : "flex items-center justify-center gap-2"}`}
      style={{ background: gradient }}>
      {isMobileAck ? (
        <>
          <Navigation size={15} className="absolute left-3 top-1/2 -translate-y-1/2" />
          <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex flex-col items-center leading-tight">Acknowledge
            <br />&amp; En Route</span>
        </>
      ) : (
        <><Navigation size={15} /> Acknowledge &amp; En Route</>
      )}
    </button>
  );
}

// Responder reference — hotlines are dialled by hand, never auto-called.
export function EscalationTable() {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="bg-slate-800 px-3 py-2.5">
        <h2 className="text-xs font-extrabold uppercase tracking-wider text-white">Incident-to-agency escalation</h2>
        <p className="mt-0.5 text-xs text-slate-300">For manual use by school DRRM officers / Barangay Sinalhan staff.</p>
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
              <div className="my-1.5 flex flex-wrap gap-1.5">
                {row.hotlines.map((h) => (
                  <a key={h.number} href={`tel:${h.number.replace(/[^0-9+]/g, "")}`}
                    className="flex min-h-12 items-center gap-1 rounded-full px-3 text-sm font-bold text-white" style={{ background: ct.pill }}>
                    <PhoneCall size={13} /> {h.number}{h.note ? ` (${h.note})` : ""}{!h.verified && <span title="Not yet verified" className="text-yellow-200">⚠</span>}
                  </a>
                ))}
              </div>
              <p className="text-xs italic text-slate-500">{row.action}</p>
            </div>
          </div>
        );
      })}
      <div className="space-y-1 border-t border-slate-200 bg-slate-50 px-3 py-2">
        <p className="text-xs text-slate-500">This system does not connect directly to these agencies — contacting them is a manual step.</p>
        <p className="text-xs text-amber-700">⚠ Numbers with a warning sign are unverified. Confirm them with Barangay Sinalhan / CDRRMO before relying on them.</p>
      </div>
    </section>
  );
}
