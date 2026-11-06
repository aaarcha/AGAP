import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Mail, ShieldCheck } from "lucide-react";
import { api } from "../lib/api";
import { validatePassword } from "../lib/password";
import { ChangePasswordForm } from "./ChangePassword";
import { CodeInput } from "./CodeInput";

const GENERIC = "If an account exists, we sent a message.";

export function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [step, setStep] = useState<"email" | "reset" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (step !== "reset" || cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearInterval(t);
  }, [step, cooldown]);

  async function requestCode(e?: FormEvent) {
    e?.preventDefault();
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ message?: string }>("POST", "/api/password/forgot", { email: email.trim() });
      setNotice(r.message || GENERIC);
      setStep("reset");
      setCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the code.");
    } finally {
      setBusy(false);
    }
  }

  async function reset(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (code.replace(/\D/g, "").length !== 6) { setError("Enter the 6-digit code."); return; }
    const issue = validatePassword(password, { email });
    if (issue) { setError(issue); return; }
    setBusy(true);
    try {
      await api("POST", "/api/password/reset", { email: email.trim(), code, password });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh overflow-y-auto flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
      <div className="flex-1 w-full max-w-sm mx-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-6">
        <button type="button" onClick={onBack} className="flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-300">
          <ArrowLeft size={18} /> Back to sign in
        </button>

        <div className="mt-4 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10"><Mail size={22} /></span>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Forgot password</h1>
            <p className="text-xs text-slate-400">We will email a 6-digit code.</p>
          </div>
        </div>

        {step === "email" && (
          <form onSubmit={requestCode} className="mt-6 space-y-4">
            <label className="block text-sm font-medium text-slate-300" htmlFor="forgot-email">Email address</label>
            <input id="forgot-email" type="email" autoComplete="username" required value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="name@deped.gov.ph"
              className="min-h-12 w-full rounded-xl bg-white px-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-accent" />
            {error && <p role="alert" className="text-sm text-blush-300">{error}</p>}
            <button type="submit" disabled={busy} className="min-h-14 w-full rounded-xl bg-brand-600 px-4 font-bold text-white disabled:opacity-60">
              {busy ? "Sending…" : "Send code"}
            </button>
            <p className="text-xs leading-relaxed text-slate-400">For your privacy, the same response is shown whether or not an account exists.</p>
          </form>
        )}

        {step === "reset" && (
          <div className="mt-6 space-y-4">
            <p role="status" className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">{notice || GENERIC}</p>
            <div>
              <p className="mb-2 text-sm font-medium text-slate-300">Enter the code sent to {email.trim()}</p>
              <CodeInput value={code} onChange={(v) => { setCode(v); setError(""); }} disabled={busy} invalid={Boolean(error)} label="Password reset code" />
            </div>
            <button type="button" disabled={busy || cooldown > 0} onClick={() => void requestCode()}
              className="min-h-12 w-full rounded-xl border border-white/20 px-3 text-sm font-semibold text-slate-200 disabled:opacity-50">
              {cooldown > 0 ? `Resend code in ${cooldown} s` : "Resend code"}
            </button>
            <ChangePasswordForm
              forced tone="dark" account={{ email }} value={password} onChange={(v) => { setPassword(v); setError(""); }}
              show={show} onToggle={() => setShow((s) => !s)} submitting={busy} error={error} success={false}
              onSubmit={reset} submitLabel="Reset password" />
          </div>
        )}

        {step === "done" && (
          <div className="mt-10 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-5 text-center">
            <ShieldCheck className="mx-auto text-emerald-300" size={34} />
            <h2 className="mt-2 text-xl font-black">Password reset</h2>
            <p className="mt-1 text-sm text-slate-300">Sign in with your new password. Other devices were signed out.</p>
            <button type="button" onClick={onBack} className="mt-5 min-h-12 w-full rounded-xl bg-brand-600 px-3 font-bold text-white">Back to sign in</button>
          </div>
        )}
      </div>
    </div>
  );
}
