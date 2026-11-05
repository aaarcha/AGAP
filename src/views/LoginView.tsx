import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SCHOOL } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { validatePassword } from "../lib/password";
import { BRAND } from "../lib/brand";
import { ChangePasswordForm } from "../components/ChangePassword";
import { AboutSheet } from "./AboutView";

/** Plain-language lead-in shown above the forced-change form when the server
 *  forced the change because the typed password did not meet the current
 *  policy. Derived from the login result only — the typed password itself is
 *  never stored or logged.
 */
function reasonForForce(): string {
  // The only forced-change trigger we currently raise at login is a policy
  // failure, so point the user at the live checklist rather than echoing any
  // password text.
  return "Your password doesn't meet the current policy. Set a new one to continue.";
}

export default function LoginView() {
  const { login, mustChange, changePassword, user } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Forced password change form (after school-year rollover / temp credentials / policy failure)
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [about, setAbout] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    const issue = validatePassword(newPassword, {});
    if (issue) { setChangeError(issue); return; }
    setChanging(true); setChangeError(null);
    try {
      await changePassword(newPassword);
      setChanged(true);
    } catch (err) {
      setChangeError(err instanceof Error ? err.message : "Could not set password.");
    } finally {
      setChanging(false);
    }
  }

  const validate = () => {
    let valid = true;
    let message = "";
    if (!email) { valid = false; message = "Email is required."; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { valid = false; message = "Please enter a valid email."; }
    if (!password) { valid = false; const p = message ? message + " " : ""; message = p + "Password is required."; }
    if (!valid) { setError(message); return false; }
    setError("");
    return true;
  };

  const toggle = () => setShowPassword((s) => !s);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true); setError("");
    try {
      const isForced = await login(email, password);
      if (isForced) {
        // The server returned mustChange=true. The policy text is rendered live
        // by ChangePasswordForm; this one-line lead-in tells the user why,
        // without ever storing or logging the typed password.
        setPolicyHint(reasonForForce());
      }
    } catch (e: any) { setError(e instanceof Error ? e.message : "Could not sign in."); }
    finally { setSubmitting(false); }
  };

  // Keep a plain-language hint (never the password) for the forced-change screen.
  const [policyHint, setPolicyHint] = useState<string | null>(null);

  // ── Forced password change screen (blocking full-screen step) ──
  if (mustChange && !changed) {
    return (
      <div className="min-h-dvh overflow-y-auto flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
        <div className="flex-1 w-full max-w-sm mx-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 flex flex-col">
          <div className="flex flex-col items-center text-center pt-3 pb-4">
            <div className="w-10 h-10 rounded-xl overflow-hidden bg-cream border-2 border-white/10 shadow-sm" style={{ boxShadow: "0 0 12px 4px rgba(118,192,236,.25)" }}>
              <img src="/icons/logo-256.png" alt="" width={40} height={40} className="w-full h-full object-contain p-0.5" />
            </div>
            <h1 className="text-2xl font-black tracking-tight mt-4">Set a new password</h1>
            <p className="text-xs text-slate-400 font-medium mt-1">Your credential must be replaced before you can continue.</p>
            {policyHint && <p className="mt-1 text-xs text-slate-400">{policyHint}</p>}
          </div>

          <ChangePasswordForm
            forced
            tone="dark"
            account={{ email, name: user?.name }}
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggle={() => setShowNew((s) => !s)}
            submitting={changing}
            error={changeError}
            success={false}
            onSubmit={handlePasswordChange}
            submitLabel="Set password & continue"
          />

          <button type="button" onClick={() => setAbout(true)} className="mt-6 min-h-12 text-xs font-semibold text-slate-400 underline">About ASPIRE</button>
        </div>
      </div>
    );
  }

  // ── Success screen after password change ──
  if (mustChange && changed) {
    return (
      <div className="min-h-dvh overflow-y-auto flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
        <div className="flex-1 w-full max-w-md mx-auto px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-6 flex flex-col items-center justify-center text-center">
          <p className="text-5xl mb-4" aria-hidden>✅</p>
          <h1 className="text-2xl font-black tracking-tight mt-4">Password set!</h1>
          <p className="text-base text-slate-300 font-medium mt-1.5">You can now continue to the app.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 w-full min-h-14 rounded-xl px-4 bg-brand-600 text-white font-bold text-base"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh overflow-y-auto flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
      <div className="flex-1 w-full max-w-sm mx-auto px-4 pt-[max(1.25rem,env(safe-area-inset-top))] pb-4 flex flex-col">
        <div className="flex flex-col items-center text-center pt-4 pb-6">
          <div className="w-10 h-10 rounded-xl overflow-hidden bg-cream border-2 border-white/10 shadow-sm" style={{ boxShadow: "0 0 12px 4px rgba(118,192,236,.25)" }}>
            <img src="/icons/logo-256.png" alt="" width={40} height={40} className="w-full h-full object-contain p-0.5" />
          </div>
          <h1 className="text-2xl font-black tracking-tight mt-4">{BRAND.name}</h1>
          <p className="text-sm text-slate-400 font-medium mt-1">Emergency reporting and incident prioritization</p>
          <p className="text-xs text-slate-500 font-semibold mt-1.5">{SCHOOL.name} · DepEd ID {SCHOOL.depedId}</p>
        </div>

        {/* Login form – mobile-first, accessible, touch-target sized */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          {/* Email / username field */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5" htmlFor="email" aria-label="Email or username">
              Email or username
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
              placeholder="Enter your email"
              className="w-full min-h-12 rounded-xl px-3 bg-white text-slate-900 text-sm outline-none focus:ring-2 focus:ring-accent"
            />
          </div>

          {/* Password field – masked by default, show/hide toggle */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5" htmlFor="password" aria-label="Password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
                placeholder="Enter your password"
                className="w-full min-h-12 rounded-lg px-3 pr-12 bg-white text-slate-900 text-sm outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={toggle}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-slate-500 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-50"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>
          </div>

          {/* Inline validation / server error message – announced to screen readers */}
          {error && <p role="alert" aria-live="assertive" className="text-sm text-blush-300">{error}</p>}
          <button
            type="submit"
            disabled={busy || submitting}
            className="w-full min-h-14 rounded-xl px-4 bg-brand-600 text-white font-bold text-base disabled:opacity-60"
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <button type="button" onClick={() => setAbout(true)} className="mt-6 min-h-12 text-xs font-semibold text-slate-400 underline">About ASPIRE</button>
      </div>

      {about && <AboutSheet onClose={() => setAbout(false)} />}
    </div>
  );
}
