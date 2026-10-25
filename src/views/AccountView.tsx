import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useApp } from "../lib/store";
import { Modal } from "../components/Modal";
import { POLICY_TEXT, validatePassword } from "../lib/password";
import AboutView from "./AboutView";

const ROLE_LABEL: Record<string, string> = {
  teacher: "Teacher",
  principal: "Principal",
  parent: "Parent / PTA",
  responder: "Responder",
  super_admin: "Super Admin",
};

/** Teachers edit their own classroom here (Account → My classroom). */
function MyClassroom() {
  const { user, saveProfile } = useApp();
  const [name, setName] = useState(user!.name);
  const [section, setSection] = useState(user!.section ?? "");
  const [room, setRoom] = useState(user!.room ?? "");
  const [registry, setRegistry] = useState(String(user!.registry ?? ""));
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setErr("");
    setSaved(false);
    try {
      await saveProfile({
        name,
        section,
        room,
        ...(registry !== "" ? { registry: Number(registry) } : {}),
      });
      setSaved(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  const fields: [string, string, (v: string) => void, string, string][] = [
    ["Name", name, setName, "Ms. Reyes", "name"],
    ["Grade / Section", section, setSection, "Grade 3 - Sec A", "section"],
    ["Default Room", room, setRoom, "Bldg A | Flr 2 | Rm 204", "room"],
    [
      "Today's registry (number of pupils)",
      registry,
      (v: string) => setRegistry(v.replace(/\D/g, "").slice(0, 3)),
      "28",
      "registry",
    ],
  ];

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">My classroom</h2>
      <div className="mt-2 space-y-3">
        {fields.map(([label, val, set, ph, id]) => (
          <label key={id} htmlFor={`classroom-${id}`} className="block text-xs font-semibold text-slate-600">
            {label}
            <input
              id={`classroom-${id}`}
              value={val}
              onChange={(e) => set(e.target.value)}
              placeholder={ph}
              inputMode={id === "registry" ? "numeric" : undefined}
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-normal outline-none focus:border-brand-500"
            />
          </label>
        ))}
        <p className="text-xs text-slate-500">
          Registry = pupils expected today. It is the baseline for the headcount. To pick the
          classroom from the campus map, use “Change location” on the report screen.
        </p>
        {err && (
          <p role="alert" className="text-sm text-blush-700">
            {err}
          </p>
        )}
        {saved && (
          <p role="status" className="text-sm text-emerald-700">
            Classroom saved.
          </p>
        )}
        <button
          onClick={() => void save()}
          disabled={busy}
          className="min-h-12 w-full rounded-xl bg-brand-600 font-bold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : "Save classroom"}
        </button>
      </div>
    </section>
  );
}

export default function AccountView() {
  const { user, changePassword, logout } = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [about, setAbout] = useState(false);

  const isTeacher = user!.role === "teacher";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // Same policy as the server; the account-specific rules are enforced there.
    const issue = validatePassword(next, {});
    if (issue) { setMsg({ ok: false, text: issue }); return; }
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
    <div className="scroll-area mx-auto w-full max-w-md space-y-3 px-3 py-3 lg:h-full lg:max-w-5xl lg:overflow-y-auto">
      {/* Wide screens use two columns so the page is not a narrow strip in the
          middle of the desk; phones and tablets keep the single column. */}
      <div className="grid gap-3 lg:grid-cols-2 lg:items-start">
        <div className="space-y-3">
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-lg font-black tracking-tight text-slate-900">{user!.name}</p>
            <p className="mt-0.5 text-sm text-slate-600">
              {ROLE_LABEL[user!.role] ?? user!.role}{user!.section ? ` · ${user!.section}` : ""}
            </p>
            {user!.room && <p className="mt-0.5 text-xs text-slate-500">{user!.room}</p>}
          </section>

          {isTeacher && <MyClassroom />}

          <button onClick={() => setAbout(true)}
            className="min-h-12 w-full rounded-xl border border-slate-200 bg-white text-sm font-bold text-brand-700">
            About ASPIRE
          </button>

          <button onClick={() => logout()}
            className="min-h-14 w-full rounded-xl border border-blush-200 bg-white text-sm font-bold text-blush-700">
            Log out
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500">Change password</h2>

          <label className="block text-xs font-semibold text-slate-600" htmlFor="current-password">
            Current password
            <span className="relative mt-1 block">
              <input id="current-password" type={showCurrent ? "text" : "password"} autoComplete="current-password"
                value={current} onChange={(e) => setCurrent(e.target.value)} required
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 pr-12 text-base font-normal outline-none focus:border-brand-500" />
              <button type="button" onClick={() => setShowCurrent((v) => !v)} aria-label={showCurrent ? "Hide current password" : "Show current password"}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500">
                {showCurrent ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </span>
          </label>

          <p className="text-xs text-slate-500">{POLICY_TEXT}</p>

          <label className="block text-xs font-semibold text-slate-600" htmlFor="new-password">
            New password
            <span className="relative mt-1 block">
              <input id="new-password" type={showNext ? "text" : "password"} autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)} required placeholder="Choose a strong password"
                className="min-h-12 w-full rounded-xl border border-slate-300 px-3 pr-12 text-base font-normal outline-none focus:border-brand-500" />
              <button type="button" onClick={() => setShowNext((v) => !v)} aria-label={showNext ? "Hide new password" : "Show new password"}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500">
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
      </div>

      {about && (
        <Modal title="About ASPIRE" onClose={() => setAbout(false)} wide>
          <AboutView />
        </Modal>
      )}
    </div>
  );
}
