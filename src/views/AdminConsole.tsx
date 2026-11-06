import { useState, useEffect, useMemo, type ReactNode } from "react";
import {
  Users, ClipboardList, Calendar, Plus, RefreshCw, Unlock, UserX, UserCheck, Key, Eye, EyeOff, Copy, Check, AlertCircle,
  SlidersHorizontal, Search, X, History, Pencil, RotateCcw, Save, Trash2, FileWarning, Archive, Radio, ShieldCheck, User, ChevronRight,
  Footprints, Bike, Truck, ShieldAlert, Send, ShieldX,
  LogIn, LogOut, Database, Siren, AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api";
import type { AccountRecord, AuditEntry, ConfigPayload, ConfigVersion, SchoolYear, TempCredential } from "../lib/types";
import { Modal, ConfirmModal } from "../components/Modal";
import { TempCredentialModal, PasswordResultModal, InviteSentModal, type InviteNotice } from "../components/Credentials";
import { dateTime } from "../lib/format";
import { BackBarFor, Header, StatusBanner } from "../components/Chrome";
import { RoleNav } from "../components/RoleNav";
import { ADMIN_TABS, type AdminTab } from "../lib/navigation";
import { MasterDetail } from "../components/MasterDetail";
import { BoundedPane, PageFlow } from "../components/PageShell";
import { Select } from "../components/Select";
import { FilterBar } from "../components/FilterBar";
import { DatePicker } from "../components/DatePicker";
import {
  activeFilterCount, activeFilterEntries, clearGroupFilters, facetCounts, filterItems,
  inDateRange, initialDateRange, initialFilterState, isGroupSelected, matchesQuery,
  periodLabel, selectedValues, setCategory, setQuery, setSort, sortItems, toggleGroupValue,
  useFilterState, type DateRangeState, type FilterSpec,
} from "../lib/filters";
import { SECTION_GRADES, gradeCode, gradeLabel, composeSection, parseSection } from "../../shared/section.js";
import { RoomField } from "../components/RoomField";
import { GradeSectionField, RegistryField, normalizeSectionName, suggestionsForGrade } from "../components/FormFields";
import { RESPONDER_ORGS, SCHOOL } from "../../shared/domain.js";
import AccountView from "./AccountView";
import IncidentsRecords from "./IncidentsRecords";
import AnalyticsView from "./AnalyticsView";
import { recordsHash } from "../lib/records";
import type { AnalyticsRecordsLink } from "../components/RecordsAnalytics";

const card = "rounded-2xl border border-slate-200 bg-white p-4";
const h2 = "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500";
const input = "min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm";
const btn = "flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-sm font-bold";
const btnPrimary = `${btn} bg-brand-600 text-white`;
const btnSecondary = `${btn} bg-slate-100 text-slate-700`;
const btnDanger = `${btn} bg-blush-100 text-blush-700`;

/** Sub-screens of More — entries in the menu, never tabs of their own. */
type MoreScreen = "menu" | "year" | "audit" | "records" | "account";

/** The four Audit log categories, mapped from the stored action name. */
const AUDIT_CATEGORIES = [
  { value: "signin", label: "Sign-ins" },
  { value: "accounts", label: "Accounts" },
  { value: "incidents", label: "Incidents" },
  { value: "privacy", label: "Data and privacy" },
] as const;

function auditCategory(entry: AuditEntry): string {
  const a = String(entry.action ?? "");
  if (/login|logout|sign.?in|session/i.test(a)) return "signin";
  if (/purge|anonym|retention|export|privacy|data/i.test(a)) return "privacy";
  if (/incident|ticket|archive|restore|resolve|drill|hazard|route|escalat/i.test(a)) return "incidents";
  return "accounts";
}

/** Success unless the action says it failed/was refused. */
function auditResult(entry: AuditEntry): "success" | "failed" {
  return /fail|error|denied|refus|invalid|locked_out/i.test(String(entry.action ?? "")) ? "failed" : "success";
}

/** Every stored action, said in plain words (“Sign-in succeeded”). */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  login: "Sign-in succeeded",
  sign_in: "Sign-in succeeded",
  login_success: "Sign-in succeeded",
  login_failed: "Sign-in failed",
  login_policy: "Sign-in blocked by policy",
  logout: "Signed out",
  account_locked: "Account locked",
  account_unlocked: "Account unlocked",
  account_created: "Account created",
  account_updated: "Account updated",
  email_changed: "Email changed",
  email_verified: "Email verified",
  invite_sent: "Invitation sent",
  invite_used: "Invitation accepted",
  invite_revoked: "Invitation revoked",
  verification_sent: "Verification code sent",
  password_reset_requested: "Password reset requested",
  password_reset_completed: "Password reset completed",
  account_deactivated: "Account deactivated",
  account_activated: "Account activated",
  account_archived: "Account archived",
  account_restored: "Account restored",
  account_purged: "Account purged",
  account_seeded: "Demo accounts seeded",
  password_reset: "Password reset",
  password_change: "Password changed",
  password_change_failed: "Password change failed",
  incidents_purged: "Incident data purged",
  incident_archived: "Incident archived",
  incident_restored: "Incident restored",
  incident_auto_archived: "Incident auto-archived",
  incident_hidden: "Incident hidden",
  incident_unhidden: "Incident shown again",
  incident_acknowledged: "Incident acknowledged",
  data_request_processed: "Data request processed",
  school_year_started: "School year started",
  config_saved: "Settings saved",
  config_restored: "Settings restored",
  config_seeded: "Settings seeded",
  config_invalid_fallback: "Settings reset to defaults",
  section_changed: "Section changed",
  saved_room_changed: "Saved room changed",
};

/** “account_created” → “Account created”, for any action not listed above. */
function auditActionLabel(entry: AuditEntry): string {
  const raw = String(entry.action ?? "").trim();
  const known = AUDIT_ACTION_LABEL[raw.toLowerCase()];
  if (known) return known;
  const words = raw.replace(/[._]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Event";
}

/** Category tint + icon; a failure always takes the amber tone. */
const AUDIT_TONE: Record<string, { icon: typeof Users; tint: string; text: string }> = {
  signin: { icon: LogIn, tint: "bg-slate-100", text: "text-slate-600" },
  accounts: { icon: Users, tint: "bg-brand-50", text: "text-brand-700" },
  incidents: { icon: Siren, tint: "bg-sky-50", text: "text-sky-700" },
  privacy: { icon: Database, tint: "bg-violet-50", text: "text-violet-700" },
};

function auditTone(entry: AuditEntry) {
  const base = AUDIT_TONE[auditCategory(entry)] ?? AUDIT_TONE.accounts;
  if (auditResult(entry) === "failed") {
    return { icon: entry.action === "logout" ? LogOut : AlertTriangle, tint: "bg-amber-50", text: "text-amber-800" };
  }
  return base;
}

const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);
const DAY_MS = 86_400_000;

