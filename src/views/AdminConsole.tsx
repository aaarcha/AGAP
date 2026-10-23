import { useState, useEffect } from "react";
import {
  Users, ClipboardList, Calendar, Plus, RefreshCw, Unlock, UserX, UserCheck, Key, Eye, EyeOff, Copy, Check, AlertCircle,
  SlidersHorizontal, User,
} from "lucide-react";
import { useApp } from "../lib/store";
import { api } from "../lib/api";
import type { AccountRecord, AuditEntry, SchoolYear, TempCredential } from "../lib/types";
import { Modal, ConfirmModal } from "../components/Modal";
import { dateTime } from "../lib/format";
import { Header, StatusBanner, BottomNav, SideNav, type NavTab } from "../components/Chrome";
import AccountView from "./AccountView";
import { WEIGHTS, CONSISTENCY, HAZARD_LOCATION_BOOST, TRANSPORT_MODES } from "../../shared/domain.js";

const card = "rounded-2xl border border-slate-200 bg-white p-4";
const h2 = "flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-slate-500";
const input = "min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm";
const btn = "flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-sm font-bold";
const btnPrimary = `${btn} bg-brand-600 text-white`;
const btnSecondary = `${btn} bg-slate-100 text-slate-700`;
const btnDanger = `${btn} bg-blush-100 text-blush-700`;

type Tab = "accounts" | "audit" | "schoolyear" | "config" | "account";

const TABS: NavTab<Tab>[] = [
  { id: "accounts", label: "Accounts", icon: Users },
  { id: "audit", label: "Audit", icon: ClipboardList },
  { id: "schoolyear", label: "Year", icon: Calendar },
  { id: "config", label: "Configuration", icon: SlidersHorizontal },
  { id: "account", label: "Account", icon: User },
];

