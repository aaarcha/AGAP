import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, Archive, CalendarClock, ClipboardList, FileClock, GraduationCap, RotateCcw, ShieldCheck, Trash2, Users,
} from "lucide-react";
import { api } from "../lib/api";
import { dateTime, fmtMs } from "../lib/format";
import { catTheme } from "../lib/theme";
import { useApp } from "../lib/store";
import { PageFlow } from "../components/PageShell";
import { ConfirmModal, Modal } from "../components/Modal";
import RecordsExplorer, { RecordDetail } from "../components/RecordsExplorer";
import {
  OUTCOME_LABEL, TIER_STYLE, normalizeRecordsPayload,
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
  super_admin: "System Administrator",
};

const accountName = (a: AccountRecord) => (a.status === "purged" ? "Deleted account" : a.name || "Deleted account");

const btnSecondary = "flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-slate-100 px-3 text-xs font-bold text-slate-700 disabled:opacity-50";
const rowAction = "flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40";

function TabButton({ id, label, count, active, onSelect }: { id: RecordsTab; label: string; count: number; active: boolean; onSelect: (id: RecordsTab) => void }) {
  return (
    <button
      type="button"
      role="tab"
      id={`records-tab-${id}`}
      aria-selected={active}
      aria-controls={`records-panel-${id}`}
      onClick={() => onSelect(id)}
      className={`flex min-h-12 flex-1 items-center justify-center gap-1.5 px-3 text-xs font-bold sm:text-sm ${
        active ? "bg-brand-600 text-white" : "bg-white text-brand-700 hover:bg-brand-50"
      }`}
    >
      <span className="truncate">{label}</span>
      <span className={`rounded-full px-1.5 py-0.5 font-mono text-[11px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"}`}>{count}</span>
    </button>
  );
}

function DrillBadge() {
  return <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-black tracking-wide text-accent-700">DRILL</span>;
}

