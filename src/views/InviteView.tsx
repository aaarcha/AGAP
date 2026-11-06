import { useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, MailWarning } from "lucide-react";
import { api } from "../lib/api";
import { validatePassword } from "../lib/password";
import { useApp } from "../lib/store";
import { ChangePasswordForm } from "../components/ChangePassword";

function inviteToken(): string {
  const hash = window.location.hash || "";
  const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(q).get("token") || "";
}

function clearInviteHash() {
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export default function InviteView() {
  const { acceptInvite } = useApp();
  const [token] = useState(inviteToken);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "done">("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    if (!token) { setState("invalid"); return; }
    void api<{ valid: boolean; email?: string; name?: string }>("POST", "/api/invite/check", { token })
      .then((r) => {
        if (!live) return;
        if (!r.valid) { setState("invalid"); return; }
        setEmail(r.email || "");
        setName(r.name || "");
        setState("ready");
      })
      .catch(() => { if (live) setState("invalid"); });
    return () => { live = false; };
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const issue = validatePassword(password, { email, name });
    if (issue) { setError(issue); return; }
    setBusy(true);
    try {
      clearInviteHash();
      await acceptInvite(token, password);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set your password.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh overflow-y-auto text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-6">
        <div className="flex flex-col items-center pb-5 pt-4 text-center">
          <img src="/icons/logo-256.png" alt="" width={48} height={48} className="h-12 w-12 rounded-xl border-2 border-white/10 bg-cream object-contain p-0.5" />
          <h1 className="mt-4 text-2xl font-black tracking-tight">Set your password</h1>
          {state === "ready" && <p className="mt-1 text-sm text-slate-300">{name} · {email}</p>}
        </div>

        {state === "loading" && <p className="py-10 text-center text-sm text-slate-400">Checking your invitation…</p>}

        {state === "invalid" && (
          <div className="rounded-2xl border border-amber-300/30 bg-amber-400/10 p-5 text-center">
            <MailWarning className="mx-auto text-amber-300" size={34} />
            <h2 className="mt-2 text-lg font-black">This invitation cannot be used</h2>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">
              It may have expired, already been used, or been revoked. Ask the person who invited you to send a new link.
            </p>
            <button type="button" onClick={() => { clearInviteHash(); window.location.reload(); }}
              className="mt-5 min-h-12 w-full rounded-xl bg-brand-600 px-4 font-bold text-white">Go to sign in</button>
          </div>
        )}

        {state === "ready" && (
          <>
            <p className="mb-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-relaxed text-slate-300">
              This link is also your first sign-in. Choose a password now; it expires in 72 hours and works once.
            </p>
            <ChangePasswordForm
              forced tone="dark" account={{ email, name }} value={password}
              onChange={(v) => { setPassword(v); setError(""); }} show={show} onToggle={() => setShow((s) => !s)}
              submitting={busy} error={error} success={false} onSubmit={submit} submitLabel="Set password & sign in" />
          </>
        )}

        {state === "done" && (
          <div className="py-10 text-center">
            <CheckCircle2 className="mx-auto text-emerald-300" size={36} />
            <h2 className="mt-2 text-xl font-black">You are signed in</h2>
            <p className="mt-1 text-sm text-slate-300">Your email is verified.</p>
          </div>
        )}
      </div>
    </div>
  );
}
