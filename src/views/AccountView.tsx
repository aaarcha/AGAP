import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useApp } from "../lib/store";
import { Modal } from "../components/Modal";
import AboutView from "./AboutView";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
  super_admin: "Super Admin",
};

export default function AccountView() {
  const { user, changePassword, logout } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [about, setAbout] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 8) { setMsg({ ok: false, text: "New password must be at least 8 characters." }); return; }
    setBusy(true); setMsg(null);
    try {
      await changePassword(next, current);
      setCurrent(""); setNext("");
      setMsg({ ok: true, text: "Password changed. Other devices were signed out." });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : "Could not change the password." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-3 px-3 py-3">
      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-lg font-black tracking-tight text-slate-900">{user!.name}</p>
        <p className="mt-0.5 text-sm text-slate-600">
          {ROLE_LABEL[user!.role] ?? user!.role}{user!.section ? ` · ${user!.section}` : ""}
        </p>
        {user!.room && <p className="mt-0.5 text-xs text-slate-500">{user!.room}</p>}
      </section>

      <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Change password</h2>

        <label className="block text-xs font-semibold text-slate-600" htmlFor="current-password">
          Current password
          <span className="relative mt-1 block">
            <input id="current-password" type={showCurrent ? "text" : "password"} autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} required
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 pr-12 text-base font-normal outline-none focus:border-brand-500" />
            <button type="button" onClick={() => setShowCurrent((v) => !v)} aria-label={showCurrent ? "Hide current password" : "Show current password"}
              className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-slate-500">
              {showCurrent ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </span>
        </label>

        <label className="block text-xs font-semibold text-slate-600" htmlFor="new-password">
          New password
          <span className="relative mt-1 block">
            <input id="new-password" type={showNext ? "text" : "password"} autoComplete="new-password"
              value={next} onChange={(e) => setNext(e.target.value)} required placeholder="At least 8 characters"
              className="min-h-12 w-full rounded-xl border border-slate-300 px-3 pr-12 text-base font-normal outline-none focus:border-brand-500" />
            <button type="button" onClick={() => setShowNext((v) => !v)} aria-label={showNext ? "Hide new password" : "Show new password"}
              className="absolute right-0 top-1/2 flex h-12 w-12 -translate-y-1/2 items-center justify-center text-slate-500">
              {showNext ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </span>
        </label>

        {msg && (
          <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-emerald-700" : "text-blush-700"}`}>{msg.text}</p>
        )}

        <button type="submit" disabled={busy || !current || !next}
          className="min-h-14 w-full rounded-xl bg-brand-600 text-base font-bold text-white disabled:opacity-50">
          {busy ? "Saving…" : "Change password"}
        </button>
      </form>

      <button onClick={() => setAbout(true)}
        className="min-h-12 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-brand-700">
        About ASPIRE
      </button>

      <button onClick={() => logout()}
        className="min-h-14 w-full rounded-xl border border-blush-200 bg-white text-sm font-bold text-blush-700">
        Log out
      </button>

      {about && (
        <Modal title="About ASPIRE" onClose={() => setAbout(false)} wide>
          <AboutView />
        </Modal>
      )}
    </div>
  );
}
