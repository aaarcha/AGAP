import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, CalendarClock, ChevronDown, FileClock, Flame, GraduationCap, HeartPulse, RotateCcw,
  ShieldAlert, ShieldCheck, Siren, Users, Waves,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { api } from "../lib/api";
import { dateTime, fmtMs, locationLabel } from "../lib/format";
import { catTheme } from "../lib/theme";
import { useApp } from "../lib/store";
import { PageFlow } from "../components/PageShell";
import { ConfirmModal, Modal } from "../components/Modal";
import RecordsExplorer, { RecordDetail } from "../components/RecordsExplorer";
import {
  OUTCOME_LABEL, normalizeRecordsPayload, readRecordsDeepLink,
  type DrillRecord, type RecordItem, type RecordsPayload,
} from "../lib/records";
import type { AccountRecord } from "../lib/types";

type RecordsTab = "real" | "drills" | "archives";
type ArchiveSection = "tickets" | "accounts";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
};

const accountName = (a: AccountRecord) => (a.status === "purged" ? "Deleted account" : a.name || "Deleted account");

/** One icon per hazard category, matching the report tiles. */
const CAT_ICON: Record<string, LucideIcon> = {
  fire: Flame,
  medical: HeartPulse,
  flood: Waves,
  security: ShieldAlert,
  other: Siren,
};

const btnSecondary = "flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700 disabled:opacity-50";
const rowAction = "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40";

