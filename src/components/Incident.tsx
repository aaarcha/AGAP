import { useEffect, useState, useMemo } from "react";
import { useMediaQuery } from "../lib/hooks";

import { Check, CheckCircle2, ChevronDown, Clock, Eye, Navigation, Siren } from "lucide-react";
import { STATUS_LABEL, STATUS_ORDER, agencyFor, bandFor, orgLabel } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { BAND_STYLE, catTheme } from "../lib/theme";
import { canSeeReportedFrom, clockTime, elapsed, escalationLabel, locationSetByLabel, plainOverride, prettyRoom, splitLocation } from "../lib/format";
import { LocationLine } from "./Location";
import type { Incident, OrgResponse, ResponderOrg, Status } from "../lib/types";
import { ConfirmModal } from "./Modal";
import { AckModal, EtaLine, HeadcountPanel, ResponseLines, RuleBadges } from "./Rules";

/** The org that reached the furthest stage on a ticket (the overall headline). */
function furthestOrg(inc: Incident): string | null {
  const rows = Object.entries(inc.responses ?? {}).filter(([, r]) => Boolean(r)) as [string, OrgResponse][];
  const pick = (status: string) => rows.find(([, r]) => r.status === status);
  const hit = pick("resolved") ?? pick("on_site") ?? pick("en_route");
  return hit ? hit[1].orgLabel || orgLabel(hit[0]) : null;
}