export default function AdminConsole() {
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
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

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

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
    <div className="flex min-h-dvh bg-cream">
      <SideNav tab={tab} setTab={setTab} tabs={TABS} subtitle="Super Admin" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header title="Super Admin" subtitle="Accounts, audit and configuration" />
        <StatusBanner />
        <main className="flex-1 px-3 py-3 pb-24 lg:pb-6">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded-xl border border-blush-200 bg-blush-100 p-3 text-sm text-blush-800">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {loading && <div className="py-8 text-center text-slate-500">Loading…</div>}

          {tab === "accounts" && !loading && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className={h2}><Users size={14} /> Accounts ({accounts.length})</h2>
                <button onClick={() => setShowProvision(true)} className={btnPrimary}><Plus size={15} /> Provision</button>
              </div>
              <AccountsPane accounts={accounts} onUnlock={handleUnlock} onActivate={handleActivate}
                onReset={setResetTarget} onDeactivate={setDeactivateTarget} />
            </div>
          )}

          {tab === "audit" && !loading && (
            <div className="space-y-3">
              <h2 className={h2}><ClipboardList size={14} /> Audit log (read-only)</h2>
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50">
                      <tr>
                        {["Time", "Action", "By", "Target", "Detail", "IP"].map((h) => <th key={h} className="px-3 py-2 text-left font-bold text-slate-600">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {auditEntries.map((entry, i) => (
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
            </div>
          )}

          {tab === "schoolyear" && !loading && (
            <div className="space-y-3">
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

          {tab === "config" && <ConfigTab />}
          {tab === "account" && <AccountView />}
        </main>
        <BottomNav tab={tab} setTab={setTab} tabs={TABS} />
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

function AccountsPane({ accounts, onUnlock, onActivate, onReset, onDeactivate }: {
  accounts: AccountRecord[];
  onUnlock: (a: AccountRecord) => void; onActivate: (a: AccountRecord) => void;
  onReset: (a: AccountRecord) => void; onDeactivate: (a: AccountRecord) => void;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const selected = accounts.find((a) => a.id === sel) ?? accounts[0] ?? null;
  if (accounts.length === 0) return <p className="py-8 text-center text-sm text-slate-500">No accounts yet.</p>;
  return (
    <>
      <div className="grid gap-2 lg:hidden">
        {accounts.map((acc) => (
          <div key={acc.id} className={card}>
            <div>
              <p className="text-base font-bold text-slate-800">{acc.name}</p>
              <p className="text-sm text-slate-600">{acc.email}</p>
              <p className="mt-0.5 text-xs text-slate-500">{acc.role}{acc.section ? ` · ${acc.section}` : ""}</p>
              <div className="mt-2"><StatusChips acc={acc} /></div>
              <div className="mt-3"><AccountActions acc={acc} onUnlock={onUnlock} onActivate={onActivate} onReset={onReset} onDeactivate={onDeactivate} /></div>
            </div>
          </div>
        ))}
      </div>
      <div className="hidden items-start gap-4 lg:grid lg:grid-cols-[22rem_minmax(0,1fr)]">
        <ul className="max-h-[calc(100dvh-14rem)] space-y-1.5 overflow-y-auto pr-1">
          {accounts.map((acc) => (
            <li key={acc.id}>
              <button onClick={() => setSel(acc.id)} aria-current={selected?.id === acc.id ? "true" : undefined}
                className={`w-full rounded-xl border p-3 text-left ${selected?.id === acc.id ? "border-brand-500 bg-white shadow-sm" : "border-slate-200 bg-white hover:border-brand-300"}`}>
                <p className="truncate text-sm font-bold text-slate-800">{acc.name}</p>
                <p className="truncate text-xs text-slate-500">{acc.role}{acc.section ? ` · ${acc.section}` : ""}</p>
                <p className={`mt-1 text-[11px] font-bold uppercase tracking-wide ${acc.status === "active" ? "text-emerald-700" : "text-slate-400"}`}>{acc.status}</p>
              </button>
            </li>
          ))}
        </ul>
        {selected && (
          <div className={card}>
            <p className="text-lg font-black text-slate-900">{selected.name}</p>
            <p className="text-sm text-slate-600">{selected.email}</p>
            <p className="mt-0.5 text-xs text-slate-500">{selected.role}{selected.section ? ` · ${selected.section}` : ""}</p>
            <div className="mt-2"><StatusChips acc={selected} /></div>
            {selected.lastLoginAt && <p className="mt-2 text-xs text-slate-400">Last sign-in: {dateTime(selected.lastLoginAt)}</p>}
            <div className="mt-4"><AccountActions acc={selected} onUnlock={onUnlock} onActivate={onActivate} onReset={onReset} onDeactivate={onDeactivate} /></div>
          </div>
        )}
      </div>
    </>
  );
}

function ConfigTab() {
  const { escalationMinutes } = useApp();
  const bands: [string, string][] = [["Critical", "4.0 and up"], ["High", "3.0 – 3.99"], ["Moderate", "below 3.0"]];
  return (
    <div className="mx-auto w-full max-w-3xl space-y-3">
      <section className={card}>
        <h2 className={`${h2} mb-2`}>Urgency model (read-only)</h2>
        <dl className="divide-y divide-slate-100 text-sm">
          {([["Severity", WEIGHTS.severity], ["Vulnerability", WEIGHTS.vulnerability], ["Location risk", WEIGHTS.locationRisk], ["Time sensitivity", WEIGHTS.timeSensitivity]] as const).map(([k, v]) => (
            <div key={k} className="flex items-center justify-between py-1.5"><dt className="text-slate-600">{k}</dt><dd className="font-mono font-bold text-brand-700">{v.toFixed(2)}</dd></div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-slate-500">Consistency ratio {CONSISTENCY.cr} · λmax {CONSISTENCY.lambdaMax} · CI {CONSISTENCY.ci} · RI {CONSISTENCY.ri}. Default values until the expert panel validates them.</p>
      </section>
      <section className={card}>
        <h2 className={`${h2} mb-2`}>Priority rules</h2>
        <dl className="divide-y divide-slate-100 text-sm">
          <div className="flex justify-between py-1.5"><dt className="text-slate-600">Score bands</dt><dd className="text-right text-slate-800">{bands.map(([k, v]) => `${k} ${v}`).join(" · ")}</dd></div>
          <div className="flex justify-between py-1.5"><dt className="text-slate-600">Critical override</dt><dd className="text-slate-800">Severity 5 or headcount mismatch</dd></div>
          <div className="flex justify-between py-1.5"><dt className="text-slate-600">Escalation</dt><dd className="text-slate-800">Barangay after {escalationMinutes[0]} min · CDRRMO after {escalationMinutes[1]} min</dd></div>
          <div className="flex justify-between py-1.5"><dt className="text-slate-600">Hazard mode boost</dt><dd className="font-mono text-slate-800">+{HAZARD_LOCATION_BOOST}</dd></div>
        </dl>
      </section>
      <section className={card}>
        <h2 className={`${h2} mb-2`}>Responder speeds</h2>
        <ul className="space-y-1 text-sm text-slate-700">
          {TRANSPORT_MODES.map((m) => <li key={m.id}>{m.label}: <span className="font-mono">{m.kmh} km/h</span></li>)}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Read-only. Change these in code after expert-panel validation.</p>
      </section>
    </div>
  );
}

// ----------------------------------------------------------- Sub-components

function ProvisionModal({ onClose, onCreated }: { onClose: () => void; onCreated: (cred: TempCredential | null) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"teacher" | "principal" | "responder" | "parent">("teacher");
  const [section, setSection] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ account: AccountRecord; tempPassword: string | null }>("POST", "/api/admin/accounts", {
        email, name, role, section: role === "parent" ? section : undefined, password: password || undefined,
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
        <label className="block text-sm font-medium text-slate-700">Role
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={`${input} mt-1`}>
            <option value="teacher">Teacher</option>
            <option value="principal">Principal</option>
            <option value="responder">Responder (Barangay/CDRRMO)</option>
            <option value="parent">Parent / PTA</option>
          </select>
        </label>
        {role === "parent" && (
          <label className="block text-sm font-medium text-slate-700">Section
            <input value={section} onChange={(e) => setSection(e.target.value)} className={`${input} mt-1`} placeholder="Grade 3 - Sec A" />
          </label>
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
        <button onClick={() => void submit()} disabled={busy || !email || !name} className={`${btnPrimary} w-full justify-center`}>
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
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
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