/** “Today”, “Yesterday”, then “Oct 31” — the day a group of events belongs to. */
function auditDayLabel(ts: number, now: number): string {
  const day = startOfDay(ts);
  const today = startOfDay(now);
  if (day === today) return "Today";
  if (day === today - DAY_MS) return "Yesterday";
  return new Date(ts).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** Phones read a day-grouped event list; >= 768 reads a fixed-width table. */
export function AuditLog({ entries, now }: { entries: AuditEntry[]; now: number }) {
  const days = useMemo(() => {
    const groups: { key: string; label: string; entries: AuditEntry[] }[] = [];
    for (const entry of entries) {
      const key = String(startOfDay(entry.at));
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.entries.push(entry);
      else groups.push({ key, label: auditDayLabel(entry.at, now), entries: [entry] });
    }
    return groups;
  }, [entries, now]);
  const [detail, setDetail] = useState<AuditEntry | null>(null);

  return (
    <div data-audit>
      {/* Phone: one card per event, under a sticky day heading. */}
      <div data-audit-list className="space-y-4 lg:hidden">
        {days.map((day) => (
          <section key={day.key} data-audit-day={day.label}>
            <h3 className="sticky top-0 z-10 -mx-1 mb-2 bg-cream/95 px-1 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 backdrop-blur">
              {day.label}
            </h3>
            <ul className="space-y-2">
              {day.entries.map((entry, i) => {
                const tone = auditTone(entry);
                const Icon = tone.icon;
                return (
                  <li key={i} data-audit-event className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setDetail(entry)}
                      aria-label={`Event details: ${auditActionLabel(entry)}`}
                      className="flex min-h-14 w-full min-w-0 items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-brand-300"
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.tint} ${tone.text}`}>
                        <Icon size={15} aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words hyphens-none text-sm font-bold leading-snug text-slate-800">{auditActionLabel(entry)}</p>
                        <p data-audit-actor className="mt-0.5 break-words hyphens-none text-xs text-slate-600">
                          {entry.actorLabel || entry.by || "System"}
                        </p>
                        {entry.detail && <p className="mt-0.5 break-words hyphens-none text-[11px] leading-snug text-slate-400">{entry.detail}</p>}
                      </div>
                      <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-slate-400">
                        {new Date(entry.at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* >= 1024: six fixed columns, every cell wraps — never a sideways scroll. */}
      <div data-audit-table className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Audit events</caption>
          <colgroup>
            <col style={{ width: "13%" }} />
            <col style={{ width: "19%" }} />
            <col style={{ width: "15%" }} />
            <col style={{ width: "16%" }} />
            <col style={{ width: "25%" }} />
            <col style={{ width: "12%" }} />
          </colgroup>
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              {["Time", "Action", "Actor", "Target", "Detail", "IP"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 text-left text-xs font-bold text-slate-600">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.map((entry, i) => {
              const tone = auditTone(entry);
              const Icon = tone.icon;
              return (
                <tr key={i} data-audit-row className="align-top hover:bg-slate-50">
                  <td className="break-words px-3 py-2 text-xs tabular-nums text-slate-500">{dateTime(entry.at)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex min-w-0 items-center gap-1.5 rounded-full ${tone.tint} ${tone.text} px-2 py-0.5 text-[11px] font-bold`}>
                      <Icon size={12} className="shrink-0" aria-hidden />
                      <span className="break-words hyphens-none">{auditActionLabel(entry)}</span>
                    </span>
                  </td>
                  <td className="break-words px-3 py-2 text-slate-600">{entry.actorLabel || entry.by || "—"}</td>
                  <td className="break-words px-3 py-2 text-slate-600">{entry.targetLabel || entry.target || "—"}</td>
                  <td className="break-words px-3 py-2 text-slate-500">{entry.detail || "—"}</td>
                  <td className="break-all px-3 py-2 font-mono text-[11px] text-slate-400">{entry.ip || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && <AuditEventDetails entry={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Phone: the full event, including Target and IP, in a details sheet. */
function AuditEventDetails({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const rows: [string, string][] = [
    ["Time", dateTime(entry.at)],
    ["Action", auditActionLabel(entry)],
    ["Result", auditResult(entry) === "failed" ? "Failed" : "Success"],
    ["Actor", entry.actorLabel || entry.by || "System"],
    ["Target", entry.targetLabel || entry.target || "—"],
    // The raw stored id stays available as the reference, never as a heading.
    ["Reference", entry.target || entry.by || "—"],
    ["Detail", entry.detail || "—"],
    ["IP", entry.ip || "—"],
  ];
  return (
    <Modal title="Event details" onClose={onClose}>
      <dl data-audit-detail className="space-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
            <dt className="w-20 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className={`min-w-0 flex-1 break-words hyphens-none ${label === "IP" ? "font-mono text-xs text-slate-500" : "text-slate-700"}`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

const AUDIT_SPEC: FilterSpec<AuditEntry> = {
  groups: {
    category: (entry, value) => auditCategory(entry) === value,
    result: (entry, value) => auditResult(entry) === value,
  },
};

const MORE_ITEMS: { id: Exclude<MoreScreen, "menu">; label: string; hint: string; icon: typeof Users }[] = [
  { id: "year", label: "School year", hint: "Rollover and temporary credentials", icon: Calendar },
  { id: "audit", label: "Audit log", hint: "Read-only security and admin trail", icon: ClipboardList },
  { id: "records", label: "Incidents & Records", hint: "Records browser, drill records and archives", icon: Archive },
  { id: "account", label: "Account", hint: "Password, About and sign out", icon: User },
];

export default function AdminConsole() {
  const [tab, setTab] = useState<AdminTab>("accounts");
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  // The audit log's filters (period + category + result), kept for the session.
  const [auditRange, setAuditRange] = useFilterState<DateRangeState>("admin-audit-range", initialDateRange);
  const [auditFilters, setAuditFilters] = useFilterState("admin-audit-filters", () => initialFilterState());
  const [schoolYear, setSchoolYear] = useState<SchoolYear | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Modals
  const [showProvision, setShowProvision] = useState(false);
  const [provisionResult, setProvisionResult] = useState<TempCredential | null>(null);
  const [inviteNotice, setInviteNotice] = useState<InviteNotice | null>(null);
  const [inviteRevokeTarget, setInviteRevokeTarget] = useState<AccountRecord | null>(null);
  const [resetTarget, setResetTarget] = useState<AccountRecord | null>(null);
  const [resetResult, setResetResult] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<AccountRecord | null>(null);
  const [editTarget, setEditTarget] = useState<AccountRecord | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<AccountRecord | null>(null);
  const [requestTarget, setRequestTarget] = useState<AccountRecord | null>(null);
  // The More page's own entries (School year, Audit, Incidents & Records,
  // Account) render one at a time inside the More tab.
  const [moreScreen, setMoreScreen] = useState<MoreScreen>("menu");
  const [rolloverConfirm, setRolloverConfirm] = useState(false);
  const [rolloverResult, setRolloverResult] = useState<TempCredential[] | null>(null);

  // Leaving Configuration with unsaved edits asks first (ConfigTab reports its dirty state).
  const [configDirty, setConfigDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState<AdminTab | null>(null);

  function guardedSetTab(next: AdminTab) {
    if (tab === "config" && next !== "config" && configDirty) { setLeaveTo(next); return; }
    // A More sub-screen belongs to More: leaving the tab closes it so it never
    // stays rendered under another page.
    if (next !== "more") setMoreScreen("menu");
    setConfigDirty(false);
    setTab(next);
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, moreScreen]);

  // Audit records inside the chosen period, then the category and result sections.
  const auditInPeriod = useMemo(
    () => auditEntries.filter((entry) => inDateRange(entry.at, auditRange, Date.now())),
    [auditEntries, auditRange],
  );
  const auditShown = useMemo(() => {
    const categories = auditFilters.groups.category ?? [];
    const results = auditFilters.groups.result ?? [];
    return auditInPeriod.filter(
      (entry) =>
        (categories.length === 0 || categories.includes(auditCategory(entry))) &&
        (results.length === 0 || results.includes(auditResult(entry))),
    );
  }, [auditInPeriod, auditFilters]);
  const auditCatCounts = facetCounts(auditInPeriod, auditFilters, AUDIT_SPEC, {
    options: AUDIT_CATEGORIES.map((c) => c.value),
    valueOf: (entry) => auditCategory(entry),
    exclude: "category",
  });
  const auditResultCounts = facetCounts(auditInPeriod, auditFilters, AUDIT_SPEC, {
    options: ["success", "failed"],
    valueOf: (entry) => auditResult(entry),
    exclude: "result",
  });
  const auditFilterCount =
    (auditFilters.groups.category?.length ?? 0) +
    (auditFilters.groups.result?.length ?? 0) +
    (auditRange.period === "all" ? 0 : 1);
  const auditToggle = (group: string, value: string) =>
    setAuditFilters((s) => toggleGroupValue(s, group, value));
  const auditChip = (group: string, value: string, label: string, count: number) => ({
    value,
    label,
    count,
    disabled: count === 0 && !isGroupSelected(auditFilters, group, value),
  });
  const auditFilterBar = (
    <FilterBar
      compact
      filters={{
        groups: [
          {
            id: "category",
            label: "Category",
            options: AUDIT_CATEGORIES.map((c) => auditChip("category", c.value, c.label, auditCatCounts.find((x) => x.value === c.value)?.count ?? 0)),
            selected: selectedValues(auditFilters, "category"),
            onToggle: auditToggle,
          },
          {
            id: "result",
            label: "Result",
            options: [
              auditChip("result", "success", "Success", auditResultCounts.find((x) => x.value === "success")?.count ?? 0),
              auditChip("result", "failed", "Failed", auditResultCounts.find((x) => x.value === "failed")?.count ?? 0),
            ],
            selected: selectedValues(auditFilters, "result"),
            onToggle: auditToggle,
          },
        ],
        activeCount: auditFilterCount,
        onReset: () => setAuditFilters((s) => clearGroupFilters(s)),
        shown: auditShown.length,
        total: auditInPeriod.length,
        title: "Audit filters",
      }}
      period={{ value: auditRange, onChange: setAuditRange }}
      results={{ label: "Events", shown: auditShown.length, total: auditInPeriod.length }}
    />
  );

  async function loadData() {
    const needsData = tab === "accounts" || (tab === "more" && (moreScreen === "audit" || moreScreen === "year"));
    if (!needsData) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      if (tab === "accounts") {
        const r = await api<{ accounts: AccountRecord[] }>("GET", "/api/admin/accounts");
        setAccounts(r.accounts);
      } else if (moreScreen === "audit") {
        const r = await api<{ entries: AuditEntry[] }>("GET", "/api/admin/audit");
        setAuditEntries(r.entries);
      } else if (moreScreen === "year") {
        const r = await api<SchoolYear>("GET", "/api/admin/school-year");
        setSchoolYear(r);
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
  async function handleRestore(acc: AccountRecord) {
    try { await api("POST", `/api/admin/accounts/${acc.id}/restore`); await loadData(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed to restore"); }
  }
  async function handlePurge(reason: string) {
    if (!purgeTarget) return;
    await api("POST", `/api/admin/accounts/${purgeTarget.id}/purge`, { reason, confirm: "PURGE" });
    setPurgeTarget(null);
    await loadData();
  }
  async function handleDataRequest(v: { type: "restrict" | "erase"; reference: string; reason: string; confirm?: string }) {
    if (!requestTarget) return;
    await api("POST", "/api/admin/data-requests", { accountId: requestTarget.id, ...v });
    setRequestTarget(null);
    await loadData();
  }
  // Edit an account: name and email, a responder's organization, a parent's
  // section, and (for a teacher) the shared class fields.
  async function handleEdit(values: { name: string; email: string; org?: string; section?: string; room?: string; registry?: number }) {
    if (!editTarget) return;
    const r = await api<{ emailPending?: boolean }>("PUT", `/api/admin/accounts/${editTarget.id}`, values);
    setEditTarget(null);
    setNotice(r.emailPending ? "Verification code sent to the new address. The old email stays valid until it is confirmed." : "");
    await loadData();
  }
  async function handleResendInvite(acc: AccountRecord) {
    setError("");
    try {
      const r = await api<{ maskedEmail?: string | null }>("POST", `/api/admin/accounts/${acc.id}/invite/resend`);
      setNotice(`Invitation resent${r.maskedEmail ? ` to ${r.maskedEmail}` : ""}.`);
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to resend the invitation"); }
  }
  function handleRevokeInvite(acc: AccountRecord) { setInviteRevokeTarget(acc); }
  async function confirmRevokeInvite() {
    if (!inviteRevokeTarget) return;
    setError("");
    try {
      await api("POST", `/api/admin/accounts/${inviteRevokeTarget.id}/invite/revoke`);
      setInviteRevokeTarget(null);
      setNotice("Invitation revoked. The account cannot sign in until a new invite is sent.");
      await loadData();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to revoke the invitation"); }
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
        <Header title="Super Admin" subtitle="Users, analytics and system settings" />
        <StatusBanner />
        <main className="scroll-area min-h-0 flex-1 pb-24 lg:pb-0">
          {error && (
            <div className="mx-auto mb-3 flex w-full max-w-6xl items-start gap-2 rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="mx-auto mb-3 flex w-full max-w-6xl items-start justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <span className="flex items-center gap-2"><Send size={16} className="shrink-0" /> {notice}</span>
              <button type="button" onClick={() => setNotice("")} aria-label="Dismiss" className="shrink-0 text-emerald-700"><X size={16} /></button>
            </div>
          )}
          {loading && <div className="py-8 text-center text-slate-500">Loading…</div>}

          {tab === "accounts" && !loading && (
            /* FLOW page: the whole page scrolls with the wheel. The compact
               metric cards sit inside the roster header, under search + filters. */
            <PageFlow className="space-y-4">
              <section aria-label="Users">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 className={h2}><Users size={14} /> Users ({accounts.length})</h2>
                  <button onClick={() => setShowProvision(true)} className={btnPrimary}><Plus size={15} /> Provision</button>
                </div>
                {/* Bounded at >= 1024 so the list and detail panes scroll
                    internally; below that the list opens a slide-over. */}                  <BoundedPane label="User roster">
                  <AccountsPane accounts={accounts} summary={<AdminDashboard accounts={accounts} />}
                    onUnlock={handleUnlock} onActivate={handleActivate}
                    onReset={setResetTarget} onDeactivate={setDeactivateTarget} onRestore={handleRestore}
                    onPurge={setPurgeTarget} onRequest={setRequestTarget} onEdit={setEditTarget}
                    onResendInvite={handleResendInvite} onRevokeInvite={handleRevokeInvite}
                    />
                </BoundedPane>
              </section>
            </PageFlow>
          )}

          {tab === "analytics" && (
            <AnalyticsView onOpenRecords={(link: AnalyticsRecordsLink) => {
              if (link) window.location.hash = recordsHash(link);
              setTab("more");
              setMoreScreen("records");
            }} />
          )}

          {tab === "more" && moreScreen === "menu" && (
            <PageFlow width="max-w-md" className="space-y-3">
              <div>
                <h1 className="text-lg font-black tracking-tight text-brand-900">More</h1>
                <p className="mt-1 text-xs text-slate-500">School year, audit, records and your account.</p>
              </div>
              <div className="space-y-2">
                {MORE_ITEMS.map((it) => (
                  <button key={it.id} type="button" onClick={() => setMoreScreen(it.id)}
                    className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left">
                    <it.icon size={20} className="shrink-0 text-brand-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-slate-800">{it.label}</span>
                      <span className="block text-xs text-slate-500">{it.hint}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            </PageFlow>
          )}

          {tab === "more" && moreScreen === "records" && (
            <>
              <BackBarFor title="Incidents & Records" backLabel="More" onBack={() => setMoreScreen("menu")} />
              <IncidentsRecords showAccounts />
            </>
          )}

          {tab === "more" && moreScreen === "audit" && !loading && (
            <>
            <BackBarFor title="Audit log" backLabel="More" onBack={() => setMoreScreen("menu")} actions={auditFilterBar} />
            <PageFlow className="space-y-3">
              <p data-audit-summary className="text-xs text-slate-500" aria-live="polite">
                {auditShown.length} event{auditShown.length === 1 ? "" : "s"} · {periodLabel(auditRange)}
              </p>
              <AuditLog entries={auditShown} now={Date.now()} />
              {auditEntries.length === 0 && <p className="py-8 text-center text-slate-500">No audit entries yet.</p>}
              {auditEntries.length > 0 && auditShown.length === 0 && (
                <p className="py-8 text-center text-slate-500">No entries in that date range.</p>
              )}
            </PageFlow>
            </>
          )}

          {tab === "more" && moreScreen === "year" && !loading && (
            <>
            <BackBarFor title="School year" backLabel="More" onBack={() => setMoreScreen("menu")} />
            <PageFlow className="space-y-3">
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
            </PageFlow>
            </>
          )}

          {tab === "config" && <ConfigTab onDirtyChange={setConfigDirty} />}
          {tab === "more" && moreScreen === "account" && <AccountView onBack={() => setMoreScreen("menu")} />}
        </main>

      </div>

      {showProvision && (
        <ProvisionModal knownSections={accounts.map((a) => a.section ?? "")} onClose={() => setShowProvision(false)}
          onCreated={(r) => {
            setShowProvision(false);
            setProvisionResult(r.credential);
            setInviteNotice(r.invite);
            if (r.mailError) setNotice("Email could not be sent, so a temporary password was issued instead.");
            void loadData();
          }} />
      )}
      {provisionResult && <TempCredentialModal title="Account provisioned" credential={provisionResult} onClose={() => setProvisionResult(null)} />}
      {inviteNotice && <InviteSentModal notice={inviteNotice} onClose={() => setInviteNotice(null)} onChanged={() => void loadData()} />}
      {inviteRevokeTarget && (
        <ConfirmModal title="Revoke invitation" danger onClose={() => setInviteRevokeTarget(null)}
          message={`The current invitation link for ${inviteRevokeTarget.name} stops working immediately. The account stays invited and cannot sign in until a new link is sent.`}
          confirmLabel="Revoke invite" onConfirm={() => void confirmRevokeInvite()} />
      )}
      {editTarget && (
        <AccountEditModal acc={editTarget} knownSections={accounts.map((a) => a.section ?? "")}
          onClose={() => setEditTarget(null)} onSave={handleEdit} />
      )}
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
      {purgeTarget && (
        <PurgeDialog acc={purgeTarget} onClose={() => setPurgeTarget(null)} onConfirm={handlePurge} />
      )}
      {requestTarget && (
        <DataRequestDialog acc={requestTarget} onClose={() => setRequestTarget(null)} onConfirm={handleDataRequest} />
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

/** Actions worth counting as "security events" on the dashboard. */
const SECURITY_ACTIONS = new Set([
  "login_failed", "login_policy", "account_locked", "account_unlocked",
  "password_reset", "password_change_failed", "password_change",
  "account_archived", "account_restored", "account_purged", "data_request_processed",
]);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Super Admin landing: three quick metrics, nothing else. The retention
 * policy table deliberately does NOT live here — it moved to About ASPIRE.
 */
function AdminDashboard({ accounts }: { accounts: AccountRecord[] }) {
  const [recent, setRecent] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    void api<{ entries: AuditEntry[] }>("GET", "/api/admin/audit?limit=200")
      .then((r) => {
        if (!live) return;
        const cutoff = Date.now() - ONE_DAY_MS;
        setRecent((r.entries ?? []).filter((e) => e.at >= cutoff && SECURITY_ACTIONS.has(e.action)).length);
      })
      .catch(() => { if (live) setRecent(null); });
    return () => { live = false; };
  }, []);

  const active = accounts.filter((a) => a.status === "active").length;
  const responders = accounts.filter((a) => a.role === "responder" && a.status === "active").length;
  const cards = [
    { label: "Total users", value: String(accounts.length), hint: `${active} active`, icon: Users },
    { label: "Active responders", value: String(responders), hint: "Barangay Sinalhan + CDRRMO", icon: Radio },
    { label: "Recent security events", value: recent === null ? "—" : String(recent), hint: "last 24 hours", icon: ShieldCheck },
  ];
  // Three compact tiles, always side by side (never 2 + 1 with an empty gap),
  // sized off the Principal view's stat styling.
  return (
    <div data-metric-cards className="grid grid-cols-3 gap-1.5">
      {cards.map((c) => (
        <div key={c.label} data-metric-card className="min-w-0 rounded-2xl border border-slate-200 bg-white px-1.5 py-2 text-center">
          <p className="font-mono text-lg font-black leading-none tabular-nums text-slate-900">{c.value}</p>
          <p className="mt-1 text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-500" title={c.label}>
            <c.icon size={11} aria-hidden className="mr-0.5 inline align-[-1px]" />{c.label}
          </p>
          <p className="mt-0.5 truncate text-[9px] text-slate-400" title={c.hint}>{c.hint}</p>
        </div>
      ))}
    </div>
  );
}

/** Irreversible purge: reason + a typed PURGE confirmation. */
function PurgeDialog({ acc, onConfirm, onClose }: {
  acc: AccountRecord;
  onConfirm: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = confirm === "PURGE" && reason.trim().length > 0;
  async function go() {
    setBusy(true); setErr("");
    try { await onConfirm(reason.trim()); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Purge failed."); setBusy(false); }
  }
  return (
    <Modal title="Purge personal data" onClose={onClose}>
      <p className="text-sm leading-relaxed text-slate-600">
        {acc.name} ({acc.email}) — name, email, section, room and password are erased for good and sessions are destroyed.
        The account id and role are kept so audit entries and timelines still resolve. Statistics are unaffected.
      </p>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Reason
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Data request, retention period passed…"
          className={`mt-1 ${input}`} />
      </label>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Type PURGE to confirm
        <input value={confirm} maxLength={20} onChange={(e) => setConfirm(e.target.value)} placeholder="PURGE"
          className={`mt-1 ${input}`} autoComplete="off" />
      </label>
      {err && <p className="mt-2 text-sm text-blush-700" role="alert">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className={`${btnSecondary} flex-1 justify-center`}>Cancel</button>
        <button onClick={() => void go()} disabled={!ready || busy}
          className={`${btnDanger} flex-1 justify-center disabled:opacity-60`}>{busy ? "Purging…" : "Purge"}</button>
      </div>
    </Modal>
  );
}

/** Admin > account detail > Process data request (restrict / erase). */
function DataRequestDialog({ acc, onConfirm, onClose }: {
  acc: AccountRecord;
  onConfirm: (v: { type: "restrict" | "erase"; reference: string; reason: string; confirm?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<"restrict" | "erase">("restrict");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reference.trim() && reason.trim() && (type === "restrict" || confirm === "ERASE");
  async function go() {
    setBusy(true); setErr("");
    try {
      await onConfirm({ type, reference: reference.trim(), reason: reason.trim(), ...(type === "erase" ? { confirm } : {}) });
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Request failed."); setBusy(false); }
  }
  return (
    <Modal title="Process data request" onClose={onClose}>
      <p className="text-sm leading-relaxed text-slate-600">
        {acc.name} ({acc.email}). A restriction archives the account immediately; an erasure archives and purges it and
        anonymises every incident it reported, whatever the retention period says.
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setType("restrict")} aria-pressed={type === "restrict"}
          className={`min-h-12 flex-1 rounded-xl text-sm font-bold ${type === "restrict" ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}>Restrict</button>
        <button type="button" onClick={() => setType("erase")} aria-pressed={type === "erase"}
          className={`min-h-12 flex-1 rounded-xl text-sm font-bold ${type === "erase" ? "bg-blush text-brand-900" : "bg-slate-100 text-slate-700"}`}>Erase</button>
      </div>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Request reference
        <input value={reference} maxLength={80} onChange={(e) => setReference(e.target.value)} placeholder="e.g. DPA-2026-014"
          className={`mt-1 ${input}`} />
      </label>
      <label className="mt-3 block text-xs font-semibold text-slate-600">Reason
        <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Written request from the data subject"
          className={`mt-1 ${input}`} />
      </label>
      {type === "erase" && (
        <label className="mt-3 block text-xs font-semibold text-slate-600">Type ERASE to confirm
          <input value={confirm} maxLength={20} onChange={(e) => setConfirm(e.target.value)} placeholder="ERASE"
            className={`mt-1 ${input}`} autoComplete="off" />
        </label>
      )}
      {err && <p className="mt-2 text-sm text-blush-700" role="alert">{err}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className={`${btnSecondary} flex-1 justify-center`}>Cancel</button>
        <button onClick={() => void go()} disabled={!ready || busy}
          className={`${type === "erase" ? btnDanger : btnPrimary} flex-1 justify-center disabled:opacity-60`}>{busy ? "Working…" : "Submit request"}</button>
      </div>
    </Modal>
  );
}

/** Account state beside the name: Active, Deactivated, Archived or Purged. */
function StatusBadge({ acc }: { acc: AccountRecord }) {
  const badge = STATUS_BADGE[acc.status] ?? { label: acc.status, className: "bg-slate-100 text-slate-500" };
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${badge.className}`}>{badge.label}</span>;
}

/** Secondary warnings (password change, temporary credential, lockout) — not the status itself. */
function StatusChips({ acc }: { acc: AccountRecord }) {
  const chips = [
    acc.status === "invited" ? { label: "Invited", className: "bg-sky-100 text-sky-800" } : null,
    acc.emailVerifiedAt
      ? { label: "Verified", className: "bg-emerald-100 text-emerald-700" }
      : { label: "Not verified", className: "bg-slate-100 text-slate-600" },
    acc.pendingEmail ? { label: "New email pending", className: "bg-amber-100 text-amber-800" } : null,
    acc.mustChange ? { label: "Must change password", className: "bg-amber-100 text-amber-700" } : null,
    acc.temp ? { label: "Temporary credential", className: "bg-blue-100 text-blue-700" } : null,
    acc.locked ? { label: "Locked", className: "bg-blush-100 text-blush-700" } : null,
  ].filter((c): c is { label: string; className: string } => Boolean(c));
  if (!chips.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map((c) => (
        <span key={c.label} className={`rounded-full px-2 py-0.5 text-xs font-bold ${c.className}`}>{c.label}</span>
      ))}
    </div>
  );
}

type AccountAction = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  tone: "primary" | "secondary" | "danger" | "positive";
  /** A lone or emphasised action fills the whole row. */
  wide?: boolean;
  title?: string;
};

const actionBase = "flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-3 text-sm font-bold";
const ACTION_TONE: Record<AccountAction["tone"], string> = {
  primary: `${actionBase} bg-brand-600 text-white`,
  secondary: `${actionBase} border border-slate-300 bg-white text-slate-700`,
  danger: `${actionBase} bg-blush-100 text-blush-700`,
  positive: `${actionBase} border border-emerald-200 bg-emerald-50 text-emerald-800`,
};

/** Even two-column rows so the buttons line up instead of wrapping unevenly. */
function ActionGroup({ title, actions }: { title: string; actions: AccountAction[] }) {
  if (!actions.length) return null;
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{title}</p>
      <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {actions.map((a) => (
          <button key={a.key} type="button" onClick={a.onClick} title={a.title}
            className={`${ACTION_TONE[a.tone]} ${a.wide || actions.length === 1 ? "sm:col-span-2" : ""}`}>
            {a.icon} {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AccountActions({ acc, onUnlock, onActivate, onReset, onDeactivate, onRestore, onPurge, onRequest, onEdit, onResendInvite, onRevokeInvite }: {
  acc: AccountRecord;
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
  onRestore?: (a: AccountRecord) => void;
  onPurge?: (a: AccountRecord) => void;
  onRequest?: (a: AccountRecord) => void;
  onEdit?: (a: AccountRecord) => void;
  onResendInvite?: (a: AccountRecord) => void;
  onRevokeInvite?: (a: AccountRecord) => void;
}) {
  const closed = acc.status === "archived" || acc.status === "purged";
  const primary: AccountAction[] = [];
  const data: AccountAction[] = [];

  if (!closed) {
    if (onEdit) primary.push({
      key: "edit", label: "Edit Profile", icon: <Pencil size={15} />, onClick: () => onEdit(acc),
      tone: "primary", title: "Edit the account name and assignment",
    });
    if (acc.status === "invited" && onResendInvite) primary.push({
      key: "resend-invite", label: "Resend invite", icon: <Send size={15} />, onClick: () => onResendInvite(acc),
      tone: "secondary", title: "Send a fresh 72-hour invitation link",
    });
    if (acc.status === "invited" && onRevokeInvite) primary.push({
      key: "revoke-invite", label: "Revoke invite", icon: <ShieldX size={15} />, onClick: () => onRevokeInvite(acc),
      tone: "danger", title: "Invalidate the current invitation link",
    });
    if (acc.status !== "invited") primary.push({
      key: "reset", label: "Reset Password", icon: <Key size={15} />, onClick: () => onReset(acc),
      tone: "secondary", title: "Reset password",
    });
    if (acc.locked) primary.push({
      key: "unlock", label: "Unlock Account", icon: <Unlock size={15} />, onClick: () => onUnlock(acc),
      tone: "secondary", wide: true, title: "Unlock account",
    });
    if (onRequest) data.push({
      key: "request", label: "Process Data Request", icon: <FileWarning size={15} />, onClick: () => onRequest(acc),
      tone: "secondary", title: "Process a data request",
    });
    if (acc.status === "active") data.push({
      key: "deactivate", label: "Deactivate Account", icon: <UserX size={15} />, onClick: () => onDeactivate(acc),
      tone: "danger", title: "Deactivate account",
    });
    else if (acc.status === "inactive") data.push({
      key: "activate", label: "Reactivate Account", icon: <UserCheck size={15} />, onClick: () => onActivate(acc),
      tone: "positive", title: "Reactivate account",
    });
  } else {
    if (acc.status !== "purged" && onEdit) primary.push({
      key: "edit", label: "Edit Profile", icon: <Pencil size={15} />, onClick: () => onEdit(acc),
      tone: "primary", title: "Edit the account name and assignment",
    });
    if (acc.status === "archived" && onRestore) primary.push({
      key: "restore", label: "Restore Account", icon: <UserCheck size={15} />, onClick: () => onRestore(acc),
      tone: "positive", title: "Restore account",
    });
    if (acc.status !== "purged" && onRequest) data.push({
      key: "request", label: "Process Data Request", icon: <FileWarning size={15} />, onClick: () => onRequest(acc),
      tone: "secondary", title: "Process a data request",
    });
    if (acc.purgeEligible && onPurge) data.push({
      key: "purge", label: "Purge Data", icon: <Trash2 size={15} />, onClick: () => onPurge(acc),
      tone: "danger", title: "Purge personal data",
    });
  }

  if (!primary.length && !data.length) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Actions</h3>
      <div className="mt-3 space-y-3">
        <ActionGroup title="Account actions" actions={primary} />
        <ActionGroup title="Data & account" actions={data} />
      </div>
    </section>
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
  { value: "invited", label: "Invited" },
  { value: "locked", label: "Locked" },
  { value: "mustchange", label: "Must change" },
  { value: "inactive", label: "Deactivated" },
  { value: "archived", label: "Archived" },
];

/** Display + colour per account status (archived/purged are their own states). */
const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700" },
  invited: { label: "Invited", className: "bg-sky-100 text-sky-800" },
  inactive: { label: "Deactivated", className: "bg-slate-100 text-slate-500" },
  archived: { label: "Archived", className: "bg-amber-100 text-amber-800" },
  purged: { label: "Purged", className: "bg-slate-200 text-slate-600" },
};

const GRADE_CHIPS: { value: string; label: string }[] = SECTION_GRADES.map((label) => ({
  value: gradeCode(label) ?? "",
  label,
}));

const ORG_OPTIONS = [...RESPONDER_ORGS.map((o: { label: string }) => o.label), SCHOOL.name];

/** Organization: a responder belongs to one dispatch org; everyone else to the school. */
const orgOf = (a: AccountRecord) =>
  a.role === "responder" ? (a.orgLabel || "Unassigned org") : SCHOOL.name;

/** "Responder · CDRRMO" — the org is part of who a responder is. */
const roleLine = (a: AccountRecord) =>
  `${a.role}${a.role === "responder" && a.orgLabel ? ` · ${a.orgLabel}` : ""}${a.section ? ` · ${a.section}` : ""}`;

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher", parent: "Parent/PTA", principal: "Principal", responder: "Responder", super_admin: "Super Admin",
};

/** What the account belongs to: a dispatch org, a class section, the school or the console. */
const assignmentOf = (a: AccountRecord) => {
  if (a.role === "responder") return a.orgLabel || "Not assigned";
  if (a.section) return `${SCHOOL.name} · ${a.section}`;
  if (a.role === "principal") return `${SCHOOL.name} · School-wide`;
  if (a.role === "super_admin") return "System console";
  return SCHOOL.name;
};

/** Structured grade with a parse fallback for older payloads. */
const gradeOf = (a: AccountRecord) => a.grade || parseSection(a.section ?? "").grade || "";

/** Status buckets an account belongs to (they overlap: active AND must change). */
const statusOf = (a: AccountRecord): string[] => {
  const out: string[] = [];
  if (a.status === "active") out.push("active");
  if (a.status === "invited") out.push("invited");
  if (a.locked) out.push("locked");
  if (a.mustChange) out.push("mustchange");
  if (a.status === "archived") out.push("archived"); // its own bucket: not a suspension
  else if (a.status !== "active" && a.status !== "invited") out.push("inactive");
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

/** One label/value line inside a detail section. */
function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-xs font-semibold text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function AccountDetail({ acc, onUnlock, onActivate, onReset, onDeactivate, onRestore, onPurge, onRequest, onEdit, onResendInvite, onRevokeInvite }: {
  acc: AccountRecord;
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
  onRestore?: (a: AccountRecord) => void;
  onPurge?: (a: AccountRecord) => void;
  onRequest?: (a: AccountRecord) => void;
  onEdit?: (a: AccountRecord) => void;
  onResendInvite?: (a: AccountRecord) => void;
  onRevokeInvite?: (a: AccountRecord) => void;
}) {
  return (
    <div className="space-y-3">
      {/* 1. Who the account belongs to, with its status beside the name. */}
      <header className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 text-xl font-black leading-tight text-slate-900">{acc.name}</h2>
          <StatusBadge acc={acc} />
        </div>
        <p className="mt-1 break-words text-sm text-slate-600">{acc.email}</p>
        <p className="text-xs font-medium text-slate-500">{ROLE_LABEL[acc.role] ?? acc.role}</p>
        <div className="mt-2"><StatusChips acc={acc} /></div>
      </header>

      {/* 2. Notices that need action, kept apart from ordinary metadata. */}
      {acc.role === "responder" && !acc.org && (
        <div role="alert" className="flex items-start gap-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-700" />
          <p className="text-sm leading-snug text-amber-900">
            <span className="font-bold">Organization: not assigned</span> — Edit to assign the responder.
          </p>
        </div>
      )}
      {acc.status === "archived" && !acc.purgeEligible && (
        <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <Archive size={18} className="mt-0.5 shrink-0 text-slate-500" />
          <p className="text-sm leading-snug text-slate-700">
            Purge becomes available once the retention period has passed.
          </p>
        </div>
      )}

      {/* 3. Structured information. */}
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Account details</h3>
        <dl className="mt-2 divide-y divide-slate-100">
          <DetailRow label="Email" value={acc.email} />
          <DetailRow label="System role" value={ROLE_LABEL[acc.role] ?? acc.role} />
          <DetailRow label="Organization / Assignment" value={assignmentOf(acc)} />
        </dl>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Activity</h3>
        <dl className="mt-2 divide-y divide-slate-100">
          <DetailRow label="Last sign-in" value={acc.lastLoginAt ? dateTime(acc.lastLoginAt) : "Never signed in"} />
          {acc.archivedAt && (
            <DetailRow
              label="Archived"
              value={`${dateTime(acc.archivedAt)}${acc.archiveReason ? ` — ${acc.archiveReason}` : ""}`}
            />
          )}
        </dl>
      </section>

      {/* 4. Actions: a primary pair, then the data/account pair, evenly aligned. */}
      <AccountActions acc={acc} onUnlock={onUnlock} onActivate={onActivate} onReset={onReset} onDeactivate={onDeactivate}
        onRestore={onRestore} onPurge={onPurge} onRequest={onRequest} onEdit={onEdit}
        onResendInvite={onResendInvite} onRevokeInvite={onRevokeInvite} />
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
      <p className="truncate text-xs text-slate-500">{roleLine(acc)}</p>
      <p className={`mt-1 text-[11px] font-bold uppercase tracking-wide ${acc.status === "active" ? "text-emerald-700" : acc.status === "archived" ? "text-amber-700" : "text-slate-400"}`}>{STATUS_BADGE[acc.status]?.label ?? acc.status}</p>
    </div>
  );
}

function AccountsPane({ accounts, onUnlock, onActivate, onReset, onDeactivate, onRestore, onPurge, onRequest, onEdit, onResendInvite, onRevokeInvite, summary }: {
  accounts: AccountRecord[];
  /** Compact dashboard tiles, rendered under search + filters (never above them). */
  summary?: ReactNode;
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
  onRestore: (a: AccountRecord) => void;
  onPurge: (a: AccountRecord) => void;
  onRequest: (a: AccountRecord) => void;
  onEdit: (a: AccountRecord) => void;
  onResendInvite: (a: AccountRecord) => void;
  onRevokeInvite: (a: AccountRecord) => void;
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
    <div className="space-y-2">
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
      results={{ label: "Users", shown: shown.length, total: accounts.length }}
    />
    {summary}
    </div>
  );

  return (
    <MasterDetail
      items={shown}
      ariaLabel="Users — select a user"
      listHeader={listHeader}
      emptyList={accounts.length === 0 ? "No accounts yet." : "No accounts match those filters."}
      emptyDetail="Select an account to see its profile and actions."
      renderList={(acc, active) => <AccountRow acc={acc} active={active} />}
      renderDetail={(acc) => (
        <AccountDetail acc={acc} onUnlock={onUnlock} onActivate={onActivate} onReset={onReset} onDeactivate={onDeactivate}
          onRestore={onRestore} onPurge={onPurge} onRequest={onRequest} onEdit={onEdit}
          onResendInvite={onResendInvite} onRevokeInvite={onRevokeInvite} />
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
  cr: string; panelValidationDate: string; panelReference: string;
  hazardAdjustment: string; barangayMinutes: string; cdrrmoMinutes: string;
  walking: string; motorcycle: string; vehicle: string;
};

type ChangeRow = { label: string; from: string; to: string };

const numOf = (s: string) => (String(s).trim() === "" ? NaN : Number(s));
const oneDecimal = (n: number) => Math.abs(n * 10 - Math.round(n * 10)) < 1e-9;
const isDateString = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const PANEL_REFERENCE_MAX = 120;

/** The panel fields record who validated the values and when; they never change scoring. */
const isDefaultVersion = (v: ConfigVersion) => !v.panelValidationDate;

/** "Validated <date> by <reference>", or the default-values wording. */
function validatedBy(v: ConfigVersion): string {
  if (!v.panelValidationDate) return "Default values. Not yet validated by the Expert Panel.";
  return `Validated ${v.panelValidationDate}${v.panelReference ? ` by ${v.panelReference}` : ""}`;
}

function draftFrom(v: ConfigVersion): ConfigDraft {
  return {
    severity: String(v.weights.severity),
    vulnerability: String(v.weights.vulnerability),
    locationRisk: String(v.weights.locationRisk),
    timeSensitivity: String(v.weights.timeSensitivity),
    cr: String(v.consistency.cr),
    panelValidationDate: v.panelValidationDate ?? "",
    panelReference: v.panelReference ?? "",
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
    panelReference: d.panelReference.trim(),
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
    panelReference: v.panelReference ?? "",
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
  if (/[\u0000-\u001F\u007F]/.test(d.panelReference)) out.panelReference = "Remove control characters (line breaks, tabs).";
  else if (d.panelReference.trim().length > PANEL_REFERENCE_MAX) out.panelReference = `Keep the panel or source to ${PANEL_REFERENCE_MAX} characters or fewer.`;

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
  const panel = (date?: string | null) => (date ? `Validated ${date}` : "Default values");
  return [
    { label: "Severity weight", from: pct(from.weights.severity), to: pct(to.weights.severity) },
    { label: "Vulnerability weight", from: pct(from.weights.vulnerability), to: pct(to.weights.vulnerability) },
    { label: "Location risk weight", from: pct(from.weights.locationRisk), to: pct(to.weights.locationRisk) },
    { label: "Time sensitivity weight", from: pct(from.weights.timeSensitivity), to: pct(to.weights.timeSensitivity) },
    { label: "AHP consistency ratio", from: String(from.consistency.cr), to: String(to.consistency.cr) },
    { label: "Expert panel validation", from: panel(from.panelValidationDate), to: panel(to.panelValidationDate) },
    { label: "Panel / source", from: from.panelReference ?? "", to: to.panelReference },
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

type SettingsTab = "scoring" | "escalation" | "versions";

const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: "scoring", label: "Scoring" },
  { id: "escalation", label: "Escalation & Travel" },
  { id: "versions", label: "Versions" },
];

const WEIGHT_ROWS = [
  { key: "severity" as const, label: "Severity", tone: "bg-brand-700", dot: "#283762" },
  { key: "vulnerability" as const, label: "Vulnerability", tone: "bg-brand-500", dot: "#425B9A" },
  { key: "locationRisk" as const, label: "Location risk", tone: "bg-sky-500", dot: "#0ea5e9" },
  { key: "timeSensitivity" as const, label: "Time sensitivity", tone: "bg-teal-500", dot: "#14b8a6" },
];

export function ConfigTab({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const [versions, setVersions] = useState<ConfigVersion[]>([]);
  const [openTickets, setOpenTickets] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<ConfigVersion | null>(null);
  // The selected tab survives a tab switch inside the console for this session.
  const [tab, setTab] = useFilterState<SettingsTab>("admin-config-tab", () => "scoring");

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
      <PageFlow width="max-w-3xl">
        <p className="rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">
          {error || "No configuration available."}
        </p>
      </PageFlow>
    );
  }

  const startEdit = () => {
    setEditing(true);
    setDraft(draftFrom(active));
    setReviewing(false);
    setRestoreTarget(null);
    setNotice("");
  };

  const defaults = isDefaultVersion(active);
  const statusText = defaults ? "Default values" : `Validated ${active.panelValidationDate}`;
  const sumWeights = WEIGHT_ROWS.reduce((n, w) => n + active.weights[w.key], 0);
  const consistent = active.consistency.cr <= 0.1;

  const versionStatus = (v: ConfigVersion) =>
    v.active ? "Active" : v.panelValidationDate ? "Validated" : "Default";

  const versionList = (
    <section data-versions-list className={card}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={h2}><History size={14} /> Versions</h2>
        <p className="text-[11px] text-slate-400">Restoring copies an old version into a new one.</p>
      </div>
      {versions.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No versions yet.</p>
      ) : (
        <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4">
          {versions.map((v) => {
            const status = versionStatus(v);
            return (
              <li key={v.id} data-version-item className="relative min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                <span className="absolute -left-[1.35rem] top-4 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-500" aria-hidden />
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span data-version-badge className="rounded-lg bg-brand-100 px-2 py-0.5 font-mono text-xs font-black text-brand-800">v{v.version}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${status === "Active" ? "bg-emerald-100 text-emerald-700" : status === "Validated" ? "bg-brand-50 text-brand-700" : "bg-amber-50 text-amber-800"}`}>{status}</span>
                  </div>
                  {!v.active && (
                    <button type="button" data-version-restore onClick={() => { setRestoreTarget(v); setNotice(""); }}
                      disabled={dirty}
                      title={dirty ? "Finish or cancel your edit first" : "Restore this version"}
                      className="flex min-h-8 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-[11px] font-bold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40">
                      <RotateCcw size={12} aria-hidden /> Restore
                    </button>
                  )}
                </div>
                <p className="mt-1 break-words text-[11px] text-slate-500">
                  {v.createdBy} · {dateTime(v.createdAt)}
                  {v.panelValidationDate ? ` · Validated ${v.panelValidationDate}` : " · Default values"}
                  {v.panelReference ? ` · ${v.panelReference}` : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {WEIGHT_ROWS.map((w) => (
                    <span key={w.key} data-version-weight className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: w.dot }} aria-hidden />
                      {w.label} {v.weights[w.key]}%
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );

  return (
    <PageFlow width="max-w-4xl" className="space-y-3">
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

      {/* One header: title, status chip and Edit in the actions slot; the
          long default-values banner becomes one inline line. */}
      <header data-settings-header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-normal hyphens-none text-lg font-black leading-tight tracking-tight text-brand-900">System Settings</h1>
            <p className="mt-0.5 break-words text-xs text-slate-500">Scoring weights, escalation and validated versions.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span data-settings-status
              className={`inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold ${defaults ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
              {defaults ? <AlertCircle size={12} aria-hidden /> : <Check size={12} aria-hidden />}
              {statusText}
            </span>
            {!editing && (
              <button type="button" data-settings-edit onClick={startEdit} className={btnPrimary}><Pencil size={15} /> Edit</button>
            )}
          </div>
        </div>
        <p data-settings-line className="mt-2 break-words text-xs leading-relaxed text-slate-600">
          {defaults
            ? "Default values are scoring new tickets until the panel validation is recorded."
            : `Validated ${active.panelValidationDate}${active.panelReference ? ` by ${active.panelReference}` : ""}.`}{" "}
          <button type="button" onClick={startEdit}
            className="font-bold text-brand-700 underline underline-offset-2 hover:text-brand-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
            Record validation
          </button>
        </p>
      </header>

      <div data-settings-tabs role="tablist" aria-label="System settings sections"
        className="flex w-full gap-5 overflow-x-auto border-b border-slate-200">
        {SETTINGS_TABS.map((t) => {
          const on = tab === t.id;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={on}
              onClick={() => setTab(t.id)}
              className={`min-h-11 shrink-0 border-b-2 px-0.5 text-xs font-bold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 motion-reduce:transition-none ${
                on ? "border-brand-600 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}>
              {t.label}
            </button>
          );
        })}
      </div>

      {editing && draft ? (
        <form id="config-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (Object.keys(errors).length === 0) setReviewing(true); }}>
          {tab === "scoring" && (
            <div data-settings-panel="scoring" className="space-y-3">
              <section className={card}>
                <h2 className={`${h2} mb-2`}>Weights</h2>
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
                <h2 className={`${h2} mb-2`}>AHP consistency</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <ConfigField label="Consistency ratio" suffix="max 0.10" error={errors["consistency.cr"]}>
                    <input type="number" inputMode="decimal" step="0.001" min="0" max="0.1" value={draft.cr}
                      onChange={(e) => set({ cr: e.target.value })} className={input} aria-label="Consistency ratio" />
                  </ConfigField>
                  <ConfigField label="Expert panel validation date" error={errors.panelValidationDate}>
                    <DatePicker ariaLabel="Expert panel validation date" value={draft.panelValidationDate}
                      onChange={(v) => set({ panelValidationDate: v })} clearable className="block w-full"
                    />
                  </ConfigField>
                  <ConfigField label="Panel / source" error={errors.panelReference}>
                    <input value={draft.panelReference} maxLength={PANEL_REFERENCE_MAX}
                      onChange={(e) => set({ panelReference: e.target.value })} className={input}
                      placeholder="AHP Expert Panel, SY 2026-2027" aria-label="Panel or source" />
                    <span className="mt-1 block text-[11px] font-normal text-slate-400">
                      Recorded only: who validated these values and when. It does not change scoring.
                    </span>
                  </ConfigField>
                </div>
              </section>
            </div>
          )}

          {tab === "escalation" && (
            <div data-settings-panel="escalation" className="space-y-3">
              <section className={card}>
                <h2 className={`${h2} mb-2`}>Escalation timeline</h2>
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
                <h2 className={`${h2} mb-2`}>Assumed responder speeds</h2>
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
            </div>
          )}

          {tab === "versions" && (
            <div data-settings-panel="versions" className="space-y-3">
              {versionList}
              <p className="text-xs text-slate-500">Versions stay read-only while you edit. Finish or cancel this edit to restore one.</p>
            </div>
          )}

          <div data-config-footer className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center gap-2 border-t border-slate-200 bg-cream/95 px-3 py-2 backdrop-blur">
            <p className="min-w-0 flex-1 text-xs font-semibold text-slate-500" aria-live="polite">
              {dirty ? <span data-unsaved className="text-amber-800">Unsaved changes</span> : "No unsaved changes"}
            </p>
            <button type="button" onClick={() => { setEditing(false); setDraft(null); setReviewing(false); }}
              className={`${btnSecondary} justify-center`}>Cancel</button>
            <button type="submit" disabled={!dirty || Object.keys(errors).length > 0}
              className={`${btnPrimary} justify-center disabled:opacity-50`}>
              <Save size={15} /> Review changes
            </button>
          </div>
        </form>
      ) : (
        <>
          {tab === "scoring" && (
            <div data-settings-panel="scoring" className="space-y-3">
              <section data-weights-card className={card}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className={h2}>Weights</h2>
                  <p className="font-mono text-[11px] font-bold text-slate-500">Sum {sumWeights.toFixed(1)}%</p>
                </div>
                <div data-weights-bar className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-slate-100" role="img"
                  aria-label="Scoring weights: Severity, Vulnerability, Location risk and Time sensitivity">
                  {WEIGHT_ROWS.map((w) => (
                    <span key={w.key} data-weight-segment className={w.tone} style={{ width: `${active.weights[w.key]}%` }} />
                  ))}
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {WEIGHT_ROWS.map((w) => (
                    <div key={w.key} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <dt className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-600">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: w.dot }} aria-hidden />
                        <span className="break-normal hyphens-none">{w.label}</span>
                      </dt>
                      <dd className="shrink-0 font-mono text-xs font-bold tabular-nums text-slate-800">{active.weights[w.key]}%</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-3">
                  <span data-consistency-chip
                    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-bold ${consistent ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
                    {consistent ? <Check size={12} aria-hidden /> : <AlertCircle size={12} aria-hidden />}
                    Consistency ratio {active.consistency.cr} {consistent ? "≤ 0.10" : "above 0.10"}
                  </span>
                </div>
              </section>

              <section data-score-bands className={card}>
                <h2 className={h2}>Score bands</h2>
                <div className="mt-3 flex h-12 overflow-hidden rounded-xl border border-slate-200" role="img"
                  aria-label="Score scale from 0 to 5: Moderate below 3, High from 3 to 3.99, Critical 4 and above">
                  <div className="flex w-[60%] flex-col justify-center bg-slate-100 px-2 text-[11px] font-bold leading-tight text-slate-700">Moderate <span className="font-normal text-slate-500">&lt; 3.0</span></div>
                  <div className="flex w-[20%] flex-col justify-center bg-brand-50 px-2 text-[11px] font-bold leading-tight text-brand-800">High <span className="font-normal text-brand-600">3.0–3.99</span></div>
                  <div className="flex w-[20%] flex-col justify-center bg-rose-50 px-2 text-[11px] font-bold leading-tight text-rose-800">Critical <span className="font-normal text-rose-600">≥ 4.0</span></div>
                </div>
                <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-400"><span>0</span><span>5</span></div>
              </section>

              <div data-critical-override className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] font-bold text-rose-800">
                <ShieldAlert size={13} aria-hidden /> Critical override · Severity 5 or headcount mismatch
              </div>
            </div>
          )}

          {tab === "escalation" && (
            <div data-settings-panel="escalation" className="space-y-3">
              <section data-escalation-timeline className={card}>
                <h2 className={h2}>Escalation timeline</h2>
                <ol className="mt-3 space-y-4">
                  <li className="relative border-l border-slate-200 pl-6">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-brand-600" aria-hidden />
                    <p className="text-sm font-bold text-slate-800">Reported</p>
                    <p className="text-[11px] text-slate-500">At report · the school is notified</p>
                  </li>
                  <li className="relative border-l border-slate-200 pl-6">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-amber-500" aria-hidden />
                    <p className="text-sm font-bold text-slate-800">Barangay Tanod</p>
                    <p className="text-[11px] text-slate-500">After {active.escalation.barangayMinutes} min without acknowledgement</p>
                  </li>
                  <li className="relative border-l border-transparent pl-6">
                    <span className="absolute -left-[5px] top-1 h-2.5 w-2.5 rounded-full bg-rose-500" aria-hidden />
                    <p className="text-sm font-bold text-slate-800">CDRRMO</p>
                    <p className="text-[11px] text-slate-500">After {active.escalation.cdrrmoMinutes} min without acknowledgement</p>
                  </li>
                </ol>
                <div data-hazard-adjustment className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-3 text-[11px] font-bold text-sky-800">
                  <AlertTriangle size={13} aria-hidden /> Hazard Location Risk +{active.hazardAdjustment}
                </div>
              </section>

              <section className={card}>
                <h2 className={h2}>Assumed travel speeds</h2>
                <div className="mt-3 grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-3">
                  {[
                    { label: "On foot", icon: Footprints, value: active.responderSpeeds.walking },
                    { label: "Motorcycle", icon: Bike, value: active.responderSpeeds.motorcycle },
                    { label: "Vehicle", icon: Truck, value: active.responderSpeeds.vehicle },
                  ].map((s) => (
                    <div key={s.label} data-speed-card className="flex min-h-[88px] min-w-0 flex-col justify-between rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <s.icon size={20} className="text-brand-700" aria-hidden />
                      <div className="mt-1 min-w-0">
                        <p className="break-normal hyphens-none text-xs font-bold text-slate-700">{s.label}</p>
                        <p className="font-mono text-lg font-black tabular-nums text-slate-900">{s.value} <span className="text-[11px] font-bold text-slate-500">km/h</span></p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {tab === "versions" && <div data-settings-panel="versions">{versionList}</div>}
        </>
      )}

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
    </PageFlow>
  );
}


// ----------------------------------------------------------- Sub-components

function ProvisionModal({ knownSections, onClose, onCreated }: {
  knownSections: string[];
  onClose: () => void;
  onCreated: (result: { credential: TempCredential | null; invite: InviteNotice | null; mailError: string | null }) => void;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"teacher" | "principal" | "responder" | "parent">("teacher");
  // Required for responders: which organization the account dispatches for.
  const [org, setOrg] = useState<"" | "barangay" | "cdrrmo">("");
  const [grade, setGrade] = useState("");
  const [sectionName, setSectionName] = useState("");
  // Teacher only: the classroom reports default to, and today's headcount.
  const [room, setRoom] = useState("");
  const [registry, setRegistry] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isTeacher = role === "teacher";
  const isParent = role === "parent";
  const needsSection = isTeacher || isParent;
  const suggestions = suggestionsForGrade(knownSections, grade);
  // "Sec A" is the placeholder, so a typed "Sec A" must not become "Sec Sec A".
  const sectionNameClean = normalizeSectionName(sectionName, suggestions);
  const section = composeSection(grade, sectionNameClean);
  const registryOk = registry.trim() === "" || (Number.isInteger(Number(registry)) && Number(registry) >= 0 && Number(registry) <= 200);
  const valid =
    Boolean(email && name) &&
    (!needsSection || (Boolean(grade) && sectionNameClean.length > 0)) &&
    (!isTeacher || Boolean(room)) &&
    (role !== "responder" || Boolean(org)) &&
    registryOk;

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{
        account: AccountRecord; tempPassword: string | null;
        invited?: boolean; maskedEmail?: string | null; mailError?: string | null;
      }>("POST", "/api/admin/accounts", {
        email, name, role, org: role === "responder" ? org : undefined,
        section: needsSection ? section : undefined,
        room: isTeacher ? room : undefined,
        registry: isTeacher && registry.trim() !== "" ? Number(registry) : undefined,
        password: password || undefined,
      });
      onCreated({
        credential: r.tempPassword ? { id: r.account.id, email, name, role, tempPassword: r.tempPassword } : null,
        invite: r.invited ? { basePath: `/api/admin/accounts/${r.account.id}`, name, maskedEmail: r.maskedEmail ?? null } : null,
        mailError: r.mailError ?? null,
      });
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
            { value: "responder", label: "Responder (Barangay Sinalhan / CDRRMO)" },
            { value: "parent", label: "Parent / PTA" },
          ]} />
        {role === "responder" && (
          <Select label="Organization" labelClassName="text-sm font-medium text-slate-700" value={org}
            onChange={(v) => setOrg(v as typeof org)} placeholder="Pick the responder's org"
            options={RESPONDER_ORGS.map((o: { id: string; label: string }) => ({ value: o.id, label: o.label }))} />
        )}
        {needsSection && (
          <GradeSectionField
            grade={grade}
            section={sectionName}
            knownSections={knownSections}
            onGrade={setGrade}
            onSection={setSectionName}
          />
        )}
        {isTeacher && (
          <>
            <RoomField value={room} onChange={setRoom} />
            <RegistryField
              value={registry}
              onChange={setRegistry}
              label="Today's registry"
              optional
              error={!registryOk ? "Today's registry must be a whole number from 0 to 200." : undefined}
            />
          </>
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
        <button onClick={() => void submit()}
          disabled={busy || !valid}
          className={`${btnPrimary} w-full justify-center`}>
          {busy ? "Creating…" : "Create account"}
        </button>
      </div>
    </Modal>
  );
}

/** Edit the account: name and email for every role, plus the shared class fields. */
function AccountEditModal({ acc, knownSections, onClose, onSave }: {
  acc: AccountRecord;
  knownSections: string[];
  onClose: () => void;
  onSave: (values: { name: string; email: string; org?: string; section?: string; room?: string; registry?: number }) => Promise<void>;
}) {
  const parsed = parseSection(acc.section ?? "");
  const isResponder = acc.role === "responder";
  const isParent = acc.role === "parent";
  const isTeacher = acc.role === "teacher";
  const [name, setName] = useState(acc.name);
  const [email, setEmail] = useState(acc.email);
  const [org, setOrg] = useState<string>(acc.org ?? "");
  const [grade, setGrade] = useState(parsed.grade);
  const [sec, setSec] = useState(parsed.sectionName || acc.section || "");
  const [room, setRoom] = useState(acc.teacher?.room ?? "");
  const [registry, setRegistry] = useState(String(acc.teacher?.registry ?? ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const suggestions = suggestionsForGrade(knownSections, grade);
  const section = grade ? composeSection(grade, normalizeSectionName(sec, suggestions)) : normalizeSectionName(sec, suggestions);
  const registryOk = registry.trim() === "" || (Number.isInteger(Number(registry)) && Number(registry) >= 0 && Number(registry) <= 200);
  const needsClass = isParent || isTeacher;
  const canSave =
    Boolean(name.trim()) && Boolean(email.trim()) &&
    (!isResponder || Boolean(org)) &&
    (!needsClass || (Boolean(grade) && Boolean(sec.trim()))) &&
    (!isTeacher || Boolean(room)) &&
    registryOk;

  async function save() {
    setBusy(true);
    setError("");
    try {
      await onSave({
        name: name.trim(), email: email.trim(),
        ...(isResponder ? { org } : {}),
        ...(needsClass ? { section } : {}),
        ...(isTeacher ? { room, ...(registry.trim() !== "" ? { registry: Number(registry) } : {}) } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the account.");
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit user" onClose={() => { if (!busy) onClose(); }}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">
          {acc.role}{acc.status !== "active" ? ` · ${acc.status}` : ""} · {acc.status === "invited"
            ? "changing the email resends the invitation"
            : "changing the email sends a code to the new address; the old one stays valid until confirmed"}
        </p>
        <label className="block text-sm font-medium text-slate-700">Name
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)}
            className={`${input} mt-1`} aria-label="Account name" />
        </label>
        <label className="block text-sm font-medium text-slate-700">Email
          <input type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)}
            className={`${input} mt-1`} aria-label="Account email" placeholder="name@deped.gov.ph" />
        </label>
        {isResponder && (
          <>
            <Select label="Organization" labelClassName="text-sm font-medium text-slate-700" value={org}
              onChange={setOrg} placeholder="Assign an organization"
              options={RESPONDER_ORGS.map((o: { id: string; label: string }) => ({ value: o.id, label: o.label }))} />
            <p className="text-xs text-slate-500">
              Every responder answers for one org. It names them in the ticket timeline and hides their own card
              on the Escalation page.
            </p>
          </>
        )}
        {needsClass && (
          <div className="space-y-3">
            <GradeSectionField
              grade={grade}
              section={sec}
              knownSections={knownSections}
              onGrade={setGrade}
              onSection={setSec}
            />
            {isTeacher && (
              <>
                <RoomField value={room} onChange={setRoom} />
                <RegistryField
                  value={registry}
                  onChange={setRegistry}
                  label="Registry"
                  hint="Today's class count; a report uses it as the expected number."
                  error={!registryOk ? "Registry must be a whole number from 0 to 200." : undefined}
                />
              </>
            )}
            <p className="text-xs text-slate-500">
              {isParent
                ? `Moves this Parent/PTA account to ${section || "another section"} — they see that section's alerts.`
                : "Renaming also renames the teacher's roster entry; the class follows the same rules as the Principal's roster."}
            </p>
          </div>
        )}
        {error && <p role="alert" className="text-sm font-semibold text-blush-700">{error}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className={`${btnSecondary} flex-1 justify-center`}>Cancel</button>
          <button onClick={() => void save()} disabled={busy || !canSave} className={`${btnPrimary} flex-1 justify-center`}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
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