/** The viewer's own organization track: acknowledge → on site → resolved. */
function OrgStepper({ track }: { track: OrgResponse | null }) {
  const reached = !track ? 0 : track.status === "resolved" ? 2 : track.status === "on_site" ? 1 : 0;
  const steps = ["Acknowledge & En Route", "On Site", "Resolved"];
  return (
    <ol aria-label="Your organization's response" className="flex items-start gap-1">
      {steps.map((label, i) => {
        const state = i < reached ? "done" : i === reached ? (track ? "active" : "upcoming") : "upcoming";
        return (
          <li key={label} data-org-step={label} data-state={state} className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center" aria-hidden>
              <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : i <= reached && track ? "bg-emerald-500" : "border-t-2 border-dashed border-slate-300"}`} />
              <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                state === "done" ? "bg-emerald-600 text-white" : state === "active" ? "bg-brand-600 text-white ring-4 ring-brand-100" : "border-2 border-dashed border-slate-300 bg-white text-slate-400"
              }`}>{state === "done" ? <Check size={13} strokeWidth={3} /> : i + 1}</span>
              <span className={`h-0.5 flex-1 ${i === steps.length - 1 ? "bg-transparent" : i < reached ? "bg-emerald-500" : "border-t-2 border-dashed border-slate-300"}`} />
            </div>
            <span className={`mt-1 w-full text-center text-[10px] uppercase tracking-wide ${
              state === "done" ? "font-bold text-emerald-700" : state === "active" ? "font-extrabold text-brand-800" : "font-medium text-slate-400"
            }`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** Read-only lines for every other organization on this ticket. */
function OtherResponders({ inc, myOrg }: { inc: Incident; myOrg: ResponderOrg | null }) {
  const { now } = useApp();
  const ids = (["barangay", "cdrrmo"] as ResponderOrg[]).filter((id) => id !== myOrg);
  return (
    <section data-other-responders aria-label="Other responders" className="rounded-xl bg-slate-50 p-2">
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Other responders</p>
      <ul className="mt-1 space-y-1">
        {ids.map((id) => {
          const r = inc.responses?.[id] ?? null;
          let detail: string;
          if (!r) detail = "Not yet responding";
          else if (r.status === "resolved") detail = `Resolved at ${clockTime(r.resolvedAt ?? r.ackAt)}`;
          else if (r.status === "on_site") detail = `On site since ${elapsed(r.onSiteAt ?? r.ackAt, now)}`;
          else if (r.blocked) detail = "En route — route blocked";
          else detail = r.minutes == null ? "En route" : `En route · ETA ~${Math.max(0, Math.ceil(((r.arriveBy ?? now) - now) / 60000))} min`;
          return (
            <li key={id} data-other-org={id} className="flex flex-wrap items-baseline gap-x-2 text-xs text-slate-600">
              <span className="font-bold text-slate-800">{orgLabel(id)}</span>
              <span>{detail}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** "CDRRMO" when an org has acted — the shared status names who is coming. */
const actingOrg = (inc: Pick<Incident, "acknowledgedByOrg" | "acknowledgedBy">) =>
  orgLabel(inc.acknowledgedByOrg) || inc.acknowledgedBy || "Responder";

export function WaitingLine({ inc }: { inc: Pick<Incident, "status" | "outcome" | "acknowledgedByOrg" | "acknowledgedBy"> }) {
  const org = actingOrg(inc);
  const map: Record<Status, { text: string; color: string; Icon: React.ElementType }> = {
    SENT: { text: "Waiting for responders…", color: "#A8304A", Icon: Clock },
    SEEN: { text: "Seen — awaiting dispatch", color: "#425B9A", Icon: Eye },
    EN_ROUTE: { text: `Acknowledged by ${org} — en route`, color: "#B45309", Icon: Navigation },
    ON_SITE: { text: `${org} is on site`, color: "#0F766E", Icon: Siren },
    RESOLVED: { text: inc.outcome === "false_alarm" ? "Cancelled — false alarm" : inc.outcome === "cancelled" ? "Cancelled by the reporter" : "Resolved", color: "#15803D", Icon: CheckCircle2 },
  };
  const m = map[inc.status];
  return (
    <p className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: m.color }}>
      <m.Icon size={15} className="shrink-0" /> {m.text}
    </p>
  );
}

/** When a step happened: the ticket's locked stamp, or the first org to reach it. */
function stepTimestamp(inc: Incident, status: Status): number | null {
  const responses = Object.values(inc.responses ?? {}).filter((r): r is OrgResponse => Boolean(r));
  const earliest = (pick: (r: OrgResponse) => number | null) => {
    const ats = responses.map(pick).filter((v): v is number => typeof v === "number");
    return ats.length ? Math.min(...ats) : null;
  };
  switch (status) {
    case "SENT": return inc.createdAt;
    case "SEEN": return inc.seenAt ?? null;
    case "EN_ROUTE": return inc.enRouteAt ?? earliest((r) => r.ackAt);
    case "ON_SITE": return inc.onSiteAt ?? earliest((r) => r.onSiteAt);
    case "RESOLVED": return inc.resolvedAt ?? earliest((r) => r.resolvedAt);
  }
}

/**
 * Ticket progress, one step at a time:
 *   completed — solid green check and a solid green connector,
 *   current   — a glowing node with its own label and "Current" badge,
 *   upcoming  — muted nodes behind dashed grey connectors.
 */
export function StatusStepper({ inc }: { inc: Incident }) {
  const steps = STATUS_ORDER as Status[];
  const current = Math.max(0, steps.indexOf(inc.status));
  return (
    <ol aria-label="Ticket status" className="flex items-start pt-1">
      {steps.map((status, i) => {
        const state = i < current ? "done" : i === current ? "active" : "upcoming";
        const at = stepTimestamp(inc, status);
        return (
          <li key={status} data-step={status} data-state={state}
            aria-current={state === "active" ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex w-full items-center" aria-hidden>
              <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : i <= current ? "bg-emerald-500" : "border-t-2 border-dashed border-slate-300"}`} />
              {state === "done" ? (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-sm">
                  <Check size={14} strokeWidth={3} />
                </span>
              ) : state === "active" ? (
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 ring-4 ring-brand-100"
                  style={{ boxShadow: "0 0 0 3px rgba(66,91,154,0.18), 0 0 12px rgba(66,91,154,0.45)" }}>
                  <span className="h-2.5 w-2.5 rounded-full bg-white" />
                </span>
              ) : (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                </span>
              )}
              <span className={`h-0.5 flex-1 ${i === steps.length - 1 ? "bg-transparent" : i < current ? "bg-emerald-500" : "border-t-2 border-dashed border-slate-300"}`} />
            </div>
            <span className={`mt-1 w-full break-words hyphens-none text-center text-[10px] uppercase leading-tight tracking-wide ${
              state === "done" ? "font-bold text-emerald-700" : state === "active" ? "font-extrabold text-brand-800" : "font-medium text-slate-400"
            }`}>{STATUS_LABEL[status]}</span>
            {state === "active" && (
              <span data-current-badge className="mt-0.5 rounded-full bg-brand-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">Current</span>
            )}
            {at != null && state !== "upcoming" && (
              <span className="text-[9px] font-mono text-slate-400">{clockTime(at)}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The Principal's school track: Sent → Acknowledged → Closed. */
function PrincipalStepper({ inc }: { inc: Incident }) {
  const closed = inc.status === "RESOLVED";
  // Merely opening the card records Seen; only the Acknowledge action (or a
  // responder moving the ticket on) completes the school track's second step.
  const acknowledged = Boolean(inc.acknowledgedAt || inc.enRouteAt || closed);
  const steps = [
    { label: "Sent", at: inc.createdAt, done: true },
    { label: "Acknowledged", at: inc.acknowledgedAt ?? inc.seenAt ?? null, done: acknowledged },
    { label: "Closed", at: inc.resolvedAt ?? null, done: closed },
  ];
  return (
    <ol aria-label="School track" data-principal-stepper className="flex items-start pt-1">
      {steps.map((s, i) => (
        <li key={s.label} data-step={s.label} data-state={s.done ? "done" : "upcoming"} className="flex min-w-0 flex-1 flex-col items-center">
          <div className="flex w-full items-center" aria-hidden>
            <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : steps[i - 1].done && s.done ? "bg-emerald-500" : "border-t-2 border-dashed border-slate-300"}`} />
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${s.done ? "bg-emerald-600 text-white" : "border-2 border-dashed border-slate-300 bg-white text-slate-400"}`}>
              {s.done ? <Check size={13} strokeWidth={3} /> : i + 1}
            </span>
            <span className={`h-0.5 flex-1 ${i === steps.length - 1 ? "bg-transparent" : s.done ? "bg-emerald-500" : "border-t-2 border-dashed border-slate-300"}`} />
          </div>
          <span className={`mt-1 w-full break-words hyphens-none text-center text-[10px] uppercase leading-tight tracking-wide ${s.done ? "font-bold text-emerald-700" : "font-medium text-slate-400"}`}>{s.label}</span>
          {s.done && s.at != null && <span className="font-mono text-[9px] text-slate-400">{clockTime(s.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

const ACTION_LABEL: Record<string, string> = {
  reported: "Reported", cancelled: "Cancelled", headcount: "Headcount", override: "Override", hazard: "Hazard mode", route: "Route",
  drill_end: "Drill ended", merged: "Corroborated", escalated: "Escalated", seen: "Seen", acknowledged: "Acknowledged",
  en_route: "En route", on_site: "On site", resolved: "Resolved", false_alarm: "False alarm",
};

export function IncidentCard({ inc, showActions, showLog, defaultExpanded = false }: { inc: Incident; showActions?: boolean; showLog?: boolean; defaultExpanded?: boolean }) {
  const { now, modes, act, markSeen, user } = useApp();
  const isResponder = user?.role === "responder";
  const isPrincipal = user?.role === "principal";
  const myOrg = (user?.org ?? null) as ResponderOrg | null;
  const myTrack = myOrg ? inc.responses?.[myOrg] ?? null : null;
  const ct = catTheme(inc.category);
  const closed = inc.status === "RESOLVED";
  const band = bandFor(inc.score, inc.status, inc.overrideReasons);
  const bs = BAND_STYLE[closed ? "RESOLVED" : band];
  const [confirm, setConfirm] = useState<"resolved" | "false_alarm" | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [busy, setBusy] = useState(false);
  const [ackOpen, setAckOpen] = useState(false);

  // The main action is derived from the ticket's live status on every render, so
  // a status pushed in from the server can never leave a stale label behind:
  // SENT/SEEN → Acknowledge & En Route, EN_ROUTE → Mark as On Site,
  // ON_SITE → Mark as Resolved, RESOLVED → no button (a disabled badge instead).
  // A responder's next step comes from their OWN track, never the shared
  // ticket status: the CDRRMO must still acknowledge after the Barangay is on site.
  // The Principal has school-level actions only: Acknowledge (Sent → Seen) and
  // Close with an outcome. En route and On site belong to responder orgs.
  const nextStep: "ack" | "onsite" | "resolve" | null = isResponder
    ? closed || myTrack?.status === "resolved"
      ? null
      : !myTrack ? "ack"
        : myTrack.status === "en_route" ? "onsite"
          : "resolve"
    : isPrincipal
      ? closed
        ? null
        : inc.status === "SENT" || inc.status === "SEEN" ? "ack" : "resolve"
      : closed
        ? null
        : inc.status === "SENT" || inc.status === "SEEN" ? "ack"
          : inc.status === "EN_ROUTE" ? "onsite"
            : inc.status === "ON_SITE" ? "resolve"
              : null;

  // First time a principal/responder sees a "Sent" ticket, tell the server it was seen.
  useEffect(() => { if (showActions && inc.status === "SENT") markSeen(inc.id); }, [showActions, inc.id, inc.status, markSeen]);

  // A step that stops being current must not leave its dialog open (e.g. another
  // responder moves the ticket on while the acknowledge sheet is showing).
  useEffect(() => {
    if (nextStep !== "ack") setAckOpen(false);
    if (nextStep !== "resolve") setConfirm(null);
  }, [nextStep]);

  async function run(action: "ack" | "onsite" | "resolve", outcome?: "resolved" | "false_alarm") {
    setBusy(true);
    try { await act(inc.id, action, outcome ? { outcome } : undefined); } finally { setBusy(false); }
  }
  async function ack(v: { mode?: string; distanceKm?: number }) {
    setBusy(true);
    try { await act(inc.id, "ack", v); } finally { setBusy(false); }
  }

  const place = splitLocation(inc.room);
  const reasons: [string, string][] = [
    ["Incident type", `${inc.categoryLabel} — ${inc.subLabel}`],
    ["Who is affected", `${inc.populationLabel ?? "—"}${inc.linkedSection === "ALL" ? " · whole school" : inc.linkedSection ? ` · ${inc.linkedSection}` : ""}`],
    ["Location", place.area],
    ...(place.from && canSeeReportedFrom(user?.role) ? [["Reported from", prettyRoom(place.from)] as [string, string]] : []),
    ["Location set by", locationSetByLabel(inc)],
    ["Hazard mode", inc.hazardApplied ? "On — flooding/typhoon conditions" : "Off"],
    ["Escalation", escalationLabel(inc)],
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
          <span data-overall-status className="shrink-0 text-right text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {STATUS_LABEL[inc.status]}{furthestOrg(inc) ? ` · ${furthestOrg(inc)}` : ""}
          </span>
        </div>
        {closed && inc.resolvedByOrg ? (
          <p data-resolved-by className="text-xs font-bold text-emerald-700">
            Resolved by {orgLabel(inc.resolvedByOrg)} at {clockTime(inc.resolvedAt ?? inc.createdAt)}
          </p>
        ) : null}
        <p className="text-xs text-slate-500">{inc.reporterName ? `${inc.reporterName} · ` : ""}{elapsed(inc.createdAt, now)} · {clockTime(inc.createdAt)}</p>
        <LocationLine room={inc.room} className="block text-sm text-slate-600" />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Location set by {locationSetByLabel(inc)}</p>
        <p className="text-xs font-semibold" style={{ color: ct.color }}>Recommended: {agencyFor(inc.category)}</p>
        <RuleBadges inc={inc} />
        {isResponder ? (
          <section data-your-response aria-label="Your response" className="rounded-xl border border-brand-100 bg-brand-50/60 p-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-brand-800">
              Your response{myOrg ? ` · ${orgLabel(myOrg)}` : ""}
            </p>
            {myOrg ? <OrgStepper track={myTrack} /> : (
              <p className="mt-1 text-xs font-semibold text-blush-700">Your organization is not assigned. Ask the Principal.</p>
            )}
          </section>
        ) : isPrincipal ? (
          <PrincipalStepper inc={inc} />
        ) : (
          <StatusStepper inc={inc} />
        )}
        <WaitingLine inc={inc} />
        {isResponder && <OtherResponders inc={inc} myOrg={myOrg} />}
        {showActions && <HeadcountPanel inc={inc} />}

        {showActions && nextStep && (isResponder ? Boolean(myOrg) : true) && (
          <div className="space-y-2 pt-1">
            {nextStep === "ack" && (isPrincipal ? (
              <button data-principal-ack disabled={busy} onClick={() => void run("ack")}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand-600 text-sm font-bold text-white disabled:opacity-60">
                <Check size={15} /> Acknowledge
              </button>
            ) : (
              <MobileAckButton disabled={busy} onClick={() => setAckOpen(true)} gradient={ct.gradient} />
            ))}
            {nextStep === "onsite" && (
              <button disabled={busy} onClick={() => void run("onsite")}
                className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-bold text-white disabled:opacity-60">
                <Siren size={15} /> Mark as On Site
              </button>
            )}
            {nextStep === "resolve" && (
              <>
                <button disabled={busy} onClick={() => setConfirm("resolved")}
                  className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold disabled:opacity-60"
                  style={{ border: `2px solid ${ct.border}`, color: ct.color }}>
                  <CheckCircle2 size={15} /> {isPrincipal ? "Close — resolved" : "Mark as Resolved"}
                </button>
                <button disabled={busy} onClick={() => setConfirm("false_alarm")} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white text-sm font-bold text-slate-600 disabled:opacity-60">
                  {isPrincipal ? "Close — false alarm" : "Cancel — false alarm"}
                </button>
              </>
            )}
          </div>
        )}

        {showActions && closed && (
          <p role="status" data-resolved-badge
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 text-sm font-bold text-emerald-700">
            <CheckCircle2 size={15} /> Incident resolved
          </p>
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
            <ResponseLines inc={inc} />
            {/* Read-only here for every role: only responders change the route. */}
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