function DrillCard({ drill }: { drill: DrillRecord }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
            <DrillBadge /> <span className="min-w-0 truncate">{drill.label}</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {dateTime(drill.startedAt)} → {dateTime(drill.endedAt)} · {drill.incidents} ticket{drill.incidents === 1 ? "" : "s"}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">Completed</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[
          ["Avg to report", fmtMs(drill.avgToReportMs)],
          ["Avg to acknowledge", fmtMs(drill.avgToAckMs)],
          ["Avg to on-site", fmtMs(drill.avgToOnSiteMs)],
          ["Avg to headcount", fmtMs(drill.avgToHeadcountMs)],
          ["Avg taps", drill.avgInteractions === null ? "—" : String(drill.avgInteractions)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl bg-slate-50 px-2.5 py-2">
            <dd className="font-mono text-sm font-black tabular-nums text-slate-800">{value}</dd>
            <dt className="mt-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</dt>
          </div>
        ))}
      </dl>
      {drill.rows.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-brand-700">Passive metrics per ticket ({drill.rows.length})</summary>
          <ul className="mt-2 divide-y divide-slate-100 text-xs text-slate-600">
            {drill.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate font-semibold text-slate-700">{row.subLabel}</span>
                <span className="font-mono text-[11px] text-slate-500">
                  report {fmtMs(row.toReportMs)} · ack {fmtMs(row.toAckMs)} · on site {fmtMs(row.toOnSiteMs)} · {row.interactions} taps
                </span>
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
      <section aria-label="Ongoing drill">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          <Activity size={14} /> Ongoing
        </h3>
        {ongoing ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-accent-200 bg-accent-50 p-4">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-800">
                <DrillBadge /> <span className="min-w-0 truncate">{ongoing.label}</span>
              </p>
              <p className="mt-1 text-xs text-slate-600">Started {dateTime(ongoing.startedAt)} · reports are recorded as drill data.</p>
            </div>
            <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-bold text-accent-700">In progress</span>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            No drill in progress.
          </div>
        )}
      </section>

      <section aria-label="Scheduled drills">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          <CalendarClock size={14} /> Scheduled
        </h3>
        {scheduled.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
            No drills scheduled. Drill mode is started from Safety when one begins.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
            {scheduled.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-3">
                <DrillBadge />
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{d.label}</span>
                <span className="text-xs text-slate-500">{dateTime(d.scheduledAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Past drill records">
        <h3 className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">
          <FileClock size={14} /> Past drill logs
        </h3>
        {past.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
            No completed drills yet.
          </div>
        ) : (
          <div className="space-y-2">
            {past.map((d) => <DrillCard key={d.id} drill={d} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function ArchiveTicketRow({
  record,
  canRestore,
  canPurge,
  busy,
  onOpen,
  onRestore,
  onPurge,
}: {
  record: RecordItem;
  canRestore: boolean;
  canPurge: boolean;
  busy: boolean;
  onOpen: () => void;
  onRestore: (record: RecordItem) => void;
  onPurge: (record: RecordItem) => void;
}) {
  const ct = catTheme(record.category);
  return (
    <li className="flex min-h-16 items-center gap-1 py-1 pl-1 pr-1">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-50"
        aria-label={`View archived record: ${record.subLabel}, ${record.room}`}
      >
        <span className="text-xl" aria-hidden>{ct.emoji}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-slate-800">{record.subLabel}</span>
          <span className="block truncate text-xs text-slate-500">{record.zone.label}</span>
          <span className="block text-xs text-slate-400">
            Archived {record.archivedAt ? dateTime(record.archivedAt) : "—"}
            {record.archivedAuto ? " (retention sweep)" : ""}
            {record.archiveReason ? ` · ${record.archiveReason}` : ""} · reported by {record.reporterRole}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${TIER_STYLE[record.tier]}`}>{record.tier}</span>
          {record.anonymized ? (
            <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">
              <ShieldCheck size={11} aria-hidden /> Anonymised
            </span>
          ) : (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Read-only</span>
          )}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        {canRestore && (
          <button
            type="button"
            onClick={() => onRestore(record)}
            disabled={busy}
            aria-label={`Restore record: ${record.subLabel}`}
            title="Restore to Real Incidents"
            className={rowAction}
          >
            <RotateCcw size={17} />
            <span className="hidden sm:inline">Restore</span>
          </button>
        )}
        {canPurge && (
          <button
            type="button"
            onClick={() => onPurge(record)}
            disabled={busy || !record.purgeEligible}
            aria-label={`Purge record: ${record.subLabel}`}
            title={record.purgeEligible ? "Permanently delete (purge) this record" : "This record was already purged; its personal data is gone"}
            className={`${rowAction} hover:bg-blush-100 hover:text-blush-700`}
          >
            <Trash2 size={17} />
            <span className="hidden sm:inline">Purge</span>
          </button>
        )}
      </span>
    </li>
  );
}

function AccessBadge({ status }: { status: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">{status}</span>;
}

function SystemArchivesTab({
  archives,
  showAccounts,
  canRestore,
  canPurge,
  busy,
  section,
  onSection,
  onOpen,
  onRestore,
  onPurge,
}: {
  archives: RecordsPayload["archives"];
  showAccounts: boolean;
  canRestore: boolean;
  canPurge: boolean;
  busy: boolean;
  section: ArchiveSection;
  onSection: (s: ArchiveSection) => void;
  onOpen: (record: RecordItem) => void;
  onRestore: (record: RecordItem) => void;
  onPurge: (record: RecordItem) => void;
}) {
  const { incidents, accounts } = archives;
  const subTab = (id: ArchiveSection, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={section === id}
      onClick={() => onSection(id)}
      className={`min-h-10 flex-1 rounded-lg px-3 text-xs font-bold ${
        section === id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      {label} <span className={`ml-1 font-mono ${section === id ? "text-white/80" : "text-slate-400"}`}>{count}</span>
    </button>
  );

  return (
    <div className="space-y-3">
      {/* Two dedicated archives: tickets and accounts, one at a time. */}
      <div role="tablist" aria-label="Archive sections" className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
        {subTab("tickets", "Archived tickets", incidents.length)}
        {showAccounts && subTab("accounts", "Archived accounts", accounts.length)}
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
                  canPurge={canPurge}
                  busy={busy}
                  onOpen={() => onOpen(r)}
                  onRestore={onRestore}
                  onPurge={onPurge}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section aria-label="Archived accounts">
          {!showAccounts ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
              Account archives are visible to the System Administrator only.
            </div>
          ) : accounts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
              No archived accounts.
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-label="Archived accounts">
              {accounts.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-800">{accountName(a)}</span>
                    <span className="block text-xs text-slate-500">{ROLE_LABEL[a.role] ?? a.role}</span>
                    <span className="block text-xs text-slate-400">
                      Archived {a.archivedAt ? dateTime(a.archivedAt) : "—"}
                      {a.archivedAuto ? " · retention sweep" : ""}
                      {a.archiveReason ? ` · ${a.archiveReason}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                    {a.purgeEligible && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">Purge eligible</span>}
                    {a.status === "purged" && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">Purged</span>}
                    <AccessBadge status="Manage in Users" />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-400">Restoring or purging an account happens in Users → the account's actions.</p>
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
  // The official record is read-only for everyone; the archive verbs belong to
  // the Principal, the irreversible purge to the System Administrator.
  const canArchive = user?.role === "principal";
  const canPurge = user?.role === "super_admin";

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

  // The browser always covers the full school-year record set; period
  // selection belongs to the Analytics page.
  const reload = useCallback(
    () => api<Partial<RecordsPayload>>("GET", "/api/records?period=sy").then((r) => normalizeRecordsPayload(r)),
    [],
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
      { id: "real" as const, label: "Real Incidents", short: "Incidents", count: real.length },
      { id: "drills" as const, label: "Drill Records", short: "Drills", count: drillCount },
      { id: "archives" as const, label: "System Archives", short: "Archives", count: archiveCount },
    ],
    [real.length, drillCount, archiveCount],
  );

  return (
    <PageFlow className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-black tracking-tight text-brand-900">
            <ClipboardList size={20} /> Incidents &amp; Records
          </h1>
          <p className="mt-1 text-xs text-slate-500">Official records for the school year: incidents, drills and archives.</p>
          <div data-headline-counts className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-600">
            <span>{real.length} real incident{real.length === 1 ? "" : "s"}</span>
            <span aria-hidden>·</span>
            <span>{drillCount} drill{drillCount === 1 ? "" : "s"}</span>
            <span aria-hidden>·</span>
            <span>{archiveCount} archived</span>
          </div>
        </div>
        {data && (
          <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 shadow-sm" aria-live="polite">
            {data.period.label}
          </span>
        )}
      </div>

      <div role="tablist" aria-label="Incident records sections" className="grid w-full grid-cols-3 overflow-hidden rounded-xl border border-brand-200">
        {tabs.map((t) => (
          <TabButton key={t.id} id={t.id} label={t.label} count={t.count} active={tab === t.id} onSelect={setTab} />
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
              <Archive size={15} /> Archive all resolved
            </button>
          </div>
        )}

        {tab === "real" && (
          <>
            <div className="flex justify-end">
              <a href="#records-analytics" data-analytics-link className="text-xs font-bold text-brand-700 underline underline-offset-2">
                See analytics for this period
              </a>
            </div>
            <RecordsExplorer records={real} onArchive={canArchive ? archiveOne : undefined} />
          </>
        )}
        {tab === "drills" && <DrillRecordsTab drills={drills} />}
        {tab === "archives" && (
          <SystemArchivesTab
            archives={archives}
            showAccounts={showAccounts}
            canRestore={canArchive}
            canPurge={canPurge}
            busy={busy}
            section={showAccounts ? archiveSection : "tickets"}
            onSection={setArchiveSection}
            onOpen={setOpen}
            onRestore={restore}
            onPurge={setPurgeTarget}
          />
        )}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <GraduationCap size={14} /> {OUTCOME_LABEL.resolved} and archived records are kept for the school's official record.
      </p>

      {open && <RecordDetail record={open} onClose={() => setOpen(null)} />}
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
