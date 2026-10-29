import { useMemo, useState } from "react";
import { Archive, Eye, EyeOff, History as HistoryIcon } from "lucide-react";
import { OUTCOME_LABEL, TRANSPORT_MODES, agencyFor } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { catTheme } from "../lib/theme";
import { dateTime, duration, elapsed, escalationLabel, fmtMs, plainOverride } from "../lib/format";
import type { Incident } from "../lib/types";
import { ConfirmModal, Modal } from "./Modal";
import DateRangeBar from "./DateRange";
import {
  inDateRange, initialDateRange, useFilterState, type DateRangeState,
} from "../lib/filters";

const ACTION_LABEL: Record<string, string> = {
  reported: "Reported", headcount: "Headcount", override: "Override", hazard: "Hazard mode", route: "Route", drill_end: "Drill ended",
  merged: "Corroborated", escalated: "Escalated", seen: "Seen", en_route: "En route", on_site: "On site", resolved: "Resolved",
  false_alarm: "False alarm", cancelled: "Cancelled",
};

const OUTCOME_STYLE: Record<string, string> = {
  resolved: "bg-emerald-100 text-emerald-700",
  false_alarm: "bg-slate-200 text-slate-700",
  cancelled: "bg-amber-100 text-amber-800",
  drill: "bg-accent-100 text-accent-700",
};
const outcomeOf = (i: Incident) => (i.outcome ?? "resolved") as keyof typeof OUTCOME_LABEL;

/** Archive confirmation with an optional reason (Principal only — records are never deleted). */
function ArchiveDialog({ title, message, confirmLabel, onConfirm, onClose }: {
  title: string; message: string; confirmLabel: string; onConfirm: (reason?: string) => void; onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <ConfirmModal
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      onClose={onClose}
      onConfirm={() => onConfirm(reason.trim() || undefined)}
    >
      <label className="mt-3 block text-xs font-semibold text-slate-600">
        Reason (optional)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={200}
          placeholder="Why is this record being archived?"
          className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal outline-none focus:border-brand-500"
        />
      </label>
    </ConfirmModal>
  );
}

/** What this role may do with a closed record: archive (Principal), hide (own), or nothing. */
function useHistoryActions() {
  const { user, archiveIncident, archiveResolved, hideIncident, hidden } = useApp();
  const role = user?.role;
  return {
    user,
    hidden: hidden ?? [],
    isPrincipal: role === "principal",
    // The archive is read-only for the roles that may open it.
    canViewArchive: role === "principal" || role === "responder",
    // Responders have no hide and no delete — only Teachers (own reports) and Parents may hide.
    canHide: role === "teacher" || role === "parent",
    canHideThis: (inc: Incident) =>
      (role === "teacher" && inc.reporterId === user?.id) || role === "parent",
    archiveIncident,
    archiveResolved,
    hideIncident,
  };
}