/** Equal-width tab with an icon, a short label and its count — nothing truncates. */
function TabButton({ id, label, icon: Icon, count, active, onSelect }: {
  id: RecordsTab;
  label: string;
  icon: LucideIcon;
  count: number;
  active: boolean;
  onSelect: (id: RecordsTab) => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={`records-tab-${id}`}
      aria-selected={active}
      aria-controls={`records-panel-${id}`}
      onClick={() => onSelect(id)}
      className={`flex min-h-12 min-w-0 flex-1 items-center justify-center gap-1.5 px-1 text-xs font-bold sm:px-3 sm:text-sm ${
        active ? "bg-brand-600 text-white" : "bg-white text-brand-700 hover:bg-brand-50"
      }`}
    >
      <Icon size={15} className="shrink-0" aria-hidden />
      <span className="min-w-0 break-words hyphens-none">{label}</span>
      <span className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[11px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{count}</span>
    </button>
  );
}

function DrillBadge() {
  return <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-black tracking-wide text-accent-700">DRILL</span>;
}

/** One past drill: header, then a grid of equal metric tiles (only real data). */
function DrillCard({ drill }: { drill: DrillRecord }) {
  const metrics = [
    { label: "Avg to report", value: drill.avgToReportMs },
    { label: "Avg to acknowledge", value: drill.avgToAckMs },
    { label: "Avg to on-site", value: drill.avgToOnSiteMs ?? drill.avgOnToSiteMs ?? null },
    { label: "Avg to headcount", value: drill.avgToHeadcountMs },
    { label: "Avg taps", value: drill.avgInteractions },
  ]
    .filter((m) => m.value !== null && m.value !== undefined)
    .map((m) => ({
      label: m.label,
      // Taps are a count; every other metric is a duration.
      value: m.label === "Avg taps" ? String(m.value) : fmtMs(m.value as number | null),
    }));
  const noTickets = drill.incidents === 0 || metrics.length === 0;

  return (
    <article data-drill-card className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
            <DrillBadge />
            <span className="min-w-0 break-words hyphens-none">{drill.label}</span>
          </p>
          <p className="mt-1 break-words text-xs text-slate-500">
            {dateTime(drill.startedAt)} → {dateTime(drill.endedAt)}
          </p>
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          <span data-drill-scope className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {drill.scope === "simulation" ? "Includes responders" : "School only"}
          </span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Completed</span>
        </span>
      </div>

      {noTickets ? (
        <p data-drill-no-tickets className="mt-3 rounded-xl bg-slate-50 px-3 py-3 text-xs leading-relaxed text-slate-500">
          No reports were filed in this drill.
        </p>
      ) : (
        <dl className="mt-3 grid auto-rows-fr grid-cols-2 gap-2 md:grid-cols-3">
          {metrics.map((m) => (
            <div
              key={m.label}
              data-drill-metric
              className="flex min-h-[72px] min-w-0 flex-col justify-center rounded-xl bg-slate-50 px-3 py-2"
            >
              <dt className="break-words hyphens-none text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-500">{m.label}</dt>
              <dd className="mt-1 break-words font-mono text-sm font-black tabular-nums text-slate-800">{m.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {drill.rows.length > 0 && (
        <details data-drill-tickets className="group mt-3 rounded-xl border border-slate-200">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-bold text-brand-700 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 break-words">Per-ticket metrics ({drill.rows.length})</span>
            <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-slate-100 px-3 pb-2 text-xs text-slate-600">
            {drill.rows.map((row) => (
              <li key={row.id} className="min-w-0 py-2">
                <p className="break-words hyphens-none font-semibold text-slate-700">{row.subLabel}</p>
                <p className="mt-0.5 break-words font-mono text-[11px] leading-snug text-slate-500">
                  report {fmtMs(row.toReportMs)} · ack {fmtMs(row.toAckMs)} · on site {fmtMs(row.toOnSiteMs)} · {row.interactions} taps
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function DrillRecordsTab({ drills }: { drills: RecordsPayload["drills"] }) {
  const { ongoing, scheduled, past } = drills;
  return (
    <div className="space-y-3">
      {ongoing ? (
        <section aria-label="Ongoing drill" className="flex flex-wrap items-center gap-2 rounded-2xl border border-accent-200 bg-accent-50 px-4 py-3">
          <DrillBadge />
          <p className="min-w-0 flex-1 break-words text-sm font-bold text-slate-800">{ongoing.label}</p>
          <p className="break-words text-xs text-slate-600">Started {dateTime(ongoing.startedAt)}</p>
          <span data-drill-scope className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600">
            {ongoing.scope === "simulation" ? "Includes responders" : "School only"}
          </span>
          <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-bold text-accent-700">In progress</span>
        </section>
      ) : (
        <p data-drill-empty className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
          No drill in progress.
        </p>
      )}

      {scheduled.length === 0 ? (
        <p data-drill-empty className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
          No drills scheduled. Drill mode is started from Safety when one begins.
        </p>
      ) : (
        <ul aria-label="Scheduled drills" className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {scheduled.map((d) => (
            <li key={d.id} className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-3">
              <CalendarClock size={15} className="shrink-0 text-slate-400" aria-hidden />
              <DrillBadge />
              <span className="min-w-0 flex-1 break-words hyphens-none text-sm font-bold text-slate-800">{d.label}</span>
              <span className="shrink-0 text-xs text-slate-500">{dateTime(d.scheduledAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <section aria-label="Past drill records" className="space-y-2">
        <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          <FileClock size={14} aria-hidden /> Past drill logs
        </h3>
        {past.length === 0 ? (
          <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">No completed drills yet.</p>
        ) : (
          <div className="space-y-3">
            {past.map((d) => <DrillCard key={d.id} drill={d} />)}
          </div>
        )}
      </section>
    </div>
  );
}

/** Muted retention wording — never a chip, never a colour alone. */
function retentionText(record: RecordItem): string {
  if (record.anonymized) return "Anonymised";
  if (record.purgeEligible) return "Retention elapsed";
  return "In retention";
}

function ArchiveTicketRow({
  record,
  canRestore,
  busy,
  onOpen,
  onRestore,
}: {
  record: RecordItem;
  canRestore: boolean;
  busy: boolean;
  onOpen: () => void;
  onRestore: (record: RecordItem) => void;
}) {
  const ct = catTheme(record.category);
  const Icon = CAT_ICON[record.category] ?? Siren;
  return (
    <li data-archive-row className="flex min-w-0 items-start gap-2 px-3 py-3">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 min-w-0 flex-1 items-start gap-3 rounded-xl text-left"
        aria-label={`View archived record: ${record.subLabel}, ${record.zone.label}`}
      >
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: ct.bg, color: ct.color }}
        >
          <Icon size={17} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words hyphens-none text-sm font-bold text-slate-800">{record.subLabel}</span>
          <span className="block break-words hyphens-none text-xs text-slate-500">{locationLabel(record.room)}</span>
          <span className="mt-0.5 block break-words text-[11px] leading-snug text-slate-400">
            Archived {record.archivedAt ? dateTime(record.archivedAt) : "—"}
            {record.archivedAuto ? " · retention sweep" : ""} · {retentionText(record)} · reported by {record.reporterRole}
          </span>
          <span className="mt-1 block text-[11px] font-semibold text-slate-400">Read-only</span>
        </span>
      </button>
      {canRestore && (
        <button
          type="button"
          onClick={() => onRestore(record)}
          disabled={busy}
          aria-label={`Restore record: ${record.subLabel}`}
          title="Restore to Real Incidents"
          className={rowAction}
        >
          <RotateCcw size={17} aria-hidden />
          <span className="hidden sm:inline">Restore</span>
        </button>
      )}
    </li>
  );
}

function SystemArchivesTab({
  archives,
  showAccounts,
  canRestore,
  busy,
  section,
  onSection,
  onOpen,
  onRestore,
}: {
  archives: RecordsPayload["archives"];
  showAccounts: boolean;
  canRestore: boolean;
  busy: boolean;
  section: ArchiveSection;
  onSection: (s: ArchiveSection) => void;
  onOpen: (record: RecordItem) => void;
  onRestore: (record: RecordItem) => void;
}) {
  const { incidents, accounts } = archives;
  // Underlined sub-tabs: "Tickets 1 | Accounts 0".
  const subTab = (id: ArchiveSection, label: string, count: number) => (
    <button
      key={id}
      type="button"
      role="tab"
      aria-selected={section === id}
      onClick={() => onSection(id)}
      className={`-mb-px min-h-11 min-w-0 flex-1 border-b-2 px-2 text-xs font-bold sm:text-sm ${
        section === id
          ? "border-brand-600 text-brand-800"
          : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
      }`}
    >
      <span className="break-words hyphens-none">{label}</span>{" "}
      <span className={`font-mono text-[11px] ${section === id ? "text-brand-700" : "text-slate-400"}`}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      <div
        role="tablist"
        aria-label="Archive sections"
        className="flex items-stretch gap-1 border-b border-slate-200"
      >
        {subTab("tickets", "Tickets", incidents.length)}
        {showAccounts && subTab("accounts", "Accounts", accounts.length)}
      </div>

      {section === "tickets" ? (
        <section aria-label="Archived tickets">
          {incidents.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center">
              <Archive size={24} className="mx-auto text-slate-300" aria-hidden />
              <p className="mt-2 text-sm text-slate-500">No archived records yet.</p>
              <p className="mt-1 text-xs text-slate-400">Closed tickets move here once the Principal archives them or the retention sweep runs.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {incidents.map((r) => (
                <ArchiveTicketRow
                  key={r.id}
                  record={r}
                  canRestore={canRestore}
                  busy={busy}
                  onOpen={() => onOpen(r)}
                  onRestore={onRestore}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section aria-label="Archived accounts">
          {!showAccounts ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
              Archived account records are shown only where the role is allowed to manage them.
            </p>
          ) : accounts.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">No archived accounts.</p>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Archived accounts">
              {accounts.map((a) => (
                <li key={a.id} className="flex min-w-0 flex-wrap items-start gap-3 px-3 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                    <Users size={17} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words hyphens-none text-sm font-bold text-slate-800">{accountName(a)}</span>
                    <span className="block break-words text-xs text-slate-500">{ROLE_LABEL[a.role] ?? a.role}</span>
                    <span className="mt-0.5 block break-words text-[11px] leading-snug text-slate-400">
                      Archived {a.archivedAt ? dateTime(a.archivedAt) : "—"}
                      {a.archivedAuto ? " · retention sweep" : ""}
                      {a.purgeEligible ? " · Purge eligible" : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {a.status === "purged" && (
                      <span className="text-[11px] font-semibold text-slate-400">Purged</span>
                    )}
                    <span className="rounded-xl bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">Manage in Users</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Restoring or purging an account happens in Users → the account's actions.</p>
        </section>
      )}
    </div>
  );
}

/** Typed confirmation for the irreversible purge of one archived record. */
function PurgeRecordDialog({ record, onConfirm, onClose }: {
  record: RecordItem;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = confirm === "PURGE" && reason.trim().length > 0;
  async function go() {
    setBusy(true);
    setErr("");
    try { await onConfirm(reason.trim()); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Purge failed."); setBusy(false); }
  }
  return (
    <Modal title="Purge archived record" onClose={onClose}>
      <p className="text-sm leading-relaxed text-slate-600">
        {record.subLabel} — {record.zone.label}. Names, notes and the timeline are erased for good; the anonymous
        statistics of the ticket stay. This cannot be undone.
      </p>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Reason
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Retention period passed…"
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500" />
      </label>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Type PURGE to confirm
        <input value={confirm} maxLength={20} onChange={(e) => setConfirm(e.target.value)} placeholder="PURGE"
          className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500" autoComplete="off" />
      </label>
      {err && <p className="mt-2 text-sm text-blush-700" role="alert">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="min-h-12 flex-1 rounded-xl bg-slate-100 text-sm font-bold text-slate-700">Cancel</button>
        <button onClick={() => void go()} disabled={!ready || busy}
          className="min-h-12 flex-1 rounded-xl bg-blush-100 text-sm font-bold text-blush-700 disabled:opacity-60">
          {busy ? "Purging…" : "Purge"}
        </button>
      </div>
    </Modal>
  );
}

export default function IncidentsRecords({ showAccounts = false }: { showAccounts?: boolean }) {
  const { user } = useApp();
  // The official record is read-only for everyone; the archive verbs and the
  // retention-gated purge belong to the Principal.
  const canArchive = user?.role === "principal";
  const canPurge = user?.role === "principal";

  const [tab, setTab] = useState<RecordsTab>("real");
  const [archiveSection, setArchiveSection] = useState<ArchiveSection>("tickets");
  const [data, setData] = useState<RecordsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<RecordItem | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<RecordItem | null>(null);
  const [confirmArchiveAll, setConfirmArchiveAll] = useState(false);

  // The record set opens on the school year by default; an Analytics deep link
  // carries its active period so the same window is browsed here.
  const deep = useMemo(() => readRecordsDeepLink(typeof window === "undefined" ? "" : window.location.hash), []);
  const query = useMemo(() => {
    const params = new URLSearchParams({ period: deep.period ?? "sy" });
    if (deep.period === "custom") {
      if (deep.from) params.set("from", deep.from);
      if (deep.to) params.set("to", deep.to);
    }
    return params.toString();
  }, [deep]);
  const reload = useCallback(
    () => api<Partial<RecordsPayload>>("GET", `/api/records?${query}`).then((r) => normalizeRecordsPayload(r)),
    [query],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void reload()
      .then((r) => { if (live) setData(r); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load incident records."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [reload]);

  /** Run one archive verb, then reload so every tab agrees with the server. */
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await action();
      setNotice(message);
      setData(await reload());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That action failed.");
    } finally {
      setBusy(false);
    }
  }

  const archiveAll = () => run(async () => {
    const r = await api<{ count: number }>("POST", "/api/incidents/archive-resolved", {});
    return `Archived ${r.count} resolved record${r.count === 1 ? "" : "s"}.`;
  });

  const archiveOne = (record: RecordItem) => run(async () => {
    await api("POST", `/api/incidents/${record.id}/archive`, {});
    return `Archived “${record.subLabel}”.`;
  });

  const restore = (record: RecordItem) => run(async () => {
    await api("POST", `/api/incidents/${record.id}/restore`, {});
    return `Restored “${record.subLabel}” to Real Incidents.`;
  });

  const purge = (record: RecordItem, reason: string) => run(async () => {
    await api("POST", "/api/admin/incidents/purge", { ids: [record.id], reason, confirm: "PURGE" });
    return `Purged “${record.subLabel}”.`;
  });

  const incidents = data?.incidents ?? [];
  // Archived tickets belong to System Archives only.
  const real = useMemo(() => incidents.filter((r) => !r.archivedAt), [incidents]);
  const drills = data?.drills ?? { ongoing: null, scheduled: [], past: [] };
  const archives = data?.archives ?? { incidents: [], accounts: [] };
  const drillCount = drills.past.length + drills.scheduled.length + (drills.ongoing ? 1 : 0);
  const archiveCount = archives.incidents.length + (showAccounts ? archives.accounts.length : 0);

  const tabs = useMemo(
    () => [
      { id: "real" as const, label: "Incidents", icon: Siren, count: real.length },
      { id: "drills" as const, label: "Drills", icon: Activity, count: drillCount },
      { id: "archives" as const, label: "Archive", icon: Archive, count: archiveCount },
    ],
    [real.length, drillCount, archiveCount],
  );

  return (
    <PageFlow className="space-y-3">
      {/* The back bar already carries the page title; here is only the school
          year the record covers. */}
      <div className="flex items-center justify-end gap-2">
        {data && (
          <span data-sy-chip className="rounded-full bg-white px-3 py-1 text-[11px] font-bold text-slate-600 shadow-sm" aria-live="polite">
            {data.period.label}
          </span>
        )}
      </div>

      <div role="tablist" aria-label="Incident records sections" className="grid w-full grid-cols-3 overflow-hidden rounded-xl border border-brand-200">
        {tabs.map((t) => (
          <TabButton key={t.id} id={t.id} label={t.label} icon={t.icon} count={t.count} active={tab === t.id} onSelect={setTab} />
        ))}
      </div>

      {error && <div role="alert" className="rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{notice}</div>}
      {loading && !data && <p className="py-8 text-center text-sm text-slate-500">Loading records…</p>}

      <div id={`records-panel-${tab}`} role="tabpanel" aria-labelledby={`records-tab-${tab}`} className="space-y-3">
        {tab === "real" && canArchive && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {real.length === 0 ? "Every resolved record is archived." : `${real.length} resolved record${real.length === 1 ? "" : "s"} in the live record.`}
            </p>
            <button type="button" onClick={() => setConfirmArchiveAll(true)} disabled={busy || real.length === 0} className={btnSecondary}>
              <Archive size={15} aria-hidden /> Archive all resolved
            </button>
          </div>
        )}

        {tab === "real" && <RecordsExplorer records={real} onArchive={canArchive ? archiveOne : undefined} />}
        {tab === "drills" && <DrillRecordsTab drills={drills} />}
        {tab === "archives" && (
          <SystemArchivesTab
            archives={archives}
            showAccounts={showAccounts}
            canRestore={canArchive}
            busy={busy}
            section={showAccounts ? archiveSection : "tickets"}
            onSection={setArchiveSection}
            onOpen={setOpen}
            onRestore={restore}
          />
        )}
      </div>

      <p className="flex items-start gap-1.5 text-[11px] leading-snug text-slate-400">
        <GraduationCap size={13} className="mt-0.5 shrink-0" aria-hidden />
        <span>{OUTCOME_LABEL.resolved} and archived records are kept for the school's official record.</span>
      </p>

      {open && (
        <RecordDetail
          record={open}
          onClose={() => setOpen(null)}
          purge={canPurge && open.archivedAt
            ? { eligible: Boolean(open.purgeEligible), onPurge: () => { setPurgeTarget(open); setOpen(null); } }
            : undefined}
        />
      )}
      {purgeTarget && (
        <PurgeRecordDialog
          record={purgeTarget}
          onConfirm={(reason) => purge(purgeTarget, reason)}
          onClose={() => setPurgeTarget(null)}
        />
      )}
      {confirmArchiveAll && (
        <ConfirmModal
          title="Archive all resolved records?"
          message="Every resolved emergency report moves to System Archives. Active and ongoing incidents stay exactly where they are, and nothing is deleted."
          confirmLabel="Archive all"
          onConfirm={() => void archiveAll()}
          onClose={() => setConfirmArchiveAll(false)}
        />
      )}
    </PageFlow>
  );
}
