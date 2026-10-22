import { useState, useEffect } from "react";
import { Users, ClipboardList, Calendar, Plus, RefreshCw, Unlock, UserX, UserCheck, Key, Eye, EyeOff, Copy, Check, AlertCircle } from "lucide-react";
import { useApp } from "../lib/store";
import { api, ApiError } from "../lib/api";
import type { AccountRecord, AuditEntry, SchoolYear, TempCredential } from "../lib/types";
import { Modal, ConfirmModal } from "../components/Modal";
import { dateTime } from "../lib/format";

const card = "bg-white border border-slate-200 rounded-2xl p-4";
const h2 = "text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5";
const input = "w-full min-h-11 rounded-xl border border-slate-300 px-3 text-sm";
const btn = "min-h-10 px-3 rounded-xl text-sm font-bold flex items-center gap-1.5";
const btnPrimary = `${btn} bg-brand-600 text-white`;
const btnSecondary = `${btn} bg-slate-100 text-slate-700`;
const btnDanger = `${btn} bg-blush-100 text-blush-700`;

type Tab = "accounts" | "audit" | "schoolyear";

export default function AdminConsole() {
  const { logout } = useApp();
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
  }, [tab]);

  async function loadData() {
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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(acc: AccountRecord) {
    try {
      await api("POST", `/api/admin/accounts/${acc.id}/unlock`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to unlock");
    }
  }

  async function handleActivate(acc: AccountRecord) {
    try {
      await api("POST", `/api/admin/accounts/${acc.id}/activate`);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to activate");
    }
  }

  async function handleDeactivate() {
    if (!deactivateTarget) return;
    try {
      await api("POST", `/api/admin/accounts/${deactivateTarget.id}/deactivate`);
      setDeactivateTarget(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deactivate");
    }
  }

  async function handleReset() {
    if (!resetTarget) return;
    try {
      const r = await api<{ tempPassword: string }>("POST", `/api/admin/accounts/${resetTarget.id}/reset-password`);
      setResetResult(r.tempPassword);
      setResetTarget(null);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reset");
    }
  }

  async function handleRollover() {
    try {
      const r = await api<{ accounts: TempCredential[] }>("POST", "/api/admin/school-year/start");
      setRolloverResult(r.accounts);
      setRolloverConfirm(false);
      await loadData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start new school year");
    }
  }

  const tabs: { id: Tab; label: string; icon: typeof Users }[] = [
    { id: "accounts", label: "Accounts", icon: Users },
    { id: "audit", label: "Audit Log", icon: ClipboardList },
    { id: "schoolyear", label: "School Year", icon: Calendar },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-3 space-y-3">
      {/* Tab navigation */}
      <div className="flex gap-1 bg-white rounded-xl p-1 border border-slate-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 min-h-10 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 ${
              tab === t.id ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            <t.icon size={15} />
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl bg-blush-100 border border-blush-200 text-blush-800 p-3 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && <div className="text-center py-8 text-slate-500">Loading...</div>}

      {/* Accounts Tab */}
      {!loading && tab === "accounts" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className={h2}><Users size={14} /> User Accounts ({accounts.length})</h2>
            <button onClick={() => setShowProvision(true)} className={btnPrimary}>
              <Plus size={15} /> Provision Account
            </button>
          </div>
          <div className="grid gap-2">
            {accounts.map((acc) => (
              <div key={acc.id} className={card}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-800">{acc.name}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                        acc.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}>
                        {acc.status}
                      </span>
                      {acc.mustChange && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-bold">
                          Must change password
                        </span>
                      )}
                      {acc.temp && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-bold">
                          Temporary credentials
                        </span>
                      )}
                      {acc.locked && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blush-100 text-blush-700 font-bold">
                          Locked
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-600 mt-1">{acc.email}</p>
                    <p className="text-xs text-slate-500">{acc.role} {acc.section ? `· ${acc.section}` : ""}</p>
                    {acc.lastLoginAt && (
                      <p className="text-xs text-slate-400 mt-1">Last sign-in: {dateTime(acc.lastLoginAt)}</p>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    {acc.locked && (
                      <button onClick={() => handleUnlock(acc)} className={btnSecondary} title="Unlock account">
                        <Unlock size={15} />
                      </button>
                    )}
                    <button onClick={() => setResetTarget(acc)} className={btnSecondary} title="Reset password">
                      <Key size={15} />
                    </button>
                    {acc.status === "active" ? (
                      <button onClick={() => setDeactivateTarget(acc)} className={btnDanger} title="Deactivate">
                        <UserX size={15} />
                      </button>
                    ) : (
                      <button onClick={() => handleActivate(acc)} className={btnSecondary} title="Reactivate">
                        <UserCheck size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit Log Tab */}
      {!loading && tab === "audit" && (
        <div className="space-y-3">
          <h2 className={h2}><ClipboardList size={14} /> Audit Log (read-only)</h2>
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Time</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Action</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">By</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Target</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">Detail</th>
                    <th className="px-3 py-2 text-left font-bold text-slate-600">IP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditEntries.map((entry, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">{dateTime(entry.at)}</td>
                      <td className="px-3 py-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          entry.action.includes("failed") || entry.action.includes("locked") ? "bg-blush-100 text-blush-700" :
                          entry.action.includes("success") || entry.action.includes("activated") ? "bg-emerald-100 text-emerald-700" :
                          "bg-slate-100 text-slate-700"
                        }`}>
                          {entry.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{entry.by || "—"}</td>
                      <td className="px-3 py-2 text-slate-600">{entry.target || "—"}</td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">{entry.detail || "—"}</td>
                      <td className="px-3 py-2 text-slate-400 font-mono text-xs">{entry.ip || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {auditEntries.length === 0 && <p className="text-center text-slate-500 py-8">No audit entries yet.</p>}
        </div>
      )}

      {/* School Year Tab */}
      {!loading && tab === "schoolyear" && (
        <div className="space-y-3">
          <h2 className={h2}><Calendar size={14} /> School Year</h2>
          <div className={card}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-black text-slate-800">Year {schoolYear?.count || 0}</p>
                {schoolYear?.startedAt && (
                  <p className="text-sm text-slate-600 mt-1">Started: {dateTime(schoolYear.startedAt)}</p>
                )}
                <p className="text-xs text-slate-500 mt-1">{schoolYear?.accounts || 0} total accounts</p>
              </div>
              <button onClick={() => setRolloverConfirm(true)} className={btnPrimary}>
                <RefreshCw size={15} /> Start New School Year
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Provision Account Modal */}
      {showProvision && (
        <ProvisionModal
          onClose={() => setShowProvision(false)}
          onCreated={(cred) => {
            setShowProvision(false);
            setProvisionResult(cred);
            void loadData();
          }}
        />
      )}

      {/* Provision Result Modal */}
      {provisionResult && (
        <TempCredentialModal
          title="Account Provisioned"
          credential={provisionResult}
          onClose={() => setProvisionResult(null)}
        />
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <ConfirmModal
          title="Reset Password"
          message={`This will generate a new temporary password for ${resetTarget.name} (${resetTarget.email}). All existing sessions will be revoked.`}
          confirmLabel="Reset Password"
          onConfirm={handleReset}
          onClose={() => setResetTarget(null)}
        />
      )}

      {/* Reset Result Modal */}
      {resetResult && (
        <PasswordResultModal
          tempPassword={resetResult}
          onClose={() => setResetResult(null)}
        />
      )}

      {/* Deactivate Modal */}
      {deactivateTarget && (
        <ConfirmModal
          title="Deactivate Account"
          message={`This will deactivate ${deactivateTarget.name} (${deactivateTarget.email}). All their sessions will be revoked immediately.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={handleDeactivate}
          onClose={() => setDeactivateTarget(null)}
        />
      )}

      {/* Rollover Confirm Modal */}
      {rolloverConfirm && (
        <ConfirmModal
          title="Start New School Year"
          message="This will revoke all existing sessions for non-admin users and issue temporary credentials. Each user must set a new password on their next sign-in."
          confirmLabel="Start New Year"
          onConfirm={handleRollover}
          onClose={() => setRolloverConfirm(false)}
        />
      )}

      {/* Rollover Result Modal */}
      {rolloverResult && (
        <RolloverResultModal
          credentials={rolloverResult}
          onClose={() => setRolloverResult(null)}
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
    <Modal title="Provision New Account" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={`${input} mt-1`} placeholder="user@example.com" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Full Name
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1`} placeholder="Juan Dela Cruz" />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={`${input} mt-1`}>
            <option value="teacher">Teacher</option>
            <option value="principal">Principal</option>
            <option value="responder">Responder (Barangay/CDRRMO)</option>
            <option value="parent">Parent / PTA</option>
          </select>
        </label>
        {role === "parent" && (
          <label className="block text-sm font-medium text-slate-700">
            Section
            <input value={section} onChange={(e) => setSection(e.target.value)} className={`${input} mt-1`} placeholder="Grade 3 - Sec A" />
          </label>
        )}
        <div>
          <label className="block text-sm font-medium text-slate-700">
            Password <span className="text-slate-400 font-normal">(leave blank for temporary credentials)</span>
          </label>
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${input} pr-10`}
              placeholder="Min 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-blush-700">{error}</p>}
        <button onClick={submit} disabled={busy || !email || !name} className={`${btnPrimary} w-full justify-center`}>
          {busy ? "Creating..." : "Create Account"}
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
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <p className="font-bold mb-1">⚠️ Important: Save these credentials now</p>
          <p>This is the only time the temporary password will be shown. Share it securely with the user.</p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <p className="text-xs text-slate-500 mb-1">Email</p>
          <p className="font-mono text-sm font-bold">{credential.email}</p>
          <p className="text-xs text-slate-500 mt-3 mb-1">Temporary Password</p>
          <p className="font-mono text-sm font-bold">{credential.tempPassword}</p>
        </div>
        <button onClick={copyToClipboard} className={`${btnSecondary} w-full justify-center`}>
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy Credentials</>}
        </button>
        <p className="text-xs text-slate-500 text-center">
          The user will be required to set a new password on their first sign-in.
        </p>
      </div>
    </Modal>
  );
}

function PasswordResultModal({ tempPassword, onClose }: { tempPassword: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  return (
    <Modal title="Password Reset" onClose={onClose}>
      <div className="space-y-3">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <p className="font-bold mb-1">⚠️ Save this temporary password</p>
          <p>The user must set a new password on their next sign-in.</p>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
          <p className="text-xs text-slate-500 mb-1">Temporary Password</p>
          <p className="font-mono text-sm font-bold">{tempPassword}</p>
        </div>
        <button
          onClick={() => { void navigator.clipboard.writeText(tempPassword); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className={`${btnSecondary} w-full justify-center`}
        >
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy Password</>}
        </button>
      </div>
    </Modal>
  );
}

function RolloverResultModal({ credentials, onClose }: { credentials: TempCredential[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copyAll() {
    const text = credentials.map((c) => `${c.email} / ${c.tempPassword}`).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Modal title="New School Year Started" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          <p className="font-bold mb-1">⚠️ {credentials.length} temporary credentials generated</p>
          <p>All existing sessions have been revoked. Share these credentials securely. Users must set new passwords on first sign-in.</p>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left font-bold text-slate-600">Email</th>
                <th className="px-3 py-2 text-left font-bold text-slate-600">Temporary Password</th>
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
          {copied ? <><Check size={15} /> Copied!</> : <><Copy size={15} /> Copy All Credentials</>}
        </button>
      </div>
    </Modal>
  );
}
