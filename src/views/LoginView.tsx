import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { SCHOOL } from "../../shared/domain.js";
import { useApp } from "../lib/store";
import { BRAND } from "../lib/brand";
import { Modal } from "../components/Modal";
import AboutView from "./AboutView";

export default function LoginView() {
  const { login, mustChange, changePassword, config } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Forced password change form (after school-year rollover / temp credentials)
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [changed, setChanged] = useState(false);
  const [about, setAbout] = useState(false);

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) { setChangeError("Password must be at least 8 characters."); return; }
    setChanging(true); setChangeError("");
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
    try { await login(email, password); }
    catch (e: any) { setError(e instanceof Error ? e.message : "Could not sign in."); }
    finally { setSubmitting(false); }
  };

  // ── Forced password change screen (single field + toggle, no confirm field) ──
  if (mustChange && !changed) {
    return (
      <div className="min-h-dvh flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
        <div className="flex-1 w-full max-w-md mx-auto px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-6 flex flex-col">
          <div className="flex flex-col items-center text-center pt-4 pb-6">
            <div className="w-28 h-28 rounded-3xl overflow-hidden bg-cream border-2 border-white/10 shadow-2xl" style={{ boxShadow: "0 0 40px 12px rgba(118,192,236,.35)" }}>
              <img src="/icons/logo-256.png" alt="" width={112} height={112} className="w-full h-full object-contain p-1" />
            </div>
            <h1 className="text-2xl font-black tracking-tight mt-4">Set a new password</h1>
            <p className="text-sm text-slate-300 font-medium mt-2">Your temporary credential must be replaced before you can continue.</p>
          </div>

          <form onSubmit={handlePasswordChange} className="w-full space-y-4">
            <div className="relative">
              <label className="block text-sm font-medium text-slate-300 mb-1.5" htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type={showNew ? "text" : "password"}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={changing}
                required
                placeholder="At least 8 characters"
                className="w-full min-h-14 rounded-xl px-4 pr-12 bg-white text-slate-900 text-base outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                className="absolute right-0 top-1/2 flex h-14 w-12 -translate-y-1/2 items-center justify-center text-slate-500 hover:text-brand-600"
                aria-label={showNew ? "Hide password" : "Show password"}
              >
                {showNew ? <Eye size={18} /> : <EyeOff size={18} />}
              </button>
            </div>

            {changeError && <p role="alert" className="text-sm text-blush-300">{changeError}</p>}

            <button
              type="submit"
              disabled={changing}
              className="w-full min-h-14 rounded-xl px-4 bg-brand-600 text-white font-bold text-base disabled:opacity-60"
            >
              {changing ? "Saving…" : "Set password & continue"}
            </button>
          </form>

          <button type="button" onClick={() => setAbout(true)} className="mt-6 min-h-12 text-xs font-semibold text-slate-400 underline">About ASPIRE</button>
        </div>
      </div>
    );
  }

  // ── Success screen after password change ──
  if (mustChange && changed) {
    return (
      <div className="min-h-dvh flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
        <div className="flex-1 w-full max-w-md mx-auto px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-6 flex flex-col items-center justify-center text-center">
          <p className="text-5xl mb-4" aria-hidden>✅</p>
          <h1 className="text-2xl font-black tracking-tight">Password set!</h1>
          <p className="text-sm text-slate-300 font-medium mt-2">You can now continue to the app.</p>
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
    <div className="min-h-dvh flex flex-col text-white" style={{ background: "radial-gradient(ellipse 120% 60% at 50% 0%, #425B9A 0%, #1D2848 55%, #0F1830 100%)" }}>
      <div className="flex-1 w-full max-w-md mx-auto px-5 pt-[max(2rem,env(safe-area-inset-top))] pb-6 flex flex-col">
        <div className="flex flex-col items-center text-center pt-4 pb-6">
          <div className="w-28 h-28 rounded-3xl overflow-hidden bg-cream border-2 border-white/10 shadow-2xl" style={{ boxShadow: "0 0 40px 12px rgba(118,192,236,.35)" }}>
            <img src="/icons/logo-256.png" alt="" width={112} height={112} className="w-full h-full object-contain p-1" />
          </div>
          <h1 className="text-2xl font-black tracking-tight mt-4">{BRAND.name}</h1>
          <p className="text-sm text-slate-300 font-medium">Emergency reporting and incident prioritization</p>
          <p className="text-xs text-slate-400 font-semibold mt-2">{SCHOOL.name} · DepEd ID {SCHOOL.depedId}</p>
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
              className="w-full min-h-14 rounded-xl px-4 bg-white text-slate-900 text-base outline-none focus:ring-2 focus:ring-accent focus:outline-none"
            />
          </div>

          {/* Password field – masked by default, show/hide toggle */}
          <div className="relative">
            <label className="block text-sm font-medium text-slate-300 mb-1.5" htmlFor="password" aria-label="Password">
              Password
            </label>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              required
              placeholder="Enter your password"
              className="w-full min-h-14 rounded-xl px-4 pr-12 bg-white text-slate-900 text-base outline-none focus:ring-2 focus:ring-accent focus:outline-none"
              aria-label={showPassword ? "Password (visible)" : "Password (masked)"}
            />
            <button
              type="button"
              onClick={toggle}
              className="absolute right-0 top-1/2 flex h-14 w-12 -translate-y-1/2 items-center justify-center text-slate-500 hover:text-brand-600 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-opacity-50"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <Eye size={18} /> : <EyeOff size={18} />}
            </button>
          </div>

          {/* Inline validation / server error message – announced to screen readers */}
          {error && <p role="alert" aria-live="assertive" className="text-sm text-blush-300">{error}</p>}

          <button
            type="submit"
            disabled={busy || submitting}
            className="w-full min-h-14 rounded-xl px-4 bg-brand-600 text-white font-bold text-base disabled:opacity-60 transition-opacity"
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="mt-auto pt-8 text-center">
          <button type="button" onClick={() => setAbout(true)} className="min-h-12 px-3 text-xs font-semibold text-slate-400 underline">
            About ASPIRE
          </button>
        </div>
      </div>

      {about && (
        <Modal title="About ASPIRE" onClose={() => setAbout(false)} wide>
          <AboutView />
        </Modal>
      )}
    </div>
  );
}