export function IncidentDetails({ inc, onClose, hiddenView = false }: { inc: Incident; onClose: () => void; hiddenView?: boolean }) {
  const { isPrincipal, canHideThis, archiveIncident, hideIncident } = useHistoryActions();
  const [confirm, setConfirm] = useState(false);
  const ct = catTheme(inc.category);
  const outcome = outcomeOf(inc);
  const closedAt = inc.resolvedAt ?? inc.createdAt;

  const rows: [string, string | undefined][] = [
    ["Incident type", `${inc.categoryLabel} — ${inc.subLabel}`],
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
    ["Critical override", inc.overrideReasons.length ? inc.overrideReasons.map((r) => plainOverride(r)).join(" · ") : undefined],
    ["Escalation", inc.escalationLevel > 0 ? escalationLabel(inc) : undefined],
    ["Headcount", inc.headcounts.length ? inc.headcounts.map((h) => `${h.section} ${h.present}/${h.expected}`).join(" · ") : undefined],
    ["Responder ETA", inc.eta ? (inc.eta.blocked ? "Route blocked" : `${inc.eta.minutes} min by ${TRANSPORT_MODES.find((m: { id: string }) => m.id === inc.eta!.mode)?.label ?? inc.eta.mode} (${inc.eta.distanceKm} km)`) : undefined],
    ["Report → on site", inc.metrics?.toOnSiteMs ? fmtMs(inc.metrics.toOnSiteMs) : undefined],
    ["Time to acknowledge", inc.metrics?.toAckMs ? fmtMs(inc.metrics.toAckMs) : undefined],
    ["Taps to report", inc.drill && inc.metrics ? String(inc.metrics.interactions) : undefined],
    ["Archived", inc.archivedAt ? dateTime(inc.archivedAt) : undefined],
  ];

  return (
    <Modal title="Incident details" onClose={onClose} wide>
      <div className="mb-3 flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: ct.bg, border: `1px solid ${ct.border}` }}>
        <span className="text-2xl" aria-hidden>{ct.emoji}</span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-extrabold uppercase tracking-wider" style={{ color: ct.color }}>{inc.categoryLabel}</p>
          <p className="text-base font-bold text-slate-800">{inc.subLabel}{inc.drill ? " · Drill" : ""}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${OUTCOME_STYLE[outcome]}`}>{OUTCOME_LABEL[outcome]}</span>
      </div>

      <dl className="divide-y divide-slate-100 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-3 py-1.5">
            <dt className="w-32 shrink-0 text-slate-500">{k}</dt>
            <dd className="flex-1 break-words font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>

      {inc.log && inc.log.length > 0 && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Timeline</p>
          <ol className="space-y-1.5 border-l-2 border-slate-200 pl-3 text-sm text-slate-700">
            {inc.log.map((l, i) => (
              <li key={i}>
                <span className="font-mono text-xs text-slate-400">{dateTime(l.at)}</span><br />
                <b>{ACTION_LABEL[l.action] ?? l.action}</b> — {l.by}{l.note ? <span className="text-slate-500"> ({l.note})</span> : null}
              </li>
            ))}
          </ol>
        </div>
      )}

      {hiddenView ? (
        <button onClick={() => { void hideIncident(inc.id, false); onClose(); }}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">
          <Eye size={16} /> Unhide — show it in my list again
        </button>
      ) : (
        <>
          {isPrincipal && !inc.archivedAt && (
            <button onClick={() => setConfirm(true)}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">
              <Archive size={16} /> Archive this record
            </button>
          )}
          {!isPrincipal && canHideThis(inc) && (
            <button onClick={() => { void hideIncident(inc.id, true); onClose(); }}
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">
              <EyeOff size={16} /> Remove from my list
            </button>
          )}
        </>
      )}

      {confirm && (
        <ArchiveDialog
          title="Archive this record?"
          message="The ticket leaves the live lists but stays readable under History > View archive and keeps its audit trail. Active tickets cannot be archived."
          confirmLabel="Archive"
          onClose={() => setConfirm(false)}
          onConfirm={(reason) => { void archiveIncident(inc.id, reason); onClose(); }}
        />
      )}
    </Modal>
  );
}

export default function HistorySection({ title = "Incident history", onOpenArchive }: { title?: string; onOpenArchive?: () => void }) {
  const { incidents, now } = useApp();
  const { hidden, isPrincipal, canViewArchive, canHide, canHideThis, archiveIncident, archiveResolved, hideIncident } = useHistoryActions();
  const [open, setOpen] = useState<string | null>(null);
  const [archiveOne, setArchiveOne] = useState<Incident | null>(null);
  const [archiveAll, setArchiveAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  // Period chips + custom From/To over the records, kept for the session.
  const [range, setRange] = useFilterState<DateRangeState>("history-range", initialDateRange);

  const records = useMemo(
    () => incidents.filter((i) => i.status === "RESOLVED").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    [incidents],
  );
  const hiddenRecords = useMemo(
    () => hidden.filter((i) => i.status === "RESOLVED").sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)),
    [hidden],
  );
  const closed = useMemo(
    () => records.filter((i) => inDateRange(i.resolvedAt ?? i.createdAt, range, now)),
    [records, range, now],
  );
  const list = showHidden ? hiddenRecords : closed;
  const selected = list.find((i) => i.id === open) ?? null;

  return (
    <section aria-label={title}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          <HistoryIcon size={14} /> {title} <span className="font-mono normal-case text-slate-400">
            ({closed.length === records.length ? closed.length : `${closed.length} of ${records.length}`})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          {canHide && hiddenRecords.length > 0 && (
            <button onClick={() => setShowHidden((v) => !v)} aria-pressed={showHidden}
              className={`min-h-12 rounded-lg px-3 text-xs font-bold ${showHidden ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"}`}>
              Hidden ({hiddenRecords.length})
            </button>
          )}
          {canViewArchive && onOpenArchive && (
            <button onClick={onOpenArchive} className="min-h-12 rounded-lg bg-brand-600 px-3 text-xs font-bold text-white">
              View archive
            </button>
          )}
          {isPrincipal && closed.length > 0 && (
            <button onClick={() => setArchiveAll(true)} className="min-h-12 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700">
              Archive all resolved
            </button>
          )}
        </div>
      </div>

      {records.length > 0 && !showHidden && (
        <div className="mb-2">
          <DateRangeBar value={range} onChange={setRange} ariaLabel="History date range" />
        </div>
      )}

      {list.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center">
          <p className="text-sm text-slate-500">
            {showHidden
              ? "Nothing hidden."
              : records.length === 0 ? "No closed incidents yet." : "No records in that date range."}
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {list.map((i) => {
            const outcome = outcomeOf(i);
            const hideable = !showHidden && !isPrincipal && canHide && canHideThis(i);
            return (
              <li key={i.id} className="flex items-stretch">
                <button onClick={() => setOpen(i.id)} className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left hover:bg-slate-50"
                  aria-label={`View details: ${i.subLabel}, ${i.room}`}>
                  <span className="text-xl" aria-hidden>{catTheme(i.category).emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">{i.subLabel}{i.drill ? " · Drill" : ""}</span>
                    <span className="block truncate text-xs text-slate-500">{i.room}</span>
                    <span className="block text-xs text-slate-400">{i.resolvedAt ? `${elapsed(i.resolvedAt, now)} · ${dateTime(i.resolvedAt)}` : ""}</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${OUTCOME_STYLE[outcome]}`}>{OUTCOME_LABEL[outcome]}</span>
                </button>
                {showHidden ? (
                  <button onClick={() => void hideIncident(i.id, false)} aria-label={`Unhide ${i.subLabel}`}
                    className="flex w-12 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <Eye size={18} />
                  </button>
                ) : isPrincipal ? (
                  <button onClick={() => setArchiveOne(i)} aria-label={`Archive ${i.subLabel}`}
                    className="flex w-12 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <Archive size={18} />
                  </button>
                ) : hideable ? (
                  <button onClick={() => void hideIncident(i.id, true)} aria-label={`Hide ${i.subLabel} from my list`}
                    className="flex w-12 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                    <EyeOff size={18} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {selected && <IncidentDetails inc={selected} hiddenView={showHidden} onClose={() => setOpen(null)} />}
      {archiveOne && (
        <ArchiveDialog
          title="Archive this record?"
          message={`${archiveOne.subLabel} · ${archiveOne.room}. The record leaves the live lists but stays readable under History > View archive. Active tickets cannot be archived.`}
          confirmLabel="Archive"
          onClose={() => setArchiveOne(null)}
          onConfirm={(reason) => void archiveIncident(archiveOne.id, reason)}
        />
      )}
      {archiveAll && (
        <ArchiveDialog
          title="Archive all resolved?"
          message="Every currently closed ticket (resolved, cancelled or drill) is archived at once. Active tickets are not touched and nothing is deleted."
          confirmLabel="Archive all resolved"
          onClose={() => setArchiveAll(false)}
          onConfirm={(reason) => void archiveResolved(reason)}
        />
      )}
    </section>
  );
}