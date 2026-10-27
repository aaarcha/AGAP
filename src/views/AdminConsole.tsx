import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  Users, ClipboardList, Calendar, Plus, RefreshCw, Unlock, UserX, UserCheck, Key, Eye, EyeOff, Copy, Check, AlertCircle,
  SlidersHorizontal, Search, X, History, Pencil, RotateCcw, Save,
} from "lucide-react";
import { api } from "../lib/api";
import type { AccountRecord, AuditEntry, ConfigPayload, ConfigVersion, SchoolYear, TempCredential } from "../lib/types";
import { Modal, ConfirmModal } from "../components/Modal";
import { dateTime } from "../lib/format";
import { Header, StatusBanner } from "../components/Chrome";
import { RoleNav } from "../components/RoleNav";
import { ADMIN_TABS, type AdminTab } from "../lib/navigation";
import { MasterDetail } from "../components/MasterDetail";
import { Select } from "../components/Select";
import { FilterBar } from "../components/FilterBar";
import { DatePicker } from "../components/DatePicker";
import DateRangeBar from "../components/DateRange";
import {
  activeFilterCount, activeFilterEntries, clearGroupFilters, facetCounts, filterItems,
  inDateRange, initialDateRange, initialFilterState, isGroupSelected, matchesQuery,
  selectedValues, setCategory, setQuery, setSort, sortItems, toggleGroupValue,
  useFilterState, type DateRangeState, type FilterSpec,
} from "../lib/filters";
import { SECTION_GRADES, gradeCode, gradeLabel, composeSection, parseSection } from "../../shared/section.js";
import { SCHOOL } from "../../shared/domain.js";
import AccountView from "./AccountView";

const card = "rounded-2xl border border-slate-200 bg-white p-4";
const h2 = "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500";
const input = "min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm";
const btn = "flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-sm font-bold";
const btnPrimary = `${btn} bg-brand-600 text-white`;
const btnSecondary = `${btn} bg-slate-100 text-slate-700`;
const btnDanger = `${btn} bg-blush-100 text-blush-700`;

export default function AdminConsole() {
  const [tab, setTab] = useState<AdminTab>("accounts");
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  // Period chips + custom From/To over the audit records, kept for the session.
  const [auditRange, setAuditRange] = useFilterState<DateRangeState>("admin-audit-range", initialDateRange);
  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modals
  const [showProvision, setShowProvision] = useState(false);
  const [provisionResult, setProvisionResult] = useState<TempCredential | null>(null);
  const [resetTarget, setResetTarget] = useState<AccountRecord | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AccountRecord | null>(null);
  const [rolloverConfirm, setRolloverConfirm] = useState(false);
  const [rolloverResult, setRolloverResult] = useState<TempCredential[] | null>(null);

  // Leaving Configuration with unsaved edits asks first (ConfigTab reports its dirty state).
  const [configDirty, setConfigDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState<AdminTab | null>(null);

  function guardedSetTab(next: AdminTab) {
    if (tab === "config" && next !== "config" && configDirty) { setLeaveTo(next); return; }
    setConfigDirty(false);
    setTab(next);
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // Audit records inside the chosen period — the DateRangeBar above the table.
  const auditShown = useMemo(
    () => auditEntries.filter((entry) => inDateRange(entry.at, auditRange, Date.now())),
    [auditEntries, auditRange],
  );

  async function loadData() {
    if (tab === "account") { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      if (tab === "accounts") {
        const r = await api<{ accounts: AccountRecord[] }>("GET", "/api/admin/accounts");
        setAccounts(r.accounts);
      } else if (tab === "audit") {
        const r = await api<{ entries: AuditEntry[] }>("GET", "/api/admin/audit");
        setAuditEntries(r.entries);
      } else if (tab === "schoolyear") {
        const r = await api<SchoolYear>("GET", "/api/admin/school-year");
        setSchoolYear(r);
      } else {
        setLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(acc: AccountRecord) {
    try { await api("POST", `/api/admin/accounts/${acc.id}/unlock`); await loadData(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to unlock"); }
  }
  async function handleActivate(acc: AccountRecord) {
    try { await api("POST", `/api/admin/accounts/${acc.id}/activate`); await loadData(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to activate"); }
  }
  async function handleDeactivate() {
    if (!deactivateTarget) return;
    try { await api("POST", `/api/admin/accounts/${deactivateTarget.id}/deactivate`); setDeactivateTarget(null); await loadData(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to deactivate"); }
  }
  async function handleReset() {
    if (!resetTarget) return;
    try {
      const r = await api<{ tempPassword: string }>("POST", `/api/admin/accounts/${resetTarget.id}/reset-password`);
      setResetResult(r.tempPassword);
      setResetTarget(null);
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to reset"); }
  }
  async function handleRollover() {
    try {
      const r = await api<{ accounts: TempCredential[] }>("POST", "/api/admin/school-year/start");
      setRolloverResult(r.accounts);
      setRolloverConfirm(false);
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to start new school year"); }
  }

  return (
    <div className="flex h-dvh overflow-hidden bg-cream">
      <RoleNav role="super_admin" tab={tab} setTab={guardedSetTab} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header title="Super Admin" subtitle="Accounts, audit and configuration" />
        <StatusBanner />
        <main className="scroll-area min-h-0 flex-1 px-3 py-3 pb-24 lg:pb-6">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {loading && <div className="py-8 text-center text-slate-500">Loading…</div>}

          {tab === "accounts" && !loading && (
            <div className="flex min-h-0 flex-col gap-3 lg:h-full">
              <div className="flex shrink-0 items-center justify-between">
                <h2 className={h2}><Users size={14} /> Accounts ({accounts.length})</h2>
                <button onClick={() => setShowProvision(true)} className={btnPrimary}><Plus size={15} /> Provision</button>
              </div>
              <div className="lg:min-h-0 lg:flex-1">
                <AccountsPane accounts={accounts} onUnlock={handleUnlock} onActivate={handleActivate}
                  onReset={setResetTarget} onDeactivate={setDeactivateTarget} />
              </div>
            </div>
          )}

          {tab === "audit" && !loading && (
            <div className="scroll-area space-y-3 lg:h-full lg:overflow-y-auto">
              <h2 className={h2}><ClipboardList size={14} /> Audit log (read-only)</h2>
              <DateRangeBar value={auditRange} onChange={setAuditRange} ariaLabel="Audit date range" />
              <p className="-mt-1 text-xs font-bold text-slate-600" aria-live="polite">
                Entries {auditShown.length} of {auditEntries.length}
              </p>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {["Time", "Action", "By", "Target", "Detail", "IP"].map((h) => <th key={h} className="px-3 py-2 text-left font-bold text-slate-600">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditShown.map((entry, i) => (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="whitespace-nowrap px-3 py-2 text-slate-500">{dateTime(entry.at)}</td>
                          <td className="px-3 py-2">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">{entry.action}</span>
                          </td>
                          <td className="px-3 py-2 text-slate-600">{entry.by || "—"}</td>
                          <td className="px-3 py-2 text-slate-600">{entry.target || "—"}</td>
                          <td className="max-w-xs truncate px-3 py-2 text-slate-500">{entry.detail || "—"}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-400">{entry.ip || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {auditEntries.length === 0 && <p className="py-8 text-center text-slate-500">No audit entries yet.</p>}
              {auditEntries.length > 0 && auditShown.length === 0 && (
                <p className="py-8 text-center text-slate-500">No entries in that date range.</p>
              )}
            </div>
          )}

          {tab === "schoolyear" && !loading && (
            <div className="scroll-area space-y-3 lg:h-full lg:overflow-y-auto">
              <h2 className={h2}><Calendar size={14} /> School year</h2>
              <div className={card}>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-3xl font-black text-slate-800">Year {schoolYear?.count || 0}</p>
                    {schoolYear?.startedAt && <p className="mt-1 text-sm text-slate-600">Started: {dateTime(schoolYear.startedAt)}</p>}
                    <p className="mt-1 text-xs text-slate-500">{schoolYear?.accounts || 0} total accounts</p>
                  </div>
                  <button onClick={() => setRolloverConfirm(true)} className={btnPrimary}>
                    <RefreshCw size={15} /> Start new year
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === "config" && <ConfigTab onDirtyChange={setConfigDirty} />}
          {tab === "account" && <AccountView />}
        </main>

      </div>

      {showProvision && (
        <ProvisionModal onClose={() => setShowProvision(false)}
          onCreated={(cred) => { setShowProvision(false); setProvisionResult(cred); void loadData(); }} />
      )}
      {provisionResult && <TempCredentialModal title="Account provisioned" credential={provisionResult} onClose={() => setProvisionResult(null)} />}
      {resetTarget && (
        <ConfirmModal title="Reset password" onClose={() => setResetTarget(null)}
          message={`This will generate a new temporary password for ${resetTarget.name} (${resetTarget.email}). All existing sessions will be revoked.`}
          confirmLabel="Reset password" onConfirm={() => void handleReset()} />
      )}
      {resetResult && <PasswordResultModal tempPassword={resetResult} onClose={() => setResetResult(null)} />}
      {deactivateTarget && (
        <ConfirmModal title="Deactivate account" danger onClose={() => setDeactivateTarget(null)}
          message={`This will deactivate ${deactivateTarget.name} (${deactivateTarget.email}). All their sessions will be revoked immediately.`}
          confirmLabel="Deactivate" onConfirm={() => void handleDeactivate()} />
      )}
      {rolloverConfirm && (
        <ConfirmModal title="Start new school year" onClose={() => setRolloverConfirm(false)}
          message="This will revoke all existing sessions for non-admin users and issue temporary credentials. Each user must set a new password on their next sign-in."
          confirmLabel="Start new year" onConfirm={() => void handleRollover()} />
      )}
      {rolloverResult && <RolloverResultModal credentials={rolloverResult} onClose={() => setRolloverResult(null)} />}
      {leaveTo && (
        <ConfirmModal title="Discard unsaved changes?" danger onClose={() => setLeaveTo(null)}
          message="Your configuration edits have not been saved. Leaving this tab discards them."
          confirmLabel="Discard"
          onConfirm={() => { setConfigDirty(false); setTab(leaveTo); setLeaveTo(null); }} />
      )}
    </div>
  );
}

function StatusChips({ acc }: { acc: AccountRecord }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${acc.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{acc.status}</span>
      {acc.mustChange && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">Must change password</span>}
      {acc.temp && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700">Temporary credential</span>}
      {acc.locked && <span className="rounded-full bg-blush-100 px-2 py-0.5 text-xs font-bold text-blush-700">Locked</span>}
    </div>
  );
}

function AccountActions({ acc, onUnlock, onActivate, onReset, onDeactivate }: {
  acc: AccountRecord;
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {acc.locked && <button onClick={() => onUnlock(acc)} className={btnSecondary} title="Unlock account"><Unlock size={15} /> Unlock</button>}
      <button onClick={() => onReset(acc)} className={btnSecondary} title="Reset password"><Key size={15} /> Reset</button>
      {acc.status === "active"
        ? <button onClick={() => onDeactivate(acc)} className={btnDanger} title="Deactivate"><UserX size={15} /> Deactivate</button>
        : <button onClick={() => onActivate(acc)} className={btnSecondary} title="Reactivate"><UserCheck size={15} /> Activate</button>}
    </div>
  );
}

const ROLE_CHIPS: { value: string; label: string }[] = [
  { value: "teacher", label: "Teacher" },
  { value: "parent", label: "Parent" },
  { value: "principal", label: "Principal" },
  { value: "responder", label: "Responder" },
  { value: "super_admin", label: "Admin" },
];

const STATUS_CHIPS: { value: string; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "locked", label: "Locked" },
  { value: "mustchange", label: "Must change" },
  { value: "inactive", label: "Deactivated" },
];

const GRADE_CHIPS: { value: string; label: string }[] = SECTION_GRADES.map((label) => ({
  value: gradeCode(label) ?? "",
  label,
}));

const ORG_OPTIONS = [SCHOOL.name, "Barangay + CDRRMO"];

/** Organization: responders belong to the Barangay/CDRRMO, everyone else to the school. */
const orgOf = (a: AccountRecord) => (a.role === "responder" ? "Barangay + CDRRMO" : SCHOOL.name);

/** Structured grade with a parse fallback for older payloads. */
const gradeOf = (a: AccountRecord) => a.grade || parseSection(a.section ?? "").grade || "";

/** Status buckets an account belongs to (they overlap: active AND must change). */
const statusOf = (a: AccountRecord): string[] => {
  const out: string[] = [];
  if (a.status === "active") out.push("active");
  if (a.locked) out.push("locked");
  if (a.mustChange) out.push("mustchange");
  if (a.status !== "active") out.push("inactive");
  return out;
};

const ACCOUNT_SPEC: FilterSpec<AccountRecord> = {
  search: (a, q) => matchesQuery(q, a.name, a.email, a.section),
  category: (a, c) => a.role === c,
  groups: {
    grade: (a, v) => gradeOf(a) === v,
    section: (a, v) => (a.section ?? "") === v,
    status: (a, v) => statusOf(a).includes(v),
    org: (a, v) => orgOf(a) === v,
  },
};

function AccountDetail({ acc, onUnlock, onActivate, onReset, onDeactivate }: {
  acc: AccountRecord;
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
}) {
  return (
    <div className={card}>
      <p className="text-lg font-black text-slate-900">{acc.name}</p>
      <p className="break-words text-sm text-slate-600">{acc.email}</p>
      <p className="mt-0.5 text-xs text-slate-500">{acc.role}{acc.section ? ` · ${acc.section}` : ""}</p>
      <div className="mt-2"><StatusChips acc={acc} /></div>
      {acc.lastLoginAt && <p className="mt-2 text-xs text-slate-400">Last sign-in: {dateTime(acc.lastLoginAt)}</p>}
      <div className="mt-4"><AccountActions acc={acc} onUnlock={onUnlock} onActivate={onActivate} onReset={onReset} onDeactivate={onDeactivate} /></div>
    </div>
  );
}

function AccountRow({ acc, active }: { acc: AccountRecord; active: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${active ? "border-brand-600 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-brand-300"}`}>
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{acc.name}</p>
        {active && (
          <span className="shrink-0 rounded-full bg-brand-600 px-1.5 py-0.5 text-white" aria-hidden><Check size={11} /></span>
        )}
      </div>
      <p className="truncate text-xs text-slate-500">{acc.role}{acc.section ? ` · ${acc.section}` : ""}</p>
      <p className={`mt-1 text-[11px] font-bold uppercase tracking-wide ${acc.status === "active" ? "text-emerald-700" : "text-slate-400"}`}>{acc.status}</p>
    </div>
  );
}

function AccountsPane({ accounts, onUnlock, onActivate, onReset, onDeactivate }: {
  accounts: AccountRecord[];
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
}) {
  // One state for search, the role row, the sheet groups and the sort menu —
  // kept per screen for the session.
  const [state, setState] = useFilterState("admin-accounts", () => initialFilterState({ sort: "name" }));

  // Sections are known from every account, so an empty section stays selectable.
  const sectionOptions = [...new Set(accounts.map((a) => a.section).filter((s): s is string => Boolean(s)))].sort();

  const facet = (exclude: string, options: string[], valueOf: (a: AccountRecord) => string | string[] | null | undefined) =>
    facetCounts(accounts, state, ACCOUNT_SPEC, { options, valueOf, exclude });
  const roleCounts = facet("category", ROLE_CHIPS.map((r) => r.value), (a) => a.role);
  const gradeCounts = facet("grade", GRADE_CHIPS.map((g) => g.value), gradeOf);
  const statusCounts = facet("status", STATUS_CHIPS.map((s) => s.value), statusOf);
  const sectionCounts = facet("section", sectionOptions, (a) => a.section);
  const orgCounts = facet("org", ORG_OPTIONS, orgOf);
  const countOf = (list: { value: string; count: number }[], value: string) => list.find((c) => c.value === value)?.count ?? 0;

  const shown = sortItems(filterItems(accounts, state, ACCOUNT_SPEC), state.sort, {
    name: (a, b) => a.name.localeCompare(b.name),
    lastLogin: (a, b) => (b.lastLoginAt ?? 0) - (a.lastLoginAt ?? 0),
  });

  const toggle = (group: string, value: string) => setState((s) => toggleGroupValue(s, group, value));
  const groupLabel: Record<string, string> = { grade: "Grade", section: "Section", status: "Status", org: "Organization" };
  const valueLabel = (group: string, value: string) =>
    group === "grade"
      ? gradeLabel(value)
      : group === "status"
        ? STATUS_CHIPS.find((s) => s.value === value)?.label ?? value
        : value;
  const chip = (group: string, value: string, label: string, count?: number) => ({
    value,
    label,
    count,
    disabled: count === 0 && !isGroupSelected(state, group, value),
  });

  const listHeader = (
    <FilterBar
      search={{
        value: state.query,
        onChange: (v) => setState((s) => setQuery(s, v)),
        placeholder: "Search name, email or section",
        ariaLabel: "Search accounts",
      }}
      category={{
        value: state.category,
        ariaLabel: "Role",
        onChange: (v) => setState((s) => setCategory(s, v)),
        options: [
          { value: "all", label: "All", count: accounts.length },
          ...ROLE_CHIPS.map((r) => ({ ...r, count: countOf(roleCounts, r.value) })),
        ],
      }}
      quickChips={[
        { label: "Locked", count: countOf(statusCounts, "locked"), active: isGroupSelected(state, "status", "locked"), onToggle: () => toggle("status", "locked") },
        { label: "Must change password", count: countOf(statusCounts, "mustchange"), active: isGroupSelected(state, "status", "mustchange"), onToggle: () => toggle("status", "mustchange") },
      ]}
      filters={{
        groups: [
          { id: "grade", label: "Grade", options: GRADE_CHIPS.map((g) => chip("grade", g.value, g.label, countOf(gradeCounts, g.value))), selected: selectedValues(state, "grade"), onToggle: toggle },
          { id: "section", label: "Section", options: sectionOptions.map((s) => chip("section", s, s, countOf(sectionCounts, s))), selected: selectedValues(state, "section"), onToggle: toggle },
          { id: "status", label: "Status", options: STATUS_CHIPS.map((s) => chip("status", s.value, s.label, countOf(statusCounts, s.value))), selected: selectedValues(state, "status"), onToggle: toggle },
          { id: "org", label: "Organization", options: ORG_OPTIONS.map((o) => chip("org", o, o, countOf(orgCounts, o))), selected: selectedValues(state, "org"), onToggle: toggle },
        ],
        activeCount: activeFilterCount(state),
        onReset: () => setState((s) => clearGroupFilters(s)),
        shown: shown.length,
        total: accounts.length,
        title: "Filters",
      }}
      sort={{
        value: state.sort,
        ariaLabel: "Sort accounts",
        onChange: (v) => setState((s) => setSort(s, v)),
        options: [
          { value: "name", label: "Name (A–Z)" },
          { value: "lastLogin", label: "Last sign-in (newest)" },
        ],
      }}
      chipRows={
        state.category === "teacher" || state.category === "parent"
          ? [{
              ariaLabel: "Grade",
              options: GRADE_CHIPS.map((g) => ({ ...g, count: countOf(gradeCounts, g.value) })),
              selected: selectedValues(state, "grade"),
              onToggle: (v: string) => toggle("grade", v),
            }]
          : []
      }
      activeChips={activeFilterEntries(state).map((e) => ({
        id: `${e.group}:${e.value}`,
        label: `${groupLabel[e.group] ?? e.group}: ${valueLabel(e.group, e.value)}`,
        onRemove: () => toggle(e.group, e.value),
      }))}
      onClearAll={() => setState((s) => clearGroupFilters(s))}
      results={{ label: "Accounts", shown: shown.length, total: accounts.length }}
    />
  );

  return (
    <MasterDetail
      items={shown}
      ariaLabel="Accounts — select an account"
      listHeader={listHeader}
      emptyList={accounts.length === 0 ? "No accounts yet." : "No accounts match those filters."}
      emptyDetail="Select an account to see its profile and actions."
      renderList={(acc, active) => <AccountRow acc={acc} active={active} />}
      renderDetail={(acc) => (
        <AccountDetail acc={acc} onUnlock={onUnlock} onActivate={onActivate} onReset={onReset} onDeactivate={onDeactivate} />
      )}
    />
  );
}

// ------------------------------------------------------------------ configuration
// Admin > Configuration is the ONLY place weights, the consistency ratio, escalation
// limits and assumed responder speeds appear on the client. They come from the
// Super-Admin endpoint (/api/admin/config) and never ship to other roles.

type ConfigDraft = {
  severity: string; vulnerability: string; locationRisk: string; timeSensitivity: string;
  cr: string; panelValidationDate: string;
  hazardAdjustment: string; barangayMinutes: string; cdrrmoMinutes: string;
  walking: string; motorcycle: string; vehicle: string;
};

type ChangeRow = { label: string; from: string; to: string };

const numOf = (s: string) => (String(s).trim() === "" ? NaN : Number(s));
const oneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
const isDateString = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

function draftFrom(v: ConfigVersion): ConfigDraft {
  return {
    severity: String(v.weights.severity),
    vulnerability: String(v.weights.vulnerability),
    locationRisk: String(v.weights.locationRisk),
    timeSensitivity: String(v.weights.timeSensitivity),
    cr: String(v.consistency.cr),
    panelValidationDate: v.panelValidationDate ?? "",
    hazardAdjustment: String(v.hazardAdjustment),
    barangayMinutes: String(v.escalation.barangayMinutes),
    cdrrmoMinutes: String(v.escalation.cdrrmoMinutes),
    walking: String(v.responderSpeeds.walking),
    motorcycle: String(v.responderSpeeds.motorcycle),
    vehicle: String(v.responderSpeeds.vehicle),
  };
}

function payloadFrom(d: ConfigDraft): ConfigPayload {
  return {
    weights: {
      severity: numOf(d.severity),
      vulnerability: numOf(d.vulnerability),
      locationRisk: numOf(d.locationRisk),
      timeSensitivity: numOf(d.timeSensitivity),
    },
    consistency: { cr: numOf(d.cr) },
    panelValidationDate: d.panelValidationDate,
    hazardAdjustment: numOf(d.hazardAdjustment),
    escalation: { barangayMinutes: numOf(d.barangayMinutes), cdrrmoMinutes: numOf(d.cdrrmoMinutes) },
    responderSpeeds: { walking: numOf(d.walking), motorcycle: numOf(d.motorcycle), vehicle: numOf(d.vehicle) },
  };
}

function payloadOfVersion(v: ConfigVersion): ConfigPayload {
  return {
    weights: { ...v.weights },
    consistency: { cr: v.consistency.cr },
    panelValidationDate: v.panelValidationDate ?? "",
    hazardAdjustment: v.hazardAdjustment,
    escalation: { ...v.escalation },
    responderSpeeds: { ...v.responderSpeeds },
  };
}

const sameDraft = (a: ConfigDraft, b: ConfigDraft) =>
  (Object.keys(a) as (keyof ConfigDraft)[]).every((k) => a[k] === b[k]);

// Mirrors server/config.js so the form tells the admin before anything is sent.
function localErrors(d: ConfigDraft): Record<string, string> {
  const out: Record<string, string> = {};
  const weights: [keyof ConfigDraft, string][] = [
    ["severity", "Severity"], ["vulnerability", "Vulnerability"],
    ["locationRisk", "Location risk"], ["timeSensitivity", "Time sensitivity"],
  ];
  let total = 0;
  let weightsOk = true;
  for (const [key, label] of weights) {
    const n = numOf(d[key]);
    if (!Number.isFinite(n)) { out[`weights.${key}`] = `${label}: enter a number.`; weightsOk = false; continue; }
    if (n < 0 || n > 100) { out[`weights.${key}`] = `${label}: 0–100.`; weightsOk = false; continue; }
    if (!oneDecimal(n)) { out[`weights.${key}`] = `${label}: one decimal place at most.`; weightsOk = false; continue; }
    total += Math.round(n * 1000);
  }
  if (weightsOk && total !== 100000)
    out["weights.sum"] = `The four weights must add up to exactly 100.0 (currently ${(total / 1000).toFixed(1)}).`;

  const cr = numOf(d.cr);
  if (!Number.isFinite(cr) || cr < 0 || cr > 0.1) out["consistency.cr"] = "The consistency ratio must be 0.10 or lower.";
  if (!d.panelValidationDate.trim()) out.panelValidationDate = "Enter the date the Expert Panel validated these values.";
  else if (!isDateString(d.panelValidationDate)) out.panelValidationDate = "Use a valid date.";

  const hz = numOf(d.hazardAdjustment);
  if (!Number.isInteger(hz) || hz < 0 || hz > 4) out.hazardAdjustment = "Use a whole number from 0 to 4.";

  const b = numOf(d.barangayMinutes);
  const c = numOf(d.cdrrmoMinutes);
  if (!Number.isInteger(b) || b < 1 || b > 60) out["escalation.barangayMinutes"] = "1–60 minutes.";
  if (!Number.isInteger(c) || c < 1 || c > 60) out["escalation.cdrrmoMinutes"] = "1–60 minutes.";
  if (Number.isInteger(b) && Number.isInteger(c) && b >= c)
    out["escalation.order"] = "The Barangay limit must be shorter than the CDRRMO limit.";

  for (const [key, label] of [["walking", "Walking"], ["motorcycle", "Motorcycle"], ["vehicle", "Vehicle"]] as [keyof ConfigDraft, string][]) {
    const n = numOf(d[key]);
    if (!Number.isFinite(n) || n < 1 || n > 120) out[`responderSpeeds.${key}`] = `${label}: 1–120 km/h.`;
  }
  return out;
}

function changeRows(from: ConfigVersion, to: ConfigPayload): ChangeRow[] {
  const pct = (v: number) => `${v} %`;
  const when = (s?: string | null) => (s ? s : "not set");
  return [
    { label: "Severity weight", from: pct(from.weights.severity), to: pct(to.weights.severity) },
    { label: "Vulnerability weight", from: pct(from.weights.vulnerability), to: pct(to.weights.vulnerability) },
    { label: "Location risk weight", from: pct(from.weights.locationRisk), to: pct(to.weights.locationRisk) },
    { label: "Time sensitivity weight", from: pct(from.weights.timeSensitivity), to: pct(to.weights.timeSensitivity) },
    { label: "AHP consistency ratio", from: String(from.consistency.cr), to: String(to.consistency.cr) },
    { label: "Expert panel validation", from: when(from.panelValidationDate), to: when(to.panelValidationDate) },
    { label: "Hazard Location Risk adjustment", from: `+${from.hazardAdjustment}`, to: `+${to.hazardAdjustment}` },
    { label: "Barangay escalation limit", from: `${from.escalation.barangayMinutes} min`, to: `${to.escalation.barangayMinutes} min` },
    { label: "CDRRMO escalation limit", from: `${from.escalation.cdrrmoMinutes} min`, to: `${to.escalation.cdrrmoMinutes} min` },
    { label: "Walking speed", from: `${from.responderSpeeds.walking} km/h`, to: `${to.responderSpeeds.walking} km/h` },
    { label: "Motorcycle speed", from: `${from.responderSpeeds.motorcycle} km/h`, to: `${to.responderSpeeds.motorcycle} km/h` },
    { label: "Vehicle speed", from: `${from.responderSpeeds.vehicle} km/h`, to: `${to.responderSpeeds.vehicle} km/h` },
  ];
}

function ConfigField({ label, suffix, error, children }: {
  label: string; suffix?: string; error?: string; children: ReactNode;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-600">
      <span>{label}{suffix ? <span className="font-normal text-slate-400"> ({suffix})</span> : null}</span>
      <span className="mt-1 block">{children}</span>
      {error && <span className="mt-1 block text-xs font-semibold text-blush-700">{error}</span>}
    </label>
  );
}

function ConfigRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <dt className="text-slate-600">{label}</dt>
      <dd className="font-mono font-bold text-slate-800 sm:text-right">{value}</dd>
    </div>
  );
}

// Old → new comparison, password re-entry and the open-ticket warning, in one place.
function ConfigReviewModal({ title, intro, rows, openTickets, confirmLabel, onClose, onConfirm }: {
  title: string; intro: string; rows: ChangeRow[]; openTickets: number; confirmLabel: string;
  onClose: () => void; onConfirm: (password: string, confirmOpen: boolean) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const changed = rows.filter((r) => r.from !== r.to);
  const needsConfirm = openTickets > 0;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await onConfirm(password, confirmOpen);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the configuration.");
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={() => { if (!busy) onClose(); }} wide>
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-slate-600">{intro}</p>

        {changed.length === 0 ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">No values changed.</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Setting</th>
                  <th className="px-3 py-2">Current</th>
                  <th className="px-3 py-2">New</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {changed.map((r) => (
                  <tr key={r.label}>
                    <td className="px-3 py-2 text-slate-600">{r.label}</td>
                    <td className="px-3 py-2 font-mono text-slate-500 line-through">{r.from}</td>
                    <td className="px-3 py-2 font-mono font-bold text-brand-700">{r.to}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {needsConfirm && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-bold">
              ⚠️ {openTickets} real incident{openTickets === 1 ? " is" : "s are"} still open
            </p>
            <p className="mt-1">
              New values apply only to tickets created after saving. Open tickets keep the weights
              they were scored with, so nothing is re-scored.
            </p>
            <label className="mt-2 flex min-h-12 items-center gap-2 font-semibold">
              <input type="checkbox" checked={confirmOpen} onChange={(e) => setConfirmOpen(e.target.checked)}
                className="h-5 w-5 accent-amber-600" />
              I understand and want to continue
            </label>
          </div>
        )}

        <label className="block text-xs font-semibold text-slate-600">
          Your current password
          <span className="relative mt-1 block">
            <input type={show ? "text" : "password"} autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${input} pr-12`} aria-label="Your current password" />
            <button type="button" onClick={() => setShow((v) => !v)}
              aria-label={show ? "Hide password" : "Show password"}
              className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500">
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        </label>

        {error && <p role="alert" className="text-sm font-semibold text-blush-700">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className={`${btnSecondary} flex-1 justify-center`}>Cancel</button>
          <button onClick={() => void submit()}
            disabled={busy || !password || changed.length === 0 || (needsConfirm && !confirmOpen)}
            className={`${btnPrimary} flex-1 justify-center`}>
            {busy ? "Saving…" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConfigTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [openTickets, setOpenTickets] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<ConfigVersion | null>(null);

  const active = versions.find((v) => v.active) ?? versions[0] ?? null;
  const errors = draft ? localErrors(draft) : {};
  const dirty = Boolean(editing && draft && active && !sameDraft(draft, draftFrom(active)));

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await api<{ versions: ConfigVersion[]; openTickets: number }>("GET", "/api/admin/config");
        if (!alive) return;
        setVersions(r.versions);
        setOpenTickets(r.openTickets);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Failed to load configuration");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);

  // Closing the tab or reloading with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function apply(
    r: { active: ConfigVersion; versions: ConfigVersion[]; openTickets: number },
    message: string,
  ) {
    setVersions(r.versions);
    setOpenTickets(r.openTickets);
    setEditing(false);
    setDraft(null);
    setReviewing(false);
    setRestoreTarget(null);
    setError("");
    setNotice(message);
  }

  const set = (patch: Partial<ConfigDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  if (loading) return <div className="py-8 text-center text-slate-500">Loading…</div>;
  if (!active) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">
          {error || "No configuration available."}
        </p>
      </div>
    );
  }

  const bands: [string, string][] = [["Critical", "4.0 and up"], ["High", "3.0 – 3.99"], ["Moderate", "below 3.0"]];

  return (
    <div className="scroll-area mx-auto w-full max-w-3xl space-y-3 lg:h-full lg:overflow-y-auto">
      {error && (
        <p role="alert" className="rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">{error}</p>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <Check size={16} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={() => setNotice("")} aria-label="Dismiss" className="shrink-0 text-emerald-700"><X size={16} /></button>
        </div>
      )}

      {editing && draft ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (Object.keys(errors).length === 0) setReviewing(true); }}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className={h2}><SlidersHorizontal size={14} /> Edit configuration</h2>
            <span className="text-xs text-slate-500">Based on v{active.version}</span>
          </div>

          <section className={card}>
            <h3 className={`${h2} mb-2`}>Urgency weights</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigField label="Severity" suffix="%" error={errors["weights.severity"]}>
                <input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={draft.severity}
                  onChange={(e) => set({ severity: e.target.value })} className={input} aria-label="Severity weight" />
              </ConfigField>
              <ConfigField label="Vulnerability" suffix="%" error={errors["weights.vulnerability"]}>
                <input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={draft.vulnerability}
                  onChange={(e) => set({ vulnerability: e.target.value })} className={input} aria-label="Vulnerability weight" />
              </ConfigField>
              <ConfigField label="Location risk" suffix="%" error={errors["weights.locationRisk"]}>
                <input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={draft.locationRisk}
                  onChange={(e) => set({ locationRisk: e.target.value })} className={input} aria-label="Location risk weight" />
              </ConfigField>
              <ConfigField label="Time sensitivity" suffix="%" error={errors["weights.timeSensitivity"]}>
                <input type="number" inputMode="decimal" step="0.1" min="0" max="100" value={draft.timeSensitivity}
                  onChange={(e) => set({ timeSensitivity: e.target.value })} className={input} aria-label="Time sensitivity weight" />
              </ConfigField>
            </div>
            <p className={`mt-2 text-xs ${errors["weights.sum"] ? "font-bold text-blush-700" : "text-slate-500"}`}>
              {errors["weights.sum"] ?? "The four weights must add up to exactly 100.0."}
            </p>
          </section>

          <section className={card}>
            <h3 className={`${h2} mb-2`}>AHP consistency</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigField label="Consistency ratio" suffix="max 0.10" error={errors["consistency.cr"]}>
                <input type="number" inputMode="decimal" step="0.001" min="0" max="0.1" value={draft.cr}
                  onChange={(e) => set({ cr: e.target.value })} className={input} aria-label="Consistency ratio" />
              </ConfigField>
              <ConfigField label="Expert panel validation date" error={errors.panelValidationDate}>
                <DatePicker ariaLabel="Expert panel validation date" value={draft.panelValidationDate}
                  onChange={(v) => set({ panelValidationDate: v })} clearable className="block w-full"
                />
              </ConfigField>
            </div>
          </section>

          <section className={card}>
            <h3 className={`${h2} mb-2`}>Priority rules</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <ConfigField label="Hazard Location Risk" suffix="0–4" error={errors.hazardAdjustment}>
                <input type="number" inputMode="numeric" step="1" min="0" max="4" value={draft.hazardAdjustment}
                  onChange={(e) => set({ hazardAdjustment: e.target.value })} className={input} aria-label="Hazard Location Risk adjustment" />
              </ConfigField>
              <ConfigField label="Barangay limit" suffix="min" error={errors["escalation.barangayMinutes"]}>
                <input type="number" inputMode="numeric" step="1" min="1" max="60" value={draft.barangayMinutes}
                  onChange={(e) => set({ barangayMinutes: e.target.value })} className={input} aria-label="Barangay escalation limit in minutes" />
              </ConfigField>
              <ConfigField label="CDRRMO limit" suffix="min" error={errors["escalation.cdrrmoMinutes"]}>
                <input type="number" inputMode="numeric" step="1" min="1" max="60" value={draft.cdrrmoMinutes}
                  onChange={(e) => set({ cdrrmoMinutes: e.target.value })} className={input} aria-label="CDRRMO escalation limit in minutes" />
              </ConfigField>
            </div>
            {errors["escalation.order"] && (
              <p className="mt-2 text-xs font-bold text-blush-700">{errors["escalation.order"]}</p>
            )}
            <p className="mt-2 text-xs text-slate-500">Score bands, the Severity 5 override and the headcount override are fixed.</p>
          </section>

          <section className={card}>
            <h3 className={`${h2} mb-2`}>Assumed responder speeds</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <ConfigField label="On foot (Tanod)" suffix="km/h" error={errors["responderSpeeds.walking"]}>
                <input type="number" inputMode="decimal" step="0.1" min="1" max="120" value={draft.walking}
                  onChange={(e) => set({ walking: e.target.value })} className={input} aria-label="Walking speed" />
              </ConfigField>
              <ConfigField label="Motorcycle" suffix="km/h" error={errors["responderSpeeds.motorcycle"]}>
                <input type="number" inputMode="decimal" step="0.1" min="1" max="120" value={draft.motorcycle}
                  onChange={(e) => set({ motorcycle: e.target.value })} className={input} aria-label="Motorcycle speed" />
              </ConfigField>
              <ConfigField label="Vehicle / ambulance" suffix="km/h" error={errors["responderSpeeds.vehicle"]}>
                <input type="number" inputMode="decimal" step="0.1" min="1" max="120" value={draft.vehicle}
                  onChange={(e) => set({ vehicle: e.target.value })} className={input} aria-label="Vehicle speed" />
              </ConfigField>
            </div>
          </section>

          <div className="flex gap-2">
            <button type="button" onClick={() => { setEditing(false); setDraft(null); setReviewing(false); }}
              className={`${btnSecondary} flex-1 justify-center`}>Cancel</button>
            <button type="submit" disabled={!dirty || Object.keys(errors).length > 0}
              className={`${btnPrimary} flex-1 justify-center disabled:opacity-50`}>
              <Save size={15} /> Review changes
            </button>
          </div>
        </form>
      ) : (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className={h2}>Active configuration</h2>
                <p className="mt-1 text-sm font-bold text-slate-800">Version {active.version}</p>
                <p className="text-xs text-slate-500">
                  Set by {active.createdBy} · {dateTime(active.createdAt)}
                </p>
              </div>
              <button onClick={() => { setEditing(true); setDraft(draftFrom(active)); setReviewing(false); setRestoreTarget(null); setNotice(""); }}
                className={btnPrimary}><Pencil size={15} /> Edit</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Read-only until you edit. Every save creates a new version; tickets already created keep the
              weights they were scored with.
            </p>
          </section>

          <section className={card}>
            <h2 className={`${h2} mb-2`}>Urgency model</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              <ConfigRow label="Severity weight" value={`${active.weights.severity} %`} />
              <ConfigRow label="Vulnerability weight" value={`${active.weights.vulnerability} %`} />
              <ConfigRow label="Location risk weight" value={`${active.weights.locationRisk} %`} />
              <ConfigRow label="Time sensitivity weight" value={`${active.weights.timeSensitivity} %`} />
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              Consistency ratio {active.consistency.cr} · λmax {active.consistency.lambdaMax} · CI {active.consistency.ci} ·
              RI {active.consistency.ri}. Expert panel validation: {active.panelValidationDate ?? "not yet validated"}.
            </p>
          </section>

          <section className={card}>
            <h2 className={`${h2} mb-2`}>Priority rules</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              <ConfigRow label="Score bands" value={bands.map(([k, v]) => `${k} ${v}`).join(" · ")} />
              <ConfigRow label="Critical override" value="Severity 5 or headcount mismatch" />
              <ConfigRow label="Barangay escalation" value={`${active.escalation.barangayMinutes} min`} />
              <ConfigRow label="CDRRMO escalation" value={`${active.escalation.cdrrmoMinutes} min`} />
              <ConfigRow label="Hazard Location Risk" value={`+${active.hazardAdjustment}`} />
            </dl>
          </section>

          <section className={card}>
            <h2 className={`${h2} mb-2`}>Assumed responder speeds</h2>
            <dl className="divide-y divide-slate-100 text-sm">
              <ConfigRow label="On foot (Barangay Tanod)" value={`${active.responderSpeeds.walking} km/h`} />
              <ConfigRow label="Motorcycle" value={`${active.responderSpeeds.motorcycle} km/h`} />
              <ConfigRow label="Vehicle / ambulance" value={`${active.responderSpeeds.vehicle} km/h`} />
            </dl>
          </section>
        </>
      )}

      <section className={card}>
        <h2 className={`${h2} mb-2`}><History size={14} /> Version history</h2>
        {versions.length === 0 ? (
          <p className="text-sm text-slate-500">No versions yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    v{v.version}
                    {v.active && (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700">Active</span>
                    )}
                  </p>
                  <p className="text-[11px] text-slate-500">
                    {v.createdBy} · {dateTime(v.createdAt)} · {v.weights.severity}/{v.weights.vulnerability}/
                    {v.weights.locationRisk}/{v.weights.timeSensitivity} % · CR {v.consistency.cr} · panel{" "}
                    {v.panelValidationDate ?? "not set"}
                  </p>
                </div>
                {!v.active && (
                  <button onClick={() => { setRestoreTarget(v); setNotice(""); }}
                    disabled={dirty}
                    title={dirty ? "Finish or cancel your edit first" : "Restore this version"}
                    className={`${btnSecondary} shrink-0 disabled:opacity-40`}>
                    <RotateCcw size={15} /> Restore this version
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Restoring copies an old version into a new one — earlier versions are never modified or deleted.
        </p>
      </section>

      {reviewing && draft && (
        <ConfigReviewModal
          title="Review configuration change"
          intro={`These values become version ${(versions[0]?.version ?? 0) + 1} and apply to tickets created from now on.`}
          rows={changeRows(active, payloadFrom(draft))}
          openTickets={openTickets}
          confirmLabel="Save version"
          onClose={() => setReviewing(false)}
          onConfirm={async (password, confirmOpen) => {
            const r = await api<{ active: ConfigVersion; versions: ConfigVersion[]; openTickets: number }>(
              "PUT", "/api/admin/config",
              { config: payloadFrom(draft), password, confirmOpenTickets: confirmOpen },
            );
            apply(r, `Version ${r.active.version} saved. Existing tickets keep their original weights.`);
          }}
        />
      )}

      {restoreTarget && (
        <ConfigReviewModal
          title={`Restore version ${restoreTarget.version}`}
          intro="Restoring creates a new version with these values. Nothing is deleted and open tickets are not re-scored."
          rows={changeRows(active, payloadOfVersion(restoreTarget))}
          openTickets={openTickets}
          confirmLabel="Restore version"
          onClose={() => setRestoreTarget(null)}
          onConfirm={async (password, confirmOpen) => {
            const r = await api<{ active: ConfigVersion; versions: ConfigVersion[]; openTickets: number }>(
              "POST", `/api/admin/config/${restoreTarget.id}/restore`,
              { password, confirmOpenTickets: confirmOpen },
            );
            apply(r, `Version ${r.active.version} restored from v${restoreTarget.version}.`);
          }}
        />
      )}
    </div>
  );
}


// ----------------------------------------------------------- Sub-components

function ProvisionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (cred: TempCredential | null) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"teacher" | "principal" | "responder" | "parent">("teacher");
  const [grade, setGrade] = useState("");
  const [sectionName, setSectionName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ account: AccountRecord; tempPassword: string | null }>("POST", "/api/admin/accounts", {
        email, name, role, section: role === "parent" ? composeSection(grade, sectionName) : undefined, password: password || undefined,
      });
      onCreated(r.tempPassword ? { id: r.account.id, email, name, role, tempPassword: r.tempPassword } : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create account");
      setBusy(false);
    }
  }

  return (
    <Modal title="Provision new account" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} mt-1`} placeholder="user@example.com" />
        </label>
        <label className="block text-sm font-medium text-slate-700">Full name
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} placeholder="Juan Dela Cruz" />
        </label>
        <Select label="Role" labelClassName="text-sm font-medium text-slate-700" value={role}
          onChange={(v) => setRole(v as typeof role)}
          options={[
            { value: "teacher", label: "Teacher" },
            { value: "principal", label: "Principal" },
            { value: "responder", label: "Responder (Barangay/CDRRMO)" },
            { value: "parent", label: "Parent / PTA" },
          ]} />
        {role === "parent" && (
          <div className="space-y-3">
            <Select label="Grade" labelClassName="text-sm font-medium text-slate-700" value={grade}
              onChange={(v) => setGrade(v)} placeholder="Pick a grade"
              options={SECTION_GRADES.map((label) => ({ value: gradeCode(label) ?? "", label }))} />
            <label className="block text-sm font-medium text-slate-700">Section
              <input value={sectionName} maxLength={20} onChange={(e) => setSectionName(e.target.value)} className={`${input} mt-1`} placeholder="Sec A" />
            </label>
          </div>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Password <span className="font-normal text-slate-400">(blank = temporary)</span>
          </label>
          <div className="relative mt-1">
            <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
              className={`${input} pr-12`} placeholder="Min 8 characters" />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-slate-400">
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-blush-700">{error}</p>}
        <button onClick={() => void submit()} disabled={busy || !email || !name || (role === "parent" && (!grade || !sectionName.trim()))} className={`${btnPrimary} w-full justify-center`}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </div>
    </Modal>
  );
}

function TempCredentialModal({ title, credential, onClose }: { title: string; credential: TempCredential; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copyToClipboard() {
    void navigator.clipboard.writeText(`${credential.email} / ${credential.tempPassword}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 font-bold">⚠️ Save these credentials now</p>
          <p>This is the only time the temporary password will be shown. Share it securely with the user.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs text-slate-500">Email</p>
          <p className="font-mono text-sm font-bold">{credential.email}</p>
          <p className="mb-1 mt-3 text-xs text-slate-500">Temporary password</p>
          <p className="font-mono text-sm font-bold">{credential.tempPassword}</p>
        </div>
        <button onClick={copyToClipboard} className={`${btnSecondary} w-full justify-center`}>
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy credentials</>}
        </button>
        <p className="text-center text-xs text-slate-500">The user must set a new password on their first sign-in.</p>
      </div>
    </Modal>
  );
}

function PasswordResultModal({ tempPassword, onClose }: { tempPassword: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Password reset" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 font-bold">⚠️ Save this temporary password</p>
          <p>The user must set a new password on their next sign-in.</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1 text-xs text-slate-500">Temporary password</p>
          <p className="font-mono text-sm font-bold">{tempPassword}</p>
        </div>
        <button onClick={() => { void navigator.clipboard.writeText(tempPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className={`${btnSecondary} w-full justify-center`}>
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy password</>}
        </button>
      </div>
    </Modal>
  );
}

function RolloverResultModal({ credentials, onClose }: { credentials: TempCredential[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copyAll() {
    void navigator.clipboard.writeText(credentials.map((c) => `${c.email} / ${c.tempPassword}`).join("\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <Modal title="New school year started" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="mb-1 font-bold">⚠️ {credentials.length} temporary credentials generated</p>
          <p>All existing sessions were revoked. Share these credentials securely; users must set new passwords on first sign-in.</p>
        </div>
        <div className="scroll-area max-h-64 overflow-y-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-slate-600">Email</th>
                <th className="px-3 py-2 text-left font-bold text-slate-600">Temporary password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {credentials.map((c) => (
                <tr key={c.email}>
                  <td className="px-3 py-2 font-mono text-xs">{c.email}</td>
                  <td className="px-3 py-2 font-mono text-xs">{c.tempPassword}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button onClick={copyAll} className={`${btnSecondary} w-full justify-center`}>
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy all credentials</>}
        </button>
      </div>
    </Modal>
  );
}
